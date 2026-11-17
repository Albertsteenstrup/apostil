"""The shapes of book requests."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime

# The answers that the purchase team can give to a book request.
ANSWERS = ("bought", "borrowed", "declined")

# A member can have this many open book requests at the same time.
MAX_OPEN_REQUESTS = 5


class RequestError(Exception):
    """A book request that the rules refuse. The message is a sentence for the member or the librarian."""

    def __init__(self, message: str, field_name: str | None = None) -> None:
        super().__init__(message)
        self.field_name = field_name


@dataclass
class BookRequest:
    """One request of a member for a book that the library does not have."""

    id: int
    member_id: int
    isbn: str
    title: str
    note: str
    state: str
    answer: str | None
    asked_at: datetime

    def as_dict(self) -> dict:
        data = asdict(self)
        data["asked_at"] = self.asked_at.isoformat()
        return data
