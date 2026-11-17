// The kept text of the lines of the notes of a map, by "<diagram id>/<index>": what each save of the map keeps, so that a note finds its code again.
// The notes of files share one part (FILE_NOTES_PART), so their key is their place in the list, and a save that changes the list moves each text with its note.

import type { Note } from '../shared/change-file';
import { noteCodeOf, type NoteCode } from '../shared/notes-beside-code';
import { FILE_NOTES_PART, mapAsChange, type RepoMap } from '../shared/repo-map';

/** The map with the text of the lines of its notes. A map with no notes stays as it was written. */
export function withNoteCode(map: RepoMap, noteCode: NoteCode): RepoMap {
  const { noteCode: _written, ...rest } = map;
  return Object.keys(noteCode).length ? { ...rest, noteCode } : rest;
}

export const isFileNoteKey = (key: string): boolean => key.startsWith(`${FILE_NOTES_PART}/`);

/** A note of a file with the text of its lines. */
export interface NoteWithCode {
  note: Note;
  code?: string[];
}

/** The notes of files of a map, each with the kept text of its lines. */
export const notesWithCode = (map: RepoMap): NoteWithCode[] => (map.fileNotes ?? []).map((note, index) => ({ note, code: map.noteCode?.[`${FILE_NOTES_PART}/${index}`] }));

/** New notes, each with the text of its lines in the folder now. */
export function freshNotes(folder: string, notes: Note[]): NoteWithCode[] {
  const fresh = noteCodeOf(folder, mapAsChange([], notes));
  return notes.map((note, index) => ({ note, code: fresh[`${FILE_NOTES_PART}/${index}`] }));
}

/** Notes in the order of their files, cells and lines; a wider note before a note inside it. */
export const sortedNotes = (all: NoteWithCode[]): NoteWithCode[] => [...all].sort((a, b) => a.note.file.localeCompare(b.note.file)
  || String(a.note.cell ?? '').localeCompare(String(b.note.cell ?? '')) || a.note.lines[0] - b.note.lines[0] || b.note.lines[1] - a.note.lines[1]);

/** The map with these notes of files, in the order given, and the text of their lines under their places in the list. The notes of diagrams keep theirs. */
export function withFileNotes(map: RepoMap, all: NoteWithCode[]): RepoMap {
  const noteCode = Object.fromEntries([
    ...Object.entries(map.noteCode ?? {}).filter(([key]) => !isFileNoteKey(key)),
    ...all.flatMap((one, index) => (one.code ? [[`${FILE_NOTES_PART}/${index}`, one.code]] : [])),
  ]);
  const { fileNotes: _old, ...rest } = map;
  return withNoteCode({ ...rest, ...(all.length ? { fileNotes: all.map((one) => one.note) } : {}) }, noteCode);
}
