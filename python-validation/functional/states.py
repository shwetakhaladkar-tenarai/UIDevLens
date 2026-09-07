"""
functional/states.py
Heuristically detects stuck loading indicators and unexpectedly-visible
error states in the page's settled DOM.

These are inherently heuristic (matched by common class/attribute naming
conventions such as "loading", "spinner", "error", role="alert"), so
findings are reported at moderate confidence rather than the near-certainty
used for hard facts like HTTP status codes.
"""

from __future__ import annotations

from common.models import Finding, ValidationResult, mock_result

SETTLE_WAIT_MS = 1500

_STATE_JS = """
() => {
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };

  const loadingSelector = [
    '[class*="loading" i]', '[class*="spinner" i]', '[class*="skeleton" i]',
    '[aria-busy="true"]', '[role="progressbar"]',
  ].join(',');

  const errorSelector = [
    '[class*="error" i]:not(input):not(select):not(textarea)',
    '[role="alert"]',
  ].join(',');

  const visibleLoading = Array.from(document.querySelectorAll(loadingSelector))
    .filter(isVisible)
    .slice(0, 10)
    .map(el => ({ tag: el.tagName, class: (el.className || '').toString().slice(0, 80) }));

  const visibleErrors = Array.from(document.querySelectorAll(errorSelector))
    .filter(isVisible)
    .slice(0, 10)
    .map(el => ({
      tag: el.tagName,
      class: (el.className || '').toString().slice(0, 80),
      text: (el.innerText || '').trim().slice(0, 120),
    }));

  return { visibleLoading, visibleErrors };
}
"""


def validate(url: str, session=None, **_kwargs) -> ValidationResult:
    if session is None or getattr(session, "mocked", True):
        return mock_result(
            check="functional",
            source="states",
            category="functional",
            title="UI state validation (mocked)",
            description=f"Would inspect loading/empty/error/disabled states on {url}.",
            metrics={"statesChecked": 0, "mocked": True},
        )

    page = session.page
    if page is None:
        return ValidationResult(check="functional", warnings=["states: no page available"], metrics={"statesChecked": 0})

    try:
        # Give any lingering async loading state a further moment to resolve
        # before judging it "stuck".
        page.wait_for_timeout(SETTLE_WAIT_MS)
        state = page.evaluate(_STATE_JS)
    except Exception as exc:  # noqa: BLE001
        return ValidationResult(check="functional", errors=[f"states: failed to inspect DOM state: {exc}"])

    findings: list[Finding] = []

    for el in state.get("visibleLoading", []):
        findings.append(
            Finding(
                id=f"functional-states-stuck-loading-{len(findings) + 1}",
                category="functional",
                severity="medium",
                title="Possible stuck loading state",
                description=(
                    f'A loading indicator (<{el["tag"].lower()} class="{el["class"]}">) is still visible well '
                    "after the page finished loading, which may indicate content that never resolves."
                ),
                evidence=el,
                recommendation="Verify the underlying data/request resolves and the loading indicator is hidden afterward.",
                confidence=0.5,
                source="python-functional",
            )
        )

    for el in state.get("visibleErrors", []):
        findings.append(
            Finding(
                id=f"functional-states-default-error-{len(findings) + 1}",
                category="functional",
                severity="medium",
                title="Error state visible without user action",
                description=(
                    f'An error-styled element (<{el["tag"].lower()} class="{el["class"]}">) is visible '
                    f'immediately on page load: "{el["text"]}". This may indicate a default/broken error state.'
                ),
                evidence=el,
                recommendation="Confirm this error state should be visible by default; hide it unless a real error occurred.",
                confidence=0.45,
                source="python-functional",
            )
        )

    return ValidationResult(
        check="functional",
        findings=findings,
        metrics={
            "stuckLoadingIndicators": len(state.get("visibleLoading", [])),
            "unexpectedErrorStates": len(state.get("visibleErrors", [])),
        },
    )
