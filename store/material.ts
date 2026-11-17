// The material for the two subagents: what the writer needs, and what the fresh checker reads.

import type { Note } from '../shared/change-file';
import { cellsIn } from '../shared/checks';
import { labelsOf, linkThings, linkWords, REASON_WORDS, thingsOf, thingWords, type Place, type ThingCode } from '../shared/diagram-code';
import { changeOfFolder } from '../shared/context';
import { changedFiles, currentBranch, fileDiff, fileText, notebookChange, type ChangedFile } from '../shared/git';
import { cellsAt, inCellText, isNotebookPath } from '../shared/notebook';
import type { Store } from '../shared/store';
import { baseFor } from './save';

const MAX_NAMES = 200;
const OLD_CODE_LINES = 200; // of the old code of a diagram's file, from its function on
const THING_LINES = 60; // of one place of a node or an arrow

// A line that starts a function, a class, a table or a web route (Python, TypeScript, SQL).
const NAME_LINE = [
  /^\s*(async\s+)?def\s+\w+/,
  /^\s*(export\s+)?(default\s+)?(abstract\s+)?class\s+\w+/,
  /^\s*(export\s+)?(default\s+)?(async\s+)?function\b\s*\*?\s*\w+/,
  /^\s*(export\s+)?(const|let)\s+\w+\s*=\s*(async\s*)?(\([^)]*\)|\w+)\s*(:[^=]+)?=>/,
  /^\s*(create|alter|drop)\s+(or\s+replace\s+)?(table|function|procedure|view)\b/i,
  /^\s*@\w+\.(get|post|put|patch|delete|route)\(/,
  /^\s*\w+\.(get|post|put|patch|delete)\(\s*['"`]/,
];

export interface NameLine {
  file: string;
  change: 'added' | 'removed';
  text: string;
}

/** The added and removed lines of a file. A new file that Git does not track yet counts as all added. */
function diffLines(folder: string, base: string, file: ChangedFile): string[] {
  const diff = fileDiff(folder, base, file.path, undefined, file.renamedFrom);
  if (diff) return diff.split('\n').filter((line) => /^[+-](?![+-]{2} )/.test(line));
  return (fileText(folder, file.path) ?? '').split('\n').map((line) => `+${line}`);
}

/**
 * A changed notebook by its cells, so that a writer can point at them: each cell with its name (`cell`: its id, else its number) and kind;
 * a new, changed or moved cell with its lines, numbered inside the cell; a removed cell with its lines as they were. Outputs are left out.
 */
function cellsOfNotebook(folder: string, base: string, file: ChangedFile) {
  const change = notebookChange(folder, base, file);
  if (!change) return undefined;
  const { sides, heads } = change;
  const numbered = (text: string[]) => text.map((line, at) => `${at + 1}: ${line}`);
  const now = cellsAt(sides.now).map((cell, at) => ({
    cell: cell.id ?? cell.number, number: cell.number, kind: cell.kind,
    ...(heads.now[at].state ? { change: heads.now[at].state, lines: numbered(sides.now[at].lines) } : { lineCount: cell.length }),
  }));
  const gone = cellsAt(sides.before).flatMap((cell, at) => (heads.before[at].key.startsWith('before:')
    ? [{ cell: cell.id ?? cell.number, number: cell.number, kind: cell.kind, change: heads.before[at].state, removedLines: numbered(sides.before[at].lines) }] : []));
  return { cells: now, ...(gone.length ? { removedCells: gone } : {}) };
}

/** What the writer subagent needs to describe the change. */
/** What `apostil material` says when no file changed: an agent that was asked for notes must not ask for a commit. */
export const NO_CHANGE_HINT = 'No file changed, so there is no change to describe. If the owner asked for notes on the code as it is: they come with the map and need no commit (skill apostil-map-repo). If he asked to describe a commit: add --base <the commit before it>, for example --base HEAD~1 for the latest commit.';

export function changeMaterial(store: Store, folder: string, named?: string) {
  const base = baseFor(store, folder, named);
  const files = changedFiles(folder, base);
  const names: NameLine[] = files.flatMap((file) => diffLines(folder, base, file)
    .filter((line) => NAME_LINE.some((pattern) => pattern.test(line.slice(1))))
    .map((line) => ({ file: file.path, change: line[0] === '+' ? 'added' as const : 'removed' as const, text: line.slice(1).trim() })));
  return {
    ...(files.length ? {} : { hint: NO_CHANGE_HINT }),
    branch: currentBranch(folder), base,
    // The old text of a file: a deleted file, or code that a changed file lost. A renamed file has `renamedFrom`.
    oldText: `git show ${base}:<path>`,
    files: files.map((file) => ({ ...file, ...(file.status === 'removed' ? { oldText: `git show ${base}:${file.path}` } : {}), ...cellsOfNotebook(folder, base, file) })),
    // A note or a place in a notebook names the cell ("cell": its id, else its number from 1) and lines counted inside that cell, never lines of the raw file.
    ...(files.some((file) => isNotebookPath(file.path)) ? { notebooks: 'A note or a place in a notebook names "cell" (its id, else its number among the cells, from 1) and "lines" counted inside that cell, from 1.' } : {}),
    names: names.slice(0, MAX_NAMES), namesLeftOut: Math.max(0, names.length - MAX_NAMES),
    changeFile: changeOfFolder(store, folder)?.file, // so the writer can update it
  };
}

export interface CodeRange {
  file: string;
  cell?: string | number; // in a notebook: the cell, as the notes name it; `lines` and the numbers of `code` count inside it
  lines: [number, number];
  titles: string[]; // the notes that point here
  removed?: true; // the notes are on lines that the change removed: the lines are those of the file at the base
  code: string[]; // the lines, each with its number; a removed line also has "[removed]"
}

/** The ranges of the notes. Notes with one symbol in one file (in a notebook, in one cell) give one range. Lines in a cell count in the text of the cells here. */
function rangesOf(notes: Note[]): (Omit<CodeRange, 'code'> & { at?: number })[] {
  const ranges = new Map<string, Omit<CodeRange, 'code'> & { at?: number }>();
  for (const [index, note] of notes.entries()) {
    const key = `${note.removed ? 'removed ' : ''}${note.file}${note.inCell ? `@${note.inCell.at}` : ''}::${note.symbol ?? `#${index}`}`;
    const range = ranges.get(key);
    if (!range) ranges.set(key, { file: note.file, ...(note.inCell ? { cell: note.cell, at: note.inCell.at } : {}), lines: [...note.lines], titles: [note.title], ...(note.removed ? { removed: true as const } : {}) });
    else {
      range.lines = [Math.min(range.lines[0], note.lines[0]), Math.max(range.lines[1], note.lines[1])];
      range.titles.push(note.title);
    }
  }
  return [...ranges.values()];
}

/**
 * What a fresh subagent gets: the title, the parts with their notes, the code that the notes point at, and each node and arrow of their diagrams
 * and each link that leaves the part, with its code.
 * The reason of the change is left out: a checker that knows the reason excuses a wrong note.
 * With a part id, only that part: one checker for each part keeps the input small, and the checkers can run at the same time.
 */
export function forFreshCheck(store: Store, folder: string, partId?: string, named?: string) {
  const stored = changeOfFolder(store, folder);
  if (!stored) return undefined;
  const change = named ? { ...stored, base: named } : stored;
  const parts = change.file.parts.filter((part) => !partId || part.id === partId);
  const files = changedFiles(folder, change.base);
  const oldPath = (path: string): string => files.find((file) => file.path === path)?.renamedFrom ?? path; // a removed note on a renamed file counts in the old file
  // A place in a cell of a notebook as lines of the text of its cells; its code is numbered inside the cell, as the writer counted it.
  const inCells = inCellText(change.file, cellsIn(folder, change.base, files)).file;
  const ranges: CodeRange[] = rangesOf(inCells.parts.filter((part) => !partId || part.id === partId).flatMap((part) => part.notes ?? [])).map(({ at = 0, ...range }) => {
    const text = ((range.removed ? fileText(folder, oldPath(range.file), change.base) : fileText(folder, range.file)) ?? '').split('\n');
    const mark = range.removed ? '[removed] ' : '';
    const code = text.slice(range.lines[0] - 1, range.lines[1]).map((line, index) => `${range.lines[0] + index - at}: ${mark}${line}`);
    return { ...range, lines: [range.lines[0] - at, range.lines[1] - at], code };
  });
  // A diagram with "before", with the code of its file as it was, so the checker can read "before" against the old code.
  const oldCode = (path: string, symbol?: string): string[] => {
    const lines = (fileText(folder, oldPath(path), change.base) ?? '').split('\n');
    const start = symbol ? Math.max(0, lines.findIndex((line) => line.includes(symbol) && NAME_LINE.some((pattern) => pattern.test(line)))) : 0;
    return lines.slice(start, start + OLD_CODE_LINES).map((line, index) => `${start + index + 1}: ${line}`);
  };
  const diagrams = (change.file.diagrams ?? []).filter((diagram) => diagram.before && !diagram.broad && (!partId || diagram.part === partId))
    .map(({ id, kind, title, mermaid, before, file, symbol }) => ({ id, kind, title, mermaid, before, ...(file ? { file, oldCode: oldCode(file, symbol) } : {}) }));
  // Each node and arrow of each diagram of the part with its code (each place with its lines), or its reason, so the checker reads it against what the diagram says.
  const placeCode = (place: Place): string[] => {
    if (!place.lines) return [];
    const [first, last] = place.lines;
    const at = place.inCell?.at ?? 0;
    const text = (place.removed ? fileText(folder, oldPath(place.file), change.base) : fileText(folder, place.file)) ?? '';
    return text.split('\n').slice(first - 1, Math.min(last, first + THING_LINES - 1)).map((line, index) => `${first + index - at}: ${place.removed ? '[removed] ' : ''}${line}`);
  };
  // A place as the writer gave it (in a cell: the cell and the lines inside it), with its code.
  const written = ({ inCell, ...place }: Place) => ({ ...place, ...(inCell ? { lines: inCell.lines } : {}) });
  const codeOf = (code: ThingCode | undefined) => (code?.reason ? { reason: REASON_WORDS[code.reason] } : { places: (code?.places ?? []).map((place) => ({ ...written(place), code: placeCode(place) })) });
  const things = (inCells.diagrams ?? []).filter((diagram) => !diagram.broad && (!partId || diagram.part === partId)).flatMap((diagram) => {
    const labels = labelsOf(diagram);
    return thingsOf(diagram).things.map((thing) => ({
      diagram: diagram.id, thing: thingWords(diagram.kind, thing, labels),
      ...(thing.node ? { node: thing.node } : { edge: [thing.from!, thing.to!], ...(thing.label ? { name: thing.label } : {}) }),
      ...codeOf(thing.code),
      ...(thing.code?.filled === 'decision' ? { filledIn: 'the code of its decision' } : {}),
    }));
  });
  // Each link that leaves the part (each link of the change with no part), with its code, so the checker reads whether that line makes the one part use the other.
  const links = linkThings(inCells.links).filter((thing) => !partId || thing.from === partId).map((thing) => ({
    link: linkWords(thing, change.file.parts), edge: [thing.from!, thing.to!], ...(thing.label ? { name: thing.label } : {}), ...codeOf(thing.code),
  }));
  return { title: change.file.title, parts, ranges, diagrams, things, links };
}
