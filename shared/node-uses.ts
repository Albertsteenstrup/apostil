// The loose nodes of a diagram of the map (nodes with no arrow) and why they have none: the code that imports them. Home draws them in quiet boxes
// with a heading: "Used by almost every part here", or "Used from other areas: …". Imports are read cheaply, in any language, from the top of each file.

import { closeSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagram } from './change-file';
import { diagramGraph, escapeLabel, flowGraph } from './diagram-graph';
import { areaOf, CODE_ENDINGS } from './note-groups';
import { touches, type RepoMap } from './repo-map';

const HEAD_BYTES = 16 * 1024; // imports stand at the top of a file
const MOST = 0.6; // a node that this share of the other nodes imports is used by almost every part
const AREAS_NAMED = 3; // the heading names this many areas, then "+N"

// A line that imports in some language: by its first word (not a field such as "from: string"), "from x import", "} from '…'", "export … from '…'",
// or a call of require( or import( anywhere in it.
const IMPORT_LINE = /^\s*(?:(?:import|require|require_relative|use|using|include|#\s*include)\b(?!\s*[:=])|from\s+\S+\s+import\b|(?:export\b.*|\})\s*from\s*['"])|\b(?:require|import)\s*\(/;
const FOLDER_FILE = /^(index|__init__|mod|main)$/; // a file that code imports by the name of its folder

/** A box of loose nodes: its subgraph id, its heading and its nodes. */
export interface LooseBox {
  id: 'usedByAll' | 'usedFromOutside';
  heading: string;
  nodes: string[];
}

/** The first 16 KB of a file as text; empty when it cannot be read. */
function headOf(full: string): string {
  let fd: number | undefined;
  try {
    fd = openSync(full, 'r');
    const bytes = Buffer.alloc(HEAD_BYTES);
    return bytes.toString('utf8', 0, readSync(fd, bytes, 0, HEAD_BYTES, 0));
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The import-like lines of a text. One that ends with "(" or "{" goes on to the line that closes it, as an import block of Go or a use of Rust. */
function importLines(text: string): string[] {
  const found: string[] = [];
  let open = false;
  for (const line of text.split('\n')) {
    if (open) open = !/^\s*[)}]/.test(line);
    else if (IMPORT_LINE.test(line)) open = /[({]\s*$/.test(line);
    else continue;
    found.push(line);
  }
  return found;
}

/** The words of the import-like lines of each code file: the names that it may import. Every code file is a key, also one with no import. */
export function importWords(folder: string, files: string[]): Map<string, Set<string>> {
  return new Map(files.filter((path) => CODE_ENDINGS.test(path)).map((path) => [path, new Set(importLines(headOf(join(folder, path))).flatMap((line) => line.match(/[\w-]+/g) ?? []))]));
}

let kept: { key: string; words: Map<string, Set<string>> } | undefined;

/** importWords, kept in memory until the map is saved again or the count of files of the repo changes. */
export function keptImportWords(folder: string, savedAt: string, files: string[]): Map<string, Set<string>> {
  const key = `${folder}\n${savedAt}\n${files.length}`;
  if (kept?.key !== key) kept = { key, words: importWords(folder, files) };
  return kept.words;
}

/** The name that code imports a file by: its name with no ending; for an index, __init__, mod or main file the name of its folder. */
function nameOf(path: string): string {
  const names = path.split('/');
  const stem = names[names.length - 1].replace(/\.[^.]+$/, '');
  return FOLDER_FILE.test(stem) && names.length > 1 ? names[names.length - 2] : stem;
}

/** The code files outside a node that import it: an import-like line names one of its files, or the last name of one of its folders (Go, Python). */
function importersOf(paths: string[], words: Map<string, Set<string>>): string[] {
  const inside = (file: string): boolean => paths.some((path) => touches(path, file));
  const names = new Set([...[...words.keys()].filter(inside).map(nameOf), ...paths.filter((path) => path.endsWith('/')).map((path) => path.split('/').at(-2)!)]);
  return [...words].filter(([file, said]) => !inside(file) && [...names].some((name) => said.has(name))).map(([file]) => file);
}

/** The node ids that the text names inside a subgraph. */
function boxedNodes(mermaid: string): Set<string> {
  let depth = 0;
  const inside: string[] = [];
  for (const line of mermaid.split('\n')) {
    if (/^\s*subgraph\b/.test(line)) depth++;
    else if (/^\s*end\b/.test(line)) depth = Math.max(0, depth - 1);
    else if (depth) inside.push(line);
  }
  return new Set(flowGraph(inside.join('\n')).nodes.keys());
}

/** A few names joined with ", ": three at most, then "+N". */
const few = (names: string[]): string => `${names.slice(0, AREAS_NAMED).join(', ')}${names.length > AREAS_NAMED ? ` +${names.length - AREAS_NAMED}` : ''}`;

/**
 * The boxes of the loose nodes of a written flow chart of the map: a node with paths, no arrow and no subgraph of its writer. "Used by almost every part
 * here": at least 60% of the other nodes, and 2, import it. "Used from other areas" (only below the top diagram): code of other areas imports it.
 * `words` is called only when the diagram has a loose node.
 */
export function looseBoxes(map: RepoMap, diagram: Diagram, words: () => Map<string, Set<string>>): LooseBox[] {
  if (diagram.kind !== 'flow' || !diagram.nodePaths) return [];
  const graph = diagramGraph(diagram);
  const joined = new Set(graph.edges.flatMap((edge) => [edge.from, edge.to]));
  const boxed = boxedNodes(diagram.mermaid);
  const parts = Object.entries(diagram.nodePaths).filter(([node]) => Object.hasOwn(graph.nodes, node));
  const loose = parts.filter(([node]) => !joined.has(node) && !boxed.has(node));
  if (!loose.length) return [];
  const all = words();
  const holds = (paths: string[], file: string): boolean => paths.some((path) => touches(path, file));
  const ownAreas = new Set(parts.flatMap(([, paths]) => paths.map((path) => areaOf(map, path))));
  const byAll: string[] = [];
  const fromOutside: string[] = [];
  const areas = new Set<string>();
  for (const [node, paths] of loose) {
    const importers = importersOf(paths, all);
    const users = parts.filter(([other, its]) => other !== node && importers.some((file) => holds(its, file))).length;
    if (users >= 2 && users >= MOST * (parts.length - 1)) { byAll.push(node); continue; }
    if (!diagram.parent) continue; // on the top diagram every area is in the diagram
    // The areas of the importers that no node of this diagram holds, other than the areas of this diagram.
    const outside = importers.filter((file) => !parts.some(([, its]) => holds(its, file))).map((file) => areaOf(map, file)).filter((area): area is string => !!area && !ownAreas.has(area));
    if (!outside.length) continue;
    fromOutside.push(node);
    for (const area of outside) areas.add(area);
  }
  const top = map.diagrams.find((one) => !one.parent);
  const labels: Record<string, string> = top ? diagramGraph(top).nodes : {};
  const named = Object.keys(top?.nodePaths ?? {}).filter((area) => areas.has(area)).map((area) => labels[area] ?? area);
  return [
    ...(byAll.length ? [{ id: 'usedByAll' as const, heading: 'Used by almost every part here', nodes: byAll }] : []),
    ...(fromOutside.length ? [{ id: 'usedFromOutside' as const, heading: `Used from other areas: ${few(named)}`, nodes: fromOutside }] : []),
  ];
}

/**
 * The Mermaid text with a subgraph for each box, before the class and style lines at its end. Mermaid moves a node declared above into the box that names
 * it. The heading has no-break spaces: Mermaid wraps a long one over the node, but widens the box for one line.
 */
export function withBoxes(mermaid: string, boxes: LooseBox[]): string {
  if (!boxes.length) return mermaid;
  const lines = mermaid.split('\n');
  let at = lines.length;
  while (at > 1 && /^\s*$|^\s*(classDef|class|style|linkStyle)\b/.test(lines[at - 1])) at--;
  const heading = (box: LooseBox): string => escapeLabel(box.heading).replace(/ /g, ' ');
  lines.splice(at, 0, ...boxes.flatMap((box) => [`  subgraph ${box.id}["${heading(box)}"]`, ...box.nodes.map((node) => `    ${node}`), '  end']));
  return lines.join('\n');
}
