// The save of processes: `apostil add-processes` checks the processes of one group against the code and the notes of the map, and stores them.
// A step is a note of the map, so a note that a writer corrects or adds in the same JSON is checked as `add-notes` checks a note.

import { ID, type Note } from '../shared/change-file';
import { fileText, headCommit, repoFiles, repoId } from '../shared/git';
import { processGroups } from '../shared/note-groups';
import { cellsOfText, findCell, type CellAt } from '../shared/notebook';
import {
  coveredKeys, holdsLine, notesNeedingProcess, parentsOf, parseKey, processFolds, stepKey,
  type Arrow, type Handoff, type LineAt, type MapProcesses, type OutsideArrow, type Process, type SetAside,
} from '../shared/processes';
import { fewWords, fileNotesProblems, fileNotesStyle, mapNoteProblems, textWording, titleWording, type RepoMap } from '../shared/repo-map';
import type { Store } from '../shared/store';
import { freshNotes, notesWithCode, sortedNotes, withFileNotes } from './note-code';

/** A correction of a note of the map: new words, or its removal; a removed note can name the new note that takes its place in the processes. */
interface NoteFix {
  note: string;
  title?: string;
  text?: string;
  remove?: true;
  by?: string;
}

/** What `apostil add-processes` is given: the processes of one group, and what the writer corrects in the notes. */
interface ProcessesDraft {
  group: string;
  processes: Omit<Process, 'group'>[];
  handoffs?: Handoff[];
  notInProcess?: SetAside[];
  noteFixes?: NoteFix[];
  newNotes?: Note[];
  add?: boolean; // true: keep the other processes, handoffs and set-aside notes of the group, and replace only the processes with the same ids (the round for the notes that are left)
  fold?: string[]; // processes of any group that a process of this save takes in: the save takes them out of the map
}

export interface AddProcessesResult {
  saved: boolean;
  problems: string[];
  processes?: number; // the processes of the group now
  steps?: number; // the notes that are steps of them
  notes?: { fixed: string[]; added: string[]; removed: { note: string; by?: string }[] }; // what the save changed in the notes of the map
  folded?: string[]; // the processes that the save took out of the map
  left?: { count: number; notes: string[] }; // the notes of the files of the group that are in no process yet: work for the writer, not a fault
  style?: string[]; // words of new or corrected notes that may break the rules
}

const MAX_LABEL_WORDS = 4;
const MAX_WHY_WORDS = 12;
const LEFT_SHOWN = 10;

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isLine = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1;
const isList = (value: unknown): value is unknown[] => Array.isArray(value);
const isLineAt = (value: any): boolean => isText(value?.file) && isLine(value?.line) && (value.cell === undefined || isText(value.cell) || isLine(value.cell));

/** The problems of the form of the JSON, before anything is read: each names the field and what it must be. */
function draftProblems(draft: unknown): string[] {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return ['The JSON must be an object: { "group": "<your group>", "processes": [ ... ], "handoffs"?, "notInProcess"?, "noteFixes"?, "newNotes"?, "fold"? }.'];
  const { group, processes, handoffs, notInProcess, noteFixes, newNotes, fold } = draft as Record<string, any>;
  const problems: string[] = [];
  if (!isText(group) || !ID.test(group)) problems.push('"group" must be the name of your group, as apostil process-groups printed it.');
  if (!isList(processes)) problems.push('"processes" must be a list of processes. Write an empty list when the group has none.');
  for (const [at, process] of (isList(processes) ? processes as any[] : []).entries()) {
    const where = `Process ${at + 1} ("${process?.id ?? '?'}")`;
    if (!isText(process?.id) || !ID.test(process.id)) problems.push(`${where}: "id" must use small letters, digits and "-".`);
    if (!isText(process?.title)) problems.push(`${where}: "title" is missing.`);
    if (!isText(process?.summary)) problems.push(`${where}: "summary" is missing: one sentence from the input to the result.`);
    if (!isList(process?.steps) || !process.steps.length || !process.steps.every(isText)) problems.push(`${where}: "steps" must be a list of keys of notes, at least one.`);
    if (process?.arrows !== undefined && (!isList(process.arrows) || !process.arrows.every((arrow: any) => isText(arrow?.from) && isText(arrow?.to) && isLine(arrow?.fromLine)
      && (arrow.kind === 'branch' ? arrow.toLine === undefined || isLine(arrow.toLine) : isLine(arrow.toLine) && isText(arrow.name))))) {
      problems.push(`${where}: "arrows" must be a list of { "from", "to", "label", "fromLine", "toLine", "name" }, or of { "kind": "branch", "from", "to", "label", "fromLine" }.`);
    }
    if (process?.outside !== undefined && (!isList(process.outside) || !process.outside.every((call: any) => isText(call?.from) && isText(call?.to) && isLine(call?.fromLine) && isText(call?.name)))) {
      problems.push(`${where}: "outside" must be a list of { "from", "to", "label", "fromLine", "name" }.`);
    }
  }
  if (handoffs !== undefined && (!isList(handoffs) || !handoffs.every((one: any) => isText(one?.from) && isText(one?.to) && isText(one?.name) && isLineAt(one?.fromLine) && isLineAt(one?.toLine)))) {
    problems.push('"handoffs" must be a list of { "from", "to", "label", "name", "fromLine": { "file", "line" }, "toLine": { "file", "line" } }.');
  }
  if (notInProcess !== undefined && (!isList(notInProcess) || !notInProcess.every((one: any) => isText(one?.note) && isText(one?.why)))) problems.push('"notInProcess" must be a list of { "note", "why" }.');
  if (noteFixes !== undefined && (!isList(noteFixes) || !noteFixes.every((one: any) => isText(one?.note) && (one.remove === true ? one.title === undefined && one.text === undefined : isText(one.title) || isText(one.text))))) {
    problems.push('"noteFixes" must be a list of { "note", "title"?, "text"? }, or of { "note", "remove": true, "by"? }.');
  }
  if (newNotes !== undefined && !isList(newNotes)) problems.push('"newNotes" must be a list of notes: { "file", "lines": [first, last], "title", "text" }.');
  if ((draft as Record<string, unknown>).add !== undefined && typeof (draft as Record<string, unknown>).add !== 'boolean') problems.push('"add" must be true or false.');
  if (fold !== undefined && (!isList(fold) || !fold.every(isText))) problems.push('"fold" must be a list of ids of processes, as "fold" of apostil processes names them.');
  return problems;
}

/** Reads one line of a file of the folder, or of a cell of a notebook. Reads each file once. */
function lineReader(folder: string): (at: LineAt) => string | undefined {
  const files = new Map<string, { lines: string[]; cells: CellAt[] } | undefined>();
  return (at) => {
    if (!files.has(at.file)) {
      const lines = fileText(folder, at.file)?.split('\n');
      files.set(at.file, lines && { lines, cells: cellsOfText(lines) });
    }
    const file = files.get(at.file);
    if (!file) return undefined;
    if (at.cell === undefined) return file.lines[at.line - 1];
    const cell = findCell(file.cells, at.cell);
    return cell && at.line <= cell.length ? file.lines[cell.at + at.line - 1] : undefined;
  };
}

/** A line of the step of a key: in its file, and in its cell for a notebook. */
const lineIn = (key: string, line: number): LineAt => {
  const place = parseKey(key)!;
  return { file: place.file, ...(place.cell !== undefined ? { cell: place.cell } : {}), line };
};

/** A line quoted in a message: its text, short. */
const quoted = (text: string | undefined): string => `"${(text ?? '').trim().slice(0, 80)}"`;

/** The steps of a process join into one piece: through the outer step that holds a step, the order of the steps in one outer step, and the arrows. Returns the pieces. */
function piecesOf(process: Pick<Process, 'steps' | 'arrows'>): string[][] {
  const steps = [...new Set(process.steps)];
  const root = new Map(steps.map((key) => [key, key]));
  const find = (key: string): string => {
    while (root.get(key) !== key) key = root.get(key)!;
    return key;
  };
  const join = (a: string, b: string): void => { if (root.has(a) && root.has(b)) root.set(find(a), find(b)); };
  const parent = parentsOf(steps);
  const lastIn = new Map<string, string>();
  for (const key of steps) {
    const box = parent.get(key);
    if (!box) continue;
    join(key, box);
    if (lastIn.has(box)) join(lastIn.get(box)!, key);
    lastIn.set(box, key);
  }
  for (const arrow of process.arrows ?? []) join(arrow.from, arrow.to);
  const pieces = new Map<string, string[]>();
  for (const key of steps) pieces.set(find(key), [...(pieces.get(find(key)) ?? []), key]);
  return [...pieces.values()];
}

/** The processes, handoffs and set-aside notes of one save, as the check reads them. */
interface ProcessSet {
  processes: Process[];
  handoffs?: Handoff[];
  notInProcess?: SetAside[];
}

/**
 * What is wrong with processes, as sentences that a writer can act on: the words; each step names a note of the map; each arrow names a line inside each of its steps
 * and its name stands on both lines; a branch joins two steps in one outer step; a call out of the repo names a line of its step that holds its name, and is no call
 * of a file of the repo that has notes; each end of a handoff names a line inside a step of its process with the name on it; a process is one piece.
 * `notes` are the notes of the map after this save; `others` are the processes of the other groups, which a handoff may name.
 */
export function processProblems(folder: string, set: ProcessSet, notes: Note[], others: Process[] = []): string[] {
  const problems: string[] = [];
  const keys = new Set(notes.map(stepKey));
  const notedFiles = new Set(notes.map((note) => note.file));
  const files = new Set(repoFiles(folder) ?? []);
  const lineOf = lineReader(folder);
  const holds = (at: LineAt, name: string): boolean => (lineOf(at) ?? '').includes(name);
  const ids = new Set<string>();
  const otherIds = new Map(others.map((process) => [process.id, process.group]));
  for (const process of set.processes) {
    const at = `Process "${process.id}"`;
    if (ids.has(process.id)) problems.push(`${at}: this id is used twice. Give each process its own id.`);
    else if (otherIds.has(process.id)) problems.push(`${at}: the group "${otherIds.get(process.id)}" has a process with this id. Give yours another id.`);
    ids.add(process.id);
    problems.push(...titleWording(process.title, at), ...textWording(process.summary, at, 'summary'));
    const steps = new Set(process.steps);
    if (steps.size < process.steps.length) problems.push(`${at}: a step is listed twice. List each note once, in the order the code runs it.`);
    for (const key of steps) {
      if (keys.has(key)) continue;
      const file = parseKey(key)?.file;
      problems.push(file && notedFiles.has(file)
        ? `${at}: the step "${key}" is no note of the map. Run apostil notes ${file} and take the key of a note that it prints.`
        : `${at}: the step "${key}" is no note of the map, because ${file ?? 'its file'} has no notes. Add a note for it in "newNotes", or give the key "<file>:<first>-<last>" of a note.`);
    }
    const parent = parentsOf([...steps].filter((key) => keys.has(key)));
    for (const arrow of process.arrows ?? []) problems.push(...arrowProblems(at, arrow, steps, keys, parent, holds, lineOf));
    for (const call of process.outside ?? []) problems.push(...outsideProblems(at, call, steps, keys, holds, lineOf, files, notedFiles));
    const pieces = piecesOf({ steps: [...steps].filter((key) => keys.has(key)), arrows: (process.arrows ?? []).filter((arrow) => steps.has(arrow.from) && steps.has(arrow.to)) });
    if (pieces.length > 1) {
      problems.push(`${at}: its steps fall in ${pieces.length} pieces that no arrow joins (they start at ${pieces.map((piece) => piece[0]).join(', ')}), so find the call or the file that joins them, or split the process.`);
    }
  }
  const byId = new Map([...others, ...set.processes].map((process) => [process.id, process]));
  for (const handoff of set.handoffs ?? []) {
    const at = `The handoff "${handoff.label ?? handoff.name}" from "${handoff.from}" to "${handoff.to}"`;
    problems.push(...fewWords(handoff.label ?? '', MAX_LABEL_WORDS, at, 'label'));
    for (const [end, id, line] of [['from', handoff.from, handoff.fromLine], ['to', handoff.to, handoff.toLine]] as const) {
      const process = byId.get(id);
      if (!process) problems.push(`${at}: "${id}" is no process of the map yet. Leave this handoff out now: the writer of that process adds it.`);
      else if (!process.steps.some((key) => keys.has(key) && holdsLine(key, line))) problems.push(`${at}: its "${end}Line" (${line.file} line ${line.line}) lies in no step of "${id}". Give a line inside one of its steps.`);
      else if (!holds(line, handoff.name)) problems.push(`${at}: line ${line.line} of ${line.file} does not hold "${handoff.name}" (it holds ${quoted(lineOf(line))}), so give the line where the file or value is written or read.`);
    }
  }
  const stepsHere = new Set(set.processes.flatMap((process) => process.steps));
  for (const one of set.notInProcess ?? []) {
    const at = `notInProcess "${one.note}"`;
    if (!keys.has(one.note)) problems.push(`${at}: this is no note of the map. Take the key from apostil notes.`);
    else if (stepsHere.has(one.note)) problems.push(`${at}: this note is a step of a process too. Keep it in one place.`);
    problems.push(...fewWords(one.why, MAX_WHY_WORDS, at, 'reason'));
  }
  return problems;
}

/** The problems of one arrow between two steps of a process. */
function arrowProblems(at: string, arrow: Arrow, steps: Set<string>, keys: Set<string>, parent: Map<string, string | undefined>, holds: (at: LineAt, name: string) => boolean, lineOf: (at: LineAt) => string | undefined): string[] {
  const where = `${at}: the arrow "${arrow.label ?? arrow.name ?? ''}" from ${arrow.from} to ${arrow.to}`;
  if (!steps.has(arrow.from) || !steps.has(arrow.to)) return [`${where}: both ends must be steps of this process. Add the step to "steps", or draw the arrow to a step that is there.`];
  if (!keys.has(arrow.from) || !keys.has(arrow.to)) return []; // the step itself is the problem, said once
  const problems = fewWords(arrow.label ?? '', MAX_LABEL_WORDS, where, 'label');
  if (arrow.kind === 'branch') {
    const outer = parent.get(arrow.from);
    if (!isText(arrow.label)) problems.push(`${where}: a branch needs a "label" that says when it is taken, as "on error" or "next row".`);
    if (!outer || outer !== parent.get(arrow.to)) problems.push(`${where}: a branch joins two steps inside the same outer step. Draw a plain arrow with its lines and its name instead.`);
    else if (!holdsLine(outer, lineIn(arrow.from, arrow.fromLine))) problems.push(`${where}: "fromLine" ${arrow.fromLine} lies outside the outer step ${outer}. Give the line of the condition or the loop.`);
    return problems;
  }
  const name = arrow.name ?? '';
  if (name.trim().length < 2) return [...problems, `${where}: "name" must be a word of at least 2 letters that stands on both lines.`];
  const from = lineIn(arrow.from, arrow.fromLine);
  const to = lineIn(arrow.to, arrow.toLine ?? 0);
  if (!holdsLine(arrow.from, from)) problems.push(`${where}: "fromLine" ${arrow.fromLine} is not inside its step. Give the line inside ${arrow.from} where the code calls, starts or writes.`);
  else if (!holds(from, name)) problems.push(`${where}: line ${arrow.fromLine} of ${from.file} does not hold "${name}" (it holds ${quoted(lineOf(from))}), so give the line of the call.`);
  if (!holdsLine(arrow.to, to)) problems.push(`${where}: "toLine" ${arrow.toLine} is not inside its step. Give the line inside ${arrow.to} where the target is defined or reads.`);
  else if (!holds(to, name)) problems.push(`${where}: line ${arrow.toLine} of ${to.file} does not hold "${name}" (it holds ${quoted(lineOf(to))}), so give the line where it is defined or read.`);
  return problems;
}

/** The problems of one call out of the repo. */
function outsideProblems(at: string, call: OutsideArrow, steps: Set<string>, keys: Set<string>, holds: (at: LineAt, name: string) => boolean, lineOf: (at: LineAt) => string | undefined, files: Set<string>, notedFiles: Set<string>): string[] {
  const where = `${at}: the call "${call.label ?? call.name}" to ${call.to}`;
  if (!steps.has(call.from)) return [`${where}: its start must be a step of this process.`];
  if (!keys.has(call.from)) return [];
  const problems = fewWords(call.label ?? '', MAX_LABEL_WORDS, where, 'label');
  if (files.has(call.to) && notedFiles.has(call.to)) problems.push(`${where}: ${call.to} is a file of this repo, so make the code that it calls a step, with an arrow to its note (apostil notes ${call.to} prints them).`);
  const from = lineIn(call.from, call.fromLine);
  if (!holdsLine(call.from, from)) problems.push(`${where}: "fromLine" ${call.fromLine} is not inside its step. Give the line inside ${call.from} that makes the call.`);
  else if (!holds(from, call.name)) problems.push(`${where}: line ${call.fromLine} of ${from.file} does not hold "${call.name}" (it holds ${quoted(lineOf(from))}), so give the line of the call.`);
  return problems;
}

/** A new key in place of an old one, in the steps and arrows of a process. */
function renamedSteps(process: Process, renamed: Map<string, string>): Process {
  if (!process.steps.some((key) => renamed.has(key))) return process;
  const key = (one: string): string => renamed.get(one) ?? one;
  return {
    ...process, steps: [...new Set(process.steps.map(key))],
    ...(process.arrows ? { arrows: process.arrows.map((arrow) => ({ ...arrow, from: key(arrow.from), to: key(arrow.to) })) } : {}),
    ...(process.outside ? { outside: process.outside.map((call) => ({ ...call, from: key(call.from) })) } : {}),
  };
}

/** The new note that takes the place of a removed one: the one that the writer names in "by", else the one new note of the same file and cell whose lines meet its lines. */
function successor(fix: NoteFix, added: Note[]): string | undefined {
  if (fix.by) return fix.by;
  const old = parseKey(fix.note);
  const near = added.filter((note) => old && note.file === old.file && String(note.cell ?? '') === (old.cell ?? '') && note.lines[0] <= old.to && note.lines[1] >= old.from);
  return near.length === 1 ? stepKey(near[0]) : undefined;
}

/**
 * Saves the processes of one group. It replaces the processes, the handoffs and the set-aside notes that this group saved before, and keeps those of the other groups.
 * In the same step it corrects, adds and removes notes as the JSON says, and puts the key of a new note in place of a removed one in every process.
 * With "fold" it takes out the processes of any group that `processFolds` folds into a process of this save, and their handoffs move to that process.
 * The store reads, changes and writes the map in one step, so writers at the same time keep each other's work. Nothing is stored when anything has a problem.
 */
export function addProcessesToMap(store: Store, folder: string, draft: unknown): AddProcessesResult {
  let result: AddProcessesResult = { saved: false, problems: [] };
  store.updateMap(repoId(folder), headCommit(folder), (stored) => {
    const fail = (problems: string[]): undefined => { result = { saved: false, problems }; return undefined; };
    if (!stored) return fail(['This repo has no saved map. Save one with apostil save-map.']);
    const shape = draftProblems(draft);
    if (shape.length) return fail(shape);
    const { group, processes: written, handoffs = [], notInProcess = [], noteFixes = [], newNotes = [], add = false, fold = [] } = draft as ProcessesDraft;
    // What this save replaces: everything that the group saved before, or with "add" only its processes with the same ids; and the processes that it folds in.
    const writtenIds = new Set(written.map((process) => process.id));
    const replaces = (one: { group?: string; id?: string }): boolean => one.group === group && (!add || (one.id !== undefined && writtenIds.has(one.id)));
    const listed = new Map(processFolds(stored.processes ?? []).map((one) => [one.process, one.into]));
    const foldProblems = fold.filter((id) => !writtenIds.has(listed.get(id) ?? '')).map((id) => (listed.has(id)
      ? `The fold of "${id}": it folds into "${listed.get(id)}", which is no process of this save. Leave "${id}" out of "fold", or write "${listed.get(id)}" in this save.`
      : `The fold of "${id}": apostil processes lists no fold of this process. Take the ids from "fold" of apostil processes.`));
    if (foldProblems.length) return fail(foldProblems);
    const folds = new Map(fold.map((id) => [id, listed.get(id)!])); // a folded process, and the process of this save that takes it in

    // The notes: the new ones are checked as add-notes checks a note, and the corrected words as the words of a new note.
    const newProblems = fileNotesProblems(newNotes, 'The new notes');
    const storedKeys = new Set((stored.fileNotes ?? []).map(stepKey));
    const fixProblems = noteFixes.flatMap((fix) => {
      const at = `The fix of the note "${fix.note}"`;
      if (!storedKeys.has(fix.note)) return [`${at}: this is no note of the map. Take the key from apostil notes.`];
      return [...(fix.title !== undefined ? titleWording(fix.title, at) : []), ...(fix.text !== undefined ? textWording(fix.text, at) : [])];
    });
    if (newProblems.length || fixProblems.length) return fail([...newProblems, ...fixProblems]);
    const lineProblems = mapNoteProblems(folder, [], newNotes);
    if (lineProblems.length) return fail(lineProblems);
    const removed = new Set(noteFixes.filter((fix) => fix.remove).map((fix) => fix.note));
    const fixes = new Map(noteFixes.filter((fix) => !fix.remove).map((fix) => [fix.note, fix]));
    const notes = sortedNotes([
      ...notesWithCode(stored).filter((one) => !removed.has(stepKey(one.note))).map((one) => {
        const fix = fixes.get(stepKey(one.note));
        return fix ? { ...one, note: { ...one.note, ...(fix.title !== undefined ? { title: fix.title } : {}), ...(fix.text !== undefined ? { text: fix.text } : {}) } } : one;
      }),
      ...freshNotes(folder, newNotes),
    ]);
    const all = notes.map((one) => one.note);
    const total = fileNotesProblems(all, 'The notes of the file', false);
    if (total.length) return fail(total);

    // A removed note: the new note that takes its place goes into every process that names it.
    const keys = new Set(all.map(stepKey));
    const renamed = new Map<string, string>();
    const processes: Process[] = written.map((process) => ({ ...process, group }));
    const others = (stored.processes ?? []).filter((process) => !replaces(process) && !folds.has(process.id));
    const renameProblems: string[] = [];
    for (const fix of noteFixes.filter((one) => one.remove)) {
      const by = successor(fix, newNotes);
      const naming = [...processes, ...others].filter((process) => process.steps.includes(fix.note)).map((process) => process.id);
      if (by && !keys.has(by)) renameProblems.push(`The removal of the note "${fix.note}": "by" names "${by}", which is no note of the map. Give the key of a note in "newNotes".`);
      else if (by) renamed.set(fix.note, by);
      else if (naming.length) renameProblems.push(`The removal of the note "${fix.note}": it is a step of the processes ${naming.join(', ')}, so add a new note for its lines in "newNotes" and give its key as "by".`);
    }
    if (renameProblems.length) return fail(renameProblems);
    const mine = processes.map((process) => renamedSteps(process, renamed));
    const theirs = others.map((process) => renamedSteps(process, renamed));
    const aside = notInProcess.map((one) => ({ ...one, note: renamed.get(one.note) ?? one.note, group }));
    const ownHandoffs = handoffs.map((handoff) => ({ ...handoff, group }));
    const problems = processProblems(folder, { processes: mine, handoffs: ownHandoffs, notInProcess: aside }, all, theirs);
    if (problems.length) return fail(problems);

    // A handoff of a folded process now starts or ends at the process that takes it in; one that would go from a process to itself goes.
    const moved = (handoff: Handoff): Handoff[] => {
      if (!folds.has(handoff.from) && !folds.has(handoff.to)) return [handoff];
      const [from, to] = [folds.get(handoff.from) ?? handoff.from, folds.get(handoff.to) ?? handoff.to];
      return from === to ? [] : [{ ...handoff, from, to }];
    };
    const map: RepoMap = {
      ...withFileNotes(stored, notes),
      processes: [...theirs, ...mine],
      handoffs: [...(stored.handoffs ?? []).filter((handoff) => handoff.group !== group || add).flatMap(moved), ...ownHandoffs],
      notInProcess: [...(stored.notInProcess ?? []).map((one) => ({ ...one, note: renamed.get(one.note) ?? one.note }))
        .filter((one) => keys.has(one.note) && (one.group !== group || (add && !mine.some((process) => process.steps.includes(one.note))))), ...aside],
    };
    const lost = lostNotes(map, (stored.processes ?? []).filter((process) => folds.has(process.id)).map((process) => renamedSteps(process, renamed)), keys);
    if (lost.length) return fail(lost);
    const style = fileNotesStyle([...newNotes, ...all.filter((note) => fixes.has(stepKey(note)))]);
    result = {
      saved: true, problems: [], processes: mine.length, steps: new Set(mine.flatMap((process) => process.steps)).size,
      notes: { fixed: [...fixes.keys()], added: newNotes.map(stepKey), removed: [...removed].map((note) => ({ note, ...(renamed.has(note) ? { by: renamed.get(note) } : {}) })) },
      ...(fold.length ? { folded: fold } : {}),
      ...leftOf(map, group, mine),
      ...(style.length ? { style } : {}),
    };
    return map;
  });
  return result;
}

/** The problems of a fold: for each folded process, the notes of its steps that are in no process and not set aside after the save. */
function lostNotes(map: RepoMap, folded: Process[], keys: Set<string>): string[] {
  const { steps, aside } = coveredKeys(map);
  return folded.flatMap((process) => {
    const lost = process.steps.filter((key) => keys.has(key) && !steps.has(key) && !aside.has(key));
    return lost.length ? [`The fold of "${process.id}": its steps ${lost.join(', ')} are in no process now. Make each a step where the code calls it, or set it aside in "notInProcess" with a reason.`] : [];
  });
}

/** The notes of the files of a group that are in no process and not set aside, after its save: its files from process-groups, else the files of its steps. */
function leftOf(map: RepoMap, group: string, mine: Process[]): Pick<AddProcessesResult, 'left'> {
  const files = new Set(processGroups(map, true).groups.find((one) => one.name === group)?.files.map((file) => file.path)
    ?? mine.flatMap((process) => process.steps.map((key) => parseKey(key)?.file ?? '')));
  const { steps, aside } = coveredKeys(map);
  const left = notesNeedingProcess(map).filter((note) => files.has(note.file) && !steps.has(stepKey(note)) && !aside.has(stepKey(note))).map(stepKey);
  return left.length ? { left: { count: left.length, notes: left.slice(0, LEFT_SHOWN) } } : {};
}

/** The processes of a map draft that `apostil save-map` is given with its own processes (the made-up example): checked as a writer's are. */
export const mapProcessProblems = (folder: string, map: MapProcesses): string[] =>
  map.processes ? processProblems(folder, { processes: map.processes, handoffs: map.handoffs, notInProcess: map.notInProcess }, map.fileNotes ?? []) : [];
