// Tests for the shared format and the shared store, also a store from each earlier version.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { shapeProblems, type ChangeFile } from './change-file';
import { notesOfFile } from './notes-beside-code';
import { Store, type CheckResult } from './store';
import { testChangeFile } from './test-repo';

const example = (): ChangeFile => testChangeFile(); // a made-up change file, kept in the tests: the repo holds no change of a real product
const noProblems: CheckResult = { filesInNoPart: [], filesInTwoParts: [], filesNotChanged: [], generated: [], badNotes: [] };
const tempHome = (): string => mkdtempSync(join(tmpdir(), 'apostil-'));

test('the example change file has the right shape, and a broken one lists its problems', () => {
  assert.deepEqual(shapeProblems(example()), []);
  const file = example();
  file.parts[0].id = 'Not Valid';
  file.links.push({ from: 'somewhere', to: 'nowhere' });
  assert.equal(shapeProblems(file).length, 4); // the id, two links and a diagram that name a missing part
});

test('a branch has one change: a new save keeps its remarks and its first save time; open points, remarks and the app state come back as they were saved', async () => {
  const store = new Store(tempHome());
  const change = { repoId: 'repo', folder: '/work', branch: 'fix', base: 'aaa', head: 'bbb', file: example(), checks: noProblems };
  const id = store.saveChange(change);
  const first = store.getChange(id)!;
  assert.equal(first.firstSavedAt, first.savedAt);
  store.addRemark(id, { kind: 'part', part: 'app', label: 'Part "App"' }, 'Why before the run?');
  await new Promise((done) => setTimeout(done, 5));
  assert.equal(store.saveChange({ ...change, head: 'ccc' }), id);
  assert.equal(store.listChanges('repo').length, 1);
  const again = store.getChange(id)!;
  assert.equal(again.head, 'ccc');
  assert.ok(again.savedAt > first.savedAt);
  assert.equal(again.firstSavedAt, first.savedAt);
  assert.equal(store.remarks(id).length, 1);
  store.markRemarksSent(id);

  store.setOpenPoints(id, [{ kind: 'no-note', text: 'A lookup error is not logged.', file: 'a.py', lines: [3, 4] }]);
  const [point] = store.openPoints(id);
  assert.deepEqual(point.lines, [3, 4]);
  store.markOpenPointUsed(point.id);
  store.logView(id, 42);
  assert.deepEqual(store.usage('repo')[0], { changeId: id, branch: 'fix', filesInNoPart: 0, openPoints: 1, openPointsUsed: 1, secondsOpen: 42 });
  // A check of one part replaces only the points of that part.
  store.setOpenPoints(id, [{ kind: 'no-note', text: 'The table has no index.' }], 'table');
  store.setOpenPoints(id, [], 'app');
  assert.deepEqual(store.openPoints(id).map((open) => open.part), [undefined, 'table']);

  store.addRemark(id, { kind: 'lines', file: 'a.py', lines: [3, 4] }, 'Log this error.');
  assert.equal(store.remarks(id, true).length, 1);
  store.markRemarksSent(id);
  assert.equal(store.remarks(id, true).length, 0);

  store.setAppState({ changeId: id, view: 'code', file: 'a.py', lines: [3, 4] });
  assert.equal(store.appState().file, 'a.py');
  store.close();
});

test('a store from each earlier version opens, gets the columns and tables that were added later, and works', () => {
  const oldStore = (sql: string): string => {
    const home = tempHome();
    const old = new DatabaseSync(join(home, 'apostil.sqlite'));
    old.exec(sql);
    old.close();
    return home;
  };
  const firstChange = `create table change (id integer primary key, repo_id text not null, folder text not null, branch text not null,
    base text not null, head text not null, saved_at text not null, file_json text not null, checks_json text not null, missing_since text, unique (repo_id, branch))`;

  // From before the agent column, the kept text of notes and the table of kept notes: a change saved in it has no agent and no notes.
  const first = oldStore(firstChange);
  const seed = new DatabaseSync(join(first, 'apostil.sqlite'));
  seed.prepare('insert into change (repo_id, folder, branch, base, head, saved_at, file_json, checks_json) values (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('r1', '/made-up', 'feature', 'b1', 'h1', '2026-01-01T00:00:00Z', JSON.stringify(example()), JSON.stringify(noProblems));
  seed.close();
  const store = new Store(first);
  const [change] = store.listChanges('r1');
  assert.deepEqual([change.branch, change.agent, change.noteCode], ['feature', undefined, undefined]);
  assert.deepEqual(store.keptNotes('r1'), []);
  assert.deepEqual(notesOfFile(store.listChanges('r1'), 'src/app.py', 'def stop():\n    return 0\n', () => undefined), { notes: [], older: 0 });
  store.close();

  // From before the column of the part of an open point.
  const points = new Store(oldStore('create table open_point (id integer primary key, change_id integer not null, kind text not null, text text not null, file text, line_from integer, line_to integer, used integer not null default 0)'));
  const id = points.saveChange({ repoId: 'repo', folder: '/work', branch: 'fix', base: 'aaa', head: 'bbb', file: example(), checks: noProblems });
  points.setOpenPoints(id, [{ kind: 'no-note', text: 'A lookup error is not logged.' }], 'app');
  assert.equal(points.openPoints(id)[0].part, 'app');
  points.close();

  // From before the map table: no map, and a map can be saved.
  const maps = new Store(oldStore('create table app_state (id integer primary key check (id = 1), state_json text not null)'));
  assert.equal(maps.getMap('r1'), undefined);
  maps.saveMap('r1', 'c1', { format: 1, diagrams: [{ id: 'top', kind: 'flow', title: 'Top', mermaid: 'flowchart LR\n  code --> docs', nodePaths: { code: ['src/'], docs: ['README.md'] } }] });
  assert.equal(maps.getMap('r1')?.commit, 'c1');
  maps.close();

  // From before the states, threads and closed_by of a remark.
  const remarks = new Store(oldStore(`${firstChange};
    create table remark (id integer primary key, change_id integer not null, target_json text not null, text text not null, created_at text not null, sent_at text);
    insert into change values (1, 'r', '/f', 'b', 'a', 'h', 'x', '{}', '{}', null);
    insert into remark values (1, 1, '{"kind":"part"}', 'Old remark', 'x', null);`));
  assert.equal(remarks.remarks(1)[0].state, 'open');
  assert.equal(remarks.getChange(1)?.agent, undefined);
  assert.equal(remarks.answerRemark(1, 'ok')?.state, 'done');
  assert.equal(remarks.remarks(1)[0].thread, undefined); // a store of a version with no thread column
  const reply = remarks.addRemark(1, { kind: 'part' }, 'A reply', 1);
  assert.deepEqual(remarks.threadOf(reply).map((remark) => remark.id), [1, reply]);
  remarks.closeRemark(1, 'codex'); // a store of a version with no closed_by column
  assert.equal(remarks.remarks(1)[0].closedBy, 'codex');
  remarks.close();

  // From before the remarks on the map: every remark is there, and then a remark with no change can be held.
  const onMapHome = oldStore(`create table change (id integer primary key, repo_id text not null, folder text not null, branch text not null, base text not null,
    head text not null, saved_at text not null, file_json text not null, checks_json text not null, missing_since text, agent_json text, unique (repo_id, branch));
    create table remark (id integer primary key, change_id integer not null references change(id) on delete cascade, target_json text not null, text text not null,
      created_at text not null, sent_at text, state text not null default 'open', answer text, answered_at text, run_json text, thread integer, to_json text, closed_by text);
    insert into change values (1, 'r', '/f', 'b', 'a', 'h', 'x', '{}', '{}', null, null);
    insert into remark values (1, 1, '{"kind":"part"}', 'Old remark', 'x', null, 'done', 'Fixed', 'y', null, null, null, null);`);
  const onMap = new Store(onMapHome);
  assert.deepEqual(onMap.remarks(1).map((remark) => [remark.id, remark.text, remark.state, remark.answer]), [[1, 'Old remark', 'done', 'Fixed']]);
  const mapRemark = onMap.addRepoRemark('r', { kind: 'node', diagram: 'top', node: 'code', label: 'Node "Code"' }, 'What is in here?');
  assert.deepEqual(onMap.repoRemarks('r').map((remark) => [remark.id, remark.changeId, remark.repoId, remark.text]), [[mapRemark, undefined, 'r', 'What is in here?']]);
  assert.deepEqual(onMap.remarks(1).map((remark) => remark.id), [1]); // the change does not list it
  onMap.sendRemark(mapRemark, { app: 'claude-code', kind: 'new' });
  assert.equal(onMap.answerRemark(mapRemark, 'It holds the app.')?.state, 'done'); // "apostil answer" works by id
  onMap.removeChange(1); // a remark on the map stays when a change goes
  assert.equal(onMap.getRemark(mapRemark)?.answer, 'It holds the app.');
  onMap.close();
  const reopened = new Store(onMapHome);
  assert.equal(reopened.repoRemarks('r').length, 1); // opened again, the made table stays
  reopened.close();
});

test('eight processes that open the store and save at the same time all succeed', async () => {
  const folder = tempHome();
  const first = new Store(folder);
  const id = first.saveChange({ repoId: 'repo', folder: '/work', branch: 'fix', base: 'aaa', head: 'bbb', file: example(), checks: noProblems });
  first.close();
  const script = `const { Store } = require(${JSON.stringify(join(__dirname, 'store.js'))});
    for (let round = 0; round < 10; round++) {
      const store = new Store(${JSON.stringify(folder)});
      store.setOpenPoints(${id}, [{ kind: 'no-note', text: 'Point of ' + process.argv[1] }], process.argv[1]);
      store.close();
    }`;
  const run = (part: string) => new Promise<string>((resolve) => execFile(process.execPath, ['-e', script, part], (error, _out, err) => resolve(error ? err : '')));
  const errors = await Promise.all(Array.from({ length: 8 }, (_, index) => run(`part-${index}`)));
  assert.deepEqual(errors.filter(Boolean), []);
  const store = new Store(folder);
  assert.equal(store.openPoints(id).length, 8); // one point for each part: a save replaces only its own part
  store.close();
});
