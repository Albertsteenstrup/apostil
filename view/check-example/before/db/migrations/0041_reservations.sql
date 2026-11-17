-- Reservations: a member asks to be told when a book that is out comes back.
-- The desk tells the members in the order in which they asked.

create table reservation (
    id bigint generated always as identity primary key,
    member_id bigint not null references member (id),
    book_id bigint not null references book (id),
    state text not null default 'open' check (state in ('open', 'told', 'archived', 'closed')),
    created_at timestamptz not null default now(),
    told_on date
);

create index reservation_open on reservation (book_id, created_at) where state = 'open';

create table reservation_note (
    id bigint generated always as identity primary key,
    reservation_id bigint not null references reservation (id),
    text text not null,
    written_at timestamptz not null default now()
);
