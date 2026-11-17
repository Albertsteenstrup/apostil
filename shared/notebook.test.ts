// Tests for a notebook read by its cells, with made-up notebooks: the cells, the change by cells, a place in a cell, and the save.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { checkDraft, saveDraft } from '../store/save';
import { changeMaterial, forFreshCheck } from '../store/material';
import { changedFiles, fileDiff, fileText } from './git';
import { cellsAt, cellsOfText, findCell, headLine, notebookCells, notebookText, placeInCell, readNotebook } from './notebook';
import { notesInRepo } from './notes-beside-code';
import { Store } from './store';
import { makeNotebookRepo, notebookChangeFile, notebookJson, tempFolder } from './test-repo';
import { diffLines } from './diff-lines';
import { writeFileSync } from 'node:fs';
import { git } from './git';
import { textDiff } from './text-diff';

const repo = makeNotebookRepo();
after(() => repo.remove());

test('the diff of two texts of cells, made in the process with no file, has the same lines as the diff of Git, and a diff of two long texts ends at once', () => {
  const folder = tempFolder('apostil-diff-');
  const pairs = [
    ['a\nb\nc\n', 'a\nx\nc\n'], ['', 'a\nb\n'], ['a\nb\n', ''], ['1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n', '0\n1\n2\n3\n4\n5\nsix\n7\n8\n9\n10\n11\n12\n13\n'],
    ['x\ny\nz\n', 'z\ny\nx\n'], ['same\n', 'same\n'],
  ];
  const body = (diff: string) => diff.split('\n').filter((line) => /^[-+ @]/.test(line) && !/^(---|\+\+\+) /.test(line)).map((line) => line.replace(/ @@.*$/, ' @@'));
  for (const [before, after] of pairs) {
    writeFileSync(`${folder}/a`, before);
    writeFileSync(`${folder}/b`, after);
    let byGit = '';
    try { byGit = git(folder, 'diff', '--no-index', '--no-color', 'a', 'b'); } catch (error) { byGit = String((error as { stdout?: string }).stdout ?? ''); }
    assert.deepEqual(body(textDiff(before, after, 'n.ipynb')), body(byGit.replace(/\n$/, '')), JSON.stringify([before, after]));
  }

  // The diff of two long texts ends at once: a long new text, a text with one changed line, and two texts with nothing in common.
  const lines = (count: number, word: string) => Array.from({ length: count }, (_, at) => `${word} ${at}`);
  const signs = (diff: string) => diff.split('\n').slice(3).filter((line) => !line.startsWith('@@')).map((line) => line[0]).join('');
  const long = lines(20000, 'a');
  assert.equal(signs(textDiff('', `${long.join('\n')}\n`, 'n.ipynb')), '+'.repeat(20000));
  const one = [...long];
  one[10000] = 'changed';
  assert.equal(signs(textDiff(`${long.join('\n')}\n`, `${one.join('\n')}\n`, 'n.ipynb')), '   -+   ');
  // Nothing in common, and more lines than the search goes through: every line is removed and added, and the two texts are still whole in the diff.
  const other = lines(3000, 'b');
  const apart = textDiff(`${lines(3000, 'a').join('\n')}\n`, `${other.join('\n')}\n`, 'n.ipynb').split('\n').slice(4);
  assert.deepEqual(apart.filter((line) => line[0] === '+').map((line) => line.slice(1)), other);
  assert.equal(apart.filter((line) => line[0] === '-').length, 3000);
});

test('a notebook reads as its cells, with ids and with none, "source" as a list and as one string, the outputs left out; the text of the cells has a head line for each cell, and the places of the cells are the same read from the cells and from the text', () => {
  const withIds = readNotebook(notebookJson([{ kind: 'markdown', id: 'a1', lines: ['# Title'] }, { kind: 'code', id: 'b2', lines: ['x = 1', 'print(x)'], out: '1' }]))!;
  assert.deepEqual(withIds, [{ kind: 'text', id: 'a1', lines: ['# Title'] }, { kind: 'code', id: 'b2', lines: ['x = 1', 'print(x)'], output: true }]);
  const asString = readNotebook(notebookJson([{ kind: 'code', lines: ['x = 1', 'print(x)'] }, { kind: 'code', lines: [] }], false))!;
  assert.deepEqual(asString, [{ kind: 'code', lines: ['x = 1', 'print(x)'] }, { kind: 'code', lines: [] }]);
  assert.equal(readNotebook('{ not json'), undefined);
  assert.equal(readNotebook('{"cells": "no"}'), undefined);
  assert.equal(readNotebook('[1, 2]'), undefined);

  // The text of the cells has a head line for each cell, and the places of the cells are the same read from the cells and from the text.
  const cells = readNotebook(notebookJson([{ kind: 'markdown', id: 'a1', lines: ['# Title'] }, { kind: 'code', lines: ['x = 1', 'print(x)'] }]))!;
  assert.equal(notebookText(cells), '«cell text a1»\n# Title\n«cell code»\nx = 1\nprint(x)\n');
  assert.equal(headLine({ kind: 'code' }), '«cell code»');
  const at = cellsAt(cells);
  assert.deepEqual(at.map(({ number, at: line, length }) => [number, line, length]), [[1, 1, 1], [2, 3, 2]]);
  assert.deepEqual(cellsOfText(notebookText(cells)).map(({ number, at: line, length, id }) => [number, line, length, id]), [[1, 1, 1, 'a1'], [2, 3, 2, undefined]]);
  assert.deepEqual(cellsOfText('def x():\n  pass'), []); // no notebook
  assert.equal(findCell(at, 'a1')?.number, 1);
  assert.equal(findCell(at, 2)?.number, 2);
  assert.equal(findCell(at, '2')?.number, 2); // a number written as text
  assert.equal(findCell(at, 'zz'), undefined);
  assert.deepEqual(placeInCell(at, 'n.ipynb', 2, [2, 2]), { lines: [5, 5], inCell: { words: 'cell 2', lines: [2, 2], at: 3, length: 2 } });
  assert.deepEqual(placeInCell(at, 'n.ipynb', 2, [1, 3]), { problem: 'Line 3 is after the end of cell 2 of n.ipynb, which has 2 lines.' });
  assert.deepEqual(placeInCell(at, 'n.ipynb', 'zz', [1, 1]), { problem: 'n.ipynb has no cell "zz". Its cells: 1 (id a1), 2.' });
});

test('the change of a notebook is the change of its cells, counted in lines of cells, with no outputs and no raw JSON; one in which only outputs changed says so; a .ipynb file that is not a notebook is shown as text', () => {
  const files = changedFiles(repo.folder, repo.base);
  const fees = files.find((file) => file.path === 'notebooks/fees.ipynb')!;
  assert.deepEqual([fees.added, fees.removed, fees.notebook], [7, 5, undefined]); // the rule (2) and the moved summary (1) added, the fee changed (+4 −2), the old report (2) and the summary (1) removed
  const diff = fileDiff(repo.folder, repo.base, 'notebooks/fees.ipynb');
  assert.ok(!diff.includes('"source"') && !diff.includes('outputs') && !diff.includes('execution_count'), diff);
  assert.ok(diff.includes('+        return 0'));
  assert.ok(diff.startsWith('diff --git a/notebooks/fees.ipynb b/notebooks/fees.ipynb'));
  const older = files.find((file) => file.path === 'notebooks/older.ipynb')!;
  assert.deepEqual([older.added, older.removed], [1, 1]); // a notebook with no ids and "source" as one string
  // Which cell is new, removed, moved or changed.
  const lines = diffLines(diff);
  const of = (sign: string) => new Set(lines.filter((line) => line.sign === sign).map((line) => line.line));
  const before = readNotebook(fileTextAt(repo.folder, repo.base))!;
  const now = readNotebook(fileTextAt(repo.folder))!;
  const cells = notebookCells(before, now, of('-'), of('+'));
  assert.deepEqual(cells.now.map((cell) => `${cell.words}${cell.state ? ` (${cell.state})` : ''}`), [
    'cell 1 · text · id intro', 'cell 2 · text · id summary (moved from cell 6)', 'cell 3 · text · id rule (new)', 'cell 4 · code · id load',
    'cell 5 · code · id fee (changed)', 'cell 6 · code · id total',
  ]);
  assert.deepEqual(cells.before.filter((cell) => cell.state).map((cell) => `${cell.words} (${cell.state})`), ['cell 5 · code · id old (removed)', 'cell 6 · text · id summary (moved to cell 2)']);
  assert.equal(cells.before[2].key, cells.now[4].key); // the changed cell has one head over its removed and added lines
  assert.ok(cells.now[3].output && !cells.now[4].output);

  // A notebook in which only outputs and run counts changed says so and counts nothing; a .ipynb file that is not a notebook is shown as text.
  {
    const files = changedFiles(repo.folder, repo.base);
    assert.deepEqual(files.find((file) => file.path === 'notebooks/outputs.ipynb'), { path: 'notebooks/outputs.ipynb', added: 0, removed: 0, status: 'changed', notebook: 'only-outputs' });
    assert.equal(fileDiff(repo.folder, repo.base, 'notebooks/outputs.ipynb'), '');
    const broken = files.find((file) => file.path === 'notebooks/broken.ipynb')!;
    assert.deepEqual([broken.added, broken.removed, broken.notebook], [1, 1, 'not-read']);
    assert.equal(fileText(repo.folder, 'notebooks/broken.ipynb'), '{ "cells": [ this is still not JSON\n');
    assert.match(fileDiff(repo.folder, repo.base, 'notebooks/broken.ipynb'), /^\+\{ "cells": \[ this is still not JSON$/m);
  }
});

/** The raw notebook fees.ipynb at the base, or now. */
const fileTextAt = (folder: string, commit?: string): string => require('./git').rawFileText(folder, 'notebooks/fees.ipynb', commit);

test('the save checks a note in a cell as a note in a file, refuses a note or a place that names lines of the raw file, and checks a note with no cell on a file that is no notebook as before', () => {
  const good = checkDraft(repo.folder, notebookChangeFile(), repo.base);
  assert.deepEqual([good.problems, good.checks?.badNotes], [[], []]);
  const file = notebookChangeFile();
  file.parts[0].notes!.push(
    { file: 'notebooks/fees.ipynb', cell: 'nope', lines: [1, 1], title: 'No such cell' },
    { file: 'notebooks/fees.ipynb', cell: 5, lines: [1, 9], title: 'Too long' },
    { file: 'notebooks/fees.ipynb', cell: 'load', lines: [1, 1], removed: true, title: 'Not removed' },
  );
  const bad = checkDraft(repo.folder, file, repo.base).checks!.badNotes;
  assert.deepEqual(bad.map((one) => [one.title, one.problem]), [
    ['No such cell', 'notebooks/fees.ipynb has no cell "nope". Its cells: 1 (id intro), 2 (id summary), 3 (id rule), 4 (id load), 5 (id fee), 6 (id total).'],
    ['Too long', 'Line 9 is after the end of cell 5 of notebooks/fees.ipynb, which has 4 lines.'],
    ['Not removed', 'Line 1 of cell 2 of notebooks/fees.ipynb is not a line that the change removed. Lines of a removed note count in the file as it was before the change. The change removed no lines of cell 2 of notebooks/fees.ipynb.'],
  ]);
  // A place in a cell of a diagram that is not there.
  file.diagrams![0].nodeLines!.fee = { cell: 'fee', lines: [5, 6] };
  assert.ok(checkDraft(repo.folder, file, repo.base).checks!.badNotes.some((one) => one.problem === 'Node "fee": Line 6 is after the end of cell "fee" of notebooks/fees.ipynb, which has 4 lines.'));

  // The save refuses a note or a place in a notebook that names lines of the raw file, with a sentence that a writer can act on.
  {
    const file = notebookChangeFile();
    file.parts[0].notes!.push({ file: 'notebooks/fees.ipynb', lines: [120, 124], title: 'Raw lines' });
    file.diagrams![0].nodeLines!.fee = { file: 'notebooks/fees.ipynb', lines: [40, 41] };
    file.parts[1].notes!.push({ file: 'notebooks/broken.ipynb', lines: [1, 1], title: 'Not a notebook: lines of the file are right' });
    const result = checkDraft(repo.folder, file, repo.base);
    assert.deepEqual(result.problems, [
      'The note at notebooks/fees.ipynb lines 120-124 names lines of the raw file. Name the cell and the lines inside it.',
      'Diagram "fee-flow": The node "fee" at notebooks/fees.ipynb lines 40-41 names lines of the raw file. Name the cell and the lines inside it.',
    ]);
    const store = new Store(tempFolder('apostil-home-'));
    assert.equal(saveDraft(store, repo.folder, file).saved, false);
    store.close();
  }

  // A change file and a store from before this build still open: a note with no cell on a file that is no notebook is checked as before.
  {
    const file = notebookChangeFile();
    file.parts.push({ id: 'app', name: 'App', files: ['src/app.py'], notes: [{ file: 'src/app.py', lines: [1, 2], title: 'Start the app' }] });
    const result = checkDraft(repo.folder, file, repo.base);
    assert.deepEqual(result.problems, []);
    assert.ok(!result.checks!.badNotes.length, JSON.stringify(result.checks!.badNotes));
  }
});

test('what a writer reads shows a notebook by its cells; a note in a cell is saved with the lines of its cell and found again after a cell was put in above it, the nearest cell when its text is there twice; and the checker reads the cells too', () => {
  const store = new Store(tempFolder('apostil-home-'));
  // What a writer and a checker read shows a notebook by its cells, with the name of each cell and the lines inside it.
  const material = changeMaterial(store, repo.folder) as unknown as { files: { path: string; cells?: { cell: string | number; change?: string; lines?: string[]; lineCount?: number }[]; removedCells?: { cell: string; change: string; removedLines: string[] }[] }[]; notebooks?: string };
  const fees = material.files.find((file) => file.path === 'notebooks/fees.ipynb')!;
  assert.deepEqual(fees.cells!.find((cell) => cell.cell === 'fee'), { cell: 'fee', number: 5, kind: 'code', change: 'changed', lines: ['1: def fee(days, rate=2):', '2:     if days <= 0:', '3:         return 0', '4:     return days * rate'] });
  assert.deepEqual(fees.cells!.find((cell) => cell.cell === 'load'), { cell: 'load', number: 4, kind: 'code', lineCount: 3 });
  assert.deepEqual(fees.removedCells!.map((cell) => [cell.cell, cell.change, cell.removedLines]), [
    ['old', 'removed', ['1: def old_report():', '2:     print(total)']], ['summary', 'moved to cell 2', ['1: The total is the sum of the fees.']],
  ]);
  assert.equal(material.files.find((file) => file.path === 'notebooks/older.ipynb')!.cells![1].cell, 2); // no ids: the number
  assert.match(material.notebooks!, /names "cell"/);

  // A note in a cell is saved with the lines of its cell.
  const saved = saveDraft(store, repo.folder, notebookChangeFile());
  assert.equal(saved.saved, true, saved.problems.join(' '));
  assert.deepEqual(store.getChange(saved.changeId!)!.noteCode!['fees/0'], ['    if days <= 0:', '        return 0']);
  const text = fileText(repo.folder, 'notebooks/fees.ipynb')!;
  const found = notesInRepo(store, repo.folder, 'notebooks/fees.ipynb', text);
  const noFee = found.notes.find((one) => one.note.title === 'No fee before the due day')!;
  const cells = cellsOfText(text);
  assert.deepEqual(noFee.lines, [cells[4].at + 2, cells[4].at + 3]);
  // A new cell above: the note moves down with its cell.
  const above = notebookText([{ kind: 'code', lines: ['import math'] }, ...readNotebook(require('./git').rawFileText(repo.folder, 'notebooks/fees.ipynb'))!]);
  const moved = notesInRepo(store, repo.folder, 'notebooks/fees.ipynb', above).notes.find((one) => one.note.title === 'No fee before the due day')!;
  assert.deepEqual(moved.lines, [noFee.lines[0] + 2, noFee.lines[1] + 2]);
  // The same lines in another cell far above: the note stays in the nearest cell, its own.
  const twice = notebookText([{ kind: 'code', lines: ['    if days <= 0:', '        return 0'] }, ...readNotebook(require('./git').rawFileText(repo.folder, 'notebooks/fees.ipynb'))!]);
  const near = notesInRepo(store, repo.folder, 'notebooks/fees.ipynb', twice).notes.find((one) => one.note.title === 'No fee before the due day')!;
  assert.deepEqual(near.lines, [noFee.lines[0] + 3, noFee.lines[1] + 3]);

  // The checker reads the lines of each note and each place in its cell.
  const forCheck = forFreshCheck(store, repo.folder, 'fees')!;
  assert.deepEqual(forCheck.ranges.find((range) => range.titles.includes('No fee before the due day')), {
    file: 'notebooks/fees.ipynb', cell: 'fee', lines: [2, 3], titles: ['No fee before the due day'], code: ['2:     if days <= 0:', '3:         return 0'],
  });
  assert.deepEqual(forCheck.ranges.find((range) => range.removed)?.code, ['1: [removed] def old_report():', '2: [removed]     print(total)']);
  const early = forCheck.things.find((thing) => 'node' in thing && thing.node === 'early') as unknown as { places: { cell: string; lines: number[]; code: string[] }[] };
  assert.deepEqual(early.places, [{ file: 'notebooks/fees.ipynb', cell: 'fee', lines: [2, 2], code: ['2:     if days <= 0:'] }]);
  store.close();
});


