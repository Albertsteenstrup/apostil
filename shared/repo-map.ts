// The map of a repo: a small tree of diagrams of the repo as it is, and the answer to
// "which diagrams is this folder or file a part of". See docs/change-file-format.md.

import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { diagramProblems, noteProblems, type ChangeFile, type Diagram, type Note } from './change-file';
import { cellsIn, checkLines, pathProblem } from './checks';
import { thingsOf } from './diagram-code';
import { diagramGraph, nodeIdProblems } from './diagram-graph';
import { repoFiles, repoId } from './git';
import type { IconRefused, Mark } from './marks';
import { inCellText, rawLineProblems } from './notebook';
import type { NoteCode } from './notes-beside-code';
import { processesWithStepsIn, type ProcessDiagram } from './process-diagrams';
import type { Handoff, Process, SetAside } from './processes';
import type { Store } from './store';

export interface RepoMap {
  format: 1;
  diagrams: Diagram[]; // exactly one has no "parent": the top map
  fileNotes?: Note[]; // the notes of files, written by notes writers: one list for the repo, each note with its own `file`; no limit of 12
  noNotes?: Record<string, string>; // a file that a writer found to have no code worth a note: its path, and a fingerprint of its text then, so that a changed file is asked for again
  noteCode?: NoteCode; // set by the save, never written: the text of the lines of each note, by "<diagram id>/<index>", as for a change
  processes?: Process[]; // the jobs of the code, whose steps are the keys of notes of files (shared/processes.ts); saved by process writers, one group at a time
  handoffs?: Handoff[]; // a file or a value that one process makes and another reads
  notInProcess?: SetAside[]; // notes that take part in no process, each with its reason
  marks?: Mark[]; // icons at lines of code (shared/marks.ts), saved by writers of a set, one group at a time
  markedFiles?: Record<string, Record<string, string>>; // by set: the files that a writer of the set read, with a fingerprint of what it read, so that a changed file is asked for again
  iconRefused?: IconRefused[]; // values whose own website refused the writer its icon
}

export const MAX_MAP_NOTES = 12; // for one diagram of an area (a map from before the notes of files)
export const MAX_FILE_NOTES = 400; // for one file
const MAX_TITLE_WORDS = 6; // a bare verb and what it acts on (skills/apostil-describe-change/text-rules.md)
const MAX_TEXT_WORDS = 20; // one sentence, as ASD-STE100 asks of a sentence

/** The id of the part that holds the notes of files when the map is read as a change. It is no id of a diagram. */
export const FILE_NOTES_PART = '@files';

/**
 * The notes of the map as a change file: one part for each diagram that has notes, by its id, and one part (`FILE_NOTES_PART`) for the notes of files:
 * so that the checks, the kept text of the lines and the rule of notes beside the code read them as the notes of any change.
 */
export function mapAsChange(diagrams: Diagram[], fileNotes: Note[] = []): ChangeFile {
  const parts = diagrams.filter((diagram) => diagram.notes?.length).map((diagram) => ({ id: diagram.id, name: diagram.title, files: [], notes: diagram.notes }));
  if (fileNotes.length) parts.push({ id: FILE_NOTES_PART, name: '', files: [], notes: fileNotes });
  return { format: 1, title: 'The map', reason: '', links: [], parts };
}

/** All notes of a map: of its diagrams and of its files. */
export const noteCount = (map: RepoMap): number => map.diagrams.reduce((sum, diagram) => sum + (diagram.notes?.length ?? 0), map.fileNotes?.length ?? 0);

const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/** Irregular verbs whose -s form does not end in a plain "s" on the bare verb. */
const BARE: Record<string, string> = { Has: 'Have', Does: 'Do', Goes: 'Go' };

/** The bare verb of a first word in the -s form ("Checks" gives "Check", "Applies" gives "Apply"), or undefined when the word is not in that form. */
export function bareVerb(word: string): string | undefined {
  if (BARE[word]) return BARE[word];
  if (!/^[A-Z][a-z]+s$/.test(word) || /(ss|us|is)$/.test(word) || /^(Alias|Atlas|Bias|Canvas|Gas|Lens|News|Series|Species)$/.test(word)) return undefined;
  if (/ies$/.test(word)) return word.replace(/ies$/, 'y');
  if (/(ss|sh|ch|x|z)es$/.test(word)) return word.slice(0, -2);
  return word.slice(0, -1);
}

/** The sentences of a text: a new sentence starts after ".", "!" or "?" and a space, with a capital letter or a digit. */
const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).filter((sentence) => sentence.trim());

/** What breaks the pattern of a title (text-rules.md): a bare verb and what it acts on, at most 6 words. Each problem says what to write instead. */
export function titleWording(title: string, at: string): string[] {
  const problems: string[] = [];
  const first = title.trim().split(/\s+/)[0] ?? '';
  const bare = bareVerb(first);
  if (bare) problems.push(`${at}: the title starts with "${first}". Start with the bare verb: "${bare}".`);
  if (wordCount(title) > MAX_TITLE_WORDS) problems.push(`${at}: the title has ${wordCount(title)} words. Use at most ${MAX_TITLE_WORDS}: a verb and what it acts on.`);
  return problems;
}

/** What breaks the pattern of a text (text-rules.md): one sentence of at most 20 words, with no semicolon. `word` names the text in the sentence: "text" or "summary". */
export function textWording(text: string, at: string, word = 'text'): string[] {
  const problems: string[] = [];
  const sentences = sentencesOf(text).length;
  if (sentences > 1) problems.push(`${at}: the ${word} has ${sentences} sentences. Write one sentence. Give a second idea its own note, or leave it out.`);
  if (text.includes(';')) problems.push(`${at}: the ${word} joins two ideas with a semicolon. Write one idea in one sentence.`);
  if (wordCount(text) > MAX_TEXT_WORDS) problems.push(`${at}: the ${word} has ${wordCount(text)} words. Use at most ${MAX_TEXT_WORDS}.`);
  return problems;
}

/** A short text, as a label of an arrow or a reason: at most `most` words. */
export const fewWords = (text: string, most: number, at: string, word: string): string[] =>
  (wordCount(text) > most ? [`${at}: the ${word} has ${wordCount(text)} words. Use at most ${most}.`] : []);

/** What breaks the pattern of the words of one note of a file: its title and its text. */
const wordingProblems = (note: Note, at: string): string[] =>
  [...titleWording(note.title, at), ...(typeof note.text === 'string' && note.text.trim() ? textWording(note.text, at) : [])];

/** Words that are no "-ing" form of a verb, or that the rules allow. */
const NOT_ING = new Set(['string', 'strings', 'thing', 'things', 'nothing', 'something', 'anything', 'everything', 'during', 'bring', 'ring', 'king', 'spring', 'ceiling']);

/**
 * Words of notes that may break the rules but that a check can read wrongly, as warnings: a passive ("are skipped") and an "-ing" word ("matching").
 * A save goes on with them; a writer changes them when it can.
 */
export function fileNotesStyle(notes: Note[], where = 'The notes'): string[] {
  const style: string[] = [];
  for (const note of notes) {
    const text = (note.text ?? '').replace(/`[^`]*`/g, '');
    const at = `${where}, note "${note.title}"`;
    const passive = text.match(/\b(is|are|was|were|be|been|being)\s+(\w+ly\s+)?(\w+ed|built|kept|set|read|run|written|taken|given|shown|found|held|left|sent|split|cut|put|drawn|chosen|seen|done|made|known)\b/i);
    if (passive) style.push(`${at}: "${passive[0]}" may be passive. Say who does it, as "Skips the file" for "the file is skipped".`);
    const ing = text.split(/[^A-Za-z_]+/).find((word) => /^[a-z]+ing$/.test(word) && !NOT_ING.has(word));
    if (ing) style.push(`${at}: "${ing}" is an -ing word. Use a verb or a noun, as "keeps" for "keeping" or "that match" for "matching".`);
  }
  return style;
}

/**
 * Lists what is wrong with a list of notes of files, as plain sentences: the shape of each note, no removed lines, no lines noted twice in one file, and at most
 * 400 notes for one file; with `wording`, also the pattern of its words (wordingProblems). `where` starts each sentence. Notes that were saved before stay as they
 * were written: only new notes are held to the pattern.
 */
export function fileNotesProblems(value: unknown, where = 'The notes of files', wording = true): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [`${where}: "notes" must be a list of notes.`];
  const problems: string[] = [];
  const noted = new Map<string, string>(); // the lines of one file -> the title of the note that has them
  const perFile = new Map<string, number>();
  for (const note of value as Note[]) {
    const bad = noteProblems(note, where);
    problems.push(...bad);
    if (bad.length) continue;
    const at = `${where}, note "${note.title}"`;
    if (note.removed) problems.push(`${at}: leave out "removed". A note of a file is on the code as it is.`);
    if (note.text !== undefined && typeof note.text !== 'string') problems.push(`${at}: "text" must be one sentence of text.`);
    else if (wording) problems.push(...wordingProblems(note, at));
    const key = `${note.file}|${note.cell ?? ''}|${note.lines.join('-')}`;
    const other = noted.get(key);
    if (other !== undefined) problems.push(`${at}: the lines ${note.lines[0]}-${note.lines[1]} of ${note.file} have a note already ("${other}"). Keep one note for them, or give this note other lines.`);
    else noted.set(key, note.title);
    perFile.set(note.file, (perFile.get(note.file) ?? 0) + 1);
  }
  for (const [file, count] of perFile) if (count > MAX_FILE_NOTES) problems.push(`${where}: the file ${file} has ${count} notes. Keep at most ${MAX_FILE_NOTES} for one file.`);
  return problems;
}

/**
 * Says what is wrong with the notes of diagrams of the map, as a save of a change checks a note: the file is a file of the repo (tracked, or new and not ignored), the lines are inside it,
 * and a note in a notebook names a cell. Each problem is one sentence that names the diagram and the note.
 */
export function mapNoteProblems(folder: string, diagrams: Diagram[], fileNotes: Note[] = []): string[] {
  const file = mapAsChange(diagrams, fileNotes);
  if (!file.parts.length) return [];
  const known = new Set(repoFiles(folder) ?? []);
  const cells = cellsIn(folder, 'HEAD');
  const inCells = inCellText(file, cells);
  const where = (part: string, title: string) => (part === FILE_NOTES_PART ? `Note "${title}"` : `Diagram "${part}", note "${title}"`);
  return [
    ...file.parts.flatMap((part) => (part.notes ?? []).filter((note) => !known.has(note.file)).map((note) => `${where(part.id, note.title)}: the file ${note.file} is no file of the repo: Git ignores it, or it does not exist. Point the note at a file that Git tracks, or at a new file that Git does not ignore.`)),
    ...rawLineProblems(file, (path) => !!cells(path, false)),
    ...[...inCells.problems, ...checkLines(folder, inCells.file, 'HEAD', [])].map((bad) => `${where(bad.part, bad.title)}: ${bad.problem}`),
  ];
}

/** Lists what is wrong with the shape of a map. An empty list means the shape is right. */
export function mapProblems(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['The map must be a JSON object.'];
  const map = value as Partial<RepoMap>;
  const problems: string[] = [];
  if (map.format !== 1) problems.push('"format" must be 1.');
  if (!Array.isArray(map.diagrams) || map.diagrams.length === 0) return [...problems, '"diagrams" must hold at least one diagram.'];
  const ids = new Set<string>();
  for (const diagram of map.diagrams) {
    problems.push(...diagramProblems(diagram, new Set()));
    if (ids.has(diagram?.id)) problems.push(`Diagram "${diagram.id}": this id is used twice.`);
    ids.add(diagram?.id);
    if (Object.keys(diagram?.nodePaths ?? {}).length === 0) problems.push(`Diagram "${diagram?.id ?? '?'}": "nodePaths" must say which paths each node stands for.`);
    const notes = Array.isArray(diagram?.notes) ? diagram.notes : [];
    if (notes.length && !diagram.parent) problems.push(`Diagram "${diagram.id}": the top diagram has no notes. Put notes in the diagram of an area.`);
    if (notes.length > MAX_MAP_NOTES) problems.push(`Diagram "${diagram.id}": it has ${notes.length} notes. Keep the ${MAX_MAP_NOTES} that matter most.`);
    if (notes.some((note) => note?.removed)) problems.push(`Diagram "${diagram.id}": a note of the map is on the code as it is. Leave out "removed".`);
  }
  problems.push(...fileNotesProblems(map.fileNotes));
  return problems;
}

/** What the tool found wrong in a map, as plain sentences. */
export interface MapCheck {
  badPaths: string[]; // a path of a node that does not exist
  badNodes: string[]; // a key of nodePaths that is no node of the diagram, or a node with no entry in nodePaths
  badParents: string[]; // a "parent" that does not exist, or that does not lead to the top map
  topMaps: string[]; // set when the map has not exactly one diagram without a "parent"
  sharedFiles: string[]; // a path that sits under two nodes of one diagram
  uncovered?: Uncovered; // a note, not a fault: files of the repo that the checked diagram leaves out. Missing when it leaves none out
}

/** The files of the repo that a diagram leaves out: how many, and the first paths. A folder that holds only such files is named once. */
export interface Uncovered {
  count: number;
  paths: string[];
}

const UNCOVERED_SHOWN = 10;
const covers = (entry: string, file: string): boolean => entry === file || (entry.endsWith('/') && file.startsWith(entry));
const nodePathsOf = (diagram: Diagram): string[] => Object.values(diagram.nodePaths ?? {}).flat();

/** True when a path of a node covers the path asked for, lies inside it, or is the same. */
export const touches = (entry: string, path: string): boolean =>
  entry === path || (entry.endsWith('/') && path.startsWith(entry)) || (path.endsWith('/') && entry.startsWith(path));

/** How many levels a diagram sits below the top map, or undefined when its parents loop or break. */
function depthOf(byId: Map<string, Diagram>, diagram: Diagram): number | undefined {
  let depth = 0;
  for (let at = diagram; at.parent; depth++) {
    const up = byId.get(at.parent);
    if (!up || depth > byId.size) return undefined;
    at = up;
  }
  return depth;
}

/**
 * The files that the nodes of a diagram leave out, of the files that Git tracks and the new files that it does not ignore. For the top map: the files of the repo. For a diagram under another: the files under the
 * paths of the parent's nodes that touch its own paths. Undefined when the diagram leaves none out, or the folder is no Git repo.
 */
export function uncoveredBy(folder: string, map: RepoMap, diagram: Diagram): Uncovered | undefined {
  const files = repoFiles(folder);
  const parent = map.diagrams.find((other) => other.id === diagram.parent);
  if (!files || (diagram.parent && !parent)) return undefined;
  const own = nodePathsOf(diagram);
  const scope = parent ? nodePathsOf(parent).filter((entry) => own.some((path) => touches(entry, path))) : undefined;
  const left = new Set(files.filter((file) => (!scope || scope.some((entry) => covers(entry, file))) && !own.some((entry) => covers(entry, file))));
  if (left.size === 0) return undefined;
  // A folder is named when every file under it is left out; the shallowest such folder of a file names it.
  const total = new Map<string, number>();
  const leftIn = new Map<string, number>();
  const foldersOf = (file: string): string[] => file.split('/').slice(0, -1).map((_, at, folders) => `${folders.slice(0, at + 1).join('/')}/`);
  for (const file of files) for (const folderPath of foldersOf(file)) total.set(folderPath, (total.get(folderPath) ?? 0) + 1);
  for (const file of left) for (const folderPath of foldersOf(file)) leftIn.set(folderPath, (leftIn.get(folderPath) ?? 0) + 1);
  const named = new Set<string>();
  for (const file of left) named.add(foldersOf(file).find((folderPath) => total.get(folderPath) === leftIn.get(folderPath)) ?? file);
  return { count: left.size, paths: [...named].slice(0, UNCOVERED_SHOWN) };
}

/** The map check: each path exists, each key of nodePaths is a node and each node has paths, each parent exists, one top map, and no file under two nodes of one diagram. `around` is the diagram whose left-out files the note `uncovered` lists: the top map by default. */
export function checkMap(folder: string, map: RepoMap, around = map.diagrams.find((diagram) => !diagram.parent)): MapCheck {
  const byId = new Map(map.diagrams.map((diagram) => [diagram.id, diagram]));
  const tops = map.diagrams.filter((diagram) => !diagram.parent);
  const check: MapCheck = {
    badPaths: [], badNodes: [], badParents: [], sharedFiles: [],
    topMaps: tops.length === 1 ? [] : [`The map needs exactly one diagram with no "parent", and it has ${tops.length}.`],
  };
  for (const diagram of map.diagrams) {
    const nodes = Object.entries(diagram.nodePaths ?? {});
    const drawn = Object.keys(diagramGraph(diagram).nodes);
    for (const problem of nodeIdProblems(diagram)) check.badNodes.push(`Diagram "${diagram.id}": ${problem}`);
    for (const [node] of nodes) if (!drawn.includes(node)) check.badNodes.push(`Diagram "${diagram.id}": "${node}" has paths but is no node of the diagram.`);
    for (const node of drawn) if (!diagram.nodePaths?.[node]) check.badNodes.push(`Diagram "${diagram.id}": the node "${node}" has no paths.`);
    for (const [node, paths] of nodes) {
      for (const problem of paths.map((path) => pathProblem(folder, path)).filter(Boolean)) check.badPaths.push(`Diagram "${diagram.id}", node "${node}": ${problem}`);
    }
    // In a schema, two tables can come from one migration file; in the other kinds a file belongs to one node.
    for (const [index, [node, paths]] of (diagram.kind === 'schema' ? [] : nodes).entries()) {
      for (const [other, otherPaths] of nodes.slice(index + 1)) {
        const shared = paths.find((path) => otherPaths.some((otherPath) => touches(path, otherPath)));
        if (shared) check.sharedFiles.push(`Diagram "${diagram.id}": the nodes "${node}" and "${other}" both hold ${shared}.`);
      }
    }
    if (diagram.parent && !byId.has(diagram.parent)) check.badParents.push(`Diagram "${diagram.id}": the parent "${diagram.parent}" does not exist.`);
    else if (depthOf(byId, diagram) === undefined) check.badParents.push(`Diagram "${diagram.id}": its parents do not lead to the top map.`);
  }
  const uncovered = around && uncoveredBy(folder, map, around);
  return uncovered ? { ...check, uncovered } : check;
}

/** One diagram that a path is a part of. */
export interface DiagramOfPath {
  level: 'map' | 'process' | 'wide' | 'change' | 'part' | 'function'; // the widest first; a process is drawn from the map (shared/process-diagrams.ts)
  branch?: string; // the branch of the change that holds it; missing for the map
  diagram?: Diagram; // missing for the diagram of a change, which the tool draws from its parts
  drawn?: ProcessDiagram; // a process: its drawing, with what each node stands for
  changeId?: number; // set when "diagram" is missing
  lit: string[]; // the ids of the nodes or parts that are about this path
  line: string; // what the diagram is: its title
}

const LEVELS: DiagramOfPath['level'][] = ['map', 'process', 'wide', 'change', 'part', 'function'];

const isFolder = (full: string): boolean => {
  try {
    return lstatSync(full).isDirectory(); // a link is one path, as Git lists it
  } catch {
    return false;
  }
};

/** The ids of the nodes whose paths touch the path asked for. */
const nodesAt = (diagram: Diagram, path: string): string[] =>
  Object.entries(diagram.nodePaths ?? {}).filter(([, paths]) => paths.some((entry) => touches(entry, path))).map(([node]) => node);

/** The ids of the nodes of a diagram of a part that have a place in the path asked for. */
const placed = (diagram: Diagram, path: string): string[] => (diagram.broad ? [] : thingsOf(diagram).things
  .filter((thing) => thing.node && !thing.removed && thing.code?.places.some((place) => touches(path, place.file))).map((thing) => thing.key));

/** Every diagram that a folder or a file is a part of, the widest first. A folder may end with "/". */
export function diagramsOf(store: Store, folder: string, path: string): DiagramOfPath[] {
  const asked = path.replace(/^\.\//, '');
  const at = !asked.endsWith('/') && isFolder(join(folder, asked)) ? `${asked}/` : asked;
  const id = repoId(folder);
  const found: DiagramOfPath[] = [];

  const map = store.getMap(id)?.map;
  const mapById = new Map((map?.diagrams ?? []).map((diagram) => [diagram.id, diagram]));
  for (const diagram of map?.diagrams ?? []) {
    const lit = nodesAt(diagram, at);
    if (lit.length > 0) found.push({ level: 'map', diagram, lit, line: diagram.title });
  }
  found.sort((a, b) => (depthOf(mapById, a.diagram!) ?? 0) - (depthOf(mapById, b.diagram!) ?? 0));
  // The processes that have steps in the path, each with those steps lit.
  for (const { drawing, lit } of map ? processesWithStepsIn(map, at) : []) {
    found.push({ level: 'process', diagram: { id: drawing.id, kind: 'flow', title: drawing.title, mermaid: drawing.mermaid }, drawn: drawing, lit, line: drawing.title });
  }

  const seen = new Set<string>(); // the newest change wins when two changes hold a diagram with the same id
  for (const change of store.listChanges(id)) {
    const { file, branch } = change;
    const parts = file.parts.filter((part) => part.files.some((entry) => touches(at, entry)));
    if (parts.length > 0) found.push({ level: 'change', branch, changeId: change.id, lit: parts.map((part) => part.id), line: file.title });
    for (const diagram of file.diagrams ?? []) {
      if (seen.has(diagram.id)) continue;
      seen.add(diagram.id);
      const lit = nodesAt(diagram, at);
      if (lit.length > 0) found.push({ level: 'wide', branch, diagram, lit, line: diagram.title });
      else if ((diagram.file && touches(at, diagram.file)) || placed(diagram, at).length) found.push({ level: 'function', branch, diagram, lit: placed(diagram, at), line: diagram.title });
      else if (parts.some((part) => part.id === diagram.part)) found.push({ level: 'part', branch, diagram, lit: [], line: diagram.title });
    }
  }
  return found.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
}
