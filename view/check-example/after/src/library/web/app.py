"""The web server of the library: a small router, the request of one call, and the context of the app.

The server keeps its own small router, so that the routes read as plain functions:
a route takes the request and returns a dict, and a refusal is a JsonError.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Callable

from library.dev_clock import LibraryClock
from library.jobs.access import JobAccess
from library.lending.notices import Notices
from library.lending.queue import Database


class JsonError(Exception):
    """A refusal that the route returns as JSON with a status: one sentence, and the field it is about."""

    def __init__(self, status: int, message: str, field: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.field = field


@dataclass
class Request:
    """One call of a web page: who sends it, the body, and the app that serves it."""

    app: "App"
    body: dict = field(default_factory=dict)
    member_id: int | None = None
    librarian: str | None = None
    branch_id: str | None = None

    def json(self) -> dict:
        return self.body


@dataclass
class Router:
    """The routes of one area, under one prefix."""

    prefix: str
    routes: list[tuple[str, str, Callable]] = field(default_factory=list)

    def _add(self, method: str, path: str) -> Callable:
        def register(handler: Callable) -> Callable:
            self.routes.append((method, self.prefix + path, handler))
            return handler
        return register

    def get(self, path: str) -> Callable:
        return self._add("GET", path)

    def post(self, path: str) -> Callable:
        return self._add("POST", path)

    def delete(self, path: str) -> Callable:
        return self._add("DELETE", path)


@dataclass
class App:
    """The app: its routers and the context that every route and every night job gets."""

    context: object
    routers: list[Router] = field(default_factory=list)

    def include(self, router: Router) -> None:
        self.routers.append(router)


def context_of(request: Request):
    return request.app.context


def build_context():
    """The context of this machine: the database, the clock, the mailer and the settings."""
    from library.night_jobs import JobContext, NightSettings

    settings = {"test_date": os.environ.get("LIBRARY_TEST_DATE"), "night_jobs_off": os.environ.get("LIBRARY_JOBS_OFF", "")}
    db = Database(connect(os.environ["LIBRARY_DATABASE"]))
    return JobContext(
        db=db,
        clock=LibraryClock(settings),
        members=member_directory(db),
        notices=Notices(outbox_from_settings()),
        hours=opening_hours(db),
        access=JobAccess.from_settings(settings),
        settings=NightSettings(),
    )


def build_app() -> App:
    from library.web.holds_router import router as holds_router
    from library.web.members_router import router as members_router
    from library.web.requests_router import router as requests_router

    app = App(build_context())
    app.include(members_router)
    app.include(requests_router)
    app.include(holds_router)
    return app


def connect(address: str):
    """The connection of the database; the driver is chosen by the address."""
    raise NotImplementedError(f"No driver for {address}: this repo is made up and never runs.")


def member_directory(db: Database):
    raise NotImplementedError("Made up.")


def outbox_from_settings():
    raise NotImplementedError("Made up.")


def opening_hours(db: Database):
    raise NotImplementedError("Made up.")
