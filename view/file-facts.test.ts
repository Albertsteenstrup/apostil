// Tests for files whose text the page does not show (pictures, binary files, empty files, links, a new mode),
// for renamed files on the page, and for the rows of a note on removed lines. On a small real repo.

import assert from 'node:assert/strict';
import { chmodSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { ChangeFile } from '../shared/change-file';
import { git } from '../shared/git';
import { makeTestRepo } from '../shared/test-repo';
import { answer, examplePage, sizeText, type PictureAnswer } from './page-data';
import type { DiffLine } from '../shared/diff-lines';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const CodeNotes = require('../../view/media/code-notes.js');

const numbered = (count: number, word = 'line'): string => Array.from({ length: count }, (_, at) => `${word} ${at + 1}\n`).join('');
const picture = (size: number): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]), Buffer.alloc(size)]); // a PNG head and zero bytes

const repo = makeTestRepo();
const writeBytes = (path: string, bytes: Buffer): void => writeFileSync(join(repo.folder, path), bytes);
writeBytes('logo.png', picture(2000));
repo.write('run.sh', 'echo hi\n');
repo.write('old/card.ts', numbered(40, 'card'));
repo.write('gone.py', numbered(5, 'gone'));
const base = repo.commit('the base');
git(repo.folder, 'checkout', '-q', '-b', 'odd');
writeBytes('logo.png', picture(5000));
writeBytes('new.png', picture(100));
writeBytes('data.bin', Buffer.from(`${'\0'.repeat(10)}x`));
repo.write('empty.txt', '');
chmodSync(join(repo.folder, 'run.sh'), 0o755);
symlinkSync('src/app.py', join(repo.folder, 'link-to-app'));
git(repo.folder, 'rm', '-q', 'old/card.ts', 'gone.py');
repo.write('new/library-card.ts', numbered(40, 'card').replace('card 7\n', 'card 7\nadded line\n'));
repo.commit('odd files');
after(() => repo.remove());

const draft = (files: string[]): ChangeFile => ({ format: 1, title: 'Odd files', reason: 'A trial.', parts: [{ id: 'all', name: 'All', files }], links: [] });
const page = examplePage(repo.folder, base, draft(['old/card.ts', 'gone.py', 'logo.png']), []);
const file = (path: string) => page.files.find((one) => one.path === path);

test('a picture, a binary file, an empty file, a link and a change of mode each say what they are in one line, and a changed picture comes before and after as data addresses with their sizes', () => {
  assert.deepEqual(
    ['logo.png', 'new.png', 'data.bin', 'empty.txt', 'link-to-app', 'run.sh'].map((path) => [file(path)?.what, !!file(path)?.picture]),
    [['Picture, 5 KB', true], ['Picture, 107 bytes', true], ['Binary file, 11 bytes', false], ['Empty file', false], ['Link to src/app.py', false], ['Only the mode changed: now executable', false]],
  );
  assert.equal(file('src/app.py')?.what, undefined); // a file with text has no such line
  assert.equal(file('new.png')?.added, 0); // no lines are counted in a picture
  assert.deepEqual([sizeText(1), sizeText(4200), sizeText(3 * 1024 * 1024)], ['1 byte', '4 KB', '3.0 MB']);

  // A changed picture comes before and after, as data addresses with their sizes.
  const changed = answer(page, 'picture:logo.png') as PictureAnswer;
  assert.match(changed.before!.src, /^data:image\/png;base64,/);
  assert.deepEqual([changed.before!.size, changed.after!.size], ['2 KB', '5 KB']);
  const added = answer(page, 'picture:new.png') as PictureAnswer;
  assert.equal(added.before, undefined);
  assert.equal(answer(page, 'picture:data.bin'), undefined);
});

test('a renamed file is one file under its new name, and a deleted file has its lines as removed rows where a note on removed lines finds its rows', () => {
  assert.deepEqual([file('new/library-card.ts')?.renamedFrom, file('new/library-card.ts')?.added], ['old/card.ts', 1]);
  assert.equal(file('old/card.ts'), undefined);
  assert.deepEqual(page.parts[0].files, ['new/library-card.ts', 'gone.py', 'logo.png']);
  assert.ok(!page.checks.filesInNoPart.includes('new/library-card.ts'));
  assert.equal(page.checks.renamedFiles?.[0].to, 'new/library-card.ts'); // the check still says that the part names the old path
  const both = examplePage(repo.folder, base, draft(['old/card.ts', 'new/library-card.ts']), []);
  assert.deepEqual(both.parts[0].files, ['new/library-card.ts']);
  const diff = answer(page, 'diff:new/library-card.ts') as DiffLine[];
  assert.deepEqual(diff.filter((line) => line.sign !== ' ').map((line) => `${line.sign}${line.text}`), ['+added line']);

  // A deleted file has its lines as removed rows on the Diffs page, and a note on removed lines finds its rows.
  const rows = CodeNotes.diffRows(answer(page, 'diff:gone.py'));
  assert.deepEqual(rows.map((row: { kind: string; line: number }) => `${row.kind}${row.line}`), ['del1', 'del2', 'del3', 'del4', 'del5']);
  assert.deepEqual(CodeNotes.spanOf(rows, { lines: [2, 4], removed: true }), [1, 3]);
  assert.equal(CodeNotes.spanOf(rows, { lines: [2, 4] }), null); // a note on the file now has no row in a deleted file
  // In a changed file the rows of a removed note are its removed rows, counted in the file as it was; a gap row stands where the lines jump.
  const lines: DiffLine[] = [
    { sign: ' ', line: 3, text: 'a' }, { sign: '-', line: 4, text: 'old' }, { sign: '-', line: 5, text: 'older' }, { sign: '+', line: 4, text: 'new' },
    { sign: ' ', line: 5, text: 'b' }, { sign: ' ', line: 20, text: 'far' },
  ];
  const changed = CodeNotes.diffRows(lines);
  assert.deepEqual(changed.map((row: { kind: string }) => row.kind || '='), ['=', 'del', 'del', 'add', '=', 'gap', '=']);
  assert.deepEqual(CodeNotes.spanOf(changed, { lines: [4, 5], removed: true }), [1, 2]);
  assert.deepEqual(CodeNotes.spanOf(changed, { lines: [4, 5] }), [3, 4]);
  assert.equal(changed[1].partner, 'new'); // a removed line is marked against the line that took its place
});

