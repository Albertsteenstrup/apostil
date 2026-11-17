// Tests for the open pull requests of a repo with no stored change, the words for each failure of gh, and the true counts of a change that is not checked out.

import assert from 'node:assert/strict';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { savedWords } from '../shared/change-rows';
import { checkChangeFile } from '../shared/checks';
import { git } from '../shared/git';
import { ghProblem, readRepoPulls } from '../shared/repo-pulls';
import { Store } from '../shared/store';
import { makeTestRepo, tempFolder, testChangeFile } from '../shared/test-repo';
import { graphsData } from './home-data';
import { listRows } from './list-rows';
import { pageData } from './page-data';

const repo = makeTestRepo();
after(() => repo.remove());

/** A stand-in `gh` on the path while `run` runs: it writes `out` and exits with `code`, with `error` on its error output. */
async function withGh<T>(script: string, run: () => Promise<T>): Promise<T> {
  const bin = tempFolder('apostil-gh-');
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\n${script}\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  const kept = process.env.PATH;
  process.env.PATH = `${bin}:${kept}`;
  try { return await run(); } finally { process.env.PATH = kept; }
}

test('every open pull request of the repo is read with its branch, and each failure of gh gives one plain sentence with the cause', async () => {
  const json = JSON.stringify([
    { number: 35, title: 'Remind readers', url: 'https://example.com/made-up/pull/35', state: 'OPEN', isDraft: false, reviewDecision: '', mergeable: 'MERGEABLE', statusCheckRollup: [], headRefName: 'made-up/reminders' },
    { number: 36, title: 'Shelf labels', url: 'https://example.com/made-up/pull/36', state: 'OPEN', isDraft: true, reviewDecision: '', mergeable: 'UNKNOWN', statusCheckRollup: [], headRefName: 'made-up/labels' },
  ]);
  const read = await withGh(`echo '${json}'`, () => readRepoPulls(repo.folder));
  assert.deepEqual(read.pulls.map((pull) => [pull.number, pull.branch, pull.state]), [[36, 'made-up/labels', 'draft'], [35, 'made-up/reminders', 'review needed']]);
  assert.equal(read.problem, undefined);

  const signedOut = await withGh('echo "To get started with GitHub CLI, please run:  gh auth login" >&2; exit 4', () => readRepoPulls(repo.folder));
  assert.deepEqual(signedOut, { pulls: [], problem: 'gh is not signed in: run gh auth login' });
  const noRemote = await withGh('echo "none of the git remotes configured for this repository point to a known GitHub host" >&2; exit 1', () => readRepoPulls(repo.folder));
  assert.equal(noRemote.problem, 'this folder has no remote on GitHub');
  const broken = await withGh('echo "something else went wrong" >&2; exit 1', () => readRepoPulls(repo.folder));
  assert.equal(broken.problem, 'gh failed: something else went wrong');
  const notJson = await withGh('echo "no list"', () => readRepoPulls(repo.folder));
  assert.match(notJson.problem!, /not a list of pull requests/);
  // No gh on the path: Node says ENOENT.
  assert.match(ghProblem({ code: 'ENOENT' }), /^gh is not installed/);
  assert.equal(ghProblem({ killed: true }), 'gh did not answer in time');
});

/** A change saved in a worktree of its own: one more commit on the branch "work", then the worktree is removed. The folder `repo` stays on "feature". */
function changeOfRemovedWorktree(store: Store): { id: number; head: string } {
  const folder = tempFolder('apostil-work-');
  git(repo.folder, 'worktree', 'add', '-q', '-b', 'work', join(folder, 'tree'), 'feature');
  const tree = join(folder, 'tree');
  writeFileSync(join(tree, 'work.txt'), 'one\ntwo\nthree\n');
  git(tree, 'add', '-A');
  git(tree, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'work');
  const head = git(tree, 'rev-parse', 'HEAD');
  const file = testChangeFile();
  const id = store.saveChange({ repoId: git(tree, 'rev-list', '--max-parents=0', 'HEAD'), folder: tree, branch: 'work', base: repo.base, head, file, checks: checkChangeFile(tree, repo.base, file) });
  git(repo.folder, 'worktree', 'remove', '--force', tree);
  return { id, head };
}

test('a change saved in a worktree that is removed keeps the counts of its commits while the folder is on another branch, on the row, the page and Home, and never counts the folder', () => {
  const store = new Store(tempFolder());
  const { id, head } = changeOfRemovedWorktree(store);
  repo.write('src/app.py', Array.from({ length: 40 }, (_, line) => `line_${line} = ${line}`).join('\n') + '\n'); // an edit that is not committed, in the folder that is open: it is no part of the change
  const sums = (range: string[]): number[] => git(repo.folder, 'diff', '--numstat', ...range).split('\n').filter(Boolean).reduce((all, line) => [all[0] + Number(line.split('\t')[0]), all[1] + Number(line.split('\t')[1]), all[2] + 1], [0, 0, 0]);
  const [added, removed, files] = sums([repo.base, head]);
  const row = listRows(store, repo.folder).find((one) => one.branch === 'work')!;
  assert.deepEqual({ commits: row.commits, files: row.files, added: row.added, removed: row.removed, uncounted: row.uncounted }, { commits: 2, files, added, removed, uncounted: undefined });

  const page = pageData(store, id, repo.folder)!;
  assert.equal(page.files.length, files);
  assert.equal(page.head, head);
  assert.equal(page.savedWords, `as saved at commit ${head.slice(0, 7)}; this folder is on feature`);
  const work = page.files.find((file) => file.path === 'work.txt')!;
  assert.deepEqual([work.added, work.removed, work.status], [3, 0, 'added']);
  const app = page.files.find((file) => file.path === 'src/app.py')!;
  const [appAdded, appRemoved] = git(repo.folder, 'diff', '--numstat', repo.base, head, '--', 'src/app.py').split('\t').map(Number);
  assert.deepEqual([app.added, app.removed], [appAdded, appRemoved]);

  // The graphs page counts the same way: the part "App" shows the counts of the commits, not of the 40 lines in the folder.
  const panel = graphsData(store, repo.folder, 'src/app.py').panels.find((one) => one.level === 'change')!;
  assert.match(panel.mermaid, new RegExp(`\\+${app.added}\\b`));
  assert.doesNotMatch(panel.mermaid, /\+4[0-9]\b/);
  git(repo.folder, 'checkout', '--', 'src/app.py');
  store.close();
});

test('a change whose commit this clone does not have says so in one quiet line and shows no counts', () => {
  const store = new Store(tempFolder());
  const file = testChangeFile();
  const lost = 'deadbeef'.repeat(5);
  const id = store.saveChange({ repoId: git(repo.folder, 'rev-list', '--max-parents=0', 'HEAD'), folder: tempFolder('apostil-gone-'), branch: 'other', base: repo.base, head: lost, file, checks: checkChangeFile(repo.folder, repo.base, file) });
  const row = listRows(store, repo.folder).find((one) => one.branch === 'other')!;
  assert.deepEqual({ commits: row.commits, files: row.files, added: row.added, removed: row.removed }, { commits: 0, files: 0, added: 0, removed: 0 });
  assert.equal(row.uncounted, 'commit deadbee is not in this clone, so there are no counts; this folder is on feature');
  const page = pageData(store, id, repo.folder)!;
  assert.deepEqual(page.files, []);
  assert.match(page.savedWords!, /^commit deadbee is not in this clone/);
  assert.equal(savedWords({ commit: lost, on: 'feature', missing: true }), row.uncounted);
  store.close();
});

test('a change that is checked out is counted in the folder as before, with no quiet line', () => {
  const store = new Store(tempFolder());
  const file = testChangeFile();
  const id = store.saveChange({ repoId: git(repo.folder, 'rev-list', '--max-parents=0', 'HEAD'), folder: repo.folder, branch: 'feature', base: repo.base, head: git(repo.folder, 'rev-parse', 'HEAD'), file, checks: checkChangeFile(repo.folder, repo.base, file) });
  const page = pageData(store, id, repo.folder)!;
  assert.equal(page.savedWords, undefined);
  assert.equal(page.head, undefined);
  assert.equal(listRows(store, repo.folder).find((one) => one.id === id)!.uncounted, undefined);
  store.close();
});
