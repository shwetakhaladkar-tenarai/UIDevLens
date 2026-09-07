"""
common/safe_interaction.py
The safe-interaction policy shared by every functional validator that
clicks or otherwise exercises a live control (buttons.py, forms.py).

Rule: never click/submit anything whose visible text, aria-label, title, or
name/id suggests a destructive or irreversible action (delete, purchase,
logout, etc.), and never click anything living inside a <form> or a native
submit control — those are inspected/validated only, never triggered.
"""

from __future__ import annotations

# Substring match, case-insensitive, against the control's combined visible
# text/aria-label/title/name. Deliberately broad — false positives here just
# mean a harmless control gets skipped (and reported as skipped, not as a
# finding); false negatives mean something irreversible could get clicked,
# which is the failure mode we must not accept.
UNSAFE_KEYWORDS = (
    "delete",
    "remove",
    "purchase",
    "buy now",
    "buy",
    "pay now",
    "payment",
    "checkout",
    "place order",
    "confirm order",
    "confirm purchase",
    "logout",
    "log out",
    "sign out",
    "signout",
    "unsubscribe",
    "deactivate",
    "close account",
    "cancel subscription",
    "cancel account",
    "cancel membership",
    "empty cart",
    "clear cart",
    "send message",
    "send email",
)


def describe_control(text: str = "", aria_label: str = "", title: str = "", name: str = "") -> str:
    """Combine every identifying string for a control into one label."""
    return " ".join(s for s in (text, aria_label, title, name) if s).strip()


def is_unsafe_to_interact(text: str = "", aria_label: str = "", title: str = "", name: str = "") -> bool:
    """True if this control's identifying text matches a destructive/irreversible action."""
    haystack = describe_control(text, aria_label, title, name).lower()
    if not haystack:
        return False
    return any(keyword in haystack for keyword in UNSAFE_KEYWORDS)
