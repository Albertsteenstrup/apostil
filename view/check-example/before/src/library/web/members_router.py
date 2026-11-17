"""The web routes of the member page: the loans, the history, and a request for a book that the library does not have."""

from __future__ import annotations

from library.lending.answer_shapes import LoanView
from library.lending.requests import RequestService
from library.lending.request_models import RequestError
from library.web.app import JsonError, Request, Router, context_of

router = Router(prefix="/api/member")


@router.get("/loans")
def my_loans(request: Request) -> list[dict]:
    ctx = context_of(request)
    rows = ctx.db.fetch_all(
        "select l.id, b.title, b.author, l.due_on, l.renewals from loan l join book_copy c on c.id = l.copy_id join book b on b.id = c.book_id where l.member_id = %(member)s and l.returned_at is null order by l.due_on",
        {"member": request.member_id},
    )
    return [LoanView(row["id"], row["title"], row["author"], row["due_on"], row["renewals"], row["renewals"] < 3).as_dict() for row in rows]


@router.post("/loans/{loan_id}/renew")
def renew(request: Request, loan_id: int) -> dict:
    ctx = context_of(request)
    changed = ctx.db.execute(
        "update loan set due_on = due_on + 21, renewals = renewals + 1 where id = %(id)s and member_id = %(member)s and renewals < 3 and returned_at is null",
        {"id": loan_id, "member": request.member_id},
    )
    if not changed:
        raise JsonError(409, "This loan cannot be renewed again. Bring the book back, or ask at the desk.")
    return {"renewed": True}


@router.get("/history")
def history(request: Request) -> list[dict]:
    ctx = context_of(request)
    rows = ctx.db.fetch_all(
        "select b.title, b.author, l.returned_at from loan l join book_copy c on c.id = l.copy_id join book b on b.id = c.book_id where l.member_id = %(member)s and l.returned_at is not null order by l.returned_at desc limit 200",
        {"member": request.member_id},
    )
    return [{"title": row["title"], "author": row["author"], "returned_on": row["returned_at"].date().isoformat()} for row in rows]


@router.post("/requests")
def ask_for_book(request: Request) -> dict:
    ctx = context_of(request)
    body = request.json()
    try:
        return RequestService(ctx.db, ctx.notices).ask_for_book(request.member_id, body.get("isbn", ""), body.get("title", ""), body.get("note", "")).as_dict()
    except RequestError as error:
        raise JsonError(422, str(error), field=error.field_name) from error
