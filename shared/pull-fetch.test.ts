// Apostil gets the commits of a pull request itself: a remote that holds refs/pull/<n>/head, and a clone that does not have those commits yet.
// Only local git: no network.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { commitExists, fetchPullCommits } from './git';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=Made Up', '-c', 'user.email=made@up.example', ...args], { cwd, encoding: 'utf8' }).trim();

test('the commits of a pull request that a clone does not have come by fetchPullCommits; a remote with no such pull request gives what git said', async () => {
  const root = mkdtempSync(join(tmpdir(), 'apostil-pull-fetch-'));
  try {
    const work = join(root, 'work');
    git(root, 'init', '-q', '-b', 'main', work);
    writeFileSync(join(work, 'a.txt'), 'one\n');
    git(work, 'add', '.');
    git(work, 'commit', '-q', '-m', 'one');
    git(root, 'clone', '-q', '--bare', work, 'remote.git');
    git(work, 'checkout', '-q', '-b', 'feature');
    writeFileSync(join(work, 'a.txt'), 'two\n');
    git(work, 'commit', '-q', '-am', 'two');
    const head = git(work, 'rev-parse', 'HEAD');
    git(work, 'push', '-q', join(root, 'remote.git'), 'HEAD:refs/pull/7/head');
    git(root, 'clone', '-q', '--no-local', join(root, 'remote.git'), 'clone'); // as over the network: only the branches come
    const clone = join(root, 'clone');
    assert.equal(commitExists(clone, head), false);
    assert.equal(await fetchPullCommits(clone, 'origin', 7), undefined);
    assert.equal(commitExists(clone, head), true);
    assert.equal(git(clone, 'branch', '--list').split('\n').length, 1); // no branch was made
    assert.match((await fetchPullCommits(clone, 'origin', 8)) ?? '', /pull\/8\/head/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the badge of the Apostil icon: the count of open pull requests, and their lines added and removed in its tip; none with none open', async () => {
  const { pullBadge, pullRequestsFromJson } = await import('./pull-requests');
  const pr = (number: number, additions?: number, deletions?: number) => ({ number, title: `Made-up ${number}`, url: `https://github.com/made-up/example/pull/${number}`, state: 'OPEN', isDraft: false, reviewDecision: '', mergeable: 'MERGEABLE', statusCheckRollup: [], ...(additions === undefined ? {} : { additions, deletions }) });
  assert.deepEqual(pullBadge(pullRequestsFromJson(JSON.stringify([pr(1, 1200, 30), pr(2, 5, 1)]))), { value: 2, tooltip: '2 open pull requests, +1,205 −31 in all' });
  assert.deepEqual(pullBadge(pullRequestsFromJson(JSON.stringify([pr(3)]))), { value: 1, tooltip: '1 open pull request' });
  assert.equal(pullBadge([]), undefined);
});
