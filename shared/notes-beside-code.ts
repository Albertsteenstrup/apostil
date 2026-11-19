// The notes beside the code of one file: from every described change of the repo, open or merged, and from the map, found again by the text of their lines.
// The editor of VS Code, the file tab of Apostil and the tests all use this one rule. It does not ask Git which commit holds which: a branch can be squashed and deleted.

import type { ChangeFile, Note } from './change-file';
import { cellsIn } from './checks';
import { commitExists, fileText, repoId } from './git';
import { FILE_NOTES_PART, mapAsChange } from './repo-map';
import { cellsOfText, inCellText, placeInCell } from './notebook';
import type { StoredMap, Store } from './store';

/** What the rule reads of a saved change: a stored change, the notes that the store kept of a change after the cleanup removed it, or the map. */
export interface NoteSource {
  id: number; // the id of the change; negative for the kept notes of a removed change; 0 for the map
  branch: string;
  head: string; // the newest commit at the save
  savedAt: string;
  file: { title: string; parts: { id: string; name?: string; notes?: Note[] }[] };
  noteCode?: NoteCode;
  map?: true; // the map: each part is one of its diagrams, and its name is the title of that diagram
}

/** The map of a repo as a source of notes: each diagram with notes is a part, and the notes of files are one part (shared/repo-map.ts). A map of an older version may have none. */
export const mapSource = (stored: StoredMap): NoteSource => ({
  id: 0, branch: '', head: stored.commit, savedAt: stored.savedAt, map: true, file: mapAsChange(stored.map.diagrams, stored.map.fileNotes), noteCode: stored.map.noteCode ?? {},
});

/** The text of the lines of each note when its change was saved, by the key of the note ("<part id>/<index>"). The save keeps it; a note on removed lines has none. */
export type NoteCode = Record<string, string[]>;

export const noteKey = (part: string, index: number): string => `${part}/${index}`;

/** The text of the lines of each note of a change file, in the folder as it is now: what the save keeps. A note in a cell of a notebook keeps the lines of that cell. */
export function noteCodeOf(folder: string, written: ChangeFile, base = 'HEAD'): NoteCode {
  const code: NoteCode = {};
  const texts = new Map<string, string[] | undefined>();
  const file = inCellText(written, cellsIn(folder, base)).file;
  for (const part of file.parts) {
    (part.notes ?? []).forEach((note, index) => {
      if (note.removed) return;
      if (!texts.has(note.file)) texts.set(note.file, fileText(folder, note.file)?.split('\n'));
      const lines = texts.get(note.file)?.slice(note.lines[0] - 1, note.lines[1]);
      if (lines?.length === note.lines[1] - note.lines[0] + 1) code[noteKey(part.id, index)] = lines;
    });
  }
  return code;
}

/** One note as it stands beside the code now. */
export interface NoteHere {
  note: Note; // as the change wrote it; its `lines` are the lines at the save
  key: string; // "<change id>/<part id>/<index>"
  lines: [number, number]; // where its lines are in the file now
  change: { id: number; title: string; branch: string; map?: true }; // for a note of the map: the title of its diagram, or '' for a note of a file
}

/** The notes of one file: those that stand beside its code, and how many are older than the code (their lines are no longer in the file). */
export interface NotesOfFile {
  notes: NoteHere[];
  older: number;
}

/** Two lines are the same when their text is, apart from spaces at the end (and a carriage return). */
const same = (a: string, b: string): boolean => a.trimEnd() === b.trimEnd();

/**
 * Where a block of lines stands in a file: the index (from 0) of its first line, or -1. When it stands there more than once,
 * the place nearest to `near` (the index of its first line at the save) counts. A block of only empty lines is never found: it says nothing about the code.
 */
export function findBlock(lines: string[], block: string[], near: number): number {
  if (!block.length || block.every((line) => !line.trim())) return -1;
  let found = -1;
  for (let at = 0; at + block.length <= lines.length; at++) {
    if (!block.every((line, offset) => same(lines[at + offset], line))) continue;
    if (found < 0 || Math.abs(at - near) < Math.abs(found - near)) found = at;
  }
  return found;
}

/** Gives the text of a note's lines at its save for a change of an older version, which kept no text, or undefined when it cannot be known. */
export type OldCode = (change: NoteSource, note: Note) => string[] | undefined;

/**
 * The notes of one file from the stored changes of its repo (the newest first, the map last), found in its text now; the text can hold lines that are not saved yet.
 * A note shows where its lines stand now as one block with the same text. The same note from two saves (a stack, a branch saved again) shows once: the newest.
 * When a change and the map have a note on the same lines, the note of the change shows.
 */
export function notesOfFile(changes: NoteSource[], path: string, text: string, oldCode: OldCode): NotesOfFile {
  const lines = text.split('\n');
  const seen = new Set<string>();
  const notes: NoteHere[] = [];
  let older = 0;
  for (const change of changes) {
    for (const part of change.file.parts) {
      (part.notes ?? []).forEach((note, index) => {
        if (note.removed || note.file !== path) return;
        const code = change.noteCode?.[noteKey(part.id, index)] ?? (note.cell === undefined ? oldCode(change, note) : undefined);
        if (!code) return; // an older version kept no text, and Git no longer has its commit
        const words = [note.title, note.text ?? '', ...code].join('\n');
        if (seen.has(words)) return;
        seen.add(words);
        const at = findBlock(lines, code, nearLine(note, lines));
        if (at < 0) return void older++;
        const range: [number, number] = [at + 1, at + code.length];
        if (change.map) {
          if (notes.some((other) => !other.change.map && other.lines[0] === range[0] && other.lines[1] === range[1])) return;
          return void notes.push({ note, key: `map/${noteKey(part.id, index)}`, lines: range, change: { id: 0, title: part.id === FILE_NOTES_PART ? '' : part.name ?? part.id, branch: '', map: true } });
        }
        notes.push({ note, key: `${change.id}/${noteKey(part.id, index)}`, lines: range, change: { id: change.id, title: change.file.title, branch: change.branch } });
      });
    }
  }
  // The notes of a file take the place of the notes that the diagrams of the map hold for that file: they say the same, with more detail.
  const ofFile = (here: NoteHere): boolean => here.change.map === true && here.change.title === '';
  const hasOwn = notes.some(ofFile);
  const shown = notes.filter((here) => !here.change.map || ofFile(here) || !hasOwn);
  return { notes: shown.sort((a, b) => a.lines[0] - b.lines[0]), older };
}

/** Where the lines of a note stood at its save, as an index from 0 in the text now: for a note in a cell, its lines in that cell now, so that the nearest cell counts when its text is there twice. */
function nearLine(note: Note, lines: string[]): number {
  if (note.cell === undefined) return note.lines[0] - 1;
  const found = placeInCell(cellsOfText(lines), note.file, note.cell, note.lines);
  return 'lines' in found ? found.lines[0] - 1 : 0;
}

/** Reads the old text of a note's lines from Git: its file at the commit of the save, while Git has that commit. Reads each file once. */
export function codeFromGit(folder: string): OldCode {
  const texts = new Map<string, string[] | undefined>();
  return (change, note) => {
    const key = `${change.head}:${note.file}`;
    if (!texts.has(key)) texts.set(key, commitExists(folder, change.head) ? fileText(folder, note.file, change.head)?.split('\n') : undefined);
    const lines = texts.get(key)?.slice(note.lines[0] - 1, note.lines[1]);
    return lines?.length === note.lines[1] - note.lines[0] + 1 ? lines : undefined;
  };
}

/** The notes of a file of the repo that `folder` is in, for its text now, from every change of that repo in the store, the kept notes of removed changes, and the map. */
export function notesInRepo(store: Store, folder: string, path: string, text: string, repo = repoId(folder), oldCode: OldCode = codeFromGit(folder)): NotesOfFile {
  const sources: NoteSource[] = [...store.listChanges(repo), ...store.keptNotes(repo)].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const map = store.getMap(repo);
  return notesOfFile(map ? [...sources, mapSource(map)] : sources, path, text, oldCode);
}

/** Where a note came from, in words: "From the map: <title of its diagram>", "From the map" for a note of a file, or "From the change "<title>" (<branch>)". */
export const fromWords = (change: NoteHere['change']): string => (change.map ? (change.title ? `From the map: ${change.title}` : 'From the map') : `From the change "${change.title}" (${change.branch})`);
