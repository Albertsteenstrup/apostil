// Tests for a notebook on the pages, with made-up notebooks: its files by cells, the rows of "Diffs" and of the file tab with a head for each cell,
// the notes and the places of a diagram in a cell, and the steps from change to change through the cells.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { makeNotebookRepo, notebookChangeFile } from '../shared/test-repo';
import { answer, examplePage, type CodeAnswer } from './page-data';
import type { DiffLine } from '../shared/diff-lines';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const CodeNotes = require('../../view/media/code-notes.js');

const repo = makeNotebookRepo();
after(() => repo.remove());
const page = examplePage(repo.folder, repo.base, notebookChangeFile(), []);
const FEES = 'notebooks/fees.ipynb';
const fees = page.files.find((file) => file.path === FEES)!;
type Row = { kind: string; line: number | ''; now: number; num?: number; text: string; plain?: true; cell?: { words: string; state?: string; output?: true } };
const heads = (rows: Row[]) => rows.filter((row) => row.kind === 'cell').map((row) => `${row.text}${row.cell!.state ? ` (${row.cell!.state})` : ''}${row.cell!.output ? ' [output]' : ''}`);

test('"Diffs" shows a notebook as its cells, with a quiet head for each cell and its lines numbered inside the cell, and a thing of a diagram with a place in a cell lights the rows of that cell', () => {
  const rows: Row[] = CodeNotes.diffRows(answer(page, `diff:${FEES}`) as DiffLine[], fees.cells);
  assert.deepEqual(heads(rows), [
    'cell 1 · text · id intro', 'cell 2 · text · id summary (moved from cell 6)', 'cell 3 · text · id rule (new)', 'cell 4 · code · id load [output]',
    'cell 5 · code · id fee (changed)', 'cell 6 · code · id total [output]', 'cell 5 · code · id old (removed)', 'cell 6 · text · id summary (moved to cell 2)',
  ]);
  assert.ok(!rows.some((row) => row.text.startsWith('«cell')));
  const fee = rows.slice(rows.findIndex((row) => row.text === 'cell 5 · code · id fee'));
  assert.deepEqual(fee.slice(1, 7).map((row) => [row.kind, row.num, row.text]), [
    ['del', 1, 'def fee(days):'], ['del', 2, '    return days * 2'], ['add', 1, 'def fee(days, rate=2):'], ['add', 2, '    if days <= 0:'], ['add', 3, '        return 0'], ['add', 4, '    return days * rate'],
  ]);
  assert.ok(rows.filter((row) => row.text.startsWith('## The rule')).every((row) => row.plain)); // a text cell is shown as written
  // Alt+Down goes from change to change through the cells: a head between two changes splits them.
  assert.equal(CodeNotes.changeRuns(rows).length, 5);

  // A thing of a diagram with a place in a cell lights the rows of that cell, and its counts are lines of the cell.
  {
    const diagram = page.diagrams.find((one) => one.id === 'fee-flow')!;
    const rows: Row[] = CodeNotes.diffRows(answer(page, `diff:${FEES}`) as DiffLine[], fees.cells);
    const early = diagram.code.early;
    assert.deepEqual(early.places[0].inCell?.lines, [2, 2]);
    assert.deepEqual(early.counts, { added: 1, removed: 0 });
    const at = rows.findIndex((row) => row.text === '    if days <= 0:');
    assert.deepEqual(CodeNotes.thingsAt(page.diagrams, FEES, rows, [at, at]), [{ id: 'fee-flow', lit: ['early'] }]);
  }
});

test('the file tab shows the notebook by its cells with its notes beside the lines of their cell, and the files of a page count lines of cells, say when only outputs changed, and when a .ipynb file is shown as text', () => {
  const code = answer(page, `code:${FEES}`) as CodeAnswer;
  const rows: Row[] = CodeNotes.fileRows(code);
  assert.deepEqual(heads(rows).slice(0, 3), ['cell 1 · text · id intro', 'cell 2 · text · id summary (moved from cell 6)', 'cell 3 · text · id rule (new)']);
  assert.ok(heads(rows).includes('cell 5 · code · id old (removed)'));
  const note = page.notes.find((one) => one.title === 'No fee before the due day')!;
  assert.deepEqual(note.inCell, { words: 'cell 5', lines: [2, 3], at: 13, length: 4 });
  const span = CodeNotes.spanOf(rows, note);
  assert.deepEqual(rows.slice(span[0], span[1] + 1).map((row) => [row.num, row.text]), [[2, '    if days <= 0:'], [3, '        return 0']]);
  const removed = page.notes.find((one) => one.removed)!;
  const gone = CodeNotes.spanOf(rows, removed);
  assert.deepEqual(rows.slice(gone[0], gone[1] + 1).map((row) => [row.kind, row.num, row.text]), [['del', 1, 'def old_report():'], ['del', 2, '    print(total)']]);

  // The files of a page: a notebook counts lines of its cells, one in which only outputs changed says so, and a .ipynb file that is not a notebook says it is shown as text.
  assert.deepEqual([fees.added, fees.removed], [7, 5]);
  const outputs = page.files.find((file) => file.path === 'notebooks/outputs.ipynb')!;
  assert.deepEqual([outputs.added, outputs.removed, outputs.quiet], [0, 0, 'only outputs changed']);
  assert.deepEqual(answer(page, 'diff:notebooks/outputs.ipynb'), []);
  const broken = page.files.find((file) => file.path === 'notebooks/broken.ipynb')!;
  assert.deepEqual([broken.quiet, broken.cells], ['does not read as a notebook, shown as text', undefined]);
  assert.deepEqual(page.checks.badNotes, []);
});


