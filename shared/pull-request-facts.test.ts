// Tests for what comes with a pull request: checks in full, deployments, the merge sentence, the side facts, commits and products,
// and the faults of the first trials. Made-up JSON only; no test calls GitHub. Every name here is made up.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanHtml } from './clean-html';
import { checkList, deploymentsOf, mergeSentence, tasksOf, type MergeInput } from './pull-request-facts';
import { apiAddress, inlinePictures } from './pull-pictures';
import { LIMITS, pullRequestFrom, readPullRequest, type GhResult, type PullItem } from './read-pull-request';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 3, 9, minute)).toISOString();
const who = (login: string, typename = 'User') => ({ login, avatarUrl: '', __typename: typename });
const list = (nodes: object[], totalCount = nodes.length) => ({ totalCount, pageInfo: { hasNextPage: false }, nodes });
const run = (name: string, status: string, conclusion: string | null, more: object = {}) => ({
  __typename: 'CheckRun', name, status, conclusion, startedAt: at(1), completedAt: at(2), detailsUrl: `https://example.com/log/${name}`,
  annotations: { totalCount: 0, nodes: [] }, checkSuite: { app: { name: 'GitHub Actions' }, workflowRun: { url: 'https://example.com/run/1', workflow: { name: 'CI' } } }, ...more,
});
const status = (context: string, state: string) => ({ __typename: 'StatusContext', context, state, description: `${context} says ${state}`, targetUrl: 'https://example.com/status', createdAt: at(1) });

function rawPull(fields: Record<string, unknown> = {}) {
  return {
    number: 7, title: 'Made-up change', url: 'https://github.com/made-up/repo/pull/7', state: 'OPEN', isDraft: false, createdAt: at(0),
    headRefName: 'feature', baseRefName: 'main', author: who('ada-made-up'), commits: { totalCount: 0 }, reviewDecision: '', mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN', bodyHTML: '', repository: { nameWithOwner: 'made-up/repo', isPrivate: false }, latestReviews: { nodes: [] }, reviewRequests: { nodes: [] },
    last: { nodes: [] }, timelineItems: list([]), reviewThreads: list([]), files: list([]), ...fields,
  };
}

test('check runs of every state, with the workflow, the time and the links, beside the statuses of other products; of a job that ran twice only the newest run counts; annotations and every check are read with their limits', () => {
  const checks = checkList([
    run('queued', 'QUEUED', null), run('running', 'IN_PROGRESS', null), run('passed', 'COMPLETED', 'SUCCESS'), run('failed', 'COMPLETED', 'FAILURE'),
    run('cancelled', 'COMPLETED', 'CANCELLED'), run('skipped', 'COMPLETED', 'SKIPPED'), run('neutral', 'COMPLETED', 'NEUTRAL'),
    run('timed out', 'COMPLETED', 'TIMED_OUT'), run('needs action', 'COMPLETED', 'ACTION_REQUIRED'), status('coverage', 'FAILURE'), status('e2e', 'PENDING'),
  ]);
  assert.deepEqual(checks.map((check) => check.state), ['waiting', 'running', 'passed', 'failed', 'cancelled', 'skipped', 'neutral', 'timed out', 'needs action', 'failed', 'waiting']);
  assert.deepEqual([checks[3].group, checks[3].seconds, checks[3].link, checks[3].runLink], ['CI · GitHub Actions', 60, 'https://example.com/log/failed', 'https://example.com/run/1']);
  assert.deepEqual([checks[9].group, checks[9].description, checks[9].link], ['Other checks', 'coverage says FAILURE', 'https://example.com/status']);

  // Of a job that ran twice only the newest run counts; annotations come with their limit.
  {
    const notes = Array.from({ length: 3 }, (_, index) => ({ annotationLevel: index ? 'WARNING' : 'FAILURE', title: `t${index}`, message: `m${index}`, path: 'src/a.ts', location: { start: { line: 10 + index } } }));
    const checks = checkList([
      run('tests', 'COMPLETED', 'FAILURE', { startedAt: at(1) }),
      run('tests', 'COMPLETED', 'SUCCESS', { startedAt: at(5), annotations: { totalCount: LIMITS.annotations + 2, nodes: notes } }),
    ]);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].state, 'passed');
    assert.deepEqual(checks[0].annotations[0], { level: 'failure', title: 't0', message: 'm0', path: 'src/a.ts', line: 10 });
    assert.equal(checks[0].annotations[1].level, 'warning');
    assert.equal(checks[0].cutAnnotations, LIMITS.annotations - 1);
  }

  // Every check is read, page by page, with its limit; a cut list says how many were cut.
  const pageOf = (from: number, count: number, more: boolean) => ({ totalCount: 1200, pageInfo: { hasNextPage: more, endCursor: more ? 'next' : null }, nodes: Array.from({ length: count }, (_, index) => status(`s${from + index}`, 'SUCCESS')) });
  const pull = pullRequestFrom({
    pr: rawPull({ last: { nodes: [{ commit: { statusCheckRollup: { contexts: pageOf(0, 100, true) } } }] } }),
    more: { checks: Array.from({ length: 11 }, (_, page) => pageOf((page + 1) * 100, 100, true)) },
  });
  assert.equal(pull.checks.list.length, LIMITS.checks);
  assert.equal(pull.checks.passed, LIMITS.checks);
  assert.equal(pull.cut.checks, 200);
});

test('a link that a check, a status or a deployment names is kept only when it is an https address: another product writes it, and a page opens the links of the agent apps', () => {
  const checks = checkList([
    run('app link', 'COMPLETED', 'SUCCESS', { detailsUrl: 'claude://claude.ai/new?q=made-up' }),
    { ...status('plain', 'SUCCESS'), targetUrl: 'http://example.com/status' },
    { ...status('other app', 'SUCCESS'), targetUrl: 'codex://made-up' },
    { ...status('no address', 'SUCCESS'), targetUrl: 'not an address' },
    status('web', 'SUCCESS'),
  ]);
  assert.deepEqual(checks.map((check) => check.link), [undefined, undefined, undefined, undefined, 'https://example.com/status']);
  const [deployment] = deploymentsOf([{ environment: 'preview', state: 'ACTIVE', createdAt: at(1), latestStatus: { state: 'SUCCESS', environmentUrl: 'claude://made-up', createdAt: at(1) } }]);
  assert.equal(deployment.link, undefined);
});

test('the side facts: a deployment of each environment, labels, a team as reviewer, Copilot, a milestone, closing issues and tasks', () => {
  const deployments = deploymentsOf([
    { environment: 'preview', state: 'ACTIVE', createdAt: at(1), latestStatus: { state: 'FAILURE', createdAt: at(1) } },
    { environment: 'preview', state: 'ACTIVE', createdAt: at(3), latestStatus: { state: 'SUCCESS', environmentUrl: 'https://example.com/preview', createdAt: at(3) } },
    { environment: 'staging', state: 'FAILURE', createdAt: at(2), latestStatus: { state: 'FAILURE', createdAt: at(2) } },
    { environment: 'production', state: 'IN_PROGRESS', createdAt: at(4), latestStatus: { state: 'IN_PROGRESS', createdAt: at(4) } },
  ]);
  assert.deepEqual(deployments.map((one) => [one.environment, one.state, one.link]), [['preview', 'ready', 'https://example.com/preview'], ['staging', 'failed', undefined], ['production', 'running', undefined]]);

  // Labels, a team as reviewer, Copilot, a milestone, closing issues and tasks.
  const pull = pullRequestFrom({ pr: rawPull({
    labels: { nodes: [{ name: 'backend', color: '1d76db' }, { name: 'odd', color: 'not-a-colour' }] },
    reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'Team', name: 'made-up/core' } }, { requestedReviewer: who('copilot-pull-request-reviewer', 'Bot') }] },
    milestone: { title: 'Version 1', dueOn: '2026-12-01T00:00:00Z', url: 'https://example.com/m/1' },
    closingIssuesReferences: { nodes: [{ number: 24, title: 'A made-up bug', url: 'https://example.com/i/24', state: 'OPEN' }] },
    bodyHTML: '<ul><li><input type="checkbox" checked disabled> one</li><li><input type="checkbox" disabled> two</li><li><input type="checkbox" class="task-list-item-checkbox" checked=""> three</li></ul>',
    assignees: { nodes: [who('ada-made-up')] },
  }) });
  assert.deepEqual(pull.labels, [{ name: 'backend', color: '1d76db' }, { name: 'odd', color: 'cccccc' }]);
  assert.deepEqual(pull.reviewers.map((one) => [one.person.login, one.person.team ?? false, one.person.icon, one.state]), [['made-up/core', true, undefined, 'asked'], ['Copilot', false, 'copilot', 'asked']]);
  assert.deepEqual(pull.milestone, { title: 'Version 1', due: '2026-12-01T00:00:00Z', url: 'https://example.com/m/1' });
  assert.deepEqual(pull.closes, [{ number: 24, title: 'A made-up bug', url: 'https://example.com/i/24', open: true }]);
  assert.deepEqual(pull.tasks, { done: 2, total: 3 });
  assert.deepEqual(tasksOf(''), { done: 0, total: 0 });
  assert.equal(pull.assignees[0].login, 'ada-made-up');
});

test('the merge sentence: each case, two blockers at once with the hardest first, and UNKNOWN', () => {
  const base: MergeInput = { state: 'OPEN', draft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED', checks: { passed: 3, failed: 0, pending: 0 }, base: 'main', changesBy: [], approvals: 1 };
  const say = (change: Partial<MergeInput>) => mergeSentence({ ...base, ...change }).sentence;
  assert.equal(say({}), 'Ready to merge');
  assert.equal(say({ reviewDecision: 'REVIEW_REQUIRED', approvals: 0, mergeStateStatus: 'BLOCKED' }), 'Blocked: An approving review is needed');
  assert.equal(say({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }), 'Blocked: Conflicts with main');
  assert.equal(say({ checks: { passed: 1, failed: 2, pending: 0 } }), 'Blocked: 2 checks failed');
  assert.equal(say({ behindBy: 3, mergeStateStatus: 'BEHIND' }), 'Blocked: 3 commits behind main');
  assert.equal(say({ behindBy: 3 }), 'Ready to merge · 3 commits behind main'); // behind alone does not block, unless GitHub says so
  assert.equal(say({ autoMerge: { method: 'SQUASH' }, checks: { passed: 1, failed: 0, pending: 2 } }), 'Blocked: 2 checks are still running · Auto-merge is on: it merges with a squash when the checks pass');
  assert.equal(say({ queue: { position: 2 } }), 'In the merge queue, place 2');
  // A day of this year has no year; a day of another year has it (a pull request that was merged ten years ago).
  const thisYear = new Date().getUTCFullYear();
  assert.equal(say({ state: 'MERGED', mergedBy: 'ines-made-up', mergedAt: `${thisYear}-01-03T10:00:00Z`, mergeParents: 1 }), 'Merged by ines-made-up on 3 January with a squash');
  assert.equal(say({ state: 'MERGED', mergedBy: 'ines-made-up', mergedAt: `${thisYear}-01-03T10:00:00Z`, mergeParents: 2 }), 'Merged by ines-made-up on 3 January with a merge commit');
  assert.equal(say({ state: 'MERGED', mergedBy: 'ines-made-up', mergedAt: `${thisYear - 10}-01-13T10:00:00Z`, mergeParents: 1 }), `Merged by ines-made-up on 13 January ${thisYear - 10} with a squash`);
  assert.equal(say({ state: 'CLOSED' }), 'Closed, not merged');
  assert.deepEqual(mergeSentence({ ...base, mergeable: 'CONFLICTING', checks: { passed: 0, failed: 1, pending: 0 }, reviewDecision: 'REVIEW_REQUIRED', approvals: 0 }).parts.map((part) => part.text),
    ['Conflicts with main', '1 check failed', 'An approving review is needed']);
  const unknown = mergeSentence({ ...base, mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' });
  assert.deepEqual([unknown.known, unknown.sentence], [false, 'GitHub is still working it out']);
  assert.equal(say({ reviewDecision: '', approvals: 0, checks: { passed: 0, failed: 0, pending: 0 } }), 'Nothing blocks a merge, but no one has approved it');
});

test('a verified commit, a commit of a bot, an author with no account, a known product with its name and icon; labels, milestones, assignees, a changed base, a deployment and a link from another pull request are quiet rows', () => {
  const commit = (hash: string, author: object, more: object = {}) => ({ __typename: 'PullRequestCommit', commit: { abbreviatedOid: hash, messageHeadline: hash, committedDate: at(1), author, ...more } });
  const pull = pullRequestFrom({ pr: rawPull({ timelineItems: list([
    commit('aaa', { name: 'Ada', user: who('ada-made-up') }, { signature: { isValid: true } }),
    commit('bbb', { name: 'dependabot[bot]', email: '1+dependabot[bot]@users.noreply.github.com', user: null }),
    commit('ccc', { name: 'Bo Made-Up', email: 'bo@example.com', user: null }),
    { __typename: 'IssueComment', id: 'c1', author: who('github-actions[bot]', 'Bot'), createdAt: at(2), bodyHTML: '<p>report</p>', reactionGroups: [] },
    { __typename: 'IssueComment', id: 'c2', author: who('helper-made-up[bot]', 'Bot'), createdAt: at(3), bodyHTML: '<p>other</p>', reactionGroups: [] },
  ]) }) });
  const commits = pull.items.filter((item): item is Extract<PullItem, { kind: 'commit' }> => item.kind === 'commit');
  assert.deepEqual(commits.map((one) => [one.hash, one.verified, one.author.login, one.author.bot, one.author.noAccount ?? false]),
    [['aaa', true, 'ada-made-up', false, false], ['bbb', false, 'Dependabot', true, true], ['ccc', false, 'Bo Made-Up', false, true]]);
  const comments = pull.items.filter((item): item is Extract<PullItem, { kind: 'comment' }> => item.kind === 'comment');
  assert.deepEqual(comments.map((one) => [one.author.login, one.author.bot, one.author.icon]), [['GitHub Actions', true, 'workflow'], ['helper-made-up', true, undefined]]);

  // Labels, milestones, assignees, a changed base, a deployment and a link from another pull request are quiet rows, not "not shown".
  {
    const event = (typename: string, more: object) => ({ __typename: typename, createdAt: at(1), actor: who('ada-made-up'), ...more });
    const pull = pullRequestFrom({ pr: rawPull({ timelineItems: list([
      event('LabeledEvent', { label: { name: 'backend', color: '1d76db' } }), event('MilestonedEvent', { milestoneTitle: 'V1' }), event('AssignedEvent', { assignee: who('bo-made-up') }),
      event('BaseRefChangedEvent', { previousRefName: 'main', currentRefName: 'next' }),
      event('DeployedEvent', { deployment: { environment: 'preview', latestStatus: { state: 'SUCCESS', environmentUrl: 'https://example.com/p' } } }),
      event('CrossReferencedEvent', { willCloseTarget: false, source: { __typename: 'PullRequest', number: 9, title: 'Other', url: 'https://example.com/pull/9' } }),
      event('SubscribedEvent', {}), event('MentionedEvent', {}),
    ]) }) });
    assert.equal(pull.notShown, 0);
    const lines = pull.items.map((item) => (item.kind === 'event' ? [item.icon, item.text, item.label?.name ?? item.link?.text ?? item.deployment?.state ?? ''] : []));
    assert.deepEqual(lines, [
      ['tag', 'added the label', 'backend'], ['milestone', 'added it to the milestone V1', ''], ['person', 'assigned bo-made-up', ''],
      ['git-branch', 'changed the base from main to next', ''], ['rocket', 'deployed to preview', 'ready'], ['cross-reference', 'mentioned it in', '#9 Other'],
    ]);
  }
});

test('a comment on a whole file says so, a file that the pull request removes is "file removed"; over the limit the newest timeline items stay, and "closed" right after "merged" goes', () => {
  const pull = pullRequestFrom({ pr: rawPull({
    files: list([{ path: 'old.ts', additions: 0, deletions: 9, changeType: 'DELETED' }]),
    reviewThreads: list([{ id: 't1', isResolved: false, isOutdated: true, path: 'old.ts', line: null, originalLine: 1, subjectType: 'FILE', comments: list([{ id: 'c1', author: who('ada-made-up'), createdAt: at(1), bodyHTML: '<p>x</p>', diffHunk: '@@ -1,1 +0,0 @@\n-a' }]) }]),
  }) });
  const thread = pull.items[0].kind === 'thread' ? pull.items[0].thread : undefined;
  assert.deepEqual([thread?.wholeFile, thread?.fileRemoved, thread?.lines, thread?.code.length], [true, true, undefined, 0]);

  // Over the limit the newest timeline items stay, and "closed" right after "merged" goes.
  {
    const comment = (minute: number) => ({ __typename: 'IssueComment', id: `c${minute}`, author: who('ada-made-up'), createdAt: at(minute), bodyHTML: `<p>${minute}</p>`, reactionGroups: [] });
    // The first page holds the newest items; the later pages are older.
    const newest = { totalCount: LIMITS.timeline + 10, filteredCount: LIMITS.timeline + 10, pageInfo: { hasPreviousPage: true, startCursor: 'x' }, nodes: Array.from({ length: 100 }, (_, index) => comment(LIMITS.timeline - 90 + index)) };
    const older = Array.from({ length: 10 }, (_, page) => ({ totalCount: 0, nodes: Array.from({ length: 100 }, (_, index) => comment(LIMITS.timeline - 90 - (page + 1) * 100 + index)) }));
    const pull = pullRequestFrom({ pr: rawPull({ timelineItems: newest }), more: { timelineItems: older } });
    assert.equal(pull.items.length, LIMITS.timeline);
    assert.equal(pull.cut.timeline, 10);
    assert.equal((pull.items.at(-1) as { html: string }).html, `<p>${LIMITS.timeline + 9}</p>`); // the newest is kept
    const merged = pullRequestFrom({ pr: rawPull({ state: 'MERGED', timelineItems: list([
      { __typename: 'MergedEvent', createdAt: at(5), actor: who('ada-made-up'), commit: { abbreviatedOid: 'abc' }, mergeRefName: 'main' },
      { __typename: 'ClosedEvent', createdAt: at(5), actor: who('ada-made-up') },
    ]) }) });
    assert.deepEqual(merged.items.map((item) => item.kind === 'event' && item.text), ['merged abc into main']);
  }
});

// ----- the gh half with a stand-in -----

const LINK = 'https://github.com/made-up/repo/pull/7';
const data = (pr: object) => ({ out: JSON.stringify({ data: { repository: { pullRequest: pr } } }), err: '' });

test('gh with a stand-in: a 502 or 504 asks again with smaller pages and says a true sentence when that fails too, and progress is told after the first answer and after each page of the timeline', async () => {
  const sizes: string[] = [];
  const answers: GhResult[] = [{ out: '', err: 'gh: HTTP 502' }, { out: '', err: 'HTTP 504: Gateway Timeout' }, data(rawPull())];
  const result = await readPullRequest('/', LINK, async (args) => { sizes.push(/timelineItems\(last: (\d+)/.exec(args.find((arg) => arg.startsWith('query=')) ?? '')?.[1] ?? ''); return answers.shift() ?? data(rawPull()); });
  assert.ok('pull' in result);
  assert.deepEqual(sizes.slice(0, 3), ['100', '50', '25']);
  const failed = await readPullRequest('/', LINK, async () => ({ out: '', err: 'gh: HTTP 502' }));
  assert.deepEqual(failed, { problem: 'too-large', text: 'GitHub could not answer this large request. Try again.' });

  // The head comes first: progress is told after the first answer and after each page of the timeline.
  {
    const first = { totalCount: 150, filteredCount: 150, pageInfo: { hasPreviousPage: true, startCursor: 'x' }, nodes: Array.from({ length: 100 }, (_, index) => ({ __typename: 'IssueComment', id: `n${index}`, author: who('ada-made-up'), createdAt: at(index % 59), bodyHTML: '', reactionGroups: [] })) };
    const older = { totalCount: 150, pageInfo: { hasPreviousPage: false }, nodes: first.nodes.slice(0, 50) };
    const answers = [data(rawPull({ timelineItems: first })), data({ timelineItems: older })];
    const told: [number, number][] = [];
    const result = await readPullRequest('/', LINK, async () => answers.shift() ?? data({}), (raw, read, total) => { told.push([read, total]); assert.equal(raw.pr.title, 'Made-up change'); });
    assert.ok('pull' in result);
    assert.deepEqual(told, [[100, 150], [150, 150]]);
  }
});

// ----- what GitHub sends -----

test('what GitHub sends: a Mermaid block stays as code, text for screen readers goes, a picture of a private repo comes as a data address or as its text and a link, and a picture of a file in a repo is read through the API', async () => {
  const html = cleanHtml('<section data-type="mermaid"><pre lang="mermaid" aria-label="Raw mermaid code">flowchart LR\n  a --&gt; b</pre><span class="sr-only">Loading</span></section><h2 class="sr-only">Footnotes</h2><p>after</p>');
  assert.equal(html, '<pre data-mermaid>flowchart LR\n  a --&gt; b</pre><p>after</p>');

  // A picture of a private repo comes as a data address; one that cannot be fetched is its text and a link.
  const pull = pullRequestFrom({ pr: rawPull({ repository: { nameWithOwner: 'made-up/repo', isPrivate: true },
    bodyHTML: '<p><img src="https://github.com/made-up/repo/blob/main/a.png?raw=true" alt="logo"> <img src="https://github.com/made-up/repo/blob/main/gone.png?raw=true" alt="gone"> <img src="https://avatars.githubusercontent.com/u/1" alt="me"></p>' }) });
  const asked: string[] = [];
  await inlinePictures(pull, async (url) => { asked.push(url); return url.includes('a.png') ? 'data:image/png;base64,AAAA' : undefined; });
  assert.deepEqual(asked, ['https://github.com/made-up/repo/blob/main/a.png?raw=true', 'https://github.com/made-up/repo/blob/main/gone.png?raw=true']);
  assert.ok(pull.html.includes('<img src="data:image/png;base64,AAAA" alt="logo">'));
  assert.ok(pull.html.includes('<a data-link="https://github.com/made-up/repo/blob/main/gone.png?raw=true" class="nopic">Picture: gone</a>'));
  assert.ok(pull.html.includes('<img src="https://avatars.githubusercontent.com/u/1" alt="me">'));

  // A picture of a file in a repo is read through the API, which takes the login of gh.
  assert.equal(apiAddress('https://github.com/made-up/repo/blob/main/assets/logo.png?raw=true'), 'https://api.github.com/repos/made-up/repo/contents/assets/logo.png?ref=main');
  assert.equal(apiAddress('https://raw.githubusercontent.com/made-up/repo/v1/a.svg'), 'https://api.github.com/repos/made-up/repo/contents/a.svg?ref=v1');
  assert.equal(apiAddress('https://private-user-images.githubusercontent.com/1/a.png?jwt=x'), undefined);
});


