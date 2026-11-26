// Tests for what an agent reads of the map in small pieces: apostil overview, apostil find, and --text of notes, process and diagram.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Note } from '../shared/change-file';
import { repoId } from '../shared/git';
import { findInMap, mapOverview, processText } from '../shared/map-read';
import { stepKey, type Process } from '../shared/processes';
import type { RepoMap } from '../shared/repo-map';
import { Store } from '../shared/store';
import { makeTestRepo, runApostil, tempFolder } from '../shared/test-repo';
import { addNotesToMap, saveMapDraft } from './save';

const ORDERS = 'def save_order(order):\n    rows = load_rows()\n    rows.append(order)\n    write_rows(rows)\n\n\ndef load_rows():\n    return read_file("orders.txt")\n';
const USERS = 'function loadUserProfile(id) {\n  return fetchJson(`/users/${id}`);\n}\n';
const CONFIG = 'def read_config_file(path):\n    with open(path) as handle:\n        return handle.read()\n';

const shopMap = (): RepoMap => ({
  format: 1,
  diagrams: [
    { id: 'top', kind: 'flow', title: 'The shop', mermaid: 'flowchart LR\n  code["Shop code"] -->|reads| docs["Read me"]', nodePaths: { code: ['src/'], docs: ['README.md'] } },
    { id: 'storage', kind: 'flow', title: 'Order storage', parent: 'top', mermaid: 'flowchart LR\n  save["Save rows"] --> load["Load rows"]', nodePaths: { save: ['src/a.py'], load: ['src/c.py'] } },
  ],
});

// Each word of the search tests stands in one place only: "settings" in a title, "server" in a text, "config" in a snake_case name and
// "user profile" in a camelCase name of a first line of code, and "order" in titles, so that "orders" finds them only as a plural.
// The files have names of one letter, so that no word of a search stands in a path.
const note = (file: string, lines: [number, number], title: string, text: string): Note => ({ file, lines, title, text });
const NOTES = [
  note('src/a.py', [1, 4], 'Save one order', 'Appends it to the stored rows.'),
  note('src/a.py', [2, 2], 'Read the old rows', 'Calls the loader first.'),
  note('src/a.py', [7, 8], 'Load the stored rows', 'Reads them from a text file.'),
  note('src/b.js', [1, 3], 'Fetch the person', 'Asks the server for one record.'),
  note('src/c.py', [1, 3], 'Open the settings', 'Returns the whole text of one file.'),
];
const PROCESSES: Process[] = [
  { id: 'save-order', title: 'Save an order', summary: 'Stores a new order after the rows before it.', group: 'shop', steps: ['src/a.py:1-4', 'src/a.py:2-2', 'src/a.py:7-8'] },
  { id: 'show-profile', title: 'Show a profile page', summary: 'Fetches one person for the page.', group: 'shop', steps: ['src/b.js:1-3'] },
];

/** A repo with a map of three files: five notes, two processes and a handoff. `apostil` runs the command in it. */
function shop() {
  const repo = makeTestRepo();
  repo.write('src/a.py', ORDERS);
  repo.write('src/b.js', USERS);
  repo.write('src/c.py', CONFIG);
  repo.commit('shop');
  const home = tempFolder('apostil-home-');
  const store = new Store(home);
  assert.equal(saveMapDraft(store, repo.folder, shopMap()).saved, true);
  const saved = addNotesToMap(store, repo.folder, { notes: NOTES });
  assert.equal(saved.saved, true, saved.problems.join(' '));
  const handoffs = [{ from: 'save-order', to: 'show-profile', label: 'the rows', name: 'rows', fromLine: { file: 'src/a.py', line: 4 }, toLine: { file: 'src/b.js', line: 2 } }];
  store.updateMap(repoId(repo.folder), 'x', (map) => ({ ...map!, processes: PROCESSES, handoffs }));
  const apostil = (...args: string[]) => runApostil([...args, '--folder', repo.folder], { env: { APOSTIL_HOME: home } });
  return { repo, store, apostil, done: () => (store.close(), repo.remove()) };
}

/** The note lines of the output of apostil find: the lines between "Notes (…):" and the next group. */
const noteLines = (output: string): string[] => (/^Notes \(.*\):\n([\s\S]*?)(\n\n|\n?$)/.exec(output)?.[1] ?? '').split('\n').filter(Boolean);

test('find ranks a note by a word of its title, of its text, a name in the first line of its code, a camelCase or snake_case name, and a plural; it lists processes and diagrams, keeps to --limit, and says when nothing matches', () => {
  const { apostil, done } = shop();
  const first = (words: string): string => noteLines(apostil('find', words).stdout)[0] ?? '';
  assert.equal(first('settings'), 'src/c.py:1-3  Open the settings: Returns the whole text of one file.'); // a word of the title
  assert.equal(first('server'), 'src/b.js:1-3  Fetch the person: Asks the server for one record.  [show-profile]'); // a word of the text
  assert.match(first('config'), /^src\/c\.py:1-3 /); // a snake_case name in the first line of its code: def read_config_file
  assert.match(first('user profile'), /^src\/b\.js:1-3 /); // a camelCase name: function loadUserProfile
  assert.match(first('orders'), /^src\/a\.py:1-4  Save one order/); // a plural: the title says "order"
  assert.match(first('appending'), /^src\/a\.py:1-4 /); // an -ing word meets "Appends"

  // The words of an issue: the processes and the diagrams that match, best first, in their own groups.
  const found = apostil('find', 'save', 'the', 'orders');
  assert.equal(found.status, 0);
  assert.match(found.stdout, /^Notes \(\d+ of \d+ that match\):\nsrc\/a\.py:1-4  Save one order: Appends it to the stored rows\.  \[save-order\]\n/);
  assert.match(found.stdout, /\n\nProcesses \(1 of 1 that match\):\nprocess save-order  Save an order \(3 steps\)\n/);
  assert.match(found.stdout, /\n\nDiagrams \(1 of 1 that match\):\ndiagram storage  Order storage\n$/);

  // --limit keeps the notes to that many; with no match one line names the overview.
  assert.equal(noteLines(apostil('find', 'rows', '--limit', '1').stdout).length, 1);
  assert.ok(noteLines(apostil('find', 'rows').stdout).length > 1);
  const none = apostil('find', 'zebra');
  assert.equal(none.status, 0);
  assert.equal(none.stdout, 'Nothing in the map matches "zebra". Try other words, or read apostil overview.\n');
  assert.equal(apostil('find').status, 1);
  done();
});

test('find lists the notes of test files last, in a group of their own, and finds a note by a word of its path', () => {
  // The test note says "save" and "order" twice in few words: in one list it would come first.
  const fileNotes = [
    note('tests/test_orders.py', [1, 2], 'Save an order twice', 'Checks that a second save of an order adds a row.'),
    note('src/orders.py', [1, 9], 'Save one order', 'Appends the order to the rows and writes the file.'),
    note('render/page.go', [1, 3], 'Write the page', 'Puts the text out.'),
  ];
  const stored = { map: { format: 1 as const, diagrams: shopMap().diagrams.slice(0, 1), fileNotes }, savedAt: '', commit: '' };
  const folder = tempFolder('apostil-find-');
  assert.equal(findInMap(folder, stored, 'save order'), [
    'Notes (1 of 1 that match):', 'src/orders.py:1-9  Save one order: Appends the order to the rows and writes the file.',
    '', 'Notes of tests (1 of 1 that match):', 'tests/test_orders.py:1-2  Save an order twice: Checks that a second save of an order adds a row.',
  ].join('\n'));
  assert.match(findInMap(folder, stored, 'render'), /^Notes \(1 of 1 that match\):\nrender\/page\.go:1-3  Write the page/); // a word of its path only
});

test('notes --text and process --text print a line for each note and step; a note whose lines moved shows its new lines, and a note whose lines changed says so; the JSON of notes keeps every field and adds now and changed', () => {
  const { repo, apostil, done } = shop();
  const json = (path: string) => JSON.parse(apostil('notes', path).stdout);
  const before = json('src/a.py');
  assert.deepEqual(Object.keys(before), ['file', 'notes', 'standing', 'older']);
  assert.deepEqual(before.notes.map((one: object) => Object.keys(one)), [0, 1, 2].map(() => ['key', 'file', 'lines', 'title', 'text', 'processes']));
  assert.deepEqual([before.notes[0].key, before.notes[0].processes, before.standing, before.older], ['src/a.py:1-4', ['save-order'], 3, 0]);

  assert.equal(apostil('notes', 'src/a.py', 'src/c.py', '--text').stdout, [
    'src/a.py  3 notes',
    '1-4  Save one order: Appends it to the stored rows.  [save-order]',
    '2-2  Read the old rows: Calls the loader first.  [save-order]',
    '7-8  Load the stored rows: Reads them from a text file.  [save-order]',
    '',
    'src/c.py  1 note',
    '1-3  Open the settings: Returns the whole text of one file.',
  ].join('\n') + '\n');
  assert.equal(apostil('process', 'save-order', '--text').stdout, [
    'process save-order  Save an order',
    'Stores a new order after the rows before it.',
    '3 steps:',
    'src/a.py:1-4  Save one order',
    '  src/a.py:2-2  Read the old rows', // a step inside another step stands further in
    'src/a.py:7-8  Load the stored rows',
    'Handoffs:',
    'save-order -> show-profile: the rows  (rows, src/a.py:4 -> src/b.js:2)',
  ].join('\n') + '\n');

  // Two new lines above the code of a.py: each note and step shows at its lines now, also in find; the JSON adds "now" and keeps "lines".
  repo.write('src/a.py', `# The orders.\n# One row for each.\n${ORDERS}`);
  assert.deepEqual(apostil('notes', 'src/a.py', '--text').stdout.split('\n').slice(0, 4), [
    'src/a.py  3 notes', '3-6  Save one order: Appends it to the stored rows.  [save-order]', '4-4  Read the old rows: Calls the loader first.  [save-order]', '9-10  Load the stored rows: Reads them from a text file.  [save-order]',
  ]);
  assert.match(apostil('process', 'save-order', '--text').stdout, /\nsrc\/a\.py:3-6  Save one order\n  src\/a\.py:4-4  Read the old rows\nsrc\/a\.py:9-10  Load the stored rows\n/);
  assert.equal(noteLines(apostil('find', 'save order').stdout)[0], 'src/a.py:3-6  Save one order: Appends it to the stored rows.  [save-order]');
  const moved = json('src/a.py');
  assert.deepEqual(moved.notes.map((one: { lines: number[]; now?: number[] }) => [one.lines, one.now]), [[[1, 4], [3, 6]], [[2, 2], [4, 4]], [[7, 8], [9, 10]]]);

  // The first line of c.py changed: its note stays at its saved lines, and says that they changed.
  repo.write('src/c.py', CONFIG.replace('(path)', '(path, mode)'));
  assert.equal(apostil('notes', 'src/c.py', '--text').stdout, 'src/c.py  1 note, 1 changed since the map\n1-3  Open the settings: Returns the whole text of one file.  (changed since the map)\n');
  assert.equal(noteLines(apostil('find', 'settings').stdout)[0], 'src/c.py:1-3  Open the settings: Returns the whole text of one file.  (changed since the map)');
  const changed = json('src/c.py');
  assert.deepEqual([changed.notes[0].changed, changed.notes[0].now, changed.standing, changed.older], [true, undefined, 0, 1]);
  done();
});

test('diagram --text prints the title, the kind, the Mermaid text and the paths of each node; overview names the top diagram, the areas, the counts and the next commands', () => {
  const { apostil, done } = shop();
  assert.equal(apostil('diagram', 'storage', '--text').stdout, 'diagram storage  Order storage (flow)\nflowchart LR\n  save["Save rows"] --> load["Load rows"]\nsave: src/a.py\nload: src/c.py\n');
  const overview = apostil('overview').stdout;
  assert.equal(overview, [
    'diagram top  The shop', 'Its nodes, with their folders and files:', 'code  Shop code: src/', 'docs  Read me: README.md', 'Its arrows:', 'code -> docs: reads',
    '', 'The diagrams of its areas:', 'diagram storage  Order storage',
    '', '2 processes and 5 notes in 3 files.',
    '', 'Next:',
    'apostil find "<words of your task>"   the notes, processes and diagrams that match, best first',
    'apostil notes <path> [<path> ...] --text   the notes of files, at their lines now',
    'apostil process <id> --text   the steps of a process, in the order that the code runs them',
    'apostil diagram <id>   one diagram',
  ].join('\n') + '\n');
  done();
  // With no map, one plain line says to work as without Apostil.
  const bare = makeTestRepo();
  const empty = runApostil(['overview', '--folder', bare.folder], { env: { APOSTIL_HOME: tempFolder('apostil-home-') } });
  assert.deepEqual([empty.status, empty.stdout], [1, 'This repo has no map of Apostil. Find and read the code as you would without Apostil.\n']);
  bare.remove();
});

test('overview stays under 8,000 characters on a map of 300 processes and 30 areas, and lists no process', () => {
  const area = (at: number) => ({ id: `area-${at}`, kind: 'flow' as const, title: `The work of the part number ${at} of the shop`, parent: 'top', mermaid: 'flowchart LR\n  a --> b', nodePaths: { a: [`src/part${at}/`], b: [`lib/part${at}/`] } });
  const nodes = Array.from({ length: 12 }, (_, at) => `  n${at}["The part number ${at}"] --> n${(at + 1) % 12}`).join('\n');
  const top = { id: 'top', kind: 'flow' as const, title: 'The shop', mermaid: `flowchart LR\n${nodes}`, nodePaths: Object.fromEntries(Array.from({ length: 12 }, (_, at) => [`n${at}`, Array.from({ length: 6 }, (__, file) => `src/part${at}/file_${file}.py`)])) };
  const processes = Array.from({ length: 300 }, (_, at): Process => ({ id: `process-${at}`, title: `Run the job number ${at}`, summary: 'Does one job.', group: 'g', steps: ['src/a.py:1-2'] }));
  const fileNotes = Array.from({ length: 850 }, (_, at) => note(`src/f${at % 60}.py`, [at + 1, at + 1], `Set the value ${at}`, 'Sets it.'));
  const map: RepoMap = { format: 1, diagrams: [top, ...Array.from({ length: 30 }, (_, at) => area(at))], processes, fileNotes };
  const text = mapOverview({ map, savedAt: '', commit: '' });
  assert.ok(text.length < 8000, `${text.length} characters`);
  assert.match(text, /\n300 processes and 850 notes in 60 files\.\n/);
  assert.ok(!text.includes('process-'), 'no process is listed');
});

test('the skill apostil-read-diagrams starts at the overview, then find and --text, in at most 60 lines', () => {
  const skill = readFileSync(join(__dirname, '..', '..', 'skills', 'apostil-read-diagrams', 'SKILL.md'), 'utf8');
  for (const words of ['apostil overview', 'apostil find', '--text', 'name: apostil-read-diagrams']) assert.ok(skill.includes(words), words);
  assert.ok(skill.trimEnd().split('\n').length <= 60, `${skill.trimEnd().split('\n').length} lines`);
  assert.ok(skill.includes('## Broader diagrams and a change')); // the describe skill points to it
  // Its description holds ": ", so it stands in quotes: else a strict YAML reader refuses the head of the skill, and the app does not load it.
  const description = /^description: (.*)$/m.exec(skill)?.[1] ?? '';
  assert.ok(!description.includes(': ') || /^"[^"\\]*"$/.test(description), description);
});

test('process --text puts each step after the step that it lies under, also when that step comes later in the list', () => {
  const fileNotes = [note('src/a.py', [1, 10], 'Run it', 'Runs.'), note('src/b.py', [1, 5], 'Help', 'Helps.'), note('src/a.py', [3, 4], 'Ask for help', 'Asks.')];
  const process: Process = { id: 'run', title: 'Run it', summary: 'Runs.', group: 'g', steps: fileNotes.map(stepKey), arrows: [{ from: 'src/a.py:3-4', to: 'src/b.py:1-5', fromLine: 3, toLine: 1, name: 'help' }] };
  const stored = { map: { format: 1 as const, diagrams: shopMap().diagrams.slice(0, 1), fileNotes, processes: [process] }, savedAt: '', commit: '' };
  assert.deepEqual(processText(tempFolder('apostil-text-'), stored, 'run')!.split('\n').slice(3), ['src/a.py:1-10  Run it', '  src/a.py:3-4  Ask for help', '    src/b.py:1-5  Help']);
});
