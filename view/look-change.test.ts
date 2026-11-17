// Tests for the look on the page of a change and in the file tab (build 60): the look of a repo with no map, the list of diffs in the order of a
// rule, the view that opens first, the order of the open points, "where" on the state of a thread and on the check of a note, the marks in the
// margin, what set-look says it picks on the page, and the new parts of the one list with the sentences of the check. On the made-up example.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { ChangeFile } from '../shared/change-file';
import { checkChangeFile } from '../shared/checks';
import { currentBranch, repoId } from '../shared/git';
import { apostilCommands, LOOK_PARTS, lookProblems, type Look, type LookContext } from '../shared/look';
import type { RepoMap } from '../shared/repo-map';
import { Store } from '../shared/store';
import { tempFolder } from '../shared/test-repo';
import { lookChanges } from '../store/look-changes';
import { setLook } from '../store/marks-save';
import { EXAMPLE_LOOK, makeCheckExample } from './check-example';
import { filePage, lookOfPage } from './page-data';

/* eslint-disable @typescript-eslint/no-require-imports */
const Marks = require('../../view/media/marks.js');
const CodeNotes = require('../../view/media/code-notes.js');
/* eslint-enable @typescript-eslint/no-require-imports */

const example = makeCheckExample();
after(() => example.remove());
const look = (rules: unknown[]) => ({ rules, one: ['content', 'click'] });

// A small made-up page of a change: two parts, a test file and a data file in no part.
const page = {
  title: 'A change', linksChecked: false, links: [], diagrams: [], remarks: [], openPoints: [],
  files: [['a/one.py', 5], ['a/two.py', 9], ['b/three.py', 2], ['tests/test_one.py', 7], ['data.json', 1]].map(([path, added]) => ({ path, added, removed: 0 })),
  parts: [{ id: 'a', name: 'A', files: ['a/one.py', 'a/two.py'] }, { id: 'b', name: 'B', files: ['b/three.py'] }],
  checks: { filesInNoPart: ['tests/test_one.py', 'data.json'], generated: [] },
};
const ofKind = (kind: string) => Marks.changeThings(page).filter((thing: { kind: string }) => thing.kind === kind);

test('lookOfPage gives the look of the repo to the whole page, also for a repo with no map', () => {
  const store = new Store(tempFolder('apostil-store-'));
  const saved = setLook(store, example.folder, { rules: [{ pick: { kind: 'change-card' }, content: { fields: ['title', 'files'] } }] });
  assert.equal(saved.saved, true, JSON.stringify(saved));
  assert.equal(store.getMap(repoId(example.folder)), undefined);
  const given = lookOfPage(store, filePage(example.folder));
  assert.ok(given?.custom && given.rules.some((rule) => rule.pick.kind === 'change-card'), JSON.stringify(given?.rules));
  store.close();
});

test('the list of diffs: the files of each part in the order of a rule, and a part whose files a rule leaves out is left out; a rule can group by another field', () => {
  const groups = (rules: unknown[]) => CodeNotes.filesByPart({ ...page, look: look(rules) }).map((group: { name: string; paths: string[] }) => `${group.name}: ${group.paths.join(' ')}`);
  assert.deepEqual(groups([]), ['A: a/one.py a/two.py', 'B: b/three.py', 'In no part: tests/test_one.py data.json']);
  assert.deepEqual(groups([{ pick: { kind: 'diff-file', where: { part: 'b' } }, show: { shown: false } }, { pick: { kind: 'diff-file' }, order: { by: 'added', down: true } }]),
    ['A: a/two.py a/one.py', 'In no part: tests/test_one.py data.json']);
  assert.deepEqual(groups([{ pick: { kind: 'diff-file', paths: ['tests/'] }, show: { shown: false } }, { pick: { kind: 'diff-file' }, order: { group: 'type' } }]), ['code: a/one.py a/two.py b/three.py', 'data: data.json']);
});

test('the views: the first view of a rule opens first, and when a rule leaves out a view the next one opens', () => {
  const views = (rules: unknown[]) => Marks.shownInOrder(ofKind('change-view'), look(rules)).map((view: { id: string }) => view.id);
  assert.deepEqual(views([]), ['diagram', 'diffs', 'conversation']);
  assert.deepEqual(views([{ pick: { kind: 'change-view' }, order: { first: ['diffs'] } }]), ['diffs', 'diagram', 'conversation']);
  assert.deepEqual(views([{ pick: { kind: 'change-view', where: { id: 'diagram' } }, show: { shown: false } }]), ['diffs', 'conversation']);
});

test('the open points in the order and groups of a rule, by their fields', () => {
  const points = [
    { id: 1, kind: 'no-note', file: 'b/three.py', lines: [1, 2] }, { id: 2, kind: 'note-not-supported', file: 'a/one.py', lines: [3, 3] },
    { id: 3, kind: 'thing-not-supported', diagram: 'flow', node: 'n' }, { id: 4, kind: 'no-note', file: 'a/one.py', lines: [9, 9] },
  ].map((point) => Marks.pointThing(point, page));
  assert.deepEqual(points[1].fields, { type: 'note', file: 'a/one.py', part: 'a', diagram: '' });
  const grouped = (order: unknown) => Marks.orderRows(points, Marks.listOrder(points, look([{ pick: { kind: 'open-point' }, order }]))).map(({ group, rows }: { group: string; rows: { id: number }[] }) => `${group}: ${rows.map((row) => row.id).join(' ')}`);
  assert.deepEqual(grouped({ group: 'file' }), ['b/three.py: 1', 'a/one.py: 2 4', ': 3']);
  assert.deepEqual(grouped({ by: 'type' }), ['undefined: 1 4 2 3']);
});

test('"where" on the state of a thread and on the check of a note', () => {
  const target = { kind: 'part', part: 'a', label: 'Part "A"' };
  const answered = Marks.threadThing([{ id: 1, state: 'open', target }, { id: 2, state: 'done', thread: 1, target }]);
  const resolved = Marks.threadThing([{ id: 3, state: 'closed', target }]);
  assert.deepEqual([answered.fields, resolved.fields.state], [{ state: 'answered', where: 'Part "A"', author: 'you' }, 'resolved']);
  const pick = { kind: 'thread', where: { state: 'answered' } };
  assert.deepEqual([Marks.picks(pick, answered), Marks.picks(pick, resolved)], [true, false]);
  const note = (more: object) => CodeNotes.noteThing({ file: 'a/one.py', lines: [1, 3], title: 'Read it', linkedTests: 0, ...more });
  const checked = { kind: 'note', where: { check: true } };
  assert.deepEqual([Marks.picks(checked, note({ check: 'The code does not do this.' })), Marks.picks(checked, note({ failed: 'Lines moved.' })), Marks.picks(checked, note({}))], [true, true, false]);
});

test('the margin of the code: one thing for each line with marks, the first 200 lines; the things of a file tab for the count of set-look', () => {
  const marks = [...Array.from({ length: 250 }, (_, at) => ({ set: 'errors', value: 'state', file: 'a/one.py', line: at + 1, at: at + 1 })), { set: 'services', value: 'store', file: 'a/one.py', line: 1, at: 1 }];
  const lines = Marks.marginThings('a/one.py', marks);
  assert.deepEqual([lines.length, lines[0][0], lines[0][1].marks.length, lines[199][0]], [200, 1, 2, 200]);
  assert.ok(Marks.picks({ kind: 'margin', mark: 'errors:*' }, lines[5][1]) && !Marks.picks({ kind: 'margin', mark: 'services:*' }, lines[5][1]));
  const notes = [{ file: 'a/one.py', lines: [1, 9], symbol: 'run', title: 'Run' }, { file: 'a/one.py', lines: [2, 3], symbol: 'run', title: 'Read' }, { file: 'a/one.py', lines: [20, 22], title: 'Other' }];
  const kinds = Marks.fileThings('a/one.py', notes, [], () => 3).map((thing: { kind: string }) => thing.kind);
  assert.deepEqual(['code-map', 'notes-column', 'note-line', 'function-line', 'note-order'].map((kind) => kinds.filter((one: string) => one === kind).length), [1, 1, 3, 1, 1]);
});

test('set-look counts what a rule picks on the page of the saved change of the branch; with no saved change it says that a part id is not checked', () => {
  const store = new Store(tempFolder('apostil-store-'));
  const rules: Look = { rules: [{ pick: { kind: 'part', where: { id: 'night-job' } }, box: { color: '#2b6cb0' } }, { pick: { kind: 'diff-file', paths: ['tests/'] }, show: { shown: false } }] };
  assert.deepEqual(lookChanges(store, example.folder, rules), {
    changes: ['Rule 1: 0 parts get a colour.', 'Rule 2: 0 files of the list get shown or hidden.'],
    notes: ['Rule 1 picks nothing now: this branch has no saved change.', 'Rule 1 names a part, and this branch has no saved change: the part is not checked.', 'Rule 2 picks nothing now: this branch has no saved change.'],
  });
  const file: ChangeFile = JSON.parse(readFileSync(example.changeFile, 'utf8'));
  store.saveChange({ repoId: repoId(example.folder), folder: example.folder, branch: currentBranch(example.folder), base: example.base, head: example.head, file, checks: checkChangeFile(example.folder, example.base, file) });
  assert.deepEqual(lookChanges(store, example.folder, rules), { changes: ['Rule 1: 1 part gets a colour.', 'Rule 2: 2 files of the list get shown or hidden.'], notes: [] });
  store.close();
});

test('each part of the change page and the file tab has an area and other words; the look of the example passes; the main faults have their sentences', () => {
  const kinds = ['change-card', 'part', 'no-part', 'part-link', 'comment-mark', 'diff-file', 'comments-window', 'thread', 'open-point', 'change-view', 'part-diagram', 'part-step', 'function-line', 'note-line', 'note-order', 'notes-column', 'code-map', 'margin'];
  const components: Record<string, { area: string; words?: readonly string[] }> = LOOK_PARTS.components;
  for (const kind of kinds) assert.ok(components[kind] && kind in components && Object.keys(LOOK_PARTS.areas).includes(components[kind].area) && components[kind].words?.length, kind);
  const map: RepoMap = JSON.parse(readFileSync(join(__dirname, '../../view/example-map.json'), 'utf8'));
  const changeLook = JSON.parse(readFileSync(join(EXAMPLE_LOOK, 'look-change.json'), 'utf8'));
  const context: LookContext = { folder: example.folder, map, commands: apostilCommands(), parts: ['holds-tab', 'routes', 'night-job', 'desk-screen', 'hold-service', 'tables'] };
  assert.deepEqual(lookProblems(changeLook, context), []);
  const problems = (rule: unknown, given = context) => lookProblems({ sets: changeLook.sets, rules: [rule] }, given);
  assert.deepEqual(problems({ pick: { kind: 'part', where: { id: 'night-jobs' } }, box: { color: '#2b6cb0' } }),
    ['Rule 1, "pick": the change of this branch has no part "night-jobs". Its parts are holds-tab, routes, night-job, desk-screen, hold-service, tables. The nearest is "night-job".']);
  assert.deepEqual(problems({ pick: { kind: 'part', where: { id: 'night-jobs' } }, box: { color: '#2b6cb0' } }, { ...context, parts: undefined }), []); // no saved change: not checked
  assert.deepEqual(problems({ pick: { kind: 'diff-file' }, order: { by: 'size' } }), ['Rule 1, "order": a file of the list has no field "size". Its fields are "path", "part", "type", "added", "removed".']);
  assert.deepEqual(problems({ pick: { kind: 'change-view' }, order: { first: ['diff'] } }), ['Rule 1, "order": "diff" is no view. The views are "diagram", "diffs", "conversation". The nearest is "diffs".']);
  assert.deepEqual(problems({ pick: { kind: 'thread', where: { state: 'done' } }, box: { color: '#15803d' } }), ['Rule 1, "pick": "done" is no value of "state". The values are open, sent, working, answered, resolved.']);
  assert.deepEqual(problems({ pick: { kind: 'margin', mark: 'eror:*' }, show: { shown: true } }), ['Rule 1: "eror" is no mark set. Use "services" or a set of "sets". The nearest is "errors".']);
});
