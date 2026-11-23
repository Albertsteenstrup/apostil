// The folder where a run describes a pull request of the repo: one with the head branch of the pull request checked out. Apostil checks the branch out,
// not the agent, whose rights hold no git worktree, fetch or checkout. It never resets or deletes a branch that was there before. It only fast-forwards one
// that is behind the pull request (all its commits are in the pull request, so none is lost), and it removes only a worktree that it made. No vscode import.

import { cpSync, existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { commitExists, fetchPullCommits, git, gitLater, repoRoot, tryGit } from '../shared/git';
import { SETUP_APPS } from '../store/setup';

/** A pull request of the repo, as the page read it. */
export interface PullHead {
  number: number;
  branch: string; // its head branch; empty while the pull request is not read yet
  head: string; // the last commit of that branch
  base?: string; // a commit of its base: the run compares the branch with where it left the base
  remote?: string; // the remote on GitHub, which has refs/pull/<n>/head
}

/** The real path of a folder, so that two names of one folder are equal (/tmp is /private/tmp on a Mac). A folder that is gone: its parent read so, then its name. */
export function realFolder(folder: string): string {
  try {
    return realpathSync(folder);
  } catch {
    try { return join(realpathSync(dirname(folder)), basename(folder)); } catch { return folder; }
  }
}

/** The worktrees of the repo of a folder (`git worktree list --porcelain`): the folder of each, and the branch checked out there. */
function worktrees(folder: string): { folder: string; branch?: string }[] {
  return (tryGit(folder, 'worktree', 'list', '--porcelain') ?? '').split('\n\n').map((block) => ({
    folder: /^worktree (.+)$/m.exec(block)?.[1] ?? '',
    branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1],
  })).filter((one) => one.folder);
}

/** The folder of the worktree of the repo that has a branch checked out, or undefined. */
export const worktreeWith = (folder: string, branch: string): string | undefined =>
  (branch ? worktrees(folder).find((one) => one.branch === branch)?.folder : undefined);

/**
 * True when the local branch of a pull request holds its last commit (that commit or a later one of the person). A branch of that name without it is
 * another branch (a pull request from a fork, often "main") or one that is behind: describing it would describe other code.
 */
export const holdsHead = (folder: string, branch: string, head: string): boolean =>
  !!head && commitExists(folder, head) && tryGit(folder, 'merge-base', '--is-ancestor', head, `refs/heads/${branch}`) !== undefined;

/** The folder of a worktree that has the head branch of a pull request checked out with its last commit, or undefined: a session there may describe it. */
export const worktreeWithHead = (folder: string, pull: PullHead): string | undefined => {
  const there = worktreeWith(folder, pull.branch);
  return there && holdsHead(folder, pull.branch, pull.head) ? there : undefined;
};

/** True when a worktree lies in Apostil's own folder of worktrees in its store: Apostil made it, also for an earlier run that it could not end (VS Code closed). */
function isOwn(worktree: string, store: string): boolean {
  const inside = relative(realFolder(join(store, 'worktrees')), realFolder(worktree));
  return !!inside && !inside.startsWith('..') && !isAbsolute(inside);
}

/** What git said, as the end of a sentence: no "fatal: " before it, a full stop after it. */
const reason = (said: string): string => said.replace(/^(fatal|error): /, '').replace(/\.?$/, '.');

/**
 * Finds or makes a folder with the head branch of a pull request checked out. Apostil first gets the commits of the pull request when the clone lacks them.
 * A local branch of that name counts when it holds the last commit (holdsHead); one that is only behind is brought up to it (fastForward); another one
 * (it has commits that are not in the pull request) starts no run, and the sentence says so. A worktree of the repo
 * that has the branch: the run works there, and Apostil makes nothing (one in its own folder it made before counts as made). Else Apostil adds a worktree
 * in its store (worktrees/<repo>-pr-<n>): with the local branch, as it is, or with a new branch at the last commit of the pull request.
 * Gives back one sentence when that fails; no run starts then.
 */
export async function pullFolder(folder: string, pull: PullHead, store: string): Promise<{ folder: string; made: boolean } | { problem: string }> {
  const fail = (said: string) => ({ problem: `Could not check out the branch ${pull.branch} of pull request #${pull.number}: ${reason(said)}` });
  if (!pull.branch) return { problem: `Pull request #${pull.number} is not read yet. Try again in a moment.` };
  if (pull.branch.startsWith('-')) return fail('a branch name that starts with "-" would be read as an option of git'); // the name comes from GitHub
  // The last commit first: a branch of that name counts only when it holds it.
  let head = pull.head;
  if (!(head && commitExists(folder, head))) {
    const said = pull.remote ? await fetchPullCommits(folder, pull.remote, pull.number) : 'this clone has no remote on GitHub';
    if (said) return fail(said);
    if (!head || !commitExists(folder, head)) head = tryGit(folder, 'rev-parse', 'FETCH_HEAD') ?? '';
  }
  const known = tryGit(folder, 'rev-parse', '--verify', '--quiet', `refs/heads/${pull.branch}`) !== undefined;
  if (known && !holdsHead(folder, pull.branch, head)) {
    const behind = fastForward(folder, pull.branch, head);
    if (behind) return fail(behind);
  }
  const there = worktrees(folder).find((one) => one.branch === pull.branch);
  if (there && existsSync(there.folder)) return { folder: there.folder, made: isOwn(there.folder, store) };
  if (there && !isOwn(there.folder, store)) return fail(`it is checked out in ${there.folder}, which is gone (git worktree prune lets it go)`);
  if (there) await gitLater(folder, ['worktree', 'remove', '--force', there.folder]); // its own worktree, whose folder is gone

  const said = known ? undefined : newBranch(folder, pull, head);
  if (said) return fail(said);
  const at = await freeFolder(folder, store, pull.number);
  const added = await gitLater(folder, ['worktree', 'add', at, pull.branch], 600_000); // a large repo takes a while to check out
  if (added) return fail(added);
  copySkills(repoRoot(folder), at);
  return { folder: at, made: true };
}

/**
 * Brings a local branch that is behind the pull request up to its last commit, and says why not when it cannot: undefined when it moved.
 * Only a branch whose tip is in the pull request moves, so no commit of the person is lost. Not checked out: `update-ref` with the old tip moves it only
 * if nobody moved it meanwhile. Checked out in a folder that is there: a fast-forward merge in that folder, only when it has nothing uncommitted.
 */
function fastForward(folder: string, branch: string, head: string): string | undefined {
  const ref = `refs/heads/${branch}`;
  const tip = tryGit(folder, 'rev-parse', ref) ?? '';
  if (!head || !commitExists(folder, head) || tryGit(folder, 'merge-base', '--is-ancestor', tip, head) === undefined) {
    return `the branch ${branch} of this clone has commits that are not in the pull request. It is another branch with that name, or it has work that is not pushed`;
  }
  const there = worktrees(folder).find((one) => one.branch === branch);
  try {
    if (there && existsSync(there.folder)) {
      if (git(there.folder, 'status', '--porcelain')) return `the branch ${branch} is behind the pull request, and ${there.folder} has uncommitted changes, so it was not brought up to date`;
      git(there.folder, 'merge', '--ff-only', head);
    } else git(folder, 'update-ref', '-m', 'apostil: bring the branch up to its pull request', ref, head, tip);
    return undefined;
  } catch (error) {
    return String((error as { stderr?: unknown }).stderr ?? error).trim().split('\n')[0];
  }
}

/**
 * Makes the head branch of a pull request at its last commit. Git notes where a branch was made, and Apostil reads that note as the base of the change
 * (baseOf in shared/git.ts): a branch made at its last commit would have no change to describe. So it is made where the pull request left its base, then
 * moved to its last commit; with no base in the clone it is made at its last commit with no such note, and its base is where it left the main branch.
 * `update-ref` with the old commit moves only the branch made a moment ago; with '' it makes the branch only when no branch has the name.
 */
function newBranch(folder: string, pull: PullHead, head: string): string | undefined {
  const left = pull.base && commitExists(folder, pull.base) ? tryGit(folder, 'merge-base', pull.base, head) : undefined;
  const ref = `refs/heads/${pull.branch}`;
  const note = `apostil: pull request #${pull.number}`;
  try {
    if (left) {
      git(folder, 'branch', '--no-track', pull.branch, left);
      git(folder, 'update-ref', '-m', note, ref, head, left);
    } else git(folder, 'update-ref', '-m', note, ref, head, '');
    return undefined;
  } catch (error) {
    return String((error as { stderr?: unknown }).stderr ?? error).trim().split('\n')[0];
  }
}

/**
 * The folder of a new worktree for a pull request in Apostil's store: worktrees/<repo>-pr-<n>. A worktree of this repo that Apostil left there before
 * (on another branch) is removed first; a folder there that is no worktree of this repo (of another repo with the same name) stays, and the name gets -2, -3.
 */
async function freeFolder(folder: string, store: string, number: number): Promise<string> {
  const listed = worktrees(folder).map((one) => realFolder(one.folder));
  for (let count = 1; ; count++) {
    const at = join(store, 'worktrees', `${basename(repoRoot(folder))}-pr-${number}${count > 1 ? `-${count}` : ''}`);
    if (listed.includes(realFolder(at))) await gitLater(folder, ['worktree', 'remove', '--force', at]);
    if (!existsSync(at)) return at;
  }
}

/**
 * The skills that `apostil setup` put into the repo for this repo only are no files of Git, so a new worktree lacks them, and its run would have no skill
 * that describes a change. The worktree gets a copy, only where Git ignores it there (as setup keeps them), so the copy is no file of the change.
 */
function copySkills(root: string, worktree: string): void {
  for (const { skills } of SETUP_APPS) {
    if (existsSync(join(root, skills)) && !existsSync(join(worktree, skills)) && tryGit(worktree, 'check-ignore', '-q', skills) !== undefined) {
      cpSync(join(root, skills), join(worktree, skills), { recursive: true, dereference: true });
    }
  }
}

/** Removes a worktree that Apostil made for a run, with what the run left in it, so that the branch can be checked out elsewhere again. The branch stays. Never a worktree that it did not make. */
export async function removePullFolder(folder: string, worktree: string, store: string): Promise<void> {
  if (isOwn(worktree, store)) await gitLater(folder, ['worktree', 'remove', '--force', worktree]);
}
