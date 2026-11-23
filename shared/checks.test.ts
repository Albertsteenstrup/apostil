// Tests for the Git facts, the checks and the list of changes, on a small real repo.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { checkDraft } from '../store/save';
import { examplePage } from './page-data';
import { shapeProblems, type ChangeFile, type Code, type Diagram, type EdgeLines, type Lines } from './change-file';
import { changeRows } from './change-rows';
import { checkChangeFile, inNoThingHints } from './checks';
import { inNoThingWords, linesInNoThing, linksChecked, linksMark, linkThings, missingCode, missingLinkCode, thingsOf } from './diagram-code';
import { diagramTitles, reviewContext, showDiagram } from './context';
import { baseOf, changedFiles, git, headCommit, repoId } from './git';
import { Store } from './store';
import { makeTestRepo, tempFolder, testChangeFile } from './test-repo';

const repo = makeTestRepo();
after(() => repo.remove());

test('the base of a branch is the commit it was created from, also with a main branch of another name and after Git dropped the record of its creation', () => {
  assert.equal(baseOf(repo.folder, 'feature'), repo.base);

  // The base is found in a repo whose main branch has another name, such as "trunk".
  const other = makeTestRepo();
  try {
    git(other.folder, 'branch', '-m', 'main', 'trunk');
    git(other.folder, 'update-ref', 'refs/remotes/origin/trunk', 'trunk');
    git(other.folder, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    // A branch that came from a fetch has no record of its creation, as the branch of a pull request has.
    git(other.folder, 'reflog', 'expire', '--expire=now', '--all');
    assert.equal(baseOf(other.folder, 'feature'), other.base);
    assert.equal(baseOf(other.folder, 'trunk'), git(other.folder, 'rev-parse', 'HEAD'));
  } finally {
    other.remove();
  }

  // When Git has dropped the record of the creation of a branch, the base is where the branch left main.
  const old = makeTestRepo();
  try {
    old.write('more.txt', 'more\n');
    old.commit('one more commit on the branch');
    // What Git does after 90 days: the oldest records of the branch are gone, and a later commit is the oldest one left.
    git(old.folder, 'reflog', 'delete', 'feature@{1}');
    git(old.folder, 'reflog', 'delete', 'feature@{1}');
    assert.equal(baseOf(old.folder, 'feature'), old.base);
  } finally {
    old.remove();
  }
});

test('the changed files include commits, edits that are not committed, and new files, each with its real name also outside ASCII', () => {
  repo.write('notes.txt', 'one\ntwo\n');
  const files = changedFiles(repo.folder, repo.base);
  assert.deepEqual(files.map((file) => file.path).sort(), ['generated/api.json', 'notes.txt', 'src/app.py', 'src/new_tool.py']);
  assert.deepEqual(files.find((file) => file.path === 'src/app.py'), { path: 'src/app.py', added: 5, removed: 1, status: 'changed' });
  assert.equal(files.find((file) => file.path === 'notes.txt')?.added, 2);

  // A file with letters outside ASCII in its name is listed with its real name.
  const odd = makeTestRepo();
  try {
    odd.write('docs/图书馆 notes 📚.md', '# 图书馆\n');
    odd.write('docs/Æblegrød.md', '# Æblegrød\n');
    odd.commit('add files with other letters');
    odd.write('docs/日本語.md', 'not committed yet\n');
    const paths = changedFiles(odd.folder, odd.base).map((file) => file.path);
    for (const path of ['docs/图书馆 notes 📚.md', 'docs/Æblegrød.md', 'docs/日本語.md']) assert.ok(paths.includes(path), `${path} in ${paths.join(', ')}`);
  } finally {
    odd.remove();
  }
});

test('the test change file has the right shape and passes the checks, except for the new file; the checks find a file in two parts, a file that did not change, and lines after the end of a file', () => {
  const file = testChangeFile();
  assert.deepEqual(shapeProblems(file), []);
  assert.deepEqual(checkChangeFile(repo.folder, repo.base, file), {
    filesInNoPart: ['notes.txt'], filesInTwoParts: [], filesNotChanged: [], generated: ['generated/api.json'], badNotes: [],
  });

  // The checks find a file in two parts, a file that did not change, and lines after the end of a file.
  {
    const file = testChangeFile();
    file.parts[1].files.push('src/app.py', 'README.md');
    file.parts[0].notes![0].lines = [5, 60];
    file.diagrams![0].nodeLines = { done: [70, 70] };
    const checks = checkChangeFile(repo.folder, repo.base, file);
    assert.deepEqual(checks.filesInTwoParts, ['src/app.py']);
    assert.deepEqual(checks.filesNotChanged, ['README.md']);
    assert.deepEqual(checks.badNotes.map((bad) => bad.title), ['Stop the app', 'How the app stops']);
    assert.match(checks.badNotes[0].problem, /Line 60 is after the end of src\/app.py, which has 6 lines/);
  }
});

test('the list of changes, the review context and the diagrams read one saved change', () => {
  const store = new Store(tempFolder());
  const file = testChangeFile();
  const id = store.saveChange({
    repoId: repoId(repo.folder), folder: repo.folder, branch: 'feature', base: repo.base, head: headCommit(repo.folder),
    file, checks: checkChangeFile(repo.folder, repo.base, file),
  });
  store.addRemark(id, { kind: 'part', part: 'app', label: 'Part "App"' }, 'Why return 0?');

  const [row] = changeRows(store, repo.folder);
  assert.deepEqual({ commits: row.commits, files: row.files, added: row.added, removed: row.removed, outOfDate: row.outOfDate, filesInNoPart: row.filesInNoPart },
    { commits: 1, files: 4, added: 10, removed: 1, outOfDate: false, filesInNoPart: 1 });

  assert.equal(reviewContext(store, repo.folder, true).remarks[0].text, 'Why return 0?');
  assert.equal(reviewContext(store, repo.folder).remarks.length, 0); // the first call marked it as sent
  assert.equal(diagramTitles(store, repo.folder, 'src/')[0].id, 'stop-flow');
  assert.equal(showDiagram(store, repo.folder, 'stop-flow')?.code?.text, 'def stop():\n    return 0');
  store.close();
});

test('the checks of a diagram: "before" of another kind or with no node kept, entries of "edgeLines" that name no arrow, the shapes of code, and the places of a thing', () => {
  const file = testChangeFile();
  const [diagram] = file.diagrams!;
  const withBefore = (before: string) => checkChangeFile(repo.folder, repo.base, { ...file, diagrams: [{ ...diagram, before }] }).badNotes.map((bad) => bad.problem);
  assert.deepEqual(withBefore(diagram.mermaid), []);
  assert.match(withBefore('sequenceDiagram\n  A->>B: go').join(), /"before" must be the Mermaid text of the same diagram before the change: a flow chart, not a sequence diagram/);
  assert.match(withBefore('flowchart TD\n  other1 --> other2').join(), /Keep the id of each step that is still there/);

  // The checks find an entry of "edgeLines" that names no arrow, and lines of an arrow after the end of its file.
  {
    const file = testChangeFile();
    const [diagram] = file.diagrams!;
    const withEdges = (edgeLines: NonNullable<typeof diagram.edgeLines>) => checkChangeFile(repo.folder, repo.base, { ...file, diagrams: [{ ...diagram, edgeLines }] }).badNotes.map((bad) => bad.problem);
    assert.deepEqual(withEdges([{ from: 'ask', to: 'done', lines: [5, 6] }]), []);
    assert.deepEqual(withEdges([{ from: 'done', to: 'ask', lines: [5, 6] }]), ['Arrow "done → ask": it is no arrow of the diagram, now or in \"before\".']);
    assert.deepEqual(withEdges([{ from: 'ask', to: 'done', label: 'stop', lines: [5, 6] }]), ['Arrow "ask → done: stop": it is no arrow of the diagram, now or in \"before\".']);
    assert.match(withEdges([{ from: 'ask', to: 'done', lines: [5, 70] }]).join(), /The arrow "Ask to stop" → "Return 0": Line 70 is after the end of src\/app.py/);
    assert.deepEqual(shapeProblems({ ...file, diagrams: [{ ...diagram, edgeLines: [{ from: 'ask', to: 'done', lines: [6, 5] }] }] }), ['Diagram "stop-flow": "edgeLines" of "ask → done": lines must be [first, last], counted from 1, the first not after the last.']);
    assert.deepEqual(shapeProblems({ ...file, diagrams: [{ ...diagram, file: undefined, covers: undefined, nodeLines: undefined, edgeLines: [{ from: 'ask', to: 'done', lines: [5, 6] }] }] }), ['Diagram "stop-flow": "edgeLines" of "ask → done": lines alone need "file" in the diagram; else give the file in a place.']);
    assert.deepEqual(shapeProblems({ ...file, diagrams: [{ ...diagram, edgeLines: [{ from: 'ask', to: 'done', lines: 'soon' as Code }] }] }), ['Diagram "stop-flow": "edgeLines" of "ask → done": "soon" is no reason; give [first, last], a reason (outside, order, no-line), a place { "file"?, "lines"?, "removed"? }, or a list of places.']);
    assert.deepEqual(shapeProblems({ ...file, diagrams: [{ ...diagram, nodeLines: { ask: 'order' } }] }), ['Diagram "stop-flow": "nodeLines" of "ask": "order" is a reason for arrows only; a node is outside, no-line, or has lines.']);
    assert.deepEqual(shapeProblems({ ...file, diagrams: [{ ...diagram, nodeLines: { ask: { lines: [3, 4], removed: true }, done: [{ file: 'src/other.py' }, [6, 6]] } }] }), []);
  }

  // The places are checked: a second file that exists, removed lines that the change removed, a whole file.
  {
    const file = testChangeFile();
    const problems = (nodeLines: Record<string, Code>) => checkChangeFile(repo.folder, repo.base, { ...file, diagrams: [{ ...file.diagrams![0], nodeLines }] }).badNotes.map((bad) => bad.problem);
    assert.deepEqual(problems({ ask: [{ file: 'src/new_tool.py', lines: [1, 2] }, [5, 5]], done: { file: 'src/new_tool.py' } }), []);
    assert.deepEqual(problems({ ask: { file: 'src/nothing.py', lines: [1, 1] }, done: { file: 'src/gone.py' } }), [
      'The step "Ask to stop": The file src/nothing.py does not exist.', 'The step "Return 0": The file src/gone.py does not exist, now or before the change.',
    ]);
    assert.deepEqual(problems({ ask: { lines: [2, 2], removed: true }, done: [6, 6] }), []); // line 2 of src/app.py was "return 1"
    assert.match(problems({ ask: { lines: [1, 1], removed: true }, done: [6, 6] }).join(), /Line 1 of src\/app.py is not a line that the change removed/);
  }
});

// ----- the rule: each node and arrow of a diagram of a part has code, or a reason -----

const ruleFlow = (nodeLines: Record<string, Code>, edgeLines: EdgeLines[] = [], more: Partial<Diagram> = {}): Diagram => ({
  id: 'fee', kind: 'flow', title: 'The fee', file: 'src/app.py', nodeLines, edgeLines, ...more,
  mermaid: 'flowchart TD\n  start["Start"] --> zero{"Fee is zero?"}\n  zero -- yes --> free(["Free"])\n  zero -- no --> charge["Charge"]\n  charge -- retry --> start',
});

test('the rule lists each node and arrow with no code in words that a writer can act on, with the fill-in of a flow chart, a state diagram and a sequence', () => {
  assert.deepEqual(missingCode(ruleFlow({ start: [1, 2], free: 'no-line' })), [
    'Diagram "fee": The step "Fee is zero?" has no code. Give its lines, or a reason: outside, no-line.',
    'Diagram "fee": The step "Charge" has no code. Give its lines, or a reason: outside, no-line.',
    'Diagram "fee": The arrow "Fee is zero?" → "Free" ("yes") has no code. Give its lines, or a reason: outside, order, no-line.',
    'Diagram "fee": The arrow "Fee is zero?" → "Charge" ("no") has no code. Give its lines, or a reason: outside, order, no-line.',
    'Diagram "fee": The arrow "Charge" → "Start" ("retry") has no code. Give its lines, or a reason: outside, order, no-line.',
  ]);
  assert.deepEqual(missingCode(ruleFlow({ start: [1, 2], zero: [3, 4], free: 'outside', charge: [{ file: 'src/new_tool.py', lines: [1, 2] }, [5, 6]] }, [{ from: 'charge', to: 'start', lines: 'order' }])), []);
  assert.deepEqual(missingCode({ ...ruleFlow({}), broad: true }), []); // a wider diagram keeps its folders and files

  // The fill-in of a flow chart: an arrow with no text is "order", a "yes" or "no" out of a decision has the places of the decision.
  const { things } = thingsOf(ruleFlow({ zero: [3, 4] }));
  const code = (key: string) => things.find((thing) => thing.key === key)?.code;
  assert.deepEqual(code('edge:0'), { places: [], reason: 'order', filled: 'order' });
  assert.deepEqual(code('edge:1'), { places: [{ file: 'src/app.py', lines: [3, 4] }], filled: 'decision' });
  assert.deepEqual(code('edge:2'), { places: [{ file: 'src/app.py', lines: [3, 4] }], filled: 'decision' });
  assert.equal(code('edge:3'), undefined); // "retry" leaves a step that is no decision: the writer gives its code
  // What the writer gives wins over the fill-in.
  assert.deepEqual(thingsOf(ruleFlow({}, [{ from: 'start', to: 'zero', lines: [2, 2] }])).things[4].code, { places: [{ file: 'src/app.py', lines: [2, 2] }] });

  // The fill-in of a state diagram: the start and end markers need nothing, each state and transition needs code or a reason.
  const states: Diagram = { id: 'st', kind: 'state', title: 'States', file: 'src/app.py', mermaid: 'stateDiagram-v2\n  [*] --> running\n  running --> stopped: stop\n  stopped --> [*]' };
  assert.deepEqual(missingCode(states).map((problem) => problem.replace(/ has no code.*/, '')), [
    'Diagram "st": The state "running"', 'Diagram "st": The state "stopped"',
    'Diagram "st": The transition from "start" to "running"', 'Diagram "st": The transition "stop" from "running" to "stopped"', 'Diagram "st": The transition from "stopped" to "end"',
  ]);
  const done = { ...states, nodeLines: { running: 'no-line', stopped: [5, 5] } as Record<string, Code>, edgeLines: [{ from: '[*]', to: 'running', lines: [1, 2] }, { from: 'running', to: 'stopped', lines: [5, 6] }, { from: 'stopped', to: '[*]', lines: 'order' }] as EdgeLines[] };
  assert.deepEqual(missingCode(done), []);

  // The fill-in of a sequence: nothing is filled in; each participant and message needs code or a reason, a participant can be a whole file.
  const sequence: Diagram = { id: 'sq', kind: 'sequence', title: 'Calls', file: 'src/app.py', mermaid: 'sequenceDiagram\n  participant U as User\n  participant A as App\n  U->>A: stop\n  A-->>U: 0' };
  assert.equal(missingCode(sequence).length, 4);
  assert.deepEqual(missingCode({ ...sequence, nodeLines: { U: 'outside', A: { file: 'src/app.py' } }, edgeLines: [{ from: 'U', to: 'A', lines: 'outside' }, { from: 'A', to: 'U', lines: [6, 6] }] }), []);
});

test('a removed node or arrow needs its removed lines, and a removed way out of a decision that still stands has the lines of that decision', () => {
  const diagram = ruleFlow({ start: [1, 2], zero: [3, 4], free: 'no-line', charge: [5, 6] }, [{ from: 'charge', to: 'start', lines: 'order' }], {
    before: 'flowchart TD\n  start["Start"] --> zero{"Fee is zero?"}\n  zero -- yes --> free(["Free"])\n  zero -- no --> charge["Charge"]\n  charge -- retry --> start\n  charge --> mail["Mail the receipt"]',
  });
  assert.deepEqual(missingCode(diagram), ['Diagram "fee": The removed step "Mail the receipt" has no code. Give its removed lines ({ "lines": [first, last], "removed": true }, counted in the file as it was), or a reason: outside, no-line.']);
  assert.deepEqual(missingCode({ ...diagram, nodeLines: { ...diagram.nodeLines, mail: [7, 8] } }), ['Diagram "fee": The removed step "Mail the receipt" is no longer in the diagram, so its lines are lines that the change removed. Mark them "removed": true, counted in the file as it was.']);
  assert.deepEqual(missingCode({ ...diagram, nodeLines: { ...diagram.nodeLines, mail: { lines: [2, 2], removed: true } } }), []); // its arrow has no text: "order"

  // A removed "yes" out of a decision that still stands has the lines of that decision by itself; an arrow can say "removed" beside its lines.
  // Before, "yes" went from the decision to "Charge"; now a new step stands between them. The decision is still there.
  const moved = ruleFlow({ start: [1, 2], zero: [3, 4], free: 'no-line', charge: [5, 6] }, [{ from: 'charge', to: 'start', lines: 'order' }], {
    before: 'flowchart TD\n  start["Start"] --> zero{"Fee is zero?"}\n  zero -- yes --> free(["Free"])\n  zero -- no --> charge["Charge"]\n  zero -- maybe --> start\n  charge -- retry --> start',
  });
  assert.deepEqual(missingCode(moved), []);
  const gone = thingsOf(moved).things.find((thing) => thing.removed && thing.label === 'maybe');
  assert.deepEqual(gone?.code, { places: [{ file: 'src/app.py', lines: [3, 4] }], filled: 'decision' });
  // The short form for a removed arrow that is no way out of a decision.
  const cut = ruleFlow({ start: [1, 2], zero: [3, 4], free: 'no-line', charge: [5, 6] }, [{ from: 'charge', to: 'start', lines: 'order' }, { from: 'charge', to: 'free', label: 'skip', lines: [9, 9], removed: true }], {
    before: 'flowchart TD\n  start["Start"] --> zero{"Fee is zero?"}\n  zero -- yes --> free(["Free"])\n  zero -- no --> charge["Charge"]\n  charge -- retry --> start\n  charge -- skip --> free',
  });
  assert.deepEqual(missingCode(cut), []);
  assert.deepEqual(thingsOf(cut).things.find((thing) => thing.label === 'skip')?.code, { places: [{ file: 'src/app.py', lines: [9, 9], removed: true }] });
});

test('the changed lines that a diagram covers and that are in no node and no arrow are a hint; empty lines and comments do not count', () => {
  const text = ['def stop(reason):', '    # say why', '', '    log(reason)', '    return 0'];
  const added = () => true;
  const covers = { file: 'src/app.py', covers: [1, 5] as Lines };
  const things = thingsOf({ kind: 'flow', file: 'src/app.py', mermaid: 'flowchart TD\n  a --> b', nodeLines: { a: [4, 4], b: [5, 5] } }).things;
  assert.deepEqual(linesInNoThing(covers, things, added, text), { added: [1], removed: [] });
  assert.equal(inNoThingWords('flow', { added: [1], removed: [] }), '1 changed line in no step');
  assert.deepEqual(linesInNoThing({ file: 'src/app.py' }, things, added, text), { added: [], removed: [] }); // a diagram that says nothing of what it covers
  // A removed line counts too: in the covered lines, with code on it, and in no node of now and no removed node. The count adds both kinds.
  const gone = (at: number, line: number, text: string) => ({ at, line, text });
  const removed = [gone(2, 40, '    old()'), gone(3, 41, '    # old note'), gone(4, 42, '    held()'), gone(9, 43, '    outside()'), gone(5, 44, '    named()')];
  const withGone = thingsOf({ kind: 'flow', file: 'src/app.py', mermaid: 'flowchart TD\n  a --> b\n  a --> c', nodeLines: { a: [4, 4], b: [5, 5], c: { lines: [44, 44], removed: true } } }).things;
  const both = linesInNoThing(covers, withGone, added, text, removed);
  assert.deepEqual(both, { added: [1], removed: [40] }); // 41 is a comment, 42 stands in the lines of a node, 43 is outside, 44 is named by a removed node
  assert.equal(inNoThingWords('flow', both), '2 changed lines in no step');
  assert.equal(inNoThingWords('flow', { added: Array(1200).fill(1), removed: [] }), '1,200 changed lines in no step');
  // The save gives the same lines to the writer as a hint, and does not fail for them.
  const draft = testChangeFile();
  draft.diagrams![0] = { ...draft.diagrams![0], nodeLines: { ask: [5, 5], done: 'no-line' } };
  assert.deepEqual(inNoThingHints(repo.folder, repo.base, draft), ['Diagram "stop-flow": 1 changed line in no step: src/app.py, lines 6. A line that does something is in a node or an arrow; leave it out only when the diagram has no place for it.']);
});

// ----- the rule for the links between the parts of a change -----

test('a link has places, each with its file, or a reason; a link with neither is listed in words that a writer can act on; its places are checked as the places of an arrow are', () => {
  const file = testChangeFile();
  const withLinks = (links: ChangeFile['links']): ChangeFile => ({ ...file, links });
  // One place, two places in two files, and each reason: the rule is content.
  assert.deepEqual(missingLinkCode(withLinks([{ from: 'app', to: 'tool', label: 'calls tool', lines: { file: 'src/app.py', lines: [5, 6] } }])), []);
  assert.deepEqual(missingLinkCode(withLinks([{ from: 'app', to: 'tool', lines: [{ file: 'src/app.py', lines: [5, 5] }, { file: 'src/new_tool.py', lines: [1, 1] }] }])), []);
  for (const reason of ['outside', 'order', 'no-line'] as const) assert.deepEqual(missingLinkCode(withLinks([{ from: 'app', to: 'tool', lines: reason }])), []);
  assert.deepEqual(linkThings([{ from: 'app', to: 'tool', lines: [{ file: 'src/app.py', lines: [5, 5] }, { file: 'src/new_tool.py', lines: [1, 1] }] }])[0].code,
    { places: [{ file: 'src/app.py', lines: [5, 5] }, { file: 'src/new_tool.py', lines: [1, 1] }] });
  assert.deepEqual(linkThings([{ from: 'app', to: 'tool', lines: 'outside' }])[0].code, { places: [], reason: 'outside' });
  // None: the link is listed, by the names of its parts and its label.
  assert.deepEqual(missingLinkCode(withLinks([{ from: 'app', to: 'tool', label: 'uses tool' }, { from: 'tool', to: 'app' }])), [
    'The link "App → Tool: uses tool" has no code. Give the line of the call or the import, or a reason: outside, order, no-line.',
    'The link "Tool → App" has no code. Give the line of the call or the import, or a reason: outside, order, no-line.',
  ]);
  // The save refuses it with the same list; apostil check runs the same function.
  assert.deepEqual(checkDraft(repo.folder, withLinks([{ from: 'app', to: 'tool', label: 'uses tool' }]), repo.base).problems,
    ['The link "App → Tool: uses tool" has no code. Give the line of the call or the import, or a reason: outside, order, no-line.']);
  assert.deepEqual(checkDraft(repo.folder, withLinks([{ from: 'app', to: 'tool', lines: 'order' }]), repo.base).problems, []);

  // The shape of the code of a link: a place names its file, since a link has none of its own.
  {
    const file = testChangeFile();
    const shape = (lines: Code) => shapeProblems({ ...file, links: [{ from: 'app', to: 'tool', label: 'uses tool', lines }] });
    const noFile = 'Link "app → tool: uses tool": "lines": a link has no file of its own; give a place { "file": path, "lines": [first, last] }.';
    assert.deepEqual(shape({ file: 'src/app.py', lines: [5, 6] }), []);
    assert.deepEqual(shape([5, 6]), [noFile]);
    assert.deepEqual(shape({ lines: [5, 6] }), [noFile]);
    assert.match(shape('soon' as Code).join(), /"soon" is no reason/);
  }

  // The places of a link are checked as the places of an arrow are.
  {
    const file = testChangeFile();
    const problems = (lines: Code) => checkChangeFile(repo.folder, repo.base, { ...file, links: [{ from: 'app', to: 'tool', lines }] }).badNotes.map((bad) => bad.problem);
    assert.deepEqual(problems([{ file: 'src/app.py', lines: [5, 6] }, { file: 'src/new_tool.py' }, { file: 'src/app.py', lines: [2, 2], removed: true }]), []);
    assert.deepEqual(problems([{ file: 'src/nothing.py', lines: [1, 1] }, { file: 'src/app.py', lines: [5, 70] }]), [
      'The link "App → Tool": The file src/nothing.py does not exist.', 'The link "App → Tool": Line 70 is after the end of src/app.py, which has 6 lines.',
    ]);
    assert.match(problems({ file: 'src/app.py', lines: [1, 1], removed: true }).join(), /Line 1 of src\/app.py is not a line that the change removed/);
  }
});

test('a description of an older version whose links have no code still opens; a link with a diff has its counts, and the links are checked when each part that a link leaves has its mark', () => {
  const old: ChangeFile = { ...testChangeFile(), links: [{ from: 'app', to: 'tool' }] };
  assert.deepEqual(shapeProblems(old), []);
  const page = examplePage(repo.folder, repo.base, old, []);
  assert.deepEqual(page.links, [{ from: 'app', to: 'tool' }]);
  assert.equal(page.linksChecked, false);

  // A link with a diff has its counts, the sum over its places; the links are checked when each part that a link leaves has its mark.
  {
    const links: ChangeFile['links'] = [{ from: 'app', to: 'tool', lines: { file: 'src/app.py', lines: [4, 6] } }, { from: 'tool', to: 'app', lines: { file: 'src/app.py', lines: [1, 1] } }];
    const page = examplePage(repo.folder, repo.base, { ...testChangeFile(), links }, [], [], undefined, [], undefined, 0, [linksMark('app')]);
    assert.deepEqual(page.links.map((link) => link.code?.counts), [{ added: 3, removed: 0 }, undefined]); // line 1 did not change: no counts
    assert.equal(page.linksChecked, false); // the links that leave "tool" are not read yet
    assert.equal(linksChecked(links, [linksMark('app'), linksMark('tool')]), true);
    assert.equal(linksChecked([], [linksMark('app')]), false); // no link, nothing to say
  }
});

