// Tests for the lines of the quick pick "Sort and filter": its groups, the check marks, the words of the order, a group left out, and what a pick does to the search.
// The values come from Search.menuValues of the view (media/search.js), as they do when the icon is pressed. Made-up people, labels and rows.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PullRequest } from '../shared/pull-requests';
import { groups, pick, type MenuMessage } from './sort-filter';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Search = require('../../view/media/search.js');

const person = (login: string) => ({ login, avatar: `data:image/svg+xml,${login}`, bot: false });
const pull = (number: number, more: Partial<PullRequest> = {}): PullRequest => ({
  number, title: `Made-up change ${number}`, url: `https://example.com/made-up/pull/${number}`, state: 'review needed',
  look: { icon: 'git-pull-request', colour: 'green' }, checks: { passed: 1, failed: 0, pending: 0 }, reviewers: [], labels: [], ...more,
});
const rows = [{ branch: 'one', agent: { app: 'claude-code' } }, { branch: 'two', agent: { app: 'codex' } }, { branch: 'three' }];
const pulls: Record<string, PullRequest[]> = {
  one: [pull(1, { author: person('mira-k'), labels: [{ name: 'needs review', color: 'd73a4a' }], reviewers: [{ person: person('jonas-b'), state: 'asked' }] })],
  two: [pull(2, { author: person('mira-k'), state: 'merged', look: { icon: 'git-merge', colour: 'purple' } })],
  three: [],
};
const values = Search.menuValues(rows, (row: { branch: string }) => pulls[row.branch]);
const menu = (text = '', sort = 'modified', reverse = false): MenuMessage => ({ values, search: { text, sort, reverse } });
const titles = (message: MenuMessage) => groups(message).map((group) => group.title);

test('the quick pick has the group Sort and a group for each filter that has values, with counts; a group with no values and the sort by author with no author are left out', () => {
  const all = groups(menu());
  assert.deepEqual(all.map((group) => group.title), ['Sort', 'Author', 'Reviewer', 'Label', 'State', 'Agent']);
  assert.deepEqual(all[0].entries.map((entry) => entry.label), ['Modified', 'Created', 'Author', 'Size']);
  const author = all[1].entries[0];
  assert.deepEqual([author.label, author.description, author.mark.kind], ['mira-k', '2', 'person']);
  assert.deepEqual(all[3].entries.map((entry) => [entry.label, entry.mark]), [['needs review', { kind: 'label', color: 'd73a4a' }]]);
  assert.deepEqual(all[4].entries.map((entry) => [entry.label, entry.description]).sort(), [['merged', '1'], ['no pull request', '1'], ['review needed', '1']]);
  // An agent shows the name of its app, and its mark is the app.
  assert.deepEqual(all[5].entries.map((entry) => [entry.key, entry.value, entry.label, entry.mark]).sort(), [['agent', 'claude', 'Claude Code', { kind: 'agent', app: 'claude-code' }], ['agent', 'codex', 'Codex', { kind: 'agent', app: 'codex' }]]);

  // A group with no values is left out, and so is the sort by author when no row has an author.
  const bare = Search.menuValues([{ branch: 'one' }, { branch: 'two' }], () => []);
  const message: MenuMessage = { values: bare, search: { text: '', sort: 'modified', reverse: false } };
  assert.deepEqual(titles(message), ['Sort', 'State']);
  assert.deepEqual(groups(message)[0].entries.map((entry) => entry.label), ['Modified', 'Created', 'Size']);
});

test('the sort that is on and a value of the field have a check mark; a pick turns the order round, replaces the sort, or writes or takes away its word', () => {
  const sorts = (message: MenuMessage) => groups(message)[0].entries.map((entry) => [entry.label, entry.on, entry.description].join('|'));
  assert.deepEqual(sorts(menu()), ['Modified|true|newest first', 'Created|false|', 'Author|false|', 'Size|false|']);
  assert.deepEqual(sorts(menu('', 'modified', true))[0], 'Modified|true|oldest first');
  assert.deepEqual(sorts(menu('', 'author'))[2], 'Author|true|A to Z');
  assert.deepEqual(sorts(menu('', 'author', true))[2], 'Author|true|Z to A');
  assert.deepEqual(sorts(menu('', 'size'))[3], 'Size|true|largest first');
  assert.deepEqual(sorts(menu('', 'size', true))[3], 'Size|true|smallest first');
  assert.deepEqual(sorts(menu('', 'created', true))[1], 'Created|true|oldest first');
  const on = (message: MenuMessage) => groups(message).flatMap((group) => group.entries).filter((entry) => entry.on && entry.key !== 'sort').map((entry) => `${entry.key}:${entry.value}`);
  assert.deepEqual(on(menu('author:Mira-K label:"needs review" fix')), ['author:mira-k', 'label:needs review']);
  assert.deepEqual(on(menu()), []);

  // A pick on the sort that is on turns its order round, a pick on another sort replaces it, a pick on a value writes or takes away its word.
  const start = { text: 'fix', sort: 'modified', reverse: false };
  assert.deepEqual(pick(start, { key: 'sort', value: 'modified' }), { ...start, reverse: true });
  assert.deepEqual(pick({ ...start, reverse: true }, { key: 'sort', value: 'size' }), { ...start, sort: 'size', reverse: false });
  const withAuthor = pick(start, { key: 'author', value: 'mira-k' });
  assert.deepEqual(withAuthor, { ...start, text: 'fix author:mira-k' });
  assert.deepEqual(pick(withAuthor, { key: 'author', value: 'mira-k' }), start);
  assert.equal(pick(start, { key: 'label', value: 'needs review' }).text, 'fix label:"needs review"');
});


