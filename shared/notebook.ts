// A Jupyter notebook (.ipynb) read as its cells. Apostil only reads a notebook: it never runs a cell, starts a kernel or writes the file.
// The rest of Apostil sees a notebook as one text, "the text of the cells": for each cell a head line, then the lines of its code or text.
// A place in a cell (a cell and lines counted inside it) is turned into lines of that text here, so that every check, diff and page works with lines as for any file.

import type { ChangeFile, Code, Lines, Note, PlaceText } from './change-file';
import { isRange } from './diagram-code';

export type CellKind = 'code' | 'text' | 'raw';

/** One cell as the notebook holds it: its kind, its id (newer notebooks), the lines of its code or text, and whether it has outputs. */
export interface Cell {
  kind: CellKind;
  id?: string;
  lines: string[];
  output?: true;
}

/** Where a cell stands in the text of the cells: its number (from 1), its head line (from 1) and its count of lines. */
export interface CellAt {
  number: number;
  kind: CellKind;
  id?: string;
  at: number; // the head line; the lines of the cell are at + 1 to at + length
  length: number;
  output?: true;
}

/** How a writer names a cell: its id, or its number among the cells, counted from 1. */
export type CellName = string | number;

/** Where a place in a cell stands, kept beside the lines of the text of the cells that the tool works with. Set by the tool, never by a writer. */
export interface InCell {
  words: string; // "cell 3"
  lines: Lines; // the lines inside the cell, as the writer gave them
  at: number; // the head line of the cell in the text of the cells
  length: number;
}

export const isNotebookPath = (path: string): boolean => /\.ipynb$/i.test(path);

const KINDS: Record<string, CellKind> = { code: 'code', markdown: 'text' };
const HEAD = /^«cell (code|text|raw)(?: (.+))?»$/;

/** The cells of a notebook, or undefined when the text does not read as a notebook. `source` is a string in some notebooks and a list of strings in others. */
export function readNotebook(raw: string): Cell[] | undefined {
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return undefined; }
  const cells = (json as { cells?: unknown })?.cells;
  if (!Array.isArray(cells)) return undefined;
  const out: Cell[] = [];
  for (const cell of cells) {
    const { cell_type: type, source, id, outputs } = (cell ?? {}) as Record<string, unknown>;
    if (typeof type !== 'string') return undefined;
    const text = Array.isArray(source) ? source.join('') : typeof source === 'string' ? source : source === undefined ? '' : undefined;
    if (text === undefined) return undefined;
    const lines = text === '' ? [] : text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    out.push({ kind: KINDS[type] ?? 'raw', ...(typeof id === 'string' && id ? { id } : {}), lines, ...(Array.isArray(outputs) && outputs.length ? { output: true as const } : {}) });
  }
  return out;
}

/** The head line of a cell in the text of the cells. It holds the kind and the id, not the number, so that a cell put in above does not change the heads below it. */
export const headLine = (cell: Pick<Cell, 'kind' | 'id'>): string => `«cell ${cell.kind}${cell.id ? ` ${cell.id}` : ''}»`;

/** The text of the cells: for each cell its head line, then its lines. */
export const notebookText = (cells: Cell[]): string => (cells.length ? `${cells.flatMap((cell) => [headLine(cell), ...cell.lines]).join('\n')}\n` : '');

/** Where each cell stands in the text of the cells, from the cells. */
export function cellsAt(cells: Cell[]): CellAt[] {
  let at = 1;
  return cells.map((cell, index) => {
    const one: CellAt = { number: index + 1, kind: cell.kind, ...(cell.id ? { id: cell.id } : {}), at, length: cell.lines.length, ...(cell.output ? { output: true as const } : {}) };
    at += cell.lines.length + 1;
    return one;
  });
}

/** Where each cell stands, read back from the text of the cells; empty when the text is not one (it does not start with a head line). */
export function cellsOfText(text: string | string[]): CellAt[] {
  const lines = typeof text === 'string' ? text.replace(/\n$/, '').split('\n') : text;
  if (!HEAD.test(lines[0] ?? '')) return [];
  const out: CellAt[] = [];
  lines.forEach((line, index) => {
    const head = HEAD.exec(line);
    if (head) out.push({ number: out.length + 1, kind: head[1] as CellKind, ...(head[2] ? { id: head[2] } : {}), at: index + 1, length: 0 });
    else if (out.length) out[out.length - 1].length++;
  });
  return out;
}

/** The cell that a name points at: an id, else a number from 1 (also written as text). */
export function findCell(cells: CellAt[], name: CellName): CellAt | undefined {
  if (typeof name === 'string') {
    const byId = cells.find((cell) => cell.id === name);
    if (byId || !/^\d+$/.test(name)) return byId;
  }
  return cells[Number(name) - 1];
}

/** The cell that a line of the text of the cells is in, and the line inside it (0 for its head line). */
export function cellOfLine(cells: CellAt[], line: number): { cell: CellAt; line: number } | undefined {
  const cell = cells.find((one) => one.at <= line && line <= one.at + one.length);
  return cell && { cell, line: line - cell.at };
}

/** "cell 3 · code · id a1b2": a cell in words, for a head on the page. A text cell is a Markdown cell of the notebook. */
export const cellWords = (cell: CellAt): string => [`cell ${cell.number}`, cell.kind, ...(cell.id ? [`id ${cell.id}`] : [])].join(' · ');

/** "cell 3" or "cell "a1b2"": the name of a cell as a writer gave it, for a message. */
const nameWords = (name: CellName): string => (typeof name === 'number' || /^\d+$/.test(name) ? `cell ${name}` : `cell "${name}"`);

const range = ([first, last]: Lines): string => (first === last ? `line ${first}` : `lines ${first}-${last}`);

/** Lines inside a cell as lines of the text of the cells, or a problem that a writer can act on. */
export function placeInCell(cells: CellAt[], path: string, name: CellName, lines: Lines): { lines: Lines; inCell: InCell } | { problem: string } {
  const cell = findCell(cells, name);
  if (!cell) {
    const names = cells.slice(0, 12).map((one) => (one.id ? `${one.number} (id ${one.id})` : `${one.number}`)).join(', ');
    return { problem: `${path} has no ${nameWords(name)}. Its cells: ${names}${cells.length > 12 ? ', …' : ''}.` };
  }
  if (lines[1] > cell.length) return { problem: `Line ${lines[1]} is after the end of ${nameWords(name)} of ${path}, which has ${cell.length} line${cell.length === 1 ? '' : 's'}.` };
  return { lines: [cell.at + lines[0], cell.at + lines[1]], inCell: { words: `cell ${cell.number}`, lines, at: cell.at, length: cell.length } };
}

// ----- a change file with places in cells -----

/** A note or a place as written: a file, a cell, lines, removed lines; and where it stands in its cell, once the tool turned it. */
type Spot = { file?: string; cell?: CellName; lines?: Lines; removed?: boolean; inCell?: InCell };

/** Where a note or a place is in a change file, for a message: its part, the title of its note or diagram, and the thing in words. */
export interface SpotAt { part: string; title: string; words: string; note?: true }

/**
 * Goes over every note and every place of a change file (the code of each node, arrow and link) and gives each to `visit` with the path it is in.
 * `visit` returns the note or place to keep, or undefined to leave it out. A range alone is given as { lines }, and kept as a range when it comes back the same.
 */
export function mapSpots(file: ChangeFile, visit: <T extends Spot>(one: T, path: string, at: SpotAt) => T | undefined): ChangeFile {
  const code = (value: Code | undefined, own: string | undefined, at: SpotAt): Code | undefined => {
    if (value === undefined || typeof value === 'string') return value;
    const list = isRange(value) ? [value] : Array.isArray(value) ? value : [value];
    const kept = list.flatMap((place) => {
      const one: PlaceText = isRange(place) ? { lines: place } : place;
      const back = visit(one, one.file ?? own ?? '', at);
      return back === undefined ? [] : [back === one && isRange(place) ? place : back];
    });
    return isRange(value) || !Array.isArray(value) ? kept[0] ?? [] : kept as Code;
  };
  const parts = file.parts.map((part) => (!part.notes ? part : {
    ...part, notes: part.notes.flatMap((note): Note[] => {
      const kept = visit(note, note.file, { part: part.id, title: note.title, words: 'The note', note: true });
      return kept ? [kept] : [];
    }),
  }));
  const diagrams = file.diagrams?.map((diagram) => {
    const at = (words: string): SpotAt => ({ part: diagram.part ?? '', title: diagram.title, words: `Diagram "${diagram.id}": ${words}` });
    return {
      ...diagram,
      ...(diagram.nodeLines ? { nodeLines: Object.fromEntries(Object.entries(diagram.nodeLines).map(([node, value]) => [node, code(value, diagram.file, at(`The node "${node}"`))!])) } : {}),
      ...(diagram.edgeLines ? { edgeLines: diagram.edgeLines.map((edge) => ({ ...edge, lines: code(edge.lines, diagram.file, at(`The arrow "${edge.from} → ${edge.to}"`))! })) } : {}),
    };
  });
  const links = (file.links ?? []).map((link) => (link.lines === undefined ? link
    : { ...link, lines: code(link.lines, undefined, { part: link.from, title: `the link ${link.from} → ${link.to}`, words: `The link "${link.from} → ${link.to}"` }) }));
  return { ...file, parts, links, ...(diagrams ? { diagrams } : {}) };
}

/** The text of the cells of a file, as it is now, or at the base for removed lines; undefined when it does not read as a notebook. */
export type CellsOf = (path: string, removed: boolean) => CellAt[] | undefined;

/** A place that the tool could not put in a cell, as the line check lists it. */
export interface CellProblem { part: string; title: string; problem: string }

/**
 * The change file with each note and place in a cell turned into lines of the text of the cells; each keeps where it stands in its cell (`inCell`).
 * A place that cannot be put there is left out, and `problems` says why. A place in a file that is no notebook is left as it is.
 */
export function inCellText(file: ChangeFile, cellsOf: CellsOf): { file: ChangeFile; problems: CellProblem[] } {
  const problems: CellProblem[] = [];
  const turned = mapSpots(file, (one, path, at) => {
    if (one.cell === undefined || !one.lines || one.inCell) return one;
    const problem = (text: string) => void problems.push({ part: at.part, title: at.title, problem: at.note ? text : `${at.words.replace(/^Diagram "[^"]*": The /, '').replace(/^\w/, (first) => first.toUpperCase())}: ${text}` });
    const cells = cellsOf(path, !!one.removed);
    if (!cells?.length) return problem(`${path} does not read as a notebook${one.removed ? ' before the change' : ''}, so it has no cells. Name lines of the file.`);
    const found = placeInCell(cells, path, one.cell, one.lines);
    if ('problem' in found) return problem(one.removed ? `${found.problem} Removed lines count in the notebook as it was before the change.` : found.problem);
    return { ...one, lines: found.lines, inCell: found.inCell };
  });
  return { file: turned, problems };
}

/**
 * What the save refuses in a notebook: a note or a place that names lines of the raw file, with no cell. `isNotebook(path, removed)` says whether a file reads as a notebook.
 * The words name each one so that a writer can act on it.
 */
export function rawLineProblems(file: ChangeFile, isNotebook: (path: string, removed: boolean) => boolean): string[] {
  const problems: string[] = [];
  mapSpots(file, (one, path, at) => {
    if (one.lines && one.cell === undefined && isNotebookPath(path) && isNotebook(path, !!one.removed)) {
      problems.push(`${at.words} at ${path} ${range(one.lines)} names lines of the raw file. Name the cell and the lines inside it.`);
    }
    return one;
  });
  for (const diagram of file.diagrams ?? []) {
    if (diagram.covers && diagram.file && isNotebookPath(diagram.file) && isNotebook(diagram.file, false)) problems.push(`Diagram "${diagram.id}": "covers" names lines of the raw file ${diagram.file}. Leave "covers" out for a notebook.`);
  }
  return problems;
}

// ----- the change of a notebook, by cells -----

/** A cell as the page shows its head: where it stands, its words, and a key that is the same for a cell before and now, so a changed cell has one head. */
export interface CellHead {
  at: number;
  length: number;
  kind: CellKind;
  words: string; // "cell 3 · code · id a1b2"
  state?: string; // "new", "removed", "moved from cell 2", "moved to cell 5"
  output?: true; // the cell has an output, which the page does not show
  key: string;
}

/** The head of a cell as the page shows it, with its key and what the change did to it. */
export const cellHead = (cell: CellAt, key: string, state?: string): CellHead => ({
  at: cell.at, length: cell.length, kind: cell.kind, words: cellWords(cell), ...(state ? { state } : {}), ...(cell.output ? { output: true as const } : {}), key,
});

/** The cells of a changed notebook before and now, as the page shows their heads. */
export interface NotebookCells {
  now: CellHead[];
  before: CellHead[];
}

/**
 * Which cell before is which cell now, from the diff of the two texts of the cells (`removed` and `added` lines of it): a line that the diff keeps
 * stands for the same line, so a head line that it keeps joins two cells. A cell with no partner is new or removed; a new cell with the id,
 * or with no id the kind and the lines, of a removed cell is that cell moved.
 */
export function notebookCells(before: Cell[], now: Cell[], removed: Set<number>, added: Set<number>): NotebookCells {
  const [old, cur] = [cellsAt(before), cellsAt(now)];
  const lengthOf = (cells: CellAt[]) => (cells.length ? cells[cells.length - 1].at + cells[cells.length - 1].length : 0);
  const kept = new Map<number, number>(); // a line before -> the same line now
  for (let [a, b] = [1, 1]; a <= lengthOf(old) || b <= lengthOf(cur);) {
    if (removed.has(a)) a++;
    else if (added.has(b)) b++;
    else kept.set(a++, b++);
  }
  const partnerOf = new Map<number, number>(); // number before -> number now
  for (const cell of old) {
    const line = kept.get(cell.at);
    const other = line === undefined ? undefined : cur.find((one) => one.at === line);
    if (other) partnerOf.set(cell.number, other.number);
  }
  const partnered = new Set(partnerOf.values());
  const same = (a: number, b: number) => (before[a - 1].id && now[b - 1].id ? before[a - 1].id === now[b - 1].id
    : before[a - 1].kind === now[b - 1].kind && before[a - 1].lines.join('\n') === now[b - 1].lines.join('\n'));
  const movedTo = new Map<number, number>();
  for (const cell of cur.filter((one) => !partnered.has(one.number))) {
    const from = old.find((one) => !partnerOf.has(one.number) && ![...movedTo.values()].includes(one.number) && same(one.number, cell.number));
    if (from) movedTo.set(cell.number, from.number);
  }
  const movedFrom = new Map([...movedTo].map(([to, from]) => [from, to]));
  const changed = (cell: CellAt, lines: Set<number>) => Array.from({ length: cell.length }, (_, at) => cell.at + 1 + at).some((line) => lines.has(line));
  return {
    now: cur.map((cell) => {
      const partner = [...partnerOf].find(([, to]) => to === cell.number)?.[0];
      const state = movedTo.has(cell.number) ? `moved from cell ${movedTo.get(cell.number)}` : partner === undefined ? 'new' : changed(cell, added) || changed(old[partner - 1], removed) ? 'changed' : undefined;
      return cellHead(cell, `now:${cell.number}`, state);
    }),
    before: old.map((cell) => (partnerOf.has(cell.number) ? cellHead(cell, `now:${partnerOf.get(cell.number)}`)
      : cellHead(cell, `before:${cell.number}`, movedFrom.has(cell.number) ? `moved to cell ${movedFrom.get(cell.number)}` : 'removed'))),
  };
}

/** The count of the lines of cells in a text of the cells, or of a diff of two: a head line is no line of a cell. */
export const isHeadLine = (text: string): boolean => HEAD.test(text);
