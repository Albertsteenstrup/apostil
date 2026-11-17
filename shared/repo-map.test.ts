// Tests for the shape and the checks of a map, and for the diagrams of a path.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { shapeProblems, type Diagram } from './change-file';
import { checkChangeFile } from './checks';
import { repoId } from './git';
import { checkMap, diagramsOf, mapProblems, type RepoMap } from './repo-map';
import { Store } from './store';
import { makeTestRepo, tempFolder, testChangeFile } from './test-repo';

const diagram = (id: string, nodePaths: Record<string, string[]>, parent?: string): Diagram =>
  ({ id, kind: 'flow', title: `Title of ${id}`, mermaid: `flowchart LR\n  ${Object.keys(nodePaths).map((node) => `${node}["${node}"]`).join('\n  ')}`, nodePaths, ...(parent ? { parent } : {}) });

/** A map that fits the test repo: a top map, and one diagram under it. */
const testMap = (): RepoMap => ({
  format: 1,
  diagrams: [
    diagram('top', { code: ['src/'], docs: ['README.md'], api: ['generated/'] }),
    diagram('code', { app: ['src/app.py'], tool: ['src/new_tool.py'] }, 'top'),
  ],
});

const tempStore = (): Store => new Store(tempFolder('apostil-home-'));
const repo = makeTestRepo(); // the last check adds files to it
after(() => repo.remove());

test('the shape of a map, of nodePaths and of parent is checked, and the example map of the skill has the right shape', () => {
  assert.deepEqual(mapProblems(testMap()), []);
  assert.ok(mapProblems({ format: 1, diagrams: [] }).length > 0);
  const noPaths = { format: 1, diagrams: [{ ...testMap().diagrams[0], nodePaths: undefined }] };
  assert.ok(mapProblems(noPaths).some((problem) => problem.includes('nodePaths')));
  const twice = { format: 1, diagrams: [testMap().diagrams[0], testMap().diagrams[0]] };
  assert.ok(mapProblems(twice).some((problem) => problem.includes('used twice')));
  const badPath = { format: 1, diagrams: [diagram('top', { a: ['/etc/passwd'], b: [] })] };
  assert.equal(mapProblems(badPath).filter((problem) => problem.includes('nodePaths')).length, 2);

  const change = testChangeFile();
  change.diagrams![0] = { ...change.diagrams![0], parent: '', nodePaths: { x: 'src/' as unknown as string[] } };
  assert.equal(shapeProblems(change).length, 2);

  // The example map of the skill has the right shape.
  const example = JSON.parse(readFileSync(join(__dirname, '../../skills/apostil-map-repo/example-map.json'), 'utf8'));
  assert.deepEqual(mapProblems(example), []);
  const area = JSON.parse(readFileSync(join(__dirname, '../../skills/apostil-map-repo/example-area-diagram.json'), 'utf8'));
  const both = { ...example, diagrams: [...example.diagrams, area] };
  assert.deepEqual(mapProblems(both), []);
  const check = checkMap(tempFolder('apostil-empty-'), both);
  assert.deepEqual([check.badNodes, check.badParents, check.topMaps, check.sharedFiles], [[], [], [], []]);
});

test('the map check passes a good map with a schema diagram, and lists a missing path, a missing parent, two tops, a shared path, a key of nodePaths or nodeLines that is no node, a node with no paths, and the tracked files that a diagram leaves out', () => {
  assert.deepEqual(checkMap(repo.folder, testMap()), { badPaths: [], badNodes: [], badParents: [], topMaps: [], sharedFiles: [] });

  const bad: RepoMap = {
    format: 1,
    diagrams: [
      diagram('top', { code: ['src/', 'nope/'], more: ['src/app.py'], file: ['src/'] }),
      diagram('lost', { a: ['README.md/'] }, 'ghost'),
    ],
  };
  const check = checkMap(repo.folder, bad);
  assert.equal(check.badPaths.length, 2);
  assert.ok(check.badPaths[0].includes('nope/'));
  assert.ok(check.badPaths[1].includes('README.md/'));
  assert.equal(check.badParents.length, 1);
  assert.equal(check.sharedFiles.length, 3);
  assert.equal(checkMap(repo.folder, { format: 1, diagrams: [testMap().diagrams[1]] }).badParents.length, 1);
  assert.equal(checkMap(repo.folder, { format: 1, diagrams: [diagram('a', { x: ['src/'] }), diagram('b', { x: ['src/'] })] }).topMaps.length, 1);
  const loop = { format: 1 as const, diagrams: [diagram('top', { x: ['src/'] }), diagram('a', { x: ['src/'] }, 'b'), diagram('b', { x: ['src/'] }, 'a')] };
  assert.equal(checkMap(repo.folder, loop).badParents.length, 2);

  // A schema diagram of an area of the map: a table is a node with its files, and two tables may share one migration file.
  const schema: Diagram = {
    id: 'tables', kind: 'schema', title: 'The tables', parent: 'top',
    mermaid: 'erDiagram\n  loan {\n    integer id PK\n  }\n  fee {\n    integer id PK\n    integer loan_id FK\n  }\n  fee }o--|| loan : loan_id',
    nodePaths: { loan: ['src/app.py'], fee: ['src/app.py'] },
  };
  const map: RepoMap = { ...testMap(), diagrams: [...testMap().diagrams, schema] };
  assert.deepEqual(mapProblems(map), []);
  assert.deepEqual(checkMap(repo.folder, map), { badPaths: [], badNodes: [], badParents: [], topMaps: [], sharedFiles: [] });

  // The map check lists a key of nodePaths that is no node, and a node with no paths.
  {
    const odd = { ...diagram('top', { code: ['src/'], docs: ['README.md'] }), mermaid: 'flowchart LR\n  code --> tests' };
    const check = checkMap(repo.folder, { format: 1, diagrams: [odd] });
    assert.deepEqual(check.badNodes, [
      'Diagram "top": "docs" has paths but is no node of the diagram.',
      'Diagram "top": the node "tests" has no paths.',
    ]);
  }

  // The line check of a change file lists a key of nodeLines or nodePaths that is no node.
  const file = testChangeFile();
  file.diagrams![0].nodeLines = { done: [6, 6], ghost: [1, 1] };
  file.diagrams!.push({ ...diagram('wide', { ok: ['src/'], loose: ['src/'] }), mermaid: 'flowchart LR\n  ok --> other' });
  const problems = checkChangeFile(repo.folder, repo.base, file).badNotes.map((bad) => bad.problem);
  assert.deepEqual(problems, ['Node "ghost": it is no node of the diagram, now or in "before".', 'Node "loose": it is no node of the diagram.']);

  // The path check of a change file lists a path of a node that does not exist.
  {
    const file = testChangeFile();
    file.diagrams!.push(diagram('wide', { ok: ['src/'], gone: ['nope.py'] }));
    const checks = checkChangeFile(repo.folder, repo.base, file);
    assert.equal(checks.badNotes.length, 1);
    assert.equal(checks.badNotes[0].problem, 'Node "gone": The path nope.py does not exist.');
  }

  // The map check notes the tracked files that a diagram leaves out; a folder of only such files is named once.
  repo.write('extra/a.txt', 'a\n');
  repo.write('extra/deep/b.txt', 'b\n');
  repo.commit('extra');
  const top = diagram('top', { code: ['src/'], docs: ['README.md'] });
  // The top map: every tracked file of the repo that is in no node. generated/ and extra/ hold only such files.
  assert.deepEqual(checkMap(repo.folder, { format: 1, diagrams: [top] }).uncovered, { count: 3, paths: ['extra/', 'generated/'] });
  // A diagram under a node: the files under the paths of that node that are in no node of the new diagram.
  const area = diagram('area', { app: ['src/app.py'] }, 'top');
  assert.deepEqual(checkMap(repo.folder, { format: 1, diagrams: [top, area] }, area).uncovered, { count: 1, paths: ['src/new_tool.py'] });
  // A diagram that covers all of its scope leaves nothing out, and the note is then missing.
  const whole = diagram('whole', { app: ['src/app.py'], tool: ['src/new_tool.py'] }, 'top');
  assert.equal('uncovered' in checkMap(repo.folder, { format: 1, diagrams: [top, whole] }, whole), false);
  // Ten paths at most, with the whole count.
  for (let at = 0; at < 12; at++) repo.write(`file${at}.txt`, 'x\n');
  repo.commit('many');
  const many = checkMap(repo.folder, { format: 1, diagrams: [top] }).uncovered!;
  assert.deepEqual([many.count, many.paths.length], [15, 10]);
});

test('diagramsOf gives the diagrams of a file, a folder and a path in nothing, the widest first, and uses the diagram of the newest change when two changes hold the same id', () => {
  const store = tempStore();
  const id = repoId(repo.folder);
  store.saveMap(id, repo.base, testMap());
  const file = testChangeFile();
  file.diagrams!.push(diagram('wide-src', { tools: ['src/new_tool.py'] }), { ...diagram('tool-flow', {}), part: 'tool', nodePaths: undefined });
  store.saveChange({ repoId: id, folder: repo.folder, branch: 'feature', base: repo.base, head: repo.base, file, checks: checkChangeFile(repo.folder, repo.base, file) });

  // A file in a part, with a function diagram: the map, the change and the function diagram.
  const app = diagramsOf(store, repo.folder, 'src/app.py');
  assert.deepEqual(app.map((entry) => entry.level), ['map', 'map', 'change', 'function']);
  assert.deepEqual(app.map((entry) => entry.diagram?.id), ['top', 'code', undefined, 'stop-flow']);
  assert.deepEqual(app[0].lit, ['code']);
  assert.deepEqual(app[2].lit, ['app']);
  assert.equal(app[2].branch, 'feature');
  assert.equal(app[2].line, 'Adds a stop function and a tool');
  assert.deepEqual(app[3].lit, ['ask', 'done']);

  // The file of a node in a wide diagram, and in a part with a diagram of its own.
  assert.deepEqual(diagramsOf(store, repo.folder, 'src/new_tool.py').map((entry) => entry.diagram?.id), ['top', 'code', 'wide-src', undefined, 'tool-flow']);

  // A folder of a map node: the node of the top map, the nodes inside it, the parts and the function diagram.
  const src = diagramsOf(store, repo.folder, 'src');
  assert.deepEqual(src.map((entry) => entry.level), ['map', 'map', 'wide', 'change', 'part', 'function']);
  assert.deepEqual(src[1].lit, ['app', 'tool']);
  assert.deepEqual(src[3].lit, ['app', 'tool']);

  assert.deepEqual(diagramsOf(store, repo.folder, 'nothing/here.txt'), []);
  store.close();

  // DiagramsOf uses the diagram of the newest change when two changes hold the same id.
  {
    const store = tempStore();
    const id = repoId(repo.folder);
    const save = (branch: string, title: string, nodePaths: Record<string, string[]>) => {
      const file = { ...testChangeFile(), diagrams: [{ ...diagram('shared-id', nodePaths), title }] };
      store.saveChange({ repoId: id, folder: repo.folder, branch, base: repo.base, head: repo.base, file, checks: checkChangeFile(repo.folder, repo.base, file) });
    };
    save('older', 'Older', { x: ['src/app.py'] });
    for (const start = Date.now(); Date.now() === start;); // the saves need different times
    save('newer', 'Newer', { x: ['README.md'] });
    const found = diagramsOf(store, repo.folder, 'src/app.py').filter((entry) => entry.diagram);
    assert.deepEqual(found, []);
    assert.deepEqual(diagramsOf(store, repo.folder, 'README.md').map((entry) => entry.line), ['Newer']);
    store.close();
  }
});


