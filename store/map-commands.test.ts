// Tests for the store of the map, add-diagram, and the map commands through the command line.

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { headCommit, repoId } from '../shared/git';
import type { RepoMap } from '../shared/repo-map';
import { Store } from '../shared/store';
import { makeTestRepo, runApostil, tempFolder, testChangeFile } from '../shared/test-repo';
import { addDiagramToMap, saveDraft, saveMapDraft } from './save';

const testMap = (title = 'The test repo'): RepoMap => ({
  format: 1,
  diagrams: [{ id: 'top', kind: 'flow', title, mermaid: 'flowchart LR\n  code --> docs', nodePaths: { code: ['src/'], docs: ['README.md'] } }],
});
const areaDiagram = (id: string, paths: string[] = ['src/app.py']) =>
  ({ id, kind: 'flow', title: `Area ${id}`, mermaid: 'flowchart LR\n  a --> b', parent: 'top', nodePaths: { a: paths, b: ['README.md'] } });

test('a new save of the map replaces the old one and keeps the commit; add-diagram adds, replaces and keeps the diagrams of earlier adds, and refuses a diagram with no parent, a repo with no map and a wrong shape', () => {
  const store = new Store(tempFolder('apostil-home-'));
  const repo = makeTestRepo();
  const id = repoId(repo.folder);
  assert.match(addDiagramToMap(store, repo.folder, areaDiagram('one')).problems[0], /no saved map/);
  assert.equal(store.getMap(id), undefined);

  assert.equal(saveMapDraft(store, repo.folder, testMap('First')).saved, true);
  assert.equal(saveMapDraft(store, repo.folder, testMap('Second')).saved, true);
  const stored = store.getMap(id);
  assert.equal(stored?.map.diagrams[0].title, 'Second');
  assert.equal(stored?.commit, headCommit(repo.folder));
  assert.ok(stored?.savedAt);
  assert.equal(saveMapDraft(store, repo.folder, { format: 1, diagrams: [] }).saved, false);
  assert.equal(store.getMap(id)?.map.diagrams[0].title, 'Second');

  saveMapDraft(store, repo.folder, testMap());
  const { parent, ...top } = areaDiagram('other');
  assert.match(addDiagramToMap(store, repo.folder, top).problems[0], /parent/);
  assert.equal(addDiagramToMap(store, repo.folder, { ...areaDiagram('x'), mermaid: 5 }).saved, false);
  assert.equal(addDiagramToMap(store, repo.folder, null).saved, false);
  assert.deepEqual(store.getMap(id)?.map.diagrams.map((diagram) => diagram.id), ['top']);
  const first = addDiagramToMap(store, repo.folder, areaDiagram('one'));
  // The area leaves out src/new_tool.py, a file under the paths of the node of the top map that it hangs under.
  assert.deepEqual(first, { saved: true, problems: [], checks: { badPaths: [], badNodes: [], badParents: [], topMaps: [], sharedFiles: [], uncovered: { count: 1, paths: ['src/new_tool.py'] } } });
  assert.equal(addDiagramToMap(store, repo.folder, areaDiagram('two')).saved, true);
  assert.deepEqual(store.getMap(id)?.map.diagrams.map((diagram) => diagram.id), ['top', 'one', 'two']);
  addDiagramToMap(store, repo.folder, { ...areaDiagram('one'), title: 'New title' });
  assert.deepEqual(store.getMap(id)?.map.diagrams.map((diagram) => [diagram.id, diagram.title]), [['top', 'The test repo'], ['two', 'Area two'], ['one', 'New title']]);
  store.close();
  repo.remove();
});

test('the map commands print what the contract says', () => {
  const repo = makeTestRepo();
  const home = tempFolder('apostil-home-');
  const drafts = tempFolder('apostil-draft-');
  const apostil = (...args: string[]) => runApostil([...args, '--folder', repo.folder], { env: { APOSTIL_HOME: home } });
  const area = join(drafts, 'area.json');
  writeFileSync(area, JSON.stringify(areaDiagram('one', ['nope/'])));

  assert.equal(apostil('map').status, 1);
  assert.equal(apostil('add-diagram', area).status, 1); // no map yet
  const material = JSON.parse(apostil('map-material').stdout);
  assert.deepEqual(material.rootFiles, ['README.md']);
  assert.deepEqual(material.folders.map((folder: { path: string; files: number }) => [folder.path, folder.files]), [['generated/', 1], ['src/', 2]]);
  assert.equal(material.folders[1].largest[0].path, 'src/app.py');
  assert.equal(material.folders[1].largest[0].lines, 6);
  assert.equal(material.map, null);

  const bad = join(drafts, 'bad.json');
  writeFileSync(bad, JSON.stringify({ ...testMap(), diagrams: [{ ...testMap().diagrams[0], nodePaths: { code: ['nope/'] } }] }));
  const checked = apostil('check-map', bad);
  assert.equal(checked.status, 0);
  assert.equal(JSON.parse(checked.stdout).saved, false);
  assert.equal(JSON.parse(checked.stdout).checks.badPaths.length, 1);
  assert.equal(apostil('save-map', join(drafts, 'bad.json')).status, 0);
  assert.equal(apostil('map').status, 0); // a map with a bad path is stored, as a change file with a bad note is

  const draft = join(drafts, 'map.json');
  writeFileSync(draft, JSON.stringify(testMap()));
  const saved = JSON.parse(apostil('save-map', draft).stdout);
  // The top map leaves out generated/api.json: a note with the count and the path, not a refusal.
  assert.deepEqual(saved, { saved: true, problems: [], checks: { badPaths: [], badNodes: [], badParents: [], topMaps: [], sharedFiles: [], uncovered: { count: 1, paths: ['generated/'] } } });

  const shown = JSON.parse(apostil('map').stdout);
  assert.equal(shown.notes, 0);
  assert.equal(shown.notedFiles, 0);
  assert.match(shown.hint, /2 code files need notes\. Notes on the code as it is come with the map and need no change and no commit/); // an agent that is asked for notes reads this
  assert.equal(shown.map.diagrams[0].id, 'top');
  assert.equal(shown.commit, headCommit(repo.folder));
  assert.equal(JSON.parse(apostil('map-material').stdout).map.map.diagrams[0].id, 'top');

  const wrong = join(drafts, 'wrong.json');
  writeFileSync(wrong, JSON.stringify({ format: 2 }));
  const refused = apostil('save-map', wrong);
  assert.equal(refused.status, 1);
  assert.equal(JSON.parse(refused.stdout).saved, false);

  const store = new Store(home);
  saveDraft(store, repo.folder, testChangeFile());
  store.close();
  const found = JSON.parse(apostil('diagrams-of', 'src/app.py').stdout);
  assert.deepEqual(found.map((entry: { level: string }) => entry.level), ['map', 'change', 'function']);
  assert.equal(found[0].diagram.id, 'top');
  assert.equal(found[0].diagram.mermaid, undefined);
  assert.deepEqual(found[0].lit, ['code']);
  assert.equal(JSON.parse(apostil('diagrams-of', 'src/app.py', '--full').stdout)[0].diagram.mermaid, 'flowchart LR\n  code --> docs');
  assert.deepEqual(JSON.parse(apostil('diagrams-of', 'nothing.txt').stdout), []);
  assert.equal(apostil('diagrams-of').status, 1);

  // add-diagram lists a path that does not exist, and still adds the diagram.
  const added = apostil('add-diagram', area);
  assert.equal(added.status, 0);
  assert.deepEqual(JSON.parse(added.stdout).checks.badPaths.length, 1);
  assert.equal(JSON.parse(apostil('map').stdout).map.diagrams.length, 2);
  repo.remove();
});
