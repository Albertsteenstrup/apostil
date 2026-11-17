"""The shapes that the desk screen shows: a task of the morning and the board of a branch."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass
class DeskTask:
    """One thing that the desk of a branch should do today."""

    kind: str  # "overdue", "lost", "call_member", "put_aside"
    title: str
    member_id: int | None = None
    copy_id: int | None = None
    since: date | None = None


@dataclass
class DeskBoard:
    """What the desk screen of one branch shows in the morning."""

    branch_id: str
    day: date
    tasks: list[DeskTask] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)

    def add(self, task: DeskTask) -> None:
        self.tasks.append(task)
        self.counts[task.kind] = self.counts.get(task.kind, 0) + 1
