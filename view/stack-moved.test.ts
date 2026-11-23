// Tests for a change in a stack of branches (B on A) that is read after the stack moved: A got new commits and B was rebased onto them.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkChangeFile } from '../shared/checks';
import { git } from '../shared/git';
import { Store } from '../shared/store';
import { makeTestRepo, tempFolder, testChangeFile } from '../shared/test-repo';
import { listRows } from './list-rows';
import { pageData } from './page-data';

const withIdentity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false'];

test('a change of a branch in a stack, read after the branch below it moved and it was rebased: the counts are those of its own commits, and the page says how many commits are newer', () => {
  const repo = makeTestRepo(); // "main", and "feature" (the branch below) one commit above it
  const store = new Store(tempFolder());
  try {
    git(repo.folder, 'branch', 'upper', 'feature'); // the branch on top of "feature", as a stack has it
    git(repo.folder, 'checkout', '-q', 'upper');
    repo.write('upper.txt', 'one\ntwo\nthree\n');
    const described = repo.commit('upper');
    const below = git(repo.folder, 'rev-parse', 'feature');
    const file = testChangeFile();
    const id = store.saveChange({ repoId: git(repo.folder, 'rev-list', '--max-parents=0', 'HEAD'), folder: tempFolder('apostil-gone-'), branch: 'upper', base: below, head: described, file, checks: checkChangeFile(repo.folder, below, file) });

    // The branch below gets a new commit on a moved main (one that dropped README.md), and the upper branch is rebased onto it, with one more commit.
    git(repo.folder, 'checkout', '-q', 'main');
    git(repo.folder, 'rm', '-q', 'README.md');
    repo.commit('main moves');
    git(repo.folder, 'checkout', '-q', 'feature');
    git(repo.folder, ...withIdentity, 'rebase', '-q', 'main');
    repo.write('later.txt', 'later\n');
    repo.commit('later');
    git(repo.folder, 'checkout', '-q', 'upper');
    git(repo.folder, ...withIdentity, 'rebase', '-q', '--onto', 'feature', below, 'upper');
    repo.write('upper-more.txt', 'more\n');
    repo.commit('upper more');

    for (const open of ['upper', 'main']) { // the open folder is on the branch, or on another one
      git(repo.folder, 'checkout', '-q', open);
      const page = pageData(store, id, repo.folder)!;
      assert.equal(page.files.reduce((sum, one) => sum + one.removed, 0), 0, `${open}: removed lines`);
      assert.deepEqual(page.files.map((one) => one.path).sort(), open === 'upper' ? ['upper-more.txt', 'upper.txt'] : ['upper.txt'], open);
      assert.equal(page.baseBranch, 'feature');
      const row = listRows(store, repo.folder).find((one) => one.branch === 'upper')!;
      assert.equal(row.files, page.files.length, open);
      assert.equal(row.folder, repo.folder, `${open}: the pull requests of the row are asked for in the folder that Git is read in, as the page does, not in the folder that is gone`);
      assert.deepEqual(page.described && { commit: page.described.commit, newer: page.described.newer }, { commit: described, newer: 3 }, open);
    }
  } finally {
    store.close();
    repo.remove();
  }
});
