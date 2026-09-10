"""
common/models.py
Shared data models for the Python validation engine.
All validators produce Finding and Metric objects — never AI decisions.
"""

from __future__ import annotations
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class Severity(str, Enum):
    CRITICAL = "critical"
    HIGH     = "high"
    MEDIUM   = "medium"
    LOW      = "low"
    INFO     = "info"


class Category(str, Enum):
    FUNCTIONAL     = "functional"
    ACCESSIBILITY  = "accessibility"
    RESPONSIVE     = "responsive"
    CROSS_BROWSER  = "cross-browser"
    PERFORMANCE    = "performance"
    UI_CONSISTENCY = "ui-consistency"


class CheckType(str, Enum):
    FUNCTIONAL    = "functional"
    ACCESSIBILITY = "accessibility"
    RESPONSIVE    = "responsive"
    PERFORMANCE   = "performance"
    DESIGN        = "design"


# ---------------------------------------------------------------------------
# Core data structures
# ---------------------------------------------------------------------------

@dataclass
class Finding:
    """
    A single deterministic validation finding. No AI content here.

    Canonical shape (every field below is always present on to_dict(),
    None when not applicable to this finding):
      id, category, severity, title, description, evidence, confidence,
      source, browser, viewport, standard, rule, threshold
    """
    id:             str
    category:       str          # Category enum value
    severity:       str          # Severity enum value
    title:          str
    description:    str
    evidence:       dict[str, Any] = field(default_factory=dict)
    recommendation: str          = ""
    confidence:     float        = 1.0   # 0-1, based on measurement certainty
    source:         str          = ""    # e.g. "links", "wcag_validator"
    mocked:         bool         = False # True while real validation not yet implemented
    # Expanded-architecture fields — all optional, None when not applicable.
    browser:        str | None   = None  # e.g. "chromium" | "firefox" | "webkit"
    viewport:       str | None   = None  # e.g. "desktop" | "tablet" | "mobile"
    standard:       str | None   = None  # e.g. "WCAG"
    rule:           str | None   = None  # e.g. "WCAG 1.1.1 Non-text Content"
    threshold:      Any | None   = None  # the configured threshold this finding violated

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Metric:
    """A named numeric measurement."""
    name:  str
    value: Any
    unit:  str  = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ValidationResult:
    """The return value from every individual validator module."""
    check:    str                      # CheckType value
    findings: list[Finding]            = field(default_factory=list)
    metrics:  dict[str, Any]           = field(default_factory=dict)
    warnings: list[str]                = field(default_factory=list)
    errors:   list[str]                = field(default_factory=list)
    mocked:   bool                     = False

    def to_dict(self) -> dict:
        return {
            "check":    self.check,
            "findings": [f.to_dict() for f in self.findings],
            "metrics":  self.metrics,
            "warnings": self.warnings,
            "errors":   self.errors,
            "mocked":   self.mocked,
        }


@dataclass
class RunnerInput:
    """Parsed and validated runner input."""
    url:        str
    targetType: str                  = "standard-web"
    checks:     list[str]            = field(default_factory=lambda: ["functional"])
    options:    dict[str, Any]       = field(default_factory=dict)

    @staticmethod
    def from_dict(data: dict) -> "RunnerInput":
        return RunnerInput(
            url        = data["url"],
            targetType = data.get("targetType", "standard-web"),
            checks     = data.get("checks", ["functional"]),
            options    = data.get("options", {}),
        )


@dataclass
class RunnerOutput:
    """Top-level output structure returned as JSON."""
    status:   str                    = "success"   # "success" | "partial" | "error"
    findings: list[dict]             = field(default_factory=list)
    metrics:  dict[str, Any]         = field(default_factory=dict)
    warnings: list[str]              = field(default_factory=list)
    errors:   list[str]              = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "status":   self.status,
            "findings": self.findings,
            "metrics":  self.metrics,
            "warnings": self.warnings,
            "errors":   self.errors,
        }


def mock_finding(
    *,
    source: str,
    category: str,
    title: str,
    description: str,
    severity: str = "info",
    evidence: dict[str, Any] | None = None,
) -> Finding:
    """Placeholder finding used until real deterministic checks are implemented."""
    return Finding(
        id=f"mock-{source}",
        category=category,
        severity=severity,
        title=title,
        description=description,
        evidence=evidence or {"placeholder": True},
        recommendation="Real validation not implemented yet.",
        confidence=0.0,
        source=source,
        mocked=True,
    )


def mock_result(
    check: str,
    source: str,
    category: str,
    title: str,
    description: str,
    metrics: dict[str, Any] | None = None,
) -> ValidationResult:
    return ValidationResult(
        check=check,
        findings=[
            mock_finding(
                source=source,
                category=category,
                title=title,
                description=description,
            )
        ],
        metrics=metrics or {"mocked": True, "source": source},
        warnings=[f"{source} is a placeholder; no real validation ran."],
        errors=[],
        mocked=True,
    )
