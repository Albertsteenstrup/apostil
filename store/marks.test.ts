// Tests for the marks and the look: add-marks with its checks and its icons, mark-groups with candidates, marks whose line changed, marks and look,
// and set-look with its checks and its files. A made-up repo with made-up services; no test reaches a network.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { repoId } from '../shared/git';
import { markFacts, markGroups, marksNow, SERVICES } from '../shared/marks';
import type { RepoMap } from '../shared/repo-map';
import { Store } from '../shared/store';
import { makeTestRepo, runApostil, tempFolder } from '../shared/test-repo';
import { addMarksToMap, setLook, setsOf, valuesOf } from './marks-save';
import { saveMapDraft } from './save';

const FEED = [
  'import os', //                                              1
  'import requests', //                                        2
  '', //                                                       3
  'FEED_URL = os.environ["FEED_API_URL"]', //                  4
  '', //                                                       5
  'def read_feed():', //                                       6
  '    return requests.get("https://feed.example.org/new")', // 7
  '', //                                                       8
  'def save_rows(db, rows):', //                               9
  '    db.execute("insert into book_row values (%s)", rows)', // 10
  '    db.execute("insert into book_log values (%s)", rows)', // 11
].join('\n') + '\n';
const QUIET = 'def add(a, b):\n    return a + b\n';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex'); // the start of a PNG is enough for its check
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#2b6cb0"/></svg>';

/** A repo with a feed file and a quiet file, a saved map with one area, and a store of its own. */
function setUp() {
  const repo = makeTestRepo();
  repo.write('src/feed.py', FEED);
  repo.write('src/quiet.py', QUIET);
  repo.write('docs/guide.md', '# Guide\n');
  repo.commit('feed');
  const store = new Store(tempFolder('apostil-store-'));
  const map: RepoMap = { format: 1, diagrams: [{ id: 'top', kind: 'flow', title: 'The parts', mermaid: 'flowchart LR\n  src["Code"] --> docs["Docs"]', nodePaths: { src: ['src/'], docs: ['docs/', 'README.md', 'generated/'] } }] };
  assert.deepEqual(saveMapDraft(store, repo.folder, map).problems, []);
  return { repo, store, map: () => store.getMap(repoId(repo.folder))!.map };
}

const services = (group: string, marks: unknown[], more: Record<string, unknown> = {}) => ({ group, set: 'services', marks, ...more });
const FEED_SERVICE = { id: 'bookfeed', name: 'Bookfeed', site: 'https://feed.example.org/' };
const STORE_SERVICE = { id: 'tablestore', name: 'Tablestore', site: 'tablestore.example.org' };

test('add-marks saves the marks of a group, replaces only what that group saved for that set, keeps the marks of other groups and other sets, and keeps an icon in the store', () => {
  const { repo, store, map } = setUp();
  const first = addMarksToMap(store, repo.folder, services('src-one', [
    { value: 'bookfeed', file: 'src/feed.py', line: 7, name: 'requests.get', relation: 'calls' },
  ], { values: [FEED_SERVICE], files: ['src/feed.py'] }));
  assert.equal(first.saved, true, first.problems.join('\n'));
  const second = addMarksToMap(store, repo.folder, services('src-two', [
    { value: 'tablestore', file: 'src/quiet.py', line: 2, name: 'return', relation: 'stores' },
  ], { values: [STORE_SERVICE], files: ['src/quiet.py'] }));
  assert.equal(second.saved, true, second.problems.join('\n'));
  assert.deepEqual(map().marks?.map((mark) => `${mark.group}:${mark.value}:${mark.line}`), ['src-one:bookfeed:7', 'src-two:tablestore:2']);
  // The site is kept in one form, and the text of the line with the mark.
  assert.equal(valuesOf(store, repoId(repo.folder), 'services').find((value) => value.id === 'bookfeed')?.site, 'feed.example.org');
  assert.equal(map().marks?.[0].code, FEED.split('\n')[6]);
  // The first group saves again: its old marks go, the second group keeps its marks.
  const again = addMarksToMap(store, repo.folder, services('src-one', [
    { value: 'tablestore', file: 'src/feed.py', line: 10, name: 'book_row', relation: 'stores', thing: { kind: 'table', name: 'book_row' } },
    { value: 'tablestore', file: 'src/feed.py', line: 11, name: 'book_log', relation: 'stores', thing: { kind: 'table', name: 'book_log' } },
  ], { files: ['src/feed.py'] }));
  assert.equal(again.saved, true, again.problems.join('\n'));
  assert.deepEqual(map().marks?.map((mark) => `${mark.group}:${mark.value}:${mark.line}`), ['src-two:tablestore:2', 'src-one:tablestore:10', 'src-one:tablestore:11']);
  assert.deepEqual(map().marks?.[1].thing, { kind: 'table', name: 'book_row' });
  // A save of another set leaves the services as they are.
  setLook(store, repo.folder, { sets: [{ id: 'checks', name: 'Checks', rule: 'Mark each line that checks an input.', corner: { node: 'lower-left', note: 'upper-left' }, values: [{ id: 'input', name: 'An input' }] }], rules: [] });
  assert.equal(addMarksToMap(store, repo.folder, { group: 'src-one', set: 'checks', marks: [{ value: 'input', file: 'src/quiet.py', line: 1, name: 'add' }] }).saved, true);
  assert.equal(map().marks?.length, 4);
  assert.deepEqual(setsOf(store, repoId(repo.folder)).map((set) => set.id), ['services', 'checks']);
  // A save of the map keeps the marks.
  saveMapDraft(store, repo.folder, { format: 1, diagrams: map().diagrams });
  assert.equal(map().marks?.length, 4);

  // add-marks through the command keeps an icon in the store by set and value, and removes its draft file and its icon files after a save that worked.
  writeFileSync(join(repo.folder, 'apostil-icon-bookfeed.svg'), SVG);
  writeFileSync(join(repo.folder, 'apostil-icon-tablestore.png'), PNG);
  const draft = join(repo.folder, 'apostil-marks-src-one.json');
  writeFileSync(draft, JSON.stringify(services('src-one', [{ value: 'bookfeed', file: 'src/feed.py', line: 7, name: 'requests', relation: 'calls' }], {
    values: [{ ...FEED_SERVICE, icon: 'apostil-icon-bookfeed.svg' }, { ...STORE_SERVICE, icon: 'apostil-icon-tablestore.png' }],
    iconRefused: [{ value: 'tablestore', tried: 'tablestore.example.org' }],
  })));
  const run = runApostil(['add-marks', draft], { cwd: repo.folder, env: { APOSTIL_HOME: store.folder } });
  const output = JSON.parse(run.stdout);
  assert.equal(output.saved, true, run.stdout);
  assert.equal(output.draftRemoved, true);
  assert.deepEqual(output.iconsRemoved, ['apostil-icon-bookfeed.svg', 'apostil-icon-tablestore.png']);
  for (const name of ['apostil-marks-src-one.json', 'apostil-icon-bookfeed.svg', 'apostil-icon-tablestore.png']) assert.equal(existsSync(join(repo.folder, name)), false, name);
  assert.equal(readFileSync(store.iconFile('services', 'bookfeed', 'svg'), 'utf8'), SVG);
  // A value that has its icon now is no longer refused.
  assert.deepEqual(map().iconRefused, undefined);
  // Another repo knows the service and its icon with no new fetch.
  const other = makeTestRepo();
  assert.deepEqual(valuesOf(store, repoId(other.folder), 'services').map((value) => [value.id, value.icon]), [['bookfeed', 'svg'], ['tablestore', 'png']]);
  // A refused icon is listed by apostil marks.
  addMarksToMap(store, repo.folder, services('src-two', [], { values: [{ id: 'mailroom', name: 'Mailroom', site: 'mailroom.example.org' }], iconRefused: [{ value: 'mailroom', tried: 'mailroom.example.org' }] }));
  const marks = runApostil(['marks'], { cwd: repo.folder, env: { APOSTIL_HOME: store.folder } });
  assert.deepEqual(JSON.parse(marks.stdout).iconRefused, [{ set: 'services', value: 'mailroom', tried: 'mailroom.example.org' }]);
  other.remove();
  repo.remove();
});

test('add-marks refuses each fault with one sentence that a model can act on, and saves nothing', () => {
  const { repo, store, map } = setUp();
  addMarksToMap(store, repo.folder, services('src-one', [], { values: [FEED_SERVICE] }));
  const refused = (draft: unknown): string => {
    const result = addMarksToMap(store, repo.folder, draft);
    assert.equal(result.saved, false);
    return result.problems.join('\n');
  };
  const mark = (more: Record<string, unknown>) => services('src-one', [{ value: 'bookfeed', file: 'src/feed.py', line: 7, name: 'requests.get', relation: 'calls', ...more }]);
  assert.match(refused(mark({ file: 'src/gone.py' })), /the file src\/gone\.py is no file of the repo/);
  assert.match(refused(mark({ line: 40 })), /line 40 is not inside src\/feed\.py, which has 12 lines/);
  assert.match(refused(mark({ name: 'post' })), /line 7 does not hold "post" \(it holds "return requests\.get/);
  assert.match(refused(mark({ value: 'unknown-service' })), /"unknown-service" is no known value of the set "services"\. Declare it once in "values" with its "name" and "site"/);
  assert.match(refused(mark({ relation: 'reads' })), /"relation" must be one of "calls", "stores", "sends", "runs on"/);
  assert.match(refused(mark({ thing: { kind: 'big table', name: 'book_row' } })), /"thing" must be \{ "kind": one word/);
  assert.match(refused(services('src-one', [{ value: 'new-one', file: 'src/feed.py', line: 7, name: 'requests', relation: 'calls' }], { values: [{ id: 'new-one', name: 'New one' }] })), /The value "new-one" is a new service, so give its "site"/);
  assert.match(refused(services('src-one', [], { values: [{ id: 'feed-two', name: 'Feed two', site: 'www.feed.example.org' }] })), /has the web address feed\.example\.org, as the service "bookfeed"\. Use the id "bookfeed"/);
  const twice = { value: 'bookfeed', file: 'src/feed.py', line: 7, name: 'requests', relation: 'calls' };
  assert.match(refused(services('src-one', [twice, twice])), /"bookfeed" has a mark at this line already\. Keep one mark for one value at one line/);
  assert.match(refused({ group: 'src-one', set: 'nothing', marks: [] }), /"nothing" is no mark set of this repo/);
  assert.match(refused({ group: 'Src One', set: 'services' }), /"group" must be the name of your group[\s\S]*"marks" must be a list of marks/);
  // The icon: a known kind, at most 100 KB, and an SVG with no script, no event attribute and no outside address.
  const icon = (name: string, body: Buffer | string) => {
    writeFileSync(join(repo.folder, name), body);
    return refused(services('src-one', [], { values: [{ id: 'bookfeed', icon: name }] }));
  };
  assert.match(icon('apostil-icon-bookfeed.gif', 'GIF89a'), /is no PNG, SVG, ICO, WebP file/);
  assert.match(icon('apostil-icon-bookfeed.png', 'not a picture'), /is not a PNG file inside/);
  assert.match(icon('apostil-icon-bookfeed.png', Buffer.concat([PNG, Buffer.alloc(101 * 1024)])), /is 102 KB\. Give an icon of at most 100 KB/);
  assert.match(icon('apostil-icon-bookfeed.svg', SVG.replace('<circle', '<script>x()</script><circle')), /holds a script, an event attribute or an outside address/);
  assert.match(icon('apostil-icon-bookfeed.svg', SVG.replace('<circle', '<circle onclick="x()"')), /holds a script, an event attribute or an outside address/);
  assert.match(icon('apostil-icon-bookfeed.svg', SVG.replace('<circle', '<image href="https://example.org/a.png"/><circle')), /holds a script, an event attribute or an outside address/);
  assert.equal(map().marks?.length ?? 0, 0);
  repo.remove();
});

test('mark-groups gives the files of services with their candidates, by area, and a second run lists only the files that changed or whose mark is hidden', () => {
  const { repo, store, map } = setUp();
  const first = markGroups(repo.folder, map(), 'services');
  assert.deepEqual(first.groups.map((group) => group.area), ['src']);
  const [feed] = first.groups[0].files;
  assert.equal(feed.path, 'src/feed.py');
  assert.deepEqual(feed.candidates?.map((one) => [one.line, one.why, one.may ?? '']), [
    [4, 'a key or an address read from the environment', 'feed'], [7, 'a web address', 'feed.example.org'], [10, 'a query of a database', ''], [11, 'a query of a database', ''],
  ]);
  // A file with no sign of a service is no work for the service writers; it is for the writers of a set of a look.
  assert.equal(first.groups.flatMap((group) => group.files).some((file) => file.path === 'src/quiet.py'), false);
  assert.ok(markGroups(repo.folder, map(), 'checks').groups.flatMap((group) => group.files).some((file) => file.path === 'src/quiet.py'));
  // After a save the file is done; a changed candidate line makes it work again.
  addMarksToMap(store, repo.folder, services(first.groups[0].name, [{ value: 'bookfeed', file: 'src/feed.py', line: 7, name: 'requests', relation: 'calls' }], { values: [FEED_SERVICE], files: ['src/feed.py'] }));
  assert.deepEqual(markGroups(repo.folder, map(), 'services').groups, []);
  assert.equal(markGroups(repo.folder, map(), 'services', true).groups.length, 1);
  repo.write('src/feed.py', FEED.replace('feed.example.org/new', 'feed.example.org/newer'));
  assert.deepEqual(markGroups(repo.folder, map(), 'services').groups.flatMap((group) => group.files.map((file) => file.path)), ['src/feed.py']);

  // A mark whose line changed is hidden until the next run, and apostil marks counts it with its file.
  repo.write('src/feed.py', FEED);
  addMarksToMap(store, repo.folder, services(first.groups[0].name, [
    { value: 'bookfeed', file: 'src/feed.py', line: 7, name: 'requests', relation: 'calls' },
    { value: 'tablestore', file: 'src/feed.py', line: 10, name: 'book_row', relation: 'stores' },
  ], { values: [FEED_SERVICE, STORE_SERVICE] }));
  // Two lines go in above: the marks move with their lines. Then one line changes: its mark is hidden.
  repo.write('src/feed.py', `# a new line\n# and another\n${FEED.replace('book_row', 'book_rows')}`);
  const now = marksNow(repo.folder, map().marks!);
  assert.deepEqual(now.map((one) => one.at), [9, undefined]);
  const facts = markFacts(repo.folder, map(), [SERVICES], (set) => valuesOf(store, repoId(repo.folder), set));
  assert.deepEqual(facts.sets[0], {
    id: 'services', name: 'Services', marks: 1,
    values: [{ id: 'bookfeed', name: 'Bookfeed', icon: false, marks: 1 }, { id: 'tablestore', name: 'Tablestore', icon: false, marks: 0 }],
    hidden: { count: 1, files: ['src/feed.py'] },
  });
  // The file with the hidden mark is work again for the service writers.
  assert.ok(markGroups(repo.folder, map(), 'services').groups.length > 0);
  repo.remove();
});

test('set-look keeps a look and its files in the store, removes its draft files, and refuses each fault with one sentence', () => {
  const { repo, store } = setUp();
  const repoFolder = repo.folder;
  writeFileSync(join(repoFolder, 'apostil-look-mark.svg'), SVG);
  writeFileSync(join(repoFolder, 'apostil-look-picture.png'), PNG);
  const look = {
    sets: [{ id: 'checks', name: 'Checks', rule: 'Mark each line that checks an input.', corner: { node: 'lower-left', note: 'upper-left' }, values: [{ id: 'input', name: 'An input', icon: 'apostil-look-mark.svg' }] }],
    rules: [
      { pick: { kind: 'node', paths: ['src/'] }, box: { color: '#2b6cb0', shape: 'cyl' } },
      { pick: { kind: 'node', diagram: 'top', nodes: ['docs'] }, content: { picture: 'apostil-look-picture.png' } },
      { pick: { kind: 'node', mark: 'services:*' }, corners: { 'upper-left': { icon: 'apostil-look-mark.svg', name: 'Open the feed', action: { file: 'src/feed.py', line: 7 } } } },
      { pick: { kind: 'note', mark: 'checks:input' }, note: { color: '#b45309' }, corners: { 'lower-right': { set: 'checks' } } },
      { pick: { kind: 'arrow', diagram: 'top' }, arrow: { color: '#2b6cb0', width: 2, dashed: true } },
    ],
  };
  const draft = join(repoFolder, 'apostil-look.json');
  writeFileSync(draft, JSON.stringify(look));
  const env = { APOSTIL_HOME: store.folder };
  const saved = JSON.parse(runApostil(['set-look', draft], { cwd: repoFolder, env }).stdout);
  assert.equal(saved.saved, true, JSON.stringify(saved));
  assert.deepEqual([saved.rules, saved.sets, saved.files, saved.draftRemoved], [5, ['checks'], 2, true]);
  assert.deepEqual(saved.filesRemoved, ['apostil-look-mark.svg', 'apostil-look-picture.png']);
  for (const name of ['apostil-look.json', 'apostil-look-mark.svg', 'apostil-look-picture.png']) assert.equal(existsSync(join(repoFolder, name)), false, name);
  const kept = JSON.parse(runApostil(['look'], { cwd: repoFolder, env }).stdout);
  const picture = kept.rules[1].content.picture;
  assert.match(picture, /^[0-9a-f]{16}\.png$/);
  assert.ok(existsSync(join(store.lookFolder(repoId(repoFolder)), picture)));
  assert.equal(kept.sets[0].values[0].icon, 'svg');
  assert.equal(readFileSync(store.iconFile('checks', 'input', 'svg'), 'utf8'), SVG);
  // The look as "apostil look" prints it names the files that Apostil keeps: sent again with one more rule, it saves, with no file in the repo.
  const again = setLook(store, repoFolder, { sets: kept.sets, rules: [...kept.rules, { pick: { kind: 'note' }, note: { color: '#15803d' } }] });
  assert.deepEqual([again.saved, again.problems, again.files], [true, [], 3]);
  // "apostil look-slots" prints the one list that the check reads: the components with their slots, the picks and every target.
  const parts = JSON.parse(runApostil(['look-slots'], { cwd: repoFolder, env }).stdout);
  assert.deepEqual([Object.keys(parts.components), parts.components.note.slots, Object.keys(parts.targets)], [
    ['node', 'step', 'call', 'arrow', 'note'], ['note', 'corners', 'content', 'show', 'click', 'input'],
    ['file', 'url', 'command', 'prompt', 'place', 'graphs', 'folder', 'change', 'pull', 'comment'],
  ]);
  // With no look, "apostil look" says that the default applies. (A store of its own: two test repos made in the same second have the same first commit.)
  assert.equal(JSON.parse(runApostil(['look'], { cwd: repoFolder, env: { APOSTIL_HOME: tempFolder('apostil-store-') } }).stdout).look, 'default');

  // Each fault is one sentence.
  const refused = (rule: unknown, sets: unknown[] = []): string => {
    const result = setLook(store, repoFolder, { sets, rules: [rule] });
    assert.equal(result.saved, false);
    return result.problems.join('\n');
  };
  assert.match(refused({ pick: { kind: 'box' }, box: {} }), /"pick" must name a "kind": one of node, step, call, arrow, note/);
  assert.match(refused({ pick: { kind: 'node' }, shade: { color: '#000000' } }), /"shade" is no slot/);
  assert.match(refused({ pick: { kind: 'arrow' }, box: { color: '#000000' } }), /an arrow has no slot "box"\. Its slots are "arrow"/);
  assert.match(refused({ pick: { kind: 'node' } }), /it changes nothing/);
  assert.match(refused({ pick: { kind: 'node', paths: ['src/gone/'] }, box: { color: '#000000' } }), /The path src\/gone\/ does not exist/);
  assert.match(refused({ pick: { kind: 'node', diagram: 'nowhere' }, box: { color: '#000000' } }), /"nowhere" is no diagram of the map/);
  assert.match(refused({ pick: { kind: 'node', diagram: 'top', nodes: ['web'] }, box: { color: '#000000' } }), /the diagram "top" has no node "web"\. Its nodes are src, docs/);
  assert.match(refused({ pick: { kind: 'node' }, box: { color: 'blue' } }), /"color" must be one colour as "#rrggbb"/);
  assert.match(refused({ pick: { kind: 'node' }, box: { shape: 'star' } }), /"star" is no shape/);
  assert.match(refused({ pick: { kind: 'node', mark: 'tags:x' }, box: { color: '#000000' } }), /"tags" is no mark set/);
  assert.match(refused({ pick: { kind: 'node' }, corners: { 'upper-right': { set: 'tags' } } }), /must name a mark set/);
  assert.match(refused({ pick: { kind: 'node' }, corners: { middle: null } }), /"corners": "middle" is no field here\. Use only "upper-left"/);
  assert.match(refused({ pick: { kind: 'node' }, corners: { 'upper-left': { icon: 'x.svg', name: 'Go', action: { run: 'ls' } } } }), /"action": "run" is no target\. The targets are "file", "url", "command", "prompt", "place", "graphs"/);
  assert.match(refused({ pick: { kind: 'node' }, corners: { 'upper-left': { icon: 'x.svg', name: 'Go', action: { command: 'workbench.action.quit' } } } }), /"workbench\.action\.quit" is no command of Apostil/);
  assert.match(refused({ pick: { kind: 'node' }, corners: { 'upper-left': { icon: 'x.svg', name: 'Go', action: { file: 'src/feed.py', line: 99 } } } }), /line 99 is not inside src\/feed\.py/);
  assert.match(refused({ pick: { kind: 'node' }, corners: { 'upper-left': { icon: 'x.svg', name: 'Go', action: { place: { diagram: 'nowhere' } } } } }), /"place" must name a diagram of the map/);
  assert.match(refused({ pick: { kind: 'node' }, corners: { 'upper-left': { icon: 'x.svg', name: 'Go', action: { place: { diagram: 'top', node: 'web' } } } } }), /the diagram "top" has no node "web"/);
  assert.match(refused({ pick: { kind: 'node' }, content: { picture: 'docs/guide.md' } }), /The file docs\/guide\.md is no PNG, JPEG, GIF, WebP, SVG file/);
  assert.match(refused({ pick: { kind: 'node' }, content: { film: 'docs/none.mp4' } }), /The file docs\/none\.mp4 does not exist/);
  // A film is an MP4 file with H.264 video: a real VS Code window played that kind and opened no WebM file.
  writeFileSync(join(repoFolder, 'apostil-look-tour.webm'), Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]));
  assert.match(refused({ pick: { kind: 'node' }, content: { film: 'apostil-look-tour.webm' } }), /The file apostil-look-tour\.webm is no MP4 file\. Give a film as one of these: MP4\./);
  writeFileSync(join(repoFolder, 'apostil-look-tour.mp4'), Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom....hvc1....', 'latin1')]));
  assert.match(refused({ pick: { kind: 'node' }, content: { film: 'apostil-look-tour.mp4' } }), /The film apostil-look-tour\.mp4 holds no H\.264 video\. VS Code plays a film only as an MP4 file with H\.264 video/);
  assert.match(refused({ pick: { kind: 'node' }, box: { color: '#000000' } }, [{ id: 'services', name: 'S', rule: 'r', corner: { node: 'upper-left', note: 'upper-left' } }]), /is the built-in set of services/);
  repo.remove();
});
