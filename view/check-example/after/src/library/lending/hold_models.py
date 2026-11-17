"""The shapes of holds: what a member asks for, what the service keeps, and what it sends back.

A hold is a place in the line for one book. When a copy of the book comes back,
the first member in the line gets it for a few days. The rules of the line are
in hold_service.py; this file only holds the shapes and their small checks.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from enum import Enum


class HoldState(str, Enum):
    """Where a hold is in its life. The table keeps the same words."""

    WAITING = "waiting"
    PAUSED = "paused"
    READY = "ready"
    COLLECTED = "collected"
    CANCELLED = "cancelled"


# How many days a ready copy waits on the shelf before it goes to the next member.
PICKUP_DAYS = 7

# A member can wait for this many books at the same time.
MAX_HOLDS_PER_MEMBER = 10

# A pause can last this long at most, so that nobody keeps a place for ever.
MAX_PAUSE = timedelta(days=90)

# The branches that lend books. A hold names the branch where the member picks it up.
BRANCHES = ("north", "harbour", "old-town", "station")


class HoldError(Exception):
    """A request that the rules refuse. The message is a sentence for the member."""

    def __init__(self, message: str, field_name: str | None = None) -> None:
        super().__init__(message)
        self.field_name = field_name


def validate_branch(branch_id: str) -> str:
    """Returns the branch in its stored form, or refuses a branch that does not lend books."""
    cleaned = (branch_id or "").strip().lower()
    if not cleaned:
        raise HoldError("Choose the branch where you want to pick up the book.", "branch_id")
    if cleaned not in BRANCHES:
        known = ", ".join(BRANCHES)
        raise HoldError(f"There is no branch called {branch_id!r}. The branches are: {known}.", "branch_id")
    return cleaned


@dataclass(frozen=True)
class PickupRules:
    """When a branch is open for pickups, and how long a ready copy waits there.

    A branch that is closed on a day moves the pickup day on to its next open day,
    so a member always gets the full number of open days to come by.
    """

    branch_id: str
    open_days: frozenset[int] = frozenset({0, 1, 2, 3, 4, 5})
    pickup_days: int = PICKUP_DAYS
    closed_dates: frozenset[date] = frozenset()

    def is_open(self, day: date) -> bool:
        return day.weekday() in self.open_days and day not in self.closed_dates

    def next_open_day(self, day: date) -> date:
        for step in range(1, 15):
            candidate = day + timedelta(days=step)
            if self.is_open(candidate):
                return candidate
        raise HoldError(f"The branch {self.branch_id} has no open day in the next two weeks.")

    def last_pickup_day(self, ready_on: date) -> date:
        day = ready_on
        for _ in range(self.pickup_days):
            day = self.next_open_day(day)
        return day


@dataclass
class HoldRequest:
    """What a member sends to place a hold."""

    member_id: int
    book_id: int
    branch_id: str
    note: str = ""

    def cleaned(self) -> HoldRequest:
        note = self.note.strip()
        if len(note) > 200:
            raise HoldError("A note can have 200 characters at most.", "note")
        return HoldRequest(self.member_id, self.book_id, validate_branch(self.branch_id), note)


@dataclass
class Hold:
    """One hold as the table keeps it."""

    id: int
    member_id: int
    book_id: int
    branch_id: str
    position: int
    placed_at: datetime
    state: HoldState = HoldState.WAITING
    copy_id: int | None = None
    ready_at: datetime | None = None
    pickup_by: date | None = None
    paused_until: date | None = None
    note: str = ""
    revision: int = 1

    @property
    def is_open(self) -> bool:
        return self.state in (HoldState.WAITING, HoldState.PAUSED, HoldState.READY)

    @classmethod
    def from_row(cls, row: dict) -> Hold:
        return cls(
            id=row["id"],
            member_id=row["member_id"],
            book_id=row["book_id"],
            branch_id=row["branch_id"],
            position=row["position"],
            placed_at=row["placed_at"],
            state=HoldState(row["state"]),
            copy_id=row.get("copy_id"),
            ready_at=row.get("ready_at"),
            pickup_by=row.get("pickup_by"),
            paused_until=row.get("paused_until"),
            note=row.get("note") or "",
            revision=row.get("revision", 1),
        )


@dataclass
class OfferCounts:
    """What one night run did with the copies that came back."""

    checked: int = 0
    offered: int = 0
    passed_over: int = 0
    closed_today: bool = False
    hold_ids: list[int] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "checked": self.checked,
            "offered": self.offered,
            "passed_over": self.passed_over,
            "closed_today": self.closed_today,
        }
