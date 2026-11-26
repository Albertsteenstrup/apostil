// The drawings of the processes of a map, made from its data when the map is read: the map never stores their Mermaid text.
// Three levels: the processes of a place, joined by their handoffs; one process, its top steps in a box for each file; a step that holds steps, opened.

import type { Note } from './change-file';
import { escapeLabel } from './diagram-graph';
import { holdsLine, parentsOf, parseKey, stepKey, type MapProcesses, type Process } from './processes';

/** Lines of one file: what a step stands for, so that the marks at those lines roll up to it. */
export interface Span {
  file: string;
  from: number;
  to: number;
}

/** One line of a file: where a call out of the repo, or an arrow, starts. */
export interface LineOf {
  file: string;
  line: number;
}

/** One node of a drawn process: what the pointer shows and where a click goes. */
export interface ProcessNode {
  kind: 'step' | 'call'; // a step or a process, or a call out of the repo
  files: string[]; // the file of a step; the files of a process; none for a call out of the repo
  at?: Span[]; // the lines of a step; the lines of the top steps of a process
  calls?: LineOf[]; // a call out of the repo: the lines that call it
  line?: number; // a step with no inner steps: a click opens its file at this line
  down?: string; // the diagram one level down: a step that holds steps, or a process
  note?: { title: string; text: string; where: string }; // what the pointer shows: the note of a step, or the summary of a process
  quiet?: true; // a step or a process of another place, or a call out of the repo
  steps?: number; // a step that holds steps: the count of its inner steps; a process: the count of its steps
  process?: true; // a process in the drawing of a place, not a step
  names?: string[]; // a call out of the repo: the names that the code calls it by
  callers?: { title: string; file: string; line?: number }[]; // a box that three or more boxes call: who calls it, and where
}

/** The drawing of a long chain in columns: its Mermaid text, the boxes of each column, and the boxes that a box calls with a dot in place of an arrow. */
export interface ColumnDrawing {
  mermaid: string;
  columns: string[][];
  dots: Record<string, string[]>;
}

/** A drawn process, a step of it, or the processes of a place: a flow chart like any diagram of the map. */
export interface ProcessDiagram {
  id: string;
  title: string;
  mermaid: string;
  nodes: Record<string, ProcessNode>;
  edgeLines?: Record<string, LineOf[]>; // by "<from>><to>": the lines where an arrow starts, so that a mark at such a line stands on the arrow
  order?: Record<string, number>; // by "<from>><to>": the place of an arrow among the calls of its box, when the box has two or more
  dots?: Record<string, string[]>; // a box: the boxes that it calls with a quiet dot in place of an arrow, because three or more boxes call them
  columns?: ColumnDrawing; // a long chain: the same drawing in columns
}

/** The lines of a note, when its marks can roll up to it: a note in a cell of a notebook has none. */
const spanOf = (note: Note): Span[] => (note.cell === undefined ? [{ file: note.file, from: note.lines[0], to: note.lines[1] }] : []);

/** The ids of the drawings. They hold ":", which no id of a written diagram has, so they never meet one. */
export const processDiagramId = (process: string): string => `process:${process}`;
export const placeDiagramId = (diagram: string, node: string): string => `processes:${diagram}/${node}`;

const stepsWord = (count: number): string => (count === 1 ? '1 step' : `${count} steps`);
const baseName = (path: string): string => path.split('/').pop() ?? path;
const label = (title: string, inner = 0): string => `"${escapeLabel(title)}${inner ? `<br><i class='ns'>${stepsWord(inner)}</i>` : ''}"`;
// A box of another place and a call out of the repo are quiet: dashed, with quiet words (look.css), as the files in no part of a change are.
const QUIET = 'classDef elsewhere stroke-width:1.4px,stroke-dasharray:6 4';

/** The notes of a map by their keys. */
const notesByKey = (map: MapProcesses): Map<string, Note> => new Map((map.fileNotes ?? []).map((note) => [stepKey(note), note]));

/** The words of a step that the pointer shows: its note, and where it is. */
function stepWords(note: Note): ProcessNode['note'] {
  // The name of the file, not its path, so that the lines stay in view in the title bar of the window; the box of the file has the path.
  const where = `${baseName(note.file)}${note.cell !== undefined ? ` · cell ${note.cell}` : ''} · ${note.lines[0] === note.lines[1] ? `line ${note.lines[0]}` : `lines ${note.lines[0]}-${note.lines[1]}`}`;
  return { title: note.title, text: note.text ?? '', where };
}

/** The steps of a process that the map still has a note for, once each, in the order of the list. */
const liveSteps = (process: Process, notes: { has: (key: string) => boolean }): string[] => [...new Set(process.steps)].filter((key) => notes.has(key));

/**
 * The outer step of each step as the drawings and the text show it: the step that holds its lines, else the step that calls it from another file.
 * A step with no outer step by lines, that an arrow (not a branch) reaches from a line inside an earlier step of another file, goes under the smallest
 * step that holds that line; with several such arrows, under the first of those steps in the list; never under a step inside itself.
 */
export function parentsWithCalls(process: Process, steps: string[]): Map<string, string | undefined> {
  const parent = parentsOf(steps);
  const place = (key: string): number => steps.indexOf(key);
  const size = (key: string): number => { const lines = parseKey(key)!; return lines.to - lines.from; };
  const inside = (key: string, outer: string): boolean => {
    for (let at: string | undefined = key; at !== undefined; at = parent.get(at)) if (at === outer) return true;
    return false;
  };
  for (const key of steps.filter((one) => parent.get(one) === undefined)) {
    const callers = (process.arrows ?? []).filter((arrow) => arrow.to === key && arrow.kind !== 'branch').flatMap((arrow) => {
      const from = parseKey(arrow.from);
      if (!from || from.file === parseKey(key)?.file) return [];
      const holders = steps.filter((other) => holdsLine(other, { file: from.file, cell: from.cell, line: arrow.fromLine }));
      if (!holders.some((other) => place(other) < place(key))) return [];
      const smallest = holders.reduce((one, other) => (size(other) < size(one) ? other : one));
      return inside(smallest, key) ? [] : [smallest];
    });
    parent.set(key, callers.sort((one, other) => place(one) - place(other))[0]);
  }
  return parent;
}

/** The files of the steps of a process, in the order of the list. */
const filesOf = (process: Process): string[] => [...new Set(process.steps.map((key) => parseKey(key)?.file).filter((file): file is string => !!file))];

/** One arrow of a drawing. `line` is the first line where a call starts (none for the order of a list or a branch); `number` its place among the calls of its box. */
interface Link {
  from: string;
  to: string;
  label?: string;
  branch: boolean;
  line?: number;
  number?: number;
}

/** Collects the arrows of one drawing once for each pair of nodes; an arrow with a label wins over the plain order of the list. Keeps the line where each arrow starts. */
function edgeList() {
  const edges = new Map<string, Omit<Link, 'line' | 'number'>>();
  const starts: Record<string, LineOf[]> = {};
  return {
    add(from: string, to: string, text?: string, branch = false, start?: LineOf): void {
      const key = `${from}>${to}`;
      if (from !== to && start) (starts[key] ??= []).push(start);
      if (from === to || (edges.has(key) && (edges.get(key)!.label || !text))) return;
      edges.set(key, { from, to, ...(text ? { label: text } : {}), branch });
    },
    all: (): Link[] => [...edges].map(([key, edge]) => ({ ...edge, ...(starts[key] ? { line: Math.min(...starts[key].map((one) => one.line)) } : {}) })),
    starts: (): Record<string, LineOf[]> | undefined => (Object.keys(starts).length ? starts : undefined),
  };
}

/** The Mermaid line of an arrow; a numbered arrow has its quiet number before its words. */
const arrowLine = ({ from, to, label: text, branch, number }: Link): string => {
  const words = [number ? `<span class='eo'>${number}</span>` : '', text ? escapeLabel(text) : ''].filter(Boolean).join(' ');
  return `  ${from} ${branch ? '-.->' : '-->'}${words ? `|"${words}"|` : ''} ${to}`;
};

/** Three or more boxes with an arrow to one box: it stands once, with one arrow. */
const SHARED = 3;

/**
 * The arrows that leave a box at lines of its code, in the order of those lines; a box with two or more of them numbers them.
 * A box that SHARED or more boxes call keeps the arrow of its first caller (with the count in its words); the other callers get a dot.
 */
function arrowPlan(all: Link[]): { links: Link[]; dots: Record<string, string[]>; callers: Record<string, Link[]> } {
  const links = [...all];
  const calls = new Map<string, number[]>(); // a box: the places in `links` of its arrows that call at a line
  links.forEach((link, at) => { if (link.line !== undefined) calls.set(link.from, [...(calls.get(link.from) ?? []), at]); });
  for (const places of calls.values()) {
    const sorted = places.map((at) => links[at]).sort((one, other) => one.line! - other.line!);
    places.forEach((at, index) => { links[at] = sorted[index]; });
    if (sorted.length > 1) sorted.forEach((link, index) => { link.number = index + 1; });
  }
  const called = new Map<string, Link[]>();
  for (const link of links) if (link.line !== undefined && !link.branch) called.set(link.to, [...(called.get(link.to) ?? []), link]);
  const dots: Record<string, string[]> = {};
  const callers: Record<string, Link[]> = {};
  const gone = new Set<Link>();
  for (const [to, by] of called) {
    if (by.length < SHARED) continue;
    callers[to] = by;
    for (const link of by.slice(1)) { gone.add(link); (dots[link.from] ??= []).push(to); }
    by[0].label = `${by[0].label ? `${by[0].label} · ` : ''}${stepsWord(by.length)}`;
  }
  return { links: links.filter((link) => !gone.has(link)), dots, callers };
}

/** The most boxes on one way along the arrows (a branch back is no way forward). */
function longestChain(ids: string[], links: Link[]): number {
  const next = new Map<string, string[]>();
  for (const link of links) if (!link.branch) next.set(link.from, [...(next.get(link.from) ?? []), link.to]);
  const best = new Map<string, number>();
  const walk = (id: string, way: Set<string>): number => {
    if (way.has(id)) return 0; // a call that goes round
    if (!best.has(id)) {
      way.add(id);
      best.set(id, 1 + Math.max(0, ...(next.get(id) ?? []).map((to) => walk(to, way))));
      way.delete(id);
    }
    return best.get(id)!;
  };
  return Math.max(0, ...ids.map((id) => walk(id, new Set())));
}

/** A chain longer than LONG boxes is laid out in columns of at most COLUMN boxes. */
const LONG = 14;
const COLUMN = 12;

/** The sizes of the columns for a count of boxes: as few columns as fit, as equal as can be ("15" is 8 and 7). */
export function columnSizes(count: number): number[] {
  const columns = Math.max(1, Math.ceil(count / COLUMN));
  return Array.from({ length: columns }, (_, index) => Math.floor(count / columns) + (index < count % columns ? 1 : 0));
}

/**
 * The drawing of an opened step in columns, when its chain is long: each column is a box of its own that runs from top to bottom, the columns run from
 * left to right, and Mermaid draws no arrow between the boxes of two columns (it would lay the columns out as one row). So an arrow from a box of one column
 * to a box of another is a dot at the box that calls, as a box with many callers has; the arrow from the end of a column to the start of the next is drawn
 * by the page. A quiet box stands in the column of the first box that has an arrow with it.
 */
function columnLayout(steps: string[], decl: Record<string, string>, quiet: string[], plan: ReturnType<typeof arrowPlan>): ColumnDrawing | undefined {
  const sizes = columnSizes(steps.length);
  if (sizes.length < 2 || longestChain(steps, plan.links) <= LONG) return undefined;
  const column = new Map<string, number>();
  let at = 0;
  sizes.forEach((size, index) => steps.slice(at, (at += size)).forEach((id) => column.set(id, index)));
  for (const id of Object.keys(decl).filter((one) => !column.has(one))) {
    const link = plan.links.find((one) => (one.from === id && column.has(one.to)) || (one.to === id && column.has(one.from)));
    column.set(id, column.get(link ? (link.from === id ? link.to : link.from) : steps[0])!);
  }
  const order = new Set(steps.slice(1).map((id, index) => `${steps[index]}>${id}`)); // the arrows of the order of the list
  const dots = Object.fromEntries(Object.entries(plan.dots).map(([id, to]) => [id, [...to]]));
  const inside: Link[] = [];
  for (const link of plan.links) {
    if (column.get(link.from) === column.get(link.to)) inside.push(link);
    else if (!order.has(`${link.from}>${link.to}`)) (dots[link.from] ??= []).push(link.to);
  }
  const columns = sizes.map((_, index) => Object.keys(decl).filter((id) => column.get(id) === index));
  const lines = ['flowchart LR'];
  columns.forEach((ids, index) => lines.push(`  subgraph col${index}[" "]`, '    direction TB', ...ids.map((id) => `    ${decl[id]}`), '  end'));
  lines.push(...inside.map(arrowLine), ...columns.slice(1).map((_, index) => `  col${index} --> col${index + 1}`));
  lines.push(...columns.map((_, index) => `  style col${index} fill:none,stroke:none`));
  if (quiet.length) lines.push(`  ${QUIET}`, `  class ${quiet.join(',')} elsewhere`);
  return { mermaid: lines.join('\n'), columns, dots };
}

/** The line in the file of a step where an arrow or a call starts; none in a notebook. */
const startOf = (key: string, line: number): LineOf | undefined => {
  const place = parseKey(key);
  return place && place.cell === undefined ? { file: place.file, line } : undefined;
};

/**
 * The steps of a process as its drawings show them, nested by parentsWithCalls. A level of one box that holds steps costs no click: it shows what that
 * box holds, again while that is one such box. Such a step has no drawing of its own: the drawing takes the id of its last level.
 */
function drawnLevels(process: Process, steps: string[]) {
  const parent = parentsWithCalls(process, steps);
  const kids = (key: string | undefined): string[] => steps.filter((one) => parent.get(one) === key);
  const levelsUnder = (box: string | undefined): (string | undefined)[] => {
    const levels = [box];
    for (let shown = kids(box); shown.length === 1 && kids(shown[0]).length > 0; shown = kids(shown[0])) levels.push(shown[0]);
    return levels;
  };
  const topLevels = levelsUnder(undefined);
  const number = new Map(process.steps.map((key, index): [string, number] => [key, index]).reverse()); // the first place of a key in the list
  const own = processDiagramId(process.id);
  const nodeOf = (key: string): string => `s${number.get(key)}`;
  // The drawing that shows what a step holds; the drawing of the process for none.
  const drawingOf = (key: string | undefined): string => {
    const level = levelsUnder(key).at(-1);
    return topLevels.includes(level) ? own : `${own}/${number.get(level!)}`;
  };
  // The step of a drawing that a step lies in: itself, or its outer step just under the level of the drawing; undefined when it lies outside it.
  const liftTo = (key: string, level: string | undefined): string | undefined => {
    let at: string | undefined = key;
    while (at !== undefined && parent.get(at) !== level) at = parent.get(at);
    return at;
  };
  return { parent, kids, levelsUnder, topLevels, number, nodeOf, drawingOf, liftTo };
}

/**
 * Where Home shows each step of a process: the drawing and the node of its box, or of the box that holds it when its level costs no click, and the node
 * of the top drawing that holds it. A step of a top level that costs no click has the drawing of the process and no node. `notes`: the keys of the
 * notes of the map; a step whose note is gone has no place, as it has no box.
 */
export function stepPlaces(process: Process, notes: Set<string>): Map<string, { drawing: string; node?: string; top?: string }> {
  const steps = liveSteps(process, notes);
  const { parent, levelsUnder, topLevels, nodeOf, drawingOf, liftTo } = drawnLevels(process, steps);
  const boxOf = (key: string): string | undefined => {
    let at: string | undefined = key;
    while (at !== undefined && levelsUnder(parent.get(at)).includes(at)) at = parent.get(at);
    return at;
  };
  return new Map(steps.map((key) => {
    const box = boxOf(key);
    const top = liftTo(key, topLevels.at(-1));
    return [key, { drawing: drawingOf(box && parent.get(box)), ...(box ? { node: nodeOf(box) } : {}), ...(top ? { top: nodeOf(top) } : {}) }];
  }));
}

/**
 * The drawings of one process: the process itself (its top steps, in one box for each file, with the arrows of the writer and its calls out of the repo),
 * and one for each step that holds steps (its inner steps and the steps that it calls in other files, in the order of the list, with the branch arrows).
 * A level of one box that holds steps shows what that box holds (drawnLevels). A step whose note is gone is left out.
 */
export function processDrawings(map: MapProcesses, process: Process): ProcessDiagram[] {
  const notes = notesByKey(map);
  const list = liveSteps(process, notes);
  const byLines = parentsOf(list);
  const { parent, kids, levelsUnder, number, nodeOf, drawingOf, liftTo } = drawnLevels(process, list);
  const inner = (key: string): number => kids(key).reduce((sum, kid) => sum + 1 + inner(kid), 0);
  const calledUnder = (key: string, box: string): boolean => {
    for (let at = key; at !== box; at = parent.get(at)!) if (byLines.get(at) === undefined) return true;
    return false;
  };
  const spansOf = (key: string): Span[] => {
    const own = spanOf(notes.get(key)!);
    const elsewhere = (span: Span): boolean => !own.some((one) => one.file === span.file && one.from <= span.from && span.to <= one.to);
    return [...own, ...kids(key).flatMap(spansOf).filter(elsewhere)];
  };
  const drawings: ProcessDiagram[] = [];

  const draw = (box: string | undefined): void => {
    const levels = levelsUnder(box);
    const level = levels.at(-1);
    const shown = kids(level);
    // A process runs from left to right, so the boxes of its files stack in a column and a process with many files still fits a wide tab;
    // an opened step, and a process of one box that holds steps, runs from top to bottom, in the order of its list.
    const lines = [level ? 'flowchart TB' : 'flowchart LR'];
    const nodes: Record<string, ProcessNode> = {};
    const quiet: string[] = [];
    const edges = edgeList();
    const decl: Record<string, string> = {}; // the Mermaid line of each box, for the drawing in columns
    const stepLine = (key: string, quietBox = false): string => {
      const note = notes.get(key)!;
      const count = inner(key);
      const id = quietBox ? `x${number.get(key)}` : nodeOf(key);
      nodes[id] = { kind: 'step', files: [note.file], at: spansOf(key), note: stepWords(note), ...(count ? { down: drawingOf(key), steps: count } : note.cell === undefined ? { line: note.lines[0] } : {}), ...(quietBox ? { quiet: true as const } : {}) };
      if (quietBox) quiet.push(id);
      return (decl[id] = `${id}[${label(quietBox ? `${baseName(note.file)}: ${note.title}` : note.title, count)}]`);
    };
    if (level) shown.forEach((key) => lines.push(`  ${stepLine(key)}`));
    else {
      filesOf({ ...process, steps: shown }).forEach((file, at) => {
        lines.push(`  subgraph f${at}[${label(file)}]`, ...shown.filter((key) => parseKey(key)!.file === file).map((key) => `    ${stepLine(key)}`), '  end');
      });
      // Inside one function the steps follow the order of the list; two steps at the top are joined only by an arrow with its lines.
    }
    if (level) shown.slice(1).forEach((key, at) => edges.add(nodeOf(shown[at]), nodeOf(key)));
    for (const arrow of process.arrows ?? []) {
      if (!notes.has(arrow.from) || !notes.has(arrow.to)) continue;
      const from = liftTo(arrow.from, level);
      const lifted = liftTo(arrow.to, level);
      // A box that holds a step only because it calls it does not take the calls of other boxes to that step: they go to a quiet box of the step.
      const to = from && lifted && lifted !== from && arrow.kind !== 'branch' && calledUnder(arrow.to, lifted) ? undefined : lifted;
      const start = arrow.kind === 'branch' ? undefined : startOf(arrow.from, arrow.fromLine);
      if (from && to) edges.add(nodeOf(from), nodeOf(to), arrow.label, arrow.kind === 'branch', start);
      else if ((from || to) && arrow.kind !== 'branch') {
        // One end lies outside the opened step: a quiet box for the step at the other end, unless that step holds the drawing.
        const away = from ? arrow.to : arrow.from;
        if (levels.includes(away)) continue;
        const box = `x${number.get(away)}`;
        if (!nodes[box]) lines.push(`  ${stepLine(away, true)}`);
        if (from) edges.add(nodeOf(from), box, arrow.label, false, start);
        else edges.add(box, nodeOf(to!), arrow.label, false, start);
      }
    }
    // One quiet round box for each library or program that the steps call.
    const targets = [...new Set((process.outside ?? []).map((call) => call.to))];
    for (const call of process.outside ?? []) {
      const from = notes.has(call.from) ? liftTo(call.from, level) : undefined;
      if (!from) continue;
      const box = `o${targets.indexOf(call.to)}`;
      if (!nodes[box]) {
        const names = [...new Set((process.outside ?? []).filter((one) => one.to === call.to).map((one) => one.name))];
        nodes[box] = { kind: 'call', files: [], calls: [], quiet: true, note: { title: call.to, text: `Called as ${names.join(', ')}.`, where: 'out of the repo' }, names };
        quiet.push(box);
        lines.push(`  ${(decl[box] = `${box}([${label(call.to)}])`)}`);
      }
      const start = startOf(call.from, call.fromLine);
      if (start) nodes[box].calls!.push(start);
      edges.add(nodeOf(from), box, call.label, false, start);
    }
    const plan = arrowPlan(edges.all());
    lines.push(...plan.links.map(arrowLine));
    if (quiet.length) lines.push(`  ${QUIET}`, `  class ${quiet.join(',')} elsewhere`);
    for (const [to, by] of Object.entries(plan.callers)) {
      nodes[to].callers = by.map((link) => ({ title: nodes[link.from].note?.title ?? link.from, file: nodes[link.from].files[0], ...(link.line ? { line: link.line } : {}) }));
    }
    const order = Object.fromEntries(plan.links.filter((link) => link.number).map((link) => [`${link.from}>${link.to}`, link.number!]));
    const columns = level ? columnLayout(shown.map(nodeOf), decl, quiet, plan) : undefined;
    const title = box ? `${baseName(notes.get(level!)!.file)}: ${notes.get(level!)!.title}` : process.title;
    const starts = edges.starts();
    drawings.push({
      id: drawingOf(box), title, mermaid: lines.join('\n'), nodes, ...(starts ? { edgeLines: starts } : {}),
      ...(Object.keys(order).length ? { order } : {}), ...(Object.keys(plan.dots).length ? { dots: plan.dots } : {}), ...(columns ? { columns } : {}),
    });
    shown.filter((key) => inner(key) > 0).forEach(draw);
  };
  if (list.length) draw(undefined);
  return drawings;
}

/** The drawings of every process of a map. */
export const allProcessDrawings = (map: MapProcesses): ProcessDiagram[] => (map.processes ?? []).flatMap((process) => processDrawings(map, process));

/** The processes whose first step lies in one of these paths (a folder ends with "/"). */
export function processesStartingIn(map: MapProcesses, paths: string[]): Process[] {
  return (map.processes ?? []).filter((process) => {
    const first = parseKey(process.steps[0])?.file;
    return !!first && paths.some((path) => path === first || (path.endsWith('/') && first.startsWith(path)));
  });
}

/** The node of a process in the drawing of a place: its title and its count of steps; the pointer shows its summary. */
function processNode(map: MapProcesses, process: Process, quiet: boolean): ProcessNode {
  const notes = notesByKey(map);
  const live = liveSteps(process, notes);
  const parent = parentsOf(live);
  // Its top steps hold all its lines.
  const at = live.filter((key) => parent.get(key) === undefined).flatMap((key) => spanOf(notes.get(key)!));
  return { kind: 'step', files: filesOf(process), at, down: processDiagramId(process.id), note: { title: process.title, text: process.summary, where: stepsWord(live.length) }, steps: live.length, process: true, ...(quiet ? { quiet: true as const } : {}) };
}

/** The processes of a place: one node for each, joined by their handoffs; a process of another place that hands to or from them is a quiet box. */
export function placeDrawing(map: MapProcesses, id: string, title: string, here: Process[]): ProcessDiagram {
  const all = map.processes ?? [];
  const nodeOf = (process: string): string => `q${all.findIndex((one) => one.id === process)}`;
  const ids = new Set(here.map((process) => process.id));
  const notes = notesByKey(map);
  const lines = ['flowchart LR'];
  const nodes: Record<string, ProcessNode> = {};
  const quiet: string[] = [];
  const edges = edgeList();
  const add = (process: Process, quietBox: boolean): void => {
    if (nodes[nodeOf(process.id)]) return;
    nodes[nodeOf(process.id)] = processNode(map, process, quietBox);
    lines.push(`  ${nodeOf(process.id)}[${label(process.title, liveSteps(process, notes).length)}]`);
    if (quietBox) quiet.push(nodeOf(process.id));
  };
  here.forEach((process) => add(process, false));
  for (const handoff of map.handoffs ?? []) {
    const [from, to] = [all.find((one) => one.id === handoff.from), all.find((one) => one.id === handoff.to)];
    if (!from || !to || (!ids.has(from.id) && !ids.has(to.id))) continue;
    add(from, !ids.has(from.id));
    add(to, !ids.has(to.id));
    edges.add(nodeOf(from.id), nodeOf(to.id), handoff.label);
  }
  lines.push(...edges.all().map(arrowLine));
  if (quiet.length) lines.push(`  ${QUIET}`, `  class ${quiet.join(',')} elsewhere`);
  return { id, title, mermaid: lines.join('\n'), nodes };
}

/** The processes that have a step in a path (a folder ends with "/"), each drawn at its top with the steps of that path lit. For the graphs page. */
export function processesWithStepsIn(map: MapProcesses, path: string): { drawing: ProcessDiagram; lit: string[] }[] {
  const inPath = (file = ''): boolean => file === path || (path.endsWith('/') && file.startsWith(path));
  return (map.processes ?? []).filter((process) => process.steps.some((key) => inPath(parseKey(key)?.file))).flatMap((process) => {
    const [drawing] = processDrawings(map, process);
    if (!drawing) return [];
    // A top step holds the lines of the steps under it, also of the steps that it calls in other files.
    const lit = Object.entries(drawing.nodes).filter(([node, one]) => node.startsWith('s') && [one.files[0], ...(one.at ?? []).map((span) => span.file)].some(inPath)).map(([node]) => node);
    return [{ drawing, lit }];
  });
}
