"""The shapes that the web routes send back, as plain dicts with fixed keys.

The web pages read these keys; the generated client in web/src/api/generated
is written from them, so a new key here needs a new client.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date


@dataclass
class LoanView:
    id: int
    title: str
    author: str
    due_on: date
    renewals: int
    may_renew: bool

    def as_dict(self) -> dict:
        data = asdict(self)
        data["due_on"] = self.due_on.isoformat()
        return data


@dataclass
class ProblemView:
    """An answer that says why a request was refused: one sentence, and the field it is about."""

    message: str
    field: str | None = None

    def as_dict(self) -> dict:
        return {"message": self.message, **({"field": self.field} if self.field else {})}
