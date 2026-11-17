// Tests for the steps of the one question in a repo with no map.

import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tempFolder } from '../shared/test-repo';
import { thisInstall } from '../store/setup';
import { connectedApps, newRepoStep } from './new-repo-steps';

test('a repo with no map asks the map question when an app is connected, else the question that connects, and nothing twice; an app is connected when it has every skill for this repo or for all repos', () => {
  const fresh = { map: false, asked: false, connected: 0, setUpAskedNow: false };
  assert.equal(newRepoStep({ ...fresh, connected: 1 }), 'map');
  assert.equal(newRepoStep(fresh), 'connect');
  assert.equal(newRepoStep({ ...fresh, setUpAskedNow: true }), 'wait'); // the set-up question was open a moment ago: the next window asks
  assert.equal(newRepoStep({ ...fresh, connected: 2, setUpAskedNow: true }), 'map'); // he set up at the first start: the map question follows at once
  assert.equal(newRepoStep({ ...fresh, map: true, connected: 1 }), 'nothing');
  assert.equal(newRepoStep({ ...fresh, asked: true, connected: 1 }), 'nothing');

  // An app is connected when it has every skill for this repo or for all repos; Claude Code comes first.
  const install = thisInstall();
  const names = readdirSync(install.skills, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const [repo, home, empty] = [tempFolder('apostil-repo-'), tempFolder('apostil-home-'), tempFolder('apostil-home-')];
  const give = (base: string, skills: string, list = names) => { for (const name of list) { mkdirSync(join(base, skills), { recursive: true }); cpSync(join(install.skills, name), join(base, skills, name), { recursive: true }); } };
  const apps = ['codex', 'claude-code'];
  assert.deepEqual(connectedApps(apps, repo, { home: empty, path: '' }, install), []);
  give(repo, '.agents/skills');
  assert.deepEqual(connectedApps(apps, repo, { home: empty, path: '' }, install), ['codex']); // for this repo
  give(home, '.claude/skills');
  assert.deepEqual(connectedApps(apps, repo, { home, path: '' }, install), ['claude-code', 'codex']); // for all repos, and Claude Code first
  give(empty, '.claude/skills', names.slice(0, 1));
  assert.deepEqual(connectedApps(apps, repo, { home: empty, path: '' }, install), ['codex']); // one skill of several is not connected
  assert.deepEqual(connectedApps(['codex'], repo, { home, path: '' }, install), ['codex']); // only an app that is on the path is offered
});

