// Tests of the parts of a long file for the notes writers, and of the size of the groups of the process writers: made-up files and maps.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Note } from './change-file';
import { partsOf, processGroups } from './note-groups';
import type { RepoMap } from './repo-map';

/** The text of lines, with a last newline as a file has. */
const textOf = (lines: string[]): string => `${lines.join('\n')}\n`;

/** A TypeScript function of `size` lines with a doc comment of three lines above it and a blank line after it. */
const tsFunction = (name: string, size: number): string[] =>
  ['/**', ` * ${name} does one step.`, ' */', `export function ${name}(): void {`, ...Array.from({ length: size - 2 }, () => '  step();'), '}', ''];

test('a long brace file is cut at the doc comment of the function nearest to 400 lines from the start of each part, and a part grows to the next safe cut', () => {
  // 20 functions of 50 lines, each with its doc comment: a block of 54 lines. The cut nearest to line 401 is at 379; the last cut (1027) would leave 54 lines.
  const lines = Array.from({ length: 20 }, (_, at) => tsFunction(`step${at}`, 50)).flat();
  const parts = partsOf('src/steps.ts', textOf(lines));
  assert.deepEqual(parts, [[1, 378], [379, 756], [757, 1080]]);
  for (const [from] of parts.slice(1)) assert.deepEqual([lines[from - 1], lines[from + 2].slice(0, 15)], ['/**', 'export function']); // the doc comment stays with its function

  // A first function of 700 lines: no safe cut within 150 lines of line 401, so the first part grows to the cut after it.
  const grown = [...tsFunction('big', 700), ...Array.from({ length: 8 }, (_, at) => tsFunction(`small${at}`, 40)).flat()];
  assert.deepEqual(partsOf('src/big.ts', textOf(grown)), [[1, 704], [705, 1056]]);
});

test('a Python class may span a cut only between two of its methods, a decorator stays with its method, and a function with a function inside is never cut', () => {
  // Each method has a decorator; the one of step10 is on three lines. Each method takes 41 lines.
  const decorator = (at: number): string[] => (at === 10 ? ['    @cached(', '        size=2,', '    )'] : ['    @cached']);
  const method = (at: number): string[] => [...decorator(at), `    def step${at}(self):`, ...Array.from({ length: 39 - decorator(at).length }, () => `        value = ${at}`), ''];
  const lines = [
    'import os', '', '', 'class Store:', '    """A store of rows."""', '', //                   1 to 6
    ...Array.from({ length: 15 }, (_, at) => method(at)).flat(), //                                 7 to 621: each method from its decorator at 7 + 41 × n
    'def outer():', ...Array.from({ length: 189 }, () => '    first = 1'), //                       622 to 811
    '    def inner():', ...Array.from({ length: 30 }, () => '        second = 2'), '    return inner', '', // 812 to 844
    'def last():', ...Array.from({ length: 170 }, () => '    third = 3'), //                       845 to 1015
  ];
  // The first cut falls between two methods of the class, on the first line of the decorator of step10; the second is not at inner (line 812, nearest to 817),
  // which outer spans, but at last.
  assert.deepEqual(partsOf('src/store.py', textOf(lines)), [[1, 416], [417, 844], [845, 1015]]);
  assert.equal(lines[416], '    @cached(');
});

test('a file that the finder knows nothing of stays whole, and a last part of fewer than 150 lines joins the part before', () => {
  const plain = Array.from({ length: 1000 }, (_, at) => `  value_${at} = ${at}`);
  assert.deepEqual(partsOf('lib/store.ex', textOf(['defmodule Store do', ...plain, 'end'])), [[1, 1002]]); // a language that the finder does not know
  assert.deepEqual(partsOf('lib/values.py', textOf(plain)), [[1, 1000]]); // no definition, so no safe cut
  // The one safe cut (before the second function, at line 475) would leave a last part of 140 lines: the file stays one part.
  assert.deepEqual(partsOf('src/two.ts', textOf([...tsFunction('first', 470), ...tsFunction('second', 136)])), [[1, 614]]);
  // A file of 600 lines is not cut at all.
  assert.deepEqual(partsOf('src/short.ts', textOf(Array.from({ length: 12 }, (_, at) => tsFunction(`short${at}`, 46)).flat())), [[1, 600]]);
});

test('process-groups splits an area of more than about 200 notes by folder, into groups of about 150 notes', () => {
  const notes = (file: string, count: number): Note[] => Array.from({ length: count }, (_, at) => ({ file, lines: [at + 1, at + 1], title: `Set value ${at}`, text: 'Sets one value.' }));
  const map = (fileNotes: Note[]): RepoMap => ({ format: 1, diagrams: [{ id: 'top', kind: 'flow', title: 'Top', mermaid: 'flowchart LR\n  code["Code"]', nodePaths: { code: ['src/'] } }], fileNotes });
  const groups = (fileNotes: Note[]) => processGroups(map(fileNotes)).groups.map((group) => [group.files.map((file) => file.path), group.notes]);
  // 210 notes: the two files of one folder stay together (140 notes), the file of the other folder is a group of its own.
  assert.deepEqual(groups([...notes('src/a/one.py', 80), ...notes('src/a/two.py', 60), ...notes('src/b/three.py', 70)]), [[['src/a/one.py', 'src/a/two.py'], 140], [['src/b/three.py'], 70]]);
  // 200 notes: one group for the area.
  assert.deepEqual(groups([...notes('src/a/one.py', 80), ...notes('src/a/two.py', 50), ...notes('src/b/three.py', 70)]), [[['src/a/one.py', 'src/a/two.py', 'src/b/three.py'], 200]]);
  // A folder too large for one group is cut in the order of its paths; the groups are listed largest first.
  assert.deepEqual(groups([...notes('src/a/one.py', 100), ...notes('src/a/two.py', 60), ...notes('src/a/three.py', 70)]), [[['src/a/three.py', 'src/a/two.py'], 130], [['src/a/one.py'], 100]]);
});
