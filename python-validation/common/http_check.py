"""
common/http_check.py
Shared, side-effect-free HTTP reachability + redirect-chain checking used by
functional/links.py and functional/navigation.py.

Uses Playwright's APIRequestContext (session.context.request) — never a
full page navigation — so checking a link's status can never execute the
target page's JavaScript, trigger downloads, or navigate the browser away
from the page under test.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from urllib.parse import urljoin, urlparse

from common.logger import get_logger

log = get_logger("python-validation.http_check")

MAX_REDIRECT_HOPS = 5
# HEAD is rejected by some servers — retry with GET when we see this.
HEAD_NOT_ALLOWED = (405, 501)


@dataclass
class LinkCheckResult:
    url: str
    ok: bool
    status: int | None
    error: str | None = None
    redirect_chain: list[dict] = field(default_factory=list)  # [{url, status}, ...]
    redirect_broken: bool = False


def is_checkable_url(href: str) -> bool:
    """True for hrefs we can safely issue an HTTP request against."""
    if not href:
        return False
    href = href.strip()
    if not href or href.startswith("#"):
        return False
    scheme = urlparse(href).scheme
    return scheme in ("", "http", "https")


def resolve_url(href: str, base_url: str) -> str:
    return urljoin(base_url, href)


def is_internal(url: str, base_url: str) -> bool:
    return urlparse(url).netloc == urlparse(base_url).netloc


def check_link(request_context, url: str, timeout_ms: int = 8000) -> LinkCheckResult:
    """
    Resolve a URL's reachability, following redirects manually (one hop at a
    time, never auto-following) up to MAX_REDIRECT_HOPS. This lets us tell a
    simple broken link apart from a broken/looping REDIRECT CHAIN.
    """
    chain: list[dict] = []
    current = url
    seen: set[str] = set()

    for _ in range(MAX_REDIRECT_HOPS + 1):
        if current in seen:
            return LinkCheckResult(
                url=url, ok=False, status=None,
                error="Redirect loop detected", redirect_chain=chain, redirect_broken=True,
            )
        seen.add(current)

        try:
            resp = request_context.head(current, timeout=timeout_ms, max_redirects=0)
            status = resp.status
            headers = resp.headers
            if status in HEAD_NOT_ALLOWED:
                resp = request_context.get(current, timeout=timeout_ms, max_redirects=0)
                status = resp.status
                headers = resp.headers
        except Exception as exc:  # noqa: BLE001 — network/timeout errors surface as findings
            return LinkCheckResult(
                url=url, ok=False, status=None, error=str(exc),
                redirect_chain=chain, redirect_broken=bool(chain),
            )

        chain.append({"url": current, "status": status})

        if 300 <= status < 400:
            location = headers.get("location")
            if not location:
                return LinkCheckResult(
                    url=url, ok=False, status=status,
                    error="Redirect response had no Location header",
                    redirect_chain=chain, redirect_broken=True,
                )
            current = urljoin(current, location)
            continue

        ok = status < 400
        return LinkCheckResult(
            url=url,
            ok=ok,
            status=status,
            error=None if ok else f"HTTP {status}",
            redirect_chain=chain,
            redirect_broken=(not ok and len(chain) > 1),
        )

    return LinkCheckResult(
        url=url, ok=False, status=None, error="Too many redirects",
        redirect_chain=chain, redirect_broken=True,
    )
