// Tests for writing to a pull request: each kind of write reaches a stand-in for gh with the right mutation, ids, lines and sides;
// the text arrives unchanged on standard input; an error of GitHub comes back as one sentence; nothing is sent twice. No test calls GitHub.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffRanges } from './page-data';
import type { GhResult } from './read-pull-request';
import {
  addCodeComment, addComment, addPullRequestReviewThreadReply, CLOSE, COMMENT, COMMIT, DELETE_BRANCH, FILE_AT, LINES_ALONE, LINES_IN_REVIEW, MERGE, READY, REOPEN, REPLY, RESOLVE,
  resolveReviewThread, REVIEW, SEND_PENDING, sendReview, TO_DRAFT, UNRESOLVE, unresolveReviewThread, UPDATE_BRANCH, writePullRequest, type Write,
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
    assert.ok('problem' in await writePullRequest({ kind: 'rename' } as never, gh.run));
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

test('a write answers with what GitHub made, so that the page takes it in place: the answer, the comment and the review as the page draws them, and the thread after a resolve', async () => {
  const said = { id: 'PRRC_1', url: 'https://github.com/made-up/repo/pull/1', author: { login: 'ada-made-up', avatarUrl: '', __typename: 'User' }, createdAt: '2026-11-01T09:00:00Z',
    lastEditedAt: null, bodyHTML: '<p>Done.</p><script>x</script>', isMinimized: false, minimizedReason: null, viewerDidAuthor: true, reactionGroups: [] };
  const answer = (data: object) => standIn({ out: JSON.stringify({ data }), err: '' }).run;
  const reply = await addPullRequestReviewThreadReply('t', 'Done.', answer({ addPullRequestReviewThreadReply: { comment: said } }));
  assert.ok('ok' in reply && reply.comment);
  assert.deepEqual([reply.comment.id, reply.comment.html, reply.comment.mine, reply.comment.author.login], ['PRRC_1', '<p>Done.</p>', true, 'ada-made-up'], 'cleaned, and his own');
  const comment = await addComment('p', 'Done.', answer({ addComment: { commentEdge: { node: { ...said, id: 'IC_1' } } } }));
  assert.equal('ok' in comment && comment.comment?.id, 'IC_1');
  const review = await sendReview('p', 'APPROVE', '', undefined, answer({ addPullRequestReview: { pullRequestReview: { ...said, id: 'PRR_1', state: 'APPROVED', submittedAt: '2026-11-01T09:01:00Z' } } }));
  assert.deepEqual('ok' in review && [review.review?.id, review.review?.state, review.review?.at], ['PRR_1', 'approved', '2026-11-01T09:01:00Z']);
  const thread = { id: 't', isResolved: true, resolvedBy: { login: 'ada-made-up', avatarUrl: '', __typename: 'User' }, viewerCanReply: true, viewerCanResolve: false, viewerCanUnresolve: true };
  assert.deepEqual(await resolveReviewThread('t', answer({ resolveReviewThread: { thread } })),
    { ok: true, thread: { resolved: true, resolvedBy: { login: 'ada-made-up', avatar: '', bot: false }, canReply: true, canResolve: false, canUnresolve: true } });
  // An answer that does not hold the whole comment is still ok: the page keeps what it showed.
  assert.deepEqual(await addComment('p', 'x', answer({ addComment: { commentEdge: { node: { id: 'IC_2' } } } })), { ok: true });
});

test('"Commit suggestion" reads each file at the head, puts the suggested lines in, commits all in one commit only while the branch is at that head, then resolves each thread; lines that changed since are refused and nothing is written', async () => {
  const calls: { query: string; variables: Record<string, any> }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  let refuse = false;
  const run = async (_args: string[], input?: string): Promise<GhResult> => {
    const body = JSON.parse(input ?? '{}');
    calls.push(body);
    if (body.query === FILE_AT) return { out: JSON.stringify({ data: { repository: { object: { text: body.variables.at.endsWith('b.ts') ? 'x\r\ny\r\n' : 'one\ntwo\nthree\nfour\n', isBinary: false, isTruncated: false } } } }), err: '' };
    if (body.query === COMMIT && refuse) return { out: JSON.stringify({ data: null, errors: [{ message: 'Expected branch to point to "h1" but it did not. Pull and try again.' }] }), err: '' };
    if (body.query === COMMIT) return { out: JSON.stringify({ data: { createCommitOnBranch: { commit: { oid: `c0ffee0${'0'.repeat(33)}`, abbreviatedOid: 'c0ffee0' } } } }), err: '' };
    return { out: JSON.stringify({ data: { resolveReviewThread: { thread: { id: body.variables.thread, isResolved: true } } } }), err: '' };
  };
  const write: Extract<Write, { kind: 'suggestions' }> = {
    kind: 'suggestions', repo: 'fork-made-up/repo', branch: 'feature', headOid: 'h1', threadIds: ['t1', 't2', 't3'],
    changes: [{ path: 'a.ts', start: 2, end: 2, old: ['two'], lines: ['2'] }, { path: 'a.ts', start: 4, end: 4, old: ['four'], lines: [] }, { path: 'b.ts', start: 1, end: 2, old: ['x', 'y'], lines: ['z'] }],
    message: { headline: 'Apply suggestions from code review', body: 'Co-authored-by: bo-made-up <77+bo-made-up@users.noreply.github.com>' },
  };
  const steps = () => calls.map((call) => (call.query === FILE_AT ? `read ${call.variables.at}` : call.query === COMMIT ? 'commit' : call.query === RESOLVE ? `resolve ${call.variables.thread}` : '?'));
  assert.deepEqual(await writePullRequest(write, run), { ok: true, commit: { oid: `c0ffee0${'0'.repeat(33)}`, short: 'c0ffee0' } });
  assert.deepEqual(steps(), ['read h1:a.ts', 'read h1:b.ts', 'commit', 'resolve t1', 'resolve t2', 'resolve t3']);
  const { fileChanges, ...rest } = calls[2].variables.input;
  assert.deepEqual(rest, { branch: { repositoryNameWithOwner: 'fork-made-up/repo', branchName: 'feature' }, expectedHeadOid: 'h1', message: write.message });
  const files = Object.fromEntries(fileChanges.additions.map((one: { path: string; contents: string }) => [one.path, Buffer.from(one.contents, 'base64').toString('utf8')]));
  assert.deepEqual(files, { 'a.ts': 'one\n2\nthree\n', 'b.ts': 'z\r\n' }, 'the lowest change first, the line ends of the file kept');

  // Lines that changed since the suggestion: refused before any write.
  calls.length = 0;
  const changed = await writePullRequest({ ...write, changes: [{ path: 'a.ts', start: 2, end: 2, old: ['TWO'], lines: ['2'] }] }, run);
  assert.ok('problem' in changed && /^Lines 2 to 2 of a\.ts changed since the suggestion was made\./.test(changed.problem));
  assert.deepEqual(steps(), ['read h1:a.ts'], 'no commit and no resolve');
  // A branch that moved on since the page read it: GitHub refuses the commit, in one sentence, and no thread is resolved.
  calls.length = 0;
  refuse = true;
  const moved = await writePullRequest(write, run);
  assert.ok('problem' in moved && /Expected branch to point to "h1"/.test(moved.problem));
  assert.deepEqual(steps(), ['read h1:a.ts', 'read h1:b.ts', 'commit']);
});

test('a merge sends the method, the title, the message and the head that the page showed (a rebase no title); GitHub\'s answer is the merged state, an answer that did not merge is a problem; close, reopen, ready, draft, update and delete each send their one mutation', async () => {
  const merged = { merged: true, mergedAt: '2026-11-03T09:05:00Z', mergedBy: { login: 'ada-made-up', avatarUrl: '', __typename: 'User' }, mergeCommit: { abbreviatedOid: 'abc1234' } };
  const gh = standIn({ out: JSON.stringify({ data: { mergePullRequest: { pullRequest: merged } } }), err: '' });
  const squash = await writePullRequest({ kind: 'merge', pullId: 'PR_made_up_7', method: 'SQUASH', title: 'Made-up change (#7)', body: '* one', headOid: 'h1' }, gh.run);
  assert.deepEqual(squash, { ok: true, merged: { at: '2026-11-03T09:05:00Z', by: { login: 'ada-made-up', avatar: '', bot: false }, commit: 'abc1234' } });
  await writePullRequest({ kind: 'merge', pullId: 'PR_made_up_7', method: 'REBASE', title: 'ignored', body: 'ignored', headOid: 'h1' }, gh.run);
  assert.deepEqual(gh.calls.map(sent), [
    { query: MERGE, variables: { pull: 'PR_made_up_7', method: 'SQUASH', title: 'Made-up change (#7)', body: '* one', head: 'h1' } },
    { query: MERGE, variables: { pull: 'PR_made_up_7', method: 'REBASE', head: 'h1' } },
  ]);
  assert.match(MERGE, /mergePullRequest\(input: \{ pullRequestId: \$pull, mergeMethod: \$method, commitHeadline: \$title, commitBody: \$body, expectedHeadOid: \$head \}\)/);
  const notMerged = await writePullRequest({ kind: 'merge', pullId: 'p', method: 'MERGE', headOid: 'h1' }, standIn({ out: JSON.stringify({ data: { mergePullRequest: { pullRequest: { merged: false } } } }), err: '' }).run);
  assert.ok('problem' in notMerged && /did not merge/.test(notMerged.problem));
  const moved = await writePullRequest({ kind: 'merge', pullId: 'p', method: 'MERGE', headOid: 'h1' }, standIn({ out: JSON.stringify({ data: null, errors: [{ message: 'Head branch was modified. Review and try the merge again.' }] }), err: '' }).run);
  assert.deepEqual(moved, { problem: 'GitHub says: Head branch was modified. Review and try the merge again.' });

  // The changes that can be undone: one mutation each, with the node id of the pull request (or of the branch).
  const each = [
    [{ kind: 'close', pullId: 'p' }, CLOSE, { pull: 'p' }, /closePullRequest/], [{ kind: 'reopen', pullId: 'p' }, REOPEN, { pull: 'p' }, /reopenPullRequest/],
    [{ kind: 'ready', pullId: 'p' }, READY, { pull: 'p' }, /markPullRequestReadyForReview/], [{ kind: 'draft', pullId: 'p' }, TO_DRAFT, { pull: 'p' }, /convertPullRequestToDraft/],
    [{ kind: 'update', pullId: 'p', headOid: 'h1' }, UPDATE_BRANCH, { pull: 'p', head: 'h1' }, /updatePullRequestBranch\(input: \{ pullRequestId: \$pull, expectedHeadOid: \$head \}\)/],
    [{ kind: 'delete-branch', refId: 'REF_1' }, DELETE_BRANCH, { ref: 'REF_1' }, /deleteRef/],
  ] as const;
  for (const [write, query, variables, name] of each) {
    const one = standIn({ out: JSON.stringify({ data: { updatePullRequestBranch: { pullRequest: { headRefOid: 'h2' } } } }), err: '' });
    const result = await writePullRequest(write, one.run);
    assert.deepEqual(one.calls.map(sent), [{ query, variables }], write.kind);
    assert.match(query, name);
    assert.deepEqual(result, write.kind === 'update' ? { ok: true, headOid: 'h2' } : { ok: true });
  }
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
