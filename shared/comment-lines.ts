// What a comment says to the agent about its thing, beyond the thing itself: the whole diagram as text, the drawings that the map makes when it is read,
// and what a comment kept of its thing when the map or the change was written again. `shared/context.ts` puts these lines into `aboutTarget`.

import type { Diagram } from './change-file';
import { thingsOf, type Place, type ThingCode } from './diagram-code';
import { diagramGraph } from './diagram-graph';
import { allProcessDrawings, placeDrawing, processesStartingIn, type ProcessDiagram } from './process-diagrams';
import type { RepoMap } from './repo-map';
import type { Kept, RemarkTarget, StoredChange } from './store';

export const MAX_DRAWN_LINES = 80; // the lines of a drawing as text: one for each box and each arrow

const linesWords = (lines?: [number, number]): string => (!lines ? '' : lines[0] === lines[1] ? ` line ${lines[0]}` : ` lines ${lines[0]}-${lines[1]}`);
const placeText = (place: Place): string => `${place.file}${place.lines ? `:${place.lines[0] === place.lines[1] ? place.lines[0] : `${place.lines[0]}-${place.lines[1]}`}` : ''}`;
/** The first two places of the code of a thing, as "<file>:<lines>". */
export const codeText = (code?: ThingCode): string => (code?.places ?? []).slice(0, 2).map(placeText).join(', ');

/** A drawing of the map by its id: a written diagram, or a drawn process, which the map makes from its data when it is read (it is never stored). */
export function mapDrawing(map: RepoMap | undefined, id?: string): { diagram: Diagram; process?: ProcessDiagram } | undefined {
  if (!map || !id) return undefined;
  const written = map.diagrams.find((diagram) => diagram.id === id);
  if (written) return { diagram: written };
  let drawn = allProcessDrawings(map).find((one) => one.id === id);
  const place = /^processes:([^/]+)\/(.+)$/.exec(id); // the processes of one node of a diagram
  if (!drawn && place) {
    const owner = map.diagrams.find((diagram) => diagram.id === place[1]);
    const starting = processesStartingIn(map, owner?.nodePaths?.[place[2]] ?? []);
    if (owner && starting.length > 1) drawn = placeDrawing(map, id, `Processes of ${diagramGraph(owner).nodes[place[2]] ?? place[2]}`, starting);
  }
  return drawn && { diagram: { id: drawn.id, kind: 'flow', title: drawn.title, mermaid: drawn.mermaid }, process: drawn };
}

/** Where a box of a drawn process stands in the code: its first lines, and how many more there are. */
const spansText = (node: ProcessDiagram['nodes'][string]): string => {
  const spans = (node.at ?? []).map((span) => `${span.file}:${span.from === span.to ? span.from : `${span.from}-${span.to}`}`);
  return spans.length > 2 ? `${spans.slice(0, 2).join(', ')} and ${spans.length - 2} more` : spans.join(', ') || (node.kind === 'call' ? 'out of the repo' : '');
};

/** Where each box of a drawn process stands in the code, by its id: for a writer that draws a change on the drawing. */
export const drawingPlaces = (process: ProcessDiagram): Record<string, string> =>
  Object.fromEntries(Object.entries(process.nodes).map(([id, node]) => [id, spansText(node)]));

/** The diagram as text for the agent: one line for each box (its title, file and lines) and one for each arrow, at most `max` lines, then one line for those left out. */
export function diagramText(diagram: Diagram, process?: ProcessDiagram, max = MAX_DRAWN_LINES): string[] {
  const graph = diagramGraph(diagram);
  const things = thingsOf(diagram).things.filter((thing) => !thing.removed);
  const name = (id: string): string => process?.nodes[id]?.note?.title ?? graph.nodes[id] ?? id;
  const boxes = Object.keys(graph.nodes).map((id) => {
    const where = process?.nodes[id] ? spansText(process.nodes[id]) : codeText(things.find((thing) => thing.key === id)?.code) || (diagram.nodePaths?.[id] ?? []).slice(0, 2).join(', ');
    return `- ${name(id)}${where ? ` (${where})` : ''}`;
  });
  const arrows = graph.edges.map((edge) => {
    const start = process?.edgeLines?.[`${edge.from}>${edge.to}`]?.[0];
    const where = start ? `${start.file}:${start.line}` : codeText(things.find((thing) => thing.from === edge.from && thing.to === edge.to && (thing.label ?? '') === (edge.label ?? ''))?.code);
    return `- ${name(edge.from)} → ${name(edge.to)}${edge.label ? `: ${edge.label}` : ''}${where ? ` (${where})` : ''}`;
  });
  const all = [...boxes, ...arrows];
  return [...all.slice(0, max), ...(all.length > max ? [`(${all.length - max} more lines left out)`] : [])];
}

/** The first place of the code of a thing, as the fields of what a comment keeps. */
const firstPlace = (code?: ThingCode): Pick<Kept, 'file' | 'lines'> => {
  const place = code?.places.find((one) => !one.removed);
  return place ? { file: place.file, ...(place.lines ? { lines: place.lines } : {}) } : {};
};

/** What a diagram (or a drawn process) holds now for a node, an arrow or the whole diagram: its title, its diagram and its first place in the code. Undefined when it is not there. */
export function keptInDrawing(diagram: Diagram | undefined, process: ProcessDiagram | undefined, target: RemarkTarget): Kept | undefined {
  if (!diagram) return undefined;
  const graph = diagramGraph(diagram);
  const things = thingsOf(diagram).things.filter((thing) => !thing.removed);
  const name = (id: string): string => process?.nodes[id]?.note?.title ?? graph.nodes[id] ?? id;
  if (target.kind === 'diagram') return { title: diagram.title };
  if (target.kind === 'node') {
    if (!target.node || !(target.node in graph.nodes)) return undefined;
    const span = process?.nodes[target.node]?.at?.[0];
    return { title: name(target.node), diagram: diagram.title, ...(span ? { file: span.file, lines: [span.from, span.to] as [number, number] } : firstPlace(things.find((thing) => thing.key === target.node)?.code)) };
  }
  const [from, to] = target.edge ?? ['', ''];
  const edge = graph.edges.find((one) => one.from === from && one.to === to && (target.name === undefined || (one.label ?? '') === target.name));
  if (!edge) return undefined;
  const start = process?.edgeLines?.[`${from}>${to}`]?.[0];
  const code = things.find((thing) => thing.from === from && thing.to === to && (thing.label ?? '') === (edge.label ?? ''))?.code;
  return { title: `${name(from)} → ${name(to)}${edge.label ? `: ${edge.label}` : ''}`, diagram: diagram.title, ...(start ? { file: start.file, lines: [start.line, start.line] as [number, number] } : firstPlace(code)) };
}

/** What the map holds now for the thing of a target on the map. */
export function keptOnMap(map: RepoMap | undefined, target: RemarkTarget): Kept | undefined {
  const drawn = mapDrawing(map, target.diagram);
  return keptInDrawing(drawn?.diagram, drawn?.process, target);
}

/**
 * What the change file holds now for the thing of a target, for the kinds that name their thing by an id or a title: a part, a note, a diagram,
 * a node and an arrow. Code lines, a file, a test and the rest hold their file and lines in the target itself.
 */
export function keptInChange(change: StoredChange, target: RemarkTarget): Kept | undefined {
  const { parts, links } = change.file;
  const part = (id?: string) => parts.find((one) => one.id === id);
  if (target.kind === 'part') return part(target.part) && { title: part(target.part)!.name };
  if (target.kind === 'note') {
    const note = parts.flatMap((one) => one.notes ?? []).find((one) => one.file === target.file && one.lines[0] === target.lines?.[0] && !one.removed === !target.removed);
    return note && { title: note.title, file: note.file, lines: note.lines };
  }
  if (target.diagram) return keptInDrawing((change.file.diagrams ?? []).find((one) => one.id === target.diagram), undefined, target);
  if (target.kind === 'diagram') return { title: change.file.title };
  if (target.kind === 'node') return part(target.node) && { title: part(target.node)!.name };
  if (target.kind === 'edge') {
    const link = links.find((one) => one.from === target.edge?.[0] && one.to === target.edge?.[1] && (target.name === undefined || (one.label ?? '') === target.name));
    return link && { title: `${part(link.from)?.name ?? link.from} → ${part(link.to)?.name ?? link.to}${link.label ? `: ${link.label}` : ''}` };
  }
  return undefined;
}

/** The target with what it is about kept in it, when it can be read now. */
export const withKept = (target: RemarkTarget, kept: Kept | undefined): RemarkTarget => (kept ? { ...target, kept } : target);

/**
 * The line for the agent when the thing is gone or names another thing than when the comment was made: what the comment kept, in one line.
 * `where` is "map" or "change file". Nothing when the comment kept nothing, or the thing is as it was.
 */
export function keptLines(target: RemarkTarget, now: Kept | undefined, where: string): string[] {
  const { kept } = target;
  if (!kept || now?.title === kept.title) return [];
  const was = [`"${kept.title}"`, kept.diagram && `in the diagram "${kept.diagram}"`, kept.file && `at ${kept.file}${linesWords(kept.lines)}`].filter(Boolean).join(', ');
  return [`The ${where} was written again since this comment. The comment was put on ${was}.`];
}
