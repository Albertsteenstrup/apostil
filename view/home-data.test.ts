// Tests for what Home and the graphs page show, on a small real repo with a map and a stored change.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { Diagram } from '../shared/change-file';
import { checkChangeFile } from '../shared/checks';
import { headCommit, repoId } from '../shared/git';
import type { RepoMap } from '../shared/repo-map';
import { homeRun } from '../shared/map-run';
import { Store } from '../shared/store';
import { makeTestRepo, tempFolder, testChangeFile } from '../shared/test-repo';
import { diagramPaths, graphsData, homeData, inDiagrams, nodeTags, whereLine, writtenLine } from './home-data';
import { branchPage, filePage, pageData } from './page-data';

const repo = makeTestRepo();
const store = new Store(tempFolder());
after(() => { store.close(); repo.remove(); });

const diagram = (id: string, nodePaths: Record<string, string[]>, parent?: string): Diagram =>
  ({ id, kind: 'flow', title: `Title of ${id}`, mermaid: 'flowchart LR\n  a --> b', nodePaths, ...(parent ? { parent } : {}) });

/** A top map with three areas, and one diagram under the code area. */
const testMap = (): RepoMap => ({
  format: 1,
  diagrams: [
    diagram('top', { code: ['src/'], docs: ['README.md'], api: ['generated/'] }),
    diagram('code', { app: ['src/app.py'], tool: ['src/new_tool.py'] }, 'top'),
  ],
});

const changeId = store.saveChange({
  repoId: repoId(repo.folder), folder: repo.folder, branch: 'feature', base: repo.base, head: headCommit(repo.folder),
  file: testChangeFile(), checks: checkChangeFile(repo.folder, repo.base, testChangeFile()),
});

test('Home: with no map it offers each installed app to write one; with a map it has the top map, each node with its paths, file count, changes and level down, and says how many commits ago the map was written', () => {
  const home = homeData(store, repo.folder, ['claude-code']);
  assert.equal(home.kind, 'home');
  assert.equal(home.map, undefined);
  assert.deepEqual(home.apps, ['claude-code']);
  assert.match(home.repo, /^apostil-repo-/);

  // A repo with a map: Home has the top map, each node with its paths, its file count, the changes that touch it and the level down.
  {
    store.saveMap(repoId(repo.folder), headCommit(repo.folder), testMap());
    const home = homeData(store, repo.folder);
    assert.equal(home.map?.top, 'top');
    assert.equal(home.map?.written, undefined); // written at the commit that the folder is at
    const top = home.map!.diagrams.find((one) => one.id === 'top')!;
    assert.deepEqual(top.nodes.code.paths, [{ path: 'src/', files: 2 }]);
    assert.equal(top.nodes.code.files, 2);
    // Each change carries the files of the node that it changes, with their counts from Git.
    const files = [{ path: 'src/app.py', added: 5, removed: 1, status: 'changed' }, { path: 'src/new_tool.py', added: 2, removed: 0, status: 'added' }];
    assert.deepEqual(top.nodes.code.changes, [{ id: changeId, branch: 'feature', title: 'Adds a stop function and a tool', files }]);
    assert.deepEqual(home.map!.diagrams.find((one) => one.id === 'code')!.nodes.app.changes[0].files, [files[0]]); // only the files of that node
    assert.deepEqual(top.nodes.docs.changes, []); // the change does not name README.md
    assert.deepEqual(top.nodes.api.changes, []); // nor its generated files
    assert.equal(top.nodes.code.down, 'code'); // the diagram under the top map covers src/
    assert.equal(top.nodes.docs.down, undefined);
    assert.equal(top.nodes.docs.graphs, 'README.md'); // no level down: a click opens the graphs of its path
    assert.equal(top.nodes.api.graphs, 'generated/');
  }

  // A map written at an earlier commit says how many commits ago.
  const at = headCommit(repo.folder);
  repo.write('later.txt', 'later\n');
  repo.commit('later');
  assert.equal(writtenLine(repo.folder, at), 'written 1 commit ago');
  assert.equal(writtenLine(repo.folder, '0'.repeat(40)), 'written at another commit');
});

test('the panels of a path in a map node, a change and a function diagram, the widest first, each with what it lights, where it opens and where the path is in words; a folder gets its "/" and a path in nothing has no panels', () => {
  const graphs = graphsData(store, repo.folder, 'src/app.py');
  assert.equal(graphs.path, 'src/app.py');
  assert.deepEqual(graphs.panels.map((panel) => [panel.level, panel.from, panel.lit.join()]), [
    ['map', 'the map', 'code'],
    ['map', 'the map', 'app'],
    ['change', 'change · branch feature', 'ap0'],
    ['function', 'function · branch feature', 'ask,done'],
  ]);
  // Each click is a step of the path, named with the title that its view shows; the top map is Home.
  assert.deepEqual(graphs.panels[0].open, { tab: 'home', diagram: '', lit: ['code'], name: 'Home' });
  assert.deepEqual(graphs.panels[1].open, { tab: 'home', diagram: 'code', lit: ['app'], name: 'Title of code' });
  assert.deepEqual(graphs.panels[2].open, { tab: 'change', change: changeId, go: { level: 'change', lit: ['app'] }, name: 'Adds a stop function and a tool' });
  assert.deepEqual(graphs.panels[3].open, { tab: 'change', change: changeId, go: { level: 'part', part: 'app', diagram: 'stop-flow', lit: ['ask', 'done'] }, name: 'App' });
  assert.match(graphs.panels[2].mermaid, /<b data-part='app'>App<\/b>/);
  assert.match(graphs.panels[3].mermaid, /Return 0<span class='ln'>line 6<\/span>/);
  // Under each panel, in words, where the file is: the name of its one lit node or part.
  assert.deepEqual(graphs.panels.map((panel) => panel.where), ['in: code', 'in: app', 'in: App', 'in 2 nodes']);

  // Where a path is, in words: one node by its name, more by their count, none for the whole diagram.
  assert.equal(whereLine(['Dev server']), 'in: Dev server');
  assert.equal(whereLine(['A', 'B', 'C']), 'in 3 nodes');
  assert.equal(whereLine(['A', 'B'], 'parts'), 'in 2 parts');
  assert.equal(whereLine([]), 'in the whole diagram');

  // A folder gets its "/" and lights what lies inside it; a path in nothing has no panels.
  const folder = graphsData(store, repo.folder, 'src');
  assert.equal(folder.path, 'src/');
  assert.deepEqual(folder.panels.map((panel) => panel.level), ['map', 'map', 'change', 'function']);
  assert.deepEqual(folder.panels[1].lit, ['app', 'tool']);
  assert.deepEqual(graphsData(store, repo.folder, 'later.txt').panels, []);
});

test('the Files tree marks a row that a diagram stands for and a folder above it, and the change page links a diagram that draws on a repo diagram to Home, or says that the map was written again since', () => {
  const paths = diagramPaths(store, repo.folder);
  assert.ok(inDiagrams(paths, 'src/app.py'));
  assert.ok(inDiagrams(paths, 'src/'));
  assert.ok(inDiagrams(paths, 'README.md'));
  assert.ok(!inDiagrams(paths, 'later.txt'));

  // A diagram that draws on a repo diagram ("of") links to it while the map holds it as its "before" has it; a wider diagram with no "of" names it by its own id.
  const STOP = 'flowchart TD\n  ask["Ask to stop"]';
  const map = testMap();
  map.diagrams.push({ id: 'stop-repo', kind: 'flow', title: 'How the app stops', mermaid: STOP, parent: 'top', file: 'src/app.py' });
  store.saveMap(repoId(repo.folder), headCommit(repo.folder), map);
  const onHome = (more: Partial<Diagram>) => {
    const file = testChangeFile();
    Object.assign(file.diagrams![0], { new: undefined }, more);
    const id = store.saveChange({ repoId: repoId(repo.folder), folder: repo.folder, branch: 'feature', base: repo.base, head: headCommit(repo.folder), file, checks: checkChangeFile(repo.folder, repo.base, file) });
    return pageData(store, id, repo.folder)!.onHome;
  };
  assert.deepEqual(onHome({}), {});
  assert.deepEqual(onHome({ of: 'stop-repo', before: STOP }), { 'stop-flow': { id: 'stop-repo', title: 'How the app stops' } });
  assert.deepEqual(onHome({ of: 'stop-repo', before: 'flowchart TD\n  ask["Ask"]' }), { 'stop-flow': { id: 'stop-repo', title: 'How the app stops', again: true } });
  assert.deepEqual(onHome({ of: 'stop-gone', before: STOP }), { 'stop-flow': { again: true } });
  assert.deepEqual(onHome({ id: 'stop-repo', broad: true }), { 'stop-repo': { id: 'stop-repo', title: 'How the app stops' } });
});

test('Home: the press starts the app that Apostil started last in this repo, from the map runs and the runs for a comment (the order itself: shared/map-app.test.ts)', () => {
  const own = new Store(tempFolder());
  try {
    const apps = ['claude-code', 'codex', 'opencode'];
    const id = repoId(repo.folder);
    const mapApp = (list = apps): string | undefined => homeData(own, repo.folder, list, undefined, undefined, ['codex']).mapApp;
    assert.equal(mapApp(), 'codex'); // nothing started yet: the first connected app
    own.changeMapRun(id, () => homeRun('opencode', '2026-11-10T10:00:00Z'));
    assert.equal(mapApp(), 'opencode');
    const remark = own.addRepoRemark(id, { kind: 'diagram', diagram: 'top' }, 'Check this');
    own.sendRemark(remark, { app: 'claude-code', kind: 'new' });
    own.startRemarkRun(remark, { startedAt: '2026-11-12T10:00:00Z' });
    assert.equal(mapApp(), 'claude-code'); // the newer run is a run for a comment
    assert.equal(mapApp([]), undefined); // no installed app
  } finally {
    own.close();
  }
});


test('nodeTags names the folders and files of each node in a few words: the name above a folder when two read the same, two at most then "+N", files after folders as "+N files"', () => {
  assert.deepEqual(nodeTags({
    web: ['web/'], routes: ['src/web/'], data: ['db/', 'scripts/', 'seeds/', 'backups/'], jobs: ['jobs/', 'night.py', 'clock.py'], one: ['src/a/main.py'], two: ['src/b/main.py', 'src/b/util.py'], none: [],
  }), { web: 'web/', routes: 'src/web/', data: 'db/ · scripts/ +2', jobs: 'jobs/ +2 files', one: 'a/main.py', two: 'b/main.py · util.py' });
});

test('with no change on the branch, a comment on code is one of the repo: the file tab and the open branch get the threads on files with the connected apps, and Home the others', () => {
  const id = repoId(repo.folder);
  const onCode = store.addRepoRemark(id, { kind: 'lines', file: 'src/app.py', lines: [1, 2], label: 'src/app.py, lines 1–2' }, 'Why this?');
  store.addRepoRemark(id, { kind: 'lines', file: 'src/app.py', lines: [1, 2], label: 'src/app.py, lines 1–2' }, 'Because.', onCode);
  const onMap = store.addRepoRemark(id, { kind: 'diagram', diagram: 'top', label: 'The map' }, 'And this?');
  const tab = filePage(repo.folder, ['claude-code'], store);
  assert.deepEqual([tab.apps, tab.remarks.map((remark) => remark.text), !!tab.sendTo], [['claude-code'], ['Why this?', 'Because.'], true]);
  const branch = branchPage(repo.folder, ['claude-code'], store); // the open branch with no change file, and its file tabs, have the same
  assert.deepEqual([branch.apps, branch.remarks.map((remark) => remark.text), !!branch.sendTo], [['claude-code'], ['Why this?', 'Because.'], true]);
  assert.ok(homeData(store, repo.folder).remarks.some((remark) => remark.id === onMap) && !homeData(store, repo.folder).remarks.some((remark) => remark.id === onCode));
});
