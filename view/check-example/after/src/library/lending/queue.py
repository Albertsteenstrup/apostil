"""The database of the lending rules, as one small class.

Every module of the server talks to the database through this class, with SQL
text and named values. A transaction is a `with` block; work outside such a block
is committed at once, one statement at a time.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

# How long a statement waits for a row that another transaction holds, in milliseconds.
# The night run locks the copies that it offers; a member page must not wait for it.
LOCK_WAIT_MS = 2000


class Database:
    """A thin layer over one connection: rows are dicts, and named values are passed apart from the SQL text."""

    def __init__(self, connection) -> None:
        self.connection = connection
        self.depth = 0

    def fetch_all(self, sql: str, values: dict[str, Any]) -> list[dict]:
        with self.connection.cursor() as cursor:
            cursor.execute(sql, values)
            names = [column[0] for column in cursor.description or []]
            return [dict(zip(names, row)) for row in cursor.fetchall()]

    def fetch_one(self, sql: str, values: dict[str, Any]) -> dict | None:
        rows = self.fetch_all(sql, values)
        return rows[0] if rows else None

    def fetch_value(self, sql: str, values: dict[str, Any]) -> Any:
        row = self.fetch_one(sql, values)
        return next(iter(row.values())) if row else None

    def execute(self, sql: str, values: dict[str, Any]) -> int:
        """Runs one statement and returns how many rows it changed."""
        with self.connection.cursor() as cursor:
            cursor.execute(sql, values)
            changed = cursor.rowcount
        if self.depth == 0:
            self.connection.commit()
        return changed

    @contextmanager
    def transaction(self) -> Iterator[None]:
        """One transaction for the statements of the block; a block inside a block is part of the outer one."""
        self.depth += 1
        try:
            if self.depth == 1:
                self.execute(f"set local lock_timeout = {LOCK_WAIT_MS}", {})
            yield
            if self.depth == 1:
                self.connection.commit()
        except Exception:
            if self.depth == 1:
                self.connection.rollback()
            raise
        finally:
            self.depth -= 1
