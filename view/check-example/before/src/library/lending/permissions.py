"""Who may do what in the lending rules.

A member acts on the member page, for the own card only. A librarian acts at the
desk of a branch. The purchase team answers book requests.
"""

from __future__ import annotations

from dataclasses import dataclass

MEMBER = "member"
DESK = "desk"
PURCHASE = "purchase"

ACTIONS: dict[str, set[str]] = {
    "renew_loan": {MEMBER, DESK},
    "lend_copy": {DESK},
    "take_back_copy": {DESK},
    "ask_for_book": {MEMBER, DESK},
    "answer_request": {PURCHASE},
    "reserve_book": {MEMBER, DESK},
}


@dataclass(frozen=True)
class Actor:
    """Who sends a request: a member with a card, or a librarian with a role."""

    role: str
    member_id: int | None = None
    branch_id: str | None = None


def may(actor: Actor, action: str, member_id: int | None = None) -> bool:
    """True when the actor may do the action; a member only for the own card."""
    if actor.role not in ACTIONS.get(action, set()):
        return False
    if actor.role == MEMBER and member_id is not None:
        return actor.member_id == member_id
    return True
