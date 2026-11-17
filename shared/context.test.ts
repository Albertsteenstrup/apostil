// Tests for what a remark is about: the lines that go to the agent with each remark, and the reader of diagrams under them.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { inboxText } from '../store/inbox';
import { saveDraft } from '../store/save';
import { aboutInChange, aboutMapTarget, aboutTarget, reviewContext } from './context';
import { headCommit, repoId } from './git';
import { diagramGraph, nodeIdProblems } from './diagram-graph';
import { Store, type RemarkTarget } from './store';
import { makeTestRepo, tempFolder, testChangeFile } from './test-repo';

const repo = makeTestRepo();
const store = new Store(tempFolder('apostil-home-'));
const file = testChangeFile();
file.diagrams!.push({
  id: 'stop-states', kind: 'state', title: 'The states of the app', part: 'app', file: 'src/app.py', mermaid: 'stateDiagram-v2\n  [*] --> running\n  running --> stopped: stop',
  nodeLines: { running: 'no-line', stopped: 'no-line' }, edgeLines: [{ from: '[*]', to: 'running', lines: [1, 2] }, { from: 'running', to: 'stopped', lines: [5, 6] }],
});
const { changeId } = saveDraft(store, repo.folder, file);
const change = store.getChange(changeId!)!;
const about = (target: RemarkTarget) => aboutTarget(change, target);
after(() => { store.close(); repo.remove(); });

test('what goes with a remark on a part, a file (with the diagrams it is in), a note, code lines and a test; code lines stop after 40 lines, and a thing that the change file no longer holds says so', () => {
  assert.deepEqual(about({ kind: 'part', part: 'app' }), ['Part "App"', 'Its files: src/app.py (+5 −1)']);
  assert.deepEqual(about({ kind: 'file', file: 'src/app.py', part: 'app' }), ['File src/app.py (+5 −1)', 'In part "App"', 'Notes on it:', '"Stop the app" (lines 5–6)']);
  assert.deepEqual(about({ kind: 'more-files', part: 'tool' }), ['The files of part "Tool"', 'src/new_tool.py (+2)']);

  // A remark on a whole file also names the diagrams that the file is in, with the nodes and parts that are about it.
  const lines = aboutInChange(store, change, { kind: 'file', file: 'src/app.py', part: 'app' });
  assert.deepEqual(lines.slice(0, 4), ['File src/app.py (+5 −1)', 'In part "App"', 'Notes on it:', '"Stop the app" (lines 5–6)']);
  assert.equal(lines[4], 'It is in these diagrams:');
  assert.ok(lines.includes('the diagram of the change "' + change.file.title + '": "app"'), lines.join(' | '));
  assert.ok(lines.some((line) => line.startsWith('"How the app stops"')), lines.join(' | '));
  // A thing that is not a file gets no such lines.
  assert.deepEqual(aboutInChange(store, change, { kind: 'part', part: 'app' }), about({ kind: 'part', part: 'app' }));

  // A note gives its title and its lines; code lines give their code; a test its name and file.
  assert.deepEqual(about({ kind: 'note', file: 'src/app.py', lines: [5, 6] }), ['Note "Stop the app"', 'On src/app.py, lines 5–6']);
  assert.deepEqual(about({ kind: 'lines', file: 'src/app.py', lines: [5, 6] }), ['src/app.py, lines 5–6', '5: def stop():', '6:     return 0']);
  assert.deepEqual(about({ kind: 'test', file: 'tests/test_app.py', name: 'test_stop', lines: [4, 4] }), ['Test test_stop', 'In tests/test_app.py, line 4']);

  // Code lines stop after 40 lines, and a thing that the change file no longer holds says so.
  repo.write('src/long.py', Array.from({ length: 60 }, (_, index) => `x${index + 1} = ${index + 1}`).join('\n'));
  const long = about({ kind: 'lines', file: 'src/long.py', lines: [1, 60] });
  assert.equal(long.length, 42);
  assert.equal(long.at(-1), '(20 more lines)');
  assert.deepEqual(about({ kind: 'node', diagram: 'stop-flow', node: 'gone' }), ['Node "gone". It is no longer in the change file.']);
  assert.deepEqual(about({ kind: 'part', part: 'gone' }), ['Part "gone". It is no longer in the change file.']);
});

test('what goes with a remark on a node, an arrow and a diagram: its diagram, its label, its arrows, its code, its kind and its Mermaid text', () => {
  assert.deepEqual(about({ kind: 'node', diagram: 'stop-flow', node: 'done' }), [
    'In the flow chart "How the app stops"', 'Node "Return 0"', 'Arrows come from: "Ask to stop"', 'Its code: src/app.py, line 6',
    'The diagram as text:', '- Ask to stop (src/app.py:5)', '- Return 0 (src/app.py:6)', '- Ask to stop → Return 0',
  ]);
  assert.deepEqual(about({ kind: 'node', diagram: 'stop-states', node: 'running' }), [
    'In the state diagram "The states of the app"', 'State "running"', 'Arrows come from: "start"', 'Arrows go to: "stopped"', 'It has no code: No line of its own.',
    'The diagram as text:', '- start', '- running', '- stopped', '- start → running (src/app.py:1-2)', '- running → stopped: stop (src/app.py:5-6)',
  ]);

  // An arrow says its two ends and its label, in a diagram and in the diagram of the change.
  assert.deepEqual(about({ kind: 'edge', diagram: 'stop-states', edge: ['running', 'stopped'], name: 'stop' }), [
    'In the state diagram "The states of the app"', 'Transition from "running" to "stopped", with the label "stop"', 'Its code: src/app.py, lines 5–6',
    'The diagram as text:', '- start', '- running', '- stopped', '- start → running (src/app.py:1-2)', '- running → stopped: stop (src/app.py:5-6)',
  ]);
  assert.deepEqual(about({ kind: 'edge', edge: ['app', 'tool'] }), ['In the diagram of the change', 'Arrow from part "App" to part "Tool"', 'It has no code: Only the order.']);

  // A diagram gives its title, its kind and its Mermaid text.
  assert.deepEqual(about({ kind: 'diagram', diagram: 'stop-flow' }), ['Diagram "How the app stops", a flow chart', 'Not checked yet by a second agent.', 'The diagram as text:', '- Ask to stop (src/app.py:5)', '- Return 0 (src/app.py:6)', '- Ask to stop → Return 0']);
  assert.deepEqual(about({ kind: 'diagram' }), ['The diagram of the change: one node for each part, one arrow for each link.', 'Its links are not checked yet by a second agent.', 'part "App" uses part "Tool"']);
});

test('a remark from before the new fields and a remark on the map have their about lines in the review context, and the inbox text holds the same lines', () => {
  const old = store.addRemark(changeId!, { kind: 'part', part: 'app', label: 'Part "App"' }, 'Explain this');
  const onNode = store.addRemark(changeId!, { kind: 'node', diagram: 'stop-flow', node: 'done', part: 'app', label: 'Node "Return 0"' }, 'Why 0?');
  const context = reviewContext(store, repo.folder);
  assert.deepEqual(context.remarks.map((remark) => remark.about[0]), ['Part "App"', 'In the flow chart "How the app stops"']);
  const text = inboxText(store.remarks(changeId!).filter((remark) => [old, onNode].includes(remark.id)), store);
  assert.match(text, /- remark \d+ \(part app\): Why 0\?\n {2}about what he pointed at:\n {4}In the flow chart "How the app stops"\n {4}Node "Return 0"\n {4}Arrows come from: "Ask to stop"/);
  assert.match(text, /Explain this\n {2}about what he pointed at:\n {4}Part "App"\n {4}Its files: src\/app.py \(\+5 −1\)/);

  // A remark on the map has no change: the context lists it with its about from the stored map, and the inbox text holds it.
  {
    const map = { format: 1 as const, diagrams: [{ id: 'top', kind: 'flow' as const, title: 'The repo', mermaid: 'flowchart LR\n  code["Code"] -->|calls| docs["Docs"]', nodePaths: { code: ['src/'], docs: ['README.md'] } }] };
    store.saveMap(repoId(repo.folder), headCommit(repo.folder), map);
    const onNode = store.addRepoRemark(repoId(repo.folder), { kind: 'node', diagram: 'top', node: 'code', label: 'Node "Code"' }, 'What lives here?');
    const onArrow = store.addRepoRemark(repoId(repo.folder), { kind: 'edge', diagram: 'top', edge: ['code', 'docs'], name: 'calls' }, 'Why?');
    const context = reviewContext(store, repo.folder);
    const text = ['The diagram as text:', '- Code (src/)', '- Docs (README.md)', '- Code → Docs: calls'];
    const ofMap = context.remarks.filter((remark) => [onNode, onArrow].includes(remark.id));
    assert.deepEqual(ofMap.map((remark) => remark.about), [
      ['On the map of the repo', 'In the flow chart "The repo"', 'Node "Code"', 'Arrows go to: "Docs"', 'It stands for: src/', ...text],
      ['On the map of the repo', 'In the flow chart "The repo"', 'Arrow from "Code" to "Docs", with the label "calls"', ...text],
    ]);
    assert.deepEqual(aboutMapTarget(map, { kind: 'node', diagram: 'top', node: 'gone' }), ['On the map of the repo', 'Node "gone". It is no longer in the map.']);
    assert.match(inboxText([store.getRemark(onNode)!], store), /- remark \d+ \(Node "Code"\): What lives here\?\n {2}about what he pointed at:\n {4}On the map of the repo\n {4}In the flow chart "The repo"/);
    reviewContext(store, repo.folder, true);
    assert.equal(reviewContext(store, repo.folder).remarks.some((remark) => remark.id === onNode), false); // read by an agent: not listed again
  }
});

test('the reader of diagrams reads the participants and messages of a sequence and the labels of a flow chart, and a node id that Mermaid keeps for itself is a problem that names the id', () => {
  const sequence = diagramGraph({ kind: 'sequence', mermaid: 'sequenceDiagram\n  participant W as Clock\n  W->>+S: tick\n  S-->>W: done\n  Note over W,S: a note' });
  assert.deepEqual(sequence, { nodes: { W: 'Clock', S: 'S' }, edges: [{ from: 'W', to: 'S', label: 'tick' }, { from: 'S', to: 'W', label: 'done' }] });
  const flow = diagramGraph({ kind: 'flow', mermaid: 'flowchart TD\n  a{"Ready?"} -- no --> b(["Stop"])\n  a -->|"yes"| c\n  c --> b' });
  assert.deepEqual(flow, { nodes: { a: 'Ready?', b: 'Stop', c: 'c' }, edges: [{ from: 'a', to: 'b', label: 'no' }, { from: 'a', to: 'c', label: 'yes' }, { from: 'c', to: 'b' }] });

  // A flow chart with a node id that Mermaid keeps for itself is a problem that names the id.
  const broken = { kind: 'flow' as const, mermaid: 'flowchart TD\n  size["Set up"]\n  call["Call the system"]\n  end(["Stop"])\n  size --> call\n  call --> end' };
  const problems = nodeIdProblems(broken);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /"call" is a word that Mermaid keeps for itself/);
  assert.deepEqual(nodeIdProblems({ kind: 'flow', mermaid: 'flowchart TD\n  callStep["Call"] --> ends["Ends"]\n  ends --> callback["Back"]' }), []);
  assert.deepEqual(nodeIdProblems({ kind: 'sequence', mermaid: 'sequenceDiagram\n  participant call as Caller\n  call->>end: go' }), []);
});

