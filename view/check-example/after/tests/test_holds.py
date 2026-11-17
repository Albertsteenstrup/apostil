"""Tests of the hold service: the line, a pause, and the night run that offers the copies that came back."""

from __future__ import annotations

from datetime import date

from library.lending.hold_models import HoldError, HoldRequest, HoldState
from library.lending.hold_service import HoldService
from tests.fakes import FakeClock, FakeDatabase, FakeHours, FakeMembers, FakeNotices

MONDAY = date(2026, 3, 2)


def night_run(service: HoldService, day: date = MONDAY):
    """The night run as the night job starts it, for the tests below that need a copy on the ready shelf first."""
    return service.offer_returned_copies(today=day, limit=10)


def make_service(day: date = MONDAY, *, members=None, notices=None) -> HoldService:
    db = FakeDatabase.with_books({1: "The quiet garden", 2: "A map of the harbour"})
    return HoldService(db, FakeClock(day), members or FakeMembers.active(10, 11, 12), notices or FakeNotices(), FakeHours.open_on_weekdays())


def test_a_hold_goes_to_the_end_of_the_line():
    service = make_service()
    first = service.place_hold(HoldRequest(10, 1, "north"))
    second = service.place_hold(HoldRequest(11, 1, "harbour"))
    assert (first.position, second.position) == (1, 2)
    assert service.place_in_line(second) == 2


def test_a_member_cannot_wait_twice_for_one_book():
    service = make_service()
    service.place_hold(HoldRequest(10, 1, "north"))
    try:
        service.place_hold(HoldRequest(10, 1, "north"))
    except HoldError as error:
        assert "already in the line" in str(error)
    else:
        raise AssertionError("the second hold was placed")


def test_a_paused_hold_keeps_its_place():
    service = make_service()
    first = service.place_hold(HoldRequest(10, 1, "north"))
    service.place_hold(HoldRequest(11, 1, "north"))
    paused = service.pause_hold(first.id, date(2026, 3, 20))
    assert paused.state == HoldState.PAUSED and paused.position == 1
    resumed = service.resume_hold(first.id)
    assert resumed.state == HoldState.WAITING and service.place_in_line(resumed) == 1


def test_the_night_run_offers_a_returned_copy_to_the_first_member():
    notices = FakeNotices()
    service = make_service(notices=notices)
    service.place_hold(HoldRequest(10, 1, "north"))
    service.place_hold(HoldRequest(11, 1, "north"))
    service.db.return_copy(book_id=1, copy_id=501)

    counts = service.offer_returned_copies(today=MONDAY, limit=10)

    assert counts.as_dict() == {"checked": 1, "offered": 1, "passed_over": 0, "closed_today": False}
    ready = service.holds_of(10)[0]
    assert ready.state == HoldState.READY and ready.copy_id == 501
    assert ready.pickup_by == date(2026, 3, 10)  # seven open days, with the Sunday closed
    assert notices.sent_to == [10]


def test_the_night_run_passes_over_a_member_with_no_active_card():
    members = FakeMembers.active(11)
    service = make_service(members=members)
    service.place_hold(HoldRequest(10, 2, "north"))
    service.place_hold(HoldRequest(11, 2, "north"))
    members.deactivate(10)
    service.db.return_copy(book_id=2, copy_id=502)

    counts = service.offer_returned_copies(today=MONDAY)

    assert counts.passed_over == 1 and counts.offered == 0
    assert service.holds_of(10) == []


def test_a_missed_pickup_goes_to_the_end_of_the_line():
    service = make_service()
    service.place_hold(HoldRequest(10, 1, "north"))
    service.place_hold(HoldRequest(11, 1, "north"))
    service.db.return_copy(book_id=1, copy_id=501)
    night_run(service)

    moved = service.requeue_missed_pickups(date(2026, 3, 11))

    assert [hold.member_id for hold in moved] == [10]
    assert moved[0].state == HoldState.WAITING and moved[0].position == 3
