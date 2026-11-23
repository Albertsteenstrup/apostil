// Writes the Mermaid text that the page draws: the diagram of a change, a part's diagram, and a broad diagram with its difference.
// The file names and counts come from Git; the agent gives only the parts, the links and its own diagrams.

import type { Diagram, Link, Part } from './change-file';
import type { PageCode } from './page-data';
import { escapeLabel, flowGraph } from './diagram-graph';
import { number } from './diagram-change';
import type { ChangedFile } from './git';

export { escapeLabel };

/** A part's flow chart stays whole inside the change diagram up to these sizes. Above them the part is lit instead. */
export const WHOLE_LIMIT = { nodes: 15, edges: 20 };

export interface ChangeDiagramInput {
  parts: Part[];
  links: Link[];
  files: ChangedFile[]; // every changed file, from Git
  filesInNoPart: string[]; // from the file check
}

/** What drill up keeps of the part that the owner came from: its diagram whole, or the part lit. */
export interface Focus {
  part: string;
  whole?: string; // the Mermaid text of the part's flow chart
}

// Own node ids, so they never meet the node ids of an agent's diagram.
export const nodeId = (index: number): string => `ap${index}`;
const NO_PART = 'apnone';
// The classes of the drawing: their colours are in view/media/look.css, so that they follow the theme. Mermaid reads no colour of CSS in them.
// "lit": a lit node; in a drawing with this class a lit node has its name in teal (the page lights nodes too). "kept": the part kept whole. "nopart": the files in no part. "gone": a removed node.
const CLASSES = ['lit stroke-width:2px', 'kept stroke-width:1.5px', 'nopart stroke-width:1.4px,stroke-dasharray:6 4', 'gone stroke-width:1.4px,stroke-dasharray:6 4'];
const lit = (ids: string): string[] => [`  class ${ids} lit`];

const baseName = (path: string): string => path.split('/').pop() ?? path;

/** One file line in a node: its name and its added and removed lines. */
function fileLine(path: string, file: ChangedFile | undefined): string {
  const added = file?.added ? ` <i class='p'>+${number(file.added)}</i>` : '';
  const removed = file?.removed ? ` <i class='m'>−${number(file.removed)}</i>` : '';
  return `<span class='f' data-file='${escapeLabel(path)}'>${escapeLabel(baseName(path))}${added}${removed}</span>`;
}

/** The label of a node: a title, the three largest files and "N more files". */
function filesLabel(title: string, titleData: string, paths: string[], counts: Map<string, ChangedFile>, moreData: string): string {
  const size = (path: string): number => (counts.get(path)?.added ?? -1) + (counts.get(path)?.removed ?? 0);
  const largest = [...paths].sort((a, b) => size(b) - size(a));
  const more = largest.length - 3;
  return `<b ${titleData}>${title}</b>${largest.slice(0, 3).map((path) => fileLine(path, counts.get(path))).join('')}`
    + (more > 0 ? `<span class='f more' ${moreData}>${number(more)} more file${more === 1 ? '' : 's'}</span>` : '');
}

/** The diagram of a change: one node for each part, one edge for each link, and one dashed node for the files in no part. */
export function changeMermaid(input: ChangeDiagramInput, focus?: Focus): string {
  const counts = new Map(input.files.map((file) => [file.path, file]));
  const ids = new Map(input.parts.map((part, index) => [part.id, nodeId(index)]));
  const lines = ['flowchart TD'];
  const classes = CLASSES.map((line) => `  classDef ${line}`); // at the end: an arrow to a subgraph after its class would take the class away
  input.parts.forEach((part) => {
    const id = ids.get(part.id)!;
    if (focus?.part === part.id && focus.whole) {
      lines.push(`  subgraph ${id}["${escapeLabel(part.name)}"]`, ...diagramBody(focus.whole).map((line) => `  ${line}`), '  end');
      classes.push(`  class ${id} kept`);
      return;
    }
    const label = filesLabel(escapeLabel(part.name), `data-part='${escapeLabel(part.id)}'`, part.files, counts, `data-more='${escapeLabel(part.id)}'`);
    const sql = part.files.length > 0 && part.files.every((path) => path.endsWith('.sql'));
    lines.push(sql ? `  ${id}[("${label}")]` : `  ${id}["${label}"]`);
    if (focus?.part === part.id) classes.push(...lit(id));
  });
  if (input.filesInNoPart.length > 0) {
    const title = `In no part · ${number(input.filesInNoPart.length)} file${input.filesInNoPart.length === 1 ? '' : 's'}`;
    lines.push(`  ${NO_PART}["${filesLabel(title, "data-nopart='1'", input.filesInNoPart, counts, "data-more='no-part'")}"]`);
    classes.push(`  class ${NO_PART} nopart`);
  }
  const linked = new Set<string>();
  for (const link of input.links) {
    const from = ids.get(link.from);
    const to = ids.get(link.to);
    if (!from || !to) continue;
    lines.push(link.label ? `  ${from} -->|"${escapeLabel(link.label)}"| ${to}` : `  ${from} --> ${to}`);
    linked.add(from).add(to);
  }
  // The nodes with no arrow, but not a part's diagram kept whole: rows of three or four instead of one long row.
  const free = input.parts.filter((part) => !(focus?.part === part.id && focus.whole)).map((part) => ids.get(part.id)!).filter((id) => !linked.has(id));
  if (input.filesInNoPart.length > 0) free.push(NO_PART);
  lines.push(...gridLinks(free), ...classes);
  return lines.join('\n');
}

/**
 * Invisible links that put nodes in rows of three or four: each node is linked to the node under it, so a flow chart from top to bottom
 * gives each row its own rank. Up to four nodes stay in one row.
 */
export function gridLinks(ids: string[]): string[] {
  if (ids.length <= 4) return [];
  const rows = Math.ceil(ids.length / 4);
  const columns = Math.ceil(ids.length / rows);
  return ids.slice(columns).map((id, index) => `  ${ids[index]} ~~~ ${id}`);
}

/** The lines of a diagram without its first line, the one that names the kind. */
function diagramBody(mermaid: string): string[] {
  return mermaid.split('\n').slice(1).filter((line) => line.trim() && !/^\s*direction\b/.test(line));
}

// The reader of a flow chart lives in shared/, because the review context reads diagrams too.
export { flowGraph, type FlowGraph } from './diagram-graph';

/** "whole" when a part's diagram is small enough to stay inside the change diagram, else "lit". */
export function drillUpStyle(diagram: Pick<Diagram, 'kind' | 'mermaid'>): 'whole' | 'lit' {
  if (diagram.kind !== 'flow') return 'lit';
  const graph = flowGraph(diagram.mermaid);
  return graph.nodes.size <= WHOLE_LIMIT.nodes && graph.edges.length <= WHOLE_LIMIT.edges ? 'whole' : 'lit';
}

/** The nodes that a broad diagram adds and removes, compared by node id. */
export function broadDifference(diagram: Pick<Diagram, 'mermaid' | 'before'>): { added: string[]; removed: string[] } {
  if (!diagram.before) return { added: [], removed: [] };
  const now = flowGraph(diagram.mermaid);
  const before = flowGraph(diagram.before);
  return {
    added: [...now.nodes.keys()].filter((id) => !before.nodes.has(id)),
    removed: [...before.nodes.keys()].filter((id) => !now.nodes.has(id)),
  };
}

/** What a change does to a wider diagram: the number of parts it adds and removes. */
export interface BroadTotal {
  added: number;
  removed: number;
}

/** The total diff of a wider diagram, or undefined when the change does not alter it. A diagram that is not a flow chart counts as altered when its text changed. */
export function broadTotal(diagram: Pick<Diagram, 'kind' | 'mermaid' | 'before'>): BroadTotal | undefined {
  if (!diagram.before) return undefined;
  if (diagram.kind !== 'flow') return diagram.before.trim() !== diagram.mermaid.trim() ? { added: 0, removed: 0 } : undefined;
  const { added, removed } = broadDifference(diagram);
  return added.length || removed.length ? { added: added.length, removed: removed.length } : undefined;
}

/** A broad flow chart with its difference painted in: new nodes lit, removed nodes back in with a dashed border. */
export function broadMermaid(diagram: Pick<Diagram, 'kind' | 'mermaid' | 'before'>): string {
  if (diagram.kind !== 'flow' || !diagram.before) return diagram.mermaid;
  const { added, removed } = broadDifference(diagram);
  const now = flowGraph(diagram.mermaid);
  const before = flowGraph(diagram.before);
  const lines = [diagram.mermaid.trimEnd()];
  for (const id of removed) lines.push(`  ${id}${before.nodes.get(id) ?? ''}`);
  const gone = new Set(removed);
  for (const edge of before.edges) if (gone.has(edge.from) || gone.has(edge.to)) lines.push(`  ${edge.from} -.- ${edge.to}`);
  lines.push(...CLASSES.map((line) => `  classDef ${line}`));
  if (added.length) lines.push(...lit(added.join(',')));
  if (removed.length) lines.push(`  class ${removed.join(',')} gone`);
  // The edges that lead to a new node are wider; the page colours them (drawBroad). Mermaid counts edges in the order they are written.
  const newEdges = now.edges.map((edge, index) => (added.includes(edge.to) ? index : -1)).filter((index) => index >= 0);
  if (newEdges.length) lines.push(`  linkStyle ${newEdges.join(',')} stroke-width:2px`);
  return lines.join('\n');
}

/** "+3 −2" as quiet HTML in green and red, the form of the file lines of a part. */
const diffHtml = ({ added, removed }: { added: number; removed: number }): string =>
  [added ? `<i class='p'>+${number(added)}</i>` : '', removed ? `<i class='m'>−${number(removed)}</i>` : ''].filter(Boolean).join(' ');

/** The quiet line under a step with places: its diff when it has one ("+3 −1"), else its lines ("lines 12–20"), its file, or "3 places". Nothing for a reason. */
export function placesLine(code: PageCode): string {
  if (code.counts) return diffHtml(code.counts);
  if (code.places.length > 1) return `${number(code.places.length)} places`;
  const [place] = code.places;
  if (!place) return '';
  if (!place.lines) return escapeLabel(baseName(place.file));
  const [first, last] = place.lines;
  return `${place.removed ? 'removed ' : ''}${first === last ? `line ${first}` : `lines ${first}–${last}`}`; // a bare number under a step tells a newcomer nothing
}

/** A flow chart of a part with the line of placesLine under the label of each node of `ids` that has code. Other kinds are left as they are. */
export function partMermaid(kind: Diagram['kind'], text: string, code: Record<string, PageCode>, ids = Object.keys(code)): string {
  if (kind !== 'flow') return text;
  for (const id of ids) {
    const line = code[id] && placesLine(code[id]);
    if (!line || id.includes(':')) continue; // an arrow has its diff beside its text, drawn by the page
    // The first place where the node is written with a quoted label: id["Label"] or id(["Label"]) and so on.
    const where = new RegExp(`(^|[\\s;&>|])(${id}\\s*[\\[\\(\\{>]+)"([^"]*)"`, 'm');
    text = text.replace(where, (_, before, open, label) => `${before}${open}"${label}<span class='ln'>${line}</span>"`);
  }
  return text;
}
