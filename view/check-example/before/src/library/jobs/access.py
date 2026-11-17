"""Which night jobs may run in this library.

A small library can switch jobs off in its settings, for example the feed of new
books when it orders by hand. A job that is switched off is logged and skipped.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class JobAccess:
    """The jobs that are switched off, by name."""

    switched_off: set[str] = field(default_factory=set)

    @classmethod
    def from_settings(cls, settings: dict) -> JobAccess:
        names = settings.get("night_jobs_off", "")
        return cls({name.strip() for name in names.split(",") if name.strip()})

    def may_run(self, job_name: str) -> bool:
        return job_name not in self.switched_off

    def describe(self) -> str:
        if not self.switched_off:
            return "every night job may run"
        return "switched off: " + ", ".join(sorted(self.switched_off))
