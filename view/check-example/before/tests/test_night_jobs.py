"""Tests of the night run: the order of the jobs, a job that fails, and the dry run."""

from __future__ import annotations

from datetime import date

from library import night_jobs
from library.night_jobs import JobContext, JobResult, NightSettings, format_counts, run_job
from tests.fakes import FakeClock, FakeDatabase, FakeHours, FakeMembers, FakeNotices


class AllowAll:
    def may_run(self, name: str) -> bool:
        return True


def make_context(**settings) -> JobContext:
    return JobContext(FakeDatabase(), FakeClock(date(2026, 3, 2)), FakeMembers.active(1), FakeNotices(), FakeHours(), AllowAll(), NightSettings(**settings))


def test_counts_read_as_one_line():
    assert format_counts({"offered": 3, "passed_over": 1, "skipped": True}) == "offered 3, passed over 1"
    assert format_counts({}) == "nothing to report"


def test_a_failed_job_is_kept_for_the_summary():
    def broken(ctx):
        raise ValueError("the feed is empty")

    result = run_job(make_context(), "import_catalogue_feed", broken)
    assert result == JobResult("import_catalogue_feed", False, error="ValueError: the feed is empty", seconds=result.seconds)


def test_the_jobs_run_in_the_order_of_the_list():
    names = [name for name, _job, _words in night_jobs.NIGHT_JOBS]
    assert names[0] == "remind_due_loans"
    assert names.index("lending_night") < names.index("rebuild_search_index")
