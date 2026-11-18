// Tests for a change that draws on the diagrams of the repo: the save holds each diagram to its repo diagram ("of" and "before") or to code that is
// all new ("new"), and `apostil diagram` and `apostil diagrams` read the diagrams of the map and the drawings of its processes.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { ChangeFile, Diagram } from '../shared/change-file';
import { headCommit, repoId } from '../shared/git';
import { processDrawings } from '../shared/process-diagrams';
import type { RepoMap } from '../shared/repo-map';
import { Store } from '../shared/store';
import { makeTestRepo, runApostil, tempFolder, testChangeFile } from '../shared/test-repo';
import { addDiagramToMap, saveDraft, saveMapDraft } from './save';

// The test repo: the base has start() on lines 1-2 of src/app.py; the branch changes its line 2 and adds stop() on lines 5-6.
const repo = makeTestRepo();
const store = new Store(tempFolder('apostil-store-'));
after(() => { store.close(); repo.remove(); });

const START = 'flowchart TD\n  begin["Start the app"]\n  back(["Return 1"])\n  begin --> back';
/** The diagram of start() as the base has it, which a writer adds to the map under the area that holds its file: a diagram of one file has no paths. */
const startOnMap: Diagram = { id: 'start-flow', kind: 'flow', title: 'How the app starts', parent: 'top', file: 'src/app.py', symbol: 'start', covers: [1, 2], mermaid: START, nodeLines: { begin: [1, 1], back: [2, 2] } };
/** The diagram of start() after the change, drawn on the repo diagram: the same nodes, one with new words. */
const startNow = (more: Partial<Diagram>): Diagram => ({
  id: 'start-now', kind: 'flow', title: 'How the app starts now', part: 'app', file: 'src/app.py', symbol: 'start', covers: [1, 2],
  mermaid: 'flowchart TD\n  begin["Start the app"]\n  back(["Return 2"])\n  begin --> back', nodeLines: { begin: [1, 1], back: [2, 2] }, ...more,
});
const draft = (diagrams: Diagram[]): ChangeFile => ({ ...testChangeFile(), diagrams });
const problems = (diagrams: Diagram[]): string[] => saveDraft(store, repo.folder, draft(diagrams)).problems;

test('a repo with a map: the save refuses a "before" that is not the text of the repo diagram and a diagram of old code with no "of", and saves one with the right "before" and one that is new', () => {
  const [stop] = testChangeFile().diagrams!; // stop() is all new: its lines 5-6 are added, and it has "new"
  // With no map there is nothing to draw on: a diagram as before is saved.
  assert.deepEqual(problems([{ ...stop, new: undefined }]), []);
  assert.deepEqual(saveMapDraft(store, repo.folder, { format: 1, diagrams: [{ id: 'top', kind: 'flow', title: 'The test repo', mermaid: 'flowchart LR\n  code --> docs', nodePaths: { code: ['src/'], docs: ['README.md'] } }] }).problems, []);
  assert.equal(addDiagramToMap(store, repo.folder, startOnMap).saved, true);

  assert.deepEqual(problems([startNow({ of: 'start-flow', before: START.replace('Start the app', 'Start') })]),
    ['Diagram "start-now": "before" is not the text of the repo diagram "start-flow". Run apostil diagram start-flow and copy its text into "before".']);
  assert.match(problems([startNow({})]).join(), /^Diagram "start-now" names no repo diagram in "of" and is not "new"\. Draw it on the repo diagram of its code: find it with apostil diagrams --path src\/app\.py;.*apostil add-diagram, under the area that holds the file/);
  assert.match(problems([startNow({ new: true })]).join(), /^Diagram "start-now": lines 1 of src\/app\.py were there before the change, so its code is not all new\. Draw it on/);
  assert.match(problems([startNow({ of: 'gone-flow', before: START })]).join(), /^Diagram "start-now": the map has no diagram "gone-flow"\./);
  assert.deepEqual(problems([{ ...stop, before: START }]), ['Diagram "stop-flow": code that is all new has no "of" and no "before".']);

  // Spaces, an empty line, a comment and the order of the lines of a flow chart do not count.
  const before = 'flowchart   TD\n  begin --> back\n\n%% the text of apostil diagram start-flow\n    back(["Return 1"])  \n  begin["Start the app"]\n';
  const saved = saveDraft(store, repo.folder, draft([startNow({ of: 'start-flow', before }), stop]));
  assert.deepEqual(saved.problems, []);
  assert.equal(saved.saved, true);
});

test('apostil diagram prints a written diagram of the map and the drawing of a process with the text that Home draws; apostil diagrams lists them for a path, with the diagrams of changes', () => {
  const map: RepoMap = {
    format: 1,
    diagrams: [{ id: 'top', kind: 'flow', title: 'The test repo', mermaid: 'flowchart LR\n  code --> docs', nodePaths: { code: ['src/'], docs: ['README.md'] } }, startOnMap],
    fileNotes: [
      { file: 'src/app.py', lines: [1, 2], title: 'Start the app', text: 'Returns the number of the start.' },
      { file: 'src/app.py', lines: [5, 6], title: 'Stop the app', text: 'Returns 0.' },
    ],
    processes: [{ id: 'run-app', title: 'Run the app', summary: 'Starts the app and stops it.', group: 'app', steps: ['src/app.py:1-2', 'src/app.py:5-6'] }],
  };
  store.saveMap(repoId(repo.folder), headCommit(repo.folder), map);
  const apostil = (...args: string[]) => JSON.parse(runApostil([...args, '--folder', repo.folder], { env: { APOSTIL_HOME: store.folder } }).stdout);

  const written = apostil('diagram', 'start-flow');
  assert.deepEqual({ map: written.map, mermaid: written.diagram.mermaid, file: written.diagram.file, branch: written.branch }, { map: true, mermaid: START, file: 'src/app.py', branch: undefined });
  const drawn = apostil('diagram', 'process:run-app');
  assert.equal(drawn.diagram.mermaid, processDrawings(map, map.processes![0])[0].mermaid);
  assert.deepEqual({ map: drawn.map, title: drawn.diagram.title, where: drawn.where }, { map: true, title: 'Run the app', where: { s0: 'src/app.py:1-2', s1: 'src/app.py:5-6' } });

  // The repo diagrams first, then the two diagrams of the change that the first test saved.
  const listed = apostil('diagrams', '--path', 'src/app.py').map((one: { id: string; map?: true; branch?: string }) => `${one.id}:${one.map ? 'map' : one.branch}`);
  assert.deepEqual(listed, ['top:map', 'start-flow:map', 'process:run-app:map', 'start-now:feature', 'stop-flow:feature']);
});
