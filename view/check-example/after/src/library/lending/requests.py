"""Book requests: a member asks the library for a book that it does not have, and a librarian answers.

Several members can ask for the same book. The first answer of a librarian goes to
every member who asked, one mail each. An answer that comes again with the same key
is the same answer, so a click that is sent twice does no harm.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from library.lending.notices import Notices
from library.lending.queue import Database
from library.lending.request_models import ANSWERS, MAX_OPEN_REQUESTS, BookRequest, RequestError

REQUEST_COLUMNS = "id, member_id, isbn, title, note, state, answer, answered_by, answer_key, revision, asked_at"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class RequestService:
    """Asks and answers book requests. One instance serves one web request."""

    def __init__(self, db: Database, notices: Notices) -> None:
        self.db = db
        self.notices = notices

    def _request_view(self, row: dict) -> BookRequest:
        """One request as the member page and the desk show it."""
        return BookRequest(
            id=row["id"], member_id=row["member_id"], isbn=row["isbn"], title=row["title"],
            note=row["note"], state=row["state"], answer=row["answer"], asked_at=row["asked_at"],
        )

    def requests_of(self, member_id: int) -> list[BookRequest]:
        """The requests of one member, the newest first."""
        rows = self.db.fetch_all(f"select {REQUEST_COLUMNS} from book_request where member_id = %(member)s order by asked_at desc", {"member": member_id})
        return [self._request_view(row) for row in rows]

    def answer_request(self, request_id: int, answer: str, librarian: str, key: str) -> BookRequest:
        """Stores the answer of a librarian and tells every member who asked for the same book."""
        with self.db.transaction():
            row = self.db.fetch_one(f"select {REQUEST_COLUMNS} from book_request where id = %(id)s for update", {"id": request_id})
            if row is None:
                raise RequestError(f"There is no request {request_id}.")
            same = self.db.fetch_all(f"select {REQUEST_COLUMNS} from book_request where isbn = %(isbn)s and state = 'open' order by id for update", {"isbn": row["isbn"]})

            if not self.db.fetch_value("select may_answer from librarian where name = %(name)s", {"name": librarian}):
                raise RequestError("Only a librarian of the purchase team can answer a request.")

            if row["state"] == "answered" and row["answer_key"] == key:
                return self._request_view(row)

            if answer not in ANSWERS:
                raise RequestError(f"The answer must be one of: {', '.join(ANSWERS)}.", "answer")
            if row["state"] != "open":
                raise RequestError("Another librarian answered this request a moment ago.")

            details = json.dumps({"answer": answer, "by": librarian, "at": now_utc().isoformat()})
            ids = [one["id"] for one in same] or [row["id"]]
            self.db.execute(
                "update book_request set state = 'answered', answer = %(answer)s, answered_by = %(by)s, answer_key = %(key)s, details = %(details)s, revision = revision + 1 where id = any(%(ids)s)",
                {"answer": answer, "by": librarian, "key": key, "details": details, "ids": ids},
            )

            if answer != "declined":
                self.db.execute(
                    "insert into purchase_order (isbn, title, kind, ordered_by) values (%(isbn)s, %(title)s, %(kind)s, %(by)s)",
                    {"isbn": row["isbn"], "title": row["title"], "kind": answer, "by": librarian},
                )

            member_ids = sorted({one["member_id"] for one in same} | {row["member_id"]})
            members = self.db.fetch_all("select id, name, email from member where id = any(%(ids)s) and active", {"ids": member_ids})

            for member in members:
                self.notices.send_request_answer(member, row["title"], answer)

            answered = self.db.fetch_one(f"select {REQUEST_COLUMNS} from book_request where id = %(id)s", {"id": request_id})
            return self._request_view(answered)

    def ask_for_book(self, member_id: int, isbn: str, title: str, note: str = "") -> BookRequest:
        """Saves one open request of a member for a book that the library does not have."""
        isbn = isbn.replace("-", "").strip()
        title = title.strip()
        if not title:
            raise RequestError("Give the title of the book.", "title")

        if isbn and self.db.fetch_value("select 1 from book where isbn = %(isbn)s", {"isbn": isbn}):
            raise RequestError("The library has this book. Place a hold on it instead.", "isbn")

        open_count = self.db.fetch_value("select count(*) from book_request where member_id = %(member)s and state = 'open'", {"member": member_id})
        if open_count >= MAX_OPEN_REQUESTS:
            raise RequestError(f"You can have {MAX_OPEN_REQUESTS} open requests at the same time.")

        if self.db.fetch_value("select 1 from book_request where member_id = %(member)s and title = %(title)s and state = 'open'", {"member": member_id, "title": title}):
            raise RequestError("You asked for this book already.")

        row = self.db.fetch_one(
            f"insert into book_request (member_id, isbn, title, note, state, asked_at, details) values (%(member)s, %(isbn)s, %(title)s, %(note)s, 'open', %(at)s, %(details)s) returning {REQUEST_COLUMNS}",
            {"member": member_id, "isbn": isbn, "title": title, "note": note.strip(), "at": now_utc(), "details": json.dumps({"from": "member page"})},
        )

        return self._request_view(row)


__all__ = ["RequestService", "now_utc"]
