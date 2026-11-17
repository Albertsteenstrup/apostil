// Tests for writing to a pull request: each kind of write reaches a stand-in for gh with the right mutation, ids, lines and sides;
// the text arrives unchanged on standard input; an error of GitHub comes back as one sentence; nothing is sent twice. No test calls GitHub.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffRanges } from '../view/page-data';
import type { GhResult } from './read-pull-request';
import {
  addCodeComment, addComment, addPullRequestReviewThreadReply, COMMENT, LINES_ALONE, LINES_IN_REVIEW, REPLY, RESOLVE, resolveReviewThread, REVIEW, SEND_PENDING,
  sendReview, UNRESOLVE, unresolveReviewThread, writePullRequest,
} from './write-pull-request';

/** A stand-in for gh that keeps every call with what came on its standard input, and answers as GitHub does. */
function standIn(answer: GhResult = { out: JSON.stringify({ data: { done: { clientMutationId: null } } }), err: '' }) {
  const calls: { args: string[]; input?: string }[] = [];
  return { calls, run: async (args: string[], input?: string) => { calls.push({ args, input }); return answer; } };
}
const sent = (call: { input?: string }) => JSON.parse(call.input ?? '{}') as { query: string; variables: Record<string, unknown> };

test('every kind of write sends exactly one mutation and no read: an answer, a resolve, an unresolve and a comment send theirs with the ids as variables', async () => {
  const gh = standIn();
  assert.deepEqual(await addPullRequestReviewThreadReply('PRRT_made_up_1', 'Done.', gh.run), { ok: true });
  assert.deepEqual(await resolveReviewThread('PRRT_made_up_1', gh.run), { ok: true });
  assert.deepEqual(await unresolveReviewThread('PRRT_made_up_1', gh.run), { ok: true });
  assert.deepEqual(await addComment('PR_made_up_12', 'Looks good.', gh.run), { ok: true });
  assert.equal(gh.calls.length, 4);
  assert.ok(gh.calls.every((call) => call.args.join(' ') === 'api graphql --input -'), 'the command line holds no text and no id');
  assert.deepEqual(gh.calls.map((call) => sent(call)), [
    { query: REPLY, variables: { thread: 'PRRT_made_up_1', body: 'Done.' } },
    { query: RESOLVE, variables: { thread: 'PRRT_made_up_1' } },
    { query: UNRESOLVE, variables: { thread: 'PRRT_made_up_1' } },
    { query: COMMENT, variables: { subject: 'PR_made_up_12', body: 'Looks good.' } },
  ]);
  assert.match(REPLY, /addPullRequestReviewThreadReply/);
  assert.match(RESOLVE, /resolveReviewThread/);
  assert.match(UNRESOLVE, /unresolveReviewThread/);
  assert.match(COMMENT, /addComment/);

  // Every kind of write sends exactly one mutation and no read.
  {
    const lines = { path: 'a.ts', line: 1, side: 'RIGHT' as const };
    const writes = [
      { kind: 'reply', threadId: 't', body: 'b' }, { kind: 'resolve', threadId: 't' }, { kind: 'unresolve', threadId: 't' }, { kind: 'comment', pullId: 'p', body: 'b' },
      { kind: 'lines', pullId: 'p', commit: 'c', lines, body: 'b' }, { kind: 'lines', pullId: 'p', commit: 'c', pendingId: 'r', lines, body: 'b' },
      { kind: 'review', pullId: 'p', verdict: 'APPROVE', body: '' }, { kind: 'review', pullId: 'p', pendingId: 'r', verdict: 'COMMENT', body: '' },
    ] as const;
    for (const write of writes) {
      const gh = standIn();
      await writePullRequest(write, gh.run);
      assert.equal(gh.calls.length, 1, write.kind);
      assert.match(sent(gh.calls[0]).query, /^mutation/);
    }
    const gh = standIn();
    assert.ok('problem' in await writePullRequest({ kind: 'merge' } as never, gh.run));
    assert.equal(gh.calls.length, 0, 'a kind that is not known sends nothing');
  }
});

test('a comment on an added line, a removed line and a range has the right line, start line and side at the head commit; with a review not sent yet it goes into it, and the review is sent with its verdict', async () => {
  const gh = standIn();
  await addCodeComment('PR_made_up_12', 'abc123', { path: 'src/a.ts', line: 14, side: 'RIGHT' }, 'Added line.', undefined, gh.run);
  await addCodeComment('PR_made_up_12', 'abc123', { path: 'src/a.ts', line: 9, side: 'LEFT' }, 'Removed line.', undefined, gh.run);
  await addCodeComment('PR_made_up_12', 'abc123', { path: 'src/a.ts', line: 20, side: 'RIGHT', startLine: 17, startSide: 'RIGHT' }, 'A range.', undefined, gh.run);
  const [added, removed, range] = gh.calls.map(sent);
  assert.equal(added.query, LINES_ALONE);
  assert.match(LINES_ALONE, /addPullRequestReview\(.*event: COMMENT, threads: \[\$thread\]/);
  assert.deepEqual(added.variables, { pull: 'PR_made_up_12', commit: 'abc123', thread: { path: 'src/a.ts', line: 14, side: 'RIGHT', body: 'Added line.' } });
  assert.deepEqual(removed.variables.thread, { path: 'src/a.ts', line: 9, side: 'LEFT', body: 'Removed line.' });
  assert.deepEqual(range.variables.thread, { path: 'src/a.ts', line: 20, side: 'RIGHT', startLine: 17, startSide: 'RIGHT', body: 'A range.' });

  // With a review that is not sent yet, a comment on code goes into it, and the review is sent with its verdict.
  {
    const gh = standIn();
    await addCodeComment('PR_made_up_12', 'abc123', { path: 'src/a.ts', line: 5, side: 'LEFT', startLine: 3, startSide: 'LEFT' }, 'In the review.', 'PRR_made_up_7', gh.run);
    await sendReview('PR_made_up_12', 'REQUEST_CHANGES', 'Two things.', 'PRR_made_up_7', gh.run);
    await sendReview('PR_made_up_12', 'APPROVE', '', undefined, gh.run);
    await sendReview('PR_made_up_12', 'COMMENT', 'A note.', undefined, gh.run);
    const [thread, pending, approve, comment] = gh.calls.map(sent);
    assert.equal(thread.query, LINES_IN_REVIEW);
    assert.deepEqual(thread.variables, { review: 'PRR_made_up_7', path: 'src/a.ts', line: 5, side: 'LEFT', startLine: 3, startSide: 'LEFT', body: 'In the review.' });
    assert.equal(pending.query, SEND_PENDING);
    assert.deepEqual(pending.variables, { review: 'PRR_made_up_7', event: 'REQUEST_CHANGES', body: 'Two things.' });
    assert.equal(approve.query, REVIEW);
    assert.deepEqual(approve.variables, { pull: 'PR_made_up_12', event: 'APPROVE', body: '' });
    assert.deepEqual(comment.variables, { pull: 'PR_made_up_12', event: 'COMMENT', body: 'A note.' });
  }
});

test('the text arrives unchanged, an error of GitHub comes back as one plain sentence, and nothing is sent again', async () => {
  const texts = ['He said "no" and \'yes\'.', '-f query=evil\n--input -', '$(rm -rf ~) `whoami` ${HOME}', 'Ship it 🚀👍🏽', 'x'.repeat(19_999) + '!'];
  for (const text of texts) {
    const gh = standIn();
    await writePullRequest({ kind: 'comment', pullId: 'PR_made_up_12', body: text }, gh.run);
    assert.equal(sent(gh.calls[0]).variables.body, text);
    assert.deepEqual(gh.calls[0].args, ['api', 'graphql', '--input', '-']);
  }

  // An error of GitHub comes back as one plain sentence, and nothing is sent again.
  const problem = async (answer: GhResult) => {
    const gh = standIn(answer);
    const result = await writePullRequest({ kind: 'reply', threadId: 'PRRT_made_up_1', body: 'Hi' }, gh.run);
    assert.equal(gh.calls.length, 1, 'one send only');
    return 'problem' in result ? result.problem : '';
  };
  assert.equal(await problem({ out: JSON.stringify({ data: { addPullRequestReviewThreadReply: null }, errors: [{ message: 'Pull request review thread is locked' }] }), err: '' }),
    'GitHub says: Pull request review thread is locked');
  assert.equal(await problem({ out: '', err: 'gh: Resource not accessible by integration (HTTP 403)\n' }), 'GitHub says: Resource not accessible by integration (HTTP 403)');
  assert.match(await problem({ out: '', err: 'error connecting to api.github.com\ncheck your internet connection' }), /^GitHub cannot be reached\./);
  assert.match(await problem({ out: '', err: '', timedOut: true }), /^GitHub did not answer in 30 seconds\. Look on GitHub/);
  assert.match(await problem({ out: '', err: '', missing: true }), /^The gh program is not installed\./);
  assert.match(await problem({ out: '', err: 'To get started with GitHub CLI, please run:  gh auth login' }), /not signed in/);
  for (const text of [await problem({ out: JSON.stringify({ errors: [{ message: 'line one\nline two' }] }), err: '' })]) assert.ok(!text.includes('\n'));
});

test('the lines of a diff where GitHub takes a comment: each hunk on each side, a removed file on the old side, and "---" inside a hunk is code', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts', 'index 1..2 100644', '--- a/src/a.ts', '+++ b/src/a.ts',
    '@@ -10,7 +10,8 @@ function a()', ' one', '-two', '--- a line of code that starts with two minus signs', '+three', '+four', ' five',
    '@@ -40 +41,0 @@', '-gone',
    'diff --git a/old.ts b/old.ts', 'deleted file mode 100644', '--- a/old.ts', '+++ /dev/null', '@@ -1,3 +0,0 @@', '-a', '-b', '-c',
    'diff --git a/new.ts b/new.ts', 'new file mode 100644', '--- /dev/null', '+++ b/new.ts', '@@ -0,0 +1,2 @@', '+x', '+y',
  ].join('\n');
  assert.deepEqual(diffRanges(diff), {
    'src/a.ts': { right: [[10, 17]], left: [[10, 16], [40, 40]] },
    'old.ts': { right: [], left: [[1, 3]] },
    'new.ts': { right: [[1, 2]], left: [] },
  });
});
