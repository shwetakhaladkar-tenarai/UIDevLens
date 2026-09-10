"""
performance/load_benchmark.py
Concurrent-user / load benchmarking — deterministic, config-gated.

SAFETY POLICY — read before changing this file:
  This module sends REAL concurrent HTTP requests at the target URL. It
  MUST NOT run automatically against arbitrary URLs. It requires BOTH of
  the following to be the literal boolean `true` in the selected rule
  profile's `performance.loadTest`:

    enabled:  true   — the operator wants load testing considered at all
    approved: true   — the operator explicitly attests they are authorized
                        to run a concurrent load test against this exact
                        target (their own staging/production environment,
                        or a target they otherwise have permission to test)

  If either flag is missing or not exactly `true`, this module returns
  immediately without sending a single request. `common/config.py`
  (`_sanitize_load_test`) already coerces malformed/missing config to
  disabled — this module re-checks both flags itself regardless, so a bug
  upstream can never silently enable a load test.

  Running a concurrent load test against a third party's site without their
  authorization can degrade or disrupt their service and may violate their
  terms of service or applicable law. `approved: true` is the operator's
  attestation that this target is theirs to test (or they otherwise have
  permission) — this module does not and cannot verify that externally.

  Even when approved, hard caps below bound scale/duration regardless of
  configuration, so a misconfigured profile (e.g. durationSeconds: 3600)
  can never turn into a runaway, multi-hour test.

Thresholds (p95ResponseTimeMs, errorRatePercent) are compared IN PYTHON,
deterministically — OpenAI is never involved in deciding pass/fail here.
"""

from __future__ import annotations

import math
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from common.config import (
    MAX_LOAD_TEST_TOTAL_DURATION_SECONDS,
    MIN_LOAD_TEST_DURATION_SECONDS,
)
from common.logger import get_logger
from common.models import Finding, ValidationResult

log = get_logger("python-validation.performance.load_benchmark")

PER_REQUEST_TIMEOUT_SECONDS = 10
USER_AGENT = "FrontendQualityAnalyzer-LoadBenchmark/1.0"


def _finding(finding_id: str, severity: str, title: str, description: str,
             recommendation: str, evidence: dict, confidence: float, threshold=None) -> Finding:
    return Finding(
        id=finding_id,
        category="performance",
        severity=severity,
        title=title,
        description=description,
        evidence=evidence,
        recommendation=recommendation,
        confidence=confidence,
        source="python-load-benchmark",
        threshold=threshold,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Load generation — stdlib only (urllib + threads), no new dependency
# ─────────────────────────────────────────────────────────────────────────────

def _request_once(url: str) -> tuple[float, bool]:
    """One request. Returns (elapsed_ms, ok). Never raises."""
    start = time.monotonic()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=PER_REQUEST_TIMEOUT_SECONDS) as resp:
            resp.read(2048)  # drain a little; we don't need the full body
            status = resp.status
        elapsed_ms = (time.monotonic() - start) * 1000
        return elapsed_ms, 200 <= status < 400
    except urllib.error.HTTPError as exc:
        elapsed_ms = (time.monotonic() - start) * 1000
        return elapsed_ms, 200 <= exc.code < 400
    except Exception:  # noqa: BLE001 — connection errors, timeouts, DNS, etc.
        elapsed_ms = (time.monotonic() - start) * 1000
        return elapsed_ms, False


def _virtual_user_loop(url: str, deadline: float, out: list, lock: threading.Lock) -> None:
    while time.monotonic() < deadline:
        elapsed_ms, ok = _request_once(url)
        with lock:
            out.append((elapsed_ms, ok))


def _run_level(url: str, concurrent_users: int, duration_seconds: float) -> list[tuple[float, bool]]:
    results: list[tuple[float, bool]] = []
    lock = threading.Lock()
    deadline = time.monotonic() + duration_seconds

    with ThreadPoolExecutor(max_workers=concurrent_users) as executor:
        futures = [
            executor.submit(_virtual_user_loop, url, deadline, results, lock)
            for _ in range(concurrent_users)
        ]
        for f in futures:
            f.result()

    return results


def _metrics_from_results(results: list[tuple[float, bool]]) -> dict:
    if not results:
        return {"avgResponseTimeMs": 0, "p95ResponseTimeMs": 0, "errorRatePercent": 0.0, "requestCount": 0, "errorCount": 0}

    times = sorted(t for t, _ in results)
    n = len(times)
    errors = sum(1 for _, ok in results if not ok)
    p95_index = min(n - 1, math.ceil(0.95 * n) - 1)

    return {
        "avgResponseTimeMs": round(sum(times) / n, 1),
        "p95ResponseTimeMs": round(times[p95_index], 1),
        "errorRatePercent": round((errors / n) * 100, 2),
        "requestCount": n,
        "errorCount": errors,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Deterministic threshold checking — never delegated to the AI layer
# ─────────────────────────────────────────────────────────────────────────────

def check_thresholds(user_count: int, metrics: dict, thresholds: dict) -> list[Finding]:
    findings: list[Finding] = []

    p95_threshold = thresholds.get("p95ResponseTimeMs")
    if isinstance(p95_threshold, (int, float)) and metrics["p95ResponseTimeMs"] > p95_threshold:
        p95 = metrics["p95ResponseTimeMs"]
        findings.append(_finding(
            f"load-benchmark-p95-{user_count}",
            "high" if p95 > p95_threshold * 1.5 else "medium",
            f"P95 response time exceeds threshold at {user_count} concurrent users",
            f"P95 response time was {p95}ms at {user_count} concurrent users, exceeding the "
            f"configured threshold of {p95_threshold}ms.",
            "Investigate performance under load — database query times, caching, connection/thread "
            "pool sizing, and autoscaling configuration are common culprits.",
            {"userCount": user_count, "p95ResponseTimeMs": p95, "thresholdMs": p95_threshold},
            0.9,
            threshold=p95_threshold,
        ))

    error_threshold = thresholds.get("errorRatePercent")
    if isinstance(error_threshold, (int, float)) and metrics["errorRatePercent"] > error_threshold:
        rate = metrics["errorRatePercent"]
        findings.append(_finding(
            f"load-benchmark-errorrate-{user_count}",
            "high" if rate > error_threshold * 2 else "medium",
            f"Error rate exceeds threshold at {user_count} concurrent users",
            f"Error rate was {rate}% at {user_count} concurrent users, exceeding the configured "
            f"threshold of {error_threshold}%.",
            "Investigate failed requests under load — timeouts, exhausted connection pools, and "
            "server errors (5xx) under concurrency are common causes.",
            {"userCount": user_count, "errorRatePercent": rate, "thresholdPercent": error_threshold, "errorCount": metrics["errorCount"]},
            0.9,
            threshold=error_threshold,
        ))

    return findings


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def run_load_test(url: str, load_test_config: dict) -> dict:
    """
    Run the configured load test and return exactly:
      {"<userCount>": {"avgResponseTimeMs", "p95ResponseTimeMs", "errorRatePercent"}, ...}
    (plus requestCount/errorCount per level, additive).

    Caller (validate()) is responsible for the enabled/approved gate — this
    function assumes it has already been cleared to run.
    """
    users = load_test_config.get("users") or []
    configured_duration = load_test_config.get("durationSeconds", 10)

    # Hard ceiling on TOTAL wall-clock time across all levels, regardless of
    # configuration — distribute the budget evenly so more levels means a
    # shorter test per level, never a longer total run.
    num_levels = max(1, len(users))
    duration_per_level = min(configured_duration, MAX_LOAD_TEST_TOTAL_DURATION_SECONDS / num_levels)
    duration_per_level = max(MIN_LOAD_TEST_DURATION_SECONDS, duration_per_level)

    results_by_user_count: dict[str, dict] = {}
    for user_count in users:
        log.info("Load testing %s at %d concurrent users for %.1fs", url, user_count, duration_per_level)
        raw_results = _run_level(url, user_count, duration_per_level)
        results_by_user_count[str(user_count)] = _metrics_from_results(raw_results)

    return results_by_user_count


def validate(url: str, session=None, config=None, **_kwargs) -> ValidationResult:
    load_test_config = getattr(config, "load_test", None) if config is not None else None
    load_test_config = load_test_config or {"enabled": False, "approved": False}

    enabled = load_test_config.get("enabled") is True
    approved = load_test_config.get("approved") is True

    if not enabled:
        return ValidationResult(
            check="performance",
            metrics={"loadTest": {"executed": False, "reason": "disabled (performance.loadTest.enabled is not true)"}},
        )

    if not approved:
        log.warning("Load test requested (enabled=true) but NOT approved — skipping. Never load-test without explicit approval.")
        return ValidationResult(
            check="performance",
            warnings=[
                "Load testing was enabled but not explicitly approved (performance.loadTest.approved "
                "must be exactly `true`) — skipped. Load tests are never run without explicit, "
                "per-target authorization."
            ],
            metrics={"loadTest": {"executed": False, "reason": "not approved (performance.loadTest.approved is not true)"}},
        )

    # Both gates cleared — this target has been explicitly enabled AND
    # approved for load testing by whoever configured the rule profile.
    try:
        results = run_load_test(url, load_test_config)
    except Exception as exc:  # noqa: BLE001
        return ValidationResult(check="performance", errors=[f"load_benchmark: failed to run load test: {exc}"])

    thresholds = load_test_config.get("thresholds") or {}
    findings: list[Finding] = []
    for user_count in load_test_config.get("users", []):
        metrics = results.get(str(user_count))
        if metrics:
            findings.extend(check_thresholds(user_count, metrics, thresholds))

    return ValidationResult(
        check="performance",
        findings=findings,
        metrics={
            "loadTest": {
                "executed": True,
                "usersTested": load_test_config.get("users", []),
                "durationSecondsRequested": load_test_config.get("durationSeconds"),
                "thresholds": thresholds,
                "results": results,
            }
        },
    )
