// Tests for the look of a repo in VS Code itself (view/look-of-vscode.ts): the marks in the margin, the answers of the search with #, the
// places of a mark, the entries and keys as context keys, what opens by itself, the rows of the list "Look", and the checks of these parts with
// their sentences. Made-up marks and notes, and the made-up example of the checks ("library-app").

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { apostilCommands, LOOK_PARTS, lookProblems, type LookContext, type LookRule } from '../shared/look';
import { lookSlots } from '../shared/look-slots';
import type { Mark } from '../shared/marks';
import type { NoteHere } from '../shared/notes-beside-code';
import { parseKey, type Process } from '../shared/processes';
import type { RepoMap } from '../shared/repo-map';
import { EXAMPLE_LOOK, makeCheckExample } from './check-example';
import {
  actionRows, answersFor, fileKeys, lineFacts, lookKeys, lookRows, marginMarks, noteOnHome, placesOf, processOfStep, searchAnswers, stepsByKey, whatOpens,
} from './look-of-vscode';

const example = makeCheckExample();
after(() => example.remove());
const map: RepoMap = JSON.parse(readFileSync(join(__dirname, '../../view/example-map.json'), 'utf8'));
const context: LookContext = { folder: example.folder, map, commands: apostilCommands() };
const problems = (...rules: unknown[]): string[] => lookProblems({ rules }, context);
const vscodeLook = JSON.parse(readFileSync(join(EXAMPLE_LOOK, 'look-vscode.json'), 'utf8'));

const mark = (value: string, file: string, line: number, code: string, set = 'services'): Mark => ({ set, value, file, line, code, name: 'x', group: 'g' });
const on = (kind: string, more: Record<string, unknown> = {}): LookRule => ({ pick: { kind, ...more }, show: { shown: true } } as unknown as LookRule);
const lines = ['def read():', '    store.get(1)', '    feed.send(2)', '    bell.ring()', ''];

test('the margin, by the rule of the file tab: a mark at its line, one icon on a line in the order of a stack, at most 200 lines, each side of a diff by its own text, none on a line that changed', () => {
  const marks = [
    mark('postgresql', 'src/a.py', 2, '    store.get(1)'),
    mark('book-feed', 'src/a.py', 3, '    feed.send(2)'), mark('postgresql', 'src/a.py', 3, '    feed.send(2)'), // two values on one line
    mark('state', 'src/a.py', 3, '    feed.send(2)', 'errors'),
    mark('night-bell', 'src/a.py', 4, '    bell.ring()'),
    mark('postgresql', 'src/b.py', 2, '    store.get(1)'), // another file
  ];
  const rules = [on('margin', { paths: ['src/'] })];
  // On line 3 the services come first (the order of the sets), and of them book-feed, which fewer lines hold than table-store.
  assert.deepEqual(marginMarks(rules, marks, 'src/a.py', lines, ['services', 'errors']), [
    { line: 2, key: 'services:postgresql' }, { line: 3, key: 'services:book-feed' }, { line: 4, key: 'services:night-bell' },
  ]);
  // A rule of one mark picks the lines that hold it, and the icon there is the first of the stack of the line, as in the file tab; with no rule there is none.
  assert.deepEqual(marginMarks([on('margin', { mark: 'errors:*' })], marks, 'src/a.py', lines, ['services', 'errors']), [{ line: 3, key: 'services:book-feed' }]);
  assert.deepEqual(marginMarks([], marks, 'src/a.py', lines, ['services']), []);
  // The other side of a diff has two lines more above: each mark stands at its line there; the line of the bell changed there, so it has none.
  const base = ['# one', '# two', ...lines.slice(0, 3), '    bell.ring(3)', ''];
  assert.deepEqual(marginMarks(rules, marks, 'src/a.py', base, ['services']).map((one) => one.line), [4, 5]);
  // At most 200 lines with an icon.
  const many = Array.from({ length: 250 }, (_, at) => `call_${at}()`);
  assert.equal(marginMarks(rules, many.map((code, at) => mark('postgresql', 'src/c.py', at + 1, code)), 'src/c.py', many, ['services']).length, 200);
});

const note = (title: string, file: string, lines: [number, number], fromMap = true): NoteHere => ({
  note: { title, file, lines, text: '' } as NoteHere['note'], key: `k/${title}`, lines,
  change: fromMap ? { id: 0, title: '', branch: '', map: true } : { id: 3, title: 'A change', branch: 'b' },
});
const process: Process = { id: 'answer', title: 'Answer a book request', summary: 's', group: 'g', steps: ['src/r.py:10-30', 'src/r.py:12-14', 'src/r.py:20-22'] };
const answerMap = { processes: [process], fileNotes: process.steps.map((key) => { const { file, from, to } = parseKey(key)!; return { file, lines: [from, to] as [number, number], title: key, text: '' }; }) };

test('the search with #: a note, a step and a process by their titles, with where they are; none with no rule; at most 200', () => {
  const notes = [{ path: 'src/r.py', notes: [note('Answer the request', 'src/r.py', [10, 30]), note('Lock the rows', 'src/r.py', [14, 16]), note('Shape a row', 'src/r.py', [40, 42], false)] }];
  // The note of 12-14 moved two lines down: it stands at 14-16, and its process opens at the first line of its first step now.
  notes[0].notes[1].note.lines = [12, 14];
  const all = searchAnswers([on('symbol-search')], notes, answerMap);
  assert.deepEqual(all, [
    { of: 'step', title: 'Answer the request', file: 'src/r.py', line: 10, where: 'step 1 of 3' },
    { of: 'step', title: 'Lock the rows', file: 'src/r.py', line: 14, where: 'step 2 of 3' },
    { of: 'note', title: 'Shape a row', file: 'src/r.py', line: 40, where: 'lines 40–42' },
    { of: 'process', title: 'Answer a book request', file: 'src/r.py', line: 10, where: 'process of 3 steps' },
  ]);
  // Notes and processes only: a step answers as a note.
  assert.deepEqual(searchAnswers([on('symbol-search', { where: { of: ['note', 'process'] } })], notes, answerMap).map((one) => `${one.of} ${one.title}`),
    ['note Answer the request', 'note Lock the rows', 'note Shape a row', 'process Answer a book request']);
  assert.deepEqual(searchAnswers([], notes, answerMap), []);
  // The words of a title, their letters in order; at most 200 answers.
  assert.deepEqual(answersFor(all, 'lock rows').map((one) => one.title), ['Lock the rows']);
  assert.equal(answersFor(Array.from({ length: 300 }, () => all[0]), 'answer').length, 200);
});

test('the places of a mark: each line of its value that stands now, by file and line, with the text of the line; a line that changed is left out', () => {
  const night = readFileSync(join(example.folder, 'src/library/night_jobs.py'), 'utf8').split('\n');
  const marks = [516, 139, 156].map((line) => mark('night-bell', 'src/library/night_jobs.py', line, night[line - 1]));
  marks.push(mark('night-bell', 'src/library/night_jobs.py', 20, 'a line that is gone'), mark('postgresql', 'src/library/night_jobs.py', 1, night[0]));
  assert.deepEqual(placesOf(example.folder, marks, 'services:night-bell'), [139, 156, 516].map((line) => ({ file: 'src/library/night_jobs.py', line, text: night[line - 1].trim() })));
});

test('the entries and keys that a look turns on are the context keys that the extension sets; a key of an action needs that action; the line has a note, a step and a mark', () => {
  const keys = lookKeys(vscodeLook.rules, vscodeLook.actions.length, true);
  const onKeys = Object.entries(keys).filter(([, value]) => value).map(([key]) => key).sort();
  assert.deepEqual(onKeys, [
    'apostil.lookEntry.actions', 'apostil.lookEntry.mark', 'apostil.lookKey.action1', 'apostil.lookKey.actions', 'apostil.lookList',
    'apostil.lookMenu.actions.editor', 'apostil.lookMenu.actions.explorer', 'apostil.lookMenu.actions.fileTab',
    'apostil.lookMenu.mark.editor', 'apostil.lookMenu.mark.explorer', 'apostil.lookMenu.mark.fileTab',
  ]);
  assert.equal(lookKeys([on('key', { where: { entry: 'action-3' } })], 2, false)['apostil.lookKey.action3'], false); // the look has two actions
  assert.ok(Object.values(lookKeys([], 0, false)).every((value) => !value), 'no look: nothing is on');
  // Every key that package.json names is one that the extension sets.
  const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')).contributes;
  const named = JSON.stringify([manifest.menus, manifest.keybindings, manifest.views]).match(/apostil\.look(Menu|Key|Entry|List)[\w.]*/g) ?? [];
  for (const key of new Set(named)) assert.ok(key in keys, key);
  // The line: the narrowest note, the narrowest step of each process, the marks at it.
  const notes = [note('Answer the request', 'src/r.py', [10, 30]), note('Lock the rows', 'src/r.py', [12, 14])];
  const facts = lineFacts(13, notes, stepsByKey(answerMap), [{ set: 'services', value: 'postgresql', file: 'src/r.py', at: 13 }]);
  assert.deepEqual([facts.note?.note.title, facts.steps.map((step) => `${step.drawing} ${step.node} top ${step.top}`), facts.marks.length], ['Lock the rows', ['process:answer s1 top s1'], 1]);
  // An entry stands by what the file has anywhere: a note, a step, a mark; a file with none of them has no entry.
  const marked = [{ set: 'services', value: 'postgresql', file: 'src/r.py', at: 13 }];
  assert.deepEqual(fileKeys(notes, stepsByKey(answerMap), marked), { 'apostil.fileHas.note': true, 'apostil.fileHas.process': true, 'apostil.fileHas.mark': true });
  assert.deepEqual(fileKeys([notes[0]], stepsByKey(undefined), []), { 'apostil.fileHas.note': true, 'apostil.fileHas.process': false, 'apostil.fileHas.mark': false });
  assert.deepEqual(fileKeys(undefined, stepsByKey(answerMap), undefined), { 'apostil.fileHas.note': false, 'apostil.fileHas.process': false, 'apostil.fileHas.mark': false });
  // Where the entries go: the step in its own drawing, its process at its top step, a note of a change at the node of the map that holds its file.
  assert.deepEqual([noteOnHome(facts.note!, stepsByKey(answerMap), map), processOfStep(facts.steps[0])], [{ place: { diagram: 'process:answer', node: 's1' } }, { place: { diagram: 'process:answer', node: 's1' } }]);
  assert.deepEqual(noteOnHome(note('Plan the holds', 'src/library/lending/hold_service.py', [1, 2], false), new Map(), map), { place: { diagram: 'lib-lending', node: 'service' } });
  // The rows of "Actions of the Look…": the key of each of the first nine that the look turns on, where one is bound (a Mac), and what the action does.
  const rows = (mac: boolean) => actionRows(vscodeLook.actions, keys, mac).map(({ label, description, detail }) => [label, description, detail]);
  assert.deepEqual(rows(true).slice(0, 2), [['Open the night run', '⌃⌥1', 'Opens src/library/night_jobs.py at line 516.'], ['Show how a request is answered', undefined, 'Opens process:answer-request on Home.']]);
  assert.deepEqual([rows(true)[2][0], rows(false)[0][1]], ['Open the opening hours', undefined]);
});

test('what opens by itself: Home in an empty window, the first page once beside the tabs brought back, not when its view is there, nothing with the setting off', () => {
  const first = { place: { diagram: 'process:answer-request' } };
  const file = { kind: 'other' as const, name: 'requests.py' };
  assert.deepEqual(whatOpens({ tabs: [], on: true, start: true }), { home: true });
  assert.equal(whatOpens({ tabs: [file], on: true, start: true }), undefined);
  assert.deepEqual(whatOpens({ tabs: [], first, on: true, start: true }), { first, beside: false });
  assert.deepEqual(whatOpens({ tabs: [file], first, on: true, start: true }), { first, beside: true });
  assert.equal(whatOpens({ tabs: [file, { kind: 'home', name: 'Home' }], first, on: true, start: true }), undefined);
  // A page of the look is known by its title; the graphs of a path by its name.
  const pages = [{ id: 'opening-hours', title: 'Opening hours' }];
  assert.equal(whatOpens({ tabs: [{ kind: 'page', name: 'Opening hours' }], first: { page: 'opening-hours' }, pages, on: true, start: true }), undefined);
  assert.deepEqual(whatOpens({ tabs: [{ kind: 'graphs', name: 'jobs/' }], first: { graphs: 'src/library/night_jobs.py' }, on: true, start: true }), { first: { graphs: 'src/library/night_jobs.py' }, beside: true });
  // After the start: an empty editor area gets the first page in place of Home; a window with tabs gets nothing.
  assert.deepEqual(whatOpens({ tabs: [], first, on: true, start: false }), { first, beside: false });
  assert.equal(whatOpens({ tabs: [file], first, on: true, start: false }), undefined);
  for (const start of [true, false]) assert.equal(whatOpens({ tabs: [], first, on: false, start }), undefined);
});

test('the rows of the list "Look": each set with its values and their counts, the pages with the first page; at most 50 rows, then "n more"', () => {
  const rules = [on('look-list'), { pick: { kind: 'first-page' }, click: { page: 'opening-hours' } } as unknown as LookRule];
  const marks = [['a.py', 1], ['a.py', 2], ['b.py', 9]].map(([file, at]) => ({ set: 'services', value: 'postgresql', file: String(file), at: Number(at) }));
  const rows = lookRows({ rules, sets: [{ id: 'services', name: 'Services' }, { id: 'errors', name: 'Errors' }], values: { 'services:postgresql': { name: 'PostgreSQL' } }, marks, pages: [{ id: 'opening-hours', title: 'Opening hours' }] });
  const words = (row: { label: string; quiet?: string }): string => `${row.label}${row.quiet ? ` · ${row.quiet}` : ''}`;
  assert.deepEqual(rows.map((group) => [group.label, group.rows!.map((row) => [words(row), (row.rows ?? []).map(words)])]), [
    ['Marks', [['Services', ['PostgreSQL · 3 lines · 2 files']], ['Errors · no marks now', []]]],
    ['Pages', [['Opening hours · first page', []]]],
  ]);
  assert.deepEqual([rows[0].rows![0].rows![0].places, rows[1].rows![0].target], ['services:postgresql', { page: 'opening-hours' }]);
  // Only the group "marks"; a look with no pages has no group "pages".
  assert.deepEqual(lookRows({ rules: [on('look-list', { where: { group: 'marks' } })], sets: [], values: {}, marks: [], pages: [{ id: 'p', title: 'P' }] }).map((group) => group.label), ['Marks']);
  assert.deepEqual(lookRows({ rules: [on('look-list')], sets: [], values: {}, marks: [], pages: [] }).map((group) => group.label), ['Marks']);
  assert.deepEqual(lookRows({ rules: [], sets: [], values: {}, marks: [], pages: [] }), []);
  // 60 pages: 50 rows, then "10 more"; with the group open, all of them.
  const pages = Array.from({ length: 60 }, (_, at) => ({ id: `p${at}`, title: `Page ${at}` }));
  const capped = lookRows({ rules: [on('look-list')], sets: [], values: {}, marks: [], pages })[1].rows!;
  assert.deepEqual([capped.length, capped.at(-1)!.label, capped.at(-1)!.more], [51, '10 more', 'pages']);
  assert.equal(lookRows({ rules: [on('look-list')], sets: [], values: {}, marks: [], pages, open: new Set(['pages']) })[1].rows!.length, 60);
});

test('each part of VS Code has the area vscode, other words and an example that passes the check; the example look look-vscode.json passes', () => {
  const fill = (rule: unknown): unknown => JSON.parse(JSON.stringify(rule).replaceAll('<diagram>', 'lib-top').replaceAll('<set>:<value>', 'services:postgresql'));
  for (const kind of ['margin', 'symbol-search', 'menu-entry', 'key', 'first-page', 'look-list'] as const) {
    const part = LOOK_PARTS.components[kind];
    // The margin is one entry for the file tab and VS Code: it stands in the area file-tab, and the area vscode names it.
    assert.ok((part.area === 'vscode' || ('also' in part && part.also === 'vscode')) && part.words.length, kind);
    assert.deepEqual(problems(fill(part.example)), [], kind);
  }
  assert.deepEqual(lookProblems(vscodeLook, context), []);
});

test('each fault of a part of VS Code has its sentence', () => {
  assert.deepEqual(problems(on('margin'), on('margin'), { pick: { kind: 'status-bar' }, show: { shown: true } }),
    ['Rule 3: "status-bar" is no kind. A look cannot put anything in the status bar. Tell the owner so.']);
  assert.deepEqual(problems({ pick: { kind: 'margin' }, box: { color: '#2b6cb0' } }),
    ['Rule 1: a margin has no slot "box". Its slots are "show". VS Code draws the margin, and a look can only say which marks stand there.']);
  assert.deepEqual(problems(on('margin'), on('symbol-search', { where: { of: 'notes' } })),
    ['Rule 2, "pick": "notes" is no value of "of". The values are "note", "step", "process". The nearest is "note".']);
  assert.deepEqual(problems(...Array.from({ length: 4 }, () => on('margin')), { pick: { kind: 'first-page' }, click: { file: 'README.md' } }),
    ['Rule 5, "click": the first page must open a view of Apostil: use "place", "graphs" or "page". A file, a web address, a command and a prompt cannot be the first page.']);
  assert.deepEqual(problems(on('margin'), on('margin'), on('margin'), on('key', { where: { entry: 'action-12' } })),
    ['Rule 4, "pick": "action-12" is no value of "entry". A key goes to the first nine actions: action-1 to action-9.']);
  const action = (at: number) => ({ id: `a${at}`, name: `Action ${at}`, target: { file: 'README.md' } });
  assert.deepEqual(lookProblems({ rules: [], actions: Array.from({ length: 14 }, (_, at) => action(at)) }, context), ['The look: it has 14 actions. The list holds at most 12.']);
  assert.deepEqual(lookProblems({ rules: [], actions: [{ id: 'hours', name: 'A name of the action that is longer than forty letters', target: { pull: 0 } }] }, context), [
    'Action "hours": the name has 54 characters. A name holds at most 40.', 'Action "hours": "pull" must be the number of a pull request, as 12.',
  ]);
});

test('a part that no look can use: the search says so in one sentence, and the check names it', () => {
  const find = (words: string) => lookSlots('', words, false).output as { found?: string; matches?: { name: string }[] };
  assert.deepEqual(find('status bar'), { found: 'A look cannot use the status bar. Tell the owner so.' });
  assert.deepEqual(find('codelens above a function'), { found: 'A look cannot use a line above code (CodeLens). Tell the owner so.' });
  // A word that a part of the list has as well finds that part: the window of the pointer, the corners.
  assert.equal(find('hover')?.matches?.[0].name, 'window');
  assert.equal(find('badge')?.matches?.[0].name, 'corners');
  assert.equal(find('margin')?.matches?.[0].name, 'margin');
  for (const [kind, words] of [['codelens', 'put a line above code (CodeLens)'], ['breadcrumbs', 'put notes in the path above the code'], ['timeline', 'put anything in the Timeline']]) {
    assert.deepEqual(problems({ pick: { kind }, show: { shown: true } }), [`Rule 1: "${kind}" is no kind. A look cannot ${words}. Tell the owner so.`]);
  }
});

test('the example look look-vscode.json is one rule for each part, three actions and a page, which is its first page', () => {
  assert.deepEqual(vscodeLook.rules.map((rule: LookRule) => rule.pick.kind), ['margin', 'symbol-search', 'menu-entry', 'key', 'first-page', 'look-list']);
  assert.deepEqual([vscodeLook.actions.length, vscodeLook.pages.length, vscodeLook.rules[4].click], [3, 1, { page: 'opening-hours' }]);
});
