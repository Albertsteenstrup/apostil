"""The web routes of book requests, for the purchase team: the requests of a member, and the answer of a librarian."""

from __future__ import annotations

from library.lending.requests import RequestService
from library.lending.request_models import RequestError, ReservationError
from library.web.app import JsonError, Request, Router, context_of

router = Router(prefix="/api/requests")


def request_service(request: Request) -> RequestService:
    """Gives each call a service with the database and the mailer of this library."""
    ctx = context_of(request)
    return RequestService(ctx.db, ctx.notices)


def refusal(error: RequestError) -> JsonError:
    """A refused request as an answer: 422 for a field that is wrong, 409 for a request in the wrong state."""
    return JsonError(422 if error.field_name else 409, str(error), field=error.field_name)


@router.get("/of/{member_id}")
def requests_of_member(request: Request, member_id: int) -> list[dict]:
    service = request_service(request)
    views = service.requests_of(member_id)
    return [view.as_dict() for view in views]


@router.post("/{request_id}/answer")
def answer(request: Request, request_id: int) -> dict:
    body = request.json()
    service = request_service(request)
    try:
        answered = service.answer_request(request_id, body.get("answer", ""), request.librarian, body.get("key", ""))
    except RequestError as error:
        raise refusal(error) from error
    return answered.as_dict()


@router.post("/reservations/{book_id}")
def reserve(request: Request, book_id: int) -> dict:
    try:
        reservation = request_service(request).reserve(request.member_id, book_id)
    except ReservationError as error:
        raise JsonError(409, str(error)) from error
    return {"id": reservation.id, "state": reservation.state}


@router.delete("/reservations/{reservation_id}")
def cancel_reservation(request: Request, reservation_id: int) -> dict:
    try:
        request_service(request).cancel_reservation(request.member_id, reservation_id)
    except ReservationError as error:
        raise JsonError(409, str(error)) from error
    return {"cancelled": True}
