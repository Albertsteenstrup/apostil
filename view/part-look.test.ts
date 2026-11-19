// Tests for the look of a repo on the side bar and on the page of a pull request: the rows of the list in the order of a rule, the search at
// the start, the rows of the tree "Files", the bits of the status strip, the checks, the side column, and the sentences of the check for these parts.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { apostilCommands, EVENT_KINDS, LOOK_PARTS, lookProblems, ROW_STATES, type LookContext } from '../shared/look';
import type { RepoMap } from '../shared/repo-map';
import { EXAMPLE_LOOK, makeCheckExample } from './check-example';
import { fileRow, graphsIconClick, treeChildren } from './files-follow';
import type { LookData } from './look-data';

/* eslint-disable @typescript-eslint/no-require-imports */
const PartLook = require('../../view/media/part-look.js');
const States = require('../../view/media/states.js');
/* eslint-enable @typescript-eslint/no-require-imports */

const example = makeCheckExample();
after(() => example.remove());
const map: RepoMap = JSON.parse(readFileSync(join(__dirname, '../../view/example-map.json'), 'utf8'));
const context: LookContext = { folder: example.folder, map, commands: apostilCommands() };
/** A look as a page gets it, with these rules and marks. */
const lookOf = (rules: unknown[], marks: unknown[] = []): LookData => ({ custom: true, rules, one: ['content', 'click'], sets: [], values: {}, marks, files: {} }) as unknown as LookData;
const SIDE_AND_PULL_KINDS = Object.entries(LOOK_PARTS.components).filter(([, part]) => ['side-bar', 'pull-lines', 'files', 'pull-request', 'conversation'].includes(part.area)).map(([kind]) => kind);

// Three made-up rows: two of one session, one with no agent.
const row = (branch: string, added: number, more: Record<string, unknown> = {}) => ({ branch, added, removed: 1, commits: 1, files: 2, savedAt: new Date().toISOString(), phrase: '', remarks: { sent: 0, running: 0, done: 0 }, ...more });
const agent = { app: 'claude-code', session: 's1' };
const groups = [
  { agent, rows: [row('book-holds', 1991, { agent, remarks: { sent: 0, running: 1, done: 0 } }), row('made-up/follow-up', 40, { agent })] },
  { rows: [row('made-up/without-agent', 120, { phrase: 'out of date' })] },
];
const branches = (list: { rows: { branch: string }[] }[]) => list.map((group) => group.rows.map((one) => one.branch));

test('the rows of the list in the order of a rule: one flat list by a field, grouped by another field, and a branch first under the heads of the sessions', () => {
  const none = () => [];
  assert.deepEqual(branches(PartLook.rowGroups(groups, none, { by: 'added', down: true })), [['book-holds', 'made-up/without-agent', 'made-up/follow-up']]);
  const byState = PartLook.rowGroups(groups, none, { by: 'added', down: true, group: 'state' });
  assert.deepEqual(byState.map((group: { by: string; value: string }) => `${group.by}:${group.value}`), ['state:working', 'state:out of date', 'state:none']);
  // A pin alone keeps the sessions: the session of the pinned row comes first, the row first in it.
  const pinned = PartLook.rowGroups(groups, none, { first: ['made-up/follow-up'] });
  assert.deepEqual([branches(pinned), pinned[0].by, pinned[0].agent], [[['made-up/follow-up', 'book-holds'], ['made-up/without-agent']], 'session', agent]);
  assert.equal(PartLook.rowOrder(lookOf([{ pick: { kind: 'node' }, box: { color: '#2b6cb0' } }])), null); // a look with no order for the rows changes nothing
  // Every state that a row can have is a state of the list of the check.
  const states = [{ running: 1 }, { done: 1 }, { sent: 1 }].map((counts) => States.rowState({ sent: 0, running: 0, done: 0, ...counts }))
    .concat(['out of date', '3 files in no part', 'open folder', 'no change file', ''].map((phrase) => States.rowState({ sent: 0, running: 0, done: 0 }, phrase)));
  assert.deepEqual(states, [...ROW_STATES]);
});

test('the search at the start: the words of a rule while VS Code keeps no search for the repo; a search that he kept wins, an empty one too', () => {
  const words = 'state:"checks failing"';
  assert.deepEqual(PartLook.startSearch(undefined, words), { text: words });
  assert.deepEqual(PartLook.startSearch({ text: '', sort: 'modified', reverse: false }, words), { text: '', sort: 'modified', reverse: false });
  assert.deepEqual(PartLook.startSearch({ text: 'author:mira-k', sort: 'size', reverse: true }, words).text, 'author:mira-k');
  assert.deepEqual(PartLook.startSearch(undefined, undefined), {});
});

test('the rows of the tree "Files": a folder that a rule leaves out is gone, folders in the order of a field, and a file row has the icon, the words and the click of its rule', () => {
  const marks = [{ set: 'errors', value: 'state', file: 'src/a.py', line: 3, at: 3 }, { set: 'errors', value: 'field', file: 'src/a.py', line: 9, at: 9 }];
  const look = lookOf([
    { pick: { kind: 'tree-folder', paths: ['web/src/api/generated/'] }, show: { shown: false } },
    { pick: { kind: 'tree-folder' }, order: { by: 'files', down: true } },
    { pick: { kind: 'tree-file', mark: 'errors:*' }, content: { words: '{marks} errors' } },
    { pick: { kind: 'tree-file', paths: ['src/b.py'] }, text: { icon: 'kept.svg' }, click: { file: 'src/b.py', line: 3 } },
    { pick: { kind: 'graphs-icon', paths: ['src/'] }, click: { folder: 'src/' } },
  ], marks);
  const counts = new Map([['db/', 1], ['src/', 5], ['web/', 3], ['web/src/api/', 2], ['web/src/api/generated/', 1]]);
  assert.deepEqual(treeChildren(['db/', 'src/', 'web/', 'README.md'], '', look, counts), ['src/', 'web/', 'db/', 'README.md']);
  assert.deepEqual(treeChildren(['web/src/api/generated/', 'web/src/api/client.ts'], 'web/src/api/', look, counts), ['web/src/api/client.ts']);
  assert.deepEqual(treeChildren(['db/', 'src/', 'web/', 'README.md'], '', undefined, counts), ['db/', 'src/', 'web/', 'README.md']); // no look: the rows as they come
  assert.deepEqual(fileRow(look, 'src/a.py'), { icon: undefined, words: '2 errors', click: undefined });
  assert.deepEqual(fileRow(look, 'src/b.py'), { icon: 'kept.svg', words: undefined, click: { file: 'src/b.py', line: 3 } });
  assert.deepEqual([graphsIconClick(look, 'src/b.py'), graphsIconClick(look, 'web/x.ts'), graphsIconClick(undefined, 'src/b.py')], [{ folder: 'src/' }, undefined, undefined]);
});

test('the bits of the status strip in the order of a rule; with no rule the reviewers (or the review in words), the checks and the blocker', () => {
  const pull = { state: 'checks failing', reviewers: [{ person: { login: 'mira-k' }, state: 'asked' }] };
  assert.deepEqual(PartLook.stripBits(undefined, pull), ['reviewers', 'checks', 'blocker']);
  assert.deepEqual(PartLook.stripBits(lookOf([]), { ...pull, reviewers: [] }), ['review', 'checks', 'blocker']);
  const look = lookOf([{ pick: { kind: 'status-strip' }, content: { fields: ['checks', 'blocker', 'reviewers'] } }, { pick: { kind: 'status-strip', where: { state: 'merged' } }, content: { fields: ['blocker'] } }]);
  assert.deepEqual([PartLook.stripBits(look, pull), PartLook.stripBits(look, { ...pull, state: 'merged' })], [['checks', 'blocker', 'reviewers'], ['blocker']]);
});

test('the checks left out and ordered by a rule, by the five states of a look; the counts of the pull request, which the strip shows, stay', () => {
  const list = [
    { name: 'unit', group: 'CI', state: 'passed', seconds: 30 }, { name: 'lint', group: 'CI', state: 'failed', seconds: 5 },
    { name: 'docs', group: 'Docs', state: 'skipped' }, { name: 'e2e', group: 'CI', state: 'timed out', seconds: 90 },
  ];
  const pull = { checks: { passed: 1, failed: 2, pending: 0, list } };
  const look = lookOf([{ pick: { kind: 'check', where: { state: ['passed', 'skipped'] } }, show: { shown: false } }, { pick: { kind: 'check' }, order: { by: 'time', down: true, group: 'state' } }]);
  const shown = list.filter((check) => PartLook.checkShown(look, check));
  assert.deepEqual(shown.map((check) => check.name), ['lint', 'e2e']);
  assert.deepEqual(PartLook.checkGroups(look, shown).map((group: { title: string; checks: { name: string }[] }) => [group.title, group.checks.map((check) => check.name)]), [['failed', ['e2e', 'lint']]]);
  assert.deepEqual([PartLook.checkGroups(lookOf([]), shown), pull.checks.passed + pull.checks.failed, pull.checks.list.length], [null, 3, 4]);
});

test('the sections of the side column: the ones of the rule first, a section that a rule leaves out is gone, the others in their order', () => {
  const ids = ['reviewers', 'assignees', 'labels', 'milestone', 'closes', 'tasks'];
  const look = lookOf([{ pick: { kind: 'side-section' }, order: { first: ['labels', 'reviewers'] } }, { pick: { kind: 'side-section', where: { id: 'milestone' } }, show: { shown: false } }]);
  assert.deepEqual(PartLook.sideSections(look, ids), ['labels', 'reviewers', 'assignees', 'closes', 'tasks']);
  assert.deepEqual(PartLook.sideSections(undefined, ids), ids);
});

test('each part of the side bar and of a pull request has an area with an index line, other words, and an example that passes the check; the look of the example passes too', () => {
  const fill = (rule: unknown): unknown => JSON.parse(JSON.stringify(rule).replaceAll('<folder>/', 'src/library/jobs/').replaceAll('<file>', 'src/library/night_jobs.py')
    .replaceAll('<set>:<value>', 'services:postgresql').replaceAll('<branch>', 'book-holds'));
  assert.equal(SIDE_AND_PULL_KINDS.length, 26);
  for (const kind of SIDE_AND_PULL_KINDS) {
    const part = LOOK_PARTS.components[kind as keyof typeof LOOK_PARTS.components] as { area: string; words?: readonly string[]; example: unknown };
    assert.ok(part.area in LOOK_PARTS.areas && part.words?.length, kind);
    assert.deepEqual(lookProblems({ rules: [fill(part.example)] }, context), [], kind);
  }
  assert.deepEqual(lookProblems(JSON.parse(readFileSync(join(EXAMPLE_LOOK, 'look-side-bar.json'), 'utf8')), context), []);
  // The kind of every event that the reader names is a kind of the check.
  const icons = ['rocket', 'tag', 'milestone', 'person', 'eye', 'git-merge', 'git-pull-request', 'pencil', 'cross-reference', 'stop', 'comment', 'unknown'];
  assert.ok([...icons.map((icon) => PartLook.eventOf({ kind: 'event', icon, text: '' })), PartLook.eventOf({ kind: 'commit' }), PartLook.eventOf({ kind: 'event', icon: 'git-branch', text: 'force-pushed' })]
    .every((kind) => (EVENT_KINDS as readonly string[]).includes(kind)));
});

test('the sentences of the check for the main faults of these parts, each with the nearest right name', () => {
  const rules = [
    { pick: { kind: 'home-row' }, content: { words: 'Home · {repo}' } },
    { pick: { kind: 'list-search' }, content: { words: 'author:mira-k' } },
    { pick: { kind: 'change-row' }, content: { fields: ['branch', 'size'] } },
    { pick: { kind: 'pull-line', where: { state: 'failing' } }, text: { color: '#b45309' } },
    { pick: { kind: 'avatars' }, show: { shown: false } },
    { pick: { kind: 'more-pulls' }, show: { folded: false } },
    { pick: { kind: 'tree-folder', paths: ['web/src/api/generated/'] }, box: { color: '#2b6cb0' } },
    { pick: { kind: 'tree-file', mark: 'services:*' }, content: { words: '{marks} services' } },
    { pick: { kind: 'check', where: { state: 'pass' } }, show: { shown: false } },
    { pick: { kind: 'side-section' }, order: { first: ['label'] } },
    { pick: { kind: 'event', where: { of: 'commit' } }, show: { shown: false } },
    { pick: { kind: 'message', where: { type: 'bot' } }, box: { color: '#6b7280' } },
    { pick: { kind: 'conversation-look' }, order: { first: ['classic'] } },
    { pick: { kind: 'description' }, show: { folded: false } },
    { pick: { kind: 'badge' }, content: { words: 'new' } },
  ];
  assert.deepEqual(lookProblems({ rules }, context), [
    'Rule 3, "content": a row of a change has no field "size". Its fields are "branch", "state", "age", "commits", "files", "added", "removed", "app", "author".',
    'Rule 4, "pick": "failing" is no state of a pull request. The states are "draft", "review needed", "changes requested", "checks failing", "conflicts", "ready to merge", "merged", "closed". The nearest is "checks failing".',
    'Rule 7: a folder row has no slot "box". Its slots are "show", "order". VS Code draws the rows of the tree "Files", and a look can change only their icon, the quiet words after the name, the click and the order.',
    'Rule 9, "pick": "pass" is no state of a check. The states are "failed", "running", "waiting", "passed", "skipped". The nearest is "passed".',
    'Rule 10, "order": "label" is no section of the side column. The sections are "reviewers", "assignees", "labels", "milestone", "closes", "tasks". The nearest is "labels".',
    'Rule 15: "badge" is no kind. A look cannot put a badge on a row of "Files". Tell the owner so.',
  ]);
});
