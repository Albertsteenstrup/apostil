// Reads one pull request from GitHub with "gh api graphql", for the view "Conversation". Read only: the writes are in write-pull-request.ts.
// Two halves: readPullRequest() asks gh, page by page, with a timeout; pullRequestFrom() turns the raw JSON into one plain object.

import { execFile } from 'node:child_process';
import { diffLines, type DiffLine } from './diff-lines';
import { cleanHtml } from './clean-html';
import { tryGit } from './git';
import { checkList, deploymentOf, deploymentsOf, mergeSentence, person, PRODUCTS, reviewersOf, reviewState, tasksOf, type CheckItem, type Deployment, type MergeFacts, type MergeInput } from './pull-request-facts';
import { countChecks, failedCheckNames, STATE_LOOKS, stateOf, type CheckCounts, type PullRequestState, type RawCheck, type StateLook } from './pull-requests';

/** How much is read at most. When a limit cuts a list off, the object says how much. Change the numbers here. */
export const LIMITS = { timeline: 1000, threads: 300, threadComments: 100, files: 3000, checks: 1000, annotations: 50, stack: 200 };

const PAGE = 100; // GitHub gives at most 100 nodes for one page
const SMALLER_PAGES = [PAGE, 50, 25, 10]; // when GitHub cannot answer a large request in time (HTTP 502 or 504), it is asked again with smaller pages
const TIMEOUT_MS = 30_000;

// ----- the plain object for the page -----

export interface Person {
  login: string; // for a known product its plain name ("GitHub Actions"); for an author with no account the name of the commit
  avatar: string; // '' when GitHub gives none
  bot: boolean;
  icon?: string; // the icon of a known product, a file of view/media/icons
  team?: boolean; // a team asked for a review
  noAccount?: boolean; // a commit author with no account on GitHub
}

export interface Reaction {
  emoji: string;
  count: number;
}

export interface PullComment {
  id: string;
  author: Person;
  at: string;
  edited: boolean;
  hidden?: string; // why GitHub hides it, as words ("off topic"); missing when it is not hidden
  html: string; // cleaned
  reactions: Reaction[];
  url: string;
  role?: string; // GitHub's mark of the author in this repo: "Owner", "Member", "Collaborator", "Contributor"
  mine?: boolean; // the owner wrote it: his own words are never new to him
  suggestions?: Suggestion[]; // the suggested changes of a comment on code ("```suggestion"), in their order
}

/** A suggested change of a comment on code: the lines that take the place of the lines of its thread, and who suggested it. */
export interface Suggestion {
  lines: string[]; // none: the lines go
  coAuthor: string; // the "Co-authored-by" line of its author, as GitHub writes it in the commit
  pending: boolean; // its review is not sent yet: GitHub applies no suggestion of such a review
}

export interface PullThread {
  id: string;
  path: string;
  lines?: [number, number];
  resolved: boolean;
  resolvedBy?: Person;
  outdated: boolean;
  comments: PullComment[];
  cutComments: number; // comments past the limit
  code: DiffLine[]; // the lines that the thread is about, from the diffHunk of its first comment
  review?: string; // the review of its first comment
  wholeFile: boolean; // a comment on the whole file, not on lines
  fileRemoved: boolean; // the pull request removes the file
  canReply: boolean; // what the owner may do with it; an answer stored by an older version has none, which means no
  canResolve: boolean;
  canUnresolve: boolean;
  side?: 'LEFT' | 'RIGHT'; // the side of the diff: LEFT is the file as it was, where GitHub applies no suggestion
}


export type ReviewState = 'approved' | 'changes requested' | 'reviewed' | 'dismissed' | 'not sent yet';

export type PullItem =
  | ({ kind: 'comment' } & PullComment)
  | ({ kind: 'review'; state: ReviewState; threads: PullThread[] } & PullComment)
  | { kind: 'thread'; at: string; thread: PullThread } // a thread whose review is not in the timeline
  // A later answer in a thread. GitHub makes a review for each answer and leaves it out of the timeline; the answer stays in its thread too.
  | { kind: 'reply'; at: string; thread: PullThread; comment: PullComment }
  | { kind: 'commit'; at: string; hash: string; subject: string; author: Person; verified: boolean; url?: string }
  | ({ kind: 'event'; at: string; actor?: Person } & EventLine);

/** One quiet line of the timeline: its words, its icon, and a link, a label or a deployment when it has one. */
export interface EventLine {
  text: string;
  icon: string;
  link?: { text: string; url: string };
  label?: Label;
  deployment?: Deployment;
}

export interface Label {
  name: string;
  color: string; // six hex digits, as GitHub gives it
}

export interface FileCount {
  path: string;
  added: number;
  removed: number;
  status: 'added' | 'changed' | 'removed';
}

export interface Reviewer {
  person: Person;
  state: ReviewState | 'asked';
}

/** One pull request of a stack, in short. */
export interface StackEntry {
  position: number; // 1 is the closest to the base of the stack
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  look: StateLook;
  draft: boolean;
}

/** The stack that a pull request is in: GitHub merges it from the bottom. */
export interface Stack {
  number: number;
  size: number;
  base: string; // the branch that the lowest pull request targets
  position: number; // the place of this pull request
  entries: StackEntry[]; // the top first, as GitHub draws it
  cut: number; // entries past the limit
}

export type MergeMethod = 'MERGE' | 'SQUASH' | 'REBASE';

/** What GitHub lets the owner do with the pull request. Each comes from a field that GitHub gives; nothing is guessed. */
export interface Rights {
  merge: boolean; // he may push to the base (viewerPermission ADMIN, MAINTAIN or WRITE)
  mergeAsAdmin: boolean; // viewerCanMergeAsAdmin: he may merge past the rules of the repo
  update: boolean; // viewerCanUpdate: "Ready for review" and "Convert to draft"
  close: boolean; // viewerCanClose
  reopen: boolean; // viewerCanReopen
  updateBranch: boolean; // viewerCanUpdateBranch
  deleteBranch: boolean; // viewerCanDeleteHeadRef, for a branch of this repo that GitHub does not delete itself after a merge
}

export interface PullRequestView {
  repo: string; // "owner/name"
  id: string; // the node id that a write names; '' in an answer stored by an older version
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  look: StateLook;
  open: boolean;
  draft: boolean;
  locked: boolean; // the conversation is locked
  mine: boolean; // the owner opened it: GitHub refuses his "Approve" and "Request changes"
  pending?: { id: string; comments: number }; // his review that is not sent yet
  viewer?: Person; // the owner, as gh is signed in: a write shows his words at once, with his name
  canApply: boolean; // he may commit a suggested change to the branch of the pull request
  headRepo: string; // "owner/name" of the branch of the pull request; a fork has its own
  queued: boolean; // in the merge queue, where GitHub applies no suggestion
  author: Person;
  openedAt: string;
  head: string;
  base: string;
  headOid: string;
  baseOid: string;
  commits: number;
  fileCount: number;
  added: number;
  removed: number;
  review: string; // APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED or ''
  reviewers: Reviewer[];
  checks: CheckCounts & { failedNames: string[]; list: CheckItem[] };
  deployments: Deployment[]; // the newest of each environment
  merge: MergeFacts;
  mergeable: string; // MERGEABLE, CONFLICTING or UNKNOWN
  mergeState: string; // GitHub's mergeStateStatus: CLEAN, UNSTABLE, HAS_HOOKS, BLOCKED, BEHIND, DIRTY or UNKNOWN; '' when it was not read
  behindBy?: number; // commits of the base that the branch lacks
  may: Rights;
  methods: MergeMethod[]; // the merge methods that the repo allows, in GitHub's order; no merge commit when the base must keep a straight history
  defaultMethod?: MergeMethod; // the method that GitHub keeps for him (viewerDefaultMergeMethod)
  commitTexts: Partial<Record<MergeMethod, { title: string; body: string }>>; // the commit title and message that GitHub fills for a merge commit and a squash
  needs: { approvals?: number; resolved: boolean }; // what the protection of the base asks for him: approving reviews, every thread resolved
  headRefId: string; // the node id of the branch, for "Delete branch"; '' when it is gone
  ended?: { by?: Person; at?: string; commit?: string }; // who merged or closed it, when, and the merge commit
  labels: Label[];
  assignees: Person[];
  milestone?: { title: string; due?: string; url: string };
  closes: { number: number; title: string; url: string; open: boolean }[];
  tasks: { done: number; total: number };
  private: boolean; // a picture of the repo needs the login of gh
  html: string; // the description, cleaned; '' when there is none
  items: PullItem[]; // in time order
  notShown: number; // events of a kind that the code does not know
  files: FileCount[];
  stack?: Stack; // missing when it is in no stack
  cut: { timeline: number; threads: number; threadComments: number; files: number; checks: number };
  readAt: string;
}

// ----- the query -----

export const WHO = 'login avatarUrl(size: 80) __typename';
const REACTIONS = 'reactionGroups { content reactors { totalCount } }';
export const SAID = `id url author { ${WHO} } authorAssociation createdAt lastEditedAt bodyHTML isMinimized minimizedReason viewerDidAuthor ${REACTIONS}`;
const DEPLOYMENT = 'environment state createdAt latestStatus { state environmentUrl description createdAt }';
const ASSIGNEE = `__typename ... on User { ${WHO} } ... on Bot { ${WHO} } ... on Mannequin { ${WHO} }`;
const SOURCE = '__typename ... on PullRequest { number title url } ... on Issue { number title url }';
const NAMED = `__typename ... on User { ${WHO} } ... on Bot { ${WHO} } ... on Mannequin { ${WHO} } ... on Team { name } ... on EnterpriseTeam { name }`;

const TIMELINE_NODES = `nodes {
  __typename
  ... on IssueComment { ${SAID} }
  ... on PullRequestReview { ${SAID} state submittedAt }
  ... on PullRequestCommit { commit { oid abbreviatedOid messageHeadline committedDate url signature { isValid } author { name email user { ${WHO} } } } }
  ... on HeadRefForcePushedEvent { createdAt actor { ${WHO} } beforeCommit { abbreviatedOid } afterCommit { abbreviatedOid } }
  ... on ReviewRequestedEvent { createdAt actor { ${WHO} } requestedReviewer { ${NAMED} } }
  ... on ReadyForReviewEvent { createdAt actor { ${WHO} } }
  ... on ConvertToDraftEvent { createdAt actor { ${WHO} } }
  ... on MergedEvent { createdAt actor { ${WHO} } commit { abbreviatedOid } mergeRefName }
  ... on ClosedEvent { createdAt actor { ${WHO} } }
  ... on ReopenedEvent { createdAt actor { ${WHO} } }
  ... on RenamedTitleEvent { createdAt actor { ${WHO} } previousTitle currentTitle }
  ... on LabeledEvent { createdAt actor { ${WHO} } label { name color } }
  ... on UnlabeledEvent { createdAt actor { ${WHO} } label { name color } }
  ... on MilestonedEvent { createdAt actor { ${WHO} } milestoneTitle }
  ... on DemilestonedEvent { createdAt actor { ${WHO} } milestoneTitle }
  ... on AssignedEvent { createdAt actor { ${WHO} } assignee { ${ASSIGNEE} } }
  ... on UnassignedEvent { createdAt actor { ${WHO} } assignee { ${ASSIGNEE} } }
  ... on BaseRefChangedEvent { createdAt actor { ${WHO} } previousRefName currentRefName }
  ... on DeployedEvent { createdAt actor { ${WHO} } deployment { ${DEPLOYMENT} } }
  ... on DeploymentEnvironmentChangedEvent { createdAt actor { ${WHO} } deploymentStatus { state environmentUrl createdAt deployment { environment } } }
  ... on CrossReferencedEvent { createdAt actor { ${WHO} } willCloseTarget source { ${SOURCE} } }
  ... on ConnectedEvent { createdAt actor { ${WHO} } subject { ${SOURCE} } }
  ... on ReferencedEvent { createdAt actor { ${WHO} } commit { abbreviatedOid url } }
  ... on ReviewRequestRemovedEvent { createdAt actor { ${WHO} } requestedReviewer { ${NAMED} } }
  ... on ReviewDismissedEvent { createdAt actor { ${WHO} } }
  ... on HeadRefDeletedEvent { createdAt actor { ${WHO} } }
  ... on HeadRefRestoredEvent { createdAt actor { ${WHO} } }
  ... on AutoMergeEnabledEvent { createdAt actor { ${WHO} } }
  ... on AutoMergeDisabledEvent { createdAt actor { ${WHO} } }
  ... on AddedToMergeQueueEvent { createdAt actor { ${WHO} } }
  ... on RemovedFromMergeQueueEvent { createdAt actor { ${WHO} } }
  ... on CommentDeletedEvent { createdAt actor { ${WHO} } }
  ... on ConvertedToDiscussionEvent { createdAt actor { ${WHO} } }
  ... on AddedToStackEvent { createdAt actor { ${WHO} } stackNumber }
  ... on RemovedFromStackEvent { createdAt actor { ${WHO} } stackNumber }
  ... on AutoSquashEnabledEvent { createdAt actor { ${WHO} } }
  ... on AutoRebaseEnabledEvent { createdAt actor { ${WHO} } }
  ... on LockedEvent { createdAt actor { ${WHO} } lockReason }
  ... on UnlockedEvent { createdAt actor { ${WHO} } }
  ... on BaseRefForcePushedEvent { createdAt actor { ${WHO} } }
  ... on BaseRefDeletedEvent { createdAt actor { ${WHO} } baseRefName }
  ... on AutomaticBaseChangeSucceededEvent { createdAt actor { ${WHO} } oldBase newBase }
  ... on AutomaticBaseChangeFailedEvent { createdAt actor { ${WHO} } oldBase newBase }
  ... on DisconnectedEvent { createdAt actor { ${WHO} } }
  ... on MarkedAsDuplicateEvent { createdAt actor { ${WHO} } }
}`;

const THREAD_NODES = `nodes {
  id isResolved isOutdated path line startLine originalLine originalStartLine subjectType diffSide resolvedBy { ${WHO} } viewerCanReply viewerCanResolve viewerCanUnresolve
  comments(first: ${LIMITS.threadComments}) { totalCount nodes { ${SAID} body author { ... on User { databaseId } ... on Bot { databaseId } } diffHunk pullRequestReview { id state } } }
}`;

const FILE_NODES = 'nodes { path additions deletions changeType }';

const CHECK_NODES = `nodes {
  __typename
  ... on CheckRun { name status conclusion startedAt completedAt detailsUrl
    annotations(first: ${LIMITS.annotations}) { totalCount nodes { annotationLevel title message path location { start { line } } } }
    checkSuite { app { name } workflowRun { url workflow { name } } } }
  ... on StatusContext { context state description targetUrl createdAt }
}`;

// A pull request of a stack: enough for its state word. Its checks come as the one state of their rollup.
const STACK_NODES = 'nodes { position pullRequest { number title url state isDraft reviewDecision mergeable commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } }';

const LISTS = { timelineItems: TIMELINE_NODES, reviewThreads: THREAD_NODES, files: FILE_NODES, checks: CHECK_NODES, stackEntries: STACK_NODES };
type ListName = keyof typeof LISTS;
const LIMIT_OF: Record<ListName, number> = { timelineItems: LIMITS.timeline, reviewThreads: LIMITS.threads, files: LIMITS.files, checks: LIMITS.checks, stackEntries: LIMITS.stack };

/**
 * One page of a list. The timeline is read from its end, so that a limit keeps the newest items.
 * The checks are the contexts of the newest commit.
 */
function page(list: ListName, size: number, cursor: boolean): string {
  if (list === 'timelineItems') return `timelineItems(last: ${size}${cursor ? ', before: $after' : ''}) { totalCount filteredCount pageInfo { hasPreviousPage startCursor } ${TIMELINE_NODES} }`;
  const body = `(first: ${size}${cursor ? ', after: $after' : ''}) { totalCount pageInfo { hasNextPage endCursor } ${LISTS[list]} }`;
  if (list === 'checks') return `last: commits(last: 1) { nodes { commit { statusCheckRollup { contexts${body} } } } }`;
  if (list === 'stackEntries') return `stack { entries${body} }`;
  return `${list}${body}`;
}

/** A list of the raw pull request, wherever it stands in the answer. */
export const listOf = (pr: Raw, list: ListName): RawList | undefined =>
  list === 'checks' ? pr?.last?.nodes?.[0]?.commit?.statusCheckRollup?.contexts : list === 'stackEntries' ? pr?.stack?.entries : pr?.[list];

/** The cursor of the next page of a list, or undefined at its end. The timeline goes backwards. */
const nextCursor = (list: ListName, raw: RawList): string | undefined => (list === 'timelineItems'
  ? (raw.pageInfo?.hasPreviousPage ? raw.pageInfo.startCursor ?? undefined : undefined)
  : (raw.pageInfo?.hasNextPage ? raw.pageInfo.endCursor ?? undefined : undefined));

const wrap = (body: string, after = false, top = ''): string =>
  `query($owner: String!, $name: String!, $number: Int!${after ? ', $after: String' : ''}) { ${top}repository(owner: $owner, name: $name) { pullRequest(number: $number) { ${body} } } }`;

/** The first query: everything about the pull request, and the first page of each list. */
export const firstQuery = (size = PAGE): string => wrap(`
  id number title url state isDraft locked viewerDidAuthor viewerCanApplySuggestion createdAt headRefName baseRefName headRefOid baseRefOid
  author { ${WHO} } commits { totalCount } changedFiles additions deletions reviewDecision mergeable mergeStateStatus bodyHTML
  repository { nameWithOwner isPrivate viewerPermission mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed viewerDefaultMergeMethod deleteBranchOnMerge }
  headRepository { nameWithOwner } isCrossRepository headRef { id }
  viewerCanMergeAsAdmin viewerCanUpdate viewerCanClose viewerCanReopen viewerCanUpdateBranch viewerCanDeleteHeadRef
  mergeTitle: viewerMergeHeadlineText(mergeType: MERGE) mergeBody: viewerMergeBodyText(mergeType: MERGE)
  squashTitle: viewerMergeHeadlineText(mergeType: SQUASH) squashBody: viewerMergeBodyText(mergeType: SQUASH)
  baseRef { refUpdateRule { requiredApprovingReviewCount requiresConversationResolution requiresLinearHistory } }
  mergedAt closedAt mergedBy { ${WHO} } mergeCommit { abbreviatedOid parents { totalCount } }
  autoMergeRequest { mergeMethod } mergeQueueEntry { position }
  labels(first: 50) { nodes { name color } }
  assignees(first: 20) { nodes { ${WHO} } }
  milestone { title dueOn url }
  stackEntry { position } stack { number size baseRefName entries(first: ${size}) { totalCount pageInfo { hasNextPage endCursor } ${STACK_NODES} } }
  closingIssuesReferences(first: 20) { nodes { number title url state } }
  latestReviews(first: 100) { nodes { author { ${WHO} } state } }
  pending: reviews(first: 1, states: [PENDING]) { nodes { id viewerDidAuthor comments { totalCount } } }
  reviewRequests(first: 100) { nodes { requestedReviewer { ${NAMED} } } }
  last: commits(last: 1) { nodes { commit { deployments(last: 20) { nodes { ${DEPLOYMENT} } }
    statusCheckRollup { contexts(first: ${size}) { totalCount pageInfo { hasNextPage endCursor } ${CHECK_NODES} } } } } }
  ${page('timelineItems', size, false)}
  ${page('reviewThreads', size, false)}
  ${page('files', size, false)}`, false, `viewer { ${WHO} } `);

/** The query for one more page of a list. */
export const nextQuery = (list: ListName, size = PAGE): string => wrap(page(list, size, true), true);

// ----- the raw JSON, as far as the code reads it -----

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any;

export interface RawList {
  totalCount: number;
  filteredCount?: number; // the timeline: its count without the reviews that GitHub leaves out
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null; hasPreviousPage?: boolean; startCursor?: string | null };
  nodes: Raw[];
}

/** What the gh half gives the pure half: the pull request of the first answer, and the later pages of each list in order. */
export interface RawPullRequest {
  pr: Raw;
  more?: Partial<Record<ListName, RawList[]>>;
  behindBy?: number; // how many commits of the base the branch lacks, from a second query
}

/** The query that counts how far the branch is behind its base. */
export const BEHIND_QUERY = 'query($owner: String!, $name: String!, $base: String!, $head: String!) { repository(owner: $owner, name: $name) { ref(qualifiedName: $base) { compare(headRef: $head) { behindBy } } } }';

// ----- the pure half -----

const REACTION_EMOJI: Record<string, string> = {
  THUMBS_UP: '👍', THUMBS_DOWN: '👎', LAUGH: '😄', HOORAY: '🎉', CONFUSED: '😕', HEART: '❤️', ROCKET: '🚀', EYES: '👀',
};

const ROLES: Record<string, string> = { OWNER: 'Owner', MEMBER: 'Member', COLLABORATOR: 'Collaborator', CONTRIBUTOR: 'Contributor' };

const words = (reason: string): string => reason.toLowerCase().replace(/_/g, ' ');

/**
 * The suggested changes in the markdown of a comment: the lines of each block "```suggestion", in their order. A fence of more backticks
 * (or of tildes) holds a block that has "```" in it; the block ends at a fence of the same sign that is at least as long.
 */
export function suggestionsOf(body: string): string[][] {
  const found: string[][] = [];
  let open: { fence: string; lines: string[] } | undefined;
  for (const line of body.split(/\r?\n/)) {
    if (!open) {
      const start = /^ {0,3}(`{3,}|~{3,})\s*suggestion\s*$/.exec(line);
      if (start) open = { fence: start[1], lines: [] };
    } else if (new RegExp(`^ {0,3}${open.fence[0] === '`' ? '`' : '~'}{${open.fence.length},}\\s*$`).test(line)) {
      found.push(open.lines);
      open = undefined;
    } else open.lines.push(line);
  }
  return found;
}

/** The "Co-authored-by" line that GitHub writes for the author of a suggestion it applies: the login and its address at GitHub that hides the mail. */
const coAuthorOf = (author: Raw): string => {
  const login = String(author?.login ?? 'ghost');
  return `Co-authored-by: ${login} <${author?.databaseId ? `${author.databaseId}+` : ''}${login}@users.noreply.github.com>`;
};

/** A comment, a review or a review comment as the page draws it. A review comment comes with its markdown (`body`), which holds its suggested changes. */
export function commentFrom(raw: Raw): PullComment {
  const suggestions = typeof raw.body === 'string' ? suggestionsOf(raw.body) : [];
  return {
    id: String(raw.id ?? ''),
    author: person(raw.author),
    at: raw.createdAt ?? '',
    edited: !!raw.lastEditedAt,
    hidden: raw.isMinimized ? words(raw.minimizedReason || 'hidden') : undefined,
    html: cleanHtml(raw.bodyHTML ?? ''),
    reactions: (raw.reactionGroups ?? [])
      .filter((group: Raw) => group.reactors?.totalCount > 0 && REACTION_EMOJI[group.content])
      .map((group: Raw) => ({ emoji: REACTION_EMOJI[group.content], count: group.reactors.totalCount })),
    url: raw.url ?? '',
    ...(ROLES[raw.authorAssociation] ? { role: ROLES[raw.authorAssociation] } : {}),
    ...(raw.viewerDidAuthor ? { mine: true } : {}),
    ...(suggestions.length ? { suggestions: suggestions.map((lines) => ({ lines, coAuthor: coAuthorOf(raw.author), pending: raw.pullRequestReview?.state === 'PENDING' })) } : {}),
  };
}

function thread(raw: Raw, removed: Set<string>): PullThread {
  const first = raw.comments?.nodes?.[0];
  const wholeFile = raw.subjectType === 'FILE';
  const line = wholeFile ? undefined : raw.line ?? raw.originalLine;
  const start = raw.startLine ?? raw.originalStartLine ?? line;
  return {
    id: String(raw.id),
    path: raw.path ?? '',
    lines: line ? [start, line] : undefined,
    resolved: !!raw.isResolved,
    resolvedBy: raw.resolvedBy ? person(raw.resolvedBy) : undefined,
    outdated: !!raw.isOutdated,
    comments: (raw.comments?.nodes ?? []).map(commentFrom),
    cutComments: Math.max(0, (raw.comments?.totalCount ?? 0) - (raw.comments?.nodes?.length ?? 0)),
    code: first?.diffHunk && !wholeFile ? diffLines(first.diffHunk) : [],
    review: first?.pullRequestReview?.id,
    wholeFile,
    fileRemoved: removed.has(raw.path),
    canReply: !!raw.viewerCanReply,
    canResolve: !!raw.viewerCanResolve,
    canUnresolve: !!raw.viewerCanUnresolve,
    ...(raw.diffSide === 'LEFT' || raw.diffSide === 'RIGHT' ? { side: raw.diffSide } : {}),
  };
}

const source = (raw: Raw): EventLine['link'] => (raw?.url ? { text: `#${raw.number} ${raw.title ?? ''}`.trim(), url: raw.url } : undefined);
const label = (raw: Raw): Label => ({ name: raw?.name ?? '', color: /^[0-9a-f]{6}$/i.test(raw?.color ?? '') ? raw.color : 'cccccc' });

/** The other events as one quiet line each, by kind. A kind that is not here is not shown, and it is counted. */
const EVENTS: Record<string, (raw: Raw) => EventLine> = {
  HeadRefForcePushedEvent: (raw) => ({ icon: 'git-branch', text: `force-pushed${raw.beforeCommit && raw.afterCommit ? ` from ${raw.beforeCommit.abbreviatedOid} to ${raw.afterCommit.abbreviatedOid}` : ''}` }),
  ReviewRequestedEvent: (raw) => ({ icon: 'eye', text: `asked ${raw.requestedReviewer ? person(raw.requestedReviewer).login : 'someone'} for a review` }),
  ReviewRequestRemovedEvent: (raw) => ({ icon: 'eye', text: `no longer asks ${person(raw.requestedReviewer).login} for a review` }),
  ReviewDismissedEvent: () => ({ icon: 'x', text: 'dismissed a review' }),
  ReadyForReviewEvent: () => ({ icon: 'eye', text: 'marked it ready for review' }),
  ConvertToDraftEvent: () => ({ icon: 'git-pull-request-draft', text: 'turned it back into a draft' }),
  MergedEvent: (raw) => ({ icon: 'git-merge', text: `merged ${raw.commit?.abbreviatedOid ?? ''} into ${raw.mergeRefName ?? 'the base'}`.replace('  ', ' ') }),
  ClosedEvent: () => ({ icon: 'git-pull-request-closed', text: 'closed it' }),
  ReopenedEvent: () => ({ icon: 'git-pull-request', text: 'opened it again' }),
  RenamedTitleEvent: (raw) => ({ icon: 'pencil', text: `changed the title from “${raw.previousTitle ?? ''}” to “${raw.currentTitle ?? ''}”` }),
  LabeledEvent: (raw) => ({ icon: 'tag', text: 'added the label', label: label(raw.label) }),
  UnlabeledEvent: (raw) => ({ icon: 'tag', text: 'took away the label', label: label(raw.label) }),
  MilestonedEvent: (raw) => ({ icon: 'milestone', text: `added it to the milestone ${raw.milestoneTitle ?? ''}`.trim() }),
  DemilestonedEvent: (raw) => ({ icon: 'milestone', text: `took it out of the milestone ${raw.milestoneTitle ?? ''}`.trim() }),
  AssignedEvent: (raw) => ({ icon: 'person', text: `assigned ${person(raw.assignee).login}` }),
  UnassignedEvent: (raw) => ({ icon: 'person', text: `unassigned ${person(raw.assignee).login}` }),
  BaseRefChangedEvent: (raw) => ({ icon: 'git-branch', text: `changed the base from ${raw.previousRefName ?? '?'} to ${raw.currentRefName ?? '?'}` }),
  DeployedEvent: (raw) => {
    const deployment = deploymentOf(raw.deployment);
    return { icon: 'rocket', text: `deployed to ${deployment.environment}`, deployment };
  },
  DeploymentEnvironmentChangedEvent: (raw) => {
    const deployment = deploymentOf({ environment: raw.deploymentStatus?.deployment?.environment, latestStatus: raw.deploymentStatus });
    return { icon: 'rocket', text: `deployed to ${deployment.environment}`, deployment };
  },
  CrossReferencedEvent: (raw) => ({ icon: 'cross-reference', text: raw.willCloseTarget ? 'will close it with' : 'mentioned it in', link: source(raw.source) }),
  ConnectedEvent: (raw) => ({ icon: 'cross-reference', text: 'linked', link: source(raw.subject) }),
  ReferencedEvent: (raw) => ({ icon: 'git-commit', text: 'mentioned it in a commit', link: raw.commit?.url ? { text: raw.commit.abbreviatedOid, url: raw.commit.url } : undefined }),
  HeadRefDeletedEvent: () => ({ icon: 'git-branch', text: 'deleted the branch' }),
  HeadRefRestoredEvent: () => ({ icon: 'git-branch', text: 'restored the branch' }),
  AutoMergeEnabledEvent: () => ({ icon: 'git-merge', text: 'turned on auto-merge' }),
  AutoMergeDisabledEvent: () => ({ icon: 'git-merge', text: 'turned off auto-merge' }),
  AddedToMergeQueueEvent: () => ({ icon: 'git-merge-queue', text: 'added it to the merge queue' }),
  RemovedFromMergeQueueEvent: () => ({ icon: 'git-merge-queue', text: 'took it out of the merge queue' }),
  CommentDeletedEvent: () => ({ icon: 'comment', text: 'deleted a comment' }),
  ConvertedToDiscussionEvent: () => ({ icon: 'comment', text: 'turned it into a discussion' }),
  AddedToStackEvent: (raw) => ({ icon: 'git-branch', text: `added it to stack ${raw.stackNumber ?? ''}`.trim() }),
  RemovedFromStackEvent: (raw) => ({ icon: 'git-branch', text: `took it out of stack ${raw.stackNumber ?? ''}`.trim() }),
  // Kinds that real projects use (found in a survey of 50 public pull requests).
  AutoSquashEnabledEvent: () => ({ icon: 'git-merge', text: 'turned on auto-merge with a squash' }),
  AutoRebaseEnabledEvent: () => ({ icon: 'git-merge', text: 'turned on auto-merge with a rebase' }),
  LockedEvent: (raw) => ({ icon: 'stop', text: `locked the conversation${raw.lockReason ? ` as ${String(raw.lockReason).toLowerCase().replace(/_/g, ' ')}` : ''}` }),
  UnlockedEvent: () => ({ icon: 'stop', text: 'unlocked the conversation' }),
  BaseRefForcePushedEvent: () => ({ icon: 'git-branch', text: 'force-pushed the base branch' }),
  BaseRefDeletedEvent: (raw) => ({ icon: 'git-branch', text: `deleted the base branch ${raw.baseRefName ?? ''}`.trim() }),
  AutomaticBaseChangeSucceededEvent: (raw) => ({ icon: 'git-branch', text: `moved the base from ${raw.oldBase ?? '?'} to ${raw.newBase ?? '?'} automatically` }),
  AutomaticBaseChangeFailedEvent: (raw) => ({ icon: 'git-branch', text: `could not move the base from ${raw.oldBase ?? '?'} to ${raw.newBase ?? '?'} automatically` }),
  DisconnectedEvent: () => ({ icon: 'cross-reference', text: 'unlinked an issue' }),
  MarkedAsDuplicateEvent: () => ({ icon: 'cross-reference', text: 'marked it as a duplicate' }),
};

// Kinds that GitHub itself does not show in the conversation: known, not shown, not counted.
// The events of a project board are quiet too: GitHub gives none of their fields, not even the time, without the right "read:project",
// which the token of gh mostly lacks. One such field in the query makes the whole read fail.
const QUIET_KINDS = new Set(['MentionedEvent', 'SubscribedEvent', 'UnsubscribedEvent', 'UserBlockedEvent', 'PinnedEvent', 'UnpinnedEvent',
  'AddedToProjectV2Event', 'RemovedFromProjectV2Event', 'ProjectV2ItemStatusChangedEvent']);

/** The author of a commit: the account when it has one, else the name in the commit. A bot made it when its name ends in [bot]. */
function commitAuthor(raw: Raw): Person {
  if (raw?.user) return person(raw.user);
  const name = String(raw?.name ?? 'someone');
  const bot = /\[bot\]$/.test(name) || /\[bot\]@/.test(raw?.email ?? '');
  const login = name.replace(/\[bot\]$/, '');
  const product = bot ? PRODUCTS[login.toLowerCase()] : undefined;
  return { login: product?.name ?? login, avatar: '', bot, noAccount: true, ...(product ? { icon: product.icon } : {}) };
}

/**
 * One list, joined from the first page and the later ones, up to its limit; with the count of what the limit cut off.
 * `backwards`: the later pages are older (the timeline), so the limit keeps the newest nodes.
 */
function joined(first: RawList | undefined, more: RawList[] = [], limit: number, backwards = false): { nodes: Raw[]; cut: number } {
  if (!first || !Array.isArray(first.nodes)) throw new Error('A list of the pull request is missing.');
  const pages = backwards ? [...more].reverse().concat(first) : [first, ...more];
  const all = pages.flatMap((list) => list.nodes ?? []);
  const nodes = backwards ? all.slice(-limit) : all.slice(0, limit);
  return { nodes, cut: Math.max(0, (first.filteredCount ?? first.totalCount ?? nodes.length) - nodes.length) };
}

const isOpen = (state: PullRequestState): boolean => state !== 'merged' && state !== 'closed';

/** The stack of a pull request, the top first, with the state of each entry; this pull request has the `state` that its full read gives. */
function stackOf(pr: Raw, more: RawList[] | undefined, state: PullRequestState): Stack | undefined {
  if (!pr.stack?.entries) return undefined;
  const { nodes, cut } = joined(pr.stack.entries, more, LIMITS.stack);
  const entries = nodes.filter((node) => typeof node?.pullRequest?.number === 'number').map((node): StackEntry => {
    const one = node.pullRequest;
    const rollup = one.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state;
    const own = one.number === pr.number ? state : stateOf({ ...one, isDraft: !!one.isDraft, reviewDecision: one.reviewDecision ?? '', mergeable: one.mergeable ?? '', statusCheckRollup: rollup ? [{ state: rollup }] : [] });
    return { position: Number(node.position) || 0, number: one.number, title: one.title ?? '', url: one.url ?? '', state: own, look: STATE_LOOKS[own], draft: !!one.isDraft };
  }).sort((a, b) => b.position - a.position);
  const position = pr.stackEntry?.position ?? entries.find((entry) => entry.number === pr.number)?.position ?? 0;
  return { number: pr.stack.number, size: pr.stack.size ?? entries.length, base: pr.stack.baseRefName ?? '', position, entries, cut };
}

/** What the merge sentence needs of a stack: the nearest open pull request below this one, how many are open, and if each open one is ready to merge. */
function stackFacts(stack?: Stack): MergeInput['stack'] {
  if (!stack) return undefined;
  const open = stack.entries.filter((entry) => isOpen(entry.state));
  return { below: open.find((entry) => entry.position < stack.position)?.number, open: open.length, allReady: open.every((entry) => entry.state === 'ready to merge') };
}

const METHOD_FIELDS: [MergeMethod, string][] = [['MERGE', 'mergeCommitAllowed'], ['SQUASH', 'squashMergeAllowed'], ['REBASE', 'rebaseMergeAllowed']];
const WRITERS = ['ADMIN', 'MAINTAIN', 'WRITE']; // the permissions that may push to the base

/** The merge methods that the repo allows; a base that must keep a straight history takes no merge commit. An answer stored by an older version allows none. */
const methodsOf = (pr: Raw): MergeMethod[] => METHOD_FIELDS
  .filter(([method, field]) => pr.repository?.[field] === true && !(method === 'MERGE' && pr.baseRef?.refUpdateRule?.requiresLinearHistory))
  .map(([method]) => method);

/** What GitHub lets him do, from its own fields. */
const rightsOf = (pr: Raw): Rights => ({
  merge: WRITERS.includes(pr.repository?.viewerPermission),
  mergeAsAdmin: !!pr.viewerCanMergeAsAdmin,
  update: !!pr.viewerCanUpdate,
  close: !!pr.viewerCanClose,
  reopen: !!pr.viewerCanReopen,
  updateBranch: !!pr.viewerCanUpdateBranch,
  deleteBranch: !!pr.viewerCanDeleteHeadRef && !pr.isCrossRepository && !pr.repository?.deleteBranchOnMerge,
});

/** The commit title and message that GitHub fills for him, for a merge commit and a squash; a rebase has none. */
function commitTextsOf(pr: Raw): PullRequestView['commitTexts'] {
  const texts: PullRequestView['commitTexts'] = {};
  if (typeof pr.mergeTitle === 'string' && pr.mergeTitle) texts.MERGE = { title: pr.mergeTitle, body: pr.mergeBody ?? '' };
  if (typeof pr.squashTitle === 'string' && pr.squashTitle) texts.SQUASH = { title: pr.squashTitle, body: pr.squashBody ?? '' };
  return texts;
}

/** Who merged or closed it, when, and the merge commit; the one who closed it is the actor of the last "closed" of the timeline. */
function endedOf(pr: Raw, items: PullItem[]): PullRequestView['ended'] {
  if (pr.state === 'MERGED') return { by: pr.mergedBy ? person(pr.mergedBy) : undefined, at: pr.mergedAt ?? undefined, commit: pr.mergeCommit?.abbreviatedOid ?? undefined };
  if (pr.state !== 'CLOSED') return undefined;
  const closed = [...items].reverse().find((item) => item.kind === 'event' && item.text === 'closed it');
  return { by: closed?.kind === 'event' ? closed.actor : undefined, at: pr.closedAt ?? closed?.at };
}

/** Turns what gh gave into the plain object of the page. Throws when the JSON is not what the code expects. */
export function pullRequestFrom(raw: RawPullRequest, readAt = new Date().toISOString()): PullRequestView {
  const pr = raw.pr;
  if (!pr || typeof pr.number !== 'number' || typeof pr.title !== 'string') throw new Error('The answer has no pull request.');
  const timeline = joined(pr.timelineItems, raw.more?.timelineItems, LIMITS.timeline, true);
  const threadList = joined(pr.reviewThreads, raw.more?.reviewThreads, LIMITS.threads);
  const fileList = joined(pr.files, raw.more?.files, LIMITS.files);
  const checkPages = joined(listOf(pr, 'checks') ?? { totalCount: 0, nodes: [] }, raw.more?.checks, LIMITS.checks);
  const contexts = { totalCount: checkPages.nodes.length + checkPages.cut, nodes: checkPages.nodes };
  const rollup: RawCheck[] = (contexts.nodes ?? []).map((node: Raw) => (node.__typename === 'StatusContext'
    ? { name: node.context, state: node.state, startedAt: node.createdAt }
    : { name: node.name, workflowName: node.checkSuite?.workflowRun?.workflow?.name, startedAt: node.startedAt, status: node.status, conclusion: node.conclusion }));

  const removed = new Set(fileList.nodes.filter((node) => node.changeType === 'DELETED').map((node) => node.path));
  const threads = threadList.nodes.map((node) => thread(node, removed));
  const reviewIds = new Set(timeline.nodes.filter((node) => node.__typename === 'PullRequestReview').map((node) => node.id));
  let notShown = 0;
  const items: PullItem[] = [];
  for (const node of timeline.nodes) {
    const kind = node?.__typename;
    if (kind === 'IssueComment') items.push({ kind: 'comment', ...commentFrom(node) });
    else if (kind === 'PullRequestReview') {
      items.push({
        kind: 'review', ...commentFrom(node), at: node.submittedAt ?? node.createdAt ?? '', state: reviewState(node.state),
        threads: threads.filter((one) => one.review === node.id),
      });
    } else if (kind === 'PullRequestCommit') {
      const commit = node.commit ?? {};
      items.push({
        kind: 'commit', at: commit.committedDate ?? '', hash: commit.abbreviatedOid ?? '', subject: commit.messageHeadline ?? '',
        author: commitAuthor(commit.author), verified: !!commit.signature?.isValid, url: commit.url ?? undefined,
      });
    } else if (EVENTS[kind]) items.push({ kind: 'event', at: node.createdAt ?? '', actor: node.actor ? person(node.actor) : undefined, ...EVENTS[kind](node) });
    else if (!QUIET_KINDS.has(kind)) notShown++;
  }
  // A thread whose review is not in the timeline (cut off, or not sent yet by someone else) stands at the time of its first comment.
  for (const one of threads) {
    if (!one.review || !reviewIds.has(one.review)) items.push({ kind: 'thread', at: one.comments[0]?.at ?? '', thread: one });
    const raw = threadList.nodes.find((node) => String(node.id) === one.id);
    one.comments.forEach((said, index) => {
      const review = raw?.comments?.nodes?.[index]?.pullRequestReview?.id;
      if (index > 0 && review !== one.review) items.push({ kind: 'reply', at: said.at, thread: one, comment: said });
    });
  }
  items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  // A merge closes the pull request too: GitHub gives both events for one act, so a "closed" right after a "merged" goes.
  const mergedAt = items.filter((item) => item.kind === 'event' && item.icon === 'git-merge' && item.text.startsWith('merged')).map((item) => Date.parse(item.at));
  const oneAct = (item: PullItem) => item.kind === 'event' && item.text === 'closed it' && mergedAt.some((at) => Math.abs(Date.parse(item.at) - at) < 10_000);
  items.splice(0, items.length, ...items.filter((item) => !oneAct(item)));

  const reviewers = reviewersOf(pr.latestReviews?.nodes ?? [], (pr.reviewRequests?.nodes ?? []).map((node: Raw) => node.requestedReviewer));

  const checks = countChecks(rollup);
  const list = checkList(contexts.nodes ?? []);
  const state = stateOf({ number: pr.number, title: pr.title, url: pr.url, state: pr.state, isDraft: !!pr.isDraft, reviewDecision: pr.reviewDecision ?? '', mergeable: pr.mergeable ?? '', statusCheckRollup: rollup });
  const stack = stackOf(pr, raw.more?.stackEntries, state);
  const merge = mergeSentence({
    state: pr.state, draft: !!pr.isDraft, mergeable: pr.mergeable ?? 'UNKNOWN', mergeStateStatus: pr.mergeStateStatus ?? undefined, reviewDecision: pr.reviewDecision ?? '',
    checks, base: pr.baseRefName ?? 'the base', behindBy: raw.behindBy,
    changesBy: reviewers.filter((one) => one.state === 'changes requested').map((one) => one.person.login),
    approvals: reviewers.filter((one) => one.state === 'approved').length,
    autoMerge: pr.autoMergeRequest ? { method: pr.autoMergeRequest.mergeMethod } : undefined,
    queue: pr.mergeQueueEntry ? { position: pr.mergeQueueEntry.position ?? undefined } : undefined,
    mergedBy: pr.mergedBy ? person(pr.mergedBy).login : undefined, mergedAt: pr.mergedAt ?? undefined, mergeParents: pr.mergeCommit?.parents?.totalCount,
    stack: stackFacts(stack),
  });
  const pending = (pr.pending?.nodes ?? []).find((node: Raw) => node?.viewerDidAuthor && node.id);
  const ended = endedOf(pr, items);
  return {
    repo: pr.repository?.nameWithOwner ?? '',
    id: pr.id ?? '',
    number: pr.number,
    title: pr.title,
    url: pr.url ?? '',
    state,
    look: STATE_LOOKS[state],
    open: pr.state === 'OPEN',
    draft: !!pr.isDraft,
    locked: !!pr.locked,
    mine: !!pr.viewerDidAuthor,
    ...(pending ? { pending: { id: String(pending.id), comments: pending.comments?.totalCount ?? 0 } } : {}),
    ...(pr.viewer?.login ? { viewer: person(pr.viewer) } : {}),
    canApply: !!pr.viewerCanApplySuggestion,
    headRepo: pr.headRepository?.nameWithOwner ?? pr.repository?.nameWithOwner ?? '',
    queued: !!pr.mergeQueueEntry,
    author: person(pr.author),
    openedAt: pr.createdAt ?? '',
    head: pr.headRefName ?? '',
    base: pr.baseRefName ?? '',
    headOid: pr.headRefOid ?? '',
    baseOid: pr.baseRefOid ?? '',
    commits: pr.commits?.totalCount ?? 0,
    fileCount: pr.changedFiles ?? fileList.nodes.length,
    added: pr.additions ?? 0,
    removed: pr.deletions ?? 0,
    review: pr.reviewDecision ?? '',
    reviewers,
    checks: { ...checks, failedNames: failedCheckNames(rollup), list },
    deployments: deploymentsOf(pr.last?.nodes?.[0]?.commit?.deployments?.nodes ?? []),
    merge,
    mergeable: pr.mergeable ?? 'UNKNOWN',
    mergeState: pr.mergeStateStatus ?? '',
    ...(raw.behindBy !== undefined ? { behindBy: raw.behindBy } : {}),
    may: rightsOf(pr),
    methods: methodsOf(pr),
    ...(METHOD_FIELDS.some(([method]) => method === pr.repository?.viewerDefaultMergeMethod) ? { defaultMethod: pr.repository.viewerDefaultMergeMethod } : {}),
    commitTexts: commitTextsOf(pr),
    needs: {
      ...(typeof pr.baseRef?.refUpdateRule?.requiredApprovingReviewCount === 'number' ? { approvals: pr.baseRef.refUpdateRule.requiredApprovingReviewCount } : {}),
      resolved: !!pr.baseRef?.refUpdateRule?.requiresConversationResolution,
    },
    headRefId: pr.headRef?.id ?? '',
    ...(ended ? { ended } : {}),
    labels: (pr.labels?.nodes ?? []).map(label),
    assignees: (pr.assignees?.nodes ?? []).map(person),
    milestone: pr.milestone ? { title: pr.milestone.title ?? '', due: pr.milestone.dueOn ?? undefined, url: pr.milestone.url ?? '' } : undefined,
    closes: (pr.closingIssuesReferences?.nodes ?? []).map((issue: Raw) => ({ number: issue.number, title: issue.title ?? '', url: issue.url ?? '', open: issue.state === 'OPEN' })),
    tasks: tasksOf(pr.bodyHTML ?? ''),
    private: !!pr.repository?.isPrivate,
    html: cleanHtml(pr.bodyHTML ?? ''),
    items,
    notShown,
    files: fileList.nodes.map((node) => ({
      path: node.path, added: node.additions ?? 0, removed: node.deletions ?? 0,
      status: node.changeType === 'ADDED' ? 'added' : node.changeType === 'DELETED' ? 'removed' : 'changed',
    })),
    ...(stack ? { stack } : {}),
    cut: {
      timeline: timeline.cut,
      threads: threadList.cut,
      threadComments: threads.reduce((sum, one) => sum + one.cutComments, 0),
      files: fileList.cut,
      checks: Math.max(0, (contexts.totalCount ?? 0) - (contexts.nodes?.length ?? 0)),
    },
    readAt,
  };
}

// ----- which pull request: a number in the folder's repo, or a link -----

export interface PullRef {
  owner: string;
  name: string;
  number: number;
}

/** Every remote of a folder on GitHub, with its "owner/name". */
export function githubRemotesOf(folder: string): { slug: string; remote: string }[] {
  const remotes = (tryGit(folder, 'remote', '-v') ?? '').split('\n').map((line) => line.split(/\s+/)).filter((parts) => parts.length >= 2);
  const slugOf = (url: string): string | undefined => /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url)?.slice(1, 3).join('/');
  return remotes.map(([remote, url]) => ({ remote, slug: slugOf(url) })).filter((one): one is { remote: string; slug: string } => !!one.slug);
}

/** "owner/name" of the GitHub remote of a folder: origin first, else the first remote on GitHub. */
export function githubRepoOf(folder: string): { slug: string; remote: string } | undefined {
  const found = githubRemotesOf(folder);
  return found.find((one) => one.remote === 'origin') ?? found[0];
}

/** Reads "12", "#12", "owner/name#12" or a link to a pull request on GitHub. A bare number needs the repo of the folder. */
export function parsePullRef(text: string, folderRepo?: string): PullRef | undefined {
  const trimmed = text.trim();
  const link = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/.exec(trimmed);
  if (link) return { owner: link[1], name: link[2], number: Number(link[3]) };
  const short = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(trimmed);
  if (short) return { owner: short[1], name: short[2], number: Number(short[3]) };
  const bare = /^#?(\d+)$/.exec(trimmed);
  if (bare && folderRepo) {
    const [owner, name] = folderRepo.split('/');
    return { owner, name, number: Number(bare[1]) };
  }
  return undefined;
}

export const pullLink = (ref: PullRef): string => `https://github.com/${ref.owner}/${ref.name}/pull/${ref.number}`;

// ----- the gh half -----

export interface GhResult {
  out: string;
  err: string;
  missing?: boolean; // gh is not installed
  timedOut?: boolean;
}

/** Runs gh with arguments, and `input` on its standard input when given. Tests give a stand-in. */
export type RunGh = (args: string[], input?: string) => Promise<GhResult>;

export const runGh: RunGh = (args, input) => new Promise((done) => {
  const child = execFile('gh', args, { encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }, (error, out, err) => {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    done({ out: out ?? '', err: err ?? '', missing: code === 'ENOENT', timedOut: !!error && (error as { killed?: boolean }).killed === true });
  });
  child.stdin?.on('error', () => {}); // gh that is missing or ended early: the callback says why
  if (input !== undefined) child.stdin?.end(input);
});

export type PullProblem = 'no-gh' | 'not-signed-in' | 'no-network' | 'no-such-pull' | 'no-github-remote' | 'rate-limit' | 'too-large' | 'bad-answer';

export interface PullFailure {
  problem: PullProblem;
  text: string; // one plain line for the page
}

export type PullResult = { pull: PullRequestView } | PullFailure;

class Failed extends Error {
  constructor(readonly failure: PullFailure) { super(failure.text); }
}

const fail = (problem: PullProblem, text: string): never => { throw new Failed({ problem, text }); };

/** The time as "14:05" today, else with the date. */
const clock = (date: Date): string => date.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', ...(date.toDateString() === new Date().toDateString() ? {} : { day: 'numeric', month: 'short' }) });

/** What a failed gh call means, in one plain line. */
async function failureOf(result: GhResult, run: RunGh): Promise<never> {
  const text = `${result.err}\n${result.out}`;
  if (result.missing) fail('no-gh', 'The gh program is not installed. Install it from cli.github.com, then run "gh auth login".');
  if (result.timedOut) fail('no-network', 'GitHub did not answer in 30 seconds. Check the network.');
  if (/HTTP 50[24]|Bad Gateway|Gateway Time-?out/i.test(text)) fail('too-large', 'GitHub could not answer this large request. Try again.');
  if (/rate limit/i.test(text)) {
    const limits = await run(['api', 'rate_limit']);
    let reset = '';
    try { reset = clock(new Date(JSON.parse(limits.out).resources.graphql.reset * 1000)); } catch { /* the time stays unknown */ }
    fail('rate-limit', `GitHub's rate limit is used up${reset ? `. It ends at ${reset}` : ''}.`);
  }
  if (/gh auth login|not logged in|authentication|HTTP 401|Bad credentials/i.test(text)) fail('not-signed-in', 'The gh program is not signed in. Run "gh auth login" in a terminal.');
  if (/Could not resolve to a (PullRequest|Repository|Issue)|HTTP 404|Not Found/i.test(text)) fail('no-such-pull', 'GitHub has no such pull request, or this account cannot see it.');
  if (/dial tcp|could not resolve host|no such host|network is unreachable|connection refused|connection reset|error connecting|timeout|TLS handshake|offline/i.test(text)) {
    fail('no-network', 'GitHub cannot be reached. Check the network.');
  }
  return fail('bad-answer', `GitHub's answer is not what Apostil expects: ${(result.err || result.out).trim().split('\n')[0].slice(0, 160)}`);
}

/** One GraphQL query through gh; the data, or a failure. */
async function query(run: RunGh, text: string, ref: PullRef, after?: string): Promise<Raw> {
  const args = ['api', 'graphql', '-f', `query=${text}`, '-F', `owner=${ref.owner}`, '-F', `name=${ref.name}`, '-F', `number=${ref.number}`];
  if (after) args.push('-f', `after=${after}`);
  const result = await run(args);
  let json: Raw;
  try { json = JSON.parse(result.out); } catch { return failureOf(result, run); }
  if (json?.errors?.length) return failureOf({ ...result, err: json.errors.map((error: Raw) => error.message).join('\n') }, run);
  const pr = json?.data?.repository?.pullRequest;
  if (!pr) return failureOf(result.err ? result : { ...result, err: 'Could not resolve to a PullRequest' }, run);
  if (json.data.viewer) pr.viewer = json.data.viewer; // the first query asks who gh is signed in as
  return pr;
}

/** The later pages of one list, up to its limit. `onPage` hears of each page. */
async function laterPages(run: RunGh, ref: PullRef, list: ListName, first: RawList | undefined, size: number, onPage: (pages: RawList[]) => void = () => {}): Promise<RawList[]> {
  const pages: RawList[] = [];
  if (!first) return pages;
  let last = first;
  let count = first.nodes.length;
  let cursor = nextCursor(list, last);
  while (cursor && count < LIMIT_OF[list]) {
    const found = listOf(await query(run, nextQuery(list, size), ref, cursor), list);
    if (!found || !Array.isArray(found.nodes)) fail('bad-answer', 'GitHub\'s answer is not what Apostil expects: a page of a list is missing.');
    last = found!;
    pages.push(last);
    count += last.nodes.length;
    cursor = nextCursor(list, last);
    onPage(pages);
  }
  return pages;
}

/** How many commits of its base an open branch of the same repo lacks; undefined when that cannot be read. */
async function behind(run: RunGh, ref: PullRef, pr: Raw): Promise<number | undefined> {
  if (pr?.state !== 'OPEN' || !pr.headRefName || pr.headRepository?.nameWithOwner !== pr.repository?.nameWithOwner) return undefined;
  const result = await run(['api', 'graphql', '-f', `query=${BEHIND_QUERY}`, '-F', `owner=${ref.owner}`, '-F', `name=${ref.name}`, '-f', `base=refs/heads/${pr.baseRefName}`, '-f', `head=${pr.headRefName}`]);
  try { return JSON.parse(result.out).data.repository.ref.compare.behindBy ?? undefined; } catch { return undefined; }
}

/**
 * What the reading has so far: the pull request with the pages read up to now, and how many timeline items are read of how many.
 * The page shows the head at once and fills in the rest.
 */
export type OnProgress = (raw: RawPullRequest, read: number, total: number) => void;

/** The whole read with one page size. */
async function readAll(run: RunGh, ref: PullRef, size: number, onProgress?: OnProgress): Promise<RawPullRequest> {
  const pr = await query(run, firstQuery(size), ref);
  const lists = Object.keys(LISTS) as ListName[];
  const total = pr.timelineItems?.filteredCount ?? pr.timelineItems?.totalCount ?? 0;
  const tell = (pages: RawList[]) => onProgress?.({ pr, more: { timelineItems: pages } }, Math.min(total, (pr.timelineItems?.nodes?.length ?? 0) + pages.reduce((sum, one) => sum + one.nodes.length, 0)), total);
  if (nextCursor('timelineItems', pr.timelineItems ?? { totalCount: 0, nodes: [] })) tell([]);
  const [behindBy, ...pages] = await Promise.all([
    behind(run, ref, pr),
    ...lists.map((list) => laterPages(run, ref, list, listOf(pr, list), size, list === 'timelineItems' ? tell : undefined)),
  ]);
  return { pr, more: Object.fromEntries(lists.map((list, index) => [list, pages[index] as RawList[]])), behindBy: behindBy as number | undefined };
}

/** Reads one pull request from GitHub, every list page by page. `ref` is a number or a link; a number is looked for in the repo of the folder. */
export async function readPullRequest(folder: string, ref: string, run: RunGh = runGh, onProgress?: OnProgress): Promise<PullResult> {
  try {
    const parsed = parsePullRef(ref, githubRepoOf(folder)?.slug);
    if (!parsed) {
      if (/^#?\d+$/.test(ref.trim())) fail('no-github-remote', 'This folder has no remote on GitHub, so a number alone names no pull request. Give a link.');
      fail('no-such-pull', 'That is not a number or a link of a pull request.');
    }
    let raw: RawPullRequest | undefined;
    for (const size of SMALLER_PAGES) {
      try {
        raw = await readAll(run, parsed!, size, onProgress);
        break;
      } catch (error) {
        if (!(error instanceof Failed) || error.failure.problem !== 'too-large' || size === SMALLER_PAGES.at(-1)) throw error;
      }
    }
    try {
      return { pull: pullRequestFrom(raw!) };
    } catch (error) {
      return { problem: 'bad-answer', text: `GitHub's answer is not what Apostil expects: ${(error as Error).message}` };
    }
  } catch (error) {
    if (error instanceof Failed) return error.failure;
    return { problem: 'bad-answer', text: `GitHub's answer is not what Apostil expects: ${(error as Error).message}` };
  }
}
