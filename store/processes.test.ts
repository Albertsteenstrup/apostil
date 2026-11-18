// Tests for the processes of a map: add-processes and its check, the notes that a writer corrects, processes, process-groups, and the drawings on Home and the graphs page.

import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Note } from '../shared/change-file';
import { repoId } from '../shared/git';
import { noteGroups, processGroups, readyProcessGroups } from '../shared/note-groups';
import { placeDrawing, processDrawings } from '../shared/process-diagrams';
import { isTestPath, parseKey, processFacts, stepKey } from '../shared/processes';
import { diagramsOf, type RepoMap } from '../shared/repo-map';
import { Store } from '../shared/store';
import { makeTestRepo, runApostil, tempFolder } from '../shared/test-repo';
import { graphsData, homeData } from '../view/home-data';
import { addProcessesToMap } from './processes-save';
import { addNotesToMap, saveMapDraft } from './save';

const RUN = [
  'def main(path):', //          1
  '    rows = load(path)', //    2
  '    for row in rows:', //     3
  '        if not row:', //      4
  '            continue', //     5
  '        save(row)', //        6
  '    return len(rows)', //     7
  '', '', //                     8, 9
  'def load(path):', //          10
  '    with open(path) as handle:', // 11
  '        return handle.read().split()', // 12
  '', '', //                     13, 14
  'def save(row):', //           15
  '    print(row)', //           16
  '    return write_row(row)', // 17
].join('\n') + '\n';
const STORE = 'import json\n\n\ndef write_row(row):\n    json.dumps(row)\n    return True\n';
const REPORT = 'def report(path):\n    rows = open(path).read()\n    return rows\n';

const note = (file: string, lines: [number, number], title: string, text = 'Does the work of this step.'): Note => ({ file, lines, title, text });
const NOTES: Note[] = [
  note('src/run.py', [1, 7], 'Run the rows'), note('src/run.py', [2, 2], 'Load the rows'), note('src/run.py', [3, 6], 'Walk each row'),
  note('src/run.py', [4, 5], 'Skip empty rows'), note('src/run.py', [6, 6], 'Save one row'), note('src/run.py', [7, 7], 'Return the count'),
  note('src/run.py', [10, 12], 'Read the words'), note('src/run.py', [15, 17], 'Print and write'),
  note('src/store.py', [4, 6], 'Write one row'), note('src/report.py', [1, 3], 'Report the file'), note('tests/test_run.py', [1, 2], 'Prove main runs'),
];
const k = (file: string, first: number, last: number): string => `src/${file}:${first}-${last}`;

/** The process of the group "rows": main, its loop with a branch, two calls into other functions and a call out of the repo. */
const runRows = () => ({
  id: 'run-rows', title: 'Run the rows of a file', summary: 'Reads a file, saves each row that is not empty and returns the count.',
  steps: [k('run.py', 1, 7), k('run.py', 2, 2), k('run.py', 3, 6), k('run.py', 4, 5), k('run.py', 6, 6), k('run.py', 7, 7), k('run.py', 10, 12), k('run.py', 15, 17), k('store.py', 4, 6)],
  arrows: [
    { from: k('run.py', 2, 2), to: k('run.py', 10, 12), label: 'read the file', fromLine: 2, toLine: 10, name: 'load' },
    { from: k('run.py', 6, 6), to: k('run.py', 15, 17), label: 'save the row', fromLine: 6, toLine: 15, name: 'save' },
    { from: k('run.py', 15, 17), to: k('store.py', 4, 6), label: 'write it', fromLine: 17, toLine: 4, name: 'write_row' },
    { kind: 'branch', from: k('run.py', 6, 6), to: k('run.py', 4, 5), label: 'next row', fromLine: 3 },
  ],
  outside: [{ from: k('store.py', 4, 6), to: 'json', label: 'encode', fromLine: 5, name: 'dumps' }],
});
const reportFile = () => ({ id: 'report-file', title: 'Report the file', summary: 'Reads the file again and returns its text.', steps: [k('report.py', 1, 3)] });
const handoff = { from: 'run-rows', to: 'report-file', label: 'the same file', name: 'open', fromLine: { file: 'src/run.py', line: 11 }, toLine: { file: 'src/report.py', line: 2 } };

const topMap = (fileNotes = NOTES): RepoMap => ({
  format: 1,
  diagrams: [
    { id: 'top', kind: 'flow', title: 'The test repo', mermaid: 'flowchart LR\n  code["Code"] --> docs["Docs"]\n  checks["Tests"]', nodePaths: { code: ['src/'], docs: ['README.md'], checks: ['tests/'] } },
  ],
  fileNotes,
});

/** A repo with the three code files and a test, and a saved map with their notes. */
function setup() {
  const repo = makeTestRepo();
  repo.write('src/run.py', RUN);
  repo.write('src/store.py', STORE);
  repo.write('src/report.py', REPORT);
  repo.write('tests/test_run.py', 'def test_main():\n    assert True\n');
  repo.commit('files');
  const store = new Store(tempFolder('apostil-home-'));
  assert.equal(saveMapDraft(store, repo.folder, topMap()).saved, true);
  const map = (): RepoMap => store.getMap(repoId(repo.folder))!.map;
  return { repo, store, map, done: () => (store.close(), repo.remove()) };
}


test('add-processes saves the processes of one group, replaces only that group, keeps the others after two saves, and with "add" keeps the other processes of its group', () => {
  const { repo, store, map, done } = setup();
  // With "add" a save keeps the other processes and set-aside notes of its group, and replaces only the processes with the same ids.
  assert.equal(addProcessesToMap(store, repo.folder, { group: 'rows', processes: [runRows()], notInProcess: [{ note: k('report.py', 1, 3), why: 'Reads a file that nothing else uses.' }] }).saved, true);
  // The round for the notes that are left: one new process, and the set-aside note becomes its step.
  const more = addProcessesToMap(store, repo.folder, { group: 'rows', add: true, processes: [reportFile()] });
  assert.equal(more.saved, true, more.problems.join(' | '));
  assert.deepEqual(map().processes?.map((one) => one.id), ['run-rows', 'report-file']);
  assert.deepEqual(map().notInProcess, []);
  // Without "add" the save of the group replaces all of its processes.
  assert.equal(addProcessesToMap(store, repo.folder, { group: 'rows', processes: [reportFile()] }).saved, true);
  assert.deepEqual(map().processes?.map((one) => one.id), ['report-file']);

  const first = addProcessesToMap(store, repo.folder, { group: 'rows', processes: [runRows()] });
  assert.deepEqual(first, { saved: true, problems: [], processes: 1, steps: 9, notes: { fixed: [], added: [], removed: [] } });
  const second = addProcessesToMap(store, repo.folder, { group: 'report', processes: [reportFile()], handoffs: [handoff] });
  assert.equal(second.saved, true, second.problems.join(' | '));
  assert.deepEqual(map().processes?.map((one) => [one.id, one.group]), [['run-rows', 'rows'], ['report-file', 'report']]);
  assert.deepEqual(map().handoffs?.map((one) => [one.from, one.to, one.group]), [['run-rows', 'report-file', 'report']]);

  // A new save of "rows" replaces its process and its set-aside notes, and keeps the process and the handoff of "report".
  const again = addProcessesToMap(store, repo.folder, { group: 'rows', processes: [{ ...runRows(), title: 'Save the rows of a file' }], notInProcess: [] });
  assert.equal(again.saved, true, again.problems.join(' | '));
  assert.deepEqual(map().processes?.map((one) => [one.id, one.title]), [['report-file', 'Report the file'], ['run-rows', 'Save the rows of a file']]);
  assert.equal(map().handoffs?.length, 1);
  // The notes of the map, and their kept text, are as before.
  assert.equal(map().fileNotes?.length, NOTES.length);
  assert.deepEqual(map().noteCode?.['@files/0'], ['def report(path):', "    rows = open(path).read()", '    return rows']);

  // A save of the map or of notes keeps the processes.
  assert.equal(saveMapDraft(store, repo.folder, { ...topMap(), fileNotes: undefined }).saved, true);
  assert.equal(addNotesToMap(store, repo.folder, { notes: [note('src/report.py', [1, 3], 'Report the file')] }).saved, true);
  assert.deepEqual(map().processes?.map((one) => one.id), ['report-file', 'run-rows']);
  assert.equal(map().handoffs?.length, 1);
  done();
});

test('add-processes refuses each fault of the check with one sentence, and saves nothing', () => {
  const { repo, store, map, done } = setup();
  const refuse = (draft: unknown): string => {
    const result = addProcessesToMap(store, repo.folder, draft);
    assert.equal(result.saved, false);
    assert.equal(map().processes, undefined);
    return result.problems.join(' | ');
  };
  const run = runRows();
  const withArrow = (arrow: object) => ({ group: 'rows', processes: [{ ...run, arrows: [...run.arrows, arrow] }] });
  assert.match(refuse({ processes: [] }), /"group" must be the name of your group/);
  assert.match(refuse({ group: 'rows', processes: [{ ...run, steps: [...run.steps, k('run.py', 1, 2)] }] }), /the step "src\/run\.py:1-2" is no note of the map\. Run apostil notes src\/run\.py and take the key of a note that it prints\./);
  assert.match(refuse(withArrow({ from: k('run.py', 2, 2), to: k('report.py', 1, 3), fromLine: 2, toLine: 1, name: 'report' })), /both ends must be steps of this process/);
  assert.match(refuse(withArrow({ from: k('run.py', 2, 2), to: k('run.py', 10, 12), fromLine: 3, toLine: 10, name: 'load' })), /"fromLine" 3 is not inside its step/);
  assert.match(refuse(withArrow({ from: k('run.py', 2, 2), to: k('run.py', 10, 12), fromLine: 2, toLine: 10, name: 'split' })), /line 2 of src\/run\.py does not hold "split" \(it holds "rows = load\(path\)"\), so give the line of the call\./);
  assert.match(refuse(withArrow({ from: k('run.py', 2, 2), to: k('run.py', 10, 12), fromLine: 2, toLine: 13, name: 'load' })), /"toLine" 13 is not inside its step/);
  assert.match(refuse(withArrow({ from: k('run.py', 15, 17), to: k('run.py', 10, 12), fromLine: 16, toLine: 11, name: 'print' })), /line 11 of src\/run\.py does not hold "print"/);
  assert.match(refuse(withArrow({ kind: 'branch', from: k('run.py', 4, 5), to: k('run.py', 7, 7), label: 'on empty', fromLine: 4 })), /a branch joins two steps inside the same outer step/);
  assert.match(refuse(withArrow({ kind: 'branch', from: k('run.py', 6, 6), to: k('run.py', 4, 5), fromLine: 3 })), /a branch needs a "label"/);
  assert.match(refuse(withArrow({ kind: 'branch', from: k('run.py', 6, 6), to: k('run.py', 4, 5), label: 'next row', fromLine: 12 })), /"fromLine" 12 lies outside the outer step src\/run\.py:3-6/);
  assert.match(refuse({ group: 'rows', processes: [{ ...run, outside: [{ from: k('store.py', 4, 6), to: 'json', fromLine: 5, name: 'loads' }] }] }), /line 5 of src\/store\.py does not hold "loads"/);
  assert.match(refuse({ group: 'rows', processes: [{ ...run, outside: [{ from: k('run.py', 15, 17), to: 'src/store.py', fromLine: 17, name: 'write_row' }] }] }),
    /src\/store\.py is a file of this repo, so make the code that it calls a step, with an arrow to its note/);
  assert.match(refuse({ group: 'rows', processes: [{ ...run, arrows: run.arrows.filter((arrow) => arrow.name !== 'write_row') }] }), /its steps fall in 2 pieces that no arrow joins \(they start at src\/run\.py:1-7, src\/store\.py:4-6\)/);
  assert.match(refuse({ group: 'rows', processes: [run, reportFile()], handoffs: [{ ...handoff, toLine: { file: 'src/report.py', line: 9 } }] }), /its "toLine" \(src\/report\.py line 9\) lies in no step of "report-file"/);
  assert.match(refuse({ group: 'rows', processes: [run, reportFile()], handoffs: [{ ...handoff, name: 'with' }] }), /line 2 of src\/report\.py does not hold "with"/);
  assert.match(refuse({ group: 'rows', processes: [run], handoffs: [handoff] }), /"report-file" is no process of the map yet\. Leave this handoff out now/);
  assert.match(refuse({ group: 'rows', processes: [{ ...run, title: 'Runs the rows' }] }), /the title starts with "Runs"\. Start with the bare verb: "Run"\./);
  assert.match(refuse({ group: 'rows', processes: [{ ...run, title: 'Run all the rows of one file' }] }), /the title has 7 words/);
  assert.match(refuse({ group: 'rows', processes: [{ ...run, summary: 'Reads a file. Saves the rows.' }] }), /the summary has 2 sentences/);
  assert.match(refuse({ group: 'rows', processes: [{ ...run, summary: Array.from({ length: 21 }, () => 'word').join(' ') }] }), /the summary has 21 words\. Use at most 20\./);
  assert.match(refuse(withArrow({ from: k('run.py', 2, 2), to: k('run.py', 10, 12), label: 'read the whole file now', fromLine: 2, toLine: 10, name: 'load' })), /the label has 5 words\. Use at most 4\./);
  assert.match(refuse({ group: 'rows', processes: [run], notInProcess: [{ note: k('report.py', 1, 3), why: 'It reads a file that the main job wrote before and nobody reads again' }] }), /the reason has 14 words\. Use at most 12\./);
  assert.match(refuse({ group: 'rows', processes: [run], notInProcess: [{ note: k('run.py', 7, 7), why: 'Returns the count.' }] }), /this note is a step of a process too/);
  assert.equal(addProcessesToMap(store, repo.folder, { group: 'report', processes: [reportFile()] }).saved, true);
  assert.match(addProcessesToMap(store, repo.folder, { group: 'rows', processes: [{ ...run, id: 'report-file' }] }).problems.join(), /the group "report" has a process with this id/);
  done();
});

test('a writer corrects notes, adds notes and removes a note with its new key in every process, in the same save', () => {
  const { repo, store, map, done } = setup();
  assert.equal(addProcessesToMap(store, repo.folder, { group: 'report', processes: [{ ...reportFile(), steps: [k('report.py', 1, 3), k('run.py', 10, 12)], arrows: [{ from: k('report.py', 1, 3), to: k('run.py', 10, 12), fromLine: 2, toLine: 11, name: 'open' }] }] }).saved, true);
  const fixed = addProcessesToMap(store, repo.folder, {
    group: 'rows',
    processes: [{ ...runRows(), steps: [...runRows().steps, k('run.py', 16, 16)] }],
    noteFixes: [{ note: k('run.py', 7, 7), text: 'Returns the number of rows, also the empty ones.' }, { note: k('run.py', 10, 12), remove: true }],
    newNotes: [note('src/run.py', [16, 16], 'Print the row'), note('src/run.py', [10, 11], 'Open the file')],
  });
  assert.equal(fixed.saved, true, fixed.problems.join(' | '));
  assert.deepEqual(fixed.notes, { fixed: [k('run.py', 7, 7)], added: [k('run.py', 16, 16), k('run.py', 10, 11)], removed: [{ note: k('run.py', 10, 12), by: k('run.py', 10, 11) }] });
  const notes = map().fileNotes!;
  assert.equal(notes.find((one) => stepKey(one) === k('run.py', 7, 7))?.text, 'Returns the number of rows, also the empty ones.');
  assert.equal(notes.some((one) => stepKey(one) === k('run.py', 10, 12)), false);
  // The new key stands in place of the old one in both processes, also in the process of the other group, in its steps and its arrows.
  for (const process of map().processes!) assert.equal(process.steps.includes(k('run.py', 10, 11)) && !process.steps.includes(k('run.py', 10, 12)), true, process.id);
  assert.equal(map().processes!.find((one) => one.id === 'report-file')!.arrows![0].to, k('run.py', 10, 11));
  // The kept text of the lines moves with each note.
  const at = notes.findIndex((one) => stepKey(one) === k('run.py', 16, 16));
  assert.deepEqual(map().noteCode?.[`@files/${at}`], ['    print(row)']);

  // A removed note that is a step, with no new note for its lines, is refused with a sentence that names the processes.
  const refused = addProcessesToMap(store, repo.folder, { group: 'rows', processes: [runRows()], noteFixes: [{ note: k('store.py', 4, 6), remove: true }] });
  assert.match(refused.problems.join(), /The removal of the note "src\/store\.py:4-6": it is a step of the processes run-rows, so add a new note for its lines in "newNotes" and give its key as "by"\./);
  done();
});


test('apostil processes counts the notes in no process, leaves out test files, and finds a stale process after add-notes writes a file again; a key names a note by its file and lines', () => {
  assert.equal(stepKey({ file: 'a/b.py', lines: [3, 9] }), 'a/b.py:3-9');
  assert.equal(stepKey({ file: 'nb.ipynb', cell: 'c1', lines: [1, 4] }), 'nb.ipynb#c1:1-4'); // a cell of a notebook by "#"
  assert.deepEqual(parseKey('nb.ipynb#2:1-4'), { file: 'nb.ipynb', cell: '2', from: 1, to: 4 });
  assert.deepEqual(parseKey('a/b.py:3-9'), { file: 'a/b.py', from: 3, to: 9 });
  assert.equal(parseKey('a/b.py'), undefined);
  // A test path is one rule.
  assert.deepEqual(['tests/x.py', 'src/test_x.py', 'pkg/x_test.go', 'web/a.test.ts', 'web/a.spec.js', 'conftest.py', 'src/__tests__/a.js', 'src/latest.py', 'src/contest.py'].map(isTestPath),
    [true, true, true, true, true, true, true, false, false]);

  const { repo, store, map, done } = setup();
  const none = processFacts(map());
  assert.equal(none.processes, 0);
  assert.equal(none.notes, NOTES.length - 1); // the note of the test file needs no process
  assert.match(none.hint ?? '', /This map has no processes yet/);
  const saved = addProcessesToMap(store, repo.folder, { group: 'rows', processes: [runRows()] });
  assert.equal(saved.saved, true);
  const facts = processFacts(map());
  assert.deepEqual({ ...facts, hint: undefined }, {
    processes: 1, steps: 9, setAside: 0, notes: 10, hint: undefined,
    notInProcess: { count: 1, files: [{ file: 'src/report.py', count: 1, notes: ['src/report.py:1-3'] }] }, stale: [],
  });
  assert.match(facts.hint ?? '', /^1 note is in no process\. Run apostil process-groups/);
  // The notes writer writes store.py again with other lines: the process names a note that is gone.
  assert.equal(addNotesToMap(store, repo.folder, { notes: [note('src/store.py', [4, 5], 'Encode one row')] }).saved, true);
  const stale = processFacts(map());
  assert.deepEqual(stale.stale, [{ id: 'run-rows', group: 'rows', gone: 1 }]);
  assert.equal(stale.notInProcess.count, 2);
  assert.match(stale.hint ?? '', /2 notes are in no process, and 1 process is stale/);
  done();
});

test('process-groups gives one group for each area, splits a large area by folder, and lists only the work that is left', () => {
  const repo = makeTestRepo();
  const lines = Array.from({ length: 320 }, (_, at) => `x${at} = ${at}`).join('\n') + '\n';
  repo.write('src/a/big.py', lines);
  repo.write('src/b/big.py', lines);
  repo.write('lib/one.py', 'def one():\n    return 1\n');
  repo.commit('large');
  const store = new Store(tempFolder('apostil-home-'));
  const many = (file: string): Note[] => Array.from({ length: 300 }, (_, at) => note(file, [at + 1, at + 1], `Set value ${at}`));
  const map: RepoMap = {
    format: 1, diagrams: [{ id: 'top', kind: 'flow', title: 'Top', mermaid: 'flowchart LR\n  code["Code"]', nodePaths: { code: ['src/'] } }],
    fileNotes: [...many('src/a/big.py'), ...many('src/b/big.py'), note('lib/one.py', [1, 2], 'Return one')],
  };
  assert.equal(saveMapDraft(store, repo.folder, map).saved, true);
  const stored = () => store.getMap(repoId(repo.folder));
  const first = processGroups(stored()!.map);
  assert.deepEqual(first.groups.map((group) => [group.area, group.files.map((file) => file.path), group.notes, group.why]), [
    ['code', ['src/a/big.py'], 300, 'no process yet'], ['code', ['src/b/big.py'], 300, 'no process yet'], [undefined, ['lib/one.py'], 1, 'no process yet'],
  ]);
  assert.match(first.groups[0].name, /^code-[0-9a-f]{6}$/);
  assert.equal(processGroups(stored()!.map).groups[0].name, first.groups[0].name); // the same for the same files
  const lib = first.groups[2].name;
  const saved = addProcessesToMap(store, repo.folder, { group: lib, processes: [{ id: 'one', title: 'Return one', summary: 'Returns the number one.', steps: ['lib/one.py:1-2'] }] });
  assert.equal(saved.saved, true, saved.problems.join(' | '));
  assert.deepEqual(processGroups(stored()!.map).groups.map((group) => group.name), first.groups.slice(0, 2).map((group) => group.name));
  assert.equal(processGroups(stored()!.map, true).groups.length, 3);
  // A save that leaves notes of its files in no process says so.
  const some = addProcessesToMap(store, repo.folder, { group: first.groups[0].name, processes: [{ id: 'set-a', title: 'Set the first value', summary: 'Sets x0.', steps: ['src/a/big.py:1-1'] }] });
  assert.deepEqual(some.left?.count, 299);
  assert.equal(processGroups(stored()!.map).groups[0].why, '299 notes in no process');
  store.close();
  repo.remove();
});

test('process-groups lists only the groups of areas whose notes are all saved, and says how many areas still wait for notes, so the process writers of an area start when its notes are saved', () => {
  const repo = makeTestRepo();
  repo.write('src/run.py', RUN);
  repo.write('lib/one.py', 'def one():\n    return 1\n');
  repo.write('lib/two.py', 'def two():\n    return 2\n');
  repo.commit('two areas');
  const home = tempFolder('apostil-home-');
  const store = new Store(home);
  const map: RepoMap = { format: 1, diagrams: [{ id: 'top', kind: 'flow', title: 'Top', mermaid: 'flowchart LR\n  code["Code"] --> lib["Lib"]', nodePaths: { code: ['src/'], lib: ['lib/'] } }] };
  assert.equal(saveMapDraft(store, repo.folder, map).saved, true);
  const stored = () => store.getMap(repoId(repo.folder))!;
  // The notes of the area "code" are saved (its other files have no code worth a note), and one of the two files of "lib": only the group of "code" is ready, and one area waits.
  const others = noteGroups(repo.folder, stored()).groups.flatMap((group) => group.files.map((file) => file.path)).filter((path) => !['src/run.py', 'lib/one.py', 'lib/two.py'].includes(path));
  assert.equal(addNotesToMap(store, repo.folder, { notes: [note('src/run.py', [1, 7], 'Run the rows'), note('lib/one.py', [1, 2], 'Return one')], files: others }).saved, true);
  assert.deepEqual(noteGroups(repo.folder, stored()).groups.map((group) => [group.area, group.files.map((file) => file.path)]), [['lib', ['lib/two.py']]]);
  assert.deepEqual(processGroups(stored().map).groups.map((group) => group.area), ['code', 'lib']); // the notes of lib/one.py would make a group of lib
  const ready = readyProcessGroups(repo.folder, stored());
  assert.deepEqual([ready.groups.map((group) => group.area), ready.waiting], [['code'], 1]);
  // The command prints the same.
  const printed = JSON.parse(runApostil(['process-groups', '--folder', repo.folder], { env: { APOSTIL_HOME: home } }).stdout);
  assert.deepEqual([printed.groups.map((group: { area: string }) => group.area), printed.waiting], [['code'], 1]);
  // When the last notes of lib are saved, its group is listed too, and no area waits.
  assert.equal(addNotesToMap(store, repo.folder, { notes: [note('lib/two.py', [1, 2], 'Return two')] }).saved, true);
  const all = readyProcessGroups(repo.folder, stored());
  assert.deepEqual([all.groups.map((group) => group.area), all.waiting], [['code', 'lib'], 0]);
  store.close();
  repo.remove();
});

test('the drawings: a process by its top steps in a box for each file, a step opened with its order and its branch, the processes of a place; Home hangs them under the node of their first step, and the graphs of a file show them', () => {
  const { repo, store, map, done } = setup();
  assert.equal(addProcessesToMap(store, repo.folder, { group: 'rows', processes: [runRows()] }).saved, true);
  let home = homeData(store, repo.folder);
  const topOfHome = () => home.map!.diagrams.find((one) => one.id === 'top')!;
  assert.equal(topOfHome().nodes.code.down, 'process:run-rows'); // one process: the node opens it
  assert.equal(topOfHome().nodes.docs.down, undefined); // a node with no process keeps what it does
  assert.ok(home.map!.diagrams.some((one) => one.id === 'process:run-rows/2'));
  const step = home.map!.diagrams.find((one) => one.id === 'process:run-rows')!.nodes.s6;
  assert.deepEqual({ line: step.line, paths: step.paths, note: step.note?.title }, { line: 10, paths: [{ path: 'src/run.py', files: 1 }], note: 'Read the words' });
  assert.equal(addProcessesToMap(store, repo.folder, { group: 'report', processes: [reportFile()], handoffs: [handoff] }).saved, true);
  home = homeData(store, repo.folder);
  assert.equal(topOfHome().nodes.code.down, 'processes:top/code'); // two processes: the node opens the processes of that place
  assert.equal(home.map!.diagrams.find((one) => one.id === 'processes:top/code')?.title, 'Processes of Code');
  // diagramsOf gives the processes with steps in a file as a level after the map, and the graphs page shows them as panels that open Home.
  const found = diagramsOf(store, repo.folder, 'src/store.py');
  assert.deepEqual(found.map((one) => [one.level, one.diagram?.id, one.lit.join()]), [['map', 'top', 'code'], ['process', 'process:run-rows', 's8']]);
  const panel = graphsData(store, repo.folder, 'src/store.py').panels[1];
  assert.deepEqual({ level: panel.level, from: panel.from, where: panel.where, open: panel.open }, {
    level: 'process', from: 'process', where: 'in: Write one row', open: { tab: 'home', diagram: 'process:run-rows', lit: ['s8'], name: 'Run the rows of a file' },
  });

  const [top, ...opened] = processDrawings(map(), map().processes!.find((one) => one.id === 'run-rows')!);
  assert.equal(top.id, 'process:run-rows');
  assert.equal(top.title, 'Run the rows of a file');
  // The top steps are main, load, save and write_row, in one box for each file, with the arrows of the writer and the call out of the repo as a quiet round box.
  assert.deepEqual(Object.keys(top.nodes).sort(), ['o0', 's0', 's6', 's7', 's8']);
  assert.match(top.mermaid, /subgraph f0\["src\/run\.py"\]/);
  assert.match(top.mermaid, /s0\["Run the rows<br><i class='ns'>5 steps<\/i>"\]/);
  assert.match(top.mermaid, /s0 -->\|"<span class='eo'>1<\/span> read the file"\| s6/); // s0 calls twice: its arrows are numbered by their lines
  assert.match(top.mermaid, /s8 -->\|"encode"\| o0/);
  assert.match(top.mermaid, /class o0 elsewhere/);
  assert.deepEqual(top.nodes.s0, { kind: 'step', files: ['src/run.py'], at: [{ file: 'src/run.py', from: 1, to: 7 }], note: { title: 'Run the rows', text: 'Does the work of this step.', where: 'run.py · lines 1-7' }, down: 'process:run-rows/0', steps: 5 });
  assert.equal(top.nodes.s6.line, 10); // a step with no inner steps opens its file at its first line
  // The lines where the call out of the repo and the arrows start, so that a mark at such a line stands on its box and its arrow.
  assert.deepEqual([top.nodes.o0.kind, top.nodes.o0.calls], ['call', [{ file: 'src/store.py', line: 5 }]]);
  assert.deepEqual(top.edgeLines?.['s8>o0'], [{ file: 'src/store.py', line: 5 }]);
  assert.deepEqual(top.edgeLines?.['s0>s6'], [{ file: 'src/run.py', line: 2 }]);
  // main opened: its inner steps in the order of the list; the call to load goes to a quiet box of the step elsewhere.
  const main = opened.find((one) => one.id === 'process:run-rows/0')!;
  assert.equal(main.title, 'run.py: Run the rows');
  assert.match(main.mermaid, /s1 --> s2\n {2}s2 --> s5/);
  assert.match(main.mermaid, /s1 -->\|"read the file"\| x6/);
  // The loop opened: its two steps in order, and the branch dotted with its label.
  const loop = opened.find((one) => one.id === 'process:run-rows/2')!;
  assert.match(loop.mermaid, /s3 --> s4/);
  assert.match(loop.mermaid, /s4 -\.->\|"next row"\| s3/);
  // The processes of a place: its process, and the process of another place that it hands to, quiet.
  const place = placeDrawing(map(), 'processes:top/code', 'Processes of Code', [map().processes!.find((one) => one.id === 'run-rows')!]);
  assert.match(place.mermaid, /q0\["Run the rows of a file<br><i class='ns'>9 steps<\/i>"\]/);
  assert.match(place.mermaid, /q0 -->\|"the same file"\| q1/);
  assert.equal(place.nodes.q1.quiet, true);
  assert.deepEqual(place.nodes.q0.at?.map((span) => `${span.file}:${span.from}-${span.to}`), ['src/run.py:1-7', 'src/run.py:10-12', 'src/run.py:15-17', 'src/store.py:4-6']);
  done();
});


test('a map from before the processes opens as before, and the command saves from a file in the repo and removes it', () => {
  const { repo, store, map } = setup();
  const before = homeData(store, repo.folder);
  assert.equal(before.map!.diagrams.length, 1);
  assert.equal(before.map!.diagrams[0].nodes.code.down, undefined);
  const stored = map();
  store.close();
  const home = tempFolder('apostil-home-');
  const copy = new Store(home);
  copy.saveMap(repoId(repo.folder), 'x', stored);
  copy.close();
  const draft = join(repo.folder, 'apostil-processes-rows.json');
  writeFileSync(draft, JSON.stringify({ group: 'rows', processes: [runRows()] }));
  const apostil = (...args: string[]) => runApostil([...args, '--folder', repo.folder], { env: { APOSTIL_HOME: home } });
  const saved = JSON.parse(apostil('add-processes', draft).stdout);
  assert.equal(saved.saved, true, saved.problems?.join(' | '));
  assert.equal(saved.draftRemoved, true);
  assert.equal(existsSync(draft), false);
  const counts = JSON.parse(apostil('processes').stdout);
  assert.equal(counts.processes, 1);
  const one = JSON.parse(apostil('process', 'run-rows').stdout);
  assert.deepEqual([one.id, one.group, one.steps.length, one.handoffs], ['run-rows', 'rows', 9, []]);
  const notes = JSON.parse(apostil('notes', 'src/store.py').stdout);
  assert.deepEqual(notes.notes.map((one: { key: string; processes?: string[] }) => [one.key, one.processes]), [['src/store.py:4-6', ['run-rows']]]);
  const atMap = JSON.parse(apostil('map').stdout);
  assert.equal(atMap.processes, 1);
  assert.match(atMap.hint, /^2 code files need notes/); // the notes come first: a process is made of notes
  assert.equal(atMap.map.processes, undefined); // the area writer reads the map: no processes in it
  repo.remove();
});
