// Tests for the notes beside the code: the text that the save keeps, and the rule that finds a note's lines again, also after a merge.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup } from '../store/cleanup';
import { addDiagramToMap, saveDraft, saveMapDraft } from '../store/save';
import type { Note } from './change-file';
import { fileText, git, repoId } from './git';
import { findBlock, fromWords, notesInRepo, notesOfFile, type NoteSource } from './notes-beside-code';
import { Store } from './store';
import { makeTestRepo, tempFolder, testChangeFile } from './test-repo';

const STOP = ['def stop():', '    return 0'];
const NOW = 'def start():\n    return 2\n\n\ndef stop():\n    return 0\n'; // src/app.py on the branch "feature" of the test repo
const note: Note = { file: 'src/app.py', lines: [5, 6], title: 'Stop the app', symbol: 'stop' };

/** A saved change with one note on src/app.py, as the rule reads it. */
const source = (id: number, fields: Partial<NoteSource> = {}): NoteSource => ({
  id, branch: `branch-${id}`, head: 'gone', savedAt: `2026-01-0${id}T00:00:00Z`,
  file: { title: `Change ${id}`, parts: [{ id: 'app', notes: [note] }] }, noteCode: { 'app/0': STOP }, ...fields,
});
const noGit = () => undefined;

test('the rule finds a note again by the text of its lines: moved down, changed, there twice, saved twice, with no kept text', () => {
  // A note whose lines moved down stands at the new place.
  const moved = notesOfFile([source(1)], 'src/app.py', `import os\n\n\n${NOW}`, noGit);
  assert.deepEqual(moved.notes.map((one) => one.lines), [[8, 9]]);
  assert.equal(moved.older, 0);
  assert.equal(moved.notes[0].change.title, 'Change 1');
  // A note whose lines changed does not show, and counts as older than the code.
  const changed = notesOfFile([source(1)], 'src/app.py', NOW.replace('return 0', 'return 9'), noGit);
  assert.deepEqual(changed.notes, []);
  assert.equal(changed.older, 1);
  // A block that is there twice: the place nearest to the old lines counts.
  const twice = ['def stop():', '    return 0', '', 'x = 1', '', '', 'def stop():', '    return 0'];
  assert.equal(findBlock(twice, STOP, 0), 0);
  assert.equal(findBlock(twice, STOP, 5), 6);
  assert.equal(findBlock(['', '', ''], ['', ''], 0), -1); // empty lines say nothing about the code
  assert.equal(findBlock(['def stop():  ', '    return 0\r'], STOP, 0), 0); // spaces at the end do not count
  assert.deepEqual(notesOfFile([source(1)], 'src/app.py', twice.join('\n'), noGit).notes[0].lines, [7, 8]); // the note was on lines 5-6
  // The same note from two saved changes shows once: the newest.
  const both = notesOfFile([source(2), source(1)], 'src/app.py', NOW, noGit);
  assert.equal(both.notes.length, 1);
  assert.equal(both.notes[0].change.id, 2);
  const other = source(3, { file: { title: 'Change 3', parts: [{ id: 'app', notes: [{ ...note, title: 'Another note' }] }] } });
  assert.equal(notesOfFile([source(2), other], 'src/app.py', NOW, noGit).notes.length, 2);
  // A change whose commit is gone: its kept text finds the lines; with no kept text its notes do not show.
  assert.equal(notesOfFile([source(1)], 'src/app.py', NOW, noGit).notes.length, 1);
  assert.deepEqual(notesOfFile([source(1, { noteCode: undefined })], 'src/app.py', NOW, noGit), { notes: [], older: 0 });
});

test('the save keeps the text of the lines of each note, and none for a note on removed lines; the rule reads the text of the editor, and a change saved with no kept text reads it from Git', () => {
  const store = new Store(tempFolder('apostil-home-'));
  const repo = makeTestRepo();
  const head = git(repo.folder, 'rev-parse', 'HEAD');
  // A change of an older version has no kept text: Git has its commit.
  store.saveChange({ repoId: repoId(repo.folder), folder: repo.folder, branch: 'feature', base: repo.base, head, file: testChangeFile(), checks: { filesInNoPart: [], filesInTwoParts: [], filesNotChanged: [], generated: [], badNotes: [] } });
  assert.deepEqual(notesInRepo(store, repo.folder, 'src/app.py', `# top\n${NOW}`).notes.map((one) => one.lines), [[6, 7]]);

  const file = testChangeFile();
  file.parts[0].notes!.push({ file: 'src/app.py', lines: [2, 2], removed: true, title: 'The old return' });
  const saved = saveDraft(store, repo.folder, file);
  assert.equal(saved.saved, true, saved.problems.join(' '));
  assert.deepEqual(store.getChange(saved.changeId!)?.noteCode, { 'app/0': STOP });
  // Lines that are not saved yet count: the text of the editor is what the rule reads.
  const onDisk = fileText(repo.folder, 'src/app.py')!;
  assert.deepEqual(notesInRepo(store, repo.folder, 'src/app.py', onDisk).notes.map((one) => one.lines), [[5, 6]]);
  assert.deepEqual(notesInRepo(store, repo.folder, 'src/app.py', `\n\n${onDisk}`).notes.map((one) => one.lines), [[7, 8]]); // two lines typed above, not saved
  assert.equal(notesInRepo(store, repo.folder, 'src/app.py', onDisk.replace('return 0', 'return 5')).notes.length, 0); // a noted line edited
  store.close();
  repo.remove();
});

test('after a squash merge into main and a deleted branch, the notes still stand beside the code, also after the cleanup removed the change', () => {
  const repo = makeTestRepo();
  const store = new Store(tempFolder('apostil-home-'));
  const saved = saveDraft(store, repo.folder, testChangeFile());
  git(repo.folder, 'checkout', '-q', 'main');
  git(repo.folder, 'merge', '-q', '--squash', 'feature');
  repo.commit('the feature, squashed');
  git(repo.folder, 'branch', '-q', '-D', 'feature');
  repo.write('src/app.py', `"""The app."""\n\n${fileText(repo.folder, 'src/app.py')}`);
  repo.commit('a line on top');
  const text = fileText(repo.folder, 'src/app.py')!;
  const found = notesInRepo(store, repo.folder, 'src/app.py', text);
  assert.deepEqual(found.notes.map((one) => [one.note.title, one.lines]), [['Stop the app', [7, 8]]]);

  // The cleanup marks the change missing only when its folder is gone; here it keeps the folder, so the change is removed by hand as the cleanup does it.
  const change = store.getChange(saved.changeId!)!;
  store.keepNotes(change);
  store.removeChange(change.id);
  const kept = notesInRepo(store, repo.folder, 'src/app.py', text);
  assert.deepEqual(kept.notes.map((one) => [one.note.title, one.lines, one.change.id]), [['Stop the app', [7, 8], -change.id]]);

  // The cleanup keeps the notes of a change that it removes.
  const checks = { filesInNoPart: [], filesInTwoParts: [], filesNotChanged: [], generated: [], badNotes: [] };
  const gone = store.saveChange({ repoId: 'r1', folder: '/made-up/gone', branch: 'merged', base: 'b', head: 'h', file: testChangeFile(), checks, noteCode: { 'app/0': STOP } });
  cleanup(store, new Date('2026-01-01T00:00:00Z'));
  cleanup(store, new Date('2026-01-09T00:00:00Z'));
  assert.equal(store.getChange(gone), undefined);
  assert.equal(notesOfFile(store.keptNotes('r1'), 'src/app.py', NOW, noGit).notes[0].note.title, 'Stop the app');
  store.close();
  repo.remove();
});

// ----- the notes of the map -----

const topMap = { id: 'top', kind: 'flow' as const, title: 'The test repo', mermaid: 'flowchart LR\n  code --> docs', nodePaths: { code: ['src/'], docs: ['README.md'] } };
const appArea = (notes: Note[]) => ({
  id: 'app-area', kind: 'flow' as const, title: 'How the app runs', mermaid: 'flowchart LR\n  app --> tool', parent: 'top', nodePaths: { app: ['src/app.py'], tool: ['src/new_tool.py'] }, notes,
});
const stopNote: Note = { file: 'src/app.py', lines: [5, 6], title: 'Stop returns zero', text: 'The app stops and says that all went well.' };

test('a map with notes: the save keeps the text of their lines, they stand beside the code with "From the map", a note of the change on the same lines wins, and a map with no notes of an older version still opens', () => {
  const store = new Store(tempFolder('apostil-home-'));
  const repo = makeTestRepo();
  // A map with no notes of an older version still opens, and gives no notes.
  store.saveMap(repoId(repo.folder), git(repo.folder, 'rev-parse', 'HEAD'), { format: 1, diagrams: [topMap, { ...appArea([]), notes: undefined }] });
  assert.deepEqual(notesInRepo(store, repo.folder, 'src/app.py', NOW), { notes: [], older: 0 });
  const added = addDiagramToMap(store, repo.folder, appArea([stopNote]));
  assert.deepEqual(added.problems, []);
  assert.deepEqual(store.getMap(repoId(repo.folder))?.map.noteCode, { 'app-area/0': STOP });
  const found = notesInRepo(store, repo.folder, 'src/app.py', `import os\n\n\n${NOW}`);
  assert.deepEqual(found.notes.map((one) => [one.note.title, one.lines, one.key]), [['Stop returns zero', [8, 9], 'map/app-area/0']]);
  assert.equal(fromWords(found.notes[0].change), 'From the map: How the app runs');
  // Lines that changed: the note does not show.
  assert.deepEqual(notesInRepo(store, repo.folder, 'src/app.py', NOW.replace('return 0', 'return 9')).notes, []);
  // A map that is written again takes the place of its old notes.
  saveMapDraft(store, repo.folder, { format: 1, diagrams: [topMap, appArea([])] });
  assert.deepEqual(notesInRepo(store, repo.folder, 'src/app.py', NOW).notes, []);

  // A change and the map with a note on the same lines: the note of the change shows.
  addDiagramToMap(store, repo.folder, appArea([stopNote, { file: 'src/app.py', lines: [1, 2], title: 'Start returns two' }]));
  assert.equal(saveDraft(store, repo.folder, testChangeFile()).saved, true); // its note "Stop the app" is on lines 5-6
  assert.deepEqual(notesInRepo(store, repo.folder, 'src/app.py', NOW).notes.map((one) => [one.note.title, fromWords(one.change)]), [
    ['Start returns two', 'From the map: How the app runs'],
    ['Stop the app', 'From the change "Adds a stop function and a tool" (feature)'],
  ]);

  // A note of the map on a new file that is not committed: it is saved and stands beside the code, and a new file that no node holds is named as left out.
  const draft = 'def draft():\n    return 1\n';
  repo.write('src/draft.py', draft);
  repo.write('src/other.py', 'y = 2\n');
  const area = appArea([{ file: 'src/draft.py', lines: [1, 2], title: 'A draft', text: 'Returns one.' }]);
  const withDraft = addDiagramToMap(store, repo.folder, { ...area, nodePaths: { ...area.nodePaths, app: ['src/app.py', 'src/draft.py'] } });
  assert.deepEqual([withDraft.saved, withDraft.problems], [true, []]);
  assert.deepEqual(withDraft.checks?.uncovered, { count: 1, paths: ['src/other.py'] });
  assert.deepEqual(notesInRepo(store, repo.folder, 'src/draft.py', draft).notes.map((one) => [one.note.title, one.lines]), [['A draft', [1, 2]]]);
  store.close();
  repo.remove();
});

test('the save of the map refuses a note outside its file, on a file that Git ignores or that does not exist, in the top diagram, and more than 12 notes, each with a sentence', () => {
  const store = new Store(tempFolder('apostil-home-'));
  const repo = makeTestRepo();
  saveMapDraft(store, repo.folder, { format: 1, diagrams: [topMap] });
  const outside = addDiagramToMap(store, repo.folder, appArea([{ ...stopNote, lines: [5, 40] }]));
  assert.equal(outside.saved, false);
  assert.deepEqual(outside.problems, ['Diagram "app-area", note "Stop returns zero": Line 40 is after the end of src/app.py, which has 6 lines.']);
  repo.write('.gitignore', 'build/\n');
  repo.write('build/out.py', 'x = 1\n');
  const ignored = addDiagramToMap(store, repo.folder, appArea([{ ...stopNote, file: 'build/out.py', lines: [1, 1] }]));
  assert.match(ignored.problems[0], /the file build\/out\.py is no file of the repo: Git ignores it, or it does not exist/);
  const missing = addDiagramToMap(store, repo.folder, appArea([{ ...stopNote, file: 'src/gone.py', lines: [1, 1] }]));
  assert.match(missing.problems[0], /the file src\/gone\.py is no file of the repo/);
  const top = saveMapDraft(store, repo.folder, { format: 1, diagrams: [{ ...topMap, notes: [stopNote] }] });
  assert.deepEqual(top.problems, ['Diagram "top": the top diagram has no notes. Put notes in the diagram of an area.']);
  const many = addDiagramToMap(store, repo.folder, appArea(Array(13).fill(stopNote)));
  assert.deepEqual(many.problems, ['Diagram "app-area": it has 13 notes. Keep the 12 that matter most.']);
  assert.deepEqual(store.getMap(repoId(repo.folder))?.map.diagrams.map((diagram) => diagram.id), ['top']);
  store.close();
  repo.remove();
});
