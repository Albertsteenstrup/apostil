// Tests for "Diffs" beside the graph: which diagrams and things belong to a file and a run of its rows, and the steps over every change of the list.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DiffLine } from '../shared/diff-lines';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const CodeNotes = require('../../view/media/code-notes.js');

// The diff of a.py: rows 0–11, with its changes as runs of rows [1, 2], [6, 6], [9, 9] and [11, 11].
const lines: DiffLine[] = [
  { sign: ' ', line: 9, text: 'def renew(loan):' },
  { sign: '+', line: 10, text: '    fee = fee_of(loan)' },
  { sign: '+', line: 11, text: '    notify(loan)' },
  { sign: ' ', line: 12, text: '    return loan' },
  { sign: ' ', line: 30, text: 'def place_hold(book):' }, // a gap stands before it
  { sign: '-', line: 28, text: '    old_check(book)' }, // removed, before line 31
  { sign: ' ', line: 31, text: '    hold(book)' },
  { sign: '+', line: 40, text: 'LATE = True' }, // a gap before it
  { sign: '+', line: 60, text: 'ODD = 1' }, // a gap before it; no thing holds it
];
const rows = CodeNotes.diffRows(lines);
const runs = CodeNotes.changeRuns(rows);

const diagrams = [
  {
    id: 'flow', kind: 'flow', part: 'loans', file: 'a.py', code: {
      fee: { places: [{ file: 'a.py', lines: [10, 11] }] },
      hold: { places: [{ file: 'a.py', lines: [30, 35] }] },
      'edge:0': { places: [{ file: 'a.py', lines: [10, 11] }], filled: 'decision' }, // a way out of a decision lights with its decision only
      other: { places: [{ file: 'b.py', lines: [1, 2] }] },
      why: { places: [], why: 'Only the order.' },
    },
  },
  {
    id: 'calls', kind: 'sequence', part: 'loans', file: 'b.py', code: {
      notify: { places: [{ file: 'a.py', lines: [11, 11] }, { file: 'b.py', lines: [5, 5] }] },
      gone: { places: [{ file: 'a.py', lines: [50, 50], removed: true }] },
      late: { places: [{ file: 'a.py', lines: [40, 40] }] },
    },
  },
  { id: 'states', kind: 'state', part: 'loans', file: 'c.py', code: { idle: { places: [{ file: 'c.py', lines: [1, 3] }] } } },
  { id: 'own', kind: 'flow', part: 'loans', file: 'e.py', code: {} },
  { id: 'wide', broad: true, file: 'a.py', code: {} },
];

test('the diagrams beside a change of a file: the things at the change light, a way out of a decision does not, the diagram with a lit thing comes first after a schema of the file, a wider diagram never counts, and the box of the part of the file is marked', () => {
  assert.deepEqual(runs, [[1, 2], [6, 6], [9, 9], [11, 11]]);

  // A change in two things of two diagrams lights both, and a way out of a decision does not light with them.
  assert.deepEqual(CodeNotes.thingsAt(diagrams, 'a.py', rows, runs[0]), [{ id: 'flow', lit: ['fee'] }, { id: 'calls', lit: ['notify'] }]);

  // A change in one thing lights it; a removed row counts at the line that it stands before, and the other diagram of the file stays unlit.
  assert.deepEqual(CodeNotes.thingsAt(diagrams, 'a.py', rows, runs[1]), [{ id: 'flow', lit: ['hold'] }, { id: 'calls', lit: [] }]);

  // The diagram with a thing at the change comes first.
  assert.deepEqual(CodeNotes.thingsAt(diagrams, 'a.py', rows, runs[2]), [{ id: 'calls', lit: ['late'] }, { id: 'flow', lit: [] }]);

  // A change in no thing keeps the diagrams of the file and lights nothing.
  assert.deepEqual(CodeNotes.thingsAt(diagrams, 'a.py', rows, runs[3]), [{ id: 'flow', lit: [] }, { id: 'calls', lit: [] }]);
  assert.deepEqual(CodeNotes.thingsAt(diagrams, 'a.py', rows, null), [{ id: 'flow', lit: [] }, { id: 'calls', lit: [] }]);

  // A file with no diagram has none; a diagram whose file it is counts with no thing in it; a wider diagram never counts.
  assert.deepEqual(CodeNotes.thingsAt(diagrams, 'd.py', [], null), []);
  assert.deepEqual(CodeNotes.thingsAt(diagrams, 'e.py', [], null), [{ id: 'own', lit: [] }]);
  assert.ok(!CodeNotes.thingsAt(diagrams, 'a.py', rows, runs[0]).some((one: { id: string }) => one.id === 'wide'));

  // Beside a file that builds a schema, its schema diagram comes before a diagram with a lit thing.
  const schemaRows = CodeNotes.diffRows([{ kind: 'add', now: 1, text: 'create table fee (' }, { kind: 'add', now: 2, text: '  id uuid primary key' }, { kind: 'add', now: 3, text: ');' }]);
  const run = CodeNotes.changeRuns(schemaRows)[0];
  const place = (first: number, last: number) => ({ places: [{ file: 'db/0003_fees.sql', lines: [first, last] }] });
  const ofSchema = [
    { id: 'calls', kind: 'sequence', code: { insert: place(1, 3) } },
    { id: 'tables', kind: 'schema', file: 'db/0003_fees.sql', code: { fee: place(1, 3) } },
    { id: 'flow', kind: 'flow', code: { other: { places: [{ file: 'src/a.ts', lines: [1, 2] }] } } },
  ];
  assert.deepEqual(CodeNotes.thingsAt(ofSchema, 'db/0003_fees.sql', schemaRows, run).map((one: { id: string }) => one.id), ['tables', 'calls']);
  assert.deepEqual(CodeNotes.thingsAt(ofSchema, 'db/0003_fees.sql', schemaRows, null).map((one: { id: string }) => one.id), ['tables', 'calls']);

  // A file in no part marks the box "In no part"; a file of a part marks that part.
  const page = { parts: [{ id: 'loans', files: ['a.py'] }] };
  assert.equal(CodeNotes.partOfFile(page, 'a.py'), 'loans');
  assert.equal(CodeNotes.partOfFile(page, 'free.txt'), 'no-part');
});

test('a change taller than the view lights by the row at the reading line; the pointer on a row lights the narrowest thing that holds it; a row is held by a place by its line now, by removed lines, or by the line that it stands before', () => {
  // A new file of 1,000 lines: one change of rows 0–999, with three things at three places.
  const long = CodeNotes.diffRows(Array.from({ length: 1000 }, (_, at) => ({ sign: '+', line: at + 1, text: `line ${at + 1}` })));
  const [run] = CodeNotes.changeRuns(long);
  const flow = [{ id: 'flow', kind: 'flow', file: 'new.py', code: {
    start: { places: [{ file: 'new.py', lines: [1, 50] }] }, middle: { places: [{ file: 'new.py', lines: [400, 450] }] }, end: { places: [{ file: 'new.py', lines: [900, 950] }] },
  } }];
  const lit = (fits: boolean, lineRow: number) => CodeNotes.thingsAt(flow, 'new.py', long, CodeNotes.focusRows(run, fits, lineRow))[0].lit;
  assert.deepEqual(run, [0, 999]);
  assert.deepEqual(lit(false, 20), ['start']); // the view at the top
  assert.deepEqual(lit(false, 420), ['middle']); // the view in the middle
  assert.deepEqual(lit(false, 600), []); // a row in no thing lights nothing
  assert.deepEqual(lit(true, 420), ['start', 'middle', 'end']); // the change fits in the view
  assert.deepEqual(CodeNotes.focusRows([10, 20], false, 3), [10, 10]); // the line above the change: its nearest row
  assert.deepEqual(CodeNotes.focusRows([10, 20], false, 90), [20, 20]); // the line below it
  assert.equal(CodeNotes.focusRows(null, false, 3), null);

  // The pointer on a row lights the narrowest thing that holds it: a row inside a function its step, not the whole participant.
  const things = [{ name: 'participant', places: [{ file: 'a.py', lines: [9, 31] }] }, { name: 'step', places: [{ file: 'a.py', lines: [10, 11] }] }];
  const placesOf = (thing: { places: unknown[] }) => thing.places;
  assert.equal(CodeNotes.narrowestAt(things, placesOf, rows, 1).name, 'step'); // line 10
  assert.equal(CodeNotes.narrowestAt(things, placesOf, rows, 3).name, 'participant'); // line 12
  assert.equal(CodeNotes.narrowestAt(things, placesOf, rows, 9), null); // line 40

  // A row is held by a place: an added row by its line now, a removed row by removed lines or by the line that it stands before.
  const removedRow = rows.findIndex((row: { kind: string }) => row.kind === 'del');
  assert.equal(CodeNotes.holdsRow(rows, 1, { file: 'a.py', lines: [10, 10] }), true);
  assert.equal(CodeNotes.holdsRow(rows, 1, { file: 'a.py', lines: [11, 12] }), false);
  assert.equal(CodeNotes.holdsRow(rows, removedRow, { file: 'a.py', lines: [31, 31] }), true);
  assert.equal(CodeNotes.holdsRow(rows, removedRow, { file: 'a.py', lines: [28, 28], removed: true }), true);
  assert.equal(CodeNotes.holdsRow(rows, removedRow, { file: 'a.py', lines: [27, 27], removed: true }), false);
  assert.equal(CodeNotes.holdsRow(rows, 1, { file: 'a.py' }), false); // a whole file lights no row
});

test('the steps over the list go from change to change, over a file boundary and over a folded file, stop at both ends, and the counter counts the changes over the whole list', () => {
  const files = [{ runs: 2 }, { runs: 0 }, { runs: 3 }]; // the second file is folded, or has no rows of change
  const step = (file: number, run: number, direction: number) => CodeNotes.nextChange(files, { file, run }, direction);
  assert.deepEqual(step(0, 0, 1), { file: 0, run: 1 });
  assert.deepEqual(step(0, 1, 1), { file: 2, run: 0 });
  assert.deepEqual(step(2, 0, -1), { file: 0, run: 1 });
  assert.deepEqual(step(0, -1, 1), { file: 0, run: 0 }); // before the first change of a file
  assert.deepEqual(step(1, -1, 1), { file: 2, run: 0 }); // in the folded file
  assert.deepEqual(step(3, -1, -1), { file: 2, run: 2 }); // past the list: a generated file at its end
  assert.equal(step(2, 2, 1), null);
  assert.equal(step(0, 0, -1), null);

  // The counter counts the changes over the whole list.
  assert.deepEqual(CodeNotes.changeNumber(files, { file: 2, run: 1 }), { number: 4, total: 5 });
  assert.deepEqual(CodeNotes.changeNumber(files, { file: 1, run: -1 }), { number: 0, total: 5 });
});



// The rule of a step (stepPlace). A view at scroll place 1000, 600 pixels high, with a head of 30 over it, rows of 20 and the reading line 200 down:
// the longest move is 600 − 30 − 2 × 20 = 530, and the view shows the list from 1030 to 1600.
const view = { top: 1000, height: 600, head: 30, row: 20, reading: 200 };

test('a step down: a change within reach comes to the reading line, one out of reach moves the view less two rows, rows between two changes are passed, and the next file comes with its head at the top', () => {
  assert.deepEqual(CodeNotes.stepPlace(view, { top: 1150, bottom: 1300 }, { top: 1500, bottom: 1560 }, 1), { top: 1300, current: true });

  // A step to a change out of reach moves by the view less two rows: the last two rows of the view before are the first two under the head.
  const long = { top: 1150, bottom: 3000 }; // a change taller than the view
  const moved = CodeNotes.stepPlace(view, long, { top: 3100, bottom: 3200 }, 1);
  assert.deepEqual(moved, { top: 1530, current: false }); // the next change is not in the view yet: the long one stays the current one
  assert.equal(moved.top + view.head, view.top + view.height - 2 * view.row);
  // The next change is in the view after the move, though not at the reading line: it is the current one.
  assert.deepEqual(CodeNotes.stepPlace(view, { top: 1150, bottom: 1900 }, { top: 2050, bottom: 2100 }, 1), { top: 1530, current: true });

  // A step that would show only rows between two changes of a whole file passes them, and the change comes to the reading line.
  assert.deepEqual(CodeNotes.stepPlace(view, { top: 1100, bottom: 1200 }, { top: 5000, bottom: 5040 }, 1), { top: 4800, current: true });
  assert.deepEqual(CodeNotes.stepPlace(view, null, { top: 5000, bottom: 5040 }, 1), { top: 4800, current: true }); // from the top of a file

  // A step into the next file brings its head to the top, after the change that is read is read to its end.
  const next = { top: 1700, bottom: 1750, file: { top: 1650, bottom: 2000 } };
  assert.deepEqual(CodeNotes.stepPlace(view, { top: 1150, bottom: 1400 }, next, 1), { top: 1650, current: true });
  assert.deepEqual(CodeNotes.stepPlace(view, { top: 1150, bottom: 1800 }, next, 1), { top: 1530, current: false });
});

test('a step up, into the file above, at the ends of the list, and in a view shorter than three rows', () => {
  assert.deepEqual(CodeNotes.stepPlace(view, { top: 1300, bottom: 1400 }, { top: 900, bottom: 950 }, -1), { top: 700, current: true });
  const below = { ...view, top: 5000 };
  const moved = CodeNotes.stepPlace(below, { top: 5250, bottom: 5300 }, { top: 3000, bottom: 4900 }, -1);
  assert.deepEqual(moved, { top: 4470, current: true }); // the last rows of the long change are in the view: it is the current one
  assert.equal(moved.top + below.height, below.top + below.head + 2 * below.row);

  // A step into the file above: its last change at the reading line when it ends in the view, else the end of that file at the bottom.
  {
    const below = { ...view, top: 5000 };
    const file = { top: 4000, bottom: 4800 };
    assert.deepEqual(CodeNotes.stepPlace(below, { top: 5250, bottom: 5300 }, { top: 4700, bottom: 4750, file }, -1), { top: 4500, current: true });
    assert.deepEqual(CodeNotes.stepPlace(below, { top: 5250, bottom: 5300 }, { top: 3000, bottom: 4750, file }, -1), { top: 4200, current: true });
  }

  // At the end of the list a step reads the last change to its end, then nothing moves; at the start nothing moves.
  assert.deepEqual(CodeNotes.stepPlace(view, { top: 1150, bottom: 3000 }, null, 1), { top: 1530, current: false });
  assert.equal(CodeNotes.stepPlace(view, { top: 1150, bottom: 1400 }, null, 1), null);
  assert.equal(CodeNotes.stepPlace(view, { top: 1250, bottom: 1300 }, null, -1), null);

  // A view shorter than three rows still moves, by one row.
  const small = { top: 1000, height: 50, head: 0, row: 20, reading: 16 };
  assert.deepEqual(CodeNotes.stepPlace(small, { top: 1000, bottom: 2000 }, { top: 2100, bottom: 2120 }, 1), { top: 1020, current: false });
  assert.deepEqual(CodeNotes.stepPlace(small, { top: 1010, bottom: 1030 }, { top: 0, bottom: 990 }, -1), { top: 980, current: false });
});




