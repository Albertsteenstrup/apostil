"""Tests of the routes of book requests, through the router with a fake database."""

from __future__ import annotations

from datetime import date

from library.lending.request_models import RequestError
from library.lending.requests import RequestService
from tests.fakes import FakeDatabase, FakeNotices


def make_service() -> RequestService:
    db = FakeDatabase.with_books({7: "The quiet garden"})
    db.tables["librarian"].append({"name": "ines", "may_answer": True})
    return RequestService(db, FakeNotices())


def test_a_member_asks_for_a_book():
    service = make_service()
    asked = service.ask_for_book(10, "978-0-00-000000-1", "Birds of the north coast")
    assert asked.state == "open" and asked.isbn == "9780000000001"


def test_a_request_needs_a_title():
    service = make_service()
    try:
        service.ask_for_book(10, "", "   ")
    except RequestError as error:
        assert error.field_name == "title"
    else:
        raise AssertionError("a request with no title was saved")


def test_a_book_of_the_library_is_held_not_requested():
    service = make_service()
    service.db.tables["book"].append({"id": 8, "isbn": "9780000000002", "title": "Rivers", "author": "B. Writer"})
    try:
        service.ask_for_book(10, "978-0-00-000000-2", "Rivers")
    except RequestError as error:
        assert "Place a hold on it instead" in str(error)
    else:
        raise AssertionError("a request for a book of the library was saved")


def test_one_answer_tells_every_member_who_asked():
    service = make_service()
    first = service.ask_for_book(10, "978-0-00-000000-1", "Birds of the north coast")
    service.ask_for_book(11, "978-0-00-000000-1", "Birds of the north coast")
    answered = service.answer_request(first.id, "bought", "ines", "key-1")
    assert answered.answer == "bought"
    assert sorted(service.notices.sent_to) == [10, 11]


def test_the_same_answer_twice_is_one_answer():
    service = make_service()
    first = service.ask_for_book(10, "978-0-00-000000-1", "Birds of the north coast")
    service.answer_request(first.id, "borrowed", "ines", "key-2")
    again = service.answer_request(first.id, "borrowed", "ines", "key-2")
    assert again.answer == "borrowed" and service.notices.sent_to == [10]


def test_an_unknown_answer_is_refused():
    service = make_service()
    first = service.ask_for_book(10, "", "A map of the harbour")
    try:
        service.answer_request(first.id, "maybe", "ines", "key-3")
    except RequestError as error:
        assert error.field_name == "answer"
    else:
        raise AssertionError("an unknown answer was stored")


def test_requests_are_listed_newest_first():
    service = make_service()
    service.ask_for_book(10, "", "First book")
    service.ask_for_book(10, "", "Second book")
    assert [one.title for one in service.requests_of(10)] == ["Second book", "First book"]
    assert date.today() >= date(2026, 1, 1)
