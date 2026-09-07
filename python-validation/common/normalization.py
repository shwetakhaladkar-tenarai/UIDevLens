"""
common/normalization.py
Deterministic merge of validator outputs into a single evidence payload.
Does not rank or interpret findings with AI.
"""

from __future__ import annotations

from typing import Iterable

from common.models import Finding, RunnerOutput, ValidationResult


def flatten_results(results: Iterable[ValidationResult]) -> RunnerOutput:
    findings: list[dict] = []
    metrics: dict = {}
    warnings: list[str] = []
    errors: list[str] = []
    had_error = False
    had_success = False

    for result in results:
        findings.extend(f.to_dict() if isinstance(f, Finding) else f for f in result.findings)
        if result.metrics:
            metrics[result.check] = {**metrics.get(result.check, {}), **result.metrics}
        warnings.extend(result.warnings)
        errors.extend(result.errors)
        if result.errors:
            had_error = True
        else:
            had_success = True

    if had_error and had_success:
        status = "partial"
    elif had_error and not had_success:
        status = "error"
    else:
        status = "success"

    return RunnerOutput(
        status=status,
        findings=findings,
        metrics=metrics,
        warnings=warnings,
        errors=errors,
    )
