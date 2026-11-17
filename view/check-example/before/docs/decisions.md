# Decisions

Short notes on the choices that shape the app, the newest last.

## Loans are counted in open days

A loan is due after a number of open days of its branch, not calendar days. A branch that is closed for a week does not make a loan overdue.

## One night run

All work that can wait runs once a night, in `src/library/night_jobs.py`. A job that fails does not stop the others, and the desk summary of the morning names it.

## Reminders, never fines

The library sends reminders for loans that are due and overdue. It does not charge anything. A member who keeps a book too long gets a reminder each week.

## Reservations

A member who wants a book that is out can reserve it. The night run mails the members whose book came back, in the order in which they reserved it. The desk puts the book aside by hand.
