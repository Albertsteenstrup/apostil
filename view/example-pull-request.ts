// A made-up conversation of a pull request, in the form that GitHub's GraphQL answer has, for the example page and the checks.
// Every name, comment and number here is made up. The pull request stands for the change of the made-up library app (view/check-example).

import { fileText, repoId } from '../shared/git';
import type { RawPullRequest } from '../shared/read-pull-request';
import type { NewChange } from '../shared/store';

const HOUR = 3_600_000;
const SERVICE = 'src/library/lending/hold_service.py';

/** A made-up person: a login and no picture, so the page draws two letters. */
const who = (login: string, bot = false) => ({ login, avatarUrl: '', __typename: bot ? 'Bot' : 'User' });
const MIRA = who('mira-k');
const JONAS = who('jonas-b');
const COPILOT = who('copilot-pull-request-reviewer', true);
const ACTIONS = who('github-actions', true); // a known product: "GitHub Actions"
const LENA = who('lena-s');

let ids = 0;
/** A comment, a review or a review comment. */
function said(author: object, hoursAgo: number, html: string, more: object = {}) {
  return {
    id: `made-up-${++ids}`, url: `https://example.com/made-up/pull/12#comment-${ids}`, author, createdAt: at(hoursAgo), lastEditedAt: null,
    bodyHTML: html, isMinimized: false, minimizedReason: null, reactionGroups: [], ...more,
  };
}
let now = Date.now();
const at = (hoursAgo: number): string => new Date(now - hoursAgo * HOUR).toISOString();
/** A made-up pull request of the stack, in short: its state, review and the one state of its checks. */
const stackEntry = (position: number, number: number, title: string, more: object = {}) => ({ position, pullRequest: {
  number, title, url: `https://example.com/made-up/pull/${number}`, state: 'OPEN', isDraft: false, reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE',
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }, ...more,
} });
const commit = (hoursAgo: number, hash: string, subject: string, more: object = {}) =>
  ({ __typename: 'PullRequestCommit', commit: { oid: `${hash}${'0'.repeat(33)}`, abbreviatedOid: hash, messageHeadline: subject, committedDate: at(hoursAgo), author: { name: 'Mira K', user: MIRA }, ...more } });

const HUNK = [
  '@@ -235,6 +235,12 @@ def offer_returned_copies(self, today, limit):',
  '         for row in rows:',
  '             counts.checked += 1',
  '+            hold = self._first_waiting(row["book_id"], today)',
  '+            if hold is None:',
  '+                continue',
  '+            pickup_by = self._pickup_day(today, hold.branch_id)',
  '+            self.notices.send_pickup(member, hold, pickup_by, reason="the night run", sent_by="the offer of returned copies", note="a long line that does not fit in a narrow page")',
  '+        log.info("offered %s copies", counts.offered)',
  '         return counts',
].join('\n');

// The code of a comment on the line that logs the count: the hunk up to that line, as GitHub gives it.
const LOG_HUNK = HUNK.split('\n').slice(0, -1).join('\n');
const LOG_LINE = '        log.info("offered %s copies", counts.offered)';
const SUGGESTED = '        log.info("offered %d copies", counts.offered)';
/** GitHub's own box of a suggested change in the HTML of a comment, made up in its form: the page draws its own in its place. */
const suggestionBox = (old: string, now: string) => '<div class="my-2 border rounded-2 js-suggested-changes-blob diff-view js-check-hidden-unicode" id="">'
  + '<div class="f6 p-2 lh-condensed border-bottom d-flex"><div class="flex-auto flex-items-center color-fg-muted">Suggested change</div></div>'
  + `<div itemprop="text" class="blob-wrapper data file"><table class="d-table tab-size mb-0 width-full"><tbody><tr class="border-0"><td class="blob-num blob-num-deletion" data-line-number="242"></td><td class="blob-code-inner blob-code-deletion">${old.replace(/"/g, '&quot;')}</td></tr>`
  + `<tr class="border-0"><td class="blob-num blob-num-addition" data-line-number="242"></td><td class="blob-code-inner blob-code-addition">${now.replace(/"/g, '&quot;')}</td></tr></tbody></table></div><div class="js-apply-changes"></div></div>`;

const REPORT =`<h3>Test report</h3><p>The checks of <code>9e2d4b7</code> ran. One failed.</p><table><thead><tr><th>Check</th><th>Result</th><th>Time</th></tr></thead><tbody>${
  ['lint', 'types', 'unit / core', 'unit / lending', 'unit / desk', 'integration / core', 'integration / lending', 'build', 'docs']
    .map((name) => `<tr><td>${name}</td><td>${name === 'integration / lending' ? 'failed' : 'passed'}</td><td>${(name.length * 7) % 60 + 20} s</td></tr>`).join('')
}</tbody></table><p>The failed test:</p><pre><code>${Array.from({ length: 16 }, (_, index) => `tests/lending/test_offers.py:${120 + index}: ${index === 15 ? 'AssertionError: the copy was offered twice' : 'in test_a_copy_is_offered_once'}`).join('\n')}</code></pre><p>Run it again with <code>make test-lending</code>.</p>`;

/** The made-up pull request #12, the middle of a stack of three, with times counted back from `when`. He last looked 26 hours before it. */
export function examplePullRequest(when = Date.now()): { raw: RawPullRequest; lastLooked: string } {
  now = when;
  ids = 0;
  const copilotReview = said(COPILOT, 70, '<p>Copilot reviewed 4 of 12 changed files and left 2 comments.</p>', { __typename: 'PullRequestReview', state: 'COMMENTED', submittedAt: at(70) });
  const changesReview = said(JONAS, 30, '<p>The copy is marked ready before the mail goes out. A member whose mail fails loses days of the pickup time.</p>', { __typename: 'PullRequestReview', state: 'CHANGES_REQUESTED', submittedAt: at(30) });
  const approval = said(JONAS, 2, '<p>Looks good now.</p>', { __typename: 'PullRequestReview', state: 'APPROVED', submittedAt: at(2), reactionGroups: [{ content: 'HOORAY', reactors: { totalCount: 1 } }] });
  // What the owner may do with each thread: answer every one, resolve the open ones, unresolve the resolved one.
  const may = (resolved: boolean) => ({ viewerCanReply: true, viewerCanResolve: !resolved, viewerCanUnresolve: resolved });
  const threads = [
    { // resolved
      id: 'thread-1', isResolved: true, isOutdated: false, path: SERVICE, line: 230, startLine: null, resolvedBy: MIRA, ...may(true),
      comments: { totalCount: 2, nodes: [
        said(COPILOT, 70, '<p>How long does the lock on the copies last when a mail hangs?</p>', { diffHunk: HUNK, pullRequestReview: { id: copilotReview.id } }),
        said(MIRA, 69, '<p>The lock ends with the transaction. A mail that hangs gives up after 30 seconds.</p>', { pullRequestReview: { id: copilotReview.id } }),
      ] },
    },
    { // outdated
      id: 'thread-2', isResolved: false, isOutdated: true, path: 'src/library/lending/pickup_days.py', line: null, originalLine: 94, originalStartLine: 88, resolvedBy: null, ...may(false),
      comments: { totalCount: 1, nodes: [said(COPILOT, 70, '<p>Do the pickup days skip the days when a branch is closed? If not, a member can lose a weekend.</p>', { diffHunk: HUNK, pullRequestReview: { id: copilotReview.id } })] },
    },
    { // on the whole file, which the pull request removes
      id: 'thread-4', isResolved: false, isOutdated: true, path: 'src/library/lending/old_reservations.py', line: null, originalLine: 1, subjectType: 'FILE', resolvedBy: null, ...may(false),
      comments: { totalCount: 1, nodes: [said(JONAS, 30, '<p>Is anything still calling the old reservations?</p>', { diffHunk: '@@ -1,3 +0,0 @@\n-import json', pullRequestReview: { id: changesReview.id } })] },
    },
    { // open, with a later answer
      id: 'thread-3', isResolved: false, isOutdated: false, path: SERVICE, line: 247, startLine: 245, resolvedBy: null, ...may(false),
      comments: { totalCount: 2, nodes: [
        said(JONAS, 30, '<p>Send the mail before <code>_mark_ready</code>, so that a failed mail does not shorten the pickup time.</p>', { diffHunk: HUNK, pullRequestReview: { id: changesReview.id } }),
        said(MIRA, 18.5, '<p>Moved, and a test covers it.</p>', { pullRequestReview: { id: 'made-up-answer-review' } }),
      ] },
    },
    { // open, with a suggested change of one line, in the approving review
      id: 'thread-5', isResolved: false, isOutdated: false, path: SERVICE, line: 242, startLine: null, diffSide: 'RIGHT', resolvedBy: null, ...may(false),
      comments: { totalCount: 1, nodes: [said({ ...JONAS, databaseId: 4242 }, 2, `<p>A count reads better with <code>%d</code>.</p>${suggestionBox(LOG_LINE, SUGGESTED)}`, {
        body: `A count reads better with \`%d\`.\n\n\`\`\`suggestion\n${SUGGESTED}\n\`\`\``, diffHunk: LOG_HUNK, pullRequestReview: { id: approval.id, state: 'APPROVED' },
      })] },
    },
  ];
  const hidden = said(JONAS, 10, '<p>Lunch at 12?</p>', { __typename: 'IssueComment', isMinimized: true, minimizedReason: 'OFF_TOPIC' });
  const timeline = [
    commit(72, 'a1f3c09', 'Add the hold tables'),
    commit(71.9, '4c8e215', 'Add the night offers'),
    { __typename: 'ReviewRequestedEvent', createdAt: at(71.5), actor: MIRA, requestedReviewer: COPILOT },
    copilotReview,
    said(JONAS, 48, '<p>Does a paused hold keep its place when a copy comes back?</p>', { __typename: 'IssueComment' }),
    said(MIRA, 47.97, '<p>Yes. See <code>_first_waiting</code>, which passes it over until its day.</p>', { __typename: 'IssueComment' }),
    said(MIRA, 47.93, '<p>The test <code>test_a_paused_hold_keeps_its_place</code> covers it.</p>', { __typename: 'IssueComment', reactionGroups: [{ content: 'THUMBS_UP', reactors: { totalCount: 2 } }] }),
    commit(47, 'b72e1d0', 'Add the pickup days'),
    { __typename: 'LabeledEvent', createdAt: at(40), actor: MIRA, label: { name: 'backend', color: '1d76db' } },
    { __typename: 'LabeledEvent', createdAt: at(40), actor: MIRA, label: { name: 'needs a review from someone who knows the lending rules well', color: 'fbca04' } },
    { __typename: 'MilestonedEvent', createdAt: at(40), actor: MIRA, milestoneTitle: 'Version 0.5' },
    { __typename: 'AssignedEvent', createdAt: at(40), actor: MIRA, assignee: MIRA },
    { __typename: 'SomethingNewEvent', createdAt: at(39) }, // a kind that the page does not know
    changesReview,
    commit(20, '9e2d4b7', 'Send the mail before the copy is ready'),
    commit(19, '5d0a3e1', 'Test a failed mail', { signature: { isValid: true } }),
    commit(18.8, '8a1d2e3', 'Bump the date library', { author: { name: 'dependabot[bot]', email: '49699333+dependabot[bot]@users.noreply.github.com', user: null } }),
    commit(18.7, '2c3d4e5', 'Fix a typo in a comment', { author: { name: 'Ana Pereira', email: 'ana@example.com', user: null } }),
    said(MIRA, 18, '<p>Done in <code>9e2d4b7</code>. A failed mail now keeps the full pickup time:</p><pre><code>try:\n    self.notices.send_pickup(member, hold, pickup_by)\nfinally:\n    self._mark_ready(hold, copy_id, pickup_by)</code></pre><p><a href="https://example.com/made-up/jonas-b">@jonas-b</a> can you look again?</p>',
      { __typename: 'IssueComment', lastEditedAt: at(17.5) }),
    { __typename: 'HeadRefForcePushedEvent', createdAt: at(17.2), actor: MIRA, beforeCommit: { abbreviatedOid: '5d0a3e1' }, afterCommit: { abbreviatedOid: '6b2c8d0' } },
    { __typename: 'HeadRefForcePushedEvent', createdAt: at(17.1), actor: MIRA, beforeCommit: { abbreviatedOid: '6b2c8d0' }, afterCommit: { abbreviatedOid: '3f9a1c4' } },
    { __typename: 'HeadRefForcePushedEvent', createdAt: at(17), actor: MIRA, beforeCommit: { abbreviatedOid: '3f9a1c4' }, afterCommit: { abbreviatedOid: '7c41b9e' } },
    said(ACTIONS, 16.5, REPORT.replace('One failed.', 'Two failed.'), { __typename: 'IssueComment' }),
    said(ACTIONS, 16, REPORT, { __typename: 'IssueComment' }),
    { __typename: 'DeployedEvent', createdAt: at(15.5), actor: ACTIONS, deployment: { environment: 'preview', state: 'ACTIVE', latestStatus: { state: 'SUCCESS', environmentUrl: 'https://example.com/made-up/preview/12' } } },
    { __typename: 'DeployedEvent', createdAt: at(15.4), actor: ACTIONS, deployment: { environment: 'staging', state: 'FAILURE', latestStatus: { state: 'FAILURE', environmentUrl: null } } },
    said(LENA, 12, '<h2>Pre-merge review</h2><p>Two things to look at before this goes in.</p><ol>' + Array.from({ length: 28 }, (_, index) => `<li>Point ${index + 1} of a long list of small things about the night run.</li>`).join('') + '</ol>', { __typename: 'IssueComment' }),
    said(LENA, 11, '<p>Please rebase on main.</p>', { __typename: 'IssueComment' }),
    said(LENA, 10.5, '<p>Please rebase on main.</p>', { __typename: 'IssueComment' }),
    hidden,
    approval,
  ];
  const run = (name: string, conclusion: string | null, more: object = {}) => ({
    __typename: 'CheckRun', name, status: conclusion ? 'COMPLETED' : 'IN_PROGRESS', conclusion, startedAt: at(16), completedAt: conclusion ? at(15.99) : null,
    detailsUrl: `https://example.com/made-up/actions/job/${name.replace(/\W+/g, '-')}`, annotations: { totalCount: 0, nodes: [] },
    checkSuite: { app: { name: 'GitHub Actions' }, workflowRun: { url: 'https://example.com/made-up/actions/run/1', workflow: { name: 'CI' } } }, ...more,
  });
  const status = (context: string, state: string, description: string) => ({ __typename: 'StatusContext', context, state, description, targetUrl: 'https://example.com/made-up/checks', createdAt: at(16) });
  const checks = [
    ...['lint', 'types', 'unit / core', 'unit / lending', 'unit / desk', 'integration / core', 'build'].map((name) => run(name, 'SUCCESS')),
    run('integration / lending', 'FAILURE', { annotations: { totalCount: 1, nodes: [{ annotationLevel: 'FAILURE', title: 'test_a_copy_is_offered_once', message: 'AssertionError: the copy was offered twice', path: SERVICE, location: { start: { line: 246 } } }] } }),
    run('integration / lending', 'SUCCESS', { startedAt: at(20) }), // an earlier run of the same job: only the newest counts
    run('docs', null),
    run('deploy the preview', 'SKIPPED'),
    status('coverage/patch', 'FAILURE', '71.4% of the diff is covered (target 80%)'),
    status('security/dependencies', 'SUCCESS', 'No known vulnerable dependency'),
  ];
  const description = '<h3>What changed</h3><ul><li>New tables for holds and their history</li><li>A night run that offers the copies that came back</li><li>A member can pause a hold</li></ul>'
    + '<h3>How to test</h3><ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" checked disabled> Run <code>make test-lending</code></li>'
    + '<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled> Place a hold on a book that is out</li><li>Bring a copy back and run the night jobs</li></ul>'
    + '<p>Adds holds: a member waits in line for a book that is out, and the night run offers each copy that comes back to the first member.</p>'
    + '<section class="js-render-needs-enrichment" data-type="mermaid"><div><pre lang="mermaid" aria-label="Raw mermaid code">flowchart LR\n  back[A copy comes back] --&gt; offer[Offer it to the first member] --&gt; shelf[Put it on the ready shelf]</pre></div><span class="sr-only">Loading</span></section>'
    + '<p>A picture that does not load: <img src="https://user-images.githubusercontent.com/0/made-up-missing.png" alt="the old panel"></p>';
  const raw: RawPullRequest = {
    pr: {
      id: 'made-up-pull-12', number: 12, title: 'Holds for books that are out', url: 'https://example.com/made-up/pull/12', state: 'OPEN', isDraft: false, createdAt: at(72),
      locked: false, viewerDidAuthor: false, viewerCanApplySuggestion: true, pending: { nodes: [] }, viewer: who('you'), // he may push to the branch
      headRefName: 'made-up/holds', baseRefName: 'made-up/hold-store', headRefOid: '7c41b9e', baseRefOid: '0000000', author: MIRA, commits: { totalCount: 5 },
      changedFiles: 12, additions: 1840, deletions: 212, reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', bodyHTML: description,
      // What GitHub lets him do, and how the made-up repo merges: he may push, and the base asks for two approvals and every thread resolved.
      repository: { nameWithOwner: 'made-up/example', isPrivate: false, viewerPermission: 'WRITE', mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true, viewerDefaultMergeMethod: 'SQUASH', deleteBranchOnMerge: false },
      headRepository: { nameWithOwner: 'made-up/example' }, isCrossRepository: false, headRef: { id: 'made-up-ref-holds' },
      viewerCanMergeAsAdmin: false, viewerCanUpdate: true, viewerCanClose: true, viewerCanReopen: false, viewerCanUpdateBranch: true, viewerCanDeleteHeadRef: true,
      mergeTitle: 'Merge pull request #12 from made-up/holds', mergeBody: 'Holds for books that are out',
      squashTitle: 'Holds for books that are out (#12)', squashBody: '* Add the hold tables\n* Add the night offers\n* Add the pickup days\n* Send the mail before the copy is ready',
      baseRef: { refUpdateRule: { requiredApprovingReviewCount: 2, requiresConversationResolution: true, requiresLinearHistory: false } },
      labels: { nodes: [{ name: 'backend', color: '1d76db' }, { name: 'needs a review from someone who knows the lending rules well', color: 'fbca04' }] },
      assignees: { nodes: [MIRA] }, milestone: { title: 'Version 0.5', dueOn: new Date(now + 30 * 24 * HOUR).toISOString(), url: 'https://example.com/made-up/milestone/1' },
      closingIssuesReferences: { nodes: [{ number: 24, title: 'A failed mail shortens the pickup time', url: 'https://example.com/made-up/issues/24', state: 'OPEN' }] },
      stackEntry: { position: 2 },
      stack: { number: 7, size: 3, baseRefName: 'main', entries: { totalCount: 3, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
        stackEntry(1, 9, 'Store the holds'),
        stackEntry(2, 12, 'Holds for books that are out', { commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } }),
        stackEntry(3, 13, 'Show the pickup day on the ready shelf', { isDraft: true }),
      ] } },
      latestReviews: { nodes: [{ author: JONAS, state: 'APPROVED' }, { author: COPILOT, state: 'COMMENTED' }] },
      reviewRequests: { nodes: [{ requestedReviewer: LENA }, { requestedReviewer: { __typename: 'Team', name: 'made-up/lending-team' } }] },
      last: { nodes: [{ commit: {
        deployments: { nodes: [
          { environment: 'preview', state: 'ACTIVE', createdAt: at(15.5), latestStatus: { state: 'SUCCESS', environmentUrl: 'https://example.com/made-up/preview/12', createdAt: at(15.5) } },
          { environment: 'staging', state: 'FAILURE', createdAt: at(15.4), latestStatus: { state: 'FAILURE', environmentUrl: null, description: 'The migration failed', createdAt: at(15.4) } },
        ] },
        statusCheckRollup: { contexts: { totalCount: checks.length, nodes: checks } } } }] },
      timelineItems: { totalCount: timeline.length, filteredCount: timeline.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes: timeline },
      reviewThreads: { totalCount: threads.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes: threads },
      files: { totalCount: 2, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
        { path: SERVICE, additions: 1200, deletions: 180, changeType: 'MODIFIED' },
        { path: 'src/library/lending/pickup_days.py', additions: 640, deletions: 32, changeType: 'ADDED' },
        { path: 'src/library/lending/old_reservations.py', additions: 0, deletions: 90, changeType: 'DELETED' },
      ] },
    },
    behindBy: 3,
  };
  return { raw, lastLooked: at(26) };
}

/** The made-up pull request #12 as a read gives it once it can merge: approved, every check passed, every thread resolved, the pull request below it merged. */
export function exampleReadyPullRequest(when = Date.now()): RawPullRequest {
  const { pr } = examplePullRequest(when).raw;
  const commit = pr.last.nodes[0].commit;
  const passed = (node: { __typename: string; conclusion?: string }) => (node.__typename === 'StatusContext' ? { ...node, state: 'SUCCESS' }
    : { ...node, status: 'COMPLETED', conclusion: node.conclusion === 'SKIPPED' ? 'SKIPPED' : 'SUCCESS', completedAt: at(15.9) });
  return { pr: {
    ...pr, reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN', stack: undefined, stackEntry: undefined,
    latestReviews: { nodes: [...pr.latestReviews.nodes, { author: LENA, state: 'APPROVED' }] }, reviewRequests: { nodes: [] }, // the two approvals that the base needs
    reviewThreads: { ...pr.reviewThreads, nodes: pr.reviewThreads.nodes.map((node: object) => ({ ...node, isResolved: true, resolvedBy: MIRA })) },
    last: { nodes: [{ commit: { ...commit, statusCheckRollup: { contexts: { ...commit.statusCheckRollup.contexts, nodes: commit.statusCheckRollup.contexts.nodes.map(passed) } } } }] },
  } };
}

/** A made-up merged pull request #11 with one comment, for the choice between the pull requests of the branch. */
export function exampleMergedPullRequest(when = Date.now()): RawPullRequest {
  now = when;
  return {
    pr: {
      id: 'made-up-pull-11', number: 11, title: 'First half of the holds', url: 'https://example.com/made-up/pull/11', state: 'MERGED', isDraft: false, createdAt: at(200),
      headRefName: 'made-up/holds-1', baseRefName: 'main', headRefOid: '1111111', baseRefOid: '0000000', author: MIRA, commits: { totalCount: 1 },
      changedFiles: 3, additions: 120, deletions: 4, reviewDecision: 'APPROVED', mergeable: 'UNKNOWN', bodyHTML: '', repository: { nameWithOwner: 'made-up/example' },
      mergedAt: at(189), mergedBy: JONAS, mergeCommit: { abbreviatedOid: '1111111', parents: { totalCount: 1 } },
      latestReviews: { nodes: [] }, reviewRequests: { nodes: [] }, last: { nodes: [] },
      timelineItems: { totalCount: 3, nodes: [
        commit(199, '1111111', 'Add the first hold table'),
        said(JONAS, 190, '<p>Merging this half first.</p>', { __typename: 'IssueComment' }),
        { __typename: 'MergedEvent', createdAt: at(189), actor: JONAS, commit: { abbreviatedOid: '1111111' }, mergeRefName: 'main' },
        { __typename: 'ClosedEvent', createdAt: at(189), actor: JONAS }, // the same act as the merge: left out
      ] },
      reviewThreads: { totalCount: 0, nodes: [] },
      files: { totalCount: 0, nodes: [] },
    },
  };
}

const EARLIER_FILE = 'src/library/dev_clock.py';

/**
 * Made up: an earlier change of the example repo, merged long ago, with one note on code that the change of the example left alone,
 * and the text of its lines as the save keeps it. The example page and the pictures of the notes beside the code show it. Undefined in another repo.
 */
export function exampleEarlierChange(folder: string, base: string): NewChange | undefined {
  const lines = (fileText(folder, EARLIER_FILE) ?? '').split('\n');
  const at = lines.findIndex((line) => line.startsWith('def date_from_settings('));
  if (at < 0) return undefined;
  return {
    repoId: repoId(folder), folder: '/made-up/earlier-change', branch: 'made-up/test-date', base, head: 'made-up',
    checks: { filesInNoPart: [], filesInTwoParts: [], filesNotChanged: [], generated: [], badNotes: [] },
    file: { format: 1, title: 'A test date for the night jobs', reason: 'Made up.', links: [], parts: [{ id: 'test-date', name: 'Test date', files: [EARLIER_FILE], notes: [{
      file: EARLIER_FILE, lines: [at + 1, at + 5], title: 'Read the test date from the settings', symbol: 'date_from_settings',
      text: 'A test machine can set its own date, so that the night jobs can be tried for any day.',
    }] }] },
    noteCode: { 'test-date/0': lines.slice(at, at + 5) },
  };
}
