"""
functional/console_errors.py
Reports JavaScript console errors, uncaught exceptions, failed network
requests, and HTTP error responses observed during this run's page load and
subsequent safe interactions (links/buttons/forms/navigation all run
before this validator and share the same session, so anything they
triggered is captured too).

Purely passive: reads what the browser already reported via the listeners
attached in common/browser.py — issues no requests and clicks nothing.
"""

from __future__ import annotations

from common.models import Finding, ValidationResult, mock_result

MAX_FINDINGS_PER_KIND = 20


def validate(url: str, session=None, **_kwargs) -> ValidationResult:
    if session is None or getattr(session, "mocked", True):
        return mock_result(
            check="functional",
            source="console_errors",
            category="functional",
            title="Console error collection (mocked)",
            description=f"Would capture page console errors on {url}.",
            metrics={"consoleErrors": 0, "mocked": True},
        )

    findings: list[Finding] = []

    # ── Main document HTTP status ───────────────────────────────────────────
    if session.main_response_status is not None and session.main_response_status >= 400:
        findings.append(
            Finding(
                id="functional-page-http-error",
                category="functional",
                severity="high",
                title="Page returned an HTTP error status",
                description=f"The page itself responded with HTTP {session.main_response_status}.",
                evidence={"status": session.main_response_status, "url": session.final_url or url},
                recommendation="Investigate why the page itself returns an error status and fix the underlying route/server issue.",
                confidence=0.95,
                source="python-functional",
            )
        )

    if session.navigation_error:
        findings.append(
            Finding(
                id="functional-page-navigation-error",
                category="functional",
                severity="high",
                title="Page failed to load",
                description=f"Navigation to the page failed: {session.navigation_error}",
                evidence={"url": url, "error": session.navigation_error},
                recommendation="Check server availability, TLS/DNS configuration, and page load timeout.",
                confidence=0.9,
                source="python-functional",
            )
        )

    # ── Console errors (console.error calls) ────────────────────────────────
    console_errors = [m for m in session.console_messages if m.type == "error"]
    for msg in console_errors[:MAX_FINDINGS_PER_KIND]:
        findings.append(
            Finding(
                id=f"functional-console-error-{len(findings) + 1}",
                category="functional",
                severity="medium",
                title="JavaScript console error",
                description=f'The page logged a console error: "{msg.text[:200]}"',
                evidence={"message": msg.text, "location": msg.location},
                recommendation="Investigate and fix the source of this console error.",
                confidence=0.85,
                source="python-functional",
            )
        )

    # ── Uncaught exceptions ──────────────────────────────────────────────────
    for err in session.page_errors[:MAX_FINDINGS_PER_KIND]:
        findings.append(
            Finding(
                id=f"functional-page-error-{len(findings) + 1}",
                category="functional",
                severity="high",
                title="Uncaught JavaScript exception",
                description=f'An uncaught exception occurred on the page: "{err[:200]}"',
                evidence={"message": err},
                recommendation="Fix the uncaught exception; it likely breaks functionality for users too.",
                confidence=0.9,
                source="python-functional",
            )
        )

    # ── Failed / erroring network requests observed during page load ───────
    failed_requests = [n for n in session.network_log if not n.ok]
    for entry in failed_requests[:MAX_FINDINGS_PER_KIND]:
        is_document = entry.resource_type in ("document", "xhr", "fetch")
        findings.append(
            Finding(
                id=f"functional-network-error-{len(findings) + 1}",
                category="functional",
                severity="high" if is_document else "medium",
                title="Failed network request" if entry.failure else "HTTP error response",
                description=(
                    f"A {entry.resource_type} request to {entry.url} "
                    + (f"failed: {entry.failure}" if entry.failure else f"returned HTTP {entry.status}")
                ),
                evidence={
                    "url": entry.url,
                    "method": entry.method,
                    "resourceType": entry.resource_type,
                    "status": entry.status,
                    "failure": entry.failure,
                },
                recommendation="Fix or remove this request; a failing network call can break the feature that depends on it.",
                confidence=0.85,
                source="python-functional",
            )
        )

    return ValidationResult(
        check="functional",
        findings=findings,
        metrics={
            "consoleErrorsFound": len(console_errors),
            "pageErrorsFound": len(session.page_errors),
            "consoleMessagesTotal": len(session.console_messages),
            "failedNetworkRequests": len(failed_requests),
        },
    )
