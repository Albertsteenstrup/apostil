// Reads the nodes and the arrows of a Mermaid diagram: a flow chart, a sequence diagram, a state diagram or a schema (shared/schema.ts).
// The ids are the ids of the Mermaid text, so a remark on a node or an arrow still fits after the page draws it again.

import type { Diagram } from './change-file';
import { parseSchema } from './schema';

export interface FlowGraph {
  nodes: Map<string, string>; // node id -> its shape and label as written, or "" when it was only named
  edges: { from: string; to: string; line: string; label?: string }[]; // in the order of the text, as Mermaid counts them
}

const HEADER = /^\s*(flowchart|graph)\b/;
const NOT_A_STATEMENT = /^\s*(subgraph|end|classDef|class|style|linkStyle|click|direction|%%)\b/;
const ARROW = /\s*(?:--\s+[^-]+?\s+--[->]|==\s+[^=]+?\s+==[=>]|-\.\s+.+?\s+\.->|<?-{2,}>|<?={2,}>|-{3,}|={3,}|<?-\.+->|-\.+-)\s*(?:\|[^|]*\|)?\s*/;
const NODE = /^([A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*)\s*(.*)$/;
// A ";" between two statements, not one inside quoted words such as "&lt;" (view/media/marks.js splits the same way).
const OUTSIDE_QUOTES = /;(?=(?:[^"]*"[^"]*")*[^"]*$)/;

/** The text of an arrow's label: `-- yes -->`, `-->|yes|` and the like, or undefined. */
function arrowLabel(arrow: string): string | undefined {
  const label = /\|([^|]*)\|/.exec(arrow)?.[1] ?? /^\s*(?:--|==|-\.)\s+(.+?)\s+(?:--[->]|==[=>]|\.->)/.exec(arrow)?.[1];
  return label?.trim() ? plain(label) : undefined;
}

/** Escapes text for a quoted Mermaid label with HTML inside. Mermaid turns "#quot;" into a quote. */
export const escapeLabel = (text: string): string =>
  text.replace(/[\r\n]+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '#quot;').replace(/'/g, '#39;');

/** A label as plain text: no quotes around it, no HTML, and Mermaid's "#quot;" as a quote. */
const plain = (text: string): string =>
  text.trim().replace(/^"([\s\S]*)"$/, '$1').replace(/<[^>]*>/g, ' ').replace(/#quot;/g, '"').replace(/#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** Reads the nodes and edges of a Mermaid flow chart. Good enough for the diagrams that agents write. */
export function flowGraph(mermaid: string): FlowGraph {
  const graph: FlowGraph = { nodes: new Map(), edges: [] };
  const statements = mermaid.split('\n').filter((line) => !HEADER.test(line)).flatMap((line) => line.split(OUTSIDE_QUOTES));
  for (const statement of statements) {
    if (!statement.trim() || NOT_A_STATEMENT.test(statement)) continue;
    // Hide quoted labels first, so an arrow inside a label does not count.
    const quoted: string[] = [];
    const masked = statement.trim().replace(/"[^"]*"/g, (text) => `\u0000${quoted.push(text) - 1}\u0000`);
    const restore = (text: string): string => text.replace(/\u0000(\d+)\u0000/g, (_, index) => quoted[Number(index)]);
    const arrows = masked.match(new RegExp(ARROW.source, 'g')) ?? [];
    const groups = masked.split(ARROW).map((segment) => segment.split(/\s+&\s+/).map((node) => NODE.exec(node.trim())).filter((match) => match !== null));
    groups.forEach((group, index) => {
      for (const [, id, shape] of group) if (!graph.nodes.get(id)) graph.nodes.set(id, restore(shape.trim()));
      const label = index > 0 ? arrowLabel(restore(arrows[index - 1] ?? '')) : undefined;
      for (const [, from] of index > 0 ? groups[index - 1] : []) {
        for (const [, to] of group) graph.edges.push({ from, to, line: restore(masked), ...(label ? { label } : {}) });
      }
    });
  }
  return graph;
}

/** The nodes and the arrows of any diagram, with their labels as plain text. */
export interface DiagramGraph {
  nodes: Record<string, string>; // node id -> label: a box of a flow chart, a participant of a sequence, a state
  edges: { from: string; to: string; label?: string }[]; // the arrows, messages or transitions, in the order of the text
}

const PARTICIPANT = /^\s*(?:participant|actor)\s+(\S+?)(?:\s+as\s+(.+?))?\s*$/;
const MESSAGE = /^\s*([^\s:+-]+?)\s*(?:<<)?-{1,2}(?:>>|>|x|\))\s*[+-]?\s*([^\s:]+?)\s*:\s*(.*)$/;
const TRANSITION = /^\s*(\S+)\s*-->\s*(\S+?)\s*(?::\s*(.*))?$/;
const STATE_LABEL = /^\s*state\s+"([^"]+)"\s+as\s+(\S+)\s*$/;
const STATE_TEXT = /^\s*([A-Za-z0-9_]+)\s*:\s*(.+)$/;

/** Reads a diagram of any of the three kinds. A start or end state "[*]" gets Mermaid's own ids: root_start and root_end. */
export function diagramGraph(diagram: Pick<Diagram, 'kind' | 'mermaid'>): DiagramGraph {
  const graph: DiagramGraph = { nodes: {}, edges: [] };
  // A node keeps the label that names it; a node that is only used gets its id as label.
  const name = (id: string, label?: string): void => {
    if (label !== undefined) graph.nodes[id] = plain(label);
    else graph.nodes[id] ??= id;
  };
  if (diagram.kind === 'flow') {
    const flow = flowGraph(diagram.mermaid);
    for (const [id, shape] of flow.nodes) name(id, /^[[({>/\\]+([\s\S]*?)[\])}/\\]+$/.exec(shape)?.[1] || id);
    graph.edges = flow.edges.map(({ from, to, label }) => ({ from, to, ...(label ? { label } : {}) }));
    return graph;
  }
  if (diagram.kind === 'schema') { // a table is a node, a relation an arrow
    const schema = parseSchema(diagram.mermaid);
    for (const table of schema.tables) name(table.name);
    graph.edges = schema.relations;
    return graph;
  }
  for (const line of thingLines(diagram)) {
    if ('node' in line) { name(line.node, line.label); continue; }
    name(line.from, line.from === 'root_start' ? 'start' : undefined);
    name(line.to, line.to === 'root_end' ? 'end' : undefined);
    graph.edges.push({ from: line.from, to: line.to, ...(line.label ? { label: line.label } : {}) });
  }
  return graph;
}

/**
 * One line of a sequence or state diagram that names a thing: a participant or a labelled state (`node`), or a message or a transition (`from`, `to`).
 * `at` is its place among the lines of the text, the first line being 0. A start or end state "[*]" gets Mermaid's own ids: root_start and root_end.
 */
export type ThingLine = { at: number; label?: string } & ({ node: string } | { from: string; to: string });

/** The lines of a sequence or state diagram that name its things, in the order of the text. */
export function thingLines(diagram: Pick<Diagram, 'kind' | 'mermaid'>): ThingLine[] {
  const found: ThingLine[] = [];
  const label = (text: string | undefined): { label?: string } => (text?.trim() ? { label: plain(text) } : {});
  diagram.mermaid.split('\n').forEach((line, at) => {
    if (at === 0) return;
    if (diagram.kind === 'sequence') {
      const participant = PARTICIPANT.exec(line);
      if (participant) return void found.push({ at, node: participant[1], ...label(participant[2]) });
      const message = MESSAGE.exec(line);
      if (message && !/^\s*note\b/i.test(line)) found.push({ at, from: message[1], to: message[2], ...label(message[3]) });
      return;
    }
    if (/^\s*(direction|note|classDef|class|%%|state\s+\S+\s*\{|\})/.test(line) && !STATE_LABEL.test(line)) return;
    const labelled = STATE_LABEL.exec(line);
    if (labelled) return void found.push({ at, node: labelled[2], ...label(labelled[1]) });
    const transition = TRANSITION.exec(line);
    if (transition) {
      const end = (id: string, word: string): string => (id === '[*]' ? `root_${word}` : id);
      return void found.push({ at, from: end(transition[1], 'start'), to: end(transition[2], 'end'), ...label(transition[3]) });
    }
    const text = STATE_TEXT.exec(line);
    if (text) found.push({ at, node: text[1], ...label(text[2]) });
  });
  return found;
}

/** The kind of a Mermaid text, from its first line, or undefined when it is none of the four. */
export function kindOfText(mermaid: string): Diagram['kind'] | undefined {
  const first = mermaid.trim().split('\n')[0] ?? '';
  if (HEADER.test(first)) return 'flow';
  if (/^\s*sequenceDiagram\b/.test(first)) return 'sequence';
  if (/^\s*erDiagram\b/.test(first)) return 'schema';
  return /^\s*stateDiagram(-v2)?\b/.test(first) ? 'state' : undefined;
}

// Words that Mermaid keeps for itself in a flow chart. A node with such an id makes the whole chart fail to draw (tried with the Mermaid of the view).
const KEPT_WORDS = ['end', 'call', 'click', 'style', 'class', 'classDef', 'linkStyle', 'graph', 'subgraph', 'interpolate', 'href', 'flowchart'];

/** What is wrong with the node ids of a flow chart, in words that a writer can act on. Empty for the other kinds. */
export function nodeIdProblems(diagram: Pick<Diagram, 'kind' | 'mermaid'>): string[] {
  if (diagram.kind !== 'flow') return [];
  return Object.keys(diagramGraph(diagram).nodes)
    .filter((id) => KEPT_WORDS.includes(id))
    .map((id) => `The node id "${id}" is a word that Mermaid keeps for itself, so the diagram does not draw. Give the node another id, for example "${id}Step".`);
}
