// Tests for the state card of a pull request (view/media/merge-card.js, read in Node), from the facts of a read: the headline, the sentence and what
// blocks a merge for each state, the three meters, the actions that GitHub allows, and what an action changes at once. Made-up JSON only.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pullRequestFrom, type PullRequestView } from '../shared/read-pull-request';
import { STATE_LOOKS } from '../shared/pull-requests';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const MergeCard = require('../../view/media/merge-card.js');

const at = (minute: number) => new Date(Date.UTC(2026, 10, 3, 9, minute)).toISOString();
const who = (login: string, typename = 'User') => ({ login, avatarUrl: '', __typename: typename });
const list = (nodes: object[]) => ({ totalCount: nodes.length, pageInfo: { hasNextPage: false }, nodes });
const check = (name: string, conclusion: string | null) => ({
  __typename: 'CheckRun', name, status: conclusion ? 'COMPLETED' : 'IN_PROGRESS', conclusion, startedAt: at(1), completedAt: conclusion ? at(2) : null,
  annotations: { totalCount: 0, nodes: [] }, checkSuite: { app: { name: 'GitHub Actions' }, workflowRun: { url: 'https://example.com/run/1', workflow: { name: 'CI' } } },
});
const thread = (id: string, resolved: boolean) => ({ id, isResolved: resolved, isOutdated: false, path: 'a.ts', line: 3, viewerCanReply: true, viewerCanResolve: !resolved, viewerCanUnresolve: resolved,
  comments: { totalCount: 1, nodes: [{ id: `${id}-c`, url: '', author: who('bo-made-up'), createdAt: at(3), bodyHTML: '<p>A note.</p>', reactionGroups: [] }] } });

/** A read of a made-up pull request that can merge: approved, one check passed, he may push; `fields` change GitHub's answer. */
function pull(fields: Record<string, unknown> = {}, more: { behindBy?: number } = {}): PullRequestView {
  return pullRequestFrom({ pr: {
    id: 'PR_made_up_7', number: 7, title: 'Made-up change', url: 'https://github.com/made-up/repo/pull/7', state: 'OPEN', isDraft: false, createdAt: at(0),
    headRefName: 'feature', baseRefName: 'main', headRefOid: 'h1', author: who('ada-made-up'), commits: { totalCount: 1 }, reviewDecision: 'APPROVED',
    mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', bodyHTML: '',
    repository: { nameWithOwner: 'made-up/repo', isPrivate: false, viewerPermission: 'WRITE', mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false, viewerDefaultMergeMethod: 'SQUASH', deleteBranchOnMerge: false },
    headRepository: { nameWithOwner: 'made-up/repo' }, isCrossRepository: false, headRef: { id: 'REF_made_up' },
    viewerCanMergeAsAdmin: false, viewerCanUpdate: true, viewerCanClose: true, viewerCanReopen: true, viewerCanUpdateBranch: true, viewerCanDeleteHeadRef: true,
    latestReviews: { nodes: [{ author: who('bo-made-up'), state: 'APPROVED' }] }, reviewRequests: { nodes: [] },
    last: { nodes: [{ commit: { statusCheckRollup: { contexts: list([check('test', 'SUCCESS')]) } } }] },
    timelineItems: list([]), reviewThreads: list([]), files: list([]), ...fields,
  }, ...more });
}
const ago = (iso: string) => `at ${iso.slice(11, 16)}`;
const card = (one: PullRequestView) => MergeCard.of(one, ago);
const blockers = (one: PullRequestView) => card(one).blockers.map((part: { text: string; go: string }) => `${part.text} → ${part.go}`);

test('the state card for each state: ready, able to merge with what does not block, blocked with what blocks and where its fix is, behind, conflicts, draft, merged and closed', () => {
  const ready = card(pull());
  assert.deepEqual([ready.kind, ready.headline, ready.sentence, ready.icon, ready.colour, ready.primary], ['ready', 'Ready to merge', 'Approved by bo-made-up, and the check passed.', 'git-merge', 'green', 'merge']);
  assert.deepEqual(ready.links, ['draft', 'close']);

  // Able to merge: GitHub may merge it, and the sentence says what does not block. His own case: no review asked, no checks, nobody approved.
  const unstable = card(pull({ mergeStateStatus: 'UNSTABLE', last: { nodes: [{ commit: { statusCheckRollup: { contexts: list([check('test', 'FAILURE')]) } } }] } }));
  assert.deepEqual([unstable.kind, unstable.headline, unstable.sentence, unstable.colour, unstable.primary], ['able', 'Able to merge', '1 check failed. This does not block a merge.', 'grey', 'merge']);
  const nobody = card(pull({ reviewDecision: '', latestReviews: { nodes: [] }, last: { nodes: [] } }));
  assert.deepEqual([nobody.kind, nobody.sentence, nobody.primary], ['able', 'No one has approved it. This does not block a merge.', 'merge']);

  // Blocked: each blocker leads to its fix. Threads block when the base asks for every thread resolved; they take the place of "a rule of the repo".
  const blocked = pull({ mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED', latestReviews: { nodes: [] }, reviewThreads: list([thread('t1', false), thread('t2', true)]),
    baseRef: { refUpdateRule: { requiredApprovingReviewCount: 1, requiresConversationResolution: true, requiresLinearHistory: false } },
    last: { nodes: [{ commit: { statusCheckRollup: { contexts: list([check('test', 'FAILURE'), check('lint', null)]) } } }] } });
  assert.deepEqual([card(blocked).kind, card(blocked).headline, card(blocked).colour, card(blocked).primary], ['blocked', 'Blocked', 'red', null]);
  assert.deepEqual(blockers(blocked), ['1 check failed → checks', 'An approving review is needed → review', '1 check is still running → checks', '1 thread is not resolved → comments']);
  assert.equal(card(blocked).sentence, '1 check failed · An approving review is needed · 1 check is still running · 1 thread is not resolved');
  const onlyRule = pull({ mergeStateStatus: 'BLOCKED', reviewThreads: list([thread('t1', false)]), baseRef: { refUpdateRule: { requiresConversationResolution: true } } });
  assert.deepEqual(blockers(onlyRule), ['1 thread is not resolved → comments']);
  assert.equal(card(onlyRule).colour, 'amber', 'nothing failed: it waits');
  assert.deepEqual(blockers(pull({ mergeStateStatus: 'BLOCKED' })), ['Blocked by a rule of the repo → github']);
  assert.deepEqual(card(pull({ mergeStateStatus: 'BLOCKED', viewerCanMergeAsAdmin: true })).links, ['merge-admin', 'draft', 'close']);

  // Behind its base: blocks only when GitHub says so; its fix is "Update branch", or GitHub when he may not update it.
  const behind = card(pull({ mergeStateStatus: 'BEHIND' }, { behindBy: 3 }));
  assert.deepEqual([behind.kind, behind.headline, behind.sentence, behind.primary], ['behind', 'Behind main', '3 commits behind main. The repo wants the branch up to date before a merge.', null]);
  assert.deepEqual(behind.links, ['update', 'draft', 'close']);
  assert.deepEqual(blockers(pull({ mergeStateStatus: 'BEHIND', viewerCanUpdateBranch: false }, { behindBy: 3 })), ['3 commits behind main → github']);
  assert.deepEqual([card(pull({}, { behindBy: 3 })).kind, card(pull({}, { behindBy: 3 })).links], ['able', ['update', 'draft', 'close']], 'behind alone does not block');

  const conflicts = card(pull({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }));
  assert.deepEqual([conflicts.kind, conflicts.headline, conflicts.colour, conflicts.primary, conflicts.links], ['conflicts', 'Conflicts with main', 'red', null, ['draft', 'conflicts', 'close']]);
  const draft = card(pull({ isDraft: true }));
  assert.deepEqual([draft.kind, draft.headline, draft.sentence, draft.primary, draft.links], ['draft', 'Draft', 'Not ready for review yet.', null, ['ready', 'close']]);

  // Merged: by whom, when, as which commit; "Delete branch" only for a branch of this repo that GitHub does not delete itself.
  const mergedFields = { state: 'MERGED', mergedBy: who('bo-made-up'), mergedAt: at(5), mergeCommit: { abbreviatedOid: 'abc1234', parents: { totalCount: 1 } } };
  const merged = card(pull(mergedFields));
  assert.deepEqual([merged.kind, merged.headline, merged.sentence, merged.colour, merged.primary, merged.links], ['merged', 'Merged', 'By bo-made-up at 09:05, as abc1234', 'purple', null, ['delete-branch']]);
  assert.deepEqual(card(pull({ ...mergedFields, isCrossRepository: true })).links, [], 'a fork');
  assert.deepEqual(card(pull({ ...mergedFields, repository: { nameWithOwner: 'made-up/repo', deleteBranchOnMerge: true } })).links, [], 'GitHub deletes it on a merge');
  assert.deepEqual(card(pull({ ...mergedFields, headRef: null })).links, [], 'the branch is gone');
  const closed = card(pull({ state: 'CLOSED', closedAt: at(6), timelineItems: list([{ __typename: 'ClosedEvent', createdAt: at(6), actor: who('bo-made-up') }]) }));
  assert.deepEqual([closed.kind, closed.headline, closed.sentence, closed.links], ['closed', 'Closed', 'By bo-made-up at 09:06, not merged', ['reopen']]);
  assert.deepEqual(card(pull({ state: 'CLOSED', viewerCanReopen: false })).links, []);
});

test('who may do what comes from GitHub: no "Merge" without the right to push or an allowed method, no merge commit on a straight history, and an answer stored before these fields offers no action', () => {
  assert.equal(card(pull({ repository: { nameWithOwner: 'made-up/repo', viewerPermission: 'READ', squashMergeAllowed: true } })).primary, null);
  assert.equal(card(pull({ repository: { nameWithOwner: 'made-up/repo', viewerPermission: 'WRITE' } })).primary, null, 'no method allowed');
  assert.deepEqual(pull({ baseRef: { refUpdateRule: { requiresLinearHistory: true } } }).methods, ['SQUASH']);
  assert.deepEqual(pull().may, { merge: true, mergeAsAdmin: false, update: true, close: true, reopen: true, updateBranch: true, deleteBranch: true });
  const old = pull();
  const { may, methods, ...rest } = old; // eslint-disable-line @typescript-eslint/no-unused-vars
  const stored = card(rest as PullRequestView);
  assert.deepEqual([stored.kind, stored.primary, stored.links], ['ready', null, []]);
});

test('the three meters: the checks by state, the threads that are not resolved of all, and the approvals of those asked or needed (a bot gives no verdict); striped when nobody approved', () => {
  const one = pull({
    last: { nodes: [{ commit: { statusCheckRollup: { contexts: list([check('a', 'FAILURE'), check('b', null), check('c', 'SKIPPED'), check('d', 'SUCCESS'), check('e', 'SUCCESS')]) } } }] },
    reviewThreads: list([thread('t1', false), thread('t2', true), thread('t3', false)]),
    latestReviews: { nodes: [{ author: who('bo-made-up'), state: 'APPROVED' }, { author: who('copilot-pull-request-reviewer', 'Bot'), state: 'COMMENTED' }] },
    reviewRequests: { nodes: [{ requestedReviewer: who('cy-made-up') }] }, baseRef: { refUpdateRule: { requiredApprovingReviewCount: 3 } },
  });
  const { checks, comments, approvals } = card(one).meters;
  assert.deepEqual([checks.text, checks.parts.map((part: { count: number; look: string }) => `${part.count} ${part.look}`)], ['1 failed · 1 running · 1 skipped · 2 passed', ['1 bad', '1 wait', '1 quiet', '2 ok']]);
  assert.deepEqual([comments.text, comments.go], ['2 of 3 unresolved', 'comments']);
  assert.deepEqual([approvals.text, approvals.go, approvals.none], ['1 of 3 approved', 'review', false]);
  const none = card(pull({ latestReviews: { nodes: [] }, reviewDecision: 'REVIEW_REQUIRED', last: { nodes: [] } })).meters;
  assert.deepEqual([none.checks.text, none.comments.text, none.approvals.text, none.approvals.none], ['No checks', 'No threads on code', '0 of 1 approved', true]);
  assert.equal(card(pull({ latestReviews: { nodes: [] }, reviewDecision: '' })).meters.approvals.text, 'No review asked');
});

test('the merge step starts with the method he used last, else GitHub\'s for him, and with the commit title and message that GitHub fills; an action changes the pull request at once in the looks of its states', () => {
  const one = pull({ squashTitle: 'Made-up change (#7)', squashBody: '* one\n* two' });
  assert.equal(MergeCard.firstMethod(one, 'MERGE'), 'MERGE');
  assert.equal(MergeCard.firstMethod(one, 'REBASE'), 'SQUASH', 'not allowed: GitHub\'s for him');
  assert.equal(MergeCard.firstMethod({ ...one, defaultMethod: undefined }, undefined), 'MERGE', 'else the first allowed');
  assert.deepEqual(MergeCard.commitText(one, 'SQUASH'), { title: 'Made-up change (#7)', body: '* one\n* two' });
  assert.deepEqual(MergeCard.commitText(one, 'MERGE'), { title: 'Merge pull request #7 from made-up/feature', body: 'Made-up change' }, 'as GitHub writes it when it gave none');
  assert.equal(MergeCard.commitText(one, 'REBASE'), null);

  const me = { login: 'you', avatar: '', bot: false };
  for (const [state, look] of Object.entries(MergeCard.LOOKS)) assert.deepEqual(look, STATE_LOOKS[state as keyof typeof STATE_LOOKS], state);
  const closed = { ...one, ...MergeCard.after(one, 'close', me, at(9)) };
  assert.deepEqual([card(closed).kind, card(closed).sentence, closed.open, closed.merge.sentence], ['closed', 'By you at 09:09, not merged', false, 'Closed, not merged']);
  const reopened = { ...closed, ...MergeCard.after(closed, 'reopen', me, at(10)) };
  assert.deepEqual([card(reopened).kind, reopened.open, reopened.look], ['unknown', true, STATE_LOOKS['review needed']], 'GitHub works it out again');
  const drafted = { ...one, ...MergeCard.after(one, 'draft', me, at(9)) };
  assert.deepEqual([card(drafted).kind, drafted.state], ['draft', 'draft']);
  const back = { ...drafted, ...MergeCard.after(drafted, 'ready', me, at(10)) };
  assert.deepEqual([card(back).kind, back.state, back.draft], ['ready', 'review needed', false]);
  assert.equal(card({ ...one, ...MergeCard.after(one, 'update', me, at(9)) }).kind, 'unknown');
  const merged = { ...one, ...MergeCard.after(one, 'merged', me, at(9), { commit: '9c4e2a1', method: 'SQUASH' }) };
  assert.deepEqual([card(merged).kind, card(merged).sentence, merged.merge.sentence, card(merged).links], ['merged', 'By you at 09:09, as 9c4e2a1', 'Merged by you with a squash', ['delete-branch']]);
  assert.deepEqual(card({ ...merged, ...MergeCard.after(merged, 'delete-branch', me, at(10)) }).links, []);
});
