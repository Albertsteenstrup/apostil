// Tests for the page data and the Mermaid text of the view, on a small real repo.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { checkChangeFile } from '../shared/checks';
import { headCommit, repoId } from '../shared/git';
import { Store } from '../shared/store';
import { makeTestRepo, tempFolder, testChangeFile } from '../shared/test-repo';
import { WHOLE_LIMIT, broadDifference, broadMermaid, changeMermaid, drillUpStyle, flowGraph, gridLinks, partMermaid } from './change-diagram';
import { allowRule, deniedRules, DESCRIBE_AFTER_MAP, MAP_DRAFT, mapPrompt, problemFromErrors, runEnvironment, problemFromOutput, sessionFromOutput, startMapRun } from './agent-run';
import { installCommand, isOwnLink, launcherScript, needsRefresh } from './install-command';
import { listRows, reopenStaleRuns, sessionGroups, type ListRow } from './list-rows';
import { number } from '../shared/diagram-change';
import { addedLines, agentOf, answer, pageData, removedLines, toRanges, type TestsAnswer } from './page-data';

// The state words, dots and folds are plain JavaScript of the page; the tests read the same file.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const States = require('../../view/media/states.js');
// The rows of the code view and the order of the files are plain JavaScript of the page too.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const CodeNotes = require('../../view/media/code-notes.js');

const repo = makeTestRepo();
repo.write('notes.txt', 'one\ntwo\n'); // a changed file in no part
repo.write('tests/test_app.py', 'from src.app import stop\n\n\ndef test_stop():\n    assert stop() == 0\n');
repo.commit('tests'); // the search for tests reads committed files only
const store = new Store(tempFolder());
after(() => { store.close(); repo.remove(); });

function saveTestChange(): number {
  const file = testChangeFile();
  file.parts[0].files.push('tests/test_app.py');
  file.parts[0].notes!.push({ file: 'src/app.py', lines: [1, 2], title: 'Start returns two', tests: ['tests/test_app.py::test_stop'] });
  return store.saveChange({
    repoId: repoId(repo.folder), folder: repo.folder, branch: 'feature', base: repo.base, head: headCommit(repo.folder),
    file, checks: checkChangeFile(repo.folder, repo.base, file),
  });
}

test('the Mermaid text of a change holds each part, each link, the Git counts and the node for files in no part; parts with no arrow stand in rows; a label from the agent is escaped, and a part of .sql files is a cylinder', () => {
  const page = pageData(store, saveTestChange(), repo.folder)!;
  const text = page.changeDiagram;
  assert.match(text, /^flowchart TD/);
  assert.match(text, /<b data-part='app'>App<\/b>/);
  assert.match(text, /<b data-part='tool'>Tool<\/b>/);
  assert.match(text, /ap0 --> ap1/);
  assert.match(text, /data-file='src\/app.py'>app.py <i class='p'>\+5<\/i> <i class='m'>−1<\/i>/);
  assert.match(text, /data-file='src\/new_tool.py'>new_tool.py <i class='p'>\+2<\/i><\/span>/);
  assert.match(text, /apnone\["<b data-nopart='1'>In no part · 1 file<\/b><span class='f' data-file='notes.txt'>/);
  assert.match(text, /class apnone nopart/);

  // Parts with no arrow stand in rows of three or four; parts with arrows keep their layout.
  {
    const ids = (count: number): string[] => Array.from({ length: count }, (_, index) => `ap${index}`);
    assert.deepEqual(gridLinks(ids(4)), []);
    assert.deepEqual(gridLinks(ids(9)), ['  ap0 ~~~ ap3', '  ap1 ~~~ ap4', '  ap2 ~~~ ap5', '  ap3 ~~~ ap6', '  ap4 ~~~ ap7', '  ap5 ~~~ ap8']);
    assert.equal(gridLinks(ids(7))[0], '  ap0 ~~~ ap4'); // two rows: four and three
    const parts = Array.from({ length: 7 }, (_, index) => ({ id: `p${index}`, name: `Shelf ${index}`, files: [] }));
    const text = changeMermaid({ parts, links: [{ from: 'p0', to: 'p1' }], files: [], filesInNoPart: ['notes.txt'] });
    assert.match(text, /ap0 --> ap1/);
    assert.match(text, /ap2 ~~~ ap5\n  ap3 ~~~ ap6\n  ap4 ~~~ apnone\n/); // five parts and the files in no part: two rows of three
    assert.doesNotMatch(text, /ap[01] ~~~|~~~ ap[01]\b/);
  }

  // A label from the agent is escaped, and a part of .sql files is a cylinder.
  {
    const text = changeMermaid({
      parts: [{ id: 'db', name: 'Table "<b>"', files: ['m/1.sql'] }], links: [], files: [{ path: 'm/1.sql', added: 3, removed: 0, status: 'added' }], filesInNoPart: [],
    });
    assert.match(text, /ap0\[\("<b data-part='db'>Table #quot;&lt;b&gt;#quot;<\/b>/);
    assert.doesNotMatch(text, /apnone/);
  }
});

test('the page data holds the notes with their test counts, the check results and the open points, and answers the tests, a diff, the code of a file and a range of lines', () => {
  const id = saveTestChange();
  store.setOpenPoints(id, [
    { kind: 'note-not-supported', text: 'stop returns 0, not 1.', file: 'src/app.py', lines: [6, 6] },
    { kind: 'no-note', text: 'start changed its value.', file: 'src/app.py', lines: [2, 2] },
  ]);
  const page = pageData(store, id, repo.folder)!;
  assert.equal(page.repo.startsWith('apostil-repo-'), true);
  assert.deepEqual(page.checks.filesInNoPart, ['notes.txt']);
  assert.equal(page.files.length, 5);
  const [stop, start] = page.notes;
  assert.deepEqual(page.functionTests, { stop: 1 }); // found by findTests(), shown once for the function
  assert.equal(stop.linkedTests, 0);
  assert.equal(stop.check, 'stop returns 0, not 1.');
  assert.equal(start.linkedTests, 1); // linked by the agent
  assert.deepEqual(page.openPoints.map((point) => point.text).sort(), ['start changed its value.', 'stop returns 0, not 1.']);
  assert.equal(page.parts[0].diagrams[0], 'stop-flow');
  assert.match(page.parts[0].drillUp!, /subgraph ap0\["App"\]/); // the small flow stays whole
  assert.match(page.diagrams[0].draw, /Return 0<span class='ln'><i class='p'>\+1<\/i><\/span>/); // its line is added: its diff stands where its line number stood
  assert.deepEqual(page.diagrams[0].change?.paint, { ask: 'add', done: 'add' });

  const tests = answer(page, 'tests:stop') as TestsAnswer;
  assert.deepEqual(tests.groups.map((group) => [group.name, group.tests[0].name, group.tests[0].isNew]), [['unit', 'test_stop', true]]);
  assert.deepEqual(tests.groups[0].tests[0].added[0], { line: 4, text: 'def test_stop():' });
  const linked = answer(page, `linked:${start.key}`) as TestsAnswer;
  assert.deepEqual(linked.groups.map((group) => [group.name, group.tests[0].name]), [['linked by the agent', 'test_stop']]);

  // The page answers a diff, the code of a file and a range of lines.
  const appDiff = answer(page, 'diff:src/app.py') as { sign: string; text: string }[];
  assert.deepEqual(appDiff.filter((line) => line.sign !== ' ').slice(0, 2), [{ sign: '-', text: '    return 1', line: 2 }, { sign: '+', text: '    return 2', line: 2 }]);
  assert.deepEqual(answer(page, 'code:src/app.py'), {
    lines: ['def start():', '    return 2', '', '', 'def stop():', '    return 0'], changed: [[2, 6]], status: 'changed',
    removed: [{ at: 2, line: 2, text: '    return 1' }],
  });

  // A call from a test file outside a test is a group of its own, named by its file.
  {
    repo.write('tests/helpers.py', 'from src.app import stop\n\nvalue = stop()\n');
    repo.commit('a helper');
    const page = pageData(store, saveTestChange(), repo.folder)!;
    const tests = answer(page, 'tests:stop') as TestsAnswer;
    const outside = tests.groups.find((group) => group.name === 'calls from a test file, outside a test');
    assert.deepEqual(outside?.tests.map((test) => [test.name, test.line]), [['helpers.py', 3]]);
  }

  // Added lines of a diff become ranges in the new file.
  const diff = '@@ -1,3 +1,4 @@\n a\n-b\n+c\n+d\n e\n@@ -10,2 +11,2 @@\n x\n+y';
  assert.deepEqual(addedLines(diff), [2, 3, 12]);
  assert.deepEqual(toRanges([2, 3, 12]), [[2, 3], [12, 12]]);
  assert.deepEqual(removedLines(diff), [{ at: 2, line: 2, text: 'b' }]);
  assert.deepEqual(removedLines('@@ -5,3 +5,1 @@\n a\n-b\n-c'), [{ at: 6, line: 6, text: 'b' }, { at: 6, line: 7, text: 'c' }]);
});

test('the Mermaid text of a part: a flow chart read with labels on edges, labels with arrows inside and chained edges; drill up keeps it whole up to the limits; line numbers under the labels of nodes with code lines', () => {
  const graph = flowGraph('flowchart TD\n  a["Go --> on"] -- yes --> b([Stop])\n  b --> c & d --> e\n  classDef x fill:#fff');
  assert.deepEqual([...graph.nodes.keys()], ['a', 'b', 'c', 'd', 'e']);
  assert.equal(graph.nodes.get('a'), '["Go --> on"]');
  assert.deepEqual(graph.edges.map((edge) => `${edge.from}>${edge.to}`), ['a>b', 'b>c', 'b>d', 'c>e', 'd>e']);

  // Drill up keeps a flow chart whole up to the limits and lights the part above them.
  const flow = (nodes: number, edges: number): string => {
    const lines = ['flowchart TD'];
    for (let index = 0; index < nodes; index++) lines.push(`  n${index}["Node ${index}"]`);
    for (let index = 0; index < edges; index++) lines.push(`  n${index % nodes} --> n${(index + 1) % nodes}`);
    return lines.join('\n');
  };
  assert.equal(drillUpStyle({ kind: 'flow', mermaid: flow(WHOLE_LIMIT.nodes, WHOLE_LIMIT.edges) }), 'whole');
  assert.equal(drillUpStyle({ kind: 'flow', mermaid: flow(WHOLE_LIMIT.nodes + 1, 10) }), 'lit');
  assert.equal(drillUpStyle({ kind: 'flow', mermaid: flow(10, WHOLE_LIMIT.edges + 1) }), 'lit');
  assert.equal(drillUpStyle({ kind: 'sequence', mermaid: 'sequenceDiagram\n  A->>B: hi' }), 'lit');

  // Line numbers go under the labels of nodes with code lines; several places say how many; a reason shows nothing.
  const mermaid = 'flowchart TD\n  a["Ask"] --> b(["Done"])\n  b --> c["Mail"]\n  c --> d["User"]';
  const code = {
    a: { places: [{ file: 'x.py', lines: [3, 9] as [number, number] }] }, b: { places: [{ file: 'x.py', lines: [12, 12] as [number, number] }] },
    c: { places: [{ file: 'x.py', lines: [14, 15] as [number, number] }, { file: 'mail.py', lines: [2, 3] as [number, number] }, { file: 'mail.py' }] },
    d: { places: [], reason: 'outside' as const },
  };
  const text = partMermaid('flow', mermaid, code);
  assert.match(text, /a\["Ask<span class='ln'>lines 3–9<\/span>"\]/);
  assert.match(text, /b\(\["Done<span class='ln'>line 12<\/span>"\]\)/);
  assert.match(text, /c\["Mail<span class='ln'>3 places<\/span>"\]/);
  assert.match(text, /d\["User"\]/);
  // A node with a diff shows its counts in place of its line number; a node without one keeps it.
  const changed = partMermaid('flow', mermaid, { ...code, a: { ...code.a, counts: { added: 1, removed: 1 } } });
  assert.match(changed, /a\["Ask<span class='ln'><i class='p'>\+1<\/i> <i class='m'>−1<\/i><\/span>"\]/);
  assert.match(changed, /b\(\["Done<span class='ln'>line 12<\/span>"\]\)/);
});

test('the difference of a broad diagram finds a new node and a removed node, and each broad diagram that the change alters is named under the change with its total diff', () => {
  const diagram = {
    kind: 'flow' as const,
    mermaid: 'flowchart LR\n  page["Page"] --> loans["Loans"]\n  page --> holds["Holds"]',
    before: 'flowchart LR\n  page["Page"] --> loans["Loans"]\n  page --> lists["Lists"]',
  };
  assert.deepEqual(broadDifference(diagram), { added: ['holds'], removed: ['lists'] });
  const text = broadMermaid(diagram);
  assert.match(text, /lists\["Lists"\]/);
  assert.match(text, /class holds lit/);
  assert.match(text, /class lists gone/);
  assert.match(text, /linkStyle 1 /);

  // Each broad diagram that the change alters is named under the change with its total diff.
  const file = testChangeFile();
  const broad = (id: string, before?: string) => ({
    id, kind: 'flow' as const, title: id, broad: true, before,
    mermaid: `flowchart LR\n  a["A"] --> ${id}["New"]`,
  });
  file.diagrams!.push(broad('first', 'flowchart LR\n  a["A"]'), broad('second', 'flowchart LR\n  a["A"] --> gone["Gone"]'), broad('same'),
    broad('kept', 'flowchart LR\n  a["A"] --> kept["New"]'));
  const id = store.saveChange({
    repoId: repoId(repo.folder), folder: repo.folder, branch: 'feature', base: repo.base, head: headCommit(repo.folder),
    file, checks: checkChangeFile(repo.folder, repo.base, file),
  });
  const page = pageData(store, id, repo.folder)!;
  assert.deepEqual(page.altered, ['first', 'second']);
  const draw = (name: string) => page.diagrams.find((diagram) => diagram.id === name)!.draw;
  assert.match(draw('first'), /class first lit/);
  assert.match(draw('second'), /class second lit/);
  assert.match(draw('second'), /class gone gone/);
  const total = (name: string) => page.diagrams.find((diagram) => diagram.id === name)!.difference;
  assert.deepEqual([total('first'), total('second'), total('kept')], [{ added: 1, removed: 0 }, { added: 1, removed: 1 }, undefined]); // "kept" has no diff: no card
});

test('the page of a part has the code of each thing, the changed lines in no step, "checked" until the next save, its change and its removed steps from "before"; an old description opens as the page of today', () => {
  const file = testChangeFile();
  const [flow] = file.diagrams!;
  // From before the rule: a step with no code and no reason, and no "covers". It is stored as it was and opens.
  const old = { ...flow, id: 'old-flow', nodeLines: { done: [6, 6] as [number, number] }, covers: undefined };
  const now = { ...flow, nodeLines: { ask: [{ file: 'src/new_tool.py', lines: [1, 2] as [number, number] }, [5, 5] as [number, number]], done: 'no-line' as const } };
  const id = store.saveChange({
    repoId: repoId(repo.folder), folder: repo.folder, branch: 'feature', base: repo.base, head: headCommit(repo.folder),
    file: { ...file, diagrams: [now, old] }, checks: checkChangeFile(repo.folder, repo.base, file),
  });
  store.markChecked(id, ['stop-flow']);
  const [page, before] = pageData(store, id, repo.folder)!.diagrams;
  assert.deepEqual(page.code.ask, { places: [{ file: 'src/new_tool.py', lines: [1, 2] }, { file: 'src/app.py', lines: [5, 5] }], counts: { added: 3, removed: 0 } });
  assert.deepEqual(page.code.done, { places: [], reason: 'no-line', why: 'No line of its own.' });
  assert.equal(page.code['edge:0'].reason, 'order');
  assert.deepEqual([page.inNoThing, page.inNoThingWords, page.checked], [[6], '1 changed line in no step', true]);
  assert.deepEqual([Object.keys(before.code), before.checked, before.inNoThing], [['done', 'edge:0'], false, undefined]);
  // A new save takes the mark away.
  store.saveChange({ repoId: repoId(repo.folder), folder: repo.folder, branch: 'feature', base: repo.base, head: headCommit(repo.folder), file, checks: checkChangeFile(repo.folder, repo.base, file) });
  assert.equal(pageData(store, id, repo.folder)!.diagrams[0].checked, false);

  // A diagram with "before" shows its change and its removed steps; an old change file with no "before" and no code lines gives the page of today.
  {
    const file = testChangeFile();
    const [flow] = file.diagrams!;
    const old = { ...flow, id: 'old-flow', nodeLines: undefined };
    const changed = { ...flow, id: 'changed-flow', nodeLines: undefined, before: 'flowchart TD\n  ask["Ask to stop"] --> wait["Wait"]\n  wait --> done(["Return 0"])' };
    const id = store.saveChange({
      repoId: repoId(repo.folder), folder: repo.folder, branch: 'feature', base: repo.base, head: headCommit(repo.folder),
      file: { ...file, diagrams: [changed, old] }, checks: checkChangeFile(repo.folder, repo.base, file),
    });
    const page = pageData(store, id, repo.folder)!;
    const [withChange, today] = page.diagrams;
    assert.deepEqual(withChange.change?.nodes, { wait: 'removed' });
    assert.equal(withChange.plain, flow.mermaid); // drawn when the text with the removed step does not draw
    assert.match(withChange.draw, /wait\["Wait"\]\n  ask -\.-> wait\n  wait -\.-> done$/);
    assert.match(page.parts[0].drillUp!, /wait\["Wait"\]/); // the part kept whole after drill up has its removed step too
    assert.doesNotMatch(page.parts[0].drillUpPlain!, /Wait/);
    assert.equal(today.change, undefined);
    assert.equal(today.plain, undefined);
    assert.equal(today.draw, flow.mermaid);
  }
});

test('the state line of a row and of a remark: the first case that applies, the way that reaches its session, whom it waits for or who works on it, and the state of the newest remark of a thread that is not open', () => {
  const line = (sent: number, running: number, done: number, phrase = 'out of date') => States.rowLine({ sent, running, done }, phrase);
  assert.deepEqual(line(2, 1, 1), { text: 'the agent is working', dot: 'pulse' });
  assert.deepEqual(line(2, 0, 3), { text: '3 answers to read', dot: 'teal' });
  assert.deepEqual(line(0, 0, 1), { text: '1 answer to read', dot: 'teal' });
  assert.deepEqual(line(2, 0, 0), { text: '2 comments waiting for the agent' });
  assert.deepEqual(line(0, 0, 0), { text: 'out of date' });
  assert.deepEqual(line(0, 0, 0, 'no change file'), { text: 'no change file' });

  // A sent remark offers the way that reaches its session.
  const sent = { state: 'sent' };
  assert.equal(States.remarkLine(sent, { hostSession: 'h', canResume: true }, true).way, 'listening');
  assert.equal(States.remarkLine(sent, { hostSession: 'h', canResume: true }, false).way, 'start'); // it can be continued: no need to open the app first
  assert.equal(States.remarkLine(sent, { hostSession: 'h' }, false).way, 'connect');
  assert.equal(States.remarkLine(sent, { canResume: true }, false).way, 'start');
  assert.equal(States.remarkLine(sent, undefined, false).way, undefined);
  assert.deepEqual(States.remarkLine({ state: 'running' }, undefined, false), { text: 'the agent is working', dot: 'pulse' });
  // The mark of a thread: a note to no agent, waiting, working, answered until its card shows the answer.
  assert.deepEqual(['open', 'sent', 'running', 'done'].map((state) => States.markState({ state })), ['note', 'waiting', 'working', 'answered']);
  assert.equal(States.markState({ state: 'done' }, true), 'seen');
  assert.deepEqual(States.remarkLine({ state: 'running', to: { app: 'claude-code', kind: 'session', session: 's2', name: 'Tests for holds' } }, undefined, false), { text: 'Tests for holds is working', dot: 'pulse' });

  // The state line names whom a remark waits for, or who works on it.
  const current = { app: 'claude-code', kind: 'current' };
  assert.deepEqual(States.remarkLine({ state: 'sent', to: current }, { canResume: true }, false), { text: 'waiting for claude-current', way: 'start' });
  assert.deepEqual(States.remarkLine({ state: 'sent', to: { app: 'codex', kind: 'new' } }, undefined, false), { text: 'waiting for codex-new' });
  assert.deepEqual(States.remarkLine({ state: 'running', to: { app: 'claude-code', kind: 'new' } }, undefined, false), { text: 'claude-new is working', dot: 'pulse' });

  // A thread shows the state of its newest remark that is not open.
  assert.equal(States.threadLead([{ id: 1, state: 'done' }, { id: 2, state: 'open' }]).id, 1);
  assert.equal(States.threadLead([{ id: 1, state: 'done' }, { id: 2, state: 'sent' }]).id, 2);
  assert.equal(States.threadLead([{ id: 1, state: 'open' }, { id: 2, state: 'open' }]).id, 2);
  assert.deepEqual(States.remarkLine({ state: 'open' }, undefined, false), { text: '' });
});

test('the picker of where a comment goes: for each connected app this session, the known sessions of the repo (at most 3, newest first) and a new session, each with the model and effort of its run; GitHub only when the pull request takes it; no agent last; a page with no stored change offers only GitHub', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  const at = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const sessions: { app: string; session: string; name?: string; at: string }[] = [1, 2, 3, 4].map((n) => ({ app: 'claude-code', session: `known-000${n}`, name: n === 1 ? 'Tests for holds' : undefined, at: at(n * 10) }));
  sessions.push({ app: 'claude-code', session: 's1', at: at(1) }, { app: 'antigravity', session: 'a1', at: at(1) }); // the session of the change, and an app that is not connected
  const choices = States.sendChoices({ agent: { app: 'claude-code', session: 's1' }, apps: ['claude-code', 'codex', 'opencode'], sessions, models: { 'claude-code': 'haiku', codex: 'gpt-6-luna' }, effort: 'high', github: true, now });
  const shown = choices.map((choice: { key: string; words: string; sub: string; model: string }) => [choice.key, choice.words, choice.sub, choice.model].filter(Boolean).join(' | '));
  assert.deepEqual(shown, [
    'claude-code:current | This session | made this change | high',
    'claude-code:session:known-0001 | Tests for holds | used 10 min ago | high', // a continued session keeps its own model: only the effort
    'claude-code:session:known-0002 | known-00 | used 20 min ago | high',
    'claude-code:session:known-0003 | known-00 | used 30 min ago | high',
    'claude-code:new | New session | haiku · high',
    'codex:new | New session | gpt-6-luna · high',
    'opencode:new | New session | default model · high', // no model set: the model of the app's own settings
    'github | The pull request on GitHub',
    'none | No agent: keep it as a note',
  ]);
  assert.deepEqual(choices[1].to, { app: 'claude-code', kind: 'session', session: 'known-0001', name: 'Tests for holds' });
  assert.equal(States.choiceWords(choices[0]), 'Claude Code · this session · high');
  assert.equal(States.choiceWords(choices[5]), 'Codex · new session · gpt-6-luna · high');
  assert.equal(States.choiceWords(choices.at(-1)), 'Keep it as a note');
  // No session of the change, no pull request that takes it: a new session of each connected app and no agent; with no app connected only no agent.
  const keys = (options: object) => States.sendChoices(options).map((choice: { key: string }) => choice.key);
  assert.deepEqual(keys({ agent: { app: 'claude-code' }, apps: ['codex'] }), ['codex:new', 'none']);
  assert.deepEqual(keys({ agent: { app: 'claude-code', session: 's1' }, apps: [], github: true }), ['github', 'none']);
  assert.deepEqual(keys({ agent: { app: 'claude-code', session: 's1' }, apps: ['claude-code'], github: true, pullOnly: true }), ['github']);
  // The picker starts at the last choice when it has it, else this session, else a new session of the first app.
  assert.equal(States.startChoice(choices, { app: 'codex', kind: 'new' }).key, 'codex:new');
  assert.equal(States.startChoice(choices, null).key, 'none'); // the last comment went to no agent
  assert.equal(States.startChoice(choices, { app: 'codex', kind: 'current' }).key, 'claude-code:current');
  assert.equal(States.startChoice(States.sendChoices({ apps: ['codex', 'opencode'] }), undefined).key, 'codex:new');
});

test('@ offers the session of the change first, then a new session of each connected app, and letters cut the list; the pull requests of a row fold after two lines', () => {
  const names = (agent: unknown, apps: string[]) => States.mentionChoices(agent, apps).map((choice: { name: string }) => choice.name);
  const claude = { app: 'claude-code', session: 's1' };
  const all = ['claude-code', 'codex', 'antigravity', 'opencode'];
  assert.deepEqual(names(claude, all), ['claude-current', 'claude-new', 'codex-new', 'antigravity-new', 'opencode-new']);
  assert.deepEqual(names({ app: 'claude-code' }, ['codex', 'claude-code']), ['claude-new', 'codex-new']); // no session: no current
  assert.deepEqual(names(undefined, ['opencode']), ['opencode-new']);
  assert.deepEqual(names({ app: 'codex', session: 't1' }, []), []); // codex is not connected: its session is not offered
  const choices = States.mentionChoices(claude, all);
  assert.deepEqual(States.cutChoices(choices, 'c').map((choice: { name: string }) => choice.name), ['claude-current', 'claude-new', 'codex-new']);
  assert.deepEqual(States.cutChoices(choices, 'Cl').map((choice: { name: string }) => choice.name), ['claude-current', 'claude-new']);
  assert.deepEqual(States.cutChoices(choices, 'x'), []);
  assert.equal(choices[0].does, 'the session that made this change');
  assert.equal(choices[1].does, 'a new session');
  assert.equal(States.mentionChoices({ ...claude, name: 'VS Code repo understanding tool' }, ['claude-code'])[0].does, 'the session VS Code repo understanding tool');

  // The pull requests of a row fold after two lines; each row counts for itself.
  const pr = (number: number) => ({ number });
  assert.deepEqual(States.foldPulls([pr(12), pr(11)]), { shown: [pr(12), pr(11)], more: 0 });
  assert.deepEqual(States.foldPulls([pr(2), pr(3), pr(4)]), { shown: [pr(2), pr(3)], more: 1 });
  assert.deepEqual(States.foldPulls([]), { shown: [], more: 0 });
  assert.deepEqual(States.foldPulls([pr(1), pr(2), pr(3)], Infinity).more, 0);
  assert.equal(States.WORDS.morePulls(3), '3 more pull requests');
});

test('the list puts two changes of one session under one head, the newest first, in the order of their newest row, and reads the remark states; at a load a running remark whose run has ended is open again', () => {
  const agent = { app: 'claude-code', session: 's-1', account: 'sam@example.com', hostSession: 'h-1' };
  const save = (branch: string) => store.saveChange({
    repoId: repoId(repo.folder), folder: repo.folder, branch, base: repo.base, head: headCommit(repo.folder),
    file: testChangeFile(), checks: checkChangeFile(repo.folder, repo.base, testChangeFile()), agent,
  });
  const older = save('older');
  const newer = save('newer');
  const remark = store.addRemark(newer, { kind: 'part', part: 'app' }, 'Why?');
  store.sendRemark(remark);
  const rows = listRows(store, repo.folder);
  const groups = sessionGroups(rows);
  const session = groups.find((group) => group.agent?.session === 's-1')!;
  assert.deepEqual(session.rows.map((row) => row.id), [newer, older]);
  assert.equal(session.agent!.link, 'claude://claude.ai/epitaxy/h-1');
  assert.deepEqual(session.rows[0].remarks, { sent: 1, running: 0, done: 0 });
  assert.equal(groups.filter((group) => group.agent?.session === 's-1').length, 1);
  assert.ok(groups.filter((group) => !group.agent).every((group) => group.rows.length === 1), 'a change with no agent stands alone, with no head');

  // The head groups rows by session and keeps the order of their newest row.
  {
    const agent = (session: string) => agentOf({ app: 'codex', session });
    const row = (id: number, session?: string) => ({ id, agent: session ? agent(session) : undefined } as ListRow);
    const groups = sessionGroups([row(5, 'a'), row(4), row(3, 'b'), row(2, 'a'), row(1)]);
    assert.deepEqual(groups.map((group) => group.rows.map((r) => r.id)), [[5, 2], [4], [3], [1]]);
  }

  // At a load, a running remark whose run has ended is open again, and a live run stays.
  const id = saveTestChange();
  const ended = store.addRemark(id, { kind: 'part', part: 'app' }, 'Ended run');
  const live = store.addRemark(id, { kind: 'part', part: 'app' }, 'Live run');
  const deadPid = spawnSync('true').pid!; // a process that has ended
  store.startRemarkRun(ended, { pid: deadPid, startedAt: new Date().toISOString() });
  store.startRemarkRun(live, { pid: process.pid, startedAt: new Date().toISOString() });
  reopenStaleRuns(store, id);
  const states = Object.fromEntries(store.remarks(id).filter((remark) => [ended, live].includes(remark.id)).map((remark) => [remark.text, remark.state]));
  assert.deepEqual(states, { 'Ended run': 'open', 'Live run': 'running' });
});

test('the install links the command into the first folder on the path that can be written and replaces only its own link; an installed extension gets a launcher script, known as Apostil\'s own', () => {
  const root = tempFolder();
  const [notOnPath, first, second] = ['not-on-path', 'first', 'second'].map((name) => { mkdirSync(join(root, name)); return join(root, name); });
  const checkout = join(root, 'checkout');
  mkdirSync(join(checkout, 'out', 'store'), { recursive: true });
  writeFileSync(join(checkout, 'package.json'), '{ "name": "apostil" }');
  const cli = join(checkout, 'out', 'store', 'cli.js');
  writeFileSync(cli, '#!/usr/bin/env node\n');
  const path = [first, second].join(':');

  assert.deepEqual(installCommand(cli, [notOnPath, first, second], path), { link: join(first, 'apostil') });
  assert.equal(readlinkSync(join(first, 'apostil')), cli);
  assert.deepEqual(installCommand(cli, [notOnPath, first, second], path), { link: join(first, 'apostil') }); // its own link is replaced

  writeFileSync(join(second, 'apostil'), 'another program');
  const refused = installCommand(cli, [second], path);
  assert.equal(refused.link, undefined);
  assert.match(refused.problem!, /is already there and is not Apostil's command/);

  const other = join(root, 'other.js');
  writeFileSync(other, '');
  symlinkSync(other, join(notOnPath, 'apostil'));
  assert.match(installCommand(cli, [notOnPath], `${notOnPath}:${first}`).problem!, /not Apostil's command/);
  assert.equal(readlinkSync(join(notOnPath, 'apostil')), other);
  assert.match(installCommand(cli, [notOnPath], second).problem!, /None of these folders/);

  // After an update the folder of the old install is gone: its link is replaced with one to the new cli.js.
  unlinkSync(join(first, 'apostil'));
  symlinkSync(join(root, 'apostil.apostil-0.0.1', 'out', 'store', 'cli.js'), join(first, 'apostil'));
  assert.deepEqual(installCommand(cli, [first], path), { link: join(first, 'apostil') });
  assert.equal(readlinkSync(join(first, 'apostil')), cli);

  // An installed extension gets a launcher script in place of a link, and it is known as Apostil's own.
  {
    const root = tempFolder();
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const install = join(root, 'ext space\'s');
    mkdirSync(join(install, 'out', 'store'), { recursive: true });
    writeFileSync(join(install, 'package.json'), '{ "name": "apostil" }');
    const cli = join(install, 'out', 'store', 'cli.js');
    writeFileSync(cli, 'console.log("cli", process.argv.slice(2).join(","), process.env.ELECTRON_RUN_AS_NODE ?? "-");\n');
    const editor = join(root, 'editor');
    writeFileSync(editor, '#!/bin/sh\necho "editor:$ELECTRON_RUN_AS_NODE:$APOSTIL_RUNS_ON $*"\n', { mode: 0o755 });
    const command = join(bin, 'apostil');
    const old = join(root, 'apostil.apostil-0.0.1', 'out', 'store', 'cli.js');
    symlinkSync(old, command); // a link of an earlier install
    assert.equal(needsRefresh(command, cli, editor), true);

    assert.deepEqual(installCommand(cli, [bin], bin, editor), { link: command });
    assert.equal(lstatSync(command).isSymbolicLink(), false);
    assert.match(readFileSync(command, 'utf8').split('\n')[1], /^# Written by Apostil for the install at .*ext space/);
    assert.equal(isOwnLink(command), true);
    assert.equal(needsRefresh(command, cli, editor), false);
    assert.equal(needsRefresh(command, cli, join(root, 'other-editor')), true); // another editor: written again

    // It runs cli.js with the editor as Node, passes the arguments and the exit code, and falls back to node.
    const run = (path: string) => spawnSync(command, ['a', 'b c'], { encoding: 'utf8', env: { PATH: path } });
    assert.equal(run('/usr/bin:/bin').stdout, `editor:1:editor ${cli} a b c\n`);
    unlinkSync(editor);
    const node = join(root, 'nodes');
    mkdirSync(node);
    symlinkSync(process.execPath, join(node, 'node'));
    assert.equal(run(`${node}:/usr/bin:/bin`).stdout, 'cli a,b c -\n'); // no editor mode on plain node
    const none = run('/usr/bin:/bin');
    assert.equal(none.status, 127);
    assert.match(none.stderr, /^apostil: the editor that installed this command is gone/);

    // A foreign file is left, a script whose cli.js is gone is written again, a checkout still gets a link.
    const foreign = join(root, 'foreign');
    mkdirSync(foreign);
    writeFileSync(join(foreign, 'apostil'), '#!/bin/sh\necho mine\n');
    assert.match(installCommand(cli, [foreign], foreign, editor).problem!, /not Apostil's command/);
    assert.equal(readFileSync(join(foreign, 'apostil'), 'utf8'), '#!/bin/sh\necho mine\n');
    writeFileSync(command, launcherScript(old, editor));
    assert.equal(needsRefresh(command, cli, editor), true);
    assert.deepEqual(installCommand(cli, [bin], bin, editor), { link: command });
    assert.equal(readFileSync(command, 'utf8'), launcherScript(cli, editor));
    assert.deepEqual(installCommand(cli, [bin], bin), { link: command });
    assert.equal(readlinkSync(command), cli);
  }
});

test('the rows of a file: every line with the removed lines in place, its changes as runs of rows, and the next file in the order of the parts without the generated files', () => {
  // The answer of the page for the code of src/app.py, as the test of the page data reads it.
  const code = { lines: ['def start():', '    return 2', '', '', 'def stop():', '    return 0'], changed: [[2, 6]], status: 'changed', removed: [{ at: 2, line: 2, text: '    return 1' }] };
  const rows = CodeNotes.fileRows(code);
  assert.deepEqual(rows.map((row: { kind: string; line: number; now: number }) => `${row.kind || '='}${row.line}${row.now ? '' : 'x'}`), ['=1', 'del2x', 'add2', 'add3', 'add4', 'add5', 'add6']);
  assert.equal(rows[1].partner, '    return 2'); // the removed line is marked against the line that took its place
  const removed = CodeNotes.fileRows({ lines: ['a', 'b'], changed: [], removed: [], status: 'removed' });
  assert.deepEqual(removed.map((row: { kind: string; now: number }) => `${row.kind}${row.now}`), ['del1', 'del2']);

  // The changes of a file are its runs of added and removed rows, in order.
  {
    const rows = CodeNotes.fileRows({ lines: ['a', 'b', 'c', 'd', 'e'], changed: [[2, 2], [4, 5]], removed: [{ at: 4, line: 4, text: 'old' }], status: 'changed' });
    assert.deepEqual(CodeNotes.changeRuns(rows), [[1, 1], [3, 5]]);
    assert.deepEqual(CodeNotes.changeRuns(CodeNotes.fileRows({ lines: ['a'], changed: [], removed: [] })), []);
  }

  // The next file is the next changed file of the parts in order, then the files in no part, without the generated files.
  {
    const page = {
      files: ['a.py', 'b.py', 'gen/x.js', 'free.txt', 'c.py'].map((path) => ({ path, added: 1, removed: 0, status: 'changed' })),
      parts: [{ id: 'one', name: 'One', files: ['b.py', 'a.py', 'not-changed.py'] }, { id: 'two', name: 'Two', files: ['c.py', 'gen/x.js'] }],
      checks: { generated: ['gen/x.js'], filesInNoPart: ['free.txt'] },
    };
    assert.deepEqual(CodeNotes.filesByPart(page), [{ id: 'one', name: 'One', paths: ['b.py', 'a.py'] }, { id: 'two', name: 'Two', paths: ['c.py'] }, { id: 'no-part', name: 'In no part', paths: ['free.txt'] }]);
  }
});

test('the cards beside the code: a step inside its function takes the next lane, and a card stands at its first row, shows its title where cards crowd, or stands lower', () => {
  // A function at rows 0-29 with steps 1-8 and 9-16, the next function at 30-50 with one step, and a note inside a step.
  assert.deepEqual(CodeNotes.lanesOf([[0, 29], [1, 8], [9, 16], [10, 12], [30, 50], [31, 40]]), [0, 1, 1, 2, 0, 1]);
  assert.deepEqual(CodeNotes.lanesOf([[0, 9], [0, 3], [1, 2], [1, 1]]), [0, 1, 2, 2]); // never more than three lanes

  // A card stands at its first row; cards that crowd each other show their titles; where titles do not fit, a card stands lower.
  const room = () => 4;
  // Room enough: every card whole, at its row.
  assert.deepEqual(CodeNotes.cardPlaces([0, 200, 400], [80, 80, 80], 26, room, -4), { tops: [0, 200, 400], short: [false, false, false], bottom: 480 });
  // The first card would reach the row of the second: both show their titles, since the second has no room for its text and one more title; the third has room and is whole.
  assert.deepEqual(CodeNotes.cardPlaces([0, 40, 140, 400], [80, 80, 80, 80], 26, room, -4), { tops: [0, 40, 140, 400], short: [true, true, false, false], bottom: 480 });
  // A card after a crowding card with room enough is whole: a function's title, then its first long step.
  assert.deepEqual(CodeNotes.cardPlaces([0, 18, 300], [80, 80, 80], 26, room, -4), { tops: [0, 30, 300], short: [true, false, false], bottom: 380 });
  // Rows closer than a title: the second card stands below the first.
  assert.deepEqual(CodeNotes.cardPlaces([0, 10, 20], [80, 80, 80], 26, room, -4), { tops: [0, 30, 60], short: [true, true, false], bottom: 140 });
});

test('the output of a run: its session, why it failed or stopped, and the commands that it was not allowed to use', () => {
  assert.equal(sessionFromOutput('{"type":"result","session_id":"c-1","result":"ok"}\n'), 'c-1');
  assert.equal(sessionFromOutput('{"type":"thread.started","thread_id":"t-2"}\n{"type":"turn.started"}\n'), 't-2');
  assert.equal(sessionFromOutput('Working...\nnot json\n'), undefined);

  // A run that failed says why: the last failure of Codex, or the result of Claude Code that is an error.
  const warning = '{"type":"item.completed","item":{"type":"error","message":"A setting is ignored."}}';
  const refused = '{"type":"error","message":"This model is not supported."}\n{"type":"turn.failed","error":{"message":"This model is not supported."}}';
  assert.equal(problemFromOutput(`{"type":"thread.started","thread_id":"t"}\n${warning}\n${refused}\n`), 'This model is not supported.');
  assert.equal(problemFromOutput(`${warning}\n{"type":"turn.completed"}\n`), undefined); // a warning is not a failure
  assert.equal(problemFromOutput('{"type":"error","message":"Connecting again"}\n{"type":"turn.completed"}\n'), undefined); // it went on and ended well
  assert.equal(problemFromOutput('{"type":"result","is_error":true,"result":"Not logged in"}\n'), 'Not logged in');
  assert.equal(problemFromOutput('{"type":"result","is_error":false,"result":"Done"}\nnot json\n'), undefined);

  // A run that stops says why: from its error output, from a failed result with no text, and the commands that it was not allowed to use.
  assert.equal(problemFromErrors("\nerror: unknown option '--permission-mode'\n\n"), "error: unknown option '--permission-mode'");
  assert.equal(problemFromErrors(''), undefined);
  assert.equal(problemFromOutput('{"type":"result","is_error":true,"subtype":"error_max_turns"}\n'), 'It stopped after the most turns that it may take.');
  assert.equal(problemFromOutput('{"type":"result","is_error":true,"subtype":"error_during_execution","api_error_status":529}\n'), 'The API answered with status 529.');
  assert.equal(problemFromOutput('{"type":"result","is_error":true,"subtype":"error_during_execution","terminal_reason":"aborted"}\n'), 'It stopped with an error (aborted).');
  assert.equal(allowRule('git ls-files --cached --others scripts/'), 'Bash(git ls-files *)');
  assert.equal(allowRule('cd /repo && apostil add-notes apostil-notes-a.json'), 'Bash(apostil add-notes *)');
  assert.equal(allowRule('(apostil map --json | head -5)'), 'Bash(apostil map *)'); // the brackets of a subshell are no program
  assert.equal(allowRule('python3 -c "print(1)"'), 'Bash(python3 *)');
  const result = JSON.stringify({ type: 'result', is_error: false, result: 'Done', permission_denials: [
    { tool_name: 'Bash', tool_input: { command: 'git ls-files src/' } }, { tool_name: 'Bash', tool_input: { command: 'git ls-files tests/' } }, { tool_name: 'WebFetch', tool_input: {} },
  ] });
  assert.deepEqual(deniedRules(`${result}\n`), ['Bash(git ls-files *)', 'WebFetch']);
  assert.deepEqual(deniedRules('{"type":"result","permission_denials":[]}\n'), []);
});

test('the map run gets the skills as text, says in its first words when it also describes the change, has APOSTIL_NO_WAIT, and its draft file leaves the repo when it ends', async () => {
  const prompt = mapPrompt();
  for (const words of ['# Map a repo', '# Write the overview of a repo', '# Write the diagram of one area', '# Write the notes of files', '"format": 1', MAP_DRAFT]) assert.ok(prompt.includes(words), words);
  assert.ok(prompt.includes(readFileSync(join(__dirname, '..', '..', 'skills', 'apostil-describe-change', 'text-rules.md'), 'utf8')));

  // A stand-in for the agent app writes the draft file, as a writer does, and ends.
  const bin = tempFolder('apostil-bin-');
  writeFileSync(join(bin, 'opencode'), `#!/bin/sh\necho '{}' > ${MAP_DRAFT}\necho "$APOSTIL_NO_WAIT" > seen-no-wait\n`, { mode: 0o755 });
  const folder = tempFolder('apostil-repo-');
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  const problem = await new Promise<string | undefined>((ended) => assert.equal(startMapRun('opencode', folder, ended), true));
  process.env.PATH = path;
  assert.equal(problem, undefined);
  assert.equal(existsSync(join(folder, MAP_DRAFT)), false);
  assert.equal(readFileSync(join(folder, 'seen-no-wait'), 'utf8').trim(), '1'); // the run Apostil starts never waits for the hook
  assert.equal(startMapRun('no-such-app', folder, () => {}), false);

  // A map run that also describes the change says so in its first words and gets the skill of the change.
  const plain = mapPrompt();
  const both = mapPrompt(true);
  assert.ok(plain.startsWith('Write the map of this repo for Apostil Home, with the notes of its code files and its processes, as the skill apostil-map-repo says. The files'));
  assert.ok(!plain.includes('# Describe a change'));
  assert.ok(plain.includes('----- apostil-map-repo/process-writer-prompt.md -----\n# Write the processes of a group of files')); // the prompt of the process writers
  assert.ok(both.startsWith(`Write the map of this repo for Apostil Home, with the notes of its code files and its processes, as the skill apostil-map-repo says. ${DESCRIBE_AFTER_MAP}`));
  for (const words of ['# Describe a change', '----- apostil-describe-change/writer-prompt.md -----', '----- apostil-describe-change/fresh-check-prompt.md -----']) assert.ok(both.includes(words), words);

  // A run that Apostil starts has APOSTIL_NO_WAIT in its environment, and keeps the rest.
  assert.equal(runEnvironment().APOSTIL_NO_WAIT, '1');
  assert.equal(runEnvironment().PATH, process.env.PATH);
});

test('the copies of the page are the same as their sources: a count with a comma for thousands, and the logo files of design/logo', () => {
  assert.deepEqual([999, 1000, 12345, 0].map((value) => number(value)), ['999', '1,000', '12,345', '0']);

  // The logo files of the page are the same as those of design/logo.
  const root = join(__dirname, '..', '..');
  for (const name of ['apostil-icon.svg', 'apostil-wordmark.svg']) {
    assert.equal(readFileSync(join(root, 'view', 'media', name), 'utf8'), readFileSync(join(root, 'design', 'logo', name), 'utf8'), name);
  }
});



