"""The web routes of book requests, for the purchase team: the requests of a member, and the answer of a librarian."""

from __future__ import annotations

from library.lending.requests import RequestService
from library.lending.request_models import RequestError
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
