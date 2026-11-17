-- Holds: a member waits in line for a book that is out. When a copy comes back,
-- the first member in the line gets it for a few open days.
-- Holds take the place of reservations, which only told a member by mail.

create table book_hold (
    id bigint generated always as identity primary key,
    member_id bigint not null references member (id),
    book_id bigint not null references book (id),
    branch_id text not null,
    position integer not null,
    state text not null default 'waiting'
        check (state in ('waiting', 'paused', 'ready', 'collected', 'cancelled')),
    placed_at timestamptz not null default now(),
    copy_id bigint references book_copy (id),
    ready_at timestamptz,
    pickup_by date,
    paused_until date,
    collected_at timestamptz,
    cancelled_at timestamptz,
    notice_count integer not null default 0,
    last_notice_at timestamptz,
    note text not null default '',
    placed_by text not null default 'member',
    revision integer not null default 1,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    client_key uuid unique,
    -- a ready hold always has its copy and its last pickup day
    constraint book_hold_ready check (state <> 'ready' or (copy_id is not null and pickup_by is not null)),
    -- a paused hold says until when
    constraint book_hold_paused check (state <> 'paused' or paused_until is not null)
);

create unique index book_hold_place on book_hold (book_id, position);
create unique index book_hold_one_open on book_hold (member_id, book_id) where state in ('waiting', 'paused', 'ready');
create index book_hold_due on book_hold (pickup_by) where state = 'ready';

create table hold_event (
    id bigint generated always as identity primary key,
    hold_id bigint not null references book_hold (id),
    member_id bigint not null references member (id),
    copy_id bigint references book_copy (id),
    kind text not null,
    from_state text,
    to_state text not null,
    happened_at timestamptz not null default now(),
    actor text not null default 'system',
    detail jsonb not null default '{}'
);

create index hold_event_hold on hold_event (hold_id, happened_at);

-- The reservations end here. Open reservations become holds that wait, in the same order.
insert into book_hold (member_id, book_id, branch_id, position, state, placed_at, note)
select r.member_id, r.book_id, coalesce(m.home_branch_id, 'north'),
       row_number() over (partition by r.book_id order by r.created_at), 'waiting', r.created_at, 'moved from a reservation'
from reservation r join member m on m.id = r.member_id
where r.state = 'open';

drop table reservation_note;
drop table reservation;
