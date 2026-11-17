// Tests for `apostil icon` and for the icon that add-marks asks for. A made-up web: the fetch is given by the test, so no test reaches the internet.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { repoId } from '../shared/git';
import type { Fetcher } from '../shared/icon-fetch';
import { markFacts } from '../shared/marks';
import type { RepoMap } from '../shared/repo-map';
import { Store } from '../shared/store';
import { makeTestRepo, tempFolder } from '../shared/test-repo';
import { saveIcon } from './icon';
import { addMarksToMap, setsOf, valuesOf } from './marks-save';
import { saveMapDraft } from './save';

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex'), Buffer.alloc(40)]);
const BIG = Buffer.concat([PNG, Buffer.alloc(101 * 1024)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7"/></svg>');
const PAGE = '<html><head><link rel="stylesheet" href="/a.css"><link rel="icon" sizes="16x16" href="/small.png"><link rel="apple-touch-icon" href="/touch.png"></head></html>';

type Answer = { status?: number; type?: string; body?: Buffer | string; location?: string };

/** A made-up web: the answer for each address, and the addresses that were asked. */
function web(answers: Record<string, Answer>): { fetcher: Fetcher; asked: string[] } {
  const asked: string[] = [];
  const fetcher: Fetcher = async (address) => {
    asked.push(address);
    const answer = answers[address];
    if (!answer) return new Response('no', { status: 404 });
    return new Response(typeof answer.body === 'string' ? answer.body : new Uint8Array(answer.body ?? []) , { status: answer.status ?? 200, headers: { ...(answer.type ? { 'content-type': answer.type } : {}), ...(answer.location ? { location: answer.location } : {}) } });
  };
  return { fetcher, asked };
}

/** A repo with a saved map and a store; a service "bookfeed" that Apostil knows by its site, with no icon. */
function setUp() {
  const repo = makeTestRepo();
  repo.write('src/feed.py', 'import requests\n\ndef read_feed():\n    return requests.get("https://feed.example.org/new")\n');
  repo.commit('feed');
  const store = new Store(tempFolder('apostil-store-'));
  const map: RepoMap = { format: 1, diagrams: [{ id: 'top', kind: 'flow', title: 'The parts', mermaid: 'flowchart LR\n  src["Code"]', nodePaths: { src: ['src/'] } }] };
  assert.deepEqual(saveMapDraft(store, repo.folder, map).problems, []);
  return { repo, store, repoName: repoId(repo.folder) };
}

const marks = (extra: Record<string, unknown> = {}) => ({
  group: 'src-one', set: 'services', files: ['src/feed.py'], ...extra,
  marks: [{ value: 'bookfeed', file: 'src/feed.py', line: 4, name: 'requests.get', relation: 'calls' }],
});
const NEW = { id: 'bookfeed', name: 'Book Feed', site: 'feed.example.org' };

test('apostil icon keeps a picture of the service\'s own site, and a page gives the picture of its link rel="icon"', async () => {
  const { repo, store, repoName } = setUp();
  // A picture, for a service that the next add-marks declares: it waits in the store.
  const picture = web({ 'https://feed.example.org/favicon.ico': { type: 'image/png', body: PNG } });
  const first = await saveIcon(store, repo.folder, 'bookfeed', 'https://feed.example.org/favicon.ico', { site: 'feed.example.org' }, picture.fetcher);
  assert.deepEqual(first, { saved: true, icon: 'png' });
  assert.equal(existsSync(store.iconFile('services', 'bookfeed', 'png')), true);
  // add-marks takes the waiting picture as the icon, with no "icon" and no "iconRefused".
  assert.deepEqual(addMarksToMap(store, repo.folder, marks({ values: [NEW] })).problems, []);
  assert.equal(valuesOf(store, repoName, 'services').find((one) => one.id === 'bookfeed')?.icon, 'png');

  // A page: the best icon that fits is taken (the apple-touch icon is larger than the 16 pixel one), and a known service keeps it at once.
  const page = web({ 'https://feed.example.org/': { type: 'text/html', body: PAGE }, 'https://feed.example.org/small.png': { body: PNG }, 'https://feed.example.org/touch.png': { body: SVG } });
  const second = await saveIcon(store, repo.folder, 'bookfeed', 'https://feed.example.org/', {}, page.fetcher);
  assert.deepEqual(second, { saved: true, icon: 'svg' });
  assert.deepEqual(page.asked, ['https://feed.example.org/', 'https://feed.example.org/touch.png']);
  assert.equal(valuesOf(store, repoName, 'services').find((one) => one.id === 'bookfeed')?.icon, 'svg');
});

test('apostil icon refuses a host that is not the site, a picture over 100 KB, a redirect to another host, and a service with no known site', async () => {
  const { repo, store } = setUp();
  const own = { site: 'feed.example.org' };
  const elsewhere = web({ 'https://other.example.net/icon.png': { body: PNG } });
  const wrongHost = await saveIcon(store, repo.folder, 'bookfeed', 'https://other.example.net/icon.png', own, elsewhere.fetcher);
  assert.match(wrongHost.problem!, /other\.example\.net is not the site of "bookfeed", which is feed\.example\.org/);
  assert.deepEqual(elsewhere.asked, []);
  // With --other-site (the owner said yes) the host may differ.
  assert.equal((await saveIcon(store, repo.folder, 'bookfeed', 'https://other.example.net/icon.png', { ...own, otherSite: true }, elsewhere.fetcher)).saved, true);

  const big = web({ 'https://feed.example.org/big.png': { body: BIG } });
  assert.match((await saveIcon(store, repo.folder, 'bookfeed', 'https://feed.example.org/big.png', own, big.fetcher)).problem!, /is 102 KB\. Give an icon of at most 100 KB/);

  const redirect = web({ 'https://feed.example.org/go.png': { status: 302, location: 'https://cdn.example.net/icon.png' }, 'https://cdn.example.net/icon.png': { body: PNG } });
  const bounced = await saveIcon(store, repo.folder, 'bookfeed', 'https://feed.example.org/go.png', own, redirect.fetcher);
  assert.match(bounced.problem!, /cdn\.example\.net is not the site/);
  assert.deepEqual(redirect.asked, ['https://feed.example.org/go.png']);
  // A redirect inside the site is followed.
  const inside = web({ 'https://feed.example.org/go.png': { status: 301, location: 'https://static.feed.example.org/icon.png' }, 'https://static.feed.example.org/icon.png': { body: PNG } });
  assert.equal((await saveIcon(store, repo.folder, 'bookfeed', 'https://feed.example.org/go.png', own, inside.fetcher)).saved, true);

  assert.match((await saveIcon(store, repo.folder, 'bookfeed', 'http://feed.example.org/a.png', own, web({}).fetcher)).problem!, /not an https address/);
  assert.match((await saveIcon(store, repo.folder, 'unknown', 'https://feed.example.org/a.png', {}, web({}).fetcher)).problem!, /not known yet. Give its site/);
});

test('add-marks refuses a service with no icon, and saves it with an icon file, a waiting icon or an iconRefused entry; marks lists noIcon', async () => {
  const { repo, store, repoName } = setUp();
  const refused = addMarksToMap(store, repo.folder, marks({ values: [NEW] }));
  assert.equal(refused.saved, false);
  assert.deepEqual(refused.problems, ['Service "Book Feed" has no icon. Run apostil icon bookfeed https://feed.example.org --site feed.example.org, or name a picture of its own website in "icon"; when its website gives none, add it to "iconRefused" with the address that you tried.']);

  const tried = addMarksToMap(store, repo.folder, marks({ values: [NEW], iconRefused: [{ value: 'bookfeed', tried: 'https://feed.example.org' }] }));
  assert.equal(tried.saved, true, tried.problems.join('\n'));
  // The service still has marks and no icon: marks lists it, with its site, for the main agent to try again.
  const facts = markFacts(repo.folder, store.getMap(repoName)!.map, setsOf(store, repoName), (set) => valuesOf(store, repoName, set));
  assert.deepEqual(facts.noIcon, [{ id: 'bookfeed', name: 'Book Feed', site: 'feed.example.org' }]);

  // The icon comes by apostil icon: the service has an icon, and the next save of its marks is no longer refused or listed.
  const web2 = web({ 'https://feed.example.org/favicon.ico': { body: PNG } });
  assert.equal((await saveIcon(store, repo.folder, 'bookfeed', 'https://feed.example.org/favicon.ico', {}, web2.fetcher)).saved, true);
  assert.equal(store.getMap(repoName)!.map.iconRefused, undefined);
  assert.equal(addMarksToMap(store, repo.folder, marks()).saved, true);
  assert.deepEqual(markFacts(repo.folder, store.getMap(repoName)!.map, setsOf(store, repoName), (set) => valuesOf(store, repoName, set)).noIcon, []);
  assert.equal(store.getMap(repoName)!.map.iconRefused, undefined);
});
