"""
common/browser.py
Real Playwright/Chromium browser session, shared across every functional
validator for a single run: one navigation, with console/network/error
listeners attached BEFORE navigation so nothing is missed, plus a live
Page object validators can safely inspect and interact with.

Python still must never call OpenAI from this module.

If Playwright (or a browser binary) isn't available, open_session degrades
to a "mocked" session instead of raising — every validator checks
`session.mocked` and falls back to its own mock_result() in that case, so a
missing dependency never crashes the run, it just returns clearly-labeled
placeholder findings (with a warning) exactly like an unimplemented check.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from common.config import EngineConfig
from common.logger import get_logger

log = get_logger("python-validation.browser")

try:
    from playwright.sync_api import sync_playwright

    _PLAYWRIGHT_IMPORT_ERROR: str | None = None
except Exception as exc:  # noqa: BLE001 — Playwright not installed
    sync_playwright = None  # type: ignore[assignment]
    _PLAYWRIGHT_IMPORT_ERROR = str(exc)


@dataclass
class ConsoleMessage:
    type: str
    text: str
    location: dict[str, Any] = field(default_factory=dict)


@dataclass
class NetworkEntry:
    url: str
    method: str
    status: int | None
    resource_type: str
    ok: bool
    failure: str | None = None


@dataclass
class BrowserSession:
    """A single shared Playwright page for one validation run."""

    url: str
    config: EngineConfig
    mocked: bool = True

    playwright: Any = None
    browser: Any = None
    context: Any = None
    page: Any = None

    console_messages: list[ConsoleMessage] = field(default_factory=list)
    network_log: list[NetworkEntry] = field(default_factory=list)
    page_errors: list[str] = field(default_factory=list)

    main_response_status: int | None = None
    navigation_error: str | None = None
    final_url: str = ""

    def snapshot(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "finalUrl": self.final_url,
            "mocked": self.mocked,
            "viewport": {"width": self.config.viewport_width, "height": self.config.viewport_height},
            "mainResponseStatus": self.main_response_status,
            "navigationError": self.navigation_error,
        }


def _degrade_to_mock(session: BrowserSession, reason: str) -> BrowserSession:
    log.warning("Falling back to a mocked session for %s: %s", session.url, reason)
    session.mocked = True
    session.navigation_error = session.navigation_error or reason
    _teardown(session)
    return session


def open_session(url: str, config: EngineConfig | None = None, *, force_mock: bool = False) -> BrowserSession:
    config = config or EngineConfig()
    session = BrowserSession(url=url, config=config, mocked=True)

    if force_mock:
        # No check in this run needs a real browser (e.g. only still-mocked
        # check groups were requested) — skip launching Chromium entirely.
        log.info("Opening mocked browser session for %s", url)
        return session

    session.mocked = False
    if sync_playwright is None:
        return _degrade_to_mock(session, f"Playwright is not installed ({_PLAYWRIGHT_IMPORT_ERROR})")

    log.info("Launching Chromium for %s", url)
    try:
        session.playwright = sync_playwright().start()
        session.browser = session.playwright.chromium.launch(headless=True)
        session.context = session.browser.new_context(
            viewport={"width": config.viewport_width, "height": config.viewport_height},
            ignore_https_errors=True,
            user_agent="Mozilla/5.0 (compatible; FrontendQualityAnalyzer-PyValidation/1.0)",
        )
        session.page = session.context.new_page()

        # Never let alert()/confirm()/prompt() triggered by a safe click hang
        # the whole run — auto-dismiss every dialog immediately.
        session.page.on("dialog", lambda dialog: dialog.dismiss())

        session.page.on(
            "console",
            lambda msg: session.console_messages.append(
                ConsoleMessage(type=msg.type, text=msg.text, location=dict(msg.location or {}))
            ),
        )
        session.page.on("pageerror", lambda exc: session.page_errors.append(str(exc)))

        def _on_response(response):
            try:
                req = response.request
                session.network_log.append(
                    NetworkEntry(
                        url=response.url,
                        method=req.method,
                        status=response.status,
                        resource_type=req.resource_type,
                        ok=response.ok,
                    )
                )
            except Exception:  # noqa: BLE001 — response may already be gone
                pass

        session.page.on("response", _on_response)

        def _on_request_failed(request):
            try:
                session.network_log.append(
                    NetworkEntry(
                        url=request.url,
                        method=request.method,
                        status=None,
                        resource_type=request.resource_type,
                        ok=False,
                        failure=(request.failure or "unknown failure"),
                    )
                )
            except Exception:  # noqa: BLE001
                pass

        session.page.on("requestfailed", _on_request_failed)

        try:
            response = session.page.goto(url, wait_until="domcontentloaded", timeout=config.timeout_ms)
            session.page.wait_for_timeout(800)  # let late JS/console activity settle
            session.final_url = session.page.url
            if response is not None:
                session.main_response_status = response.status
        except Exception as exc:  # noqa: BLE001 — navigation failure is not fatal to the run
            session.navigation_error = str(exc)
            log.warning("Navigation failed for %s: %s", url, exc)

        return session

    except Exception as exc:  # noqa: BLE001 — could not even launch a browser
        return _degrade_to_mock(session, f"failed to launch browser: {exc}")


def close_session(session: BrowserSession | None) -> None:
    if session is None:
        return
    log.info("Closing browser session for %s", session.url)
    _teardown(session)


def _teardown(session: BrowserSession) -> None:
    for obj in (session.context, session.browser):
        try:
            if obj:
                obj.close()
        except Exception:  # noqa: BLE001 — best-effort cleanup
            pass
    try:
        if session.playwright:
            session.playwright.stop()
    except Exception:  # noqa: BLE001
        pass
    session.context = None
    session.browser = None
    session.page = None
    session.playwright = None
