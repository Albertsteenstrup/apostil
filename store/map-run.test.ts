// Tests for the record of a map run: how the saves of the writers start it, add to it and end it, when it counts as stopped, and the words of its line on Home.

import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { headCommit, repoId } from '../shared/git';
import { findInMap, notesNow } from '../shared/map-read';
import { areaWork, homeRun, mapRunLine, mapRunState, QUIET_MS, runTimeLeft, withEnd, withSave, type MapRun } from '../shared/map-run';
import { markGroups } from '../shared/marks';
import { noteGroups, processGroups } from '../shared/note-groups';
import { processFacts } from '../shared/processes';
import { Store } from '../shared/store';
import { makeTestRepo, tempFolder } from '../shared/test-repo';
import { runMapCommand } from './map-commands';
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
  // The cards of Home: the area "code" has notes, processes and services to write, so a writer works on it now; "docs" has no code file and is done.
  assert.deepEqual(areaWork(store, repo.folder, store.getMap(id)!, grown), { code: { state: 'working', share: 0 } });

  // The notes of every code file, then the services of every code file: the test repo reaches no service and has no notes for a process, so no writer has work after these saves.
  const files = noteGroups(repo.folder, store.getMap(id)).groups.flatMap((group) => group.files.map((file) => file.path));
  assert.deepEqual(files, ['src/app.py', 'src/new_tool.py']);
  assert.ok(save('add-notes', { notes: [], files }));
  assert.equal(store.mapRun(id)!.endedAt, undefined); // the services of the code files are not read yet
  assert.ok(save('add-marks', { group: 'code', set: 'services', files, values: [], marks: [] }));
  const ended = store.mapRun(id)!;
  assert.deepEqual(ended.parts, { ofAreas: 2, overview: true, areas: ['Area one'], noteFiles: 2, marks: ['services'] });
  assert.ok(ended.endedAt);
  assert.equal(mapRunState(ended), 'done');
  assert.equal(mapRunLine(ended), undefined);
  store.close();
  repo.remove();
});

test('a run that saved processes ends only after its fold writers saved, a fold save adds to the same record, and the plan counts a fold writer for each process group', () => {
  const store = new Store(tempFolder('apostil-home-'));
  const repo = makeTestRepo();
  repo.write('src/app.py', 'def start():\n    return stop()\n\n\ndef stop():\n    return 0\n');
  repo.commit('start calls stop');
  const id = repoId(repo.folder);
  const drafts = tempFolder('apostil-draft-');
  const save = (command: string, draft: unknown): void => {
    writeFileSync(join(drafts, 'draft.json'), JSON.stringify(draft));
    const done = runMapCommand(store, command, join(drafts, 'draft.json'), repo.folder, {}, { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: SESSION });
    assert.ok(done.ok, JSON.stringify(done.output));
  };
  save('save-map', { format: 1, diagrams: [{ id: 'top', kind: 'flow', title: 'The test repo', mermaid: 'flowchart LR\n  code["Code"]', nodePaths: { code: ['src/'] } }] });
  const files = ['src/app.py', 'src/new_tool.py'];
  const note = (file: string, lines: [number, number], title: string) => ({ file, lines, title, text: 'Returns a number.' });
  save('add-notes', { notes: [note('src/app.py', [1, 2], 'Start the app'), note('src/app.py', [5, 6], 'Stop the app'), note('src/new_tool.py', [1, 2], 'Name the tool')], files });
  assert.equal(store.mapRun(id)!.plan?.fold, 1); // made when the last notes were saved: one process group is to come
  save('add-marks', { group: 'code', set: 'services', files, values: [], marks: [] });

  // The process writer starts a process at stop(), which start() calls: the fold round is still to come, so the record stays open.
  const start = { id: 'start-app', title: 'Start the app', summary: 'Starts the app and stops it.', steps: ['src/app.py:1-2', 'src/app.py:5-6'],
    arrows: [{ from: 'src/app.py:1-2', to: 'src/app.py:5-6', label: 'stop it', fromLine: 2, toLine: 5, name: 'stop' }] };
  const stop = { id: 'stop-app', title: 'Stop the app', summary: 'Returns zero.', steps: ['src/app.py:5-6'] };
  const tool = { id: 'name-tool', title: 'Name the tool', summary: 'Returns the name of the tool.', steps: ['src/new_tool.py:1-2'] };
  const group = processGroups(store.getMap(id)!.map).groups[0].name;
  save('add-processes', { group, processes: [start, stop, tool] });
  const before = store.mapRun(id)!;
  assert.equal(before.endedAt, undefined);

  save('add-processes', { group, add: true, processes: [start], fold: ['stop-app'] });
  const after = store.mapRun(id)!;
  assert.deepEqual([after.startedAt, after.saves?.at(-1)?.[0], after.parts.foldedInto], [before.startedAt, 'f', ['start-app']]);
  assert.ok(after.endedAt);
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
  // Once the services of its code files are read, its three code files all need notes: a third of the work of the area is done (its marks), as with whole files.
  const read = markGroups(repo.folder, store.getMap(id)!.map, 'services').groups.flatMap((group) => group.files.map((file) => file.path));
  writeFileSync(join(drafts, 'marks.json'), JSON.stringify({ group: 'code', set: 'services', files: read, values: [], marks: [] }));
  assert.ok(runMapCommand(store, 'add-marks', join(drafts, 'marks.json'), repo.folder, {}, { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: SESSION }).ok);
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

test('the time left starts at the first saved notes, or at the first save of any writer when the plan has no notes to write', () => {
  const plan = { at: 0, done: 0, lines: 20_000, overview: 0, areas: 0, notes: 0, noteFiles: 0, noteLines: 0, longest: 0, processes: 3, services: 10, again: 1, fit: 1 };
  const run: MapRun = { ...homeRun('claude-code', AT, SESSION), plan, saves: [] };
  assert.equal(runTimeLeft(run, later(2)), undefined); // nothing saved: the pace is not measured
  assert.ok(runTimeLeft({ ...run, saves: [['p', 2.3]] }, later(3))!.minutes > 20);
  // A plan with notes to write waits for the first notes, also after a process is saved.
  const withNotes: MapRun = { ...run, plan: { ...plan, notes: 2, noteFiles: 10, noteLines: 900, longest: 500 } };
  assert.equal(runTimeLeft({ ...withNotes, saves: [['p', 2.3]] }, later(3)), undefined);
  assert.ok(runTimeLeft({ ...withNotes, saves: [['p', 2.3], ['n', 4, 5]] }, later(5)));
});

test('the words of the line of Home: "Mapping…" for the run of Home and his own session, which opens in its app or in a terminal that continues it, and "Map stopped" after a stop', () => {
  const saved = (run: MapRun | undefined, agent = run?.agent): MapRun => {
    let next = withSave(run, { overview: true }, agent, 8, AT);
    for (const area of ['Lending', 'Desk', 'Catalogue']) next = withSave(next, { area }, agent, 8, AT);
    return withSave(next, { noteFiles: 40 }, agent, 8, AT);
  };
  const now = later(1);

  // The run of Home: a session with no window, first with no id, then with the id that the run reports; nothing opens it while it writes.
  assert.deepEqual(mapRunLine(homeRun('claude-code', AT), { now }), { state: 'writing', words: 'Mapping…', tip: 'a Claude Code session with no window · nothing saved yet' });
  const home = saved(homeRun('claude-code', AT), { app: 'claude-code', session: SESSION, hostSession: 'the-host-of-the-window' });
  assert.deepEqual(home.agent, { app: 'claude-code', session: SESSION }); // only the id of the session is taken
  assert.deepEqual(mapRunLine(home, { now }), {
    state: 'writing', words: 'Mapping…',
    tip: `Claude Code session 1a2b3c4d (a session with no window) · overview, 3 of 8 areas, notes of 40 files\nSession ${SESSION}\nAreas: Lending, Desk, Catalogue`, chart: true,
  });
  // The run of Home in a terminal: named from the start; while this window has its terminal, "Open the session" shows it.
  assert.deepEqual(mapRunLine(homeRun('claude-code', AT, SESSION), { now, alive: true }), { state: 'writing', words: 'Mapping…', tip: `Claude Code session 1a2b3c4d · nothing saved yet\nSession ${SESSION}`, opens: 'shown', chart: true });

  // His own session in the Claude desktop app opens there. A name of the session stands in place of the id.
  const desktop = saved(undefined, { app: 'claude-code', session: SESSION, hostSession: 'made-up-host-0002', account: 'reader@example.com' });
  const desktopLine = mapRunLine(desktop, { now, name: 'Map of library-app' })!;
  assert.deepEqual([desktopLine.words, desktopLine.tip?.split('\n')[0]], ['Mapping…', 'Claude Code session "Map of library-app" · overview, 3 of 8 areas, notes of 40 files']);
  assert.equal(desktopLine.opens, 'app');
  assert.ok(desktopLine.chart && !mapRunLine(homeRun('codex', AT, SESSION), { now })?.chart); // the chart reads the files of any session of Claude Code
  assert.ok(!JSON.stringify(desktopLine).includes('reader@example.com'));

  // His own session in a terminal has no link: it opens in a terminal that continues it. A session that did not name itself is an agent session.
  const terminal = mapRunLine(saved(undefined, { app: 'claude-code', session: SESSION }), { now })!;
  assert.deepEqual([terminal.words, terminal.tip?.split('\n')[0], terminal.opens], ['Mapping…', 'Claude Code session 1a2b3c4d · overview, 3 of 8 areas, notes of 40 files', 'terminal']);
  assert.equal(mapRunLine(withSave(undefined, { processGroup: 'lending-0a1b2c' }, undefined, undefined, AT), { now })?.tip?.split('\n')[0], 'an agent session · processes of 1 area');

  // A run that stopped: after 30 quiet minutes, or the run of Home that ended with a problem; a run of Home that this window still runs is not stopped by a quiet time.
  const stopped = mapRunLine(desktop, { now: later(31) })!;
  // After a stop: two short words, the rest in the tooltip, and no way to open the session ("Continue" goes on with it).
  assert.deepEqual([stopped.state, stopped.words, stopped.tip?.split('\n')[0], stopped.opens], ['stopped', 'Map stopped', 'The map run of Claude Code session 1a2b3c4d stopped after overview, 3 of 8 areas, notes of 40 files', undefined]);
  assert.deepEqual(mapRunLine(withEnd(homeRun('claude-code', AT), AT, true), { now }), { state: 'stopped', words: 'Map stopped', tip: 'The map run of a Claude Code session with no window stopped with nothing saved' });
  assert.equal(mapRunLine(withEnd(home, AT, true), { now })?.opens, undefined);
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
