// Tests for the folder of a run that describes a pull request: a worktree on its head branch that Apostil finds or makes, never a branch that it moves,
// and gone after the run. A clone with a bare remote beside it: only local Git, no network.

import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { baseOf, currentBranch, git, headCommit, tryGit } from '../shared/git';
import { makePullRepo, tempFolder } from '../shared/test-repo';
import { pullFolder, removePullFolder, worktreeWith } from './pull-folder';

test('a pull request whose branch is not checked out: its commits come, and a worktree on its branch in the store, compared with where it left main and with the skills of the repo; after the run it is gone, and the branch stays, free', async () => {
  const repo = makePullRepo();
  const store = tempFolder('apostil-home-');
  // The skills of Apostil for this repo only, kept out of Git as setup keeps them.
  repo.write('.claude/skills/apostil-describe-change/SKILL.md', '# Describe a change\n');
  appendFileSync(join(repo.folder, '.git', 'info', 'exclude'), '.claude/\n');
  try {
    const made = await pullFolder(repo.folder, { number: repo.number, branch: repo.branch, head: repo.head, base: repo.base, remote: 'origin' }, store);
    assert.ok('folder' in made, JSON.stringify(made));
    assert.deepEqual(made, { folder: join(store, 'worktrees', 'clone-pr-35'), made: true });
    assert.equal(currentBranch(made.folder), repo.branch);
    assert.equal(headCommit(made.folder), repo.head);
    assert.equal(baseOf(made.folder, repo.branch), repo.base); // apostil material sees the commits of the pull request, not an empty change
    assert.ok(existsSync(join(made.folder, '.claude/skills/apostil-describe-change/SKILL.md')));
    assert.equal(git(made.folder, 'status', '--porcelain'), ''); // the copy of the skills is no file of the change

    await removePullFolder(repo.folder, made.folder, store);
    assert.equal(existsSync(made.folder), false);
    assert.equal(git(repo.folder, 'rev-parse', `refs/heads/${repo.branch}`), repo.head); // the branch stays, as gh pr checkout leaves one
    assert.equal(worktreeWith(repo.folder, repo.branch), undefined); // and it is free to be checked out in his own folder
    assert.ok(existsSync(join(repo.folder, '.claude/skills/apostil-describe-change/SKILL.md')));
  } finally {
    repo.remove();
    rmSync(store, { recursive: true, force: true });
  }
});

test('a local branch of that name without the last commit of the pull request (a fork with a branch "main", or one that is behind): no folder, one sentence, and the branch is not moved; one that holds it is checked out as it is; a worktree of the person with the branch is the folder, and Apostil makes and removes nothing; with no commits to get, no folder and one sentence', async () => {
  const repo = makePullRepo();
  const store = tempFolder('apostil-home-');
  const pull = { number: repo.number, branch: repo.branch, head: repo.head, base: repo.base, remote: 'origin' };
  const other = tempFolder('apostil-mine-');
  try {
    git(repo.folder, 'branch', repo.branch, repo.base); // a branch of the person with that name, at main: not the branch of the pull request
    assert.deepEqual(await pullFolder(repo.folder, pull, store), { problem: `Could not check out the branch ${repo.branch} of pull request #${repo.number}: the branch ${repo.branch} of this clone does not hold the last commit of the pull request. It is another branch with that name, or it is behind.` });
    assert.equal(git(repo.folder, 'rev-parse', `refs/heads/${repo.branch}`), repo.base); // not moved to the head of the pull request
    assert.equal(existsSync(join(store, 'worktrees')), false);

    git(repo.folder, 'branch', '-f', repo.branch, repo.head); // the person brings the branch up to date
    const made = await pullFolder(repo.folder, pull, store);
    assert.ok('folder' in made && made.made, JSON.stringify(made));
    assert.equal(headCommit(made.folder), repo.head);
    await removePullFolder(repo.folder, made.folder, store);

    const mine = join(other, 'mine');
    git(repo.folder, 'worktree', 'add', '-q', mine, repo.branch);
    assert.deepEqual(await pullFolder(repo.folder, pull, store), { folder: mine, made: false });
    assert.deepEqual(readdirSync(join(store, 'worktrees')), []);
    await removePullFolder(repo.folder, mine, store);
    assert.ok(existsSync(mine)); // never a worktree that Apostil did not make

    const none = await pullFolder(repo.folder, { number: 36, branch: 'made-up/other', head: '1'.repeat(40), remote: 'origin' }, store);
    assert.deepEqual(none, { problem: "Could not check out the branch made-up/other of pull request #36: couldn't find remote ref pull/36/head." });
    assert.equal(tryGit(repo.folder, 'rev-parse', '--verify', '--quiet', 'refs/heads/made-up/other'), undefined);
  } finally {
    repo.remove();
    rmSync(store, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});
