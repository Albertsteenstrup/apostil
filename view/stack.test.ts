// Tests for stacks of pull requests: the stack read with a pull request, the merge sentence that knows it, the places in the list of the
// side bar, and what the diffs of a stacked branch are compared with. Made-up JSON and a small real repo; no test calls GitHub.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseBranchOf, baseOf, git } from '../shared/git';
import { mergeSentence, type MergeInput } from '../shared/pull-request-facts';
import { stackPlacesFromJson, withStacks, type PullRequest } from '../shared/pull-requests';
import { LIMITS, nextQuery, pullRequestFrom, readPullRequest, type GhResult } from '../shared/read-pull-request';
import { makeTestRepo } from '../shared/test-repo';
import { pullOnlyPage } from '../shared/page-data';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const States = require('../../view/media/states.js');

const list = (nodes: object[], totalCount = nodes.length, more = false) => ({ totalCount, pageInfo: { hasNextPage: more, endCursor: more ? 'next' : null }, nodes });

/** One made-up pull request of a stack, in short. `rollup` is the one state of its checks. */
const entry = (position: number, number: number, more: Record<string, unknown> = {}, rollup = 'SUCCESS') => ({ position, pullRequest: {
  number, title: `Made-up step ${number}`, url: `https://github.com/made-up/repo/pull/${number}`, state: 'OPEN', isDraft: false, reviewDecision: 'REVIEW_REQUIRED',
  mergeable: 'MERGEABLE', commits: { nodes: [{ commit: { statusCheckRollup: { state: rollup } } }] }, ...more,
} });

/** A made-up stack of three: #2 onto main, #14 on it, #25 on top. */
const threeEntries = () => [entry(1, 2, {}, 'FAILURE'), entry(2, 14), entry(3, 25, { isDraft: true })];

/** A made-up pull request in the form of GitHub's answer; with a stack when `entries` are given. */
function rawPull(number: number, entries?: object[], fields: Record<string, unknown> = {}, more = false) {
  return {
    number, title: `Made-up step ${number}`, url: `https://github.com/made-up/repo/pull/${number}`, state: 'OPEN', isDraft: false, createdAt: '2026-11-01T09:00:00Z',
    headRefName: `step-${number}`, baseRefName: 'main', author: { login: 'ada-made-up', avatarUrl: '', __typename: 'User' }, commits: { totalCount: 0 },
    reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', bodyHTML: '', repository: { nameWithOwner: 'made-up/repo' },
    latestReviews: { nodes: [] }, reviewRequests: { nodes: [] }, last: { nodes: [] }, timelineItems: list([]), reviewThreads: list([]), files: list([]),
    ...(entries ? { stack: { number: 26, size: fields.size ?? entries.length, baseRefName: 'main', entries: list(entries, Number(fields.size ?? entries.length), more) },
      stackEntry: { position: (entries as { pullRequest: { number: number }; position: number }[]).find((one) => one.pullRequest.number === number)?.position } } : {}),
    ...fields,
  };
}

test('a stack read with a pull request: none in no stack, the place and entries of the bottom, middle and top of a stack of three with what each waits for, a merged lowest one, the merge sentence of a stack, and joining a stack as a quiet row', () => {
  const pull = pullRequestFrom({ pr: rawPull(7) });
  assert.equal(pull.stack, undefined);
  assert.equal(pull.merge.sentence, 'Blocked: An approving review is needed');

  // The bottom, the middle and the top of a stack of three: the place, the entries top first with their states, and what each waits for.
  const [bottom, middle, top] = [2, 14, 25].map((number) => pullRequestFrom({ pr: rawPull(number, threeEntries()) }));
  assert.deepEqual([bottom.stack!.position, middle.stack!.position, top.stack!.position], [1, 2, 3]);
  assert.deepEqual([middle.stack!.number, middle.stack!.size, middle.stack!.base], [26, 3, 'main']);
  assert.deepEqual(middle.stack!.entries.map((one) => [one.position, one.number, one.state, one.draft]),
    [[3, 25, 'draft', true], [2, 14, 'review needed', false], [1, 2, 'checks failing', false]]);
  assert.equal(middle.stack!.entries[1].look.icon, 'git-pull-request');
  assert.equal(bottom.merge.sentence, 'Blocked: An approving review is needed'); // the lowest says what it says alone
  assert.equal(middle.merge.sentence, 'Waits for #2 below it in the stack · An approving review is needed');
  assert.equal(top.merge.sentence, 'Waits for #14 below it in the stack · An approving review is needed');
  assert.deepEqual(middle.merge.parts.map((part) => part.about), ['stack', 'review']);

  // A stack whose lowest pull request is merged: the next one is the lowest open one and waits for nothing.
  {
    const entries = [entry(1, 2, { state: 'MERGED' }), entry(2, 14), entry(3, 25)];
    const middle = pullRequestFrom({ pr: rawPull(14, entries) });
    assert.equal(middle.stack!.entries[2].state, 'merged');
    assert.equal(middle.merge.sentence, 'Blocked: An approving review is needed');
    assert.equal(pullRequestFrom({ pr: rawPull(25, entries) }).merge.sentence, 'Waits for #14 below it in the stack · An approving review is needed');
  }

  // The merge sentence of a stack: it waits for the one below; the lowest says the stack is ready when every open one is ready.
  const base: MergeInput = { state: 'OPEN', draft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED', checks: { passed: 3, failed: 0, pending: 0 }, base: 'main', changesBy: [], approvals: 1 };
  const say = (stack: MergeInput['stack'], change: Partial<MergeInput> = {}) => mergeSentence({ ...base, ...change, stack }).sentence;
  assert.equal(say({ below: 2, open: 3, allReady: true }), 'Waits for #2 below it in the stack');
  assert.equal(say({ below: 2, open: 3, allReady: false }, { checks: { passed: 1, failed: 1, pending: 0 } }), 'Waits for #2 below it in the stack · 1 check failed');
  assert.equal(say({ open: 3, allReady: true }), 'The stack of 3 is ready to merge');
  assert.equal(say({ open: 3, allReady: false }), 'Ready to merge');
  assert.equal(say({ open: 1, allReady: true }), 'Ready to merge'); // the others are merged: only this one is left
  assert.equal(say({ open: 3, allReady: true }, { checks: { passed: 1, failed: 1, pending: 0 } }), 'Blocked: 1 check failed');
  // From the raw JSON: every pull request of the stack approved with passing checks.
  const ready = [1, 2, 3].map((position) => entry(position, position, { reviewDecision: 'APPROVED' }));
  const lowest = pullRequestFrom({ pr: rawPull(1, ready, { reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN', latestReviews: { nodes: [{ author: { login: 'bo-made-up' }, state: 'APPROVED' }] } }) });
  assert.equal(lowest.merge.sentence, 'The stack of 3 is ready to merge');

  // Joining a stack is a quiet row of the timeline, not "not shown".
  {
    const pull = pullRequestFrom({ pr: rawPull(14, threeEntries(), { timelineItems: list([
      { __typename: 'AddedToStackEvent', createdAt: '2026-11-02T09:00:00Z', actor: { login: 'ada-made-up', __typename: 'User' }, stackNumber: 26 },
      { __typename: 'RemovedFromStackEvent', createdAt: '2026-11-03T09:00:00Z', actor: { login: 'ada-made-up', __typename: 'User' }, stackNumber: 26 },
    ]) }) });
    assert.deepEqual(pull.items.map((item) => item.kind === 'event' && item.text), ['added it to stack 26', 'took it out of stack 26']);
    assert.equal(pull.notShown, 0);
  }
});

test('a stack of 12 needs a second page of entries; a stack past the limit says how many it cut', async () => {
  const twelve = Array.from({ length: 12 }, (_, index) => entry(index + 1, 100 + index));
  const pull = pullRequestFrom({ pr: rawPull(105, twelve.slice(0, 10), { size: 12 }, true), more: { stackEntries: [list(twelve.slice(10))] } });
  assert.equal(pull.stack!.entries.length, 12);
  assert.equal(pull.stack!.entries[0].number, 111);
  assert.equal(pull.stack!.position, 6);
  assert.equal(pull.stack!.cut, 0);
  assert.equal(pull.merge.parts[0].text, 'Waits for #104 below it in the stack');
  assert.match(nextQuery('stackEntries'), /stack \{ entries\(first: 100, after: \$after\)/);
  // gh is asked for one more page with the cursor of the first.
  const asked: string[][] = [];
  const run = async (args: string[]): Promise<GhResult> => {
    asked.push(args);
    const query = args.find((arg) => arg.startsWith('query='))!;
    if (query.includes('compare(')) return { out: '{"data":{"repository":{"ref":{"compare":{"behindBy":0}}}}}', err: '' };
    const pr = query.includes('$after') ? { stack: { entries: list(twelve.slice(10)) } } : rawPull(105, twelve.slice(0, 10), { size: 12 }, true);
    return { out: JSON.stringify({ data: { repository: { pullRequest: pr } } }), err: '' };
  };
  const read = await readPullRequest('/', 'https://github.com/made-up/repo/pull/105', run);
  assert.ok('pull' in read);
  assert.equal(read.pull.stack!.entries.length, 12);
  assert.ok(asked.some((args) => args.includes('after=next')));
  const over = Array.from({ length: LIMITS.stack + 3 }, (_, index) => entry(index + 1, 1000 + index));
  assert.equal(pullRequestFrom({ pr: rawPull(1000, over) }).stack!.cut, 3);
});

test('the list of the side bar: the places from the REST list of stacks, the mark, the tooltip and the rows of one stack together; a session shows two rows with an open pull request, folds the others, and keeps merged and closed ones in the history', () => {
  const places = stackPlacesFromJson(JSON.stringify([{ number: 26, pull_requests: [{ number: 2 }, { number: 14 }, { number: 25 }] }, { number: 30, pull_requests: [{ number: 40 }] }]));
  assert.deepEqual(places.get(14), { number: 26, size: 3, position: 2 });
  assert.equal(stackPlacesFromJson('{"message":"Not Found"}').size, 0);
  assert.equal(stackPlacesFromJson('not json').size, 0);
  const pull = (number: number): PullRequest => ({ number, title: 't', url: 'u', state: 'review needed', look: { icon: 'git-pull-request', colour: 'green' }, checks: { passed: 0, failed: 0, pending: 0 } });
  const [fourteen, seven] = withStacks([pull(14), pull(7)], places);
  assert.equal(seven.stack, undefined);
  assert.equal(States.pullTip(fourteen), '#14 · Review needed · 2 of 3 in a stack');
  assert.equal(States.pullTip(seven), '#7 · Review needed');
  assert.equal(States.WORDS.stackMark(fourteen.stack), '2/3');
  assert.equal(States.WORDS.inStack(fourteen.stack, 'main'), '2 of 3 in a stack onto main');
  // Rows of different branches: the rows of stack 26 stand together, the top first, where its first row stood.
  const rows = ['a', 'bottom', 'b', 'top', 'middle'];
  const at: Record<string, object> = { bottom: { number: 26, position: 1 }, middle: { number: 26, position: 2 }, top: { number: 26, position: 3 } };
  assert.deepEqual(States.stackOrder(rows, (row: string) => at[row]), ['a', 'top', 'middle', 'bottom', 'b']);

  // A session shows two rows with an open pull request, folds the others, and keeps merged and closed ones in the history.
  {
    const states: Record<string, string[]> = {
      a: ['review needed'], b: ['checks failing'], c: ['draft'], d: ['merged'], e: ['closed', 'merged'], f: [], g: ['review needed', 'closed'],
    };
    const pullsOf = (row: { branch: string }) => states[row.branch].map((state, index) => ({ number: index, state }));
    const rows = Object.keys(states).map((branch) => ({ branch, open: false }));
    const names = (set: { branch: string }[]) => set.map((row) => row.branch).join('');
    const sets = States.foldRows(rows, pullsOf);
    // a and b are the first two with an open pull request; c and g fold; d and e have only merged and closed ones; f has none and stays.
    assert.deepEqual([names(sets.shown), names(sets.more), names(sets.history)], ['abf', 'cg', 'de']);
    // The row that is open now is never hidden, as a third open one or as a part of the history.
    const third = States.foldRows(rows.map((row) => ({ ...row, open: row.branch === 'c' })), pullsOf);
    assert.deepEqual([names(third.shown), names(third.more), names(third.history)], ['abcf', 'g', 'de']);
    const old = States.foldRows(rows.map((row) => ({ ...row, open: row.branch === 'd' })), pullsOf);
    assert.deepEqual([names(old.shown), names(old.history)], ['abdf', 'e']);
    // Two rows or fewer with an open pull request: nothing folds.
    assert.equal(States.foldRows(rows.slice(0, 2), pullsOf).more.length, 0);
    // Before the pull requests of a row are known, the row is shown.
    assert.equal(States.foldRows(rows, () => []).shown.length, rows.length);

    // Inside one row: the open pull requests first; the merged and closed ones are behind the fold of the row.
    const mixed = [{ number: 12, state: 'checks failing' }, { number: 11, state: 'merged' }, { number: 10, state: 'closed' }];
    assert.deepEqual(States.foldPulls(mixed), { shown: [mixed[0]], more: 2 });
    assert.deepEqual(States.foldPulls(mixed, Infinity), { shown: mixed, more: 0 });
    assert.deepEqual(States.foldPulls(mixed.slice(1)), { shown: mixed.slice(1), more: 0 }); // a row of the history shows what it has
    assert.equal(States.foldPulls([1, 2, 3].map((number) => ({ number, state: 'review needed' }))).more, 1);
    assert.equal(States.WORDS.history(3), 'History · 3');
  }
});

test('a branch on top of another is compared with that branch, and the page of a stacked pull request compares with the branch below', () => {
  const repo = makeTestRepo(); // "feature" on "main"
  try {
    git(repo.folder, 'checkout', '-q', '-b', 'upper', 'feature');
    repo.write('src/upper.py', 'def upper():\n    return 3\n');
    const upperHead = repo.commit('upper');
    const below = git(repo.folder, 'rev-parse', 'feature');
    assert.equal(baseOf(repo.folder, 'upper'), below);
    assert.equal(baseBranchOf(repo.folder, 'upper', below), 'feature'); // the tip of feature is the base
    assert.equal(baseBranchOf(repo.folder, 'feature', repo.base), undefined); // feature is compared with main
    git(repo.folder, 'checkout', '-q', 'feature');
    repo.write('src/later.py', 'x = 1\n');
    repo.commit('feature moves on');
    assert.equal(baseBranchOf(repo.folder, 'upper', below), 'feature'); // feature moved on: Git still says upper was created from it
    // The page of the pull request of "upper" with no stored change: its diffs start at the branch below, not at main.
    git(repo.folder, 'remote', 'add', 'origin', 'https://github.com/made-up/repo.git');
    const view = pullRequestFrom({ pr: rawPull(14, threeEntries(), { headRefName: 'upper', baseRefName: 'feature', headRefOid: upperHead, baseRefOid: below }) });
    const page = pullOnlyPage(repo.folder, view);
    assert.equal(page.base, below);
    assert.deepEqual(page.files.map((file) => file.path), ['src/upper.py']);
  } finally {
    repo.remove();
  }
});

