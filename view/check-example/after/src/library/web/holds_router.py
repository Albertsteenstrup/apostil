"""The web routes of holds: the holds of a member, a new hold, a pause, a cancel, and a pickup at the desk.

Each route checks who may act with permissions.may(), then asks the hold service.
A refusal of the rules comes back as a sentence that the member page shows as it is.
"""

from __future__ import annotations

from datetime import date

from library.lending.answer_shapes import HoldView, ProblemView
from library.lending.hold_models import Hold, HoldError, HoldRequest
from library.lending.hold_service import HoldService
from library.lending.permissions import Actor, may
from library.web.app import JsonError, Request, Router, context_of

router = Router(prefix="/api/holds")


def hold_service(request: Request) -> HoldService:
    """One hold service for each call, with the database, the clock, the members, the mailer and the hours of this library."""
    ctx = context_of(request)
    return HoldService(ctx.db, ctx.clock, ctx.members, ctx.notices, ctx.hours)


def actor_of(request: Request) -> Actor:
    if request.librarian:
        return Actor("desk", branch_id=request.branch_id)
    return Actor("member", member_id=request.member_id)


def refused(error: HoldError) -> JsonError:
    """A refusal of the rules as an answer of the route: 422 when a field is wrong, else 409."""
    problem = ProblemView(str(error), error.field_name)
    return JsonError(422 if error.field_name else 409, problem.message, field=problem.field)


def view_of(service: HoldService, hold: Hold) -> dict:
    """A hold as the member page shows it, with the title of its book and its place in the line."""
    book = service.db.fetch_one("select title, author from book where id = %(id)s", {"id": hold.book_id}) or {"title": "?", "author": "?"}
    place = service.place_in_line(hold) if hold.state.value == "waiting" else 0
    return HoldView(hold.id, book["title"], book["author"], hold.state.value, place, hold.branch_id, hold.pickup_by, hold.paused_until).as_dict()


def check(request: Request, action: str, member_id: int | None = None) -> None:
    if not may(actor_of(request), action, member_id):
        raise JsonError(403, "You may not do this.")


@router.get("/mine")
def my_holds(request: Request) -> list[dict]:
    service = hold_service(request)
    return [view_of(service, hold) for hold in service.holds_of(request.member_id)]


@router.post("/")
def place(request: Request) -> dict:
    body = request.json()
    member_id = body.get("member_id", request.member_id)
    check(request, "place_hold", member_id)
    service = hold_service(request)
    try:
        hold = service.place_hold(HoldRequest(member_id, int(body.get("book_id", 0)), body.get("branch_id", ""), body.get("note", "")))
    except HoldError as error:
        raise refused(error) from error
    return view_of(service, hold)


@router.post("/{hold_id}/pause")
def pause(request: Request, hold_id: int) -> dict:
    service = hold_service(request)
    hold = service.get(hold_id)
    check(request, "pause_hold", hold.member_id)
    try:
        until = date.fromisoformat(request.json().get("until", ""))
    except ValueError as error:
        raise JsonError(422, "Give the last day of the pause as a date.", field="until") from error
    try:
        return view_of(service, service.pause_hold(hold_id, until))
    except HoldError as error:
        raise refused(error) from error


@router.post("/{hold_id}/resume")
def resume(request: Request, hold_id: int) -> dict:
    service = hold_service(request)
    check(request, "pause_hold", service.get(hold_id).member_id)
    try:
        return view_of(service, service.resume_hold(hold_id))
    except HoldError as error:
        raise refused(error) from error


@router.delete("/{hold_id}")
def cancel(request: Request, hold_id: int) -> dict:
    service = hold_service(request)
    check(request, "cancel_hold", service.get(hold_id).member_id)
    try:
        return view_of(service, service.cancel_hold(hold_id))
    except HoldError as error:
        raise refused(error) from error


@router.post("/{hold_id}/collect")
def collect(request: Request, hold_id: int) -> dict:
    """The desk scanned the card and the copy: the member takes the book home."""
    check(request, "collect_hold")
    service = hold_service(request)
    try:
        return view_of(service, service.collect_hold(hold_id, request.librarian or "desk"))
    except HoldError as error:
        raise refused(error) from error
