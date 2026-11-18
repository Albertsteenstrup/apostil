// The pull requests of a branch, read from GitHub with the gh program.

import { execFileSync } from 'node:child_process';
import { person, reviewersOf } from './pull-request-facts';
import type { Label, Person, Reviewer } from './read-pull-request';

export type PullRequestState =
  | 'draft' | 'checks failing' | 'conflicts' | 'changes requested' | 'review needed' | 'ready to merge' | 'merged' | 'closed';

/** One check of a pull request: a check run or a status context. */
export interface RawCheck {
  name?: string;
  workflowName?: string;
  startedAt?: string;
  status?: string; // a check run: COMPLETED or still running
  conclusion?: string; // a check run
  state?: string; // a status context
  context?: string; // a status context: its name
}

/** What GitHub gives for one pull request. */
export interface RawPullRequest {
  number: number;
  title: string;
  url: string;
  state: string; // OPEN, MERGED or CLOSED
  isDraft: boolean;
  reviewDecision: string; // APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED or empty
  mergeable: string; // MERGEABLE, CONFLICTING or UNKNOWN
  statusCheckRollup: RawCheck[];
  // Asked for the list of the side bar; missing when gh does not give them.
  author?: RawPerson;
  labels?: { name: string; color: string }[];
  reviewRequests?: RawPerson[];
  latestReviews?: { author?: RawPerson; state?: string }[];
  createdAt?: string;
  updatedAt?: string;
  headRefName?: string; // asked only for the list of every open pull request
  additions?: number; // also asked only for that list
  deletions?: number;
}

/** A person as the list of gh gives it: a bot is "app/<name>" with is_bot, a team has a name and no login, and no one has the address of a picture. */
export interface RawPerson {
  login?: string;
  name?: string;
  is_bot?: boolean;
  avatarUrl?: string; // gh gives none; a stand-in of a check can
  __typename?: string;
}

export interface CheckCounts {
  passed: number;
  failed: number;
  pending: number;
}

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  look: StateLook;
  checks: CheckCounts;
  stack?: StackPlace; // its place in a stack of pull requests, when it is in one
  author?: Person;
  reviewers?: Reviewer[];
  labels?: Label[];
  createdAt?: string; // ISO
  updatedAt?: string; // ISO
  branch?: string; // its head branch, asked only for the list of every open pull request
  added?: number; // its lines added and removed, asked only for the list of every open pull request (the badge of the Apostil icon)
  removed?: number;
}

/** The place of a pull request in a stack: position 1 is the closest to the base of the stack. */
export interface StackPlace {
  number: number; // the number of the stack
  size: number;
  position: number;
}

/** The icon of a state (a file in view/media/icons) and its colour (a variable in view/media/look.css). */
export interface StateLook {
  icon: 'git-pull-request-draft' | 'git-pull-request' | 'git-merge-conflict' | 'git-merge' | 'git-pull-request-closed';
  colour: 'grey' | 'green' | 'amber' | 'red' | 'purple';
}

// The icon and colour of each state, beside its word. Change them here.
export const STATE_LOOKS: Record<PullRequestState, StateLook> = {
  draft: { icon: 'git-pull-request-draft', colour: 'grey' },
  'review needed': { icon: 'git-pull-request', colour: 'green' },
  'changes requested': { icon: 'git-pull-request', colour: 'amber' },
  'checks failing': { icon: 'git-pull-request', colour: 'red' },
  conflicts: { icon: 'git-merge-conflict', colour: 'red' },
  'ready to merge': { icon: 'git-merge', colour: 'green' },
  merged: { icon: 'git-merge', colour: 'purple' },
  closed: { icon: 'git-pull-request-closed', colour: 'red' },
};

// The state of a pull request: the first rule that fits wins. Change the words here.
const STATES: [PullRequestState, (pr: RawPullRequest, checks: CheckCounts) => boolean][] = [
  ['merged', (pr) => pr.state === 'MERGED'],
  ['closed', (pr) => pr.state === 'CLOSED'],
  ['draft', (pr) => pr.isDraft],
  ['checks failing', (_pr, checks) => checks.failed > 0],
  ['conflicts', (pr) => pr.mergeable === 'CONFLICTING'],
  ['changes requested', (pr) => pr.reviewDecision === 'CHANGES_REQUESTED'],
  // Ready to merge: approved, or in a repo that asks for no review, at least one check ran and all passed; never while GitHub does not know about conflicts.
  ['ready to merge', (pr, checks) => pr.mergeable === 'MERGEABLE' && checks.pending === 0
    && (pr.reviewDecision === 'APPROVED' || (!pr.reviewDecision && checks.passed > 0))],
  ['review needed', () => true], // the owner's rule: the green pull request icon while it waits for approval
];

const PASSED = ['SUCCESS', 'NEUTRAL', 'SKIPPED'];

/** The newest run of each check, with its result: a check that ran more than once counts only once. */
function newestChecks(rollup: RawCheck[] = []): { check: RawCheck; result?: string }[] {
  const newest = new Map<string, RawCheck>();
  for (const check of rollup) {
    const key = `${check.workflowName ?? ''}/${check.name ?? check.context ?? ''}`; // a status of another product has a context, not a name
    const earlier = newest.get(key);
    if (!earlier || (check.startedAt ?? '') >= (earlier.startedAt ?? '')) newest.set(key, check);
  }
  return [...newest.values()].map((check) => ({ check, result: check.state ?? (check.status === 'COMPLETED' ? check.conclusion : undefined) }));
}

const isPending = (result?: string): boolean => result === undefined || ['PENDING', 'EXPECTED'].includes(result);

/** Counts the checks. Of a check that ran more than once, only the newest run counts. */
export function countChecks(rollup: RawCheck[] = []): CheckCounts {
  const counts = { passed: 0, failed: 0, pending: 0 };
  for (const { result } of newestChecks(rollup)) {
    if (isPending(result)) counts.pending++;
    else if (PASSED.includes(result!)) counts.passed++;
    else counts.failed++;
  }
  return counts;
}

/** The names of the failed checks, as "workflow / check" when the check has a workflow. */
export const failedCheckNames = (rollup: RawCheck[] = []): string[] => newestChecks(rollup)
  .filter(({ result }) => !isPending(result) && !PASSED.includes(result!))
  .map(({ check }) => [check.workflowName, check.name].filter(Boolean).join(' / '));

/** The one state of a pull request. */
export function stateOf(raw: RawPullRequest): PullRequestState {
  const checks = countChecks(raw.statusCheckRollup);
  return STATES.find(([, fits]) => fits(raw, checks))![0];
}

/** The picture of a GitHub account by its login, as GitHub serves it: the list of gh gives no address. */
export const avatarOf = (login: string): string => `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=40`;

/** A person of the list of gh in the form that person() reads: a person gets the address of a picture (gh gives none; a stand-in of a check can), a bot and a team get none. */
function fromList(raw?: RawPerson): RawPerson & { avatarUrl?: string } | undefined {
  if (!raw?.login) return raw; // a team, or nobody
  const bot = !!raw.is_bot || raw.__typename === 'Bot' || /^app\/|\[bot\]$/.test(raw.login);
  const login = raw.login.replace(/^app\//, '');
  return { ...raw, login, __typename: raw.__typename ?? (bot ? 'Bot' : 'User'), avatarUrl: bot ? '' : (raw.avatarUrl || avatarOf(login)) };
}

/** Turns the JSON of gh into pull requests, the newest first, with the author, the reviewers, the labels and the dates when gh gives them. */
export function pullRequestsFromJson(json: string): PullRequest[] {
  const raw = JSON.parse(json) as RawPullRequest[];
  return raw
    .map((pr) => {
      const state = stateOf(pr);
      return {
        number: pr.number, title: pr.title, url: pr.url, state, look: STATE_LOOKS[state], checks: countChecks(pr.statusCheckRollup),
        ...(pr.author ? { author: person(fromList(pr.author)) } : {}),
        reviewers: reviewersOf((pr.latestReviews ?? []).map((review) => ({ ...review, author: fromList(review.author) })), (pr.reviewRequests ?? []).map(fromList)),
        labels: (pr.labels ?? []).map(({ name, color }) => ({ name, color })),
        ...(pr.createdAt ? { createdAt: pr.createdAt } : {}),
        ...(pr.updatedAt ? { updatedAt: pr.updatedAt } : {}),
        ...(typeof pr.additions === 'number' ? { added: pr.additions, removed: pr.deletions ?? 0 } : {}),
        ...(pr.headRefName ? { branch: pr.headRefName } : {}),
      };
    })
    .sort((a, b) => b.number - a.number);
}

/** The arguments that ask gh for the pull requests of a branch, in one call. With a repo ("owner/name"), of that repo, else of the repo of the folder. */
const LIST_FIELDS = 'number,title,url,state,isDraft,reviewDecision,mergeable,statusCheckRollup,author,labels,reviewRequests,latestReviews,createdAt,updatedAt';
export const ghArguments = (branch: string, repo?: string): string[] =>
  ['pr', 'list', '--head', branch, '--state', 'all', '--json', LIST_FIELDS, ...(repo ? ['--repo', repo] : [])];

/** The arguments that ask gh for every open pull request of the repo of the folder (at most 100), with the branch of each. */
export const openPullsArguments = (): string[] => ['pr', 'list', '--state', 'open', '--limit', '100', '--json', `${LIST_FIELDS},headRefName,additions,deletions`];

/** The badge of the Apostil icon in the activity bar: how many pull requests are open, and their lines added and removed in its tip. None with none open. */
export function pullBadge(pulls: PullRequest[]): { value: number; tooltip: string } | undefined {
  if (!pulls.length) return undefined;
  const sum = (key: 'added' | 'removed') => pulls.reduce((total, pull) => total + (pull[key] ?? 0), 0).toLocaleString('en-US');
  const counted = pulls.some((pull) => pull.added !== undefined);
  return { value: pulls.length, tooltip: `${pulls.length} open pull request${pulls.length === 1 ? '' : 's'}${counted ? `, +${sum('added')} −${sum('removed')} in all` : ''}` };
}

/** The arguments that ask gh for the stacks of a repo (REST, read only); gh fills in "{owner}/{repo}" with the repo of the folder. */
export const stackArguments = (repo = '{owner}/{repo}'): string[] => ['api', `repos/${repo}/stacks?per_page=100`];

/** The place of each pull request in its stack, by number, from the REST list of stacks. Anything else gives no places. */
export function stackPlacesFromJson(json: string): Map<number, StackPlace> {
  const places = new Map<number, StackPlace>();
  let stacks: unknown;
  try { stacks = JSON.parse(json); } catch { return places; }
  if (!Array.isArray(stacks)) return places;
  for (const stack of stacks) {
    const pulls = Array.isArray(stack?.pull_requests) ? stack.pull_requests : [];
    pulls.forEach((pull: { number?: unknown }, index: number) => {
      if (typeof pull?.number === 'number' && typeof stack.number === 'number') places.set(pull.number, { number: stack.number, size: pulls.length, position: index + 1 });
    });
  }
  return places;
}

/** The pull requests with their places in a stack. */
export const withStacks = (pulls: PullRequest[], places: Map<number, StackPlace>): PullRequest[] =>
  pulls.map((pull) => (places.has(pull.number) ? { ...pull, stack: places.get(pull.number) } : pull));

/** The pull requests of a branch. Empty when gh is missing, not signed in, or the folder has no GitHub remote. */
export function pullRequestsOf(folder: string, branch: string): PullRequest[] {
  try {
    const json = execFileSync('gh', ghArguments(branch), { cwd: folder, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    return pullRequestsFromJson(json);
  } catch {
    return [];
  }
}
