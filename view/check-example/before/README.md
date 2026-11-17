# The library app

A small app for a town library with four branches. Members borrow books, see their loans on the member page, and wait in line for books that are out. The desk of each branch sees what to do in the morning.

- `web/`: the web pages, in TypeScript and React.
- `src/library/`: the server, in Python: the routes, the lending rules and the night jobs.
- `db/migrations/`: the tables, one SQL file for each change.
- `tests/`: the tests of the server.
- `docs/`: the decisions, the handover notes and the guide for the desk.

This repo is made up. Nothing in it runs.
