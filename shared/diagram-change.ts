// What a change did to a diagram of a part: its new, changed and removed nodes, arrows, messages and transitions, and the colour of each.
// Two sources: the text of the diagram before the change ("before"), and the added and removed lines inside the code lines of each node and arrow.

import type { Diagram } from './change-file';
import { diagramGraph, flowGraph, kindOfText, thingLines, type DiagramGraph } from './diagram-graph';
import { columnTotals } from './schema';

export type ThingChange = 'new' | 'changed' | 'removed';

/** The colour of a thing on the page: green (add), red (del), both, a green border (changed: known from "before" alone), or a red dashed border (removed). */
export type Paint = 'add' | 'del' | 'both' | 'changed' | 'removed';

/** The code lines of a node or an arrow: how many there are, how many of them the change added, and how many removed lines stood there. */
export interface LineCounts {
  lines: number;
  added: number;
  removed: number;
}

/** An arrow, message or transition as the page draws it: the ones of now, and the removed ones put back where they were. */
export interface DrawnEdge {
  from: string;
  to: string;
  label?: string;
  key: string; // the key of the thing (shared/diagram-code.ts): "edge:<n>", or "gone:<n>" for a removed one
  change?: ThingChange;
  paint?: Paint;
  counts?: { added: number; removed: number }; // its diff, when its code lines have one
}

export interface DiagramChange {
  nodes: Record<string, ThingChange>; // the nodes, participants and states that the change touched, by id; the removed ones too
  paint: Record<string, Paint>; // the colour of each of them
  counts: Record<string, { added: number; removed: number }>; // a node whose code has a diff, a removed one too: its added and removed lines
  edges: DrawnEdge[]; // in the order that the drawing writes them
  words: { text: string; tone: 'p' | 'm' | '' }[][]; // the total beside the title, in groups: [["+2 steps", "−1 step"], ["1 changed"]]
}

/**
 * What the page knows from the code of each thing: its counts by the key of the thing (shared/diagram-code.ts: a node id, "edge:<n>", "gone:<n>"),
 * and whether the file of the diagram is new.
 */
export interface LineFacts {
  counts?: Record<string, LineCounts>;
  fileIsNew?: boolean; // the change added the whole file: each step of a flow chart of it is new
}

/** The colour of a thing: from its added and removed lines when it has some, else from what "before" says. */
export function paintOf(change: ThingChange | undefined, counts?: { added: number; removed: number }): Paint | undefined {
  if (change === 'removed') return 'removed';
  if (counts && (counts.added || counts.removed)) return counts.added && counts.removed ? 'both' : counts.added ? 'add' : 'del';
  return change === 'new' ? 'add' : change;
}

/** The change of a thing from its code lines: new when each line is added and no removed line stood there, changed when it has a diff. */
const changeOfLines = (count: LineCounts): ThingChange | undefined =>
  (count.lines > 0 && count.added === count.lines && !count.removed ? 'new' : count.added || count.removed ? 'changed' : undefined);

export const START_OR_END = /^root_(start|end)$/; // the start and end states "[*]": no thing of their own
const key = (edge: { from: string; to: string; label?: string }): string => `${edge.from}\u0000${edge.to}\u0000${edge.label ?? ''}`;
/** A count with a comma for thousands: "12,345". */
export const number = (value: number): string => value.toLocaleString('en-US');
const plural = (count: number, word: string): string => `${number(count)} ${word}${count === 1 ? '' : 's'}`;

/** Both graphs and how their edges match: `match[j]` is the edge before that edge j of now is, or -1 for a new one. */
export function compareEdges(diagram: Pick<Diagram, 'kind' | 'mermaid' | 'before'>): { now: DiagramGraph; before?: DiagramGraph; match: number[]; removedEdges: number[] } {
  const now = diagramGraph(diagram);
  if (!diagram.before) return { now, match: now.edges.map(() => -1), removedEdges: [] };
  const before = diagramGraph({ kind: diagram.kind, mermaid: diagram.before });
  const used = new Set<number>();
  const match = now.edges.map((edge) => {
    const at = before.edges.findIndex((old, index) => !used.has(index) && key(old) === key(edge));
    if (at >= 0) used.add(at);
    return at;
  });
  return { now, before, match, removedEdges: before.edges.map((_, index) => index).filter((index) => !used.has(index)) };
}

/** For a sequence: the edge of now that each removed message comes after, or -1 for the start. It is the message before it that is still there. */
function anchors(match: number[], removedEdges: number[]): number[] {
  return removedEdges.map((removed) => {
    let best = -1;
    match.forEach((old, index) => { if (old >= 0 && old < removed && (best < 0 || old > match[best])) best = index; });
    return best;
  });
}

/**
 * What the change did to a diagram, or undefined when nothing says so: no `before` and no counts, or nothing changed.
 * From `before`: a node is new, changed (the same id, another label) or removed; an edge is new or removed (the same ends and label is the same edge).
 * From the counts: a node or an arrow is new when each of its lines is added and no removed line stood there, changed when it has an added or removed line. New wins.
 * A flow chart of a file that the change added is new in each step.
 */
export function diagramChange(diagram: Pick<Diagram, 'kind' | 'mermaid' | 'before'>, facts: LineFacts = {}): DiagramChange | undefined {
  const { now, before, match, removedEdges } = compareEdges(diagram);
  const counted = facts.counts ?? {};
  const diffOf = (count?: LineCounts) => (count && (count.added || count.removed) ? { added: count.added, removed: count.removed } : undefined);
  const nodes: Record<string, ThingChange> = {};
  const things = Object.keys(now.nodes).filter((id) => !START_OR_END.test(id));
  if (before) {
    for (const id of things) {
      if (!(id in before.nodes)) nodes[id] = 'new';
      else if (before.nodes[id] !== now.nodes[id]) nodes[id] = 'changed';
    }
  } else if (facts.fileIsNew && diagram.kind === 'flow') {
    for (const id of things) nodes[id] = 'new';
  }
  const counts: DiagramChange['counts'] = {};
  for (const id of things) {
    const fromLines = counted[id] && changeOfLines(counted[id]);
    if (fromLines && nodes[id] !== 'new') nodes[id] = fromLines;
  }
  const removedNodes = before ? Object.keys(before.nodes).filter((id) => !START_OR_END.test(id) && !(id in now.nodes)) : [];
  for (const id of removedNodes) nodes[id] = 'removed';
  for (const id of [...things, ...removedNodes]) {
    const diff = diffOf(counted[id]);
    if (diff) counts[id] = diff;
  }
  const paint: DiagramChange['paint'] = {};
  for (const [id, change] of Object.entries(nodes)) paint[id] = paintOf(change, counts[id])!;

  const nowEdges: DrawnEdge[] = now.edges.map((edge, index) => {
    const count = counted[`edge:${index}`];
    const fromLines = count && changeOfLines(count);
    const change = before && match[index] < 0 ? 'new' : fromLines;
    const diff = diffOf(count);
    return { ...edge, key: `edge:${index}`, ...(change ? { change, paint: paintOf(change, diff) } : {}), ...(diff ? { counts: diff } : {}) };
  });
  const gone: DrawnEdge[] = removedEdges.map((index) => {
    const diff = diffOf(counted[`gone:${index}`]);
    return { ...before!.edges[index], key: `gone:${index}`, change: 'removed' as const, paint: 'removed' as const, ...(diff ? { counts: diff } : {}) };
  });
  let edges: DrawnEdge[] = [...nowEdges, ...gone];
  if (diagram.kind === 'sequence') {
    const after = anchors(match, removedEdges);
    edges = [...gone.filter((_, index) => after[index] < 0), ...nowEdges.flatMap((edge, at) => [edge, ...gone.filter((_, index) => after[index] === at)])];
  }

  const columns = diagram.kind === 'schema' ? columnTotals(diagram) : undefined; // a column is no thing of its own: "before" alone says what changed in it
  if (!Object.keys(nodes).length && !edges.some((edge) => edge.change) && !(columns && (columns.new || columns.removed || columns.changed))) return undefined;
  return { nodes, paint, counts, edges, words: totalWords(diagram.kind, nodes, edges, columns) };
}

/** The total in words that fit the kind: steps for a flow chart, messages for a sequence, states and transitions for a state diagram, tables, relations and columns for a schema. */
function totalWords(kind: Diagram['kind'], nodes: Record<string, ThingChange>, edges: DrawnEdge[], columns?: Record<ThingChange, number>): DiagramChange['words'] {
  const count = (change: ThingChange): number => Object.values(nodes).filter((one) => one === change).length;
  const edgeCount = (change: ThingChange): number => edges.filter((edge) => edge.change === change).length;
  const pair = (added: number, removed: number, word: string): DiagramChange['words'][number] => [
    ...(added ? [{ text: `+${plural(added, word)}`, tone: 'p' as const }] : []),
    ...(removed ? [{ text: `−${plural(removed, word)}`, tone: 'm' as const }] : []),
  ];
  const groups = kind === 'flow' ? [pair(count('new'), count('removed'), 'step')]
    : kind === 'sequence' ? [pair(edgeCount('new'), edgeCount('removed'), 'message'), pair(count('new'), count('removed'), 'participant')]
    : kind === 'schema' ? [pair(count('new'), count('removed'), 'table'), pair(edgeCount('new'), edgeCount('removed'), 'relation'), pair(columns?.new ?? 0, columns?.removed ?? 0, 'column')]
    : [pair(count('new'), count('removed'), 'state'), pair(edgeCount('new'), edgeCount('removed'), 'transition')];
  const changed = count('changed') + edgeCount('changed') + (columns?.changed ?? 0);
  if (changed) groups.push([{ text: `${changed} changed`, tone: '' }]);
  return groups.filter((group) => group.length);
}

/** What is wrong with the text before of a diagram, in words that a writer can act on. Empty when it is right or missing. */
export function beforeProblems(diagram: Pick<Diagram, 'kind' | 'mermaid' | 'before'>): string[] {
  if (diagram.before === undefined) return [];
  const kind = kindOfText(diagram.before);
  const words = { flow: 'a flow chart', sequence: 'a sequence diagram', state: 'a state diagram', schema: 'an entity-relationship diagram ("erDiagram")' };
  if (kind !== diagram.kind) return [`"before" must be the Mermaid text of the same diagram before the change: ${words[diagram.kind] ?? 'a diagram of the same kind'}${kind ? `, not ${words[kind]}` : ''}.`];
  const now = Object.keys(diagramGraph(diagram).nodes).filter((id) => !START_OR_END.test(id));
  const before = Object.keys(diagramGraph({ kind: diagram.kind, mermaid: diagram.before }).nodes);
  if (now.length && before.length && !now.some((id) => before.includes(id))) {
    const thing = diagram.kind === 'schema' ? 'table' : 'step';
    return [`No node of "before" has the id of a node of the diagram now, so every ${thing} looks new and every old ${thing} looks removed. Keep the id of each ${thing} that is still there. Code that is all new gets no "before".`];
  }
  return [];
}

/** A sequence message without its activation mark ("->>+S"), so that a message put back does not open or close a bar on its own. */
const withoutActivation = (line: string): string => line.replace(/(-{1,2}(?:>>|>|x|\)))\s*[+-]/, '$1');

/**
 * The Mermaid text to draw with the removed things put back, as near to where they were as can be done, as single lines only (never a block).
 * `text` is the text of now as the page draws it. Undefined when nothing was removed. Whether it draws is for the page to find out.
 */
export function withRemoved(diagram: Pick<Diagram, 'kind' | 'mermaid' | 'before'>, change: DiagramChange | undefined, text: string): string | undefined {
  if (!diagram.before || !change || diagram.kind === 'schema') return undefined; // the page draws a schema with its removed things itself (shared/schema.ts)
  const removedNodes = Object.keys(change.nodes).filter((id) => change.nodes[id] === 'removed');
  const { removedEdges, match } = compareEdges(diagram);
  if (!removedNodes.length && !removedEdges.length) return undefined;
  const beforeLines = diagram.before.split('\n');
  if (diagram.kind === 'flow') {
    const shapes = flowGraph(diagram.before).nodes;
    const edges = diagramGraph({ kind: 'flow', mermaid: diagram.before }).edges;
    const label = (text?: string): string => (text ? `|"${text.replace(/"/g, '#quot;')}"|` : '');
    return [text.trimEnd(), ...removedNodes.map((id) => `  ${id}${shapes.get(id) ?? ''}`),
      ...removedEdges.map((index) => `  ${edges[index].from} -.->${label(edges[index].label)} ${edges[index].to}`)].join('\n');
  }
  const old = thingLines({ kind: diagram.kind, mermaid: diagram.before });
  const oldEdges = old.filter((line) => 'from' in line);
  const nodeLines = old.filter((line) => 'node' in line && removedNodes.includes(line.node)).map((line) => `  ${beforeLines[line.at].trim()}`);
  const edgeLines = removedEdges.map((index) => `  ${withoutActivation(beforeLines[oldEdges[index].at].trim())}`);
  if (diagram.kind === 'state') return [text.trimEnd(), ...nodeLines, ...edgeLines].join('\n');
  // A sequence: a removed participant after the participants of now, a removed message after the message before it that is still there.
  const lines = text.trimEnd().split('\n');
  const things = thingLines({ kind: 'sequence', mermaid: text });
  const messages = things.filter((line) => 'from' in line);
  const lastParticipant = Math.max(0, ...things.filter((line) => 'node' in line).map((line) => line.at));
  const after = anchors(match, removedEdges);
  const insert = new Map<number, string[]>(); // after which line of the text
  const put = (at: number, line: string): void => { insert.set(at, [...(insert.get(at) ?? []), line]); };
  nodeLines.forEach((line) => put(lastParticipant, line));
  edgeLines.forEach((line, index) => put(after[index] >= 0 ? messages[after[index]].at : messages.length ? messages[0].at - 1 : lines.length - 1, line));
  return lines.flatMap((line, at) => [line, ...(insert.get(at) ?? [])]).join('\n');
}
