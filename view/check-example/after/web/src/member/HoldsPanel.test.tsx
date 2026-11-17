// Tests of the Holds tab: the order of the holds, the words of each state, and what a click sends to the server.

import { HoldsPanel, sortHolds } from './HoldsPanel';
import { daysUntil, stateWords, type Hold } from './holdsApi';
import { click, fakeServer, renderPage, textOf, typeInto } from '../test/render';

const hold = (fields: Partial<Hold>): Hold => ({
  id: 1,
  title: 'The quiet garden',
  author: 'A. Writer',
  state: 'waiting',
  place: 2,
  branch_id: 'north',
  pickup_by: null,
  paused_until: null,
  ...fields,
});

test('ready holds come first, then waiting ones by their place, then paused ones', () => {
  const holds = [
    hold({ id: 1, state: 'paused', place: 1 }),
    hold({ id: 2, state: 'waiting', place: 3 }),
    hold({ id: 3, state: 'ready', place: 0 }),
    hold({ id: 4, state: 'waiting', place: 1 }),
  ];
  expect(sortHolds(holds).map((one) => one.id)).toEqual([3, 4, 2, 1]);
});

test('a waiting hold says its place in the line, and the first one says "You are next"', () => {
  expect(stateWords(hold({ place: 4 }))).toBe('Number 4 in the line');
  expect(stateWords(hold({ place: 1 }))).toBe('You are next');
});

test('a ready hold names its branch and its last pickup day', () => {
  expect(stateWords(hold({ state: 'ready', branch_id: 'harbour', pickup_by: '2026-03-10' }))).toMatch(/^Ready at Harbour until .*10/);
});

test('a paused hold says until when', () => {
  expect(stateWords(hold({ state: 'paused', paused_until: '2026-03-20' }))).toMatch(/^Paused until .*20/);
  expect(stateWords(hold({ state: 'paused' }))).toBe('Paused');
});

test('the days left count from today, and a day in the past gives none', () => {
  const today = new Date(2026, 2, 2);
  expect(daysUntil('2026-03-05', today)).toBe(3);
  expect(daysUntil('2026-03-02', today)).toBe(0);
  expect(daysUntil('2026-02-20', today)).toBe(0);
});

test('the tab lists the holds of the member, with the ready one first', async () => {
  const server = fakeServer({ 'GET /api/holds/mine': [hold({ id: 7, place: 2 }), hold({ id: 8, state: 'ready', pickup_by: '2026-03-10', title: 'A map of the harbour' })] });
  const page = await renderPage(<HoldsPanel homeBranch="north" />, server);
  expect(textOf(page, '.hold-book b')).toEqual(['A map of the harbour', 'The quiet garden']);
  expect(textOf(page, '.holds-head p')[0]).toMatch(/^You wait for 2 books\./);
});

test('with no hold the tab says so and still offers "Hold a book"', async () => {
  const page = await renderPage(<HoldsPanel homeBranch="north" />, fakeServer({ 'GET /api/holds/mine': [] }));
  expect(textOf(page, '.holds-head p')[0]).toMatch(/^You wait for no book\./);
  expect(textOf(page, '.holds-head button')).toEqual(['Hold a book']);
});

test('a failed load says why and offers "Try again", which loads again', async () => {
  const server = fakeServer({ 'GET /api/holds/mine': { status: 503, body: { message: 'The library is closed for a moment.' } } });
  const page = await renderPage(<HoldsPanel homeBranch="north" />, server);
  expect(textOf(page, '.holds-problem p')).toEqual(['The library is closed for a moment.']);
  server.answer('GET /api/holds/mine', []);
  await click(page, '.holds-problem button');
  expect(textOf(page, '.holds-head p')[0]).toMatch(/^You wait for no book\./);
});

test('"Pause" asks for a day, and the paused hold comes back from the server', async () => {
  const server = fakeServer({
    'GET /api/holds/mine': [hold({ id: 7 })],
    'POST /api/holds/7/pause': hold({ id: 7, state: 'paused', paused_until: '2026-03-20' }),
  });
  const page = await renderPage(<HoldsPanel homeBranch="north" />, server);
  await click(page, '.hold-actions button');
  await typeInto(page, '.hold-pause input[type="date"]', '2026-03-20');
  await click(page, '.hold-pause .primary');
  expect(server.sent('POST /api/holds/7/pause')).toEqual([{ until: '2026-03-20' }]);
  expect(textOf(page, '.badge')).toEqual([expect.stringMatching(/^Paused until/)]);
});

test('"Cancel" takes the hold off the list', async () => {
  const server = fakeServer({
    'GET /api/holds/mine': [hold({ id: 7 }), hold({ id: 9, title: 'Rivers' })],
    'DELETE /api/holds/9': hold({ id: 9, state: 'cancelled' }),
  });
  const page = await renderPage(<HoldsPanel homeBranch="north" />, server);
  await click(page, '.hold:nth-child(2) .quiet-button');
  expect(textOf(page, '.hold-book b')).toEqual(['The quiet garden']);
});

test('a refusal of the server stands above the list in its own words', async () => {
  const server = fakeServer({
    'GET /api/holds/mine': [hold({ id: 7, state: 'paused', paused_until: '2026-03-20' })],
    'POST /api/holds/7/resume': { status: 409, body: { message: 'Someone else changed this hold a moment ago. Look again and try once more.' } },
  });
  const page = await renderPage(<HoldsPanel homeBranch="north" />, server);
  await click(page, '.hold-actions button');
  expect(textOf(page, '.problem')).toEqual(['Someone else changed this hold a moment ago. Look again and try once more.']);
});

test('the count of the tab follows the list', async () => {
  const counts: number[] = [];
  const server = fakeServer({ 'GET /api/holds/mine': [hold({ id: 7 }), hold({ id: 8 })], 'DELETE /api/holds/8': hold({ id: 8, state: 'cancelled' }) });
  const page = await renderPage(<HoldsPanel homeBranch="north" onCount={(count) => counts.push(count)} />, server);
  await click(page, '.hold:nth-child(2) .quiet-button');
  expect(counts).toEqual([2, 1]);
});
