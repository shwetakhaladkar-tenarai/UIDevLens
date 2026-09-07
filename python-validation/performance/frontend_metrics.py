"""Placeholder: frontend performance metrics (LCP, CLS, etc.)."""

from common.models import ValidationResult, mock_result


def validate(url: str, **_kwargs) -> ValidationResult:
    return mock_result(
        check="performance",
        source="frontend_metrics",
        category="performance",
        title="Frontend metrics (mocked)",
        description=f"Would collect frontend performance metrics for {url}.",
        metrics={"lcpMs": None, "cls": None, "mocked": True},
    )
