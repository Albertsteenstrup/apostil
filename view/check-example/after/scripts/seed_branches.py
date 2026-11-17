"""Fills the table of branches on a new machine, and the opening hours of each branch.

Run it once after the migrations: `python scripts/seed_branches.py`.
A branch that is there already keeps its name and address.
"""

from library.web.app import build_context

BRANCHES = [
    ("north", "North", "1 Hill Road"),
    ("harbour", "Harbour", "12 Quay Street"),
    ("old-town", "Old Town", "3 Market Square"),
    ("station", "Station", "40 Station Road"),
]

# Monday to Saturday, the same hours in every branch to begin with.
HOURS = {day: ("09:00", "18:00") for day in range(6)}


def main() -> None:
    ctx = build_context()
    for branch_id, name, address in BRANCHES:
        ctx.db.execute(
            "insert into branch (id, name, address) values (%(id)s, %(name)s, %(address)s) on conflict (id) do nothing",
            {"id": branch_id, "name": name, "address": address},
        )
        for day, (opens, closes) in HOURS.items():
            ctx.hours.set_week_day(branch_id, day, opens, closes)
    print(f"{len(BRANCHES)} branches with their opening hours")


if __name__ == "__main__":
    main()
