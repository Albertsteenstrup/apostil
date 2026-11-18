// Tests for the choice of the app that the press "Map this repo" starts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appToStart, type StartedRun } from './map-app';

const run = (app: string, at: string, repoId = 'here'): StartedRun => ({ app, at, repoId });
const installed = ['claude-code', 'codex', 'opencode'];

test('the press starts the app that Apostil started last in this repo (a map run or a comment run, whichever is newer)', () => {
  const runs = [run('codex', '2026-11-10T10:00:00Z'), run('opencode', '2026-11-12T10:00:00Z'), run('claude-code', '2026-11-14T10:00:00Z', 'other')];
  assert.equal(appToStart(runs, 'here', installed, ['claude-code']), 'opencode');
});

test('with no run in this repo the press starts the app of the newest run in any repo', () => {
  const runs = [run('codex', '2026-11-10T10:00:00Z', 'other'), run('opencode', '2026-11-12T10:00:00Z', 'third')];
  assert.equal(appToStart(runs, 'here', installed, ['claude-code']), 'opencode');
});

test('with no run at all it starts the first installed app that is connected, else the first installed app', () => {
  assert.equal(appToStart([], 'here', installed, ['codex', 'opencode']), 'codex');
  assert.equal(appToStart([], 'here', installed, []), 'claude-code');
});

test('an app that is not installed any more is passed over, and with no installed app there is none', () => {
  const runs = [run('antigravity', '2026-11-12T10:00:00Z'), run('codex', '2026-11-10T10:00:00Z')];
  assert.equal(appToStart(runs, 'here', installed, []), 'codex');
  assert.equal(appToStart(runs, 'here', [], []), undefined);
});
