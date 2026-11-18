// Tests for the time left of a map run (build 84): a plan with nothing done, half done and with a slow pace, the time that the step of now has run,
// the bar, and a rise that one computation alone shows, which is held back.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shownTime, timeLeft, timeWords, type MapPlan, type SaveTime } from './map-estimate';

const START = Date.parse('2026-11-18T10:00:00.000Z');
const at = (minute: number): number => START + minute * 60_000;

/** A made-up plan of a repo of 5,000 code lines, before the overview: 2 areas, 20 notes groups of 60 files, 6 process groups and 6 service groups. */
const plan: MapPlan = { at: 0, done: 0, lines: 5000, overview: 1, areas: 2, notes: 20, noteFiles: 60, processes: 6, services: 6, again: 1, fit: 1 };
// The expected minutes: the overview 4.5 + 2, the areas 4 + 2, the notes 2 waves of 8 + 2, the processes 15 + 2, the services 10 + 2, the second round
// 8 + 2, the fit round 8 + 2: 79.5 in all.
const ALL = 79.5;

test('the time left of a plan with nothing done is its expected time, and the step that runs now counts the time it has already run', () => {
  const start = timeLeft(plan, [], START, at(0));
  assert.equal(start.minutes, ALL);
  assert.equal(start.share, 0);
  // Three minutes in, nothing saved: the overview step has run 3 of its 6.5 minutes.
  const three = timeLeft(plan, [], START, at(3));
  assert.equal(Math.round(three.minutes * 10) / 10, ALL - 3);
  assert.ok(three.share > 0.03 && three.share < 0.04, String(three.share));
  // A writer that takes long does not bring its step to nothing: a tenth of the step stays.
  assert.equal(Math.round(timeLeft(plan, [], START, at(30)).minutes * 100) / 100, Math.round((ALL - 6.5 + 0.65) * 100) / 100);
});

test('the time left of a plan half done at the expected pace is about half; a slow pace makes it longer, more so as more is done', () => {
  // The overview, both areas and all notes saved, at the minutes that the plan expects: 6.5 + 6 + 18 = 30.5 of 79.5 minutes done.
  const onTime: SaveTime[] = [['o', 6.5], ['a', 12], ['a', 12.5], ['n', 21.5, 30], ['n', 30.5, 30]];
  const half = timeLeft(plan, onTime, START, at(30.5));
  assert.equal(Math.round(half.minutes), Math.round(ALL - 30.5));
  assert.ok(Math.abs(half.share - 30.5 / ALL) < 0.01, String(half.share));
  // The same work took twice as long: the pace counts by the share done (37%), so the time left grows by about a third, not double.
  const slow: SaveTime[] = onTime.map(([kind, minute, files]) => [kind, minute * 2, files] as SaveTime);
  const late = timeLeft(plan, slow, START, at(61));
  const pace = 1 + (2 - 1) * (30.5 / ALL);
  assert.equal(Math.round(late.minutes), Math.round((ALL - 30.5) * pace));
  assert.ok(late.minutes > half.minutes * 1.3 && late.minutes < half.minutes * 1.45, `${late.minutes} against ${half.minutes}`);
  // The bar moves by the expected work done, not by the pace: the same share for the same work.
  assert.ok(Math.abs(late.share - half.share) < 0.001);
  // Early in a run the pace stays near 1: the overview alone took twice its time.
  const early = timeLeft(plan, [['o', 13]], START, at(13));
  assert.ok(early.minutes < (ALL - 6.5) * 1.1, String(early.minutes));
});

test('the work before a plan counts in the bar; a plan made after the overview starts where the old one ended', () => {
  const after: MapPlan = { ...plan, at: 6.5, done: 6.5, overview: 0 };
  const result = timeLeft(after, [['o', 6.5]], START, at(6.5));
  assert.equal(result.minutes, ALL - 6.5);
  assert.ok(Math.abs(result.share - 6.5 / ALL) < 0.001);
});

test('a rise that one computation alone shows is held back; a second one that agrees shows the smaller of the two; a fall shows at once', () => {
  let shown = shownTime(undefined, 14.2);
  assert.deepEqual(shown, { minutes: 14 });
  shown = shownTime(shown, 16.4); // a rise: held back
  assert.deepEqual(shown, { minutes: 14, rise: 16 });
  shown = shownTime(shown, 13.6); // a fall: at once, and the held rise is gone
  assert.deepEqual(shown, { minutes: 14 });
  shown = shownTime(shown, 17);
  shown = shownTime(shown, 19); // two in a row agree on a rise: the smaller of the two
  assert.deepEqual(shown, { minutes: 17 });
  shown = shownTime(shown, 0.4); // under a minute: 0, which Home says in words
  assert.deepEqual(shown, { minutes: 0 });
  assert.deepEqual([timeWords(0), timeWords(14)], ['Less than a minute left', 'About 14 min left']);
});
