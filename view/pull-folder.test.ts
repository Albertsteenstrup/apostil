// Tests for the folder of a run that describes a pull request: a worktree on its head branch that Apostil finds or makes, never a branch that it moves,
// and gone after the run. A clone with a bare remote beside it: only local Git, no network.

import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { baseOf, currentBranch, git, headCommit, tryGit } from '../shared/git';
import { makePullRepo, tempFolder } from '../shared/test-repo';
import { pullFolder, removePullFolder, worktreeWith } from './pull-folder';

/** A commit of the person on top of `parent`, not on any branch yet. */
const ownCommit = (folder: string, parent: string): string =>
  git(folder, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit-tree', `${parent}^{tree}`, '-p', parent, '-m', 'mine');

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

test('a local branch of that name with commits that are not in the pull request (a fork with a branch "main", or work that is not pushed): no folder, one sentence, and the branch is not moved; one that holds it is checked out as it is; a worktree of the person with the branch is the folder, and Apostil makes and removes nothing; with no commits to get, no folder and one sentence', async () => {
  const repo = makePullRepo();
  const store = tempFolder('apostil-home-');
  const pull = { number: repo.number, branch: repo.branch, head: repo.head, base: repo.base, remote: 'origin' };
  const other = tempFolder('apostil-mine-');
  try {
    const mine = ownCommit(repo.folder, repo.base); // a branch of the person with that name, with a commit of his own: not the branch of the pull request
    git(repo.folder, 'branch', repo.branch, mine);
    assert.deepEqual(await pullFolder(repo.folder, pull, store), { problem: `Could not check out ${repo.branch} for #${repo.number}: your ${repo.branch} has commits that are not in the pull request, so it stays as it is.` });
    assert.equal(git(repo.folder, 'rev-parse', `refs/heads/${repo.branch}`), mine); // not moved to the head of the pull request
    assert.equal(existsSync(join(store, 'worktrees')), false);

    git(repo.folder, 'branch', '-f', repo.branch, repo.head); // the person brings the branch up to date
    const made = await pullFolder(repo.folder, pull, store);
    assert.ok('folder' in made && made.made, JSON.stringify(made));
    assert.equal(headCommit(made.folder), repo.head);
    await removePullFolder(repo.folder, made.folder, store);

    const mineFolder = join(other, 'mine');
    git(repo.folder, 'worktree', 'add', '-q', mineFolder, repo.branch);
    assert.deepEqual(await pullFolder(repo.folder, pull, store), { folder: mineFolder, made: false });
    assert.deepEqual(readdirSync(join(store, 'worktrees')), []);
    await removePullFolder(repo.folder, mineFolder, store);
    assert.ok(existsSync(mineFolder)); // never a worktree that Apostil did not make

    const none = await pullFolder(repo.folder, { number: 36, branch: 'made-up/other', head: '1'.repeat(40), remote: 'origin' }, store);
    assert.deepEqual(none, { problem: "Could not check out made-up/other for #36: couldn't find remote ref pull/36/head." });
    assert.equal(tryGit(repo.folder, 'rev-parse', '--verify', '--quiet', 'refs/heads/made-up/other'), undefined);
  } finally {
    repo.remove();
    rmSync(store, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test('a local branch that is only behind the pull request is brought up to its last commit: moved when it is checked out nowhere, fast-forwarded in the worktree that has it when that is clean, refused when that has uncommitted changes', async () => {
  const repo = makePullRepo();
  const store = tempFolder('apostil-home-');
  const other = tempFolder('apostil-mine-');
  const pull = { number: repo.number, branch: repo.branch, head: repo.head, base: repo.base, remote: 'origin' };
  const branchTip = () => git(repo.folder, 'rev-parse', `refs/heads/${repo.branch}`);
  try {
    git(repo.folder, 'branch', repo.branch, repo.base); // made earlier: the pull request moved on since
    const free = await pullFolder(repo.folder, pull, store);
    assert.ok('folder' in free && free.made, JSON.stringify(free));
    assert.equal(headCommit(free.folder), repo.head);
    await removePullFolder(repo.folder, free.folder, store);
    assert.equal(branchTip(), repo.head);

    git(repo.folder, 'branch', '-f', repo.branch, repo.base);
    const mine = join(other, 'mine');
    git(repo.folder, 'worktree', 'add', '-q', mine, repo.branch);
    appendFileSync(join(mine, 'src/app.py'), '# not saved\n');
    const dirty = await pullFolder(repo.folder, pull, store);
    assert.ok('problem' in dirty && /has uncommitted changes, so .* stays behind the pull request/.test(dirty.problem), JSON.stringify(dirty));
    assert.equal(branchTip(), repo.base);

    git(mine, 'checkout', '--', 'src/app.py');
    assert.deepEqual(await pullFolder(repo.folder, pull, store), { folder: mine, made: false });
    assert.equal(headCommit(mine), repo.head);
    assert.equal(git(mine, 'status', '--porcelain'), '');
  } finally {
    repo.remove();
    rmSync(store, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});
