"""
functional/buttons.py
Tests SAFE interactive controls only.

Safe-interaction policy (see common/safe_interaction.py):
  - never clicks anything inside a <form>, or type="submit" — those could
    submit real data. forms.py inspects/validates forms without submitting.
  - never clicks anything whose text/aria-label/title/name matches a
    destructive/irreversible action (delete, purchase, logout, ...).
  - never clicks disabled or invisible controls.

For every control that IS safely clicked, before/after state is compared
(URL, visible text length, aria-expanded, network activity, new console
messages) to detect controls that look interactive but produce no
observable effect. Per spec, the absence of NAVIGATION alone is never
treated as failure — only the absence of EVERY observable signal is.
"""

from __future__ import annotations

from common.models import Finding, ValidationResult, mock_result
from common.safe_interaction import describe_control, is_unsafe_to_interact

MAX_CANDIDATES_INSPECTED = 25
MAX_CLICKS_PERFORMED = 8
SETTLE_MS = 500

_SELECTOR = 'button, [role="button"], input[type="button"], input[type="submit"]'

# Tags each candidate with a unique data attribute so it can be re-located
# reliably even if an earlier click reorders/mutates the DOM.
_COLLECT_JS = """
(selector) => {
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const els = Array.from(document.querySelectorAll(selector));
  return els.map((el, i) => {
    el.setAttribute('data-fnval-idx', String(i));
    return {
      index: i,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type'),
      text: (el.innerText || el.getAttribute('value') || '').trim().slice(0, 80),
      ariaLabel: el.getAttribute('aria-label') || '',
      title: el.getAttribute('title') || '',
      name: el.getAttribute('name') || '',
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      visible: isVisible(el),
      inForm: !!el.closest('form'),
      ariaExpanded: el.hasAttribute('aria-expanded') ? el.getAttribute('aria-expanded') : null,
    };
  });
}
"""


def _page_signature(page) -> dict:
    try:
        text_length = page.evaluate("() => document.body ? document.body.innerText.length : 0")
    except Exception:  # noqa: BLE001
        text_length = None
    return {"url": page.url, "textLength": text_length}


def validate(url: str, session=None, **_kwargs) -> ValidationResult:
    if session is None or getattr(session, "mocked", True):
        return mock_result(
            check="functional",
            source="buttons",
            category="functional",
            title="Button validation (mocked)",
            description=f"Would inspect buttons and click targets on {url}.",
            metrics={"buttonsChecked": 0, "mocked": True},
        )

    page = session.page
    if page is None:
        return ValidationResult(check="functional", warnings=["buttons: no page available"], metrics={"buttonsChecked": 0})

    try:
        candidates = page.evaluate(_COLLECT_JS, _SELECTOR)
    except Exception as exc:  # noqa: BLE001
        return ValidationResult(check="functional", errors=[f"buttons: failed to enumerate controls: {exc}"])

    candidates = candidates[:MAX_CANDIDATES_INSPECTED]

    findings: list[Finding] = []
    clicks_performed = 0
    skipped_unsafe = 0
    skipped_in_form = 0
    skipped_disabled_or_hidden = 0
    failed_clicks = 0
    no_effect_count = 0

    for c in candidates:
        if not c["visible"] or c["disabled"]:
            skipped_disabled_or_hidden += 1
            continue
        if c["inForm"] or c["type"] == "submit":
            skipped_in_form += 1
            continue
        if is_unsafe_to_interact(c["text"], c["ariaLabel"], c["title"], c["name"]):
            skipped_unsafe += 1
            continue
        if clicks_performed >= MAX_CLICKS_PERFORMED:
            continue

        label = describe_control(c["text"], c["ariaLabel"], c["title"], c["name"]) or f'{c["tag"]}#{c["index"]}'
        locator = page.locator(f'[data-fnval-idx="{c["index"]}"]')

        before = _page_signature(page)
        before_network_count = len(session.network_log)
        before_console_count = len(session.console_messages)

        clicks_performed += 1
        try:
            locator.click(timeout=3000)
        except Exception as exc:  # noqa: BLE001
            failed_clicks += 1
            findings.append(
                Finding(
                    id=f"functional-buttons-click-failed-{len(findings) + 1}",
                    category="functional",
                    severity="high",
                    title="Interactive control could not be clicked",
                    description=(
                        f'Control "{label}" looks clickable but the click failed or timed out '
                        f"(it may be covered by another element, or not actually interactive): {exc}"
                    ),
                    evidence={"control": c, "error": str(exc)},
                    recommendation="Check for an overlapping element intercepting clicks, or a missing/broken event handler.",
                    confidence=0.8,
                    source="python-functional",
                )
            )
            continue

        page.wait_for_timeout(SETTLE_MS)
        after = _page_signature(page)

        after_aria_expanded = None
        try:
            after_aria_expanded = page.locator(f'[data-fnval-idx="{c["index"]}"]').get_attribute("aria-expanded")
        except Exception:  # noqa: BLE001
            pass

        changed = (
            before["url"] != after["url"]
            or before["textLength"] != after["textLength"]
            or (c["ariaExpanded"] is not None and c["ariaExpanded"] != after_aria_expanded)
            or len(session.network_log) > before_network_count
            or len(session.console_messages) > before_console_count
        )

        if not changed:
            no_effect_count += 1
            findings.append(
                Finding(
                    id=f"functional-buttons-no-effect-{len(findings) + 1}",
                    category="functional",
                    severity="medium",
                    title="Button appears interactive but produced no observable effect",
                    description=(
                        f'Control "{label}" was clicked successfully but produced no observable change '
                        "(no URL change, no visible text change, no ARIA state change, no network activity). "
                        "This does not necessarily mean it is broken — the effect may be invisible to "
                        "automation — but it is worth a manual check."
                    ),
                    evidence={"control": c, "before": before, "after": after},
                    recommendation="Verify a click handler is attached and does something observable; wire it up if missing.",
                    confidence=0.5,
                    source="python-functional",
                )
            )

    return ValidationResult(
        check="functional",
        findings=findings,
        metrics={
            "controlsFound": len(candidates),
            "controlsClicked": clicks_performed,
            "controlsSkippedUnsafe": skipped_unsafe,
            "controlsSkippedInForm": skipped_in_form,
            "controlsSkippedDisabledOrHidden": skipped_disabled_or_hidden,
            "clicksFailed": failed_clicks,
            "controlsWithNoObservableEffect": no_effect_count,
        },
    )
