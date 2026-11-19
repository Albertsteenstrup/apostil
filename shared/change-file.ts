// The change file: what an agent writes about one change.
// All parts of Apostil share this one format.

import type { CellName, InCell } from './notebook';

export const FORMAT = 1;

export interface ChangeFile {
  format: 1;
  title: string; // what the change does, in one line
  reason: string; // why it was made
  parts: Part[]; // the change, grouped by meaning
  links: Link[]; // which part uses which
  diagrams?: Diagram[];
  generated?: string[]; // changed files that a tool wrote; the view folds them
}

export interface Part {
  id: string; // short and unique in this file: letters, digits and "-"
  name: string;
  note?: string; // one line
  files: string[]; // repo paths; each changed file sits in exactly one part
  notes?: Note[];
}

export interface Note {
  file: string;
  cell?: CellName; // in a notebook: the cell, by its id, else by its number among the cells (from 1); `lines` then count inside that cell
  lines: [number, number]; // first and last line, counted from 1; with `removed`, counted in the file as it was at the base
  inCell?: InCell; // set by the tool, never written: where a place in a cell stands, when `lines` were turned into lines of the text of the cells (shared/notebook.ts)
  removed?: boolean; // true: the lines are lines that the change removed
  title: string;
  text?: string; // one line
  symbol?: string; // the function or class that these lines belong to
  tests?: string[]; // tests that the agent links by hand, as "path::name"
}

export interface Link {
  from: string; // part id
  to: string; // part id
  label?: string;
  lines?: Code; // its code, as an arrow of a diagram has it: places, each with its "file" (usually the line of the call or the import), or a reason
}

export type Lines = [number, number]; // first and last line, counted from 1

/**
 * The code of a node or an arrow of a diagram of a part, or of a link between parts: one or more places, or one reason for having none.
 * A range alone is lines in the "file" of the diagram; a list holds several places. A link has no file of its own, so each of its places names one. shared/diagram-code.ts reads it.
 */
export type Code = Lines | Reason | PlaceText | (Lines | PlaceText)[];

/** A place written out: a file with lines, removed lines counted in the file as it was at the base, or a whole file (no lines). "file" defaults to the file of the diagram. */
export interface PlaceText {
  file?: string;
  cell?: CellName; // in a notebook: the cell, as for a note
  lines?: Lines;
  removed?: boolean;
  inCell?: InCell; // set by the tool, never written
}

/** Why a thing has no code: outside the repo, only the order (arrows only), or no line of its own. */
export type Reason = 'outside' | 'order' | 'no-line';
export const REASONS: Reason[] = ['outside', 'order', 'no-line'];

/** The code of one arrow, message or transition: its two ends by node id, and its label when two arrows join the same ends. */
export interface EdgeLines {
  from: string;
  to: string;
  label?: string;
  lines: Code;
  removed?: boolean; // true: the lines are lines that the change removed, counted in the file as it was (for an arrow that is no longer in the diagram)
}

export type DiagramKind = 'flow' | 'sequence' | 'state' | 'schema'; // schema: tables and relations, as an entity-relationship diagram (shared/schema.ts)

export interface Diagram {
  id: string;
  kind: DiagramKind;
  title: string;
  mermaid: string; // Mermaid text; for a schema, an entity-relationship diagram ("erDiagram")
  part?: string; // the part that this diagram explains,
  file?: string; // or the file,
  symbol?: string; // or the function
  nodeLines?: Record<string, Code>; // the code of a node, by node id: lines in "file", places, or a reason; a removed node (in "before" only) too
  edgeLines?: EdgeLines[]; // the code of an arrow, a message or a transition; a removed one too
  covers?: Lines; // the lines of "file" that the diagram explains: for a function, from its head to its end
  broad?: boolean; // true for a diagram of a wider setup
  of?: string; // the repo diagram that this diagram changes: the id of a diagram of the map, or of a drawing of the map ("process:<id>"); "before" is its text
  new?: true; // the code of the diagram is all new in this change: it has no "of" and no "before"
  before?: string; // the Mermaid text of the same diagram for the code as it was at the base; a node that is still there keeps its id
  nodePaths?: Record<string, string[]>; // the folders (ending with "/") and files that a node stands for, by node id
  parent?: string; // the id of the diagram one level up
  notes?: Note[]; // in a diagram of an area of the map: notes on the code as it is, with no removed lines (shared/repo-map.ts)
}

export const ID = /^[a-z0-9][a-z0-9-]*$/; // the id of a part or a process: small letters, digits and "-"
const KINDS: DiagramKind[] = ['flow', 'sequence', 'state', 'schema'];

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isLine = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1;
const isRepoPath = (value: unknown): value is string => isText(value) && !value.startsWith('/') && !value.split('/').includes('..');
const isLines = (value: unknown): boolean => Array.isArray(value) && value.length === 2 && isLine(value[0]) && isLine(value[1]) && value[0] <= value[1];
const isCell = (value: unknown): boolean => isLine(value) || isText(value); // an id, or a number from 1
const CELL_FORM = '"cell" must be the id of a cell, or its number among the cells, counted from 1.';

const CODE_FORM = 'give [first, last], a reason (outside, order, no-line), a place { "file"?, "lines"?, "removed"? }, or a list of places';

const NO_FILE = { diagram: 'lines alone need "file" in the diagram; else give the file in a place.', link: 'a link has no file of its own; give a place { "file": path, "lines": [first, last] }.' };

/** Says what is wrong with the shape of the code of one thing, or undefined when it is right. `file` is the file of its diagram; a link has none. */
function codeProblem(code: unknown, file: string | undefined, isNode = false, noFile = NO_FILE.diagram): string | undefined {
  if (code === 'order' && isNode) return '"order" is a reason for arrows only; a node is outside, no-line, or has lines.';
  if (typeof code === 'string') return (REASONS as string[]).includes(code) ? undefined : `"${code}" is no reason; ${CODE_FORM}.`;
  const places = !isLines(code) && Array.isArray(code) && code.length > 0 && !code.some(isLine) ? code : [code];
  for (const place of places) {
    if (isLines(place)) {
      if (!isText(file)) return noFile;
      continue;
    }
    if (Array.isArray(place) && place.length === 2 && place.every((value) => typeof value === 'number')) return 'lines must be [first, last], counted from 1, the first not after the last.';
    if (!place || typeof place !== 'object' || Array.isArray(place)) return `${CODE_FORM}.`;
    const { file: path, lines, removed, cell } = place as PlaceText;
    if (path !== undefined && !isRepoPath(path)) return '"file" must be a path in the repo.';
    if (cell !== undefined && !isCell(cell)) return CELL_FORM;
    if (cell !== undefined && lines === undefined) return 'a place in a cell needs "lines", counted inside the cell.';
    if (path === undefined && !isText(file)) return noFile === NO_FILE.diagram ? 'a place needs "file" when the diagram has none.' : noFile;
    if (lines !== undefined && !isLines(lines)) return '"lines" must be [first, last], counted from 1.';
    if (removed !== undefined && typeof removed !== 'boolean') return '"removed" must be true or false.';
    if (removed && lines === undefined) return 'removed lines need "lines".';
  }
  return undefined;
}

/** Lists what is wrong with the shape of one note, of a part or of a diagram of the map. `where` names its part or diagram. */
export function noteProblems(note: Note, where: string): string[] {
  const at = `${where}, note "${note?.title ?? '?'}"`;
  const problems: string[] = [];
  if (!isText(note?.title)) problems.push(`${at}: "title" is missing.`);
  if (!isText(note?.file)) problems.push(`${at}: "file" is missing.`);
  if (!isLines(note?.lines)) problems.push(`${at}: "lines" must be [first, last], counted from 1.`);
  if (note?.removed !== undefined && typeof note.removed !== 'boolean') problems.push(`${at}: "removed" must be true or false.`);
  if (note?.cell !== undefined && !isCell(note.cell)) problems.push(`${at}: ${CELL_FORM}`);
  return problems;
}

/** Lists what is wrong with the shape of one diagram. `partIds` are the parts that it may name. */
export function diagramProblems(diagram: Diagram, partIds: Set<string>): string[] {
  const where = `Diagram "${diagram?.id ?? '?'}"`;
  const problems: string[] = [];
  if (!isText(diagram?.id)) problems.push(`${where}: "id" is missing.`);
  if (!KINDS.includes(diagram?.kind)) problems.push(`${where}: "kind" must be flow, sequence, state or schema.`);
  if (!isText(diagram?.title)) problems.push(`${where}: "title" is missing.`);
  if (!isText(diagram?.mermaid)) problems.push(`${where}: "mermaid" is missing.`);
  if (diagram?.part && !partIds.has(diagram.part)) problems.push(`${where}: "part" is not a part id.`);
  for (const [node, code] of Object.entries(diagram?.nodeLines ?? {})) {
    const problem = codeProblem(code, diagram.file, true);
    if (problem) problems.push(`${where}: "nodeLines" of "${node}": ${problem}`);
  }
  const edgeLines = diagram?.edgeLines;
  if (edgeLines !== undefined) {
    if (!Array.isArray(edgeLines) || !edgeLines.every((one) => isText(one?.from) && isText(one?.to) && (one.label === undefined || typeof one.label === 'string'))) {
      problems.push(`${where}: "edgeLines" must be a list of { from, to, label?, lines }.`);
    } else {
      for (const one of edgeLines) {
        const problem = codeProblem(one.lines, diagram.file);
        if (problem) problems.push(`${where}: "edgeLines" of "${one.from} → ${one.to}${one.label ? `: ${one.label}` : ''}": ${problem}`);
      }
    }
  }
  if (diagram?.covers !== undefined && (!isLines(diagram.covers) || !isText(diagram.file))) problems.push(`${where}: "covers" must be [first, last], in "file".`);
  if (diagram?.parent !== undefined && !isText(diagram.parent)) problems.push(`${where}: "parent" must be a diagram id.`);
  if (diagram?.of !== undefined && !isText(diagram.of)) problems.push(`${where}: "of" must be the id of a repo diagram.`);
  if (diagram?.new !== undefined && diagram.new !== true) problems.push(`${where}: "new" must be true, or left out.`);
  if (diagram?.new && (diagram.of !== undefined || diagram.before !== undefined)) problems.push(`${where}: code that is all new has no "of" and no "before".`);
  if (diagram?.notes !== undefined && !Array.isArray(diagram.notes)) problems.push(`${where}: "notes" must be a list of notes.`);
  for (const note of Array.isArray(diagram?.notes) ? diagram.notes : []) problems.push(...noteProblems(note, where));
  for (const [node, paths] of Object.entries(diagram?.nodePaths ?? {})) {
    if (!Array.isArray(paths) || paths.length === 0 || !paths.every(isRepoPath)) {
      problems.push(`${where}: "nodePaths" of "${node}" must be a list of repo paths, with "/" at the end of a folder.`);
    }
  }
  return problems;
}

/** Lists what is wrong with the shape of a change file. An empty list means the shape is right. */
export function shapeProblems(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['The change file must be a JSON object.'];
  const file = value as Partial<ChangeFile>;
  const problems: string[] = [];
  if (file.format !== FORMAT) problems.push(`"format" must be ${FORMAT}.`);
  if (!isText(file.title)) problems.push('"title" must be one line of text.');
  if (!isText(file.reason)) problems.push('"reason" must be one line of text.');
  if (!Array.isArray(file.parts) || file.parts.length === 0) return [...problems, '"parts" must hold at least one part.'];

  const ids = new Set<string>();
  for (const part of file.parts) {
    const where = `Part "${part?.id ?? '?'}"`;
    if (!isText(part?.id) || !ID.test(part.id)) problems.push(`${where}: "id" must use small letters, digits and "-".`);
    else if (ids.has(part.id)) problems.push(`${where}: this id is used twice.`);
    else ids.add(part.id);
    if (!isText(part?.name)) problems.push(`${where}: "name" is missing.`);
    if (!Array.isArray(part?.files) || !part.files.every(isText)) problems.push(`${where}: "files" must be a list of paths.`);
    for (const note of part?.notes ?? []) problems.push(...noteProblems(note, where));
  }
  for (const link of file.links ?? []) {
    if (!ids.has(link?.from) || !ids.has(link?.to)) problems.push(`Link "${link?.from}" to "${link?.to}": both ends must be part ids.`);
    const problem = link?.lines !== undefined && codeProblem(link.lines, undefined, false, NO_FILE.link);
    if (problem) problems.push(`Link "${link.from} → ${link.to}${link.label ? `: ${link.label}` : ''}": "lines": ${problem}`);
  }
  for (const diagram of file.diagrams ?? []) problems.push(...diagramProblems(diagram, ids));
  return problems;
}
