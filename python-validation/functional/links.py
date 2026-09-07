"""
functional/links.py
Detects broken/unreachable links and broken internal navigation.

Reachability is checked via safe, side-effect-free HTTP HEAD/GET requests
(common/http_check.py) — never a full page navigation, never clicking
anything. `javascript:`, `mailto:`, `tel:`, and same-page `#fragment`
hrefs are skipped (nothing to safely check).
"""

from __future__ import annotations

from common.http_check import check_link, is_checkable_url, is_internal, resolve_url
from common.models import Finding, ValidationResult, mock_result

MAX_LINKS_CHECKED = 40

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
            source="links",
            category="functional",
            title="Link validation (mocked)",
            description=f"Would crawl and check links on {url}.",
            metrics={"linksChecked": 0, "mocked": True},
        )

    page = session.page
    if page is None:
        return ValidationResult(
            check="functional",
            warnings=["links: no page available (navigation may have failed)"],
            metrics={"linksChecked": 0},
        )

    base_url = session.final_url or url

    try:
        anchors = page.eval_on_selector_all("a[href]", _COLLECT_JS)
    except Exception as exc:  # noqa: BLE001
        return ValidationResult(check="functional", errors=[f"links: failed to read anchors: {exc}"])

    seen_hrefs: set[str] = set()
    checkable: list[dict] = []
    for a in anchors:
        href = a.get("href") or ""
        if not is_checkable_url(href):
            continue
        resolved = resolve_url(href, base_url)
        if resolved in seen_hrefs:
            continue
        seen_hrefs.add(resolved)
        checkable.append({"href": href, "resolved": resolved, "text": a.get("text") or ""})

    # Prioritize internal links (most actionable, and we own the fix), then
    # a sample of external ones, up to the cap.
    internal_links = [link for link in checkable if is_internal(link["resolved"], base_url)]
    external_links = [link for link in checkable if not is_internal(link["resolved"], base_url)]
    to_check = (internal_links + external_links)[:MAX_LINKS_CHECKED]

    findings: list[Finding] = []
    broken_count = 0
    request_ctx = session.context.request

    for link in to_check:
        result = check_link(request_ctx, link["resolved"])
        if result.ok:
            continue

        broken_count += 1
        internal_link = is_internal(link["resolved"], base_url)

        if result.redirect_broken:
            title = "Broken redirect chain"
        elif internal_link:
            title = "Broken internal navigation link"
        else:
            title = "Broken external link"

        findings.append(
            Finding(
                id=f"functional-link-{len(findings) + 1}",
                category="functional",
                severity="high" if internal_link else "medium",
                title=title,
                description=(
                    f'Link "{link["text"] or link["href"]}" ({link["resolved"]}) '
                    f'{"(internal) " if internal_link else ""}'
                    f'{result.error or f"returned HTTP {result.status}"}.'
                ),
                evidence={
                    "href": link["href"],
                    "resolvedUrl": link["resolved"],
                    "linkText": link["text"],
                    "internal": internal_link,
                    "status": result.status,
                    "redirectChain": result.redirect_chain,
                },
                recommendation=(
                    "Fix the final destination in the redirect chain, or update the Location header."
                    if result.redirect_broken
                    else "Update or remove this link; verify the target route exists and returns a 2xx status."
                ),
                confidence=0.9,
                source="python-functional",
            )
        )

    return ValidationResult(
        check="functional",
        findings=findings,
        metrics={
            "linksFound": len(checkable),
            "linksChecked": len(to_check),
            "internalLinksChecked": len([l for l in to_check if is_internal(l["resolved"], base_url)]),
            "externalLinksChecked": len([l for l in to_check if not is_internal(l["resolved"], base_url)]),
            "brokenLinksFound": broken_count,
        },
    )
