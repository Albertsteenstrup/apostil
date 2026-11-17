// Writes to one pull request on GitHub with "gh api graphql": an answer in a thread, resolve and unresolve, a comment, a comment on code lines, a review.
// Each function sends one mutation, once: a failure comes back as one plain sentence and is never sent again here.
// The text of a comment goes to gh on standard input, inside the JSON of the request, never on the command line.

import { runGh, type GhResult, type RunGh } from './read-pull-request';

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

/** What the page asks the extension to write. Every id is a node id that the reader gave. */
export type Write =
  | { kind: 'reply'; threadId: string; body: string }
  | { kind: 'resolve'; threadId: string }
  | { kind: 'unresolve'; threadId: string }
  | { kind: 'comment'; pullId: string; body: string }
  | { kind: 'lines'; pullId: string; commit: string; pendingId?: string; lines: CodeLines; body: string }
  | { kind: 'review'; pullId: string; pendingId?: string; verdict: Verdict; body: string };

export type WriteResult = { ok: true } | { problem: string };

// ----- the mutations -----

export const REPLY = 'mutation($thread: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) { comment { id } } }';
export const RESOLVE = 'mutation($thread: ID!) { resolveReviewThread(input: { threadId: $thread }) { thread { id isResolved } } }';
export const UNRESOLVE = 'mutation($thread: ID!) { unresolveReviewThread(input: { threadId: $thread }) { thread { id isResolved } } }';
export const COMMENT = 'mutation($subject: ID!, $body: String!) { addComment(input: { subjectId: $subject, body: $body }) { commentEdge { node { id } } } }';
// A comment on code with no review that is not sent yet: a review with that one thread, sent at once, as "Add single comment" on GitHub.
export const LINES_ALONE = 'mutation($pull: ID!, $commit: GitObjectID!, $thread: DraftPullRequestReviewThread!) { addPullRequestReview(input: { pullRequestId: $pull, commitOID: $commit, event: COMMENT, threads: [$thread] }) { pullRequestReview { id } } }';
// A comment on code when he has a review that is not sent yet: GitHub puts it into that review.
export const LINES_IN_REVIEW = 'mutation($review: ID!, $path: String!, $line: Int!, $side: DiffSide!, $startLine: Int, $startSide: DiffSide, $body: String!) { addPullRequestReviewThread(input: { pullRequestReviewId: $review, path: $path, line: $line, side: $side, startLine: $startLine, startSide: $startSide, body: $body }) { thread { id } } }';
export const REVIEW = 'mutation($pull: ID!, $event: PullRequestReviewEvent!, $body: String) { addPullRequestReview(input: { pullRequestId: $pull, event: $event, body: $body }) { pullRequestReview { id } } }';
// The review that is not sent yet, sent with its comments and the verdict.
export const SEND_PENDING = 'mutation($review: ID!, $event: PullRequestReviewEvent!, $body: String) { submitPullRequestReview(input: { pullRequestReviewId: $review, event: $event, body: $body }) { pullRequestReview { id } } }';

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

/** Sends one mutation through gh, with the query and its variables as JSON on standard input. Never twice. */
async function send(run: RunGh, query: string, variables: Record<string, unknown>): Promise<WriteResult> {
  const result = await run(['api', 'graphql', '--input', '-'], JSON.stringify({ query, variables }));
  const problem = problemOf(result);
  return problem ? { problem } : { ok: true };
}

// ----- one function for each kind of write -----

export const addPullRequestReviewThreadReply = (threadId: string, body: string, run: RunGh = runGh): Promise<WriteResult> =>
  send(run, REPLY, { thread: threadId, body });

export const resolveReviewThread = (threadId: string, run: RunGh = runGh): Promise<WriteResult> => send(run, RESOLVE, { thread: threadId });

export const unresolveReviewThread = (threadId: string, run: RunGh = runGh): Promise<WriteResult> => send(run, UNRESOLVE, { thread: threadId });

/** A comment on the pull request, not on code. */
export const addComment = (pullId: string, body: string, run: RunGh = runGh): Promise<WriteResult> => send(run, COMMENT, { subject: pullId, body });

/** A comment on one code line or a range, at the head commit of the pull request; into the review that is not sent yet when he has one. */
export function addCodeComment(pullId: string, commit: string, lines: CodeLines, body: string, pendingId?: string, run: RunGh = runGh): Promise<WriteResult> {
  const range = lines.startLine !== undefined && lines.startLine !== lines.line ? { startLine: lines.startLine, startSide: lines.startSide ?? lines.side } : {};
  const at = { path: lines.path, line: lines.line, side: lines.side, ...range };
  return pendingId
    ? send(run, LINES_IN_REVIEW, { review: pendingId, ...at, body })
    : send(run, LINES_ALONE, { pull: pullId, commit, thread: { ...at, body } });
}

/** A review with its verdict and text; with a review that is not sent yet, that review is sent with its comments. */
export const sendReview = (pullId: string, verdict: Verdict, body: string, pendingId?: string, run: RunGh = runGh): Promise<WriteResult> =>
  (pendingId ? send(run, SEND_PENDING, { review: pendingId, event: verdict, body }) : send(run, REVIEW, { pull: pullId, event: verdict, body }));

/** One write that the page asked for, by its kind. */
export function writePullRequest(write: Write, run: RunGh = runGh): Promise<WriteResult> {
  switch (write.kind) {
    case 'reply': return addPullRequestReviewThreadReply(write.threadId, write.body, run);
    case 'resolve': return resolveReviewThread(write.threadId, run);
    case 'unresolve': return unresolveReviewThread(write.threadId, run);
    case 'comment': return addComment(write.pullId, write.body, run);
    case 'lines': return addCodeComment(write.pullId, write.commit, write.lines, write.body, write.pendingId, run);
    case 'review': return sendReview(write.pullId, write.verdict, write.body, write.pendingId, run);
    default: return Promise.resolve({ problem: 'Apostil does not know this kind of write.' });
  }
}
