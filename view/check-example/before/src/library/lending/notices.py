"""The mails of the library: to members, and to the desk of a branch.

Every mail goes through this class, so that the words of the library are in one
place and a test can catch the mails instead of sending them.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date


class NoticeError(Exception):
    """A mail that could not be sent. The caller decides whether the desk should call instead."""


@dataclass
class Mail:
    to: str
    subject: str
    body: str


class Notices:
    """Writes and sends the mails. `outbox` is the program that sends; a test gives a list."""

    def __init__(self, outbox, library_name: str = "The library") -> None:
        self.outbox = outbox
        self.library_name = library_name

    def _send(self, to: str | None, subject: str, body: str) -> None:
        if not to:
            raise NoticeError("This member has no mail address.")
        try:
            self.outbox.send(Mail(to, subject, f"{body}\n\n{self.library_name}"))
        except OSError as error:
            raise NoticeError(f"The mail to {to} was not sent: {error}") from error

    def send_due_soon(self, member, titles: list[str], due_on: date) -> None:
        listed = "\n".join(f"- {title}" for title in titles)
        self._send(member.email, f"Due on {due_on:%A %d %B}", f"Dear {member.name},\n\nThese books are due on {due_on:%A %d %B}:\n{listed}\n\nYou can renew them on the member page.")

    def send_overdue(self, member, count: int, days: int) -> None:
        books = "a book" if count == 1 else f"{count} books"
        self._send(member.email, "A reminder", f"Dear {member.name},\n\nYou have {books} that should have come back {days} days ago. Please bring them back, or renew them on the member page.")

    def send_reservation_ready(self, member, title: str) -> None:
        self._send(
            member.email,
            f"{title} is back",
            f"Dear {member.name},\n\nThe book that you reserved, {title}, is back. Ask for it at the desk of your branch within a week.",
        )

    def send_request_answer(self, member, title: str, answer: str) -> None:
        """Tells a member what the library does with the book that the member asked for."""
        words = {
            "bought": f"The library buys {title}. You can place a hold on it when it arrives.",
            "borrowed": f"The library borrows {title} from another library for you. The desk tells you when it is here.",
            "declined": f"The library does not buy {title} this time. Thank you for asking.",
        }
        self._send(member.email, f"Your request for {title}", f"Dear {member.name},\n\n{words[answer]}")

    def send_desk_mail(self, address: str, subject: str, body: str) -> None:
        self._send(address, subject, body)

    def fetch_text(self, url: str, timeout: float) -> str:
        """Reads a text over the network, for the feed of new books. The outbox knows the network of the server."""
        return self.outbox.fetch(url, timeout=timeout)
