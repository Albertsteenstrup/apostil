// What comes with a pull request, from the raw JSON of GitHub: the checks in full, the deployments, the one sentence of what stands
// between it and a merge, the known products, and the tasks of the description. Pure functions; read-pull-request.ts uses them.

import type { Person, Reviewer, ReviewState } from './read-pull-request';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any;

export type CheckState = 'waiting' | 'running' | 'passed' | 'failed' | 'cancelled' | 'skipped' | 'neutral' | 'timed out' | 'needs action';

export interface Annotation {
  level: 'failure' | 'warning' | 'notice';
  title: string;
  message: string;
  path: string;
  line?: number;
}

export interface CheckItem {
  name: string;
  group: string; // the workflow and its product ("CI · GitHub Actions"), or "Other checks" for a status of another product
  state: CheckState;
  seconds?: number; // how long it took
  link?: string; // the log, or the page of the status
  runLink?: string; // the page of the workflow run, where GitHub offers "Re-run"
  description?: string; // the words of a status
  annotations: Annotation[];
  cutAnnotations: number;
  required: boolean;
}

export interface Deployment {
  environment: string;
  state: 'ready' | 'failed' | 'running' | 'waiting' | 'inactive';
  at: string;
  link?: string; // the deployment itself, when GitHub gives one
  description?: string;
}

const RUN_STATES: Record<string, CheckState> = {
  SUCCESS: 'passed', FAILURE: 'failed', STARTUP_FAILURE: 'failed', CANCELLED: 'cancelled', SKIPPED: 'skipped', NEUTRAL: 'neutral',
  TIMED_OUT: 'timed out', ACTION_REQUIRED: 'needs action', STALE: 'cancelled',
};
const STATUS_STATES: Record<string, CheckState> = { SUCCESS: 'passed', FAILURE: 'failed', ERROR: 'failed', PENDING: 'waiting', EXPECTED: 'waiting' };

/** The state of one check run or status. */
export function checkStateOf(node: Raw): CheckState {
  if (node.__typename === 'StatusContext') return STATUS_STATES[node.state] ?? 'waiting';
  if (node.status === 'IN_PROGRESS') return 'running';
  if (node.status !== 'COMPLETED') return 'waiting';
  return RUN_STATES[node.conclusion] ?? 'neutral';
}

const LEVELS: Record<string, Annotation['level']> = { FAILURE: 'failure', WARNING: 'warning', NOTICE: 'notice' };

/** Every check run and status, of a job that ran more than once only the newest run. */
export function checkList(nodes: Raw[] = []): CheckItem[] {
  const newest = new Map<string, Raw>();
  for (const node of nodes) {
    const status = node.__typename === 'StatusContext';
    const key = status ? `status/${node.context}` : `${node.checkSuite?.workflowRun?.workflow?.name ?? ''}/${node.name}`;
    const at = (one: Raw) => one.startedAt ?? one.createdAt ?? '';
    const earlier = newest.get(key);
    if (!earlier || at(node) >= at(earlier)) newest.set(key, node);
  }
  return [...newest.values()].map((node) => {
    if (node.__typename === 'StatusContext') {
      return { name: node.context ?? 'status', group: 'Other checks', state: checkStateOf(node), link: node.targetUrl ?? undefined, description: node.description ?? undefined, annotations: [], cutAnnotations: 0, required: !!node.isRequired };
    }
    const workflow = node.checkSuite?.workflowRun?.workflow?.name;
    const app = node.checkSuite?.app?.name;
    const started = Date.parse(node.startedAt ?? '');
    const done = Date.parse(node.completedAt ?? '');
    const annotations = node.annotations?.nodes ?? [];
    return {
      name: node.name ?? 'check',
      group: [workflow, app].filter(Boolean).join(' · ') || 'Other checks',
      state: checkStateOf(node),
      seconds: Number.isFinite(started) && Number.isFinite(done) && done >= started ? Math.round((done - started) / 1000) : undefined,
      link: node.detailsUrl ?? undefined,
      runLink: node.checkSuite?.workflowRun?.url ?? undefined,
      annotations: annotations.map((one: Raw) => ({
        level: LEVELS[one.annotationLevel] ?? 'notice', title: one.title ?? '', message: one.message ?? '', path: one.path ?? '', line: one.location?.start?.line ?? undefined,
      })),
      cutAnnotations: Math.max(0, (node.annotations?.totalCount ?? 0) - annotations.length),
      required: !!node.isRequired,
    };
  });
}

const DEPLOY_STATES: Record<string, Deployment['state']> = {
  SUCCESS: 'ready', ACTIVE: 'ready', FAILURE: 'failed', ERROR: 'failed', IN_PROGRESS: 'running', QUEUED: 'waiting', PENDING: 'waiting', WAITING: 'waiting', INACTIVE: 'inactive', DESTROYED: 'inactive',
};

/** One deployment, from its newest status. */
export function deploymentOf(node: Raw): Deployment {
  const status = node?.latestStatus;
  return {
    environment: node?.environment ?? 'an environment',
    state: DEPLOY_STATES[status?.state ?? node?.state] ?? 'waiting',
    at: status?.createdAt ?? node?.createdAt ?? '',
    link: status?.environmentUrl ?? undefined,
    description: status?.description ?? undefined,
  };
}

/** The newest deployment of each environment, in the order of the environments' first deployment. */
export function deploymentsOf(nodes: Raw[] = []): Deployment[] {
  const newest = new Map<string, Deployment>();
  for (const deployment of nodes.map(deploymentOf)) {
    const earlier = newest.get(deployment.environment);
    if (!earlier || deployment.at >= earlier.at) newest.set(deployment.environment, deployment);
  }
  return [...newest.values()];
}

// ----- what stands between the pull request and a merge -----

export interface MergeInput {
  state: string; // OPEN, MERGED or CLOSED
  draft: boolean;
  mergeable: string; // MERGEABLE, CONFLICTING or UNKNOWN
  mergeStateStatus?: string; // CLEAN, BLOCKED, BEHIND, DIRTY, UNSTABLE, HAS_HOOKS, UNKNOWN
  reviewDecision: string;
  checks: { passed: number; failed: number; pending: number };
  base: string;
  behindBy?: number;
  changesBy: string[]; // who asked for changes
  approvals: number;
  autoMerge?: { method: string };
  queue?: { position?: number };
  mergedBy?: string;
  mergedAt?: string;
  mergeParents?: number; // 2 for a merge commit, 1 for a squash
  stack?: { below?: number; open: number; allReady: boolean }; // in a stack: the open pull request below it, how many are open, and if each open one is ready to merge
}

/** What a part of the merge sentence is about, so that the status strip can leave out what it says before it. */
export type MergeTopic = 'draft' | 'conflicts' | 'checks failed' | 'checks running' | 'review' | 'behind' | 'rule' | 'stack' | 'auto merge' | 'ready' | 'unknown' | 'done';

export interface MergePart {
  text: string;
  about: MergeTopic;
}

export interface MergeFacts {
  known: boolean; // false while GitHub works it out: ask again after a moment
  ready: boolean;
  parts: MergePart[]; // what blocks, the hardest first; or the one thing that is true
  sentence: string;
}

const METHODS: Record<string, string> = { SQUASH: 'a squash', MERGE: 'a merge commit', REBASE: 'a rebase' };
/** A day in words, with its year when that is not this year: "3 November", "13 January 2016". */
const day = (iso?: string, now = new Date()): string => (iso
  ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC', ...(new Date(iso).getUTCFullYear() === now.getUTCFullYear() ? {} : { year: 'numeric' }) })
  : '');
const count = (n: number, one: string, many: string): string => `${n === 1 ? (one.startsWith('a') ? one : `1 ${one}`) : `${n} ${many}`}`;
const texts = (parts: MergePart[]): string => parts.map((part) => part.text).join(' · ');

/** One plain sentence: what stands between this pull request and a merge, from what GitHub says. */
export function mergeSentence(input: MergeInput): MergeFacts {
  const done = (sentence: string): MergeFacts => ({ known: true, ready: false, parts: [{ text: sentence, about: 'done' }], sentence });
  if (input.state === 'MERGED') {
    const how = input.mergeParents === 2 ? ' with a merge commit' : input.mergeParents === 1 ? ' with a squash' : '';
    return done(`Merged${input.mergedBy ? ` by ${input.mergedBy}` : ''}${input.mergedAt ? ` on ${day(input.mergedAt)}` : ''}${how}`);
  }
  if (input.state === 'CLOSED') return done('Closed, not merged');
  if (input.queue) return done(`In the merge queue${input.queue.position ? `, place ${input.queue.position}` : ''}`);
  const parts: MergePart[] = [];
  const add = (about: MergeTopic, text: string) => parts.push({ text, about });
  // GitHub merges a stack from the bottom: an open pull request below this one comes first.
  if (input.stack?.below) add('stack', `Waits for #${input.stack.below} below it in the stack`);
  if (input.draft) add('draft', 'A draft: not ready for review');
  if (input.mergeable === 'CONFLICTING' || input.mergeStateStatus === 'DIRTY') add('conflicts', `Conflicts with ${input.base}`);
  if (input.checks.failed) add('checks failed', input.checks.failed === 1 ? '1 check failed' : `${input.checks.failed} checks failed`);
  if (input.changesBy.length) add('review', `Changes asked for by ${input.changesBy.join(', ')}`);
  else if (input.reviewDecision === 'REVIEW_REQUIRED') add('review', 'An approving review is needed');
  if (input.checks.pending) add('checks running', input.checks.pending === 1 ? '1 check is still running' : `${input.checks.pending} checks are still running`);
  if (input.behindBy) add('behind', `${count(input.behindBy, 'commit', 'commits')} behind ${input.base}`);
  else if (input.mergeStateStatus === 'BEHIND') add('behind', `Behind ${input.base}`);
  if (!parts.length && input.mergeStateStatus === 'BLOCKED') add('rule', 'Blocked by a rule of the repo');
  const known = input.mergeable !== 'UNKNOWN' && input.mergeStateStatus !== 'UNKNOWN';
  const auto: MergePart[] = input.autoMerge ? [{ text: `Auto-merge is on: it merges with ${METHODS[input.autoMerge.method] ?? 'a merge'} when the checks pass`, about: 'auto merge' }] : [];
  if (!known && !parts.length) return { known: false, ready: false, parts: [{ text: 'GitHub is still working it out', about: 'unknown' }], sentence: 'GitHub is still working it out' };
  // Behind its base alone does not block, unless GitHub says so.
  const blocking = parts.filter((part) => part.about !== 'behind' || input.mergeStateStatus === 'BEHIND');
  if (!blocking.length) {
    const ready = input.reviewDecision === 'APPROVED' || input.approvals > 0 || (input.checks.passed > 0 && !input.reviewDecision);
    const stackReady = ready && input.stack?.allReady && input.stack.open > 1;
    const first = stackReady ? `The stack of ${input.stack!.open} is ready to merge` : ready ? 'Ready to merge' : 'Nothing blocks a merge, but no one has approved it';
    const all = [{ text: first, about: 'ready' as const }, ...parts, ...auto];
    return { known, ready, parts: all, sentence: texts(all) };
  }
  const all = [...parts, ...auto];
  // A pull request that waits for the one below it says so first, with no "Blocked:" before it.
  return { known, ready: false, parts: all, sentence: input.stack?.below ? texts(all) : `Blocked: ${texts(all)}` };
}

// ----- products and tasks -----

/** Known products: their plain name and an icon of view/media/icons. Every other bot keeps its login. */
export const PRODUCTS: Record<string, { name: string; icon: string }> = {
  'github-actions': { name: 'GitHub Actions', icon: 'workflow' },
  dependabot: { name: 'Dependabot', icon: 'dependabot' },
  'copilot-pull-request-reviewer': { name: 'Copilot', icon: 'copilot' },
  copilot: { name: 'Copilot', icon: 'copilot' },
  'copilot-swe-agent': { name: 'Copilot', icon: 'copilot' },
};

// ----- people: the page of a pull request and the list of the side bar read them the same way -----

const REVIEW_STATES: Record<string, ReviewState> = {
  APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', COMMENTED: 'reviewed', DISMISSED: 'dismissed', PENDING: 'not sent yet',
};

/** The state of a review in words; one that the code does not know is "reviewed". */
export const reviewState = (raw: string | undefined): ReviewState => REVIEW_STATES[raw ?? ''] ?? 'reviewed';

const GHOST: Person = { login: 'ghost', avatar: '', bot: false }; // GitHub's name for a deleted account

/** A person, a bot or a team. A known product gets its plain name and icon; a bot loses "[bot]" and keeps a quiet mark. */
export function person(raw: Raw): Person {
  if (raw?.__typename === 'Team' || raw?.__typename === 'EnterpriseTeam') return { login: raw.name ?? 'a team', avatar: '', bot: false, team: true };
  if (!raw?.login) return GHOST;
  const login = String(raw.login).replace(/\[bot\]$/, '');
  const bot = raw.__typename === 'Bot' || /\[bot\]$/.test(raw.login);
  const product = bot || login.startsWith('copilot') ? PRODUCTS[login.toLowerCase()] : undefined;
  return { login: product?.name ?? login, avatar: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : '', bot: bot || !!product, ...(product ? { icon: product.icon } : {}) };
}

/**
 * The reviewers of a pull request: each one who reviewed, with the state of the newest review, then each one who is asked and has not reviewed yet.
 * reviews: { author, state } in GitHub's form. asked: the people and teams asked for a review.
 */
export function reviewersOf(reviews: Raw[], asked: Raw[]): Reviewer[] {
  const reviewers: Reviewer[] = reviews.map((review) => ({ person: person(review?.author), state: reviewState(review?.state) }));
  for (const who of asked) {
    const one: Person = who ? person(who) : { login: 'someone', avatar: '', bot: false };
    if (!reviewers.some((reviewer) => reviewer.person.login === one.login)) reviewers.push({ person: one, state: 'asked' });
  }
  return reviewers;
}

/** How many tasks the description has, and how many are done. */
export function tasksOf(html: string): { done: number; total: number } {
  const boxes = html.match(/<input[^>]*type="checkbox"[^>]*>/gi) ?? [];
  return { total: boxes.length, done: boxes.filter((box) => /\schecked/i.test(box)).length };
}
