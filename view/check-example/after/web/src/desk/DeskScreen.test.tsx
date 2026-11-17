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
