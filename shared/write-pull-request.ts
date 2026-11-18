// Writes to one pull request on GitHub with "gh api graphql": an answer in a thread, resolve and unresolve, a comment, a comment on code lines, a review,
// and suggested changes committed to the branch of the pull request.
// Each function sends its mutations once: a failure comes back as one plain sentence and is never sent again here.
// A write answers with what GitHub made (the comment, the review, the thread, the commit), so that the page takes it in place.
// The text of a comment goes to gh on standard input, inside the JSON of the request, never on the command line.

import { reviewState, person } from './pull-request-facts';
import { commentFrom, runGh, SAID, type GhResult, type PullComment, type Person, type ReviewState, type RunGh } from './read-pull-request';

export type Side = 'LEFT' | 'RIGHT'; // LEFT: the file as it was (a removed line); RIGHT: the file as it is now (an added or unchanged line)
export type Verdict = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

/** Code lines of a pull request: the last line, the first line of a range, and the side of each. */
export interface CodeLines {
  path: string;
  line: number;
  side: Side;
  startLine?: number; // only for a range
  startSide?: Side;
}

/** One suggested change: the lines `start` to `end` of a file at the head of the pull request, as they were (`old`) and as they become (`lines`). */
export interface SuggestedChange {
  path: string;
  start: number;
  end: number;
  old: string[];
  lines: string[];
}

/** What the page asks the extension to write. Every id is a node id that the reader gave. */
export type Write =
  | { kind: 'reply'; threadId: string; body: string }
  | { kind: 'resolve'; threadId: string }
  | { kind: 'unresolve'; threadId: string }
  | { kind: 'comment'; pullId: string; body: string }
  | { kind: 'lines'; pullId: string; commit: string; pendingId?: string; lines: CodeLines; body: string }
  | { kind: 'review'; pullId: string; pendingId?: string; verdict: Verdict; body: string }
  // "Commit suggestion" and "Commit suggestions" of a batch: one commit on the branch of the pull request, then its threads resolved, as GitHub does.
  | { kind: 'suggestions'; repo: string; branch: string; headOid: string; threadIds: string[]; changes: SuggestedChange[]; message: { headline: string; body: string } };

/** A thread after a resolve or an unresolve, as GitHub answers it. */
export interface ThreadState { resolved: boolean; resolvedBy?: Person; canReply: boolean; canResolve: boolean; canUnresolve: boolean }

export type WriteResult =
  | { ok: true; comment?: PullComment; review?: PullComment & { state: ReviewState }; thread?: ThreadState; commit?: { oid: string; short: string } }
  | { problem: string };

// ----- the mutations -----

const THREAD = 'thread { id isResolved resolvedBy { login avatarUrl(size: 80) __typename } viewerCanReply viewerCanResolve viewerCanUnresolve }';
export const REPLY = `mutation($thread: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) { comment { ${SAID} } } }`;
export const RESOLVE = `mutation($thread: ID!) { resolveReviewThread(input: { threadId: $thread }) { ${THREAD} } }`;
export const UNRESOLVE = `mutation($thread: ID!) { unresolveReviewThread(input: { threadId: $thread }) { ${THREAD} } }`;
export const COMMENT = `mutation($subject: ID!, $body: String!) { addComment(input: { subjectId: $subject, body: $body }) { commentEdge { node { ${SAID} } } } }`;
// A comment on code with no review that is not sent yet: a review with that one thread, sent at once, as "Add single comment" on GitHub.
export const LINES_ALONE = 'mutation($pull: ID!, $commit: GitObjectID!, $thread: DraftPullRequestReviewThread!) { addPullRequestReview(input: { pullRequestId: $pull, commitOID: $commit, event: COMMENT, threads: [$thread] }) { pullRequestReview { id } } }';
// A comment on code when he has a review that is not sent yet: GitHub puts it into that review.
export const LINES_IN_REVIEW = 'mutation($review: ID!, $path: String!, $line: Int!, $side: DiffSide!, $startLine: Int, $startSide: DiffSide, $body: String!) { addPullRequestReviewThread(input: { pullRequestReviewId: $review, path: $path, line: $line, side: $side, startLine: $startLine, startSide: $startSide, body: $body }) { thread { id } } }';
export const REVIEW = `mutation($pull: ID!, $event: PullRequestReviewEvent!, $body: String) { addPullRequestReview(input: { pullRequestId: $pull, event: $event, body: $body }) { pullRequestReview { ${SAID} state submittedAt } } }`;
// The review that is not sent yet, sent with its comments and the verdict.
export const SEND_PENDING = `mutation($review: ID!, $event: PullRequestReviewEvent!, $body: String) { submitPullRequestReview(input: { pullRequestReviewId: $review, event: $event, body: $body }) { pullRequestReview { ${SAID} state submittedAt } } }`;
// A file at the head of the pull request, read before a suggested change is committed (a read: no mutation).
export const FILE_AT = 'query($owner: String!, $name: String!, $at: String!) { repository(owner: $owner, name: $name) { object(expression: $at) { ... on Blob { text isBinary isTruncated } } } }';
// One commit with the changed files on the branch, only while the branch is still at the commit that the page showed.
export const COMMIT = 'mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid abbreviatedOid } } }';

// ----- one send -----

/** GitHub's own sentence for a failed write, in one line; or nothing when it went through. */
export function problemOf(result: GhResult): string | undefined {
  if (result.missing) return 'The gh program is not installed. Install it from cli.github.com, then run "gh auth login".';
  if (result.timedOut) return 'GitHub did not answer in 30 seconds. Look on GitHub whether it arrived before you send it again.';
  let json: { data?: unknown; errors?: { message?: string }[] } | undefined;
  try { json = JSON.parse(result.out); } catch { /* not JSON: the words of gh say why */ }
  const message = json?.errors?.map((error) => error.message).filter(Boolean).join(' ');
  if (message) return `GitHub says: ${oneLine(message)}`;
  if (json?.data) return undefined;
  const text = `${result.err}\n${result.out}`;
  if (/gh auth login|not logged in|HTTP 401|Bad credentials/i.test(text)) return 'The gh program is not signed in. Run "gh auth login" in a terminal.';
  if (/dial tcp|could not resolve host|no such host|network is unreachable|connection refused|error connecting|offline/i.test(text)) return 'GitHub cannot be reached. Check the network. Nothing was sent.';
  return `GitHub says: ${oneLine(result.err || result.out || 'no answer')}`;
}

const oneLine = (text: string): string => text.replace(/^gh:\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 300);

/* eslint-disable @typescript-eslint/no-explicit-any */
type Data = any;

/** Sends one query through gh, with the query and its variables as JSON on standard input. Never twice. The data of the answer, or the problem. */
async function send(run: RunGh, query: string, variables: Record<string, unknown>): Promise<{ data: Data } | { problem: string }> {
  const result = await run(['api', 'graphql', '--input', '-'], JSON.stringify({ query, variables }));
  const problem = problemOf(result);
  if (problem) return { problem };
  try { return { data: JSON.parse(result.out).data ?? {} }; } catch { return { data: {} }; }
}

/** A comment or a review that GitHub answered, as the page draws it; nothing when the answer does not hold one whole. */
const saidOf = (node: Data): PullComment | undefined => (node?.id && node.createdAt && typeof node.bodyHTML === 'string' ? commentFrom(node) : undefined);

const threadOf = (node: Data): ThreadState | undefined => (node && typeof node.isResolved === 'boolean'
  ? { resolved: node.isResolved, ...(node.resolvedBy ? { resolvedBy: person(node.resolvedBy) } : {}), canReply: !!node.viewerCanReply, canResolve: !!node.viewerCanResolve, canUnresolve: !!node.viewerCanUnresolve }
  : undefined);

/** The answer of a write: the problem, or ok with what GitHub made. */
const answer = (sent: { data: Data } | { problem: string }, made: (data: Data) => Omit<Extract<WriteResult, { ok: true }>, 'ok'> = () => ({})): WriteResult =>
  ('problem' in sent ? sent : { ok: true, ...made(sent.data) });

const only = <T>(key: string, value: T | undefined): Record<string, T> => (value ? { [key]: value } : {});

// ----- one function for each kind of write -----

export const addPullRequestReviewThreadReply = async (threadId: string, body: string, run: RunGh = runGh): Promise<WriteResult> =>
  answer(await send(run, REPLY, { thread: threadId, body }), (data) => only('comment', saidOf(data?.addPullRequestReviewThreadReply?.comment)));

export const resolveReviewThread = async (threadId: string, run: RunGh = runGh): Promise<WriteResult> =>
  answer(await send(run, RESOLVE, { thread: threadId }), (data) => only('thread', threadOf(data?.resolveReviewThread?.thread)));

export const unresolveReviewThread = async (threadId: string, run: RunGh = runGh): Promise<WriteResult> =>
  answer(await send(run, UNRESOLVE, { thread: threadId }), (data) => only('thread', threadOf(data?.unresolveReviewThread?.thread)));

/** A comment on the pull request, not on code. */
export const addComment = async (pullId: string, body: string, run: RunGh = runGh): Promise<WriteResult> =>
  answer(await send(run, COMMENT, { subject: pullId, body }), (data) => only('comment', saidOf(data?.addComment?.commentEdge?.node)));

/** A comment on one code line or a range, at the head commit of the pull request; into the review that is not sent yet when he has one. */
export async function addCodeComment(pullId: string, commit: string, lines: CodeLines, body: string, pendingId?: string, run: RunGh = runGh): Promise<WriteResult> {
  const range = lines.startLine !== undefined && lines.startLine !== lines.line ? { startLine: lines.startLine, startSide: lines.startSide ?? lines.side } : {};
  const at = { path: lines.path, line: lines.line, side: lines.side, ...range };
  return answer(pendingId
    ? await send(run, LINES_IN_REVIEW, { review: pendingId, ...at, body })
    : await send(run, LINES_ALONE, { pull: pullId, commit, thread: { ...at, body } }));
}

/** A review with its verdict and text; with a review that is not sent yet, that review is sent with its comments. */
export async function sendReview(pullId: string, verdict: Verdict, body: string, pendingId?: string, run: RunGh = runGh): Promise<WriteResult> {
  const sent = pendingId ? await send(run, SEND_PENDING, { review: pendingId, event: verdict, body }) : await send(run, REVIEW, { pull: pullId, event: verdict, body });
  return answer(sent, (data) => {
    const node = (data?.submitPullRequestReview ?? data?.addPullRequestReview)?.pullRequestReview;
    const said = saidOf(node);
    return only('review', said && { ...said, at: node.submittedAt ?? said.at, state: reviewState(node.state) });
  });
}

/** The lines of a file with the suggested changes put in, the lowest last so that the line numbers above stay; or the problem. */
export function withChanges(text: string, changes: SuggestedChange[]): { text: string } | { problem: string } {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  for (const change of [...changes].sort((a, b) => b.start - a.start)) {
    const now = lines.slice(change.start - 1, change.end);
    if (now.length !== change.old.length || now.some((line, index) => line !== change.old[index])) {
      return { problem: `Lines ${change.start} to ${change.end} of ${change.path} changed since the suggestion was made. Look on GitHub.` };
    }
    lines.splice(change.start - 1, change.end - change.start + 1, ...change.lines);
  }
  return { text: lines.join(newline) };
}

/**
 * "Commit suggestion": reads each file at the head of the pull request, puts the suggested lines in, and commits them to the branch in one commit
 * with GitHub's message and its co-authors; then resolves each thread, as GitHub does when it applies a suggestion. The commit is made only
 * while the branch is still at the commit that the page showed, and only when each file still has the lines that the suggestion replaces.
 */
export async function commitSuggestions(write: Extract<Write, { kind: 'suggestions' }>, run: RunGh = runGh): Promise<WriteResult> {
  const [owner, name] = write.repo.split('/');
  const additions: { path: string; contents: string }[] = [];
  for (const path of [...new Set(write.changes.map((change) => change.path))]) {
    const read = await send(run, FILE_AT, { owner, name, at: `${write.headOid}:${path}` });
    if ('problem' in read) return read;
    const blob = read.data?.repository?.object;
    if (typeof blob?.text !== 'string' || blob.isBinary || blob.isTruncated) return { problem: `GitHub gave no text of ${path} at the head of the pull request.` };
    const changed = withChanges(blob.text, write.changes.filter((change) => change.path === path));
    if ('problem' in changed) return changed;
    additions.push({ path, contents: Buffer.from(changed.text, 'utf8').toString('base64') });
  }
  const input = { branch: { repositoryNameWithOwner: write.repo, branchName: write.branch }, expectedHeadOid: write.headOid, message: write.message, fileChanges: { additions } };
  const made = await send(run, COMMIT, { input });
  if ('problem' in made) return made;
  const commit = made.data?.createCommitOnBranch?.commit;
  for (const threadId of write.threadIds) await send(run, RESOLVE, { thread: threadId }); // the commit stands; a thread that stays open is seen at the next read
  return { ok: true, ...(commit?.oid ? { commit: { oid: commit.oid, short: commit.abbreviatedOid ?? commit.oid.slice(0, 7) } } : {}) };
}

/** One write that the page asked for, by its kind. */
export function writePullRequest(write: Write, run: RunGh = runGh): Promise<WriteResult> {
  switch (write.kind) {
    case 'reply': return addPullRequestReviewThreadReply(write.threadId, write.body, run);
    case 'resolve': return resolveReviewThread(write.threadId, run);
    case 'unresolve': return unresolveReviewThread(write.threadId, run);
    case 'comment': return addComment(write.pullId, write.body, run);
    case 'lines': return addCodeComment(write.pullId, write.commit, write.lines, write.body, write.pendingId, run);
    case 'review': return sendReview(write.pullId, write.verdict, write.body, write.pendingId, run);
    case 'suggestions': return commitSuggestions(write, run);
    default: return Promise.resolve({ problem: 'Apostil does not know this kind of write.' });
  }
}
