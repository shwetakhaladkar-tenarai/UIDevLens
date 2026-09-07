"""
runner.py
Single entry point for the custom Python validation engine.

Usage:
  python runner.py '{"url":"https://example.com","checks":["functional"]}'
  python runner.py --input payload.json
  echo '{"url":"https://example.com"}' | python runner.py

Python performs deterministic validation only. It never calls OpenAI.
Node.js / LangGraph remains the orchestration and reasoning layer.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from accessibility import wcag_validator
from common.browser import close_session, open_session
from common.config import VALID_CHECKS, EngineConfig
from common.logger import get_logger
from common.models import RunnerInput, RunnerOutput, ValidationResult
from common.normalization import flatten_results
from design import ui_consistency
from functional import buttons, console_errors, forms, links, navigation, states
from performance import frontend_metrics, load_benchmark
from responsive import cross_browser_validator, responsive_validator

log = get_logger("python-validation.runner")

ValidatorFn = Callable[..., ValidationResult]

CHECK_VALIDATORS: dict[str, list[ValidatorFn]] = {
    "functional": [
        links.validate,
        buttons.validate,
        forms.validate,
        navigation.validate,
        console_errors.validate,
        states.validate,
    ],
    "accessibility": [wcag_validator.validate],
    "responsive": [responsive_validator.validate],
    "cross_browser": [cross_browser_validator.validate],
    "performance": [frontend_metrics.validate, load_benchmark.validate],
    "design": [ui_consistency.validate],
}

# Check groups whose validators use the real shared Chromium session.
CHECKS_NEEDING_BROWSER = {"functional", "accessibility", "design"}


def parse_input(raw: str) -> dict[str, Any]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON input: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("Input JSON must be an object.")
    return data


def read_payload(args: argparse.Namespace) -> dict[str, Any]:
    if args.input:
        return parse_input(Path(args.input).read_text(encoding="utf-8"))
    if args.payload:
        return parse_input(args.payload)
    if not sys.stdin.isatty():
        stdin_raw = sys.stdin.read().strip()
        if stdin_raw:
            return parse_input(stdin_raw)
    raise ValueError(
        "No input provided. Pass JSON as an argument, via --input <file>, or stdin."
    )


def run_validation(payload: dict[str, Any]) -> RunnerOutput:
    if "url" not in payload or not str(payload.get("url", "")).strip():
        return RunnerOutput(
            status="error",
            errors=["Missing required field: url"],
        )

    request = RunnerInput.from_dict(payload)
    config = EngineConfig.from_options(request.options)

    selected = request.checks or list(VALID_CHECKS)
    # Only "functional" and "accessibility" currently use a real browser
    # session — skip launching Chromium entirely when neither is requested.
    needs_browser = any(c in CHECKS_NEEDING_BROWSER for c in selected)
    session = open_session(request.url, config, force_mock=not needs_browser)

    results: list[ValidationResult] = []
    extra_warnings: list[str] = []

    for check in selected:
        if check not in CHECK_VALIDATORS:
            extra_warnings.append(f"Unknown check skipped: {check}")
            continue
        log.info("Running check group '%s' for %s", check, request.url)
        for validator in CHECK_VALIDATORS[check]:
            try:
                results.append(
                    validator(
                        url=request.url,
                        target_type=request.targetType,
                        session=session,
                        config=config,
                    )
                )
            except Exception as exc:  # noqa: BLE001 — surface as structured error
                log.exception("Validator %s failed", validator)
                results.append(
                    ValidationResult(
                        check=check,
                        errors=[f"{validator.__module__}: {exc}"],
                    )
                )

    close_session(session)
    output = flatten_results(results)
    output.warnings = extra_warnings + output.warnings
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Python UI validation engine (deterministic only).")
    parser.add_argument("payload", nargs="?", help="JSON payload string")
    parser.add_argument("--input", "-i", help="Path to a JSON payload file")
    args = parser.parse_args()

    try:
        payload = read_payload(args)
        output = run_validation(payload)
    except Exception as exc:  # noqa: BLE001
        output = RunnerOutput(status="error", errors=[str(exc)])

    json.dump(output.to_dict(), sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0 if output.status != "error" else 1


if __name__ == "__main__":
    raise SystemExit(main())
