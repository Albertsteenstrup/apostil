// Tests for notes on removed lines and for renamed files, on a small real repo.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { changeMaterial, forFreshCheck } from '../store/material';
import { saveDraft } from '../store/save';
import { shapeProblems, type ChangeFile } from './change-file';
import { checkChangeFile } from './checks';
import { aboutTarget } from './context';
import { changedFiles, git } from './git';
import { Store } from './store';
import { makeTestRepo, tempFolder } from './test-repo';

const numbered = (count: number, word = 'line'): string => Array.from({ length: count }, (_, at) => `${word} ${at + 1}\n`).join('');

// The base has three files. The change removes lines 4 to 6 of big.py, deletes gone.py and renames ren.py with one changed line.
const repo = makeTestRepo();
repo.write('src/big.py', numbered(10));
repo.write('src/gone.py', numbered(3, 'gone'));
repo.write('src/ren.py', numbered(8, 'ren'));
const base = repo.commit('prepare the base');
git(repo.folder, 'checkout', '-q', '-b', 'work'); // the branch starts here, so this commit is its base
repo.write('src/big.py', numbered(10).split('\n').filter((_, at) => at < 3 || at > 5).join('\n'));
git(repo.folder, 'rm', '-q', 'src/gone.py');
git(repo.folder, 'rm', '-q', 'src/ren.py');
repo.write('src/renamed.py', numbered(8, 'ren').replace('ren 3', 'changed 3'));
repo.write('src/fresh.py', 'new\n');
repo.commit('remove, delete and rename');
after(() => repo.remove());

const note = (file: string, lines: [number, number], extra: object = {}) => ({ file, lines, title: `Note on ${file}`, ...extra });
const draft = (notes: object[], files = ['src/big.py', 'src/gone.py', 'src/renamed.py', 'src/fresh.py']): ChangeFile => ({
  format: 1, title: 'Removes code', reason: 'A test.', links: [],
  parts: [{ id: 'all', name: 'All', files, notes: notes as ChangeFile['parts'][0]['notes'] }],
  generated: ['generated/'],
});
const bad = (notes: object[]) => checkChangeFile(repo.folder, base, draft(notes)).badNotes;

test('Git finds a rename: one file with its new path, its old path and only the lines that changed; two files that only look alike are not one; a part that names the old path gets a message with the new path', () => {
  const files = changedFiles(repo.folder, base);
  assert.deepEqual(files.find((file) => file.path === 'src/renamed.py'), { path: 'src/renamed.py', added: 1, removed: 1, status: 'changed', renamedFrom: 'src/ren.py' });
  assert.equal(files.some((file) => file.path === 'src/ren.py'), false);
  assert.equal(files.find((file) => file.path === 'src/gone.py')?.status, 'removed');

  // A part that names the old path of a renamed file gets a message with the new path; the new path passes.
  const passes = checkChangeFile(repo.folder, base, draft([]));
  assert.deepEqual([passes.filesInNoPart, passes.filesNotChanged, passes.renamedFiles], [[], [], undefined]);

  const old = checkChangeFile(repo.folder, base, draft([note('src/ren.py', [1, 1])], ['src/big.py', 'src/gone.py', 'src/ren.py', 'src/fresh.py']));
  assert.deepEqual(old.filesInNoPart, ['src/renamed.py']);
  assert.deepEqual(old.renamedFiles, [{ from: 'src/ren.py', to: 'src/renamed.py', problem: 'The file src/ren.py was renamed to src/renamed.py. Name src/renamed.py in the part.' }]);
  assert.match(old.badNotes[0].problem, /src\/ren.py was renamed to src\/renamed.py/);

  // Two files that only look alike are a removed file and a new file, not one renamed file.
  const alike = makeTestRepo();
  try {
    const lines = Array.from({ length: 40 }, (_, index) => `export const value${index} = ${index};`);
    alike.write('src/old-model.ts', lines.join('\n') + '\n');
    const start = alike.commit('add a model');
    git(alike.folder, 'rm', '-q', 'src/old-model.ts');
    // 26 of 40 lines are the same: Git's own rule (50%) would call this a rename.
    alike.write('src/new-model.ts', lines.map((line, index) => (index % 3 === 0 ? `export const other${index} = '${index}';` : line)).join('\n') + '\n');
    alike.commit('another model that looks like the old one');
    const alikeFiles = changedFiles(alike.folder, start);
    assert.deepEqual(alikeFiles.filter((file) => file.path.includes('model')).map((file) => [file.path, file.status, file.renamedFrom]).sort(), [['src/new-model.ts', 'added', undefined], ['src/old-model.ts', 'removed', undefined]]);
  } finally {
    alike.remove();
  }
});

test('a note on removed lines passes, also on a deleted and a renamed file, and is listed when the file is new, the lines pass the end, or an end is not a removed line; "removed" is true or false', () => {
  assert.deepEqual(bad([
    note('src/big.py', [4, 6], { removed: true }),
    note('src/big.py', [4, 4], { removed: true }),
    note('src/gone.py', [1, 3], { removed: true }),
    note('src/renamed.py', [3, 3], { removed: true }),
    note('src/renamed.py', [3, 3]),
  ]), []);

  // A note on removed lines is listed when the file is new, the lines pass the end, or an end is not a removed line.
  const problems = bad([
    note('src/fresh.py', [1, 1], { removed: true }),
    note('src/big.py', [8, 12], { removed: true }),
    note('src/big.py', [3, 5], { removed: true }),
    note('src/big.py', [4, 7], { removed: true }),
    note('src/missing.py', [1, 1], { removed: true }),
  ]).map((entry) => entry.problem);
  assert.match(problems[0], /src\/fresh.py did not exist before the change/);
  assert.match(problems[1], /Line 12 is after the end of src\/big.py as it was before the change, which had 10 lines/);
  assert.match(problems[2], /Line 3 of src\/big.py is not a line that the change removed.*removed these lines of src\/big.py near there: 4-6\./);
  assert.match(problems[3], /Line 7 of src\/big.py is not a line that the change removed/);
  assert.match(problems[4], /src\/missing.py did not exist before the change/);

  // A removed note on a line that stayed names the lines that went.
  assert.match(bad([note('src/big.py', [1, 1], { removed: true })])[0].problem, /Line 1 of src\/big.py is not a line that the change removed/);

  // The shape check wants "removed" to be true or false.
  const wrong = draft([note('src/big.py', [4, 6], { removed: 'yes' })]);
  assert.match(shapeProblems(wrong).join(' '), /"removed" must be true or false/);
  assert.deepEqual(shapeProblems(draft([note('src/big.py', [4, 6], { removed: true })])), []);
});

test('for-check prints the removed lines of a note, marked as removed, the context says they are removed lines, and the material says how to read the old text of a deleted file', () => {
  const store = new Store(tempFolder('apostil-home-'));
  const saved = saveDraft(store, repo.folder, draft([note('src/big.py', [4, 6], { removed: true, symbol: 'f' }), note('src/big.py', [1, 2], { symbol: 'f' })]));
  assert.deepEqual(saved.checks?.badNotes, []);
  const ranges = forFreshCheck(store, repo.folder)!.ranges;
  assert.deepEqual(ranges.map((range) => range.removed), [true, undefined]); // the same symbol, but two ranges
  assert.deepEqual(ranges[0].code, ['4: [removed] line 4', '5: [removed] line 5', '6: [removed] line 6']);
  assert.deepEqual(ranges[1].code, ['1: line 1', '2: line 2']);

  const lines = aboutTarget(store.getChange(saved.changeId!)!, { kind: 'note', file: 'src/big.py', lines: [4, 6], removed: true });
  assert.match(lines.join('\n'), /removed lines: the change removed them.*\n4: line 4/);
  store.close();

  // The material says how to read the old text of a deleted file.
  {
    const store = new Store(tempFolder('apostil-home-'));
    const material = changeMaterial(store, repo.folder);
    assert.match(material.oldText, /^git show [0-9a-f]+:<path>$/);
    const gone = material.files.find((file) => file.path === 'src/gone.py') as { oldText?: string };
    assert.equal(gone.oldText, `git show ${material.base}:src/gone.py`);
    assert.equal(git(repo.folder, 'show', `${material.base}:src/gone.py`).split('\n')[0], 'gone 1');
    store.close();
  }
});


