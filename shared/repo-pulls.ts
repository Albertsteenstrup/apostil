// The open pull requests of a repo, and why the list may be empty: what went wrong with gh, in one plain sentence. No `vscode` import.

import { execFile } from 'node:child_process';
import { openPullsArguments, pullRequestsFromJson, type PullRequest } from './pull-requests';

/** What a failed run of gh gives: the error of Node (its `code`, whether it was killed for the time) and what gh wrote to its error output. */
export interface GhFailure {
  code?: string | number;
  killed?: boolean;
  stderr?: string;
}

/** The cause of a failed gh call in words for a person, with what to do when there is something to do. */
export function ghProblem({ code, killed, stderr = '' }: GhFailure): string {
  if (code === 'ENOENT') return 'gh is not installed: install the GitHub CLI, then run gh auth login';
  if (killed) return 'gh did not answer in time';
  if (/gh auth login|not logged in|authentication|HTTP 401|bad credentials/i.test(stderr)) return 'gh is not signed in: run gh auth login';
  if (/none of the git remotes|no git remotes|not a git repository/i.test(stderr)) return 'this folder has no remote on GitHub';
  const first = stderr.split('\n').find((line) => line.trim())?.trim().slice(0, 120);
  return first ? `gh failed: ${first}` : 'gh failed';
}

/** The open pull requests of the repo of a folder, or why there are none to show. */
export interface RepoPulls {
  pulls: PullRequest[];
  problem?: string;
}

/**
 * Asks gh for every open pull request of the repo of a folder. The call runs here, on the side of the extension: in a remote window or a codespace that is
 * the other computer, with its gh and its sign-in, because the folder is there.
 */
export function readRepoPulls(folder: string): Promise<RepoPulls> {
  return new Promise((done) => {
    execFile('gh', openPullsArguments(), { cwd: folder, encoding: 'utf8', timeout: 20_000, maxBuffer: 32 * 1024 * 1024 }, (error, out, stderr) => {
      if (error) return done({ pulls: [], problem: ghProblem({ code: (error as NodeJS.ErrnoException).code, killed: error.killed, stderr }) });
      try { done({ pulls: pullRequestsFromJson(out) }); } catch { done({ pulls: [], problem: 'gh gave an answer that is not a list of pull requests' }); }
    });
  });
}
