"""
functional/navigation.py
Tests primary navigation (links inside <nav> elements): reachability and
redirect-chain safety via HTTP checks (common/http_check.py — no browser
navigation involved), plus, for a small sample of internal nav links, an
actual browser navigation to confirm the destination truly renders and not
just that it returns a 2xx status.

Always restores the original page before returning (try/finally) so later
functional validators (states.py in particular) see the page they expect.
"""

from __future__ import annotations

from common.http_check import check_link, is_checkable_url, is_internal, resolve_url
from common.logger import get_logger
from common.models import Finding, ValidationResult, mock_result

log = get_logger("python-validation.functional.navigation")

MAX_NAV_LINKS_CHECKED = 15
MAX_REAL_NAVIGATIONS = 3
NAV_TIMEOUT_MS = 8000

_COLLECT_JS = (
    "els => els.map(e => ({"
    "href: e.getAttribute('href'), "
    "text: (e.innerText || '').trim().slice(0, 80)"
    "}))"
)


def validate(url: str, session=None, **_kwargs) -> ValidationResult:
    if session is None or getattr(session, "mocked", True):
        return mock_result(
            check="functional",
            source="navigation",
            category="functional",
            title="Navigation validation (mocked)",
            description=f"Would follow primary navigation paths on {url}.",
            metrics={"routesChecked": 0, "mocked": True},
        )

    page = session.page
    if page is None:
        return ValidationResult(check="functional", warnings=["navigation: no page available"], metrics={"routesChecked": 0})

    base_url = session.final_url or url

    try:
        nav_links = page.eval_on_selector_all("nav a[href]", _COLLECT_JS)
    except Exception as exc:  # noqa: BLE001
        return ValidationResult(check="functional", errors=[f"navigation: failed to read nav links: {exc}"])

    seen: set[str] = set()
    checkable: list[dict] = []
    for a in nav_links:
        href = a.get("href") or ""
        if not is_checkable_url(href):
            continue
        resolved = resolve_url(href, base_url)
        if resolved in seen:
            continue
        seen.add(resolved)
        checkable.append({"href": href, "resolved": resolved, "text": a.get("text") or ""})

    to_check = checkable[:MAX_NAV_LINKS_CHECKED]
    request_ctx = session.context.request

    findings: list[Finding] = []
    broken_resolved_urls: set[str] = set()

    for link in to_check:
        result = check_link(request_ctx, link["resolved"])
        if result.ok:
            continue
        broken_resolved_urls.add(link["resolved"])
        findings.append(
            Finding(
                id=f"functional-nav-broken-{len(findings) + 1}",
                category="functional",
                severity="high",
                title="Broken redirect in primary navigation" if result.redirect_broken else "Broken primary navigation link",
                description=(
                    f'Navigation link "{link["text"] or link["href"]}" ({link["resolved"]}) '
                    f'{result.error or f"returned HTTP {result.status}"}.'
                ),
                evidence={
                    "href": link["href"],
                    "resolvedUrl": link["resolved"],
                    "linkText": link["text"],
                    "status": result.status,
                    "redirectChain": result.redirect_chain,
                },
                recommendation="Fix or remove this navigation link; verify the destination route exists and returns a 2xx status.",
                confidence=0.9,
                source="python-functional",
            )
        )

    # Real-browser navigation check for a small sample of INTERNAL links that
    # already passed the HTTP check — confirms the destination actually
    # renders, not just that it returns a 2xx.
    real_nav_targets = [
        link
        for link in to_check
        if is_internal(link["resolved"], base_url) and link["resolved"] not in broken_resolved_urls
    ][:MAX_REAL_NAVIGATIONS]

    navigations_tested = 0
    try:
        for link in real_nav_targets:
            navigations_tested += 1
            try:
                resp = page.goto(link["resolved"], wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
                if resp is not None and resp.status >= 400:
                    findings.append(
                        Finding(
                            id=f"functional-nav-render-error-{len(findings) + 1}",
                            category="functional",
                            severity="high",
                            title="Navigation destination failed to load",
                            description=(
                                f'Navigating to "{link["text"] or link["href"]}" ({link["resolved"]}) '
                                f"returned HTTP {resp.status}."
                            ),
                            evidence={"href": link["href"], "resolvedUrl": link["resolved"], "status": resp.status},
                            recommendation="Investigate why this route renders an error response and fix the underlying page/route.",
                            confidence=0.85,
                            source="python-functional",
                        )
                    )
            except Exception as exc:  # noqa: BLE001
                findings.append(
                    Finding(
                        id=f"functional-nav-navigation-failed-{len(findings) + 1}",
                        category="functional",
                        severity="high",
                        title="Navigation failed to load destination page",
                        description=(
                            f'Navigating to "{link["text"] or link["href"]}" ({link["resolved"]}) failed: {exc}'
                        ),
                        evidence={"href": link["href"], "resolvedUrl": link["resolved"], "error": str(exc)},
                        recommendation="Check the destination page for a slow/hanging load or a broken redirect and fix it.",
                        confidence=0.75,
                        source="python-functional",
                    )
                )
    finally:
        # Always restore the original page so downstream functional
        # validators (states.py) inspect the page they expect.
        try:
            if page.url != base_url:
                page.goto(base_url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
        except Exception as exc:  # noqa: BLE001
            log.warning("navigation: failed to restore original page: %s", exc)

    return ValidationResult(
        check="functional",
        findings=findings,
        metrics={
            "navLinksFound": len(checkable),
            "navLinksChecked": len(to_check),
            "brokenNavLinks": len(broken_resolved_urls),
            "realNavigationsTested": navigations_tested,
        },
    )
