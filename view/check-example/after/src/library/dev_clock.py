"""The clock of the library.

On the server, today is the date in the time zone of the library. On a test
machine the date can come from the settings, so that the night jobs can be tried
for any day: a loan that is due next week, or a book that came back yesterday.
"""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

LIBRARY_ZONE = ZoneInfo(os.environ.get("LIBRARY_ZONE", "UTC"))


def date_from_settings(value: str | None) -> date | None:
    """Reads the test date of the settings: a day as 2026-11-16, or a number of days from today as +3."""
    if value and value[0] in "+-":
        return datetime.now(LIBRARY_ZONE).date() + timedelta(days=int(value))
    return date.fromisoformat(value) if value else None


class LibraryClock:
    """Today and now for the library. One clock is made for each request and for each night run."""

    def __init__(self, settings: dict | None = None) -> None:
        settings = settings or {}
        self._test_date = date_from_settings(settings.get("test_date"))

    @property
    def is_test(self) -> bool:
        """True when the settings set a test date. The night run then also works on a day when the library is closed."""
        return self._test_date is not None

    def today(self) -> date:
        return self._test_date or datetime.now(LIBRARY_ZONE).date()

    def now(self) -> datetime:
        moment = datetime.now(LIBRARY_ZONE)
        if self._test_date is None:
            return moment
        return moment.replace(year=self._test_date.year, month=self._test_date.month, day=self._test_date.day)

    def days_until(self, day: date) -> int:
        return (day - self.today()).days

    def ahead(self, days: int) -> LibraryClock:
        """A clock that is some days ahead of this one, for a test of a pickup day that has passed."""
        later = LibraryClock()
        later._test_date = self.today() + timedelta(days=days)
        return later

    def describe(self) -> str:
        """One line for the log of the night run: which date the jobs use."""
        if self._test_date is None:
            return f"today is {self.today().isoformat()} in {LIBRARY_ZONE.key}"
        return f"the test date {self._test_date.isoformat()} is set; the real date is {datetime.now(LIBRARY_ZONE).date().isoformat()}"
