// Tests for the time left of a map run: a plan with nothing done, half done and with a slow pace, the time that the stage of now has run,
// the bar, the schedule of the writers (the longer of the longest chain and all work over 16 places, steps at the same time counted once), and a
// rise that one computation alone shows, which is held back.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expectedOf, shownTime, timeLeft, timeWords, type MapPlan, type SaveTime } from './map-estimate';

const START = Date.parse('2026-11-18T10:00:00.000Z');
const at = (minute: number): number => START + minute * 60_000;
const round = (minutes: number): number => Math.round(minutes * 100) / 100;

/**
 * A made-up plan of a repo of 5,000 code lines, before the overview: 2 areas, 20 notes groups of 60 files and 6,000 lines (the largest 400), 6 process
 * groups and 6 service groups.
 */
const plan: MapPlan = { at: 0, done: 0, lines: 5000, overview: 1, areas: 2, notes: 20, noteFiles: 60, noteLines: 6000, longest: 400, processes: 6, services: 6, again: 1, fit: 1 };
// The expected minutes: the overview 4.5 + 2; the writers: their work is 8 + 100 + 90 + 48 + 60 = 306 minutes, 19.1 over 16 places, and their longest
// chain the largest notes group (400 lines at 60 a minute), then a process writer and its second round: 6.67 + 15 + 8 = 29.67, + 2; the fit round 8 + 2.
const OVERVIEW = 6.5;
const WRITERS = 400 / 60 + 15 + 8 + 2;
const ALL = OVERVIEW + WRITERS + 10;

test('the time left of a plan with nothing done is its expected time, and the stage that runs now counts the time it has already run', () => {
  const start = timeLeft(plan, [], START, at(0));
  assert.equal(round(start.minutes), round(ALL));
  assert.equal(start.share, 0);
  // Three minutes in, nothing saved: the overview has run 3 of its 6.5 minutes.
  const three = timeLeft(plan, [], START, at(3));
  assert.equal(round(three.minutes), round(ALL - 3));
  assert.ok(three.share > 0.05 && three.share < 0.07, String(three.share));
  // A writer that takes long does not bring its stage to nothing: a tenth of it stays.
  assert.equal(round(timeLeft(plan, [], START, at(30)).minutes), round(ALL - OVERVIEW + 0.65));
});

test('the writers take the longer of their longest chain and all their work over 16 places; steps that run at the same time count once', () => {
  // The plan above: the chain is longer than the work over 16 places, and the steps of the writers are not added (that would be 6 + 18 + 17 + 12 + 10).
  assert.equal(round(expectedOf(plan)), round(ALL));
  // A large repo: 200 notes groups of 80,000 lines and 40 groups of processes and of services; the work over 16 places is longer than any chain.
  const large: MapPlan = { ...plan, lines: 80000, areas: 8, notes: 200, noteFiles: 600, noteLines: 80000, longest: 400, processes: 40, services: 40 };
  const work = 8 * 4 + 80000 / 60 + 40 * 15 + 40 * 8 + 40 * 10;
  assert.equal(round(expectedOf(large)), round(4 + 8 + 2 + work / 16 + 2 + 10));
  // A long file is one writer's: a file of 4,000 lines makes the chain 66.7 minutes of notes, then a process writer and its second round.
  const long: MapPlan = { ...plan, noteLines: 6000, longest: 4000 };
  assert.equal(round(expectedOf(long)), round(OVERVIEW + 4000 / 60 + 15 + 8 + 2 + 10));
  // A plan of an older version has no lines of its groups: each group counts 400 lines.
  const old: MapPlan = { ...plan, noteLines: undefined, longest: undefined };
  assert.equal(round(expectedOf(old)), round(OVERVIEW + Math.max(400 / 60 + 23, (8 + 20 * 400 / 60 + 90 + 48 + 60) / 16) + 2 + 10));
});

test('the time left of a plan half done at the expected pace is the expected time left; a slow pace makes it longer, and the bar is not behind', () => {
  // The overview, both areas and all notes saved, the last save at the minute that the plan expects: the writers have done 108 of their 306 minutes.
  const doneAt = OVERVIEW + WRITERS * 108 / 306;
  const onTime: SaveTime[] = [['o', OVERVIEW], ['a', 9], ['a', 10], ['n', 14, 30], ['n', doneAt, 30]];
  const half = timeLeft(plan, onTime, START, at(doneAt));
  assert.equal(round(half.minutes), round(ALL - doneAt));
  assert.ok(Math.abs(half.share - doneAt / ALL) < 0.001, String(half.share));
  // The same work took twice as long: the pace counts by the share done, so the time left grows, but less than double.
  const slow: SaveTime[] = onTime.map(([kind, minute, files]) => [kind, minute * 2, files] as SaveTime);
  const late = timeLeft(plan, slow, START, at(doneAt * 2));
  assert.ok(late.minutes > half.minutes * 1.05 && late.minutes < half.minutes * 1.5, `${late.minutes} against ${half.minutes}`);
  // The bar moves by the expected work done and the time that the stage of now has run: for the same work it is never behind.
  assert.ok(late.share >= half.share - 0.001, `${late.share} against ${half.share}`);
  // Early in a run the pace stays near 1: the overview alone took twice its time.
  const early = timeLeft(plan, [['o', 13]], START, at(13));
  assert.ok(early.minutes < (ALL - OVERVIEW) * 1.15, String(early.minutes)); // the overview is 13% of the work: the pace grows by that share of its slowness
});

test('the work before a plan counts in the bar; a plan made after the overview starts where the old one ended', () => {
  const after: MapPlan = { ...plan, at: OVERVIEW, done: OVERVIEW, overview: 0 };
  const result = timeLeft(after, [['o', OVERVIEW]], START, at(OVERVIEW));
  assert.equal(round(result.minutes), round(ALL - OVERVIEW));
  assert.ok(Math.abs(result.share - OVERVIEW / ALL) < 0.001);
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
