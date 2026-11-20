// Tests for what the tree "Files" shows and marks, and for the start of a file tab.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rowOfFileInFront, TreeFocus, treeSteps } from './files-follow';
import { takeStart } from './page-data';

test('the tree "Files" follows the map: the paths of an area come into view with the first one marked and each folder open, at most six, and nothing while the tree is hidden unless the click shows it', () => {
  // The last path first, so that the first one ends in view and marked.
  assert.deepEqual(treeSteps(['src/', 'README.md'], true, false), [{ path: 'README.md', select: false, expand: false }, { path: 'src/', select: true, expand: true }]);
  assert.deepEqual(treeSteps(['generated/'], false, true), [{ path: 'generated/', select: true, expand: true }]); // an area with no diagram shows the tree
  assert.deepEqual(treeSteps(['src/'], false, false), []); // he went into an area while the tree was hidden
  assert.deepEqual(treeSteps([], true, true), []);
  const wide = treeSteps(['a/', 'b/', 'c/', 'd/', 'e/', 'f/', 'g/', 'h/'], true, false);
  assert.deepEqual(wide.map((step) => step.path), ['f/', 'e/', 'd/', 'c/', 'b/', 'a/']); // a wide area does not open the whole tree
  assert.deepEqual(wide.filter((step) => step.select).map((step) => step.path), ['a/']);
});

test('the tree "Files" marks the file of the tab in front when another file comes to the front, and keeps what is marked while a tab with no file is in front', () => {
  const row = rowOfFileInFront();
  const folder = '/repo';
  assert.equal(row('/repo/src/app.py', folder, true), 'src/app.py');
  assert.equal(row('/repo/src/app.py', folder, true), undefined); // the same file again: a folder that he marked by hand or from the map stays marked
  assert.equal(row(undefined, folder, true), undefined); // Home comes to the front: the file stays marked
  assert.equal(row('/repo/src/app.py', folder, true), 'src/app.py'); // and is marked again when its tab comes back
  assert.equal(row('/repo/README.md', folder, false), undefined); // the tree does not show
  assert.equal(row('/repo/README.md', folder, true, true), 'README.md'); // the tree shows again: the file in front is marked
  assert.equal(row('/elsewhere/notes.txt', folder, true), undefined); // a file outside the open folder
  assert.equal(row('/repo/src/app.py', '', true), undefined); // a window with no folder
});

test('the start of a file tab reaches its page with the first data that the page gets: a load of the data while the page is not ready does not use it up', () => {
  // Found on a busy Mac: the store changed while the page of a new file tab loaded, the load took the lines, and the tab opened at the top of the file.
  const view = { ready: false, lines: [208, 208] as [number, number], at: undefined };
  assert.deepEqual(takeStart(view), { lines: [208, 208], at: undefined }); // a load before the page is ready
  assert.deepEqual(view.lines, [208, 208]); // the view keeps its lines
  view.ready = true;
  assert.deepEqual(takeStart(view), { lines: [208, 208], at: undefined }); // the first data that the page gets
  assert.deepEqual(takeStart(view), { lines: undefined, at: undefined }); // a later load keeps where he is
  const atChange = { ready: true, at: 'first' as const };
  assert.deepEqual([takeStart(atChange), takeStart(atChange)], [{ lines: undefined, at: 'first' }, { lines: undefined, at: undefined }]);
});

test('TreeFocus: a focus opens the folders of its node and marks its first path; its end closes the folders that it opened and marks again the row marked before, unless he marked another row, opened another folder or went on from the node', () => {
  const tree = new TreeFocus();
  const opens = (paths: string[], before?: string): string[] => {
    const { steps } = tree.start(paths, true, before);
    for (const folder of ['src/', 'src/lending/']) tree.expanded(folder); // what VS Code opens to show them; src/ was open before, so only the rest come
    tree.selected(steps.find((step) => step.select)?.path);
    return steps.map((step) => step.path);
  };
  assert.deepEqual(opens(['src/lending/'], 'README.md'), ['src/lending/']);
  assert.deepEqual(tree.end(), { collapse: ['src/', 'src/lending/'], select: 'README.md' });
  assert.equal(tree.end(), undefined, 'one end only');

  opens(['src/lending/hold.py']);
  tree.selected('src/lending/other.py'); // he chose a file
  assert.equal(tree.end(), undefined);
  opens(['src/lending/hold.py']);
  tree.expanded('web/'); // he opened another folder
  assert.equal(tree.end(), undefined);
  opens(['src/lending/hold.py']);
  tree.keep(); // he went into the node
  assert.equal(tree.end(), undefined);

  // From one node to the next: the folders that both need stay open, and the row of the first focus is the one to come back to.
  opens(['src/lending/hold.py'], 'README.md');
  const next = tree.start(['src/desk/'], true, 'src/lending/hold.py');
  assert.deepEqual(next.end, { collapse: ['src/lending/'] });
  assert.deepEqual(tree.end(), { collapse: ['src/'], select: 'README.md' });
  assert.deepEqual(tree.start(['src/'], false), { steps: [] }, 'nothing while the tree is hidden');
});
