// The code of each node and arrow of a diagram of a part, and of each link between the parts of a change: its places, or one reason for having none.
// Every other part of Apostil gets the code of a thing from thingsOf and linkThings, never from "nodeLines", "edgeLines" and the "lines" of a link themselves.

import type { Code, Diagram, Lines, Link, Part, PlaceText, Reason } from './change-file';
import { compareEdges, number, START_OR_END } from './diagram-change';
import { diagramGraph, flowGraph } from './diagram-graph';
import type { CellName, InCell } from './notebook';

/** A place of a thing: a file with lines, lines that the change removed (counted in the file as it was), or a whole file. */
export interface Place {
  file: string;
  lines?: Lines;
  removed?: true;
  cell?: CellName; // in a notebook: the cell as the writer named it
  inCell?: InCell; // where it stands in its cell, once its lines are lines of the text of the cells (shared/notebook.ts)
}

/** The code of a thing: its places, or a reason and no places. `filled` says that the tool filled it in: an arrow with no text, or a way out of a decision. */
export interface ThingCode {
  places: Place[];
  reason?: Reason;
  filled?: 'order' | 'decision';
}

/**
 * A node or an arrow of a diagram, also one that the change removed (it is in "before" only).
 * `key` names it the same way everywhere: the node id; "edge:<n>" for arrow n of the diagram now; "gone:<n>" for arrow n of "before" that is no longer there;
 * "link:<n>" for link n between the parts of a change (its ends are part ids).
 * `code` is missing when the thing has no places and no reason, after the fill-in.
 */
export interface Thing {
  key: string;
  node?: string;
  from?: string;
  to?: string;
  label?: string;
  name: string; // the label of a node, or of an arrow ("" when it has none)
  removed?: true;
  code?: ThingCode;
}

export const REASON_WORDS: Record<Reason, string> = { outside: 'Outside the repo.', order: 'Only the order.', 'no-line': 'No line of its own.' };

/** True for a range alone, [first, last], as against a place written out or a list of places. */
export const isRange = (value: unknown): value is Lines => Array.isArray(value) && typeof value[0] === 'number';

/** The code as written, as places or a reason. A range alone, and a place with no file, are in the file of the diagram. */
export function readCode(code: Code, file = ''): ThingCode {
  if (typeof code === 'string') return { places: [], reason: code };
  const written = isRange(code) ? [code] : Array.isArray(code) ? code : [code];
  return {
    places: written.map((place): Place => {
      if (isRange(place)) return { file, lines: place };
      const { file: path, lines, removed, cell, inCell } = place as PlaceText;
      return { file: path ?? file, ...(lines ? { lines } : {}), ...(removed ? { removed: true as const } : {}), ...(cell !== undefined ? { cell } : {}), ...(inCell ? { inCell } : {}) };
    }),
  };
}

/** True when an entry of "edgeLines" names this arrow: the same two ends, and the same label when it gives one. "[*]" is the start or the end marker of a state diagram. */
const namesEdge = (entry: { from: string; to: string; label?: string }, edge: { from: string; to: string; label?: string }): boolean =>
  (entry.from === '[*]' ? 'root_start' : entry.from) === edge.from && (entry.to === '[*]' ? 'root_end' : entry.to) === edge.to
  && (entry.label === undefined || entry.label.trim() === (edge.label ?? ''));

/** The nodes and arrows of a diagram, now and removed, each with its code; `stray` names the written entries that are no thing of the diagram. */
export function thingsOf(diagram: Pick<Diagram, 'kind' | 'mermaid' | 'before' | 'file' | 'nodeLines' | 'edgeLines'>): { things: Thing[]; stray: string[] } {
  const { now, before, removedEdges } = compareEdges(diagram);
  const written = diagram.nodeLines ?? {};
  const entries = diagram.edgeLines ?? [];
  const used = new Set<number>();
  const entryFor = (edge: { from: string; to: string; label?: string }) => {
    const at = entries.findIndex((entry, index) => !used.has(index) && namesEdge(entry, edge));
    if (at >= 0) used.add(at);
    return entries[at];
  };
  const code = (value: Code | undefined): ThingCode | undefined => (value === undefined ? undefined : readCode(value, diagram.file));

  const removedNodes = before ? Object.keys(before.nodes).filter((id) => !(id in now.nodes)) : [];
  const nodes: Thing[] = [
    ...Object.keys(now.nodes).map((id) => ({ key: id, node: id, name: now.nodes[id] })),
    ...removedNodes.map((id) => ({ key: id, node: id, name: before!.nodes[id], removed: true as const })),
  ].filter((thing) => !START_OR_END.test(thing.key)).map((thing) => ({ ...thing, ...(written[thing.key] !== undefined ? { code: code(written[thing.key]) } : {}) }));

  // A flow chart: an arrow with no text only says what comes next, and a way out of a decision (a diamond) has the code of that decision.
  const shapes = diagram.kind === 'flow' ? new Map([...(before ? flowGraph(diagram.before!).nodes : []), ...flowGraph(diagram.mermaid).nodes]) : new Map<string, string>();
  const filled = (edge: { from: string; label?: string }): ThingCode | undefined => {
    if (diagram.kind !== 'flow') return undefined;
    if (!edge.label) return { places: [], reason: 'order', filled: 'order' };
    const decision = (shapes.get(edge.from) ?? '').trim().startsWith('{') && nodes.find((thing) => thing.key === edge.from)?.code;
    return decision ? { ...decision, filled: 'decision' } : undefined;
  };
  const edge = (one: { from: string; to: string; label?: string }, key: string, removed: boolean): Thing => {
    const entry = entryFor(one);
    const written = entry && code(entry.lines);
    // "removed": true beside the lines of an arrow marks each of its places, as it does inside a place.
    const found = written && entry.removed ? { ...written, places: written.places.map((place) => ({ ...place, removed: true as const })) } : written ?? filled(one);
    return { key, from: one.from, to: one.to, ...(one.label ? { label: one.label } : {}), name: one.label ?? '', ...(removed ? { removed: true as const } : {}), ...(found ? { code: found } : {}) };
  };
  const edges = [
    ...now.edges.map((one, index) => edge(one, `edge:${index}`, false)),
    ...removedEdges.map((index) => edge(before!.edges[index], `gone:${index}`, true)),
  ];
  const known = new Set(nodes.map((thing) => thing.key));
  const stray = [
    ...Object.keys(written).filter((id) => !known.has(id)).map((id) => `Node "${id}"`),
    ...entries.filter((_, index) => !used.has(index)).map((entry) => `Arrow "${entry.from} → ${entry.to}${entry.label ? `: ${entry.label}` : ''}"`),
  ];
  return { things: [...nodes, ...edges], stray };
}

const WORDS = {
  flow: { node: 'step', edge: 'arrow' },
  sequence: { node: 'participant', edge: 'message' },
  state: { node: 'state', edge: 'transition' },
  schema: { node: 'table', edge: 'relation' },
};

/** The thing in words that a writer can act on: the step "Fee is zero?", the arrow "Fee is zero?" → "Charge" ("yes"), the removed message "send". */
/** The label of each node of a diagram by its id, of now and of "before". */
export const labelsOf = (diagram: Pick<Diagram, 'kind' | 'mermaid' | 'before'>): Record<string, string> =>
  ({ ...(diagram.before ? diagramGraph({ kind: diagram.kind, mermaid: diagram.before }).nodes : {}), ...diagramGraph(diagram).nodes });

export function thingWords(kind: Diagram['kind'], thing: Thing, labels: Record<string, string> = {}): string {
  const word = WORDS[kind] ?? WORDS.flow;
  const gone = thing.removed ? 'removed ' : '';
  if (thing.node) return `the ${gone}${word.node} "${thing.name}"`;
  const ends = `"${labels[thing.from!] ?? thing.from}" → "${labels[thing.to!] ?? thing.to}"`;
  if (kind === 'flow') return `the ${gone}arrow ${ends}${thing.label ? ` ("${thing.label}")` : ''}`;
  return `the ${gone}${word.edge}${thing.label ? ` "${thing.label}"` : ''} from ${ends.replace(' → ', ' to ')}`;
}

export const upper = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * What the rule asks of a diagram of a part, in words that a writer can act on: each node and arrow has places or a reason,
 * after the fill-in, and a removed thing has removed lines. Empty when the diagram follows the rule. A wider diagram is left alone.
 */
export function missingCode(diagram: Diagram): string[] {
  if (diagram.broad) return [];
  const { things } = thingsOf(diagram);
  const labels = labelsOf(diagram);
  const where = `Diagram "${diagram.id}"`;
  return things.flatMap((thing) => {
    const what = upper(thingWords(diagram.kind, thing, labels));
    const reasons = thing.node ? 'outside, no-line' : 'outside, order, no-line';
    if (!thing.code) {
      const give = thing.removed ? 'Give its removed lines ({ "lines": [first, last], "removed": true }, counted in the file as it was)' : 'Give its lines';
      return [`${where}: ${what} has no code. ${give}, or a reason: ${reasons}.`];
    }
    // A removed way out of a decision that still stands has the lines of that decision, which the tool filled in: they are lines of now.
    // A removed table or relation has the lines of now that drop it, in a migration.
    if (thing.removed && !thing.code.filled && diagram.kind !== 'schema' && thing.code.places.some((place) => !place.removed && place.lines)) {
      return [`${where}: ${what} is no longer in the diagram, so its lines are lines that the change removed. Mark them "removed": true, counted in the file as it was.`];
    }
    return [];
  });
}

// ----- the links between the parts of a change -----

/** The links of a change as things, each with its code: "link:<n>" for link n. A place of a link always names its file; nothing is filled in. */
export const linkThings = (links: Link[]): Thing[] => links.map((link, at) => ({
  key: `link:${at}`, from: link.from, to: link.to, ...(link.label ? { label: link.label } : {}), name: link.label ?? '',
  ...(link.lines !== undefined ? { code: readCode(link.lines) } : {}),
}));

/** A link in words that a writer can act on: the link "Reminders → Overdue fees: uses feeOf". */
export function linkWords(link: { from?: string; to?: string; label?: string }, parts: Pick<Part, 'id' | 'name'>[]): string {
  const name = (id = '') => parts.find((part) => part.id === id)?.name ?? id;
  return `the link "${name(link.from)} → ${name(link.to)}${link.label ? `: ${link.label}` : ''}"`;
}

/** What the rule asks of the links of a change: each has places or a reason. Empty when every link follows it. */
export function missingLinkCode(file: { parts: Pick<Part, 'id' | 'name'>[]; links?: Link[] }): string[] {
  return linkThings(file.links ?? []).filter((thing) => !thing.code)
    .map((thing) => `${upper(linkWords(thing, file.parts))} has no code. Give the line of the call or the import, or a reason: outside, order, no-line.`);
}

/** The mark of `apostil checked links` for the links that leave a part. */
export const linksMark = (part: string): string => `links:${part}`;

/** True when a second agent read every link of the change against its code for this save: each part that a link leaves has its mark. */
export const linksChecked = (links: Link[], checked: string[]): boolean => links.length > 0 && links.every((link) => checked.includes(linksMark(link.from)));

/** What the change did to the lines of one file: its length now, its added lines now as ranges, its removed lines, and the counts of the whole file. */
export interface FileChange {
  length: number;
  added: Lines[];
  removed: { at: number; line: number; text: string }[]; // `at`: the line now that it stands before; `line`: its number in the file as it was
  totals: { added: number; removed: number };
}

/** The lines of a thing and its diff, by the key of the thing: the sum over its places. */
export type ThingCounts = Record<string, { lines: number; added: number; removed: number }>;

/**
 * The counts of each thing with places: the added lines inside its lines now, and its removed lines. A removed line counts on the removed thing
 * whose removed lines hold it; else on a thing of now whose lines it stands among. A whole file counts all of its lines.
 */
export function thingCounts(things: Thing[], fileChange: (path: string) => FileChange): ThingCounts {
  const claimed = new Set<string>(); // "file:old line" of the removed lines that a removed thing names
  const oldLines = (place: Place) => fileChange(place.file).removed.filter((one) => place.lines![0] <= one.line && one.line <= place.lines![1]);
  for (const thing of things.filter((one) => one.removed)) {
    for (const place of thing.code?.places ?? []) if (place.removed) oldLines(place).forEach((one) => claimed.add(`${place.file}:${one.line}`));
  }
  const counts: ThingCounts = {};
  for (const thing of things) {
    const places = thing.code?.places ?? [];
    if (!places.length || thing.code?.filled) continue; // a way out of a decision: its diff is the diff of the decision, shown there once
    let [lines, added, wholeRemoved] = [0, 0, 0];
    const removed = new Set<string>();
    for (const place of places) {
      const file = fileChange(place.file);
      if (!place.lines) {
        lines += file.length;
        added += file.totals.added;
        wholeRemoved += file.totals.removed;
      } else if (place.removed) {
        oldLines(place).forEach((one) => removed.add(`${place.file}:${one.line}`));
      } else {
        const [first, last] = [place.lines[0], Math.min(place.lines[1], file.length)];
        lines += Math.max(0, last - first + 1);
        added += file.added.reduce((sum, [from, to]) => sum + Math.max(0, Math.min(to, last) - Math.max(from, first) + 1), 0);
        for (const one of file.removed) {
          const id = `${place.file}:${one.line}`;
          if (first <= one.at && one.at <= last && (thing.removed || !claimed.has(id))) removed.add(id);
        }
      }
    }
    counts[thing.key] = { lines, added, removed: removed.size + wholeRemoved };
  }
  return counts;
}

// A line that is empty or only a comment: it says nothing that a step could do. A line that starts a docstring counts as a comment.
const NOT_CODE = /^\s*($|#|\/\/|\/\*|\*(\s|\/|$)|--(\s|$)|<!--|"""|''')/;

/** The changed lines in no node and no arrow: `added` by their line now, `removed` by their line in the file as it was. */
export interface LinesInNoThing { added: number[]; removed: number[] }

/**
 * The changed lines of the code that a diagram covers that are in no node and no arrow: `added` are the added lines of its file now,
 * `text` the lines of that file now, `removed` the removed lines of the file. A removed line counts when it stands in the covered lines, no removed
 * node names it, and no node of now holds the lines it stands among (as thingCounts counts it). Lines that are empty or only a comment do not count.
 * Empty when the diagram says nothing of what it covers.
 */
export function linesInNoThing(diagram: Pick<Diagram, 'covers' | 'file'>, things: Thing[], added: (line: number) => boolean, text: string[], removed: FileChange['removed'] = []): LinesInNoThing {
  const found: LinesInNoThing = { added: [], removed: [] };
  if (!diagram.covers || !diagram.file) return found;
  const places = things.flatMap((thing) => thing.code?.places ?? []).filter((place) => place.file === diagram.file && place.lines);
  const holds = (removedPlaces: boolean, line: number) => places.some((place) => !place.removed === !removedPlaces && place.lines![0] <= line && line <= place.lines![1]);
  for (let line = diagram.covers[0]; line <= Math.min(diagram.covers[1], text.length); line++) {
    if (added(line) && !NOT_CODE.test(text[line - 1] ?? '') && !holds(false, line)) found.added.push(line);
  }
  for (const one of removed) {
    if (diagram.covers[0] <= one.at && one.at <= diagram.covers[1] && !NOT_CODE.test(one.text) && !holds(true, one.line) && !holds(false, one.at)) found.removed.push(one.line);
  }
  return found;
}

/** "1 changed line in no step": the count of linesInNoThing beside the title of a diagram, in the words of its kind. */
export function inNoThingWords(kind: Diagram['kind'], lines: LinesInNoThing): string {
  const count = lines.added.length + lines.removed.length;
  const where = { flow: 'step', sequence: 'message', state: 'state or transition', schema: 'table or relation' }[kind] ?? 'step';
  return `${number(count)} changed line${count === 1 ? '' : 's'} in no ${where}`;
}
