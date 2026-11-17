// `apostil map --fit`: where the notes and the processes do not fit the diagrams of the map. Three short lists of facts, for the overview writer to weigh (skill apostil-map-repo, Step 6).

import { diagramGraph } from './diagram-graph';
import { areaOf } from './note-groups';
import { parseKey, type Process } from './processes';
import type { RepoMap } from './repo-map';

const MOST = 20;

/** A list cut to its first entries, with the count of the rest. */
const cut = <T>(all: T[]): { count: number; items: T[]; more?: number } => ({ count: all.length, items: all.slice(0, MOST), ...(all.length > MOST ? { more: all.length - MOST } : {}) });

const holds = (paths: string[], file: string): boolean => paths.some((entry) => entry === file || (entry.endsWith('/') && file.startsWith(entry)));

export function mapFit(map: RepoMap) {
  const withNodes = map.diagrams.filter((diagram) => diagram.nodePaths);
  const allPaths = withNodes.flatMap((diagram) => Object.values(diagram.nodePaths!).flat());
  const steps = (process: Process): string[] => process.steps.flatMap((key) => parseKey(key)?.file ?? []);
  const fileOf = (key: string): string | undefined => parseKey(key)?.file;

  // 1. Files with notes that stand in no node of any diagram.
  const noted = [...new Set((map.fileNotes ?? []).map((note) => note.file))].sort();
  const outside = noted.filter((file) => !holds(allPaths, file));

  // 2. Nodes of the diagrams whose paths hold no file with a note or a process.
  const used = new Set([...noted, ...(map.processes ?? []).flatMap(steps)]);
  const empty = withNodes.flatMap((diagram) => Object.entries(diagram.nodePaths!)
    .filter(([, paths]) => ![...used].some((file) => holds(paths, file)))
    .map(([node, paths]) => ({ diagram: diagram.id, node, paths })));

  // 3. Calls of the processes between two nodes of the top diagram that have no arrow between them.
  const top = map.diagrams.find((diagram) => !diagram.parent);
  const joined = new Set((top ? diagramGraph(top).edges : []).flatMap((edge) => [`${edge.from}>${edge.to}`, `${edge.to}>${edge.from}`]));
  const crossing = new Map<string, { from: string; to: string; calls: number; example: string }>();
  for (const process of map.processes ?? []) {
    for (const arrow of process.arrows ?? []) {
      const [from, to] = [fileOf(arrow.from), fileOf(arrow.to)];
      const [a, b] = [from && areaOf(map, from), to && areaOf(map, to)];
      if (!from || !to || !a || !b || a === b || joined.has(`${a}>${b}`)) continue;
      const key = `${a}>${b}`;
      const have = crossing.get(key);
      if (have) have.calls++;
      else crossing.set(key, { from: a, to: b, calls: 1, example: `${process.id}: ${from}:${arrow.fromLine} calls ${to}${arrow.name ? ` (${arrow.name})` : ''}` });
    }
  }
  return { filesInNoNode: cut(outside), nodesWithNoFile: cut(empty), callsWithNoArrow: cut([...crossing.values()]) };
}
