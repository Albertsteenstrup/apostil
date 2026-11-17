"""The ready shelf of a branch: the copies that wait for their member, for the desk screen and the board of the morning.

The night run puts a copy on the ready shelf when it offers it. The desk sees each
copy with its member and its last pickup day, the nearest day first, and can give a
copy to the next member when its member said that they will not come.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from library.lending.hold_service import HoldService
from library.lending.permissions import Actor, may_see_shelf
from library.lending.queue import Database

SHELF_SQL = """
    select h.id as hold_id, h.copy_id, h.member_id, m.name as member_name, m.email as member_email,
           b.title, b.author, h.ready_at, h.pickup_by
    from book_hold h
    join member m on m.id = h.member_id
    join book_copy c on c.id = h.copy_id
    join book b on b.id = c.book_id
    where h.state = 'ready' and h.branch_id = %(branch)s
    order by h.pickup_by, h.ready_at
"""


@dataclass
class ShelfItem:
    """One copy on the ready shelf, with the member it waits for."""

    hold_id: int
    copy_id: int
    member_id: int
    member_name: str
    member_email: str | None
    title: str
    author: str
    ready_at: datetime
    pickup_by: date

    @property
    def ready_on(self) -> date:
        return self.ready_at.date()

    def days_left(self, today: date) -> int:
        return (self.pickup_by - today).days

    def as_dict(self, today: date) -> dict:
        return {
            "hold_id": self.hold_id,
            "copy_id": self.copy_id,
            "member": self.member_name,
            "has_mail": bool(self.member_email),
            "title": self.title,
            "author": self.author,
            "ready_on": self.ready_on.isoformat(),
            "pickup_by": self.pickup_by.isoformat(),
            "days_left": self.days_left(today),
        }


def ready_shelf_of(db: Database, branch_id: str) -> list[ShelfItem]:
    """The copies on the ready shelf of one branch, the nearest last pickup day first."""
    return [ShelfItem(**row) for row in db.fetch_all(SHELF_SQL, {"branch": branch_id})]


def shelf_for_desk(service: HoldService, actor: Actor, branch_id: str, today: date) -> dict:
    """What the desk screen shows: the shelf, how many copies have their last day today, and the members with no mail."""
    if not may_see_shelf(actor, branch_id):
        raise PermissionError("The ready shelf of a branch is for its desk only.")
    items = ready_shelf_of(service.db, branch_id)
    return {
        "branch": branch_id,
        "items": [item.as_dict(today) for item in items],
        "last_day_today": sum(1 for item in items if item.days_left(today) == 0),
        "without_mail": [item.member_name for item in items if not item.member_email],
    }


def give_to_next(service: HoldService, actor: Actor, hold_id: int, today: date) -> dict:
    """The member said that they will not come: the hold goes to the end of its line, and the copy is offered again tonight."""
    hold = service.get(hold_id)
    if not may_see_shelf(actor, hold.branch_id):
        raise PermissionError("Only the desk of the branch can give this copy to the next member.")
    moved = service._back_in_line(hold)
    return {"hold_id": moved.id, "state": moved.state.value, "offered_again_on": today.isoformat()}
