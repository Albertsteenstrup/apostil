// The tool's own checks: a change file against the facts from Git and the code.
// The save runs them, and the view runs them again when the branch moved.

import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { ChangeFile, Diagram, Note } from './change-file';
import { beforeProblems } from './diagram-change';
import { inNoThingWords, labelsOf, linesInNoThing, type LinesInNoThing, linkThings, linkWords, thingsOf, thingWords, upper, type FileChange, type Place } from './diagram-code';
import { diagramGraph, nodeIdProblems } from './diagram-graph';
import { addedLines, diffLines, removedLines, toRanges } from './diff-lines';
import { changedFiles, fileDiff, fileText, lineCount, rawFileText, type ChangedFile } from './git';
import { cellsAt, inCellText, isNotebookPath, readNotebook, type CellsOf } from './notebook';
import type { CheckResult } from './store';

/** True when a path is a generated file: an entry names the path itself, or a folder that ends with "/". */
export const isGenerated = (path: string, generated: string[] = []): boolean =>
  generated.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry));

/** Says what is wrong with a path of a node: it must exist, and a folder must end with "/". Undefined when it is right. */
export function pathProblem(folder: string, path: string): string | undefined {
  let stat;
  try {
    stat = lstatSync(join(folder, path)); // a link is one path, also when it points at a folder
  } catch {
    return `The path ${path} does not exist.`;
  }
  return !path.endsWith('/') && stat.isDirectory() ? `The path ${path} is a folder and must end with "/".` : undefined;
}

type FileCheck = Pick<CheckResult, 'filesInNoPart' | 'filesInTwoParts' | 'filesNotChanged' | 'generated' | 'renamedFiles'>;

/** The file check: each changed file sits in exactly one part, or is generated. A part may name a renamed file by its new path only. */
export function checkFiles(file: ChangeFile, changed: string[], renames: { from: string; to: string }[] = []): FileCheck {
  const partsOf = new Map<string, number>();
  for (const path of file.parts.flatMap((part) => part.files)) partsOf.set(path, (partsOf.get(path) ?? 0) + 1);
  const inNoPart = changed.filter((path) => !partsOf.has(path));
  const renamed = renames.filter((rename) => partsOf.has(rename.from) && !changed.includes(rename.from))
    .map(({ from, to }) => ({ from, to, problem: `The file ${from} was renamed to ${to}. Name ${to} in the part.` }));
  return {
    filesInNoPart: inNoPart.filter((path) => !isGenerated(path, file.generated)),
    filesInTwoParts: [...partsOf].filter(([, count]) => count > 1).map(([path]) => path),
    filesNotChanged: [...partsOf.keys()].filter((path) => !changed.includes(path)),
    generated: inNoPart.filter((path) => isGenerated(path, file.generated)),
    ...(renamed.length ? { renamedFiles: renamed } : {}),
  };
}

/** Line numbers as ranges in words: [3, 4, 5, 9] gives "3-5, 9". */
export function rangesText(lines: number[]): string {
  const ranges: [number, number][] = [];
  for (const line of lines) {
    const last = ranges[ranges.length - 1];
    if (last && line === last[1] + 1) last[1] = line;
    else ranges.push([line, line]);
  }
  return ranges.map(([first, last]) => (first === last ? `${first}` : `${first}-${last}`)).join(', ');
}

/** The old line numbers that the change removed from a file, or undefined when the file did not exist at the base. */
function removedLinesOf(folder: string, base: string, path: string, changed: ChangedFile[]): { length: number; removed: number[] } | undefined {
  const entry = changed.find((candidate) => candidate.path === path);
  const old = entry?.status === 'added' ? undefined : fileText(folder, entry?.renamedFrom ?? path, base);
  if (old === undefined) return undefined;
  const length = lineCount(old);
  const all = Array.from({ length }, (_, at) => at + 1);
  if (!entry) return { length, removed: [] };
  const deleted = entry.status === 'removed' || lineCount(fileText(folder, path) ?? '') === 0;
  const diff = deleted ? '' : fileDiff(folder, base, path, undefined, entry.renamedFrom);
  return { length, removed: deleted ? all : diffLines(diff).filter((line) => line.sign === '-').map((line) => line.line) };
}

/** Says why the lines of a note on removed lines are wrong, or undefined when both ends are removed lines. */
function removedProblem(path: string, [first, last]: [number, number], facts: ReturnType<typeof removedLinesOf>): string | undefined {
  if (!facts) return `The file ${path} did not exist before the change, so it has no removed lines.`;
  if (last > facts.length) return `Line ${last} is after the end of ${path} as it was before the change, which had ${facts.length} lines.`;
  const bad = [first, last].find((line) => !facts.removed.includes(line));
  if (bad === undefined) return undefined;
  const near = [...facts.removed].sort((a, b) => Math.abs(a - first) - Math.abs(b - first)).slice(0, 12).sort((a, b) => a - b);
  const where = near.length ? `The change removed these lines of ${path} near there: ${rangesText(near)}.` : `The change removed no lines of ${path}.`;
  return `Line ${bad} of ${path} is not a line that the change removed. Lines of a removed note count in the file as it was before the change. ${where}`;
}

/** Says why a whole file is no place: it exists now, or at the base for a file that the change removed. */
function wholeFileProblem(folder: string, base: string, path: string): string | undefined {
  return fileText(folder, path) !== undefined || fileText(folder, path, base) !== undefined ? undefined : `The file ${path} does not exist, now or before the change.`;
}

/** What the change did to the lines of one file: `changed` are the changed files of the change. A file that the change does not touch has no added or removed lines. */
export function fileChange(folder: string, base: string, path: string, changed: ChangedFile[]): FileChange {
  const entry = changed.find((candidate) => candidate.path === path);
  const length = lineCount(fileText(folder, path) ?? '');
  const totals = { added: entry?.added ?? 0, removed: entry?.removed ?? 0 };
  if (!entry || entry.binary) return { length, added: [], removed: [], totals };
  if (entry.status === 'added') return { length, added: length ? [[1, length]] : [], removed: [], totals };
  if (entry.status === 'removed') {
    const old = (fileText(folder, path, base) ?? '').replace(/\n$/, '').split('\n');
    return { length: 0, added: [], removed: old.map((text, at) => ({ at: 1, line: at + 1, text })), totals };
  }
  const diff = fileDiff(folder, base, path, undefined, entry.renamedFrom);
  return { length, added: toRanges(addedLines(diff)), removed: removedLines(diff), totals };
}

/**
 * The hints of the other direction, for the writer: the changed lines of the code that a diagram covers that are in no node and no arrow.
 * The save does not fail for them.
 */
export function inNoThingHints(folder: string, base: string, file: ChangeFile, changed: ChangedFile[] = changedFiles(folder, base)): string[] {
  return (file.diagrams ?? []).filter((diagram) => !diagram.broad && diagram.covers && diagram.file).flatMap((diagram) => {
    const lines = linesInNoThingOf(folder, base, diagram, changed);
    return lines.added.length + lines.removed.length ? [`Diagram "${diagram.id}": ${inNoThingWords(diagram.kind, lines)}: ${inNoThingPlaces(diagram.file!, lines)}. A line that does something is in a node or an arrow; leave it out only when the diagram has no place for it.`] : [];
  });
}

/** The lines of linesInNoThing for a diagram, from Git. */
export function linesInNoThingOf(folder: string, base: string, diagram: Diagram, changed: ChangedFile[]): LinesInNoThing {
  if (!diagram.covers || !diagram.file) return { added: [], removed: [] };
  const { added, removed } = fileChange(folder, base, diagram.file, changed);
  const text = (fileText(folder, diagram.file) ?? '').split('\n');
  return linesInNoThing(diagram, thingsOf(diagram).things, (line) => added.some(([first, last]) => first <= line && line <= last), text, removed);
}

/** The lines in no node in words: "src/app.py, lines 6-7, removed lines 3 (counted in the file as it was)". */
export const inNoThingPlaces = (file: string, lines: LinesInNoThing): string =>
  [file, ...(lines.added.length ? [`lines ${rangesText(lines.added)}`] : []), ...(lines.removed.length ? [`removed lines ${rangesText(lines.removed)} (counted in the file as it was)`] : [])].join(', ');

/**
 * Where the cells of a notebook stand, as it is now or at the base (for removed lines; a renamed file under its old path).
 * Undefined for a file that is no notebook or does not read as one.
 */
export function cellsIn(folder: string, base: string, changed: ChangedFile[] = []): CellsOf {
  const known = new Map<string, ReturnType<CellsOf>>();
  return (path, removed) => {
    const key = `${removed}:${path}`;
    if (!known.has(key)) {
      const old = changed.find((candidate) => candidate.path === path)?.renamedFrom ?? path;
      const raw = isNotebookPath(path) ? rawFileText(folder, removed ? old : path, removed ? base : undefined) : undefined;
      const cells = raw === undefined ? undefined : readNotebook(raw);
      known.set(key, cells && cellsAt(cells));
    }
    return known.get(key);
  };
}

/** The line check: each note, each node and arrow of a diagram and each link points at lines that exist, and each path of a node exists. */
export function checkLines(folder: string, file: ChangeFile, base: string, changed: ChangedFile[]): CheckResult['badNotes'] {
  const lengths = new Map<string, number | undefined>();
  const problemOf = (path: string, last: number): string | undefined => {
    if (!lengths.has(path)) {
      const text = fileText(folder, path);
      lengths.set(path, text === undefined ? undefined : lineCount(text));
    }
    const length = lengths.get(path);
    const renamedTo = changed.find((candidate) => candidate.renamedFrom === path)?.path;
    if (length === undefined) return renamedTo ? `The file ${path} was renamed to ${renamedTo}. Point at ${renamedTo}.` : `The file ${path} does not exist.`;
    return last > length ? `Line ${last} is after the end of ${path}, which has ${length} lines.` : undefined;
  };
  const removedFacts = new Map<string, ReturnType<typeof removedLinesOf>>();
  const removedProblemOf = (note: Pick<Note, 'file' | 'lines' | 'inCell'>): string | undefined => {
    const renamedTo = changed.find((candidate) => candidate.renamedFrom === note.file)?.path;
    if (renamedTo) return `The file ${note.file} was renamed to ${renamedTo}. Point the note at ${renamedTo}.`;
    if (!removedFacts.has(note.file)) removedFacts.set(note.file, removedLinesOf(folder, base, note.file, changed));
    const facts = removedFacts.get(note.file);
    if (!note.inCell) return removedProblem(note.file, note.lines, facts);
    // Lines in a cell: the removed lines of that cell, counted inside it.
    const { at, length, lines, words } = note.inCell;
    return removedProblem(`${words} of ${note.file}`, lines, facts && { length, removed: facts.removed.filter((line) => at < line && line <= at + length).map((line) => line - at) });
  };
  // A place of a node, an arrow or a link: its file exists, its lines are inside it, and removed lines are lines that the change removed.
  const placeProblem = (place: Place): string | undefined => (!place.lines ? wholeFileProblem(folder, base, place.file)
    : place.removed ? removedProblemOf({ file: place.file, lines: place.lines, inCell: place.inCell }) : problemOf(place.file, place.lines[1]));

  const bad: CheckResult['badNotes'] = [];
  for (const part of file.parts) {
    for (const note of part.notes ?? []) {
      const problem = note.removed ? removedProblemOf(note) : problemOf(note.file, note.lines[1]);
      if (problem) bad.push({ part: part.id, title: note.title, problem });
    }
  }
  for (const diagram of file.diagrams ?? []) {
    const add = (problem: string): void => void bad.push({ part: diagram.part ?? '', title: diagram.title, problem });
    const drawn = Object.keys(diagramGraph(diagram).nodes);
    [...nodeIdProblems(diagram), ...beforeProblems(diagram)].forEach(add);
    for (const node of Object.keys(diagram.nodePaths ?? {})) if (!drawn.includes(node)) add(`Node "${node}": it is no node of the diagram.`);
    const { things, stray } = thingsOf(diagram);
    const labels = labelsOf(diagram);
    for (const what of stray) add(`${what}: it is no ${what.startsWith('Node') ? 'node' : 'arrow'} of the diagram, now or in "before".`);
    // Each place that the writer gave: a filled-in way out of a decision has the places of that decision, which are checked there.
    for (const thing of things.filter((one) => one.code && !one.code.filled)) {
      for (const problem of thing.code!.places.map(placeProblem).filter(Boolean)) add(`${upper(thingWords(diagram.kind, thing, labels))}: ${problem}`);
    }
    for (const [node, paths] of Object.entries(diagram.nodePaths ?? {})) {
      for (const problem of paths.map((path) => pathProblem(folder, path)).filter(Boolean)) {
        bad.push({ part: diagram.part ?? '', title: diagram.title, problem: `Node "${node}": ${problem}` });
      }
    }
  }
  for (const thing of linkThings(file.links ?? [])) {
    const what = upper(linkWords(thing, file.parts));
    for (const problem of (thing.code?.places ?? []).map(placeProblem).filter(Boolean)) bad.push({ part: thing.from!, title: what, problem: `${what}: ${problem}` });
  }
  return bad;
}

/** Both checks of a change file with the right shape. A place in a cell of a notebook is checked against that cell (shared/notebook.ts). */
export function checkChangeFile(folder: string, base: string, file: ChangeFile, changed = changedFiles(folder, base)): CheckResult {
  const renames = changed.flatMap((entry) => (entry.renamedFrom ? [{ from: entry.renamedFrom, to: entry.path }] : []));
  const inCells = inCellText(file, cellsIn(folder, base, changed));
  return { ...checkFiles(file, changed.map((entry) => entry.path), renames), badNotes: [...inCells.problems, ...checkLines(folder, inCells.file, base, changed)] };
}
