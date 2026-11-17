"""The rules of holds.

A member places a hold on a book that is out. The holds of one book form a line,
the oldest first. Each night the night job asks this service to offer the copies
that came back: the first member in the line gets the copy for a few open days.
A member who does not come in time goes back to the end of the line.

The web routes, the night job and the desk screen all go through this service,
so the rules live in one place.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from library.lending.hold_models import (
    MAX_HOLDS_PER_MEMBER,
    MAX_PAUSE,
    Hold,
    HoldError,
    HoldRequest,
    HoldState,
    OfferCounts,
    PickupRules,
)
from library.lending.notices import NoticeError, Notices
from library.lending.queue import Database

log = logging.getLogger(__name__)

HOLD_COLUMNS = "id, member_id, book_id, branch_id, position, placed_at, state, copy_id, ready_at, pickup_by, paused_until, note, revision"

SELECT_HOLD = f"select {HOLD_COLUMNS} from book_hold where id = %(id)s"

SELECT_LINE = f"""
    select {HOLD_COLUMNS}
    from book_hold
    where book_id = %(book_id)s and state in ('waiting', 'paused', 'ready')
    order by position
"""


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class HoldService:
    """Places, changes and offers holds. One instance serves one request or one night run."""

    def __init__(self, db: Database, clock, members, notices: Notices, hours) -> None:
        self.db = db
        self.clock = clock
        self.members = members
        self.notices = notices
        self.hours = hours

    # ----- reading -----

    def get(self, hold_id: int) -> Hold:
        row = self.db.fetch_one(SELECT_HOLD, {"id": hold_id})
        if row is None:
            raise HoldError(f"There is no hold {hold_id}.")
        return Hold.from_row(row)

    def holds_of(self, member_id: int) -> list[Hold]:
        rows = self.db.fetch_all(
            f"select {HOLD_COLUMNS} from book_hold where member_id = %(member_id)s and state in ('waiting', 'paused', 'ready') order by placed_at",
            {"member_id": member_id},
        )
        return [Hold.from_row(row) for row in rows]

    def line_for(self, book_id: int) -> list[Hold]:
        return [Hold.from_row(row) for row in self.db.fetch_all(SELECT_LINE, {"book_id": book_id})]

    def place_in_line(self, hold: Hold) -> int:
        """The place of a waiting hold in its line, counted from 1. A paused hold keeps its place but is passed over."""
        waiting = [one for one in self.line_for(hold.book_id) if one.state == HoldState.WAITING]
        for place, one in enumerate(waiting, start=1):
            if one.id == hold.id:
                return place
        return 0

    # ----- placing and changing a hold -----

    def place_hold(self, request: HoldRequest) -> Hold:
        """Puts the member at the end of the line for the book."""
        request = request.cleaned()
        member = self.members.find(request.member_id)
        if member is None or not member.active:
            raise HoldError("Only a member with an active card can place a hold.")
        open_holds = self.holds_of(request.member_id)
        if len(open_holds) >= MAX_HOLDS_PER_MEMBER:
            raise HoldError(f"You can wait for {MAX_HOLDS_PER_MEMBER} books at the same time. Cancel a hold to place a new one.")
        if any(hold.book_id == request.book_id for hold in open_holds):
            raise HoldError("You are already in the line for this book.")
        if self.db.fetch_value("select count(*) from book_copy where book_id = %(book_id)s and state = 'on_shelf'", {"book_id": request.book_id}):
            raise HoldError("A copy is on the shelf now. You can borrow it at the desk.")
        position = self.db.fetch_value(
            "select coalesce(max(position), 0) + 1 from book_hold where book_id = %(book_id)s",
            {"book_id": request.book_id},
        )
        row = self.db.fetch_one(
            f"insert into book_hold (member_id, book_id, branch_id, position, placed_at, state, note) values (%(member_id)s, %(book_id)s, %(branch_id)s, %(position)s, %(placed_at)s, 'waiting', %(note)s) returning {HOLD_COLUMNS}",
            {
                "member_id": request.member_id,
                "book_id": request.book_id,
                "branch_id": request.branch_id,
                "position": position,
                "placed_at": now_utc(),
                "note": request.note,
            },
        )
        hold = Hold.from_row(row)
        self._log_event(hold, "placed", None, HoldState.WAITING)
        return hold

    def pause_hold(self, hold_id: int, until: date) -> Hold:
        """Keeps the place in the line, but passes the hold over until the given day."""
        hold = self.get(hold_id)
        if hold.state != HoldState.WAITING:
            raise HoldError("Only a hold that waits can be paused.")
        if until <= self.clock.today():
            raise HoldError("Choose a day after today.", "until")
        if until - self.clock.today() > MAX_PAUSE:
            raise HoldError(f"A pause can last {MAX_PAUSE.days} days at most.", "until")
        return self._change_state(hold, HoldState.PAUSED, paused_until=until)

    def resume_hold(self, hold_id: int) -> Hold:
        """Takes the pause away. The hold waits again at the place it kept."""
        hold = self.get(hold_id)
        if hold.state != HoldState.PAUSED:
            raise HoldError("This hold is not paused.")
        return self._change_state(hold, HoldState.WAITING, paused_until=None)

    def _change_state(self, hold: Hold, to: HoldState, **fields) -> Hold:
        """Writes a new state with the revision of the hold, so two changes at the same time cannot both win."""
        names = ", ".join(f"{name} = %({name})s" for name in fields)
        row = self.db.fetch_one(
            f"update book_hold set state = %(state)s, revision = revision + 1{', ' + names if names else ''} "
            f"where id = %(id)s and revision = %(revision)s returning {HOLD_COLUMNS}",
            {"state": to.value, "id": hold.id, "revision": hold.revision, **fields},
        )
        if row is None:
            raise HoldError("Someone else changed this hold a moment ago. Look again and try once more.")
        changed = Hold.from_row(row)
        self._log_event(changed, to.value, hold.state, to)
        return changed

    def cancel_hold(self, hold_id: int) -> Hold:
        hold = self.get(hold_id)
        if not hold.is_open:
            raise HoldError("This hold is closed already.")
        cancelled = self._change_state(hold, HoldState.CANCELLED)
        if hold.state == HoldState.READY and hold.copy_id is not None:
            self.db.execute("update book_copy set state = 'returned' where id = %(id)s", {"id": hold.copy_id})
        return cancelled

    def collect_hold(self, hold_id: int, desk_user: str) -> Hold:
        """The member picked the book up at the desk: the hold is done, and the copy is on loan."""
        hold = self.get(hold_id)
        if hold.state != HoldState.READY:
            raise HoldError("Only a ready hold can be picked up.")
        self.db.execute(
            "insert into loan (copy_id, member_id, lent_at, lent_by) values (%(copy_id)s, %(member_id)s, %(at)s, %(by)s)",
            {"copy_id": hold.copy_id, "member_id": hold.member_id, "at": now_utc(), "by": desk_user},
        )
        return self._change_state(hold, HoldState.COLLECTED)

    # ----- offering the copies that came back -----

    def _first_waiting(self, book_id: int, today: date) -> Hold | None:
        """The first hold of the line that waits and is not paused on this day."""
        for hold in self.line_for(book_id):
            if hold.state == HoldState.WAITING:
                return hold
            if hold.state == HoldState.PAUSED and hold.paused_until is not None and hold.paused_until <= today:
                return self._change_state(hold, HoldState.WAITING, paused_until=None)
        return None

    def _pickup_day(self, today: date, branch_id: str) -> date:
        """The last day on which the member can pick the copy up: a number of open days of the branch."""
        rules = self.hours.rules_for(branch_id)
        if rules is None:
            rules = PickupRules(branch_id)
        return rules.last_pickup_day(today)

    def _mark_ready(self, hold: Hold, copy_id: int, pickup_by: date) -> Hold:
        """Ties the copy to the hold and puts the copy on the ready shelf of the branch of the hold."""
        ready = self._change_state(hold, HoldState.READY, copy_id=copy_id, ready_at=now_utc(), pickup_by=pickup_by)
        self.db.execute(
            "update book_copy set state = 'ready_shelf', branch_id = %(branch_id)s where id = %(copy_id)s",
            {"branch_id": hold.branch_id, "copy_id": copy_id},
        )
        return ready

    def offer_returned_copies(
        self,
        today: date | None = None,
        limit: int = 50,
    ) -> OfferCounts:
        """Offers each copy that came back to the first member in its line.

        The night job calls this once a night. A member whose card is no longer active
        is passed over, and the copy waits for the next run. Returns the counts of the run.
        """

        today = today or self.clock.today()
        counts = OfferCounts()
        rules = self.hours.rules_for("north")
        test_clock = getattr(self.clock, "is_test", False)
        log.info("offer run for %s with a limit of %s", today.isoformat(), limit)

        if rules is not None and not rules.is_open(today) and not test_clock:
            log.info("the library is closed on %s: no copy is offered", today.isoformat())
            counts.closed_today = True
            return counts

        rows = self.db.fetch_all(
            """
            select c.id as copy_id, c.book_id, c.branch_id
            from book_copy c
            where c.state = 'returned'
              and exists (
                select 1 from book_hold h
                where h.book_id = c.book_id and (h.state = 'waiting' or (h.state = 'paused' and h.paused_until <= %(today)s))
              )
            order by c.returned_at
            limit %(limit)s
            for update of c skip locked
            """,
            {"today": today, "limit": limit},
        )

        for row in rows:
            counts.checked += 1
            hold = self._first_waiting(row["book_id"], today)
            member = self.members.find(hold.member_id)
            if member is None or not member.active:
                log.info("hold %s is passed over: member %s has no active card any more", hold.id, hold.member_id)
                self._change_state(hold, HoldState.CANCELLED)
                counts.passed_over += 1
                continue

            pickup_by = self._pickup_day(today, hold.branch_id)
            ready = self._mark_ready(hold, row["copy_id"], pickup_by)
            counts.hold_ids.append(ready.id)
            log.info(
                "copy %s of book %s is ready for member %s at the %s branch until %s",
                row["copy_id"], row["book_id"], hold.member_id, hold.branch_id, pickup_by.isoformat(),
            )

            try:
                self.notices.send_pickup(member, ready, pickup_by)
                counts.offered += 1
            except NoticeError as error:
                log.warning("the pickup notice for hold %s was not sent (%s); the desk will call the member instead", ready.id, error)
                counts.offered += 1

        return counts

    def requeue_missed_pickups(self, today: date) -> list[Hold]:
        """A ready copy whose last pickup day has passed goes to the next member; the hold goes to the end of the line."""
        rows = self.db.fetch_all(
            f"select {HOLD_COLUMNS} from book_hold where state = 'ready' and pickup_by < %(today)s order by pickup_by",
            {"today": today},
        )
        moved = []
        for row in rows:
            hold = Hold.from_row(row)
            moved.append(self._back_in_line(hold))
        return moved

    def _back_in_line(self, hold: Hold) -> Hold:
        """Frees the copy and gives the hold the last place in its line, so it waits again."""
        last = self.db.fetch_value(
            "select coalesce(max(position), 0) + 1 from book_hold where book_id = %(book_id)s",
            {"book_id": hold.book_id},
        )
        self.db.execute("update book_copy set state = 'returned' where id = %(id)s", {"id": hold.copy_id})
        waiting = self._change_state(hold, HoldState.WAITING, copy_id=None, ready_at=None, pickup_by=None, position=last)
        return waiting

    def _log_event(self, hold: Hold, kind: str, from_state: HoldState | None, to_state: HoldState) -> None:
        """Keeps what happened to a hold, for the history on the member page and for the desk."""
        self.db.execute(
            "insert into hold_event (hold_id, member_id, kind, from_state, to_state, happened_at) values (%(hold_id)s, %(member_id)s, %(kind)s, %(from_state)s, %(to_state)s, %(at)s)",
            {
                "hold_id": hold.id,
                "member_id": hold.member_id,
                "kind": kind,
                "from_state": from_state.value if from_state else None,
                "to_state": to_state.value,
                "at": now_utc(),
            },
        )
