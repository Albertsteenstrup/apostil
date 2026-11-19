// Tests for the search of the list in the side bar: the parser of the field, which rows match, the sorts with their dates, the values of the menu,
// and the fields that gh gives for the list. Made-up rows, people and JSON; no test calls GitHub.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { avatarOf, ghArguments, pullRequestsFromJson, type PullRequest, type RawPullRequest } from '../shared/pull-requests';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Search = require('../../view/media/search.js');

const person = (login: string) => ({ login, avatar: `data:image/svg+xml,${login}`, bot: false });
/** A made-up pull request of the list. */
const pull = (number: number, more: Partial<PullRequest> = {}): PullRequest => ({
  number, title: `Made-up change ${number}`, url: `https://example.com/made-up/pull/${number}`, state: 'review needed',
  look: { icon: 'git-pull-request', colour: 'green' }, checks: { passed: 1, failed: 0, pending: 0 }, reviewers: [], labels: [], ...more,
});
/** A made-up row of the list. */
const row = (branch: string, more: Record<string, unknown> = {}) => ({ branch, savedAt: '2026-11-10T10:00:00Z', added: 10, removed: 2, ...more });

test('the field and its menu: the parser reads filter words and quoted names, the menu writes a word into the field and takes it away again, and lists only the values that the rows have, the most first', () => {
  assert.deepEqual(Search.parse('author:mira-k label:"needs review" Fix #12'), {
    words: [{ key: 'author', value: 'mira-k' }, { key: 'label', value: 'needs review' }], free: ['fix', '#12'],
  });
  // A key in capitals is still a key; a word with a key that is not a filter is text; a quoted phrase is one word of text.
  assert.deepEqual(Search.parse('STATE:merged foo:bar "two words"'), { words: [{ key: 'state', value: 'merged' }], free: ['foo:bar', 'two words'] });
  // While a word is typed: a key with no value filters nothing, and a quote that is not closed yet runs to the end.
  assert.deepEqual(Search.parse('author: label:"needs re'), { words: [{ key: 'label', value: 'needs re' }], free: [] });
  assert.equal(Search.active(Search.parse('  author:  ')), false);
  assert.equal(Search.active(Search.parse('x')), true);

  // The menu writes a word into the field and takes it away again, quoting a name with a space, and keeps the rest.
  assert.equal(Search.toggle('fix', 'author', 'mira-k'), 'fix author:mira-k');
  assert.equal(Search.toggle('fix author:Mira-K', 'author', 'mira-k'), 'fix');
  assert.equal(Search.toggle('', 'state', 'review needed'), 'state:"review needed"');
  assert.equal(Search.toggle('state:"review needed" label:bug', 'state', 'review needed'), 'label:bug');
  assert.ok(Search.isOn(Search.parse('label:"needs review"'), 'label', 'Needs Review'));

  // The menu lists only the values that the rows have, each with the number of rows, the most first.
  const rows = [row('a', { agent: { app: 'claude-code' } }), row('b', { agent: { app: 'claude-code' } }), row('c', { agent: { app: 'codex' } }), row('d')];
  const pulls: Record<string, PullRequest[]> = {
    a: [pull(1, { author: person('mira-k'), labels: [{ name: 'bug', color: 'd73a4a' }] }), pull(2, { author: person('mira-k'), state: 'merged' })],
    b: [pull(3, { author: person('jonas-b'), reviewers: [{ person: person('mira-k'), state: 'asked' }], labels: [{ name: 'bug', color: 'd73a4a' }] })],
    c: [pull(4, { author: person('mira-k'), state: 'merged' })],
  };
  const values = Search.menuValues(rows, (one: { branch: string }) => pulls[one.branch] ?? []);
  const short = (key: string) => values[key].map((one: { value: string; count: number }) => `${one.value} ${one.count}`).join(', ');
  assert.equal(short('author'), 'mira-k 2, jonas-b 1'); // a row counts once, also with two pull requests of one author
  assert.equal(short('reviewer'), 'mira-k 1');
  assert.equal(short('label'), 'bug 2');
  assert.equal(short('state'), 'merged 2, review needed 2, no pull request 1');
  assert.equal(short('agent'), 'claude 2, codex 1');
  assert.equal(values.label[0].color, 'd73a4a');
  assert.equal(values.author[0].person.login, 'mira-k');
  assert.equal(values.agent[0].agent.app, 'claude-code');
  // With no gh, the rows have no author, reviewer or label: those lists are empty, and the menu leaves them out.
  const bare = Search.menuValues(rows, () => []);
  assert.deepEqual([bare.author, bare.reviewer, bare.label], [[], [], []]);
  assert.equal(bare.state[0].value, 'no pull request');
});

test('a row matches by its branch, its agent app, or the title, number, author, reviewer or label of a pull request; filters of one key are "or", keys "and"', () => {
  const pulls = [
    pull(12, { author: person('mira-k'), reviewers: [{ person: person('lena-s'), state: 'approved' }], labels: [{ name: 'needs review', color: 'd73a4a' }] }),
    pull(11, { author: person('jonas-b'), state: 'merged', title: 'First half' }),
  ];
  const one = row('feature/cards', { agent: { app: 'claude-code' } });
  const numbers = (query: string) => Search.match(one, pulls, Search.parse(query))?.map((found: PullRequest) => found.number) ?? null;
  // Text that the branch or the agent app holds keeps the row as it is, with every pull request.
  assert.deepEqual(numbers('CARDS'), [12, 11]);
  assert.deepEqual(numbers('claude'), [12, 11]);
  assert.deepEqual(numbers('agent:claude'), [12, 11]);
  assert.equal(numbers('agent:codex'), null);
  // Text that only some pull requests hold keeps those pull requests.
  assert.deepEqual(numbers('#11'), [11]);
  assert.deepEqual(numbers('first half'), [11]);
  assert.deepEqual(numbers('lena'), [12]);
  assert.deepEqual(numbers('needs'), [12]);
  assert.equal(numbers('nothing-holds-this'), null);
  // A filter on pull requests keeps the pull requests that fit it. Two values of one key are "or"; two keys are "and".
  assert.deepEqual(numbers('author:jonas-b'), [11]);
  assert.deepEqual(numbers('author:jonas-b author:mira-k'), [12, 11]);
  assert.equal(numbers('author:jonas-b reviewer:lena-s'), null);
  assert.deepEqual(numbers('reviewer:lena-s label:"needs review"'), [12]);
  assert.deepEqual(numbers('state:merged'), [11]);
  // A row with no pull request has the state "no pull request", and no author.
  assert.deepEqual(Search.match(row('alone'), [], Search.parse('state:"no pull request"')), []);
  assert.equal(Search.match(row('alone'), [], Search.parse('state:merged')), null);
  assert.equal(Search.match(row('alone'), [], Search.parse('author:mira-k')), null);
});

test('the sorts: modified and created newest first with their dates, author A to Z, size the largest first; a second click turns the order round', () => {
  const rows = [
    row('a', { savedAt: '2026-11-01T00:00:00Z', firstSavedAt: '2026-10-01T00:00:00Z', added: 5, removed: 0 }),
    row('b', { savedAt: '2026-11-03T00:00:00Z', firstCommitAt: '2026-10-20T00:00:00Z', added: 50, removed: 50 }),
    row('c', { savedAt: '2026-11-02T00:00:00Z', firstCommitAt: '2026-09-01T00:00:00Z', added: 1, removed: 1 }),
    row('d', { savedAt: 'not a date', added: 0, removed: 0 }),
  ];
  const pullsOf = (one: { branch: string }) => ({
    a: [pull(1, { author: person('Zoe'), updatedAt: '2026-11-05T00:00:00Z' })], // modified by its pull request, after the save
    c: [pull(2, { author: person('ada'), createdAt: '2026-10-25T00:00:00Z' }), pull(3, { createdAt: '2026-10-15T00:00:00Z' })],
  } as Record<string, PullRequest[]>)[one.branch] ?? [];
  const order = (sort: string, reverse = false) => Search.sortRows(rows, pullsOf, sort, reverse).map((one: { branch: string }) => one.branch).join('');
  // Modified: the latest of the save and the updates of the pull requests. A row with no date stands at the end, also turned round.
  assert.equal(order('modified'), 'abcd');
  assert.equal(order('modified', true), 'cbad');
  // Created: the first save (a), else the oldest pull request (c: 15 October, not its first commit), else the first commit (b).
  assert.equal(order('created'), 'bcad');
  assert.equal(Search.createdOf(rows[2], pullsOf(rows[2])), Date.parse('2026-10-15T00:00:00Z'));
  assert.equal(Search.modifiedOf(rows[0], pullsOf(rows[0])), Date.parse('2026-11-05T00:00:00Z'));
  // Author: A to Z with no case, the rows with no author at the end in their modified order.
  assert.equal(order('author'), 'cabd');
  assert.equal(order('author', true), 'acbd');
  // Size: lines added and removed, the largest first.
  assert.equal(order('size'), 'bacd');
  assert.equal(order('size', true), 'dcab');
  assert.equal(order('nonsense'), order('modified'));
  assert.ok(Search.defaultSort({ sort: 'modified', reverse: false }));
  assert.ok(!Search.defaultSort({ sort: 'modified', reverse: true }));
  assert.ok(!Search.defaultSort({ sort: 'created', reverse: false }));
});

test('gh is asked for the author, labels, reviewers and dates in the same call, and they are mapped in one place', () => {
  assert.equal(ghArguments('feature').length, 8);
  assert.match(ghArguments('feature')[7], /^number,title,url,state,isDraft,reviewDecision,mergeable,statusCheckRollup,author,labels,reviewRequests,latestReviews,createdAt,updatedAt$/);
  assert.deepEqual(ghArguments('feature', 'made-up/repo').slice(8), ['--repo', 'made-up/repo']); // a link names the repo: in a clone of a fork it is not origin
  const raw = {
    number: 12, title: 'Made-up', url: 'https://github.com/made-up/repo/pull/12', state: 'OPEN', isDraft: false, reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE',
    statusCheckRollup: [], createdAt: '2026-11-01T09:00:00Z', updatedAt: '2026-11-02T09:00:00Z',
    author: { login: 'mira-k', name: 'Mira', is_bot: false },
    labels: [{ name: 'needs review', color: 'fbca04', description: 'x' }],
    latestReviews: [{ author: { login: 'lena-s' }, state: 'CHANGES_REQUESTED' }, { author: { login: 'app/copilot-pull-request-reviewer', is_bot: true }, state: 'COMMENTED' }],
    reviewRequests: [{ __typename: 'User', login: 'jonas-b' }, { __typename: 'Team', name: 'Made-up team', slug: 'made-up-team' }, { __typename: 'User', login: 'lena-s' }],
  } as unknown as RawPullRequest; // gh gives more fields than the code reads, such as the description of a label
  const [mapped] = pullRequestsFromJson(JSON.stringify([raw]));
  assert.deepEqual(mapped.author, { login: 'mira-k', avatar: 'https://avatars.githubusercontent.com/mira-k?s=40', bot: false });
  assert.deepEqual(mapped.labels, [{ name: 'needs review', color: 'fbca04' }]);
  assert.deepEqual(mapped.reviewers?.map((one) => `${one.person.login}:${one.state}:${one.person.avatar ? 'picture' : one.person.icon ?? 'letters'}`), [
    'lena-s:changes requested:picture', 'Copilot:reviewed:copilot', 'jonas-b:asked:picture', 'Made-up team:asked:letters',
  ]); // lena-s reviewed and is asked again: she stands once, with her review
  assert.equal(mapped.reviewers?.[3].person.team, true);
  assert.deepEqual([mapped.createdAt, mapped.updatedAt], ['2026-11-01T09:00:00Z', '2026-11-02T09:00:00Z']);
  // A bot author has no picture address; an answer with none of the optional fields maps too.
  const [bot] = pullRequestsFromJson(JSON.stringify([{ ...raw, author: { login: 'app/dependabot', is_bot: true } }]));
  assert.deepEqual(bot.author, { login: 'Dependabot', avatar: '', bot: true, icon: 'dependabot' });
  const { author: _a, labels: _l, latestReviews: _r, reviewRequests: _q, createdAt: _c, updatedAt: _u, ...old } = raw;
  const [plain] = pullRequestsFromJson(JSON.stringify([old]));
  assert.deepEqual([plain.author, plain.reviewers, plain.labels, plain.createdAt], [undefined, [], [], undefined]);
  assert.equal(avatarOf('a b'), 'https://avatars.githubusercontent.com/a%20b?s=40');
});
