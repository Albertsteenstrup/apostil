// The save: checks a draft change file against Git and stores it for the current branch.

import { mergeAgent, type AgentSession } from '../shared/agents';
import { shapeProblems, type ChangeFile, type Diagram, type Note } from '../shared/change-file';
import { cellsIn, checkChangeFile, fileChange, inNoThingHints, rangesText } from '../shared/checks';
import { mapDrawing } from '../shared/comment-lines';
import { missingCode, missingLinkCode } from '../shared/diagram-code';
import { baseOf, changedFiles, commitExists, currentBranch, fileText, headCommit, repoFiles, repoId, repoRoot, tryGit, type ChangedFile } from '../shared/git';
import { fingerprint } from '../shared/note-groups';
import { rawLineProblems } from '../shared/notebook';
import { noteCodeOf } from '../shared/notes-beside-code';
import { sameDiagramText } from '../shared/repo-diagram';
import { checkMap, fileNotesProblems, fileNotesStyle, FILE_NOTES_PART, mapAsChange, mapNoteProblems, mapProblems, type MapCheck, type RepoMap } from '../shared/repo-map';
import type { CheckResult, Store } from '../shared/store';
import { freshNotes, isFileNoteKey, notesWithCode, sortedNotes, withFileNotes, withNoteCode } from './note-code';
import { mapProcessProblems } from './processes-save';

export interface SaveResult {
  changeId?: number; // set when the draft was saved
  saved: boolean;
  problems: string[]; // why the draft is not saved: a wrong shape, or a node or an arrow of a diagram of a part, or a link between parts, with no code and no reason
  checks?: CheckResult; // set when the shape is right
  hints?: string[]; // changed lines that a diagram covers and that are in no node and no arrow; the save does not fail for them
}

/**
 * The commit that `--base` names, as its full id. On a main branch the change is then every commit after it, with what is not committed yet.
 * Refused with one sentence when it is no earlier commit of the branch.
 */
export function namedBase(folder: string, commit: string): { base: string } | { problem: string } {
  const id = tryGit(folder, 'rev-parse', '--verify', '--quiet', `${commit}^{commit}`);
  if (id && tryGit(folder, 'merge-base', '--is-ancestor', id, 'HEAD') !== undefined) return { base: id };
  return { problem: `"${commit}" is no earlier commit of the branch ${currentBranch(folder)}. Give a commit that "git log --oneline" lists, for example HEAD~1 for the commit before the latest.` };
}

/** The base of the branch in a folder: the named one (`--base`), else the stored one while Git has it, else the commit the branch started from. */
export function baseFor(store: Store, folder: string, named?: string): string {
  if (named) return named;
  const stored = store.findChange(repoId(folder), currentBranch(folder));
  return stored && commitExists(folder, stored.base) ? stored.base : baseOf(folder, currentBranch(folder));
}

/** What a writer does with a diagram of code that the base had (skills/apostil-describe-change/writer-prompt.md says the same). */
const drawOn = (path = '<path>'): string => `Draw it on the repo diagram of its code: find it with apostil diagrams --path ${path}; "of" is its id and "before" its text (apostil diagram <id>). `
  + 'When the repo has none, first add the diagram of the base code to the map with apostil add-diagram, under the area that holds the file, with "file", "symbol" and "covers". Code that is all new gets "new": true.';

/**
 * The rule of the diagrams of a repo with a map: each diagram of a change draws on a repo diagram ("of", with the text of that diagram as "before"),
 * or its code is all new ("new"; the lines of "covers" are all added lines). In a repo with no map there is nothing to draw on: only "of" is checked.
 */
function repoDiagramProblems(folder: string, base: string, file: ChangeFile, map: RepoMap | undefined, changed: ChangedFile[]): string[] {
  return (file.diagrams ?? []).flatMap((diagram) => {
    const where = `Diagram "${diagram.id}"`;
    if (diagram.of !== undefined) {
      const drawn = mapDrawing(map, diagram.of);
      if (!drawn) return [map ? `${where}: the map has no diagram "${diagram.of}". ${drawOn(diagram.file)}` : `${where}: this repo has no map, so "of" names nothing. Leave it out.`];
      if (drawn.diagram.kind !== diagram.kind) return [`${where}: its kind is ${diagram.kind}, and the repo diagram "${diagram.of}" is a ${drawn.diagram.kind} diagram. Keep the kind of the repo diagram.`];
      return sameDiagramText(diagram.before, drawn.diagram.mermaid, drawn.diagram.kind) ? [] : [`${where}: "before" is not the text of the repo diagram "${diagram.of}". Run apostil diagram ${diagram.of} and copy its text into "before".`];
    }
    if (!map) return [];
    if (!diagram.new) return [`${where} names no repo diagram in "of" and is not "new". ${drawOn(diagram.file)}`];
    if (!diagram.covers || !diagram.file) return [];
    const { added } = fileChange(folder, base, diagram.file, changed);
    const old = Array.from({ length: diagram.covers[1] - diagram.covers[0] + 1 }, (_, at) => diagram.covers![0] + at).filter((line) => !added.some(([first, last]) => first <= line && line <= last));
    return old.length ? [`${where}: lines ${rangesText(old)} of ${diagram.file} were there before the change, so its code is not all new. ${drawOn(diagram.file)}`] : [];
  });
}

/**
 * Runs the shape check, the rule that a place in a notebook names a cell, the rule that each node and arrow of a diagram of a part and each link between parts has code or a reason,
 * the rule of the repo diagrams (with the stored `map` of the repo), the file check and the line check. Saves nothing.
 * `leaveOut` is a path that is no file of the change: the untracked draft file that was given.
 * The rules are for a save from now on: a stored description from before still opens.
 */
export function checkDraft(folder: string, draft: unknown, base = baseOf(folder, currentBranch(folder)), leaveOut?: string, map?: RepoMap): SaveResult {
  const shape = shapeProblems(draft);
  if (shape.length > 0) return { saved: false, problems: shape };
  const file = draft as ChangeFile;
  const changed = changedFiles(folder, base).filter((entry) => entry.path !== leaveOut);
  const cells = cellsIn(folder, base, changed);
  // A note or a place in a notebook names a cell and the lines inside it, never lines of the raw file.
  const problems = [...missingLinkCode(file), ...(file.diagrams ?? []).flatMap(missingCode), ...rawLineProblems(file, (path, removed) => !!cells(path, removed)), ...repoDiagramProblems(folder, base, file, map, changed)];
  const hints = inNoThingHints(folder, base, file, changed);
  return { saved: false, problems, checks: checkChangeFile(folder, base, file, changed), ...(hints.length ? { hints } : {}) };
}

/** Checks a draft and stores it as the change of the current branch. The given agent fields go over the stored agent. A draft that fails the shape check or the rule is not stored. */
export function saveDraft(store: Store, folder: string, draft: unknown, agent: Partial<AgentSession> = {}, leaveOut?: string, named?: string): SaveResult {
  const base = baseFor(store, folder, named);
  const result = checkDraft(folder, draft, base, leaveOut, store.getMap(repoId(folder))?.map);
  if (!result.checks || result.problems.length) return result;
  const stored = store.findChange(repoId(folder), currentBranch(folder));
  // A description of later commits of the branch takes the place of the one before it (a main branch, commit after commit): the notes of that one are
  // kept, so that they still stand beside their code. A description that is saved again for the same commits takes the place of its own notes.
  if (stored && stored.base !== base && tryGit(folder, 'merge-base', '--is-ancestor', stored.head, base) !== undefined) store.keepNotes(stored, true);
  const changeId = store.saveChange({
    repoId: repoId(folder), folder: repoRoot(folder), branch: currentBranch(folder),
    base, head: headCommit(folder), file: draft as ChangeFile, checks: result.checks, agent: mergeAgent(stored?.agent, agent),
    noteCode: noteCodeOf(folder, draft as ChangeFile, base), // the text of the noted lines, so that the notes find their code after a merge
  });
  return { ...result, changeId, saved: true };
}

// ----- the map of a repo -----

export interface SaveMapResult {
  saved: boolean;
  problems: string[]; // why the map has a wrong shape
  checks?: MapCheck; // set when the shape is right
}

/**
 * Runs the shape check, the map check, and the check of the notes of `noted` (all diagrams by default; for an added diagram, only that one). Saves nothing.
 * A note with a problem keeps the map from being saved, as a note that would never stand beside its code.
 */
export function checkMapDraft(folder: string, draft: unknown, around?: Diagram, noted = (draft as RepoMap | null)?.diagrams ?? [], notedFiles = (draft as RepoMap | null)?.fileNotes ?? []): SaveMapResult {
  const problems = mapProblems(draft);
  if (problems.length > 0) return { saved: false, problems };
  return { saved: false, problems: mapNoteProblems(folder, noted, notedFiles), checks: checkMap(folder, draft as RepoMap, around) };
}

/**
 * Checks a map and stores it as the map of the repo, with the text of the lines of its notes. It takes the place of the old map and the notes of its diagrams.
 * The notes of files stay (and the files that have none), unless the draft holds its own. Nothing is stored when the shape or a note is wrong.
 */
export function saveMapDraft(store: Store, folder: string, draft: unknown): SaveMapResult {
  const result = checkMapDraft(folder, draft);
  if (!result.checks || result.problems.length) return result;
  const map = draft as RepoMap;
  let problems: string[] = [];
  store.updateMap(repoId(folder), headCommit(folder), (stored) => {
    const own = map.fileNotes !== undefined;
    const kept = own ? {} : Object.fromEntries(Object.entries(stored?.noteCode ?? {}).filter(([key]) => isFileNoteKey(key)));
    const fileNotes = own ? map.fileNotes : stored?.fileNotes;
    const noNotes = map.noNotes ?? stored?.noNotes;
    // The processes stay, unless the draft holds its own (the made-up example): those are checked as the processes of a writer are.
    const flow: Partial<RepoMap> = map.processes !== undefined ? map : stored ?? {};
    if (map.processes !== undefined) problems = mapProcessProblems(folder, { ...map, fileNotes });
    if (problems.length) return undefined;
    // The marks stay too, with the files that their writers read: the writers of marks save them, not the map.
    const marked: Partial<RepoMap> = map.marks !== undefined ? map : stored ?? {};
    const { fileNotes: _notes, noNotes: _none, processes: _processes, handoffs: _handoffs, notInProcess: _aside, marks: _marks, markedFiles: _read, iconRefused: _refused, ...rest } = map;
    const full: RepoMap = {
      ...rest, ...(fileNotes?.length ? { fileNotes } : {}), ...(noNotes ? { noNotes } : {}),
      ...(flow.processes ? { processes: flow.processes } : {}), ...(flow.handoffs ? { handoffs: flow.handoffs } : {}), ...(flow.notInProcess ? { notInProcess: flow.notInProcess } : {}),
      ...(marked.marks ? { marks: marked.marks } : {}), ...(marked.markedFiles ? { markedFiles: marked.markedFiles } : {}), ...(marked.iconRefused ? { iconRefused: marked.iconRefused } : {}),
    };
    return withNoteCode(full, { ...noteCodeOf(folder, mapAsChange(map.diagrams, own ? map.fileNotes : [])), ...kept });
  });
  return problems.length ? { saved: false, problems, checks: result.checks } : { ...result, saved: true };
}

/** Adds one diagram to the stored map, or replaces the one with the same id. Needs a stored map and a "parent". Nothing is stored when the shape is wrong. */
export function addDiagramToMap(store: Store, folder: string, diagram: unknown): SaveMapResult {
  let result: SaveMapResult = { saved: false, problems: [] };
  store.updateMap(repoId(folder), headCommit(folder), (stored) => {
    if (!stored) {
      result = { saved: false, problems: ['This repo has no saved map. Save one with apostil save-map.'] };
      return undefined;
    }
    const added = diagram as Diagram | null;
    if (!added?.parent) {
      result = { saved: false, problems: ['The diagram needs "parent". Only apostil save-map writes the top diagram.'] };
      return undefined;
    }
    // The notes of the other diagrams keep the text of their lines from their own save; the added diagram brings its own.
    const kept = Object.fromEntries(Object.entries(stored.noteCode ?? {}).filter(([key]) => !key.startsWith(`${added.id}/`)));
    const map: RepoMap = { ...stored, diagrams: [...stored.diagrams.filter((other) => other.id !== added.id), added] };
    result = checkMapDraft(folder, map, added, [added], []);
    if (!result.checks || result.problems.length) return undefined;
    result = { ...result, saved: true };
    return withNoteCode(map, { ...kept, ...noteCodeOf(folder, mapAsChange([added])) });
  });
  return result;
}


// ----- the notes of files -----

export interface AddNotesResult {
  saved: boolean;
  problems: string[];
  notes?: number; // the notes of this JSON that were saved
  files?: number; // the files that this JSON replaced the notes of
  style?: string[]; // words of the saved notes that may break the rules (fileNotesStyle): a warning, the notes are saved
}

/** What `apostil add-notes` is given. */
interface NotesDraft {
  notes?: Note[];
  files?: string[]; // files with no code worth a note
  ranges?: { file: string; from: number; to: number }[]; // the writer wrote only these lines of a long file
}

const isList = (value: unknown, each: (one: unknown) => boolean): boolean => Array.isArray(value) && value.every(each);
const isRange = (one: any): boolean => typeof one?.file === 'string' && Number.isInteger(one.from) && Number.isInteger(one.to) && one.from >= 1 && one.from <= one.to;

/** The problems of the JSON itself, before the notes are read: its shape, and a file or a range that is no file of the repo. */
function notesDraftProblems(folder: string, draft: unknown): string[] {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return ['The JSON must be an object: { "notes": [ ... ], "files": [ ... ]?, "ranges": [ ... ]? }.'];
  const { notes, files, ranges } = draft as Record<string, unknown>;
  const problems: string[] = [];
  if (!Array.isArray(notes)) problems.push('"notes" must be a list of notes. Write an empty list when no file has a note.');
  if (files !== undefined && !isList(files, (one) => typeof one === 'string')) problems.push('"files" must be a list of paths: the files that have no code worth a note.');
  if (ranges !== undefined && !isList(ranges, isRange)) problems.push('"ranges" must be a list of { "file", "from", "to" }, with "from" and "to" counted from 1.');
  if (problems.length) return problems;
  const known = new Set(repoFiles(folder) ?? []);
  const named = [...((files as string[] | undefined) ?? []), ...((ranges as { file: string }[] | undefined) ?? []).map((range) => range.file)];
  return [...new Set(named.filter((path) => !known.has(path)))].map((path) => `The file ${path} is no file of the repo: Git ignores it, or it does not exist. Name a file that Git tracks, or a new file that Git does not ignore.`);
}

/** A note of a file with ranges must lie inside one of them. */
function outsideRanges(notes: Note[], ranges: NonNullable<NotesDraft['ranges']>): string[] {
  return notes.flatMap((note) => {
    const own = ranges.filter((range) => range.file === note.file);
    return own.length && !own.some((range) => note.lines[0] >= range.from && note.lines[1] <= range.to)
      ? [`Note "${note.title}": its lines ${note.lines[0]}-${note.lines[1]} of ${note.file} are outside your lines (${own.map((range) => `${range.from}-${range.to}`).join(', ')}). Write notes only for your lines.`] : [];
  });
}

/**
 * Adds notes of files to the stored map. It replaces the notes of every file that the draft names (a file of a note, or a path of "files"), and of a file with "ranges" only the notes that start in a range;
 * the notes of other files stay. The store reads, changes and writes the map in one step, so writers at the same time keep each other's notes. Nothing is stored when a note has a problem.
 */
export function addNotesToMap(store: Store, folder: string, draft: unknown): AddNotesResult {
  let result: AddNotesResult = { saved: false, problems: [] };
  store.updateMap(repoId(folder), headCommit(folder), (stored) => {
    if (!stored) {
      result = { saved: false, problems: ['This repo has no saved map. Save one with apostil save-map.'] };
      return undefined;
    }
    const shape = notesDraftProblems(folder, draft);
    const { notes = [], files = [], ranges = [] } = (shape.length ? {} : draft) as NotesDraft;
    // Each note is checked as the note of a diagram is, and the JSON alone must keep the rules of the notes of files.
    const sound = shape.length ? shape : fileNotesProblems(notes, 'The notes'); // a note with a wrong shape is not read further
    const problems = sound.length ? sound : [...mapNoteProblems(folder, [], notes), ...outsideRanges(notes, ranges)];
    if (problems.length) {
      result = { saved: false, problems };
      return undefined;
    }
    const named = new Set([...notes.map((note) => note.file), ...files, ...ranges.map((range) => range.file)]);
    const replaced = (note: Note): boolean => named.has(note.file) && (!ranges.some((range) => range.file === note.file) || ranges.some((range) => range.file === note.file && note.lines[0] >= range.from && note.lines[0] <= range.to));
    const all = sortedNotes([...notesWithCode(stored).filter((one) => !replaced(one.note)), ...freshNotes(folder, notes)]);
    const total = fileNotesProblems(all.map((one) => one.note), 'The notes of the file', false); // the notes of other files stay as they were written
    if (total.length) {
      result = { saved: false, problems: total };
      return undefined;
    }
    // A file that a writer called empty is not asked for again while its text stays the same.
    const noNotes = Object.fromEntries([
      ...Object.entries(stored.noNotes ?? {}).filter(([path]) => !named.has(path)),
      ...files.filter((path) => !notes.some((note) => note.file === path) && !ranges.some((range) => range.file === path)).map((path) => [path, fingerprint(fileText(folder, path) ?? '')]),
    ]);
    const { noNotes: _oldNone, ...rest } = stored;
    const style = fileNotesStyle(notes);
    result = { saved: true, problems: [], notes: notes.length, files: named.size, ...(style.length ? { style } : {}) };
    return withFileNotes({ ...rest, ...(Object.keys(noNotes).length ? { noNotes } : {}) }, all);
  });
  return result;
}
