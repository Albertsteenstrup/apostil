// Tests for the record of a map run: how the saves of the writers start it, add to it and end it, when it counts as stopped, and the words of its line on Home.

import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { headCommit, repoId } from '../shared/git';
import { findInMap, notesNow } from '../shared/map-read';
import { homeRun, mapRunLine, mapRunState, QUIET_MS, withEnd, withSave, type MapRun } from '../shared/map-run';
import { noteGroups } from '../shared/note-groups';
import { processFacts } from '../shared/processes';
import { Store } from '../shared/store';
import { makeTestRepo, tempFolder } from '../shared/test-repo';
import { runMapCommand } from './map-commands';
import { areaWork } from './map-run';
import { addNotesToMap } from './save';

const SESSION = '1a2b3c4d-0000-4000-8000-00000000cafe'; // made up
const AT = '2026-11-17T10:00:00.000Z';
const later = (minutes: number): number => Date.parse(AT) + minutes * 60_000;

test('the first save of a writer opens the record with the session from the environment, the next saves add their parts, and the save that leaves no work ends it', () => {
  const store = new Store(tempFolder('apostil-home-'));
  const repo = makeTestRepo();
  const id = repoId(repo.folder);
  const drafts = tempFolder('apostil-draft-');
  const env = { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_CODE_HOST_SESSION_ID: 'made-up-host-0002' };
  const save = (command: string, draft: unknown): boolean => {
    writeFileSync(join(drafts, 'draft.json'), JSON.stringify(draft));
    return runMapCommand(store, command, join(drafts, 'draft.json'), repo.folder, {}, env).ok;
  };
  assert.equal(store.mapRun(id), undefined);

  // A save that is refused starts no record.
  assert.equal(save('save-map', { format: 1, diagrams: [] }), false);
  assert.equal(store.mapRun(id), undefined);

  assert.ok(save('save-map', { format: 1, diagrams: [{ id: 'top', kind: 'flow', title: 'The test repo', mermaid: 'flowchart LR\n  code --> docs', nodePaths: { code: ['src/'], docs: ['README.md'] } }] }));
  const opened = store.mapRun(id)!;
  assert.deepEqual(opened.agent, { app: 'claude-code', session: SESSION, hostSession: 'made-up-host-0002' });
  assert.deepEqual(opened.parts, { ofAreas: 2, overview: true });
  assert.equal(mapRunState(opened), 'writing');
  // The record keeps the time of each save, and the plan of the work that is left, made after its first save: the overview counts as done before it.
  assert.deepEqual(opened.saves, [['o', 0]]);
  assert.deepEqual([opened.plan?.overview, opened.plan?.notes, opened.plan?.noteFiles, opened.plan!.done > 4], [0, 1, 2, true]);

  assert.ok(save('add-diagram', { id: 'one', kind: 'flow', title: 'Area one', mermaid: 'flowchart LR\n  a --> b', parent: 'top', nodePaths: { a: ['src/app.py'], b: ['README.md'] } }));
  const grown = store.mapRun(id)!;
  assert.deepEqual(grown.parts, { ofAreas: 2, overview: true, areas: ['Area one'] });
  assert.equal(grown.startedAt, opened.startedAt);
  assert.equal(grown.endedAt, undefined); // the code files still need notes
  assert.deepEqual(grown.saves?.map(([kind]) => kind), ['o', 'a']);
  // The cards of Home: the area "code" has notes to write, so a writer works on it now; "docs" has no code file and is done.
  assert.deepEqual(areaWork(store, repo.folder, store.getMap(id)!, grown), { code: { state: 'working', share: 0.33 } });

  // The notes of every code file: the test repo reaches no service and has no notes for a process, so no writer has work after this save.
  const files = noteGroups(repo.folder, store.getMap(id)).groups.flatMap((group) => group.files.map((file) => file.path));
  assert.deepEqual(files, ['src/app.py', 'src/new_tool.py']);
  assert.ok(save('add-notes', { notes: [], files }));
  const ended = store.mapRun(id)!;
  assert.deepEqual(ended.parts, { ofAreas: 2, overview: true, areas: ['Area one'], noteFiles: 2 });
  assert.ok(ended.endedAt);
  assert.equal(mapRunState(ended), 'done');
  assert.equal(mapRunLine(ended), undefined);
  store.close();
  repo.remove();
});

test('the cards of Home count a long file that is cut into parts as one file that needs notes', () => {
  const store = new Store(tempFolder('apostil-home-'));
  const repo = makeTestRepo();
  repo.write('src/long.py', Array.from({ length: 20 }, (_, at) => [`def step${at}():`, ...Array.from({ length: 49 }, (_, line) => `    value_${line} = ${line}`), ''].join('\n')).join('\n'));
  const id = repoId(repo.folder);
  const drafts = tempFolder('apostil-draft-');
  writeFileSync(join(drafts, 'map.json'), JSON.stringify({ format: 1, diagrams: [{ id: 'top', kind: 'flow', title: 'The test repo', mermaid: 'flowchart LR\n  code --> docs', nodePaths: { code: ['src/'], docs: ['README.md'] } }] }));
  assert.ok(runMapCommand(store, 'save-map', join(drafts, 'map.json'), repo.folder, {}, { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: SESSION }).ok);
  assert.equal(noteGroups(repo.folder, store.getMap(id)).groups.filter((group) => group.files[0].part).length, 3);
  // Its three code files all need notes: a third of the work of the area is done (its marks), as with whole files.
  assert.deepEqual(areaWork(store, repo.folder, store.getMap(id)!, store.mapRun(id)!), { code: { state: 'working', share: 0.33 } });
  store.close();
  repo.remove();
});

test('an open record with no save for 30 minutes counts as stopped; a run that wrote only a part of a map is then done; a save after a stop goes on with the whole map', () => {
  const whole = withSave(undefined, { overview: true }, { app: 'claude-code', session: SESSION }, 8, AT);
  assert.equal(mapRunState(whole, later(30)), 'writing');
  assert.equal(mapRunState(whole, later(31)), 'stopped');
  assert.equal(QUIET_MS, 30 * 60_000);
  // The run of Home counts from its start, before the first save, and its end with a problem is a stop at once.
  assert.equal(mapRunState(homeRun('claude-code', AT), later(31)), 'stopped');
  assert.equal(mapRunState(withEnd(homeRun('claude-code', AT), AT, true)!, later(1)), 'stopped');
  assert.equal(mapRunState(withEnd(whole, AT)!, later(31)), 'done');
  // Notes alone, in a repo that has its map: quiet is done, not stopped.
  const part = withSave(undefined, { noteFiles: 3 }, undefined, 8, AT);
  assert.equal(mapRunState(part, later(31)), 'done');
  // A save 40 minutes after the last one starts a new record, which goes on with the whole map of the run that stopped.
  const after = withSave(whole, { noteFiles: 3 }, { app: 'claude-code', session: 'another-session' }, 8, new Date(later(40)).toISOString());
  assert.deepEqual([after.startedAt, after.whole, after.parts, after.agent?.session], [new Date(later(40)).toISOString(), true, { ofAreas: 8, noteFiles: 3 }, 'another-session']);
});

test('the words of the line of Home: the run of Home, his own session that opens in its app or in a terminal that continues it, and a run that stopped', () => {
  const saved = (run: MapRun | undefined, agent = run?.agent): MapRun => {
    let next = withSave(run, { overview: true }, agent, 8, AT);
    for (const area of ['Lending', 'Desk', 'Catalogue']) next = withSave(next, { area }, agent, 8, AT);
    return withSave(next, { noteFiles: 40 }, agent, 8, AT);
  };
  const now = later(1);

  // The run of Home: a session with no window, first with no id, then with the id that the run reports; nothing opens it while it writes.
  assert.deepEqual(mapRunLine(homeRun('claude-code', AT), { now }), { state: 'writing', words: 'Writing the map · a Claude Code session with no window · nothing saved yet' });
  const home = saved(homeRun('claude-code', AT), { app: 'claude-code', session: SESSION, hostSession: 'the-host-of-the-window' });
  assert.deepEqual(home.agent, { app: 'claude-code', session: SESSION }); // only the id of the session is taken
  assert.deepEqual(mapRunLine(home, { now }), {
    state: 'writing', words: 'Writing the map · Claude Code session 1a2b3c4d (a session with no window) · overview, 3 of 8 areas, notes of 40 files',
    tip: `Session ${SESSION}\nAreas: Lending, Desk, Catalogue`, chart: true,
  });
  // The run of Home in a terminal: named from the start; while this window has its terminal, "Open the session" shows it.
  assert.deepEqual(mapRunLine(homeRun('claude-code', AT, SESSION), { now, alive: true }), { state: 'writing', words: 'Writing the map · Claude Code session 1a2b3c4d · nothing saved yet', tip: `Session ${SESSION}`, opens: 'shown', chart: true });

  // His own session in the Claude desktop app opens there. A name of the session stands in place of the id.
  const desktop = saved(undefined, { app: 'claude-code', session: SESSION, hostSession: 'made-up-host-0002', account: 'reader@example.com' });
  const desktopLine = mapRunLine(desktop, { now, name: 'Map of library-app' })!;
  assert.equal(desktopLine.words, 'Writing the map · Claude Code session "Map of library-app" · overview, 3 of 8 areas, notes of 40 files');
  assert.equal(desktopLine.opens, 'app');
  assert.ok(!desktopLine.chart && !mapRunLine(homeRun('codex', AT, SESSION), { now })?.chart); // the chart reads only the files of a run of Home by Claude Code
  assert.ok(!JSON.stringify(desktopLine).includes('reader@example.com'));

  // His own session in a terminal has no link: it opens in a terminal that continues it. A session that did not name itself is an agent session.
  const terminal = mapRunLine(saved(undefined, { app: 'claude-code', session: SESSION }), { now })!;
  assert.deepEqual([terminal.words, terminal.opens], ['Writing the map · Claude Code session 1a2b3c4d · overview, 3 of 8 areas, notes of 40 files', 'terminal']);
  assert.equal(mapRunLine(withSave(undefined, { processGroup: 'lending-0a1b2c' }, undefined, undefined, AT), { now })?.words, 'Writing the map · an agent session · processes of 1 area');

  // A run that stopped: after 30 quiet minutes, or the run of Home that ended with a problem; a run of Home that this window still runs is not stopped by a quiet time.
  const stopped = mapRunLine(desktop, { now: later(31) })!;
  assert.deepEqual([stopped.state, stopped.words, stopped.opens], ['stopped', 'The map run of Claude Code session 1a2b3c4d stopped after overview, 3 of 8 areas, notes of 40 files', 'app']);
  assert.deepEqual(mapRunLine(withEnd(homeRun('claude-code', AT), AT, true), { now }), { state: 'stopped', words: 'The map run of a Claude Code session with no window stopped with nothing saved' });
  assert.equal(mapRunLine(withEnd(home, AT, true), { now })?.opens, 'terminal');
  assert.equal(mapRunLine(homeRun('claude-code', AT), { now: later(31), alive: true })?.state, 'writing');
});

test('the first save of a run removes what the map holds of a deleted file and of a file that .apostilignore now leaves out: a process with some steps there is stale, one with all its steps there goes; no read removes them', () => {
  const store = new Store(tempFolder('apostil-home-'));
  const repo = makeTestRepo();
  const id = repoId(repo.folder);
  repo.write('src/old.py', 'def old():\n    return 0\n');
  repo.write('src/legacy.py', 'def legacy():\n    return 0\n');
  repo.commit('two more files');
  const top = { id: 'top', kind: 'flow' as const, title: 'The test repo', mermaid: 'flowchart LR\n  code --> docs', nodePaths: { code: ['src/'], docs: ['README.md'] } };
  store.updateMap(id, headCommit(repo.folder), () => ({ format: 1, diagrams: [top] }));
  const note = (file: string, title: string) => ({ file, lines: [1, 2] as [number, number], title, text: 'It returns a number.' });
  assert.ok(addNotesToMap(store, repo.folder, { notes: [note('src/app.py', 'Start the app'), note('src/old.py', 'Return the old number'), note('src/legacy.py', 'Return the legacy number')] }).saved);
  const process = { id: 'old-flow', group: 'code-000000', title: 'Old flow', summary: 'It runs the old code.', steps: ['src/app.py:1-2', 'src/old.py:1-2'] };
  const legacy = { id: 'legacy-flow', group: 'code-000000', title: 'Legacy flow', summary: 'It runs the legacy code.', steps: ['src/legacy.py:1-2'] };
  const handoff = { from: 'old-flow', to: 'legacy-flow', name: 'number', fromLine: { file: 'src/app.py', line: 2 }, toLine: { file: 'src/legacy.py', line: 1 } };
  const mark = (file: string) => ({ set: 'services', value: 'postgres', file, line: 1, name: 'number', group: 'services-000000', code: 'def x():' });
  store.updateMap(id, headCommit(repo.folder), (map) => ({
    ...map!, processes: [process, legacy], handoffs: [handoff], notInProcess: [{ note: 'src/legacy.py:1-2', why: 'A helper.' }],
    marks: [mark('src/app.py'), mark('src/legacy.py')], markedFiles: { services: { 'src/app.py': 'a', 'src/legacy.py': 'b' } },
  }));

  // The file is deleted and the other one left out; a read changes nothing.
  rmSync(join(repo.folder, 'src/old.py'));
  repo.commit('remove the old file');
  repo.write('.apostilignore', 'legacy.py\n');
  noteGroups(repo.folder, store.getMap(id));
  assert.ok(findInMap(repo.folder, store.getMap(id)!, 'legacy').includes('src/legacy.py:1-2  Return the legacy number'));
  assert.equal(store.getMap(id)!.map.fileNotes?.length, 3);
  assert.equal(processFacts(store.getMap(id)!.map).stale.length, 0);

  // The first save of a run: only the note of the file that stays, still at the text of its lines; the process that named the deleted file is stale.
  // The process that lay wholly in the left-out file goes, with its handoff, its set-aside note and the mark of that file: no writer could redo them.
  const drafts = tempFolder('apostil-draft-');
  writeFileSync(join(drafts, 'map.json'), JSON.stringify({ format: 1, diagrams: [top] }));
  assert.ok(runMapCommand(store, 'save-map', join(drafts, 'map.json'), repo.folder, {}, { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: SESSION }).ok);
  const stored = store.getMap(id)!;
  assert.deepEqual(stored.map.fileNotes?.map((one) => one.file), ['src/app.py']);
  assert.equal(notesNow(stored, 'src/app.py', 'def start():\n    return 2\n')[0].changed, undefined);
  assert.deepEqual(processFacts(stored.map).stale, [{ id: 'old-flow', group: 'code-000000', gone: 1 }]);
  assert.deepEqual(stored.map.processes?.map((one) => one.id), ['old-flow']);
  assert.deepEqual([stored.map.handoffs, stored.map.notInProcess], [undefined, undefined]);
  assert.deepEqual(stored.map.marks?.map((one) => one.file), ['src/app.py']);
  assert.deepEqual(stored.map.markedFiles, { services: { 'src/app.py': 'a' } });
  assert.match(findInMap(repo.folder, stored, 'legacy'), /^Nothing in the map matches/);
  store.close();
  repo.remove();
});
