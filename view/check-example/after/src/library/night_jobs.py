"""The night jobs of the library.

A scheduler starts run_night() once a night, after the last branch has closed.
Each job gets the same context: the database, the clock, the mailer and the settings.
A job that fails is logged and the other jobs still run; the desk summary of the
morning says which jobs failed, so a librarian can look before the doors open.

The jobs, in the order in which they run:

- remind_due_loans: a mail to each member whose loan is due in a few days.
- flag_overdue_loans: marks loans that are overdue, and reminds the member once a week.
- renew_quiet_loans: renews a loan for one more period when nobody waits for the book.
- lending_night: gives the books that came back to the members who wait for them.
- import_catalogue_feed: reads the new books of the suppliers into the catalogue.
- rebuild_search_index: builds the search index of the catalogue again.
- count_the_day: counts visits, loans and returns of each branch.
- archive_old_loans: moves loans of more than two years to the archive.
- clean_web_sessions: removes the web sessions that ended.
- check_branch_hours: warns when a branch has no opening hours for next week.
- refresh_reading_lists: counts the books of each shared reading list again.
- send_desk_summary: one mail to each branch with the work of the morning.
"""

from __future__ import annotations

import csv
import io
import logging
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Iterable, Iterator

from library.dev_clock import LibraryClock
from library.jobs.access import JobAccess
from library.lending.notices import Notices
from library.lending.queue import Database

log = logging.getLogger("library.night")

# How many days before the due day the first reminder goes out.
REMIND_DAYS_BEFORE = 3

# An overdue loan gets a reminder once in this many days.
OVERDUE_REMINDER_EVERY = 7

# A loan is renewed by itself at most this many times.
MAX_QUIET_RENEWALS = 2

# Loans that ended longer ago than this go to the archive.
ARCHIVE_AFTER = timedelta(days=730)

# Web sessions that ended longer ago than this are removed.
SESSION_KEEP = timedelta(days=14)

# The rows that one statement reads or writes at most; larger work goes in batches of this size.
BATCH = 500


@dataclass
class NightSettings:
    """The settings of the night run. The defaults are those of a small library with four branches."""

    holds_enabled: bool = True
    offer_limit: int = 50
    feed_url: str = "https://feeds.example.org/new-books.csv"
    feed_timeout: float = 20.0
    desk_mail: dict[str, str] = field(default_factory=dict)
    quiet_renewals: bool = True
    dry_run: bool = False


@dataclass
class JobContext:
    """What every job gets: the database, the clock, the members, the mailer and the settings."""

    db: Database
    clock: LibraryClock
    members: object
    notices: Notices
    hours: object
    access: JobAccess
    settings: NightSettings = field(default_factory=NightSettings)
    started: float = field(default_factory=time.monotonic)

    def elapsed(self) -> float:
        return round(time.monotonic() - self.started, 1)


@dataclass
class JobResult:
    """What one job reports for the desk summary."""

    name: str
    ok: bool
    counts: dict = field(default_factory=dict)
    error: str = ""
    seconds: float = 0.0


def chunked(items: Iterable, size: int = BATCH) -> Iterator[list]:
    """Yields lists of at most `size` items, in order."""
    batch: list = []
    for item in items:
        batch.append(item)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch


def days_between(first: date, last: date) -> int:
    return (last - first).days


def plural(count: int, word: str) -> str:
    return f"{count} {word}" if count == 1 else f"{count} {word}s"


def format_counts(counts: dict) -> str:
    """Counts as one short line for a log or a mail: 'offered 3, passed over 1'."""
    parts = [f"{name.replace('_', ' ')} {value}" for name, value in counts.items() if isinstance(value, int) and not isinstance(value, bool)]
    return ", ".join(parts) if parts else "nothing to report"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


# ----- loans -----


def remind_due_loans(ctx: JobContext) -> dict:
    """Mails each member whose loan is due in REMIND_DAYS_BEFORE days. One mail lists all loans of a member."""
    due_on = ctx.clock.today() + timedelta(days=REMIND_DAYS_BEFORE)
    rows = ctx.db.fetch_all(
        "select l.id, l.member_id, l.due_on, b.title, b.author from loan l join book_copy c on c.id = l.copy_id join book b on b.id = c.book_id where l.returned_at is null and l.due_on = %(due_on)s and l.reminded_on is null order by l.member_id",
        {"due_on": due_on},
    )
    by_member: dict[int, list[dict]] = defaultdict(list)
    for row in rows:
        by_member[row["member_id"]].append(row)
    mailed = 0
    for member_id, loans in by_member.items():
        member = ctx.members.find(member_id)
        if member is None or not member.email:
            continue
        titles = [f"{loan['title']} by {loan['author']}" for loan in loans]
        if not ctx.settings.dry_run:
            ctx.notices.send_due_soon(member, titles, due_on)
        mailed += 1
    if rows and not ctx.settings.dry_run:
        for batch in chunked([row["id"] for row in rows]):
            ctx.db.execute("update loan set reminded_on = %(today)s where id = any(%(ids)s)", {"today": ctx.clock.today(), "ids": batch})
    return {"loans": len(rows), "members_mailed": mailed}


def flag_overdue_loans(ctx: JobContext) -> dict:
    """Marks the loans that are overdue, and reminds each member once every OVERDUE_REMINDER_EVERY days."""
    today = ctx.clock.today()
    flagged = ctx.db.execute(
        "update loan set overdue = true where returned_at is null and due_on < %(today)s and not overdue",
        {"today": today},
    )
    rows = ctx.db.fetch_all(
        "select id, member_id, due_on, last_overdue_mail from loan where returned_at is null and overdue order by member_id, due_on",
        {},
    )
    reminded = 0
    for member_id, loans in _group_by_member(rows).items():
        last_mail = max((loan["last_overdue_mail"] for loan in loans if loan["last_overdue_mail"]), default=None)
        if last_mail is not None and days_between(last_mail, today) < OVERDUE_REMINDER_EVERY:
            continue
        member = ctx.members.find(member_id)
        if member is None:
            log.warning("loan of unknown member %s is overdue; the desk should look at it", member_id)
            continue
        oldest = min(loan["due_on"] for loan in loans)
        if not ctx.settings.dry_run:
            ctx.notices.send_overdue(member, len(loans), days_between(oldest, today))
            ctx.db.execute("update loan set last_overdue_mail = %(today)s where id = any(%(ids)s)", {"today": today, "ids": [loan["id"] for loan in loans]})
        reminded += 1
    return {"newly_overdue": flagged, "members_reminded": reminded}


def _group_by_member(rows: list[dict]) -> dict[int, list[dict]]:
    groups: dict[int, list[dict]] = defaultdict(list)
    for row in rows:
        groups[row["member_id"]].append(row)
    return groups


def renew_quiet_loans(ctx: JobContext) -> dict:
    """Renews a loan that is due tomorrow for one more period, when nobody waits for its book.

    A member gets this at most MAX_QUIET_RENEWALS times for one loan. A book that
    someone waits for is never renewed by itself: it should come back for the line.
    """
    if not ctx.settings.quiet_renewals:
        return {"skipped": True}
    tomorrow = ctx.clock.today() + timedelta(days=1)
    rows = ctx.db.fetch_all(
        """
        select l.id, l.member_id, l.copy_id, l.due_on, l.renewals, c.book_id
        from loan l join book_copy c on c.id = l.copy_id
        where l.returned_at is null and l.due_on = %(tomorrow)s and l.renewals < %(most)s
        """,
        {"tomorrow": tomorrow, "most": MAX_QUIET_RENEWALS},
    )
    waited_for = {
        row["book_id"]
        for row in ctx.db.fetch_all(
            "select distinct book_id from book_hold where state in ('waiting', 'paused') and book_id = any(%(ids)s)",
            {"ids": [row["book_id"] for row in rows]},
        )
    }
    renewed = 0
    kept = 0
    for row in rows:
        if row["book_id"] in waited_for:
            kept += 1
            continue
        period = ctx.hours.loan_period(row["book_id"]) if hasattr(ctx.hours, "loan_period") else timedelta(days=21)
        if not ctx.settings.dry_run:
            ctx.db.execute(
                "update loan set due_on = %(due)s, renewals = renewals + 1 where id = %(id)s",
                {"due": row["due_on"] + period, "id": row["id"]},
            )
        renewed += 1
    return {"renewed": renewed, "kept_for_a_hold": kept}


# ----- holds -----


def lending_night(ctx: JobContext) -> dict:
    """The lending work of the night: the books that came back go to the members who wait for them."""
    if not ctx.settings.holds_enabled:
        log.info("holds are switched off in the settings; no copy is offered tonight")
        return {"skipped": True}
    from library.lending.hold_service import HoldService
    service = HoldService(ctx.db, ctx.clock, ctx.members, ctx.notices, ctx.hours)
    with ctx.db.transaction():
        counts = service.offer_returned_copies(
            today=ctx.clock.today(),
            limit=ctx.settings.offer_limit,
        )
    log.info("night offers: %s", format_counts(counts.as_dict()))
    return counts.as_dict()


# ----- the catalogue and its new copies -----


FEED_COLUMNS = ("isbn", "title", "author", "year", "publisher", "pages", "language", "branch")


def import_catalogue_feed(ctx: JobContext) -> dict:
    """Reads the CSV feed of new books and adds the books that the catalogue does not have yet.

    The feed lists one copy on each row, with the branch that ordered it. A book that
    is in the catalogue already gets the new copy only. A row with no ISBN is logged
    and left out, so the desk can add it by hand.
    """
    text = ctx.notices.fetch_text(ctx.settings.feed_url, timeout=ctx.settings.feed_timeout)
    reader = csv.DictReader(io.StringIO(text))
    missing = [name for name in FEED_COLUMNS if name not in (reader.fieldnames or [])]
    if missing:
        raise ValueError(f"The feed of new books has no column {', '.join(missing)}. Ask the supplier to send the agreed columns.")
    books_added = 0
    copies_added = 0
    left_out = 0
    for row in reader:
        isbn = (row["isbn"] or "").replace("-", "").strip()
        if len(isbn) not in (10, 13):
            log.warning("feed row without a usable ISBN left out: title %r, branch %r, supplier row %s", row.get("title"), row.get("branch"), reader.line_num)
            left_out += 1
            continue
        book_id = ctx.db.fetch_value("select id from book where isbn = %(isbn)s", {"isbn": isbn})
        if book_id is None:
            if ctx.settings.dry_run:
                books_added += 1
                continue
            book_id = ctx.db.fetch_value(
                "insert into book (isbn, title, author, year, publisher, pages, language) values (%(isbn)s, %(title)s, %(author)s, %(year)s, %(publisher)s, %(pages)s, %(language)s) returning id",
                {
                    "isbn": isbn,
                    "title": row["title"].strip(),
                    "author": row["author"].strip(),
                    "year": int(row["year"]) if row["year"].isdigit() else None,
                    "publisher": row["publisher"].strip(),
                    "pages": int(row["pages"]) if row["pages"].isdigit() else None,
                    "language": row["language"].strip() or "en",
                },
            )
            books_added += 1
        if not ctx.settings.dry_run:
            ctx.db.execute(
                "insert into book_copy (book_id, branch_id, state, added_on) values (%(book_id)s, %(branch_id)s, 'on_order', %(today)s)",
                {"book_id": book_id, "branch_id": row["branch"].strip().lower(), "today": ctx.clock.today()},
            )
        copies_added += 1
    return {"books_added": books_added, "copies_added": copies_added, "rows_left_out": left_out}


def rebuild_search_index(ctx: JobContext) -> dict:
    """Builds the search index of the catalogue again, in batches, and swaps it in at the end.

    The new index is written next to the old one, so searches on the web pages keep
    working during the night; the swap is one statement at the end.
    """
    ctx.db.execute("drop table if exists book_search_next", {})
    ctx.db.execute("create table book_search_next (like book_search including all)", {})
    total = ctx.db.fetch_value("select count(*) from book", {})
    written = 0
    for offset in range(0, total, BATCH):
        rows = ctx.db.fetch_all(
            "select id, title, author, coalesce(subjects, '') as subjects, coalesce(summary, '') as summary from book order by id limit %(limit)s offset %(offset)s",
            {"limit": BATCH, "offset": offset},
        )
        for row in rows:
            words = " ".join([row["title"], row["author"], row["subjects"], row["summary"]]).lower()
            ctx.db.execute(
                "insert into book_search_next (book_id, words, vector) values (%(id)s, %(words)s, to_tsvector('simple', %(words)s))",
                {"id": row["id"], "words": words},
            )
            written += 1
        if offset and offset % (BATCH * 20) == 0:
            log.info("search index: %s of %s books after %s seconds", written, total, ctx.elapsed())
    if not ctx.settings.dry_run:
        with ctx.db.transaction():
            ctx.db.execute("alter table book_search rename to book_search_old", {})
            ctx.db.execute("alter table book_search_next rename to book_search", {})
            ctx.db.execute("drop table book_search_old", {})
    return {"books_indexed": written}


# ----- numbers of the day -----


def count_the_day(ctx: JobContext) -> dict:
    """Counts the visits, loans and returns of each branch for the day that ended, for the yearly report."""
    day = ctx.clock.today() - timedelta(days=1)
    loans = Counter(
        row["branch_id"]
        for row in ctx.db.fetch_all(
            "select c.branch_id from loan l join book_copy c on c.id = l.copy_id where l.lent_at::date = %(day)s",
            {"day": day},
        )
    )
    returns = Counter(
        row["branch_id"]
        for row in ctx.db.fetch_all(
            "select c.branch_id from loan l join book_copy c on c.id = l.copy_id where l.returned_at::date = %(day)s",
            {"day": day},
        )
    )
    visits = {row["branch_id"]: row["visits"] for row in ctx.db.fetch_all("select branch_id, visits from door_count where day = %(day)s", {"day": day})}
    branches = sorted(set(loans) | set(returns) | set(visits))
    for branch_id in branches:
        if ctx.settings.dry_run:
            continue
        ctx.db.execute(
            "insert into day_count (day, branch_id, visits, loans, returns) values (%(day)s, %(branch)s, %(visits)s, %(loans)s, %(returns)s) on conflict (day, branch_id) do update set visits = excluded.visits, loans = excluded.loans, returns = excluded.returns",
            {"day": day, "branch": branch_id, "visits": visits.get(branch_id, 0), "loans": loans[branch_id], "returns": returns[branch_id]},
        )
    return {"branches": len(branches), "loans": sum(loans.values()), "returns": sum(returns.values()), "visits": sum(visits.values())}


# ----- keeping the database small -----


def archive_old_loans(ctx: JobContext) -> dict:
    """Moves the loans that ended more than two years ago to the archive table, in batches.

    The archive keeps the book and the day, not the member: after two years the
    library does not need to know who read what.
    """
    before = utc_now() - ARCHIVE_AFTER
    moved = 0
    while True:
        ids = [row["id"] for row in ctx.db.fetch_all("select id from loan where returned_at < %(before)s order by id limit %(limit)s", {"before": before, "limit": BATCH})]
        if not ids or ctx.settings.dry_run:
            break
        with ctx.db.transaction():
            ctx.db.execute(
                "insert into loan_archive (copy_id, lent_on, returned_on) select copy_id, lent_at::date, returned_at::date from loan where id = any(%(ids)s)",
                {"ids": ids},
            )
            ctx.db.execute("delete from loan where id = any(%(ids)s)", {"ids": ids})
        moved += len(ids)
    return {"loans_archived": moved}


def clean_web_sessions(ctx: JobContext) -> dict:
    """Removes the web sessions that ended more than SESSION_KEEP ago."""
    before = utc_now() - SESSION_KEEP
    removed = 0 if ctx.settings.dry_run else ctx.db.execute("delete from web_session where ended_at < %(before)s", {"before": before})
    return {"sessions_removed": removed}


# ----- the branches -----


def check_branch_hours(ctx: JobContext) -> dict:
    """Warns the desk of each branch that has no opening hours for a day of next week.

    The pickup days of holds and the due days of loans are counted in open days, so a
    week with no hours would give a member no day to come.
    """
    today = ctx.clock.today()
    next_week = [today + timedelta(days=step) for step in range(1, 8)]
    missing: dict[str, list[date]] = {}
    for branch_id in ctx.hours.branches():
        rules = ctx.hours.rules_for(branch_id)
        if rules is None:
            missing[branch_id] = next_week
            continue
        days = [day for day in next_week if not ctx.hours.has_entry(branch_id, day)]
        if days:
            missing[branch_id] = days
    for branch_id, days in missing.items():
        listed = ", ".join(day.strftime("%A %d %B") for day in days)
        log.warning("branch %s has no opening hours for %s; the pickup days of its holds count those days as closed", branch_id, listed)
        address = ctx.settings.desk_mail.get(branch_id)
        if address and not ctx.settings.dry_run:
            ctx.notices.send_desk_mail(address, f"No opening hours for {listed}", "Please enter the opening hours for these days, so that pickup days and due days can be worked out.")
    return {"branches_without_hours": len(missing)}


def refresh_reading_lists(ctx: JobContext) -> dict:
    """Counts the books of each shared reading list again, and how many of them are on the shelf now."""
    lists = ctx.db.fetch_all("select id from reading_list where shared", {})
    for batch in chunked([row["id"] for row in lists], 100):
        if ctx.settings.dry_run:
            continue
        ctx.db.execute(
            """
            update reading_list r set
                books = (select count(*) from reading_list_book b where b.list_id = r.id),
                on_shelf = (select count(*) from reading_list_book b join book_copy c on c.book_id = b.book_id where b.list_id = r.id and c.state = 'on_shelf')
            where r.id = any(%(ids)s)
            """,
            {"ids": batch},
        )
    return {"lists": len(lists)}


def send_desk_summary(ctx: JobContext, results: list[JobResult]) -> dict:
    """Sends each branch one mail with the work of the morning: the ready shelf, the overdue loans and the jobs that failed."""
    failed = [result for result in results if not result.ok]
    sent = 0
    for branch_id, address in sorted(ctx.settings.desk_mail.items()):
        ready = ctx.db.fetch_value("select count(*) from book_copy where state = 'ready_shelf' and branch_id = %(branch)s", {"branch": branch_id})
        overdue = ctx.db.fetch_value(
            "select count(*) from loan l join book_copy c on c.id = l.copy_id where l.returned_at is null and l.overdue and c.branch_id = %(branch)s",
            {"branch": branch_id},
        )
        lines = [
            f"Good morning, {branch_id}.",
            "",
            f"Ready shelf: {plural(ready, 'copy')} waiting to be picked up.",
            f"Overdue: {plural(overdue, 'loan')}.",
        ]
        if failed:
            lines += ["", "These night jobs failed and need a look:"]
            lines += [f"- {result.name}: {result.error}" for result in failed]
        else:
            lines += ["", f"All {len(results)} night jobs ran."]
        if not ctx.settings.dry_run:
            ctx.notices.send_desk_mail(address, f"The morning at {branch_id}", "\n".join(lines))
        sent += 1
    return {"mails": sent, "failed_jobs": len(failed)}


# ----- the run -----


Job = Callable[[JobContext], dict]

# The jobs in the order in which they run, with the words that the desk summary uses for each.
NIGHT_JOBS: list[tuple[str, Job, str]] = [
    ("remind_due_loans", remind_due_loans, "Reminders for loans that are due soon"),
    ("flag_overdue_loans", flag_overdue_loans, "Overdue loans"),
    ("renew_quiet_loans", renew_quiet_loans, "Loans renewed because nobody waits"),
    ("lending_night", lending_night, "The lending work of the night"),
    ("import_catalogue_feed", import_catalogue_feed, "New books from the suppliers"),
    ("rebuild_search_index", rebuild_search_index, "The search index of the catalogue"),
    ("count_the_day", count_the_day, "The numbers of the day"),
    ("archive_old_loans", archive_old_loans, "Old loans to the archive"),
    ("clean_web_sessions", clean_web_sessions, "Old web sessions"),
    ("check_branch_hours", check_branch_hours, "Opening hours of next week"),
    ("refresh_reading_lists", refresh_reading_lists, "Shared reading lists"),
]


def run_job(ctx: JobContext, name: str, job: Job) -> JobResult:
    """Runs one job, with a time limit for the log and the error kept for the summary."""
    started = time.monotonic()
    if not ctx.access.may_run(name):
        log.info("job %s is switched off for this library", name)
        return JobResult(name, True, {"skipped": True})
    try:
        counts = job(ctx)
        seconds = round(time.monotonic() - started, 1)
        log.info("job %s took %s seconds: %s", name, seconds, format_counts(counts))
        return JobResult(name, True, counts, seconds=seconds)
    except Exception as error:  # a failed job must not stop the night: the summary names it
        seconds = round(time.monotonic() - started, 1)
        log.exception("job %s failed after %s seconds", name, seconds)
        return JobResult(name, False, error=f"{type(error).__name__}: {error}", seconds=seconds)


def run_night(ctx: JobContext, only: Iterable[str] = ()) -> list[JobResult]:
    """Runs every night job, or only the named ones, then the lending work after the jobs and the desk summary.

    The lending work after the jobs looks at the books that waited too long for their
    member, so that they can go to the next member on the next night.
    """
    wanted = set(only)
    results = []
    for name, job, _words in NIGHT_JOBS:
        if wanted and name not in wanted:
            continue
        results.append(run_job(ctx, name, job))

    if ctx.settings.holds_enabled and not wanted:
        try:
            from library.lending.hold_service import HoldService
            moved = HoldService(ctx.db, ctx.clock, ctx.members, ctx.notices, ctx.hours).requeue_missed_pickups(ctx.clock.today())
            results.append(JobResult("lending_after_the_jobs", True, {"holds_back_in_line": len(moved)}))
        except Exception as error:
            log.exception("the holds whose pickup day passed were not moved back in line on %s", ctx.clock.today().isoformat())
            results.append(JobResult("lending_after_the_jobs", False, error=str(error)))

    if not wanted:
        results.append(JobResult("send_desk_summary", True, send_desk_summary(ctx, results)))
    log.info("night run done after %s seconds: %s of %s jobs ran", ctx.elapsed(), sum(result.ok for result in results), len(results))
    return results


def main(argv: list[str] | None = None) -> int:
    """The entry of the scheduler: `python -m library.night_jobs [job ...]`. Exits with 1 when a job failed."""
    import argparse

    parser = argparse.ArgumentParser(description="Run the night jobs of the library.")
    parser.add_argument("jobs", nargs="*", help="run only these jobs (default: all, then the desk summary)")
    parser.add_argument("--dry-run", action="store_true", help="read and count, but write nothing and send no mail")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

    from library.web.app import build_context

    ctx = build_context()
    ctx.settings.dry_run = args.dry_run
    unknown = [name for name in args.jobs if name not in {job_name for job_name, _job, _words in NIGHT_JOBS}]
    if unknown:
        parser.error(f"unknown job: {', '.join(unknown)}")
    results = run_night(ctx, args.jobs)
    return 0 if all(result.ok for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
