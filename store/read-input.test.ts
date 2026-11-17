// Tests for the commands that read JSON from standard input, and for the draft file that is no file of the change and that a save removes.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeTestRepo, runApostil, tempFolder, testChangeFile } from '../shared/test-repo';

const map = { format: 1, diagrams: [{ id: 'top', kind: 'flow', title: 'The test repo', mermaid: 'flowchart LR\n  code --> docs', nodePaths: { code: ['src/'], docs: ['README.md'] } }] };
const area = { id: 'one', kind: 'flow', title: 'Area one', mermaid: 'flowchart LR\n  a --> b', parent: 'top', nodePaths: { a: ['src/app.py'], b: ['README.md'] } };

test('the real program reads the JSON from standard input, gives a plain problem for empty input and for input that is not JSON, and exits with 1 when it did not do its work', () => {
  const repo = makeTestRepo();
  const home = tempFolder('apostil-home-');
  // Standard input reaches only a program of its own, so this test starts the real one.
  const program = (input: string, ...args: string[]) =>
    spawnSync(process.execPath, [join(__dirname, 'cli.js'), ...args, '-', '--folder', repo.folder], { encoding: 'utf8', input, env: { ...process.env, APOSTIL_HOME: home } });
  const apostil = (...args: string[]) => runApostil([...args, '--folder', repo.folder], { env: { APOSTIL_HOME: home } });

  const saved = program(JSON.stringify(testChangeFile()), 'save');
  assert.equal(saved.status, 0);
  assert.equal(JSON.parse(saved.stdout).saved, true);
  assert.equal(JSON.parse(saved.stdout).draftRemoved, undefined); // standard input is never removed
  assert.equal(JSON.parse(apostil('list').stdout).length, 1);

  // Every command reads the JSON with one function: the change commands and the map commands alike.
  const empty = program('', 'check');
  assert.equal(empty.status, 1);
  assert.match(JSON.parse(empty.stdout).problems[0], /Standard input is empty/);
  const broken = program('{ nope', 'add-diagram');
  assert.equal(broken.status, 1);
  assert.match(JSON.parse(broken.stdout).problems[0], /Standard input is not JSON/);
  const file = join(tempFolder('apostil-draft-'), 'broken.json');
  writeFileSync(file, '{ nope');
  assert.match(JSON.parse(apostil('save', file).stdout).problems[0], /is not JSON/); // a bad file gives the same plain problem

  // The help names - for every command that reads JSON.
  const commands: string[] = JSON.parse(apostil('--help').stdout).commands;
  for (const name of ['check', 'save', 'open-points', 'check-map', 'save-map', 'add-diagram']) {
    const line = commands.find((text) => text.startsWith(`apostil ${name} `));
    assert.match(line ?? '', /or - for/, name);
  }
  repo.remove();
});

test('a draft file in the repo that Git does not track is no file of the change; a save removes it and says so, and keeps a refused, a tracked or an outside file', () => {
  const repo = makeTestRepo();
  const home = tempFolder('apostil-home-');
  const apostil = (...args: string[]) => runApostil([...args, '--folder', repo.folder], { env: { APOSTIL_HOME: home } });
  const put = (name: string, value: unknown) => { repo.write(name, JSON.stringify(value)); return join(repo.folder, name); };

  // An untracked draft is not counted; a refused one stays, check removes nothing, a save removes it.
  const draft = put('apostil-draft.json', { ...testChangeFile(), parts: [] });
  const refused = JSON.parse(apostil('save', draft).stdout);
  assert.equal(refused.saved, false);
  assert.equal(refused.draftRemoved, undefined);
  assert.equal(existsSync(draft), true);
  put('apostil-draft.json', testChangeFile());
  const checked = JSON.parse(apostil('check', draft).stdout);
  assert.equal(JSON.stringify(checked.checks).includes('apostil-draft.json'), false);
  assert.equal(checked.draftRemoved, undefined);
  assert.equal(existsSync(draft), true); // check removes nothing
  const saved = JSON.parse(apostil('save', draft).stdout);
  assert.equal(saved.saved, true);
  assert.equal(saved.draftRemoved, true);
  assert.equal(existsSync(draft), false);
  assert.equal(JSON.parse(apostil('list').stdout)[0].filesInNoPart, 0);

  // A tracked file of that name counts and is never removed; nor is a file outside the repo.
  put('apostil-draft.json', testChangeFile());
  repo.commit('track the draft');
  assert.equal(JSON.stringify(JSON.parse(apostil('check', draft).stdout).checks).includes('apostil-draft.json'), true);
  const tracked = JSON.parse(apostil('save', draft).stdout);
  assert.equal(tracked.saved, true);
  assert.equal(tracked.draftRemoved, undefined);
  assert.equal(existsSync(draft), true);
  const outside = join(tempFolder('apostil-outside-'), 'draft.json');
  writeFileSync(outside, JSON.stringify(testChangeFile()));
  assert.equal(JSON.parse(apostil('save', outside).stdout).draftRemoved, undefined);
  assert.equal(existsSync(outside), true);

  // open-points, save-map and add-diagram: two checkers have two files; the one that is saved goes, the one with a problem stays.
  const one = put('apostil-points-app.json', [{ kind: 'no-note', text: 'The stop has no note.' }]);
  const two = put('apostil-points-other.json', [{ kind: 'no-note' }]);
  assert.equal(JSON.parse(apostil('open-points', one, '--part', 'app').stdout).draftRemoved, true);
  assert.equal(apostil('open-points', two, '--part', 'app').status, 1);
  assert.equal(existsSync(one), false);
  assert.equal(existsSync(two), true);
  const badMap = put('apostil-map.json', { format: 1, diagrams: [] });
  assert.equal(apostil('save-map', badMap).status, 1);
  assert.equal(existsSync(badMap), true);
  const mapFile = put('apostil-map.json', map);
  assert.equal(JSON.parse(apostil('check-map', mapFile).stdout).draftRemoved, undefined);
  assert.equal(existsSync(mapFile), true);
  assert.equal(JSON.parse(apostil('save-map', mapFile).stdout).draftRemoved, true);
  assert.equal(existsSync(mapFile), false);
  const badArea = put('apostil-diagram-one.json', { ...area, parent: undefined });
  assert.equal(apostil('add-diagram', badArea).status, 1);
  assert.equal(existsSync(badArea), true);
  const areaFile = put('apostil-diagram-one.json', area);
  assert.equal(JSON.parse(apostil('add-diagram', areaFile).stdout).draftRemoved, true);
  assert.equal(existsSync(areaFile), false);
  repo.remove();
});
