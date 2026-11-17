// Tests of the desk screen: the board in groups, and the books to put aside for a member.

import { DeskScreen } from './DeskScreen';
import { fakeServer, renderPage, textOf } from '../test/render';

const board = {
  branch_id: 'north',
  day: 'Monday 2 March',
  tasks: [
    { kind: 'overdue', title: 'The quiet garden is overdue since 20 February', member_id: 10, copy_id: 501, since: '2026-02-20' },
    { kind: 'overdue', title: 'Rivers is overdue since 25 February', member_id: 11, copy_id: 502, since: '2026-02-25' },
    { kind: 'lost', title: 'A map of the harbour is lost', member_id: null, copy_id: 503, since: null },
  ],
  counts: { overdue: 2, lost: 1 },
};

test('the board groups the tasks of the morning by kind, with a count for each', async () => {
  const server = fakeServer({ 'GET /api/desk/north/board': board, 'GET /api/desk/north/reservations': [] });
  const page = await renderPage(<DeskScreen branchId="north" branchName="North" />, server);
  expect(textOf(page, '.desk-group h2')).toEqual(['Overdue · 2', 'Lost · 1']);
});

test('a board that cannot be loaded says why', async () => {
  const server = fakeServer({ 'GET /api/desk/north/board': { status: 500, body: {} }, 'GET /api/desk/north/reservations': [] });
  const page = await renderPage(<DeskScreen branchId="north" branchName="North" />, server);
  expect(textOf(page, '.desk-board .problem')[0]).toMatch(/could not load/);
});

test('the reserved books that came back are listed to put aside, with their member', async () => {
  const server = fakeServer({
    'GET /api/desk/north/board': board,
    'GET /api/desk/north/reservations': [
      { id: 1, member_id: 10, member_name: 'Member 10', title: 'Rivers', told_on: '2026-03-01' },
      { id: 2, member_id: 12, member_name: 'Member 12', title: 'The quiet garden', told_on: null },
    ],
  });
  const page = await renderPage(<DeskScreen branchId="north" branchName="North" />, server);
  expect(textOf(page, '.put-aside li')).toEqual(['Rivers for Member 10 · told on 2026-03-01', 'The quiet garden for Member 12']);
  expect(textOf(page, '.desk-queue h2')[1]).toBe('Put aside for a member · 2');
});
