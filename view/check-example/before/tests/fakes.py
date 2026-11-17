"""Small fakes for the tests: a database in memory, a clock, the members, the mailer and the opening hours.

The fake database understands only the statements that the tests use; a statement
that it does not know fails the test with its text, so a new query needs a new case here.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta


@dataclass
class FakeClock:
    day: date
    is_test: bool = True

    def today(self) -> date:
        return self.day


@dataclass
class FakeMember:
    id: int
    name: str
    email: str | None
    active: bool = True


@dataclass
class FakeMembers:
    people: dict[int, FakeMember] = field(default_factory=dict)

    @classmethod
    def active(cls, *ids: int) -> FakeMembers:
        return cls({one: FakeMember(one, f"Member {one}", f"member{one}@example.org") for one in ids})

    def find(self, member_id: int) -> FakeMember | None:
        return self.people.get(member_id)

    def deactivate(self, member_id: int) -> None:
        self.people.setdefault(member_id, FakeMember(member_id, f"Member {member_id}", None)).active = False


@dataclass
class FakeNotices:
    sent_to: list[int] = field(default_factory=list)

    def __getattr__(self, name: str):
        if not name.startswith("send_"):
            raise AttributeError(name)
        return lambda member, *_args: self.sent_to.append(member.id)


@dataclass
class FakeHours:
    open_days: frozenset[int] = frozenset(range(6))

    @classmethod
    def open_on_weekdays(cls) -> FakeHours:
        return cls()

    def rules_for(self, branch_id: str):
        return None

    def is_open(self, day: date) -> bool:
        return day.weekday() in self.open_days

    def next_open_day(self, day: date) -> date:
        day += timedelta(days=1)
        while not self.is_open(day):
            day += timedelta(days=1)
        return day


class FakeDatabase:
    """Tables as lists of dicts. Each statement that a test needs is one case of `run`."""

    def __init__(self) -> None:
        self.tables: defaultdict[str, list[dict]] = defaultdict(list)
        self.next_id = 1

    @classmethod
    def with_books(cls, titles: dict[int, str]) -> FakeDatabase:
        db = cls()
        db.tables["book"] = [{"id": book_id, "title": title, "author": "A. Writer"} for book_id, title in titles.items()]
        return db

    def return_copy(self, book_id: int, copy_id: int) -> None:
        self.tables["book_copy"].append({"id": copy_id, "book_id": book_id, "branch_id": "north", "state": "returned", "returned_at": None})

    def run(self, sql: str, values: dict) -> list[dict]:
        raise AssertionError(f"The fake database does not know this statement yet: {' '.join(sql.split())[:120]}")

    def fetch_all(self, sql: str, values: dict) -> list[dict]:
        return self.run(sql, values)

    def fetch_one(self, sql: str, values: dict) -> dict | None:
        rows = self.run(sql, values)
        return rows[0] if rows else None

    def fetch_value(self, sql: str, values: dict):
        row = self.fetch_one(sql, values)
        return next(iter(row.values())) if row else None

    def execute(self, sql: str, values: dict) -> int:
        return len(self.run(sql, values))

    def transaction(self):
        from contextlib import nullcontext

        return nullcontext()
