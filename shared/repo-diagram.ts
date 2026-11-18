// A diagram of a change draws on a diagram of the repo: its "of" names a diagram of the map or a drawing of the map, and its "before" is the text of
// that diagram as it is. The save holds a writer to it (store/save.ts), and the change page links each such diagram to Home (view/page-data.ts).

import type { Diagram } from './change-file';
import { mapDrawing } from './comment-lines';
import type { RepoMap } from './repo-map';

/** The lines of a Mermaid text that count: each with no spaces at its ends and one space between words, with no empty line and no comment. */
const countedLines = (text: string): string[] => text.split('\n').map((line) => line.trim().replace(/\s+/g, ' ')).filter((line) => line && !line.startsWith('%%'));

/**
 * True when two Mermaid texts draw the same diagram: the same lines, spaces left out. In a flow chart and a state diagram the order of the lines does
 * not count, as the page compares them by their nodes and arrows; in a sequence the order of the messages counts, and in a schema the order of the columns.
 */
export function sameDiagramText(one: string | undefined, other: string, kind: Diagram['kind']): boolean {
  if (one === undefined) return false;
  const [a, b] = [countedLines(one), countedLines(other)];
  if (kind === 'flow' || kind === 'state') [a, b].forEach((lines) => lines.sort());
  return a.length === b.length && a.every((line, at) => line === b[at]);
}

/** Where the repo diagram of a diagram of a change stands now: its id and title on Home, and `again` when the map no longer holds it as "before" has it. */
export interface RepoDiagram {
  id?: string; // missing when the map no longer has it
  title?: string;
  again?: true; // the map was written again since the change was described
}

/** The repo diagram of a diagram of a change, from the map as it is now. Undefined for a diagram that names none. */
export function repoDiagramOf(map: RepoMap | undefined, diagram: Diagram): RepoDiagram | undefined {
  // A wider diagram from before "of" has the id of its repo diagram as its own id; its "before" was not checked against the map.
  const id = diagram.of ?? (diagram.broad ? diagram.id : undefined);
  const drawn = id ? mapDrawing(map, id) : undefined;
  const found = drawn ? { id, title: drawn.diagram.title } : {};
  if (!diagram.of) return drawn ? found : undefined;
  return !drawn || !sameDiagramText(diagram.before, drawn.diagram.mermaid, drawn.diagram.kind) ? { ...found, again: true } : found;
}
