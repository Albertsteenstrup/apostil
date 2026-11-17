// Tests for reading one pull request: the pure function on made-up JSON, the cleaning of HTML, each failure with a stand-in for gh,
// and the time that the owner last looked. No test calls GitHub. Every name here is made up.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cleanHtml } from './clean-html';
import { LIMITS, nextQuery, parsePullRef, pullRequestFrom, readPullRequest, type GhResult, type PullItem, type RawList } from './read-pull-request';
import { Store } from './store';
import { tempFolder } from './test-repo';

const who = (login: string, bot = false) => ({ login, avatarUrl: `https://avatars.githubusercontent.com/u/1?v=4&${login}`, __typename: bot ? 'Bot' : 'User' });
const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 9, minute)).toISOString();
let ids = 0;
const comment = (minute: number, author = who('ada-made-up'), more: object = {}) =>
  ({ __typename: 'IssueComment', id: `c${++ids}`, url: 'https://github.com/made-up/repo/pull/1', author, createdAt: at(minute), lastEditedAt: null, bodyHTML: `<p>comment at ${minute}</p>`, isMinimized: false, minimizedReason: null, reactionGroups: [], ...more });
const commit = (minute: number, hash: string) =>
  ({ __typename: 'PullRequestCommit', commit: { oid: hash, abbreviatedOid: hash, messageHeadline: `commit ${hash}`, committedDate: at(minute), author: { name: 'Ada', user: who('ada-made-up') } } });
const list = (nodes: object[], totalCount = nodes.length, more = false): RawList => ({ totalCount, pageInfo: { hasNextPage: more, endCursor: more ? 'next' : null }, nodes });

/** A made-up pull request in the form of GitHub's answer, with fields to change. */
function rawPull(fields: Record<string, unknown> = {}) {
  return {
    number: 1, title: 'Made-up change', url: 'https://github.com/made-up/repo/pull/1', state: 'OPEN', isDraft: false, createdAt: at(0),
    headRefName: 'feature', baseRefName: 'main', headRefOid: 'h1', baseRefOid: 'b1', author: who('ada-made-up'), commits: { totalCount: 0 },
    changedFiles: 0, additions: 0, deletions: 0, reviewDecision: '', mergeable: 'MERGEABLE', bodyHTML: '', repository: { nameWithOwner: 'made-up/repo' },
    latestReviews: { nodes: [] }, reviewRequests: { nodes: [] }, last: { nodes: [] },
    timelineItems: list([]), reviewThreads: list([]), files: list([]),
    ...fields,
  };
}

const kinds = (items: PullItem[]) => items.map((item) => item.kind);

test('two pages of a list are joined in order, the items stand in time order, and each limit cuts its list and says how much it cut', () => {
  const pull = pullRequestFrom({
    pr: rawPull({ timelineItems: list([comment(1), commit(2, 'aaa')], 4, true), files: list([{ path: 'a.ts', additions: 1, deletions: 0, changeType: 'ADDED' }], 2, true) }),
    more: { timelineItems: [list([commit(3, 'bbb'), comment(4)])], files: [list([{ path: 'b.ts', additions: 0, deletions: 2, changeType: 'DELETED' }])] },
  });
  assert.deepEqual(kinds(pull.items), ['comment', 'commit', 'commit', 'comment']);
  assert.deepEqual(pull.items.filter((item) => item.kind === 'commit').map((item) => item.kind === 'commit' && item.hash), ['aaa', 'bbb']);
  assert.deepEqual(pull.files.map((file) => [file.path, file.status]), [['a.ts', 'added'], ['b.ts', 'removed']]);
  assert.deepEqual(pull.cut, { timeline: 0, threads: 0, threadComments: 0, files: 0, checks: 0 });

  // Each limit cuts its list and says how much it cut.
  {
    const many = (count: number, make: (index: number) => object) => Array.from({ length: count }, (_, index) => make(index));
    const pages = (count: number, make: (index: number) => object) => {
      const nodes = many(count, make);
      return [list(nodes.slice(0, 100), count + 5, true), ...Array.from({ length: Math.ceil(count / 100) - 1 }, (_, page) => list(nodes.slice((page + 1) * 100, (page + 2) * 100)))];
    };
    const [timelineFirst, ...timelineMore] = pages(LIMITS.timeline + 20, (index) => comment(index % 59));
    const [threadsFirst, ...threadsMore] = pages(LIMITS.threads + 3, (index) => ({ id: `t${index}`, isResolved: false, isOutdated: false, path: 'a.ts', line: 1, comments: list([comment(1)], index === 0 ? LIMITS.threadComments + 7 : 1) }));
    const [filesFirst, ...filesMore] = pages(LIMITS.files + 1, (index) => ({ path: `f${index}.ts`, additions: 1, deletions: 0, changeType: 'MODIFIED' }));
    const checks = { totalCount: LIMITS.checks + 4, nodes: many(LIMITS.checks, (index) => ({ __typename: 'StatusContext', context: `c${index}`, state: 'SUCCESS', createdAt: at(1) })) };
    const pull = pullRequestFrom({
      pr: rawPull({ timelineItems: timelineFirst, reviewThreads: threadsFirst, files: filesFirst, last: { nodes: [{ commit: { statusCheckRollup: { contexts: checks } } }] } }),
      more: { timelineItems: timelineMore, reviewThreads: threadsMore, files: filesMore },
    });
    assert.equal(pull.items.filter((item) => item.kind === 'comment').length, LIMITS.timeline);
    assert.equal(pull.files.length, LIMITS.files);
    assert.deepEqual(pull.cut, { timeline: 25, threads: 8, threadComments: LIMITS.threadComments + 6, files: 6, checks: 4 });
  }
});

test('a review holds its threads, with who resolved one and the code lines of an outdated one, and what a write needs is read: the node id, locked, his own pull request, his review not sent yet, and what he may do with each thread', () => {
  const review = { ...comment(5, who('bo-made-up')), __typename: 'PullRequestReview', id: 'r1', state: 'CHANGES_REQUESTED', submittedAt: at(6) };
  const threadComment = (minute: number, reviewId: string, more: object = {}) => ({ ...comment(minute), pullRequestReview: { id: reviewId }, ...more });
  const threads = [
    { id: 't1', isResolved: true, isOutdated: false, path: 'src/a.ts', line: 12, startLine: 10, resolvedBy: who('ada-made-up'), comments: list([threadComment(5, 'r1', { diffHunk: '@@ -1,2 +1,3 @@\n one\n+two\n three' })]) },
    { id: 't2', isResolved: false, isOutdated: true, path: 'src/b.ts', line: null, originalLine: 7, resolvedBy: null, comments: list([threadComment(5, 'r1'), threadComment(30, 'r-later')]) },
  ];
  const pull = pullRequestFrom({ pr: rawPull({ timelineItems: list([review]), reviewThreads: list(threads) }) });
  const first = pull.items[0];
  assert.ok(first.kind === 'review');
  assert.equal(first.state, 'changes requested');
  assert.equal(first.at, at(6));
  assert.deepEqual(first.threads.map((thread) => [thread.id, thread.resolved, thread.resolvedBy?.login, thread.outdated, thread.lines]),
    [['t1', true, 'ada-made-up', false, [10, 12]], ['t2', false, undefined, true, [7, 7]]]);
  assert.deepEqual(first.threads[0].code, [{ sign: ' ', text: 'one', line: 1 }, { sign: '+', text: 'two', line: 2 }, { sign: ' ', text: 'three', line: 3 }]);
  // The later answer of t2 came in a review that GitHub leaves out of the timeline: it stands at its own time too.
  assert.deepEqual(kinds(pull.items), ['review', 'reply']);

  // What a write needs is read: the node id, locked, his own pull request, his review not sent yet, and what he may do with each thread.
  {
    const threads = [
      { id: 't1', isResolved: false, isOutdated: false, path: 'a.ts', line: 3, viewerCanReply: true, viewerCanResolve: true, viewerCanUnresolve: false, comments: list([comment(1)]) },
      { id: 't2', isResolved: true, isOutdated: false, path: 'a.ts', line: 9, viewerCanReply: false, viewerCanResolve: false, viewerCanUnresolve: true, comments: list([comment(2)]) },
    ];
    const pending = { nodes: [{ id: 'PRR_someone_else', viewerDidAuthor: false, comments: { totalCount: 5 } }, { id: 'PRR_mine', viewerDidAuthor: true, comments: { totalCount: 2 } }] };
    const pull = pullRequestFrom({ pr: rawPull({ id: 'PR_made_up_1', locked: true, viewerDidAuthor: true, pending, reviewThreads: list(threads) }) });
    assert.deepEqual([pull.id, pull.locked, pull.mine, pull.pending], ['PR_made_up_1', true, true, { id: 'PRR_mine', comments: 2 }]);
    const read = pull.items.flatMap((item) => (item.kind === 'thread' ? [item.thread] : []));
    assert.deepEqual(read.map((one) => [one.id, one.canReply, one.canResolve, one.canUnresolve]), [['t1', true, true, false], ['t2', false, false, true]]);
    // An answer with none of these fields still reads, and allows no write.
    const old = pullRequestFrom({ pr: rawPull({ reviewThreads: list([{ id: 't3', isResolved: false, isOutdated: false, path: 'a.ts', line: 1, comments: list([comment(3)]) }]) }) });
    assert.deepEqual([old.id, old.locked, old.mine, old.pending], ['', false, false, undefined]);
    const thread = old.items.find((item) => item.kind === 'thread');
    assert.ok(thread?.kind === 'thread' && !thread.thread.canReply && !thread.thread.canResolve && !thread.thread.canUnresolve);
  }
});

test('the kinds of event that real projects use are quiet rows; a bot, a hidden comment, an edited one and reactions; an unknown kind of event is left out and counted', () => {
  const ada = who('ada-made-up');
  const pull = pullRequestFrom({ pr: rawPull({ timelineItems: list([
    { __typename: 'AutoSquashEnabledEvent', createdAt: at(1), actor: ada },
    { __typename: 'LockedEvent', createdAt: at(2), actor: ada, lockReason: 'TOO_HEATED' },
    { __typename: 'BaseRefForcePushedEvent', createdAt: at(3), actor: ada },
    { __typename: 'AutomaticBaseChangeSucceededEvent', createdAt: at(4), oldBase: 'feature-below', newBase: 'main' },
    // The events of a project board come with no field at all: they are known, not shown and not counted.
    { __typename: 'AddedToProjectV2Event' },
    { __typename: 'ProjectV2ItemStatusChangedEvent' },
    { __typename: 'RemovedFromProjectV2Event' },
  ]) }) });
  assert.deepEqual(pull.items.map((item) => item.kind === 'event' && item.text), [
    'turned on auto-merge with a squash', 'locked the conversation as too heated', 'force-pushed the base branch',
    'moved the base from feature-below to main automatically',
  ]);
  assert.equal(pull.notShown, 0);

  // A bot, a hidden comment, an edited one, reactions; an unknown kind of event is left out and counted.
  {
    const pull = pullRequestFrom({ pr: rawPull({ timelineItems: list([
      comment(1, who('helper-made-up[bot]', true)),
      comment(2, undefined, { isMinimized: true, minimizedReason: 'OFF_TOPIC', lastEditedAt: at(3), reactionGroups: [{ content: 'THUMBS_UP', reactors: { totalCount: 2 } }, { content: 'EYES', reactors: { totalCount: 0 } }] }),
      { __typename: 'AnotherNewKind', createdAt: at(4) },
      { __typename: 'SubscribedEvent', createdAt: at(4) }, // GitHub does not show it either: not counted
      { __typename: 'SomethingNew', createdAt: at(5) },
      { __typename: 'RenamedTitleEvent', createdAt: at(6), actor: who('ada-made-up'), previousTitle: 'Old', currentTitle: 'New' },
    ]) }) });
    const [bot, hidden, renamed] = pull.items;
    assert.ok(bot.kind === 'comment' && hidden.kind === 'comment' && renamed.kind === 'event');
    assert.deepEqual(bot.author, { login: 'helper-made-up', avatar: who('x').avatarUrl.replace('&x', '&helper-made-up[bot]'), bot: true });
    assert.equal(hidden.hidden, 'off topic');
    assert.equal(hidden.edited, true);
    assert.deepEqual(hidden.reactions, [{ emoji: '👍', count: 2 }]);
    assert.equal(renamed.text, 'changed the title from “Old” to “New”');
    assert.equal(pull.notShown, 2);
  }
});

test('the states of a pull request: one with nothing, merged, closed and a draft; failed checks counted with their names, a check that ran twice counted once; an answer that is not a pull request throws', () => {
  const empty = pullRequestFrom({ pr: rawPull() });
  assert.equal(empty.html, '');
  assert.deepEqual(empty.items, []);
  assert.deepEqual(empty.checks, { passed: 0, failed: 0, pending: 0, failedNames: [], list: [] });
  assert.equal(empty.state, 'review needed'); // nobody reviewed it and no check ran: it waits for a review
  assert.equal(empty.look.icon, 'git-pull-request');
  const merged = pullRequestFrom({ pr: rawPull({ state: 'MERGED', timelineItems: list([{ __typename: 'MergedEvent', createdAt: at(9), actor: who('bo-made-up'), commit: { abbreviatedOid: 'abc1234' }, mergeRefName: 'main' }]) }) });
  assert.deepEqual([merged.state, merged.open, merged.look.colour], ['merged', false, 'purple']);
  assert.ok(merged.items[0].kind === 'event' && merged.items[0].text === 'merged abc1234 into main');
  assert.equal(pullRequestFrom({ pr: rawPull({ state: 'CLOSED' }) }).state, 'closed');
  const draft = pullRequestFrom({ pr: rawPull({ isDraft: true }) });
  assert.deepEqual([draft.state, draft.look.icon], ['draft', 'git-pull-request-draft']);

  // The failed checks are counted with their names, and a check that ran twice counts once.
  const run = (name: string, conclusion: string, minute: number) => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion, startedAt: at(minute), checkSuite: { workflowRun: { workflow: { name: 'ci' } } } });
  const contexts = { totalCount: 4, nodes: [run('lint', 'FAILURE', 1), run('lint', 'SUCCESS', 2), run('tests', 'FAILURE', 1), { __typename: 'StatusContext', context: 'deploy', state: 'PENDING', createdAt: at(1) }] };
  const pull = pullRequestFrom({ pr: rawPull({ last: { nodes: [{ commit: { statusCheckRollup: { contexts } } }] } }) });
  assert.deepEqual({ ...pull.checks, list: undefined }, { passed: 1, failed: 1, pending: 1, failedNames: ['ci / tests'], list: undefined });
  assert.deepEqual(pull.checks.list.map((check) => [check.name, check.state]), [['lint', 'passed'], ['tests', 'failed'], ['deploy', 'waiting']]);
  assert.equal(pull.state, 'checks failing');

  // An answer that is not a pull request throws.
  assert.throws(() => pullRequestFrom({ pr: { number: 'x' } }));
  assert.throws(() => pullRequestFrom({ pr: rawPull({ timelineItems: undefined }) }));
});

// ----- the cleaning of HTML -----

test('cleaning HTML takes out a script, an onerror attribute, a javascript: link, a form, a style and an iframe, and keeps a note box of GitHub, a table, a task list, a code block, a picture from GitHub, a link and details', () => {
  const dirty = '<p>hi<script>alert(1)</script></p><img src="https://user-images.githubusercontent.com/1/a.png" onerror="alert(2)">'
    + '<a href="javascript:alert(3)">x</a><a href="&#106;avascript:alert(4)">y</a><a href=" JaVaScRiPt:alert(5)">z</a>'
    + '<form action="https://evil.example"><input name="q"><button>Go</button></form><style>body{display:none}</style>'
    + '<iframe src="https://evil.example"></iframe><div onclick="alert(6)" style="color:red">d</div><svg><script>alert(7)</script></svg>'
    + '<img src="https://evil.example/a.png">';
  const clean = cleanHtml(dirty);
  for (const bad of ['<script', 'alert(', 'onerror', 'onclick', 'javascript', '<form', '<button', '<style', 'display:none', '<iframe', 'style=', '<svg', 'evil.example', 'name=']) {
    assert.ok(!clean.toLowerCase().includes(bad.toLowerCase()), `${bad} is still in ${clean}`);
  }
  assert.ok(clean.includes('<p>hi</p>'));
  assert.equal(cleanHtml('<p/onmouseover=alert(8)>p'), '&lt;p/onmouseover=alert(8)&gt;p'); // a broken tag stays as text
  assert.ok(clean.includes('<img src="https://user-images.githubusercontent.com/1/a.png">'));

  // Cleaning HTML keeps the kind of a note box of GitHub, and no class name.
  const html = cleanHtml('<div class="markdown-alert markdown-alert-warning" dir="auto"><p class="markdown-alert-title" dir="auto"><svg class="octicon"><path d="M0 0"></path></svg>Warning</p><p dir="auto">This drops a table.</p></div><div class="markdown-alert-evil" onclick="x()">no box</div>');
  assert.equal(html, '<div data-alert="warning"><p data-alert-title>Warning</p><p>This drops a table.</p></div><div>no box</div>');

  // Cleaning HTML keeps a table, a task list, a code block, a picture from GitHub, a link and details.
  const kept = '<table><thead><tr><th align="left">a</th></tr></thead><tbody><tr><td colspan="2">1 &amp; 2</td></tr></tbody></table>'
    + '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" checked disabled> done</li></ul>'
    + '<pre><code>if (a &lt; b) { }</code></pre>'
    + '<img src="https://avatars.githubusercontent.com/u/1" alt="me" width="20">'
    + '<a href="https://github.com/made-up/repo/pull/2" title="two">#2</a>'
    + '<details><summary>More</summary><p>inside</p></details>';
  assert.equal(cleanHtml(kept), '<table><thead><tr><th align="left">a</th></tr></thead><tbody><tr><td colspan="2">1 &amp; 2</td></tr></tbody></table>'
    + '<ul><li><input type="checkbox" disabled checked> done</li></ul>'
    + '<pre><code>if (a &lt; b) { }</code></pre>'
    + '<img src="https://avatars.githubusercontent.com/u/1" alt="me" width="20">'
    + '<a data-link="https://github.com/made-up/repo/pull/2" title="two">#2</a>'
    + '<details><summary>More</summary><p>inside</p></details>');
  assert.equal(cleanHtml('a < b & c > d'), 'a &lt; b &amp; c &gt; d');
});

// ----- the gh half, with a stand-in -----

/** A stand-in for gh that answers from a list, in order, and keeps the arguments. */
function standIn(...answers: GhResult[]) {
  const calls: string[][] = [];
  return { calls, run: async (args: string[]) => { calls.push(args); return answers.shift() ?? { out: '', err: 'no more answers' }; } };
}
const data = (pr: object) => ({ out: JSON.stringify({ data: { repository: { pullRequest: pr } } }), err: '' });
const LINK = 'https://github.com/made-up/repo/pull/1';

test('readPullRequest reads every page of a list with the next query and the cursor; a number names a pull request of the GitHub remote of the folder, a link names any', async () => {
  // The timeline is read from its end: the first page holds the newest item, the next one the older.
  const newest = { totalCount: 2, filteredCount: 2, pageInfo: { hasPreviousPage: true, startCursor: 'next' }, nodes: [comment(2)] };
  const gh = standIn(data(rawPull({ timelineItems: newest })), data({ timelineItems: { totalCount: 2, pageInfo: { hasPreviousPage: false }, nodes: [comment(1)] } }));
  const result = await readPullRequest('/', LINK, gh.run);
  assert.ok('pull' in result);
  assert.equal(result.pull.items.length, 2);
  assert.deepEqual(gh.calls[0].slice(0, 2), ['api', 'graphql']);
  assert.ok(gh.calls.every((args) => args[0] === 'api' && (args[1] === 'graphql' || args[1] === 'rate_limit')), 'only reads');
  assert.ok(gh.calls[1].includes(`query=${nextQuery('timelineItems')}`) && gh.calls[1].includes('after=next'));
  assert.ok(gh.calls[0].includes('owner=made-up') && gh.calls[0].includes('name=repo') && gh.calls[0].includes('number=1'));

  // A number names a pull request of the GitHub remote of the folder; a link names any.
  {
    assert.deepEqual(parsePullRef('#12', 'made-up/repo'), { owner: 'made-up', name: 'repo', number: 12 });
    assert.deepEqual(parsePullRef('https://github.com/other-made-up/thing/pull/7/files'), { owner: 'other-made-up', name: 'thing', number: 7 });
    assert.deepEqual(parsePullRef('other-made-up/thing#7'), { owner: 'other-made-up', name: 'thing', number: 7 });
    assert.equal(parsePullRef('12'), undefined);
    const folder = tempFolder();
    execFileSync('git', ['init', '-q'], { cwd: folder });
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:made-up/repo.git'], { cwd: folder });
    const result = await readPullRequest(folder, '3', standIn({ out: '', err: '', missing: true }).run);
    assert.ok('problem' in result && result.problem === 'no-gh'); // the number was understood, so gh was asked
    rmSync(folder, { recursive: true, force: true });
  }
});

test('each failure gives one plain line', async () => {
  const problem = async (ref: string, ...answers: GhResult[]) => {
    const result = await readPullRequest('/', ref, standIn(...answers).run);
    return 'problem' in result ? [result.problem, result.text] : ['none', ''];
  };
  assert.equal((await problem(LINK, { out: '', err: '', missing: true }))[0], 'no-gh');
  assert.equal((await problem(LINK, { out: '', err: 'To get started with GitHub CLI, please run:  gh auth login' }))[0], 'not-signed-in');
  assert.equal((await problem(LINK, { out: '', err: 'error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com' }))[0], 'no-network');
  assert.equal((await problem(LINK, { out: '', err: '', timedOut: true }))[0], 'no-network');
  assert.equal((await problem(LINK, { out: JSON.stringify({ data: { repository: { pullRequest: null } }, errors: [{ message: 'Could not resolve to a PullRequest with the number of 1.' }] }), err: '' }))[0], 'no-such-pull');
  assert.equal((await problem('12'))[0], 'no-github-remote'); // the folder "/" has no remote
  assert.equal((await problem('not a pull request'))[0], 'no-such-pull');
  const reset = Math.floor(Date.UTC(2026, 10, 1, 14, 5) / 1000);
  const limited = await problem(LINK, { out: '', err: 'GraphQL: API rate limit exceeded for user ID 1.' }, { out: JSON.stringify({ resources: { graphql: { reset } } }), err: '' });
  assert.equal(limited[0], 'rate-limit');
  assert.match(limited[1], /^GitHub's rate limit is used up\. It ends at .+\.$/);
  assert.equal((await problem(LINK, { out: '<html>oops</html>', err: '' }))[0], 'bad-answer');
  assert.equal((await problem(LINK, data({ number: 1, title: 'x' })))[0], 'bad-answer');
});

test('the store keeps when the owner last looked at each pull request', () => {
  const folder = tempFolder();
  const store = new Store(folder);
  assert.equal(store.lastLooked('made-up/repo', 1), undefined);
  store.setLooked('made-up/repo', 1, at(1));
  store.setLooked('made-up/repo', 1, at(2));
  store.setLooked('made-up/repo', 2, at(3));
  assert.equal(store.lastLooked('made-up/repo', 1), at(2));
  assert.equal(store.lastLooked('made-up/repo', 2), at(3));
  store.close();
  rmSync(folder, { recursive: true, force: true });
});
