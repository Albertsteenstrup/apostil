-- The members, the books and the copies of the library.

create table branch (
    id text primary key,
    name text not null,
    address text not null
);

create table member (
    id bigint generated always as identity primary key,
    card_number text not null unique,
    name text not null,
    email text,
    home_branch_id text references branch (id),
    active boolean not null default true,
    joined_on date not null default current_date
);

create table book (
    id bigint generated always as identity primary key,
    isbn text unique,
    title text not null,
    author text not null,
    year integer,
    publisher text,
    pages integer,
    language text not null default 'en',
    subjects text,
    summary text
);

create table book_copy (
    id bigint generated always as identity primary key,
    book_id bigint not null references book (id),
    branch_id text not null references branch (id),
    state text not null default 'on_shelf'
        check (state in ('on_order', 'on_shelf', 'on_loan', 'returned', 'ready_shelf', 'lost')),
    added_on date not null default current_date,
    returned_at timestamptz
);

create index book_copy_book on book_copy (book_id);
create index book_copy_returned on book_copy (state, returned_at);

create table loan (
    id bigint generated always as identity primary key,
    copy_id bigint not null references book_copy (id),
    member_id bigint not null references member (id),
    lent_at timestamptz not null default now(),
    lent_by text not null,
    due_on date not null,
    returned_at timestamptz,
    renewals integer not null default 0,
    overdue boolean not null default false,
    reminded_on date,
    last_overdue_mail date
);

create index loan_open on loan (member_id) where returned_at is null;
