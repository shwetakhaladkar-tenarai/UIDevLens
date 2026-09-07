"""
common/config.py
Engine configuration. No AI keys live here — this layer never calls OpenAI.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


VALID_CHECKS = (
    "functional",
    "accessibility",
    "responsive",
    "cross_browser",
    "performance",
    "design",
)

DEFAULT_CHECKS = ("functional", "accessibility", "responsive")

VALID_WCAG_LEVELS = ("A", "AA")
DEFAULT_WCAG_LEVEL = "AA"

VALID_BROWSERS = ("chromium", "firefox", "webkit")
DEFAULT_BROWSERS = ("chromium",)

DEFAULT_VIEWPORTS = {
    "desktop": {"width": 1440, "height": 900},
    "tablet":  {"width": 768,  "height": 1024},
    "mobile":  {"width": 390,  "height": 844},
}

# Load-testing safety caps — enforced regardless of what a caller configures.
# performance/load_benchmark.py NEVER runs at all unless BOTH enabled AND
# approved are explicitly true (see that module for the full policy).
MAX_LOAD_TEST_USER_LEVELS = 6
MAX_LOAD_TEST_CONCURRENT_USERS = 1000
MAX_LOAD_TEST_TOTAL_DURATION_SECONDS = 60
MIN_LOAD_TEST_DURATION_SECONDS = 1
DEFAULT_LOAD_TEST_USERS = (10, 50, 100)
DEFAULT_LOAD_TEST_DURATION_SECONDS = 10
DEFAULT_LOAD_TEST_THRESHOLDS = {"p95ResponseTimeMs": 2000, "errorRatePercent": 1.0}


@dataclass
class EngineConfig:
    """Runtime options passed from the Node/LangGraph orchestrator."""

    timeout_ms: int = 30_000
    viewport_width: int = 1280
    viewport_height: int = 720
    # Configurable WCAG conformance target for accessibility/wcag_validator.py.
    # Driven end-to-end by the selected rule profile's `accessibility.level`
    # (see rule-profiles/*.json + backend pythonValidationNode) — never
    # hardcoded in the validator itself.
    wcag_level: str = DEFAULT_WCAG_LEVEL
    # Which browser engines responsive/cross_browser_validator.py should test.
    # Driven end-to-end by the selected rule profile's `browsers` array —
    # never hardcoded in the validator itself.
    browsers: tuple[str, ...] = DEFAULT_BROWSERS
    # Named viewports responsive/responsive_validator.py (and cross-browser
    # checks) test against. Driven end-to-end by the selected rule profile's
    # `viewports` object (rule-profiles/*.json) — never hardcoded here.
    viewports: dict[str, dict[str, int]] = field(default_factory=lambda: dict(DEFAULT_VIEWPORTS))
    # Concurrent-user load-test configuration for performance/load_benchmark.py.
    # Driven end-to-end by the selected rule profile's `performance.loadTest`
    # object — defaults to disabled; see that module for the safety policy.
    load_test: dict[str, Any] = field(default_factory=lambda: {"enabled": False, "approved": False})
    extra: dict[str, Any] = field(default_factory=dict)

    @staticmethod
    def from_options(options: dict[str, Any] | None) -> "EngineConfig":
        options = options or {}
        known_keys = ("timeout_ms", "viewport_width", "viewport_height")
        known = {k: v for k, v in options.items() if k in known_keys}

        wcag_level = str(options.get("wcagLevel", DEFAULT_WCAG_LEVEL)).upper()
        if wcag_level not in VALID_WCAG_LEVELS:
            wcag_level = DEFAULT_WCAG_LEVEL

        raw_browsers = options.get("browsers")
        if isinstance(raw_browsers, list) and raw_browsers:
            browsers = tuple(dict.fromkeys(b for b in raw_browsers if b in VALID_BROWSERS))
        else:
            browsers = ()
        if not browsers:
            browsers = DEFAULT_BROWSERS

        viewports = _sanitize_viewports(options.get("viewports"))
        load_test = _sanitize_load_test(options.get("loadTest"))

        extra = {
            k: v for k, v in options.items()
            if k not in known_keys and k not in ("wcagLevel", "browsers", "viewports", "loadTest")
        }
        return EngineConfig(
            **known, wcag_level=wcag_level, browsers=browsers, viewports=viewports,
            load_test=load_test, extra=extra,
        )


def _sanitize_viewports(raw: Any) -> dict[str, dict[str, int]]:
    """Validate a rule profile's `viewports` object; fall back to defaults
    (per-entry) for anything missing or malformed rather than failing the run."""
    if not isinstance(raw, dict) or not raw:
        return dict(DEFAULT_VIEWPORTS)

    sanitized: dict[str, dict[str, int]] = {}
    for name, dims in raw.items():
        if isinstance(dims, dict) and isinstance(dims.get("width"), (int, float)) and isinstance(dims.get("height"), (int, float)):
            sanitized[name] = {"width": int(dims["width"]), "height": int(dims["height"])}
    return sanitized or dict(DEFAULT_VIEWPORTS)


def _sanitize_load_test(raw: Any) -> dict[str, Any]:
    """
    Validate a rule profile's `performance.loadTest` object. `enabled` and
    `approved` must BOTH be the literal boolean `true` — anything else
    (missing, string "true", 1, etc.) is treated as false. This is the
    config-level half of the safety gate; load_benchmark.py re-checks both
    flags itself before doing anything, so a bug here can't silently enable
    load testing.
    """
    if not isinstance(raw, dict):
        return {"enabled": False, "approved": False}

    users_raw = raw.get("users")
    users: list[int] = []
    if isinstance(users_raw, list):
        for u in users_raw:
            if isinstance(u, (int, float)) and not isinstance(u, bool) and u > 0:
                users.append(min(int(u), MAX_LOAD_TEST_CONCURRENT_USERS))
    users = users[:MAX_LOAD_TEST_USER_LEVELS] or list(DEFAULT_LOAD_TEST_USERS)

    duration = raw.get("durationSeconds", DEFAULT_LOAD_TEST_DURATION_SECONDS)
    if not isinstance(duration, (int, float)) or isinstance(duration, bool) or duration <= 0:
        duration = DEFAULT_LOAD_TEST_DURATION_SECONDS

    thresholds_raw = raw.get("thresholds") if isinstance(raw.get("thresholds"), dict) else {}
    thresholds = dict(DEFAULT_LOAD_TEST_THRESHOLDS)
    for key in ("p95ResponseTimeMs", "errorRatePercent"):
        val = thresholds_raw.get(key)
        if isinstance(val, (int, float)) and not isinstance(val, bool) and val >= 0:
            thresholds[key] = val

    return {
        "enabled": raw.get("enabled") is True,
        "approved": raw.get("approved") is True,
        "users": users,
        "durationSeconds": duration,
        "thresholds": thresholds,
    }
