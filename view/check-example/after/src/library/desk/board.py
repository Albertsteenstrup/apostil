"""The board of the desk: what each branch should do in the morning.

The board reads the database once and groups the work by kind. The desk screen
draws it, and the desk summary of the night run counts it.
"""

from __future__ import annotations

from datetime import date, timedelta

from library.desk.models import DeskBoard, DeskTask
from library.lending.queue import Database
from library.lending.ready_shelf import ready_shelf_of

# A copy that has been lost for this long is no longer on the board.
LOST_FOR = timedelta(days=60)

# A ready copy is on the board as "call the member" this many days before its last pickup day.
CALL_BEFORE = timedelta(days=2)


def board_for(db: Database, branch_id: str, today: date) -> DeskBoard:
    """The board of one branch for one day."""
    board = DeskBoard(branch_id, today)
    for row in db.fetch_all(
        "select l.member_id, l.copy_id, l.due_on, b.title from loan l join book_copy c on c.id = l.copy_id join book b on b.id = c.book_id where l.returned_at is null and l.overdue and c.branch_id = %(branch)s order by l.due_on",
        {"branch": branch_id},
    ):
        board.add(DeskTask("overdue", f"{row['title']} is overdue since {row['due_on']:%d %B}", row["member_id"], row["copy_id"], row["due_on"]))
    for row in db.fetch_all(
        "select c.id, b.title, c.returned_at from book_copy c join book b on b.id = c.book_id where c.state = 'lost' and c.branch_id = %(branch)s and c.returned_at > %(since)s",
        {"branch": branch_id, "since": today - LOST_FOR},
    ):
        board.add(DeskTask("lost", f"{row['title']} is lost", copy_id=row["id"]))
    for item in ready_shelf_of(db, branch_id):
        if item.pickup_by - today <= CALL_BEFORE and not item.member_email:
            board.add(DeskTask("call_member", f"Call {item.member_name}: {item.title} waits until {item.pickup_by:%d %B}", item.member_id, item.copy_id, item.ready_on))
    return board


def boards_for(db: Database, branches: list[str], today: date) -> list[DeskBoard]:
    return [board_for(db, branch_id, today) for branch_id in branches]
