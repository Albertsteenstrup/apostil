// Builds what Home and the graphs page show, from the store and from Git. No `vscode` import.
// Home is the map of the repo; the graphs page shows every diagram that one folder or file is a part of.

import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagram } from '../shared/change-file';
import { changeWhere } from '../shared/change-rows';
import { thingsOf } from '../shared/diagram-code';
import { diagramGraph, type DiagramGraph } from '../shared/diagram-graph';
import { schemaDrawing, type SchemaDrawing } from '../shared/schema';
import { changedFiles, commitExists, tryGit } from '../shared/git';
import { diagramsOf, touches, type DiagramOfPath } from '../shared/repo-map';
import { allProcessDrawings, placeDiagramId, placeDrawing, processDiagramId, processesStartingIn, type LineOf, type ProcessDiagram, type ProcessNode, type Span } from '../shared/process-diagrams';
import { lookData, type LookData } from './look-data';
import type { Remark, StoredChange, Store } from '../shared/store';
import { changeMermaid, nodeId, partMermaid } from './change-diagram';
import { repoName } from './page-data';
import type { Step } from './trail';

/** A change in the list, as a node of Home names it. */
export interface ChangeRef {
  id: number;
  branch: string;
  title: string;
}

/** One node of a map diagram: what it stands for and where a click goes. */
export interface HomeNode {
  paths: { path: string; files: number }[]; // the folders and files that it stands for, each with its count of files
  files: number; // the files of the repo under all of them
  changes: ChangeRef[]; // the stored changes that touch it
  down?: string; // the diagram one level down that covers it: an area, or the processes that start in its paths
  graphs: string; // without a level down, a click opens the graphs of this path: the first folder, else the first path
  line?: number; // a step of a process with no inner steps: a click opens its file at this line
  note?: ProcessNode['note']; // a step or a process: the pointer shows its note or its summary, not the list of files
  quiet?: true; // a step or a process of another place, or a call out of the repo
  kind?: ProcessNode['kind']; // a node of a drawn process: a step (or a process), or a call out of the repo; a node of a written diagram has none
  at?: Span[]; // a step: its lines, which the marks at them roll up to
  calls?: LineOf[]; // a call out of the repo: the lines that call it
  steps?: ProcessNode['steps']; // a step that holds steps, or a process: the count of its steps
  process?: true; // a process in the drawing of a place
  names?: string[]; // a call out of the repo: the names that the code calls it by
  callers?: ProcessNode['callers']; // a box that three or more boxes call: who calls it, and where
}

export interface HomeDiagram {
  id: string;
  kind: Diagram['kind'];
  title: string;
  parent?: string;
  mermaid: string;
  graph: DiagramGraph; // its nodes and arrows, for comments on them
  nodes: Record<string, HomeNode>;
  schema?: SchemaDrawing; // a schema diagram: its tables, which the page draws itself
  edgeLines?: ProcessDiagram['edgeLines']; // a drawn process: the line where each arrow starts
  order?: ProcessDiagram['order']; // a drawn process: the number of an arrow that leaves a box with two or more
  dots?: ProcessDiagram['dots']; // a drawn process: the boxes that a box calls with a dot in place of an arrow
  columns?: { mermaid: string; graph: DiagramGraph; columns: string[][]; dots: Record<string, string[]> }; // a drawn process with a long chain: its drawing in columns
}

export interface HomeData {
  kind: 'home';
  repo: string;
  folder: string;
  map?: { top: string; diagrams: HomeDiagram[]; written?: string; files?: number }; // written: "written 12 commits ago" when the folder has moved on; files: of the repo
  look?: LookData; // the look of the repo and its marks: the default look when none is saved
  apps: string[]; // the agent apps whose program is on the path: each can write the map, and "@" offers a new session of each
  writing?: string; // the app that writes the map now
  needsSetup?: boolean; // with no map: no agent app has the skills, so Home shows "Set up for agents"
  remarks: Remark[]; // the comments on the map of the repo, which belong to no change
}

/** One small panel of the graphs page. */
export interface GraphPanel {
  level: DiagramOfPath['level'];
  line: string; // what the diagram is
  from: string; // "the map", or the kind of diagram and the branch of its change
  mermaid: string;
  lit: string[]; // the node ids to light; empty when the whole diagram is about the path
  where: string; // where the path is, in words: "in: Dev server", "in 3 nodes" or "in the whole diagram"
  open: Step; // where a click goes: a diagram of the map on Home, or a diagram of a change on its page
  schema?: SchemaDrawing; // a schema diagram: its tables, which the page draws itself
  type: Diagram['kind']; // the kind of the diagram; a change is a flow chart
  branch?: string; // the branch of the change that the diagram is of
  // A diagram of the map or a process, which the look of the repo applies to: its id, what each node stands for, its arrows and the lines where they start.
  id?: string;
  nodes?: Record<string, Pick<HomeNode, 'paths'> & Partial<HomeNode>>;
  graph?: DiagramGraph;
  edgeLines?: ProcessDiagram['edgeLines'];
}

export interface GraphsData {
  kind: 'graphs';
  repo: string;
  folder: string;
  path: string; // a folder ends with "/"
  panels: GraphPanel[];
  look?: LookData; // the look of the repo and its marks, for the panels of the map and of processes
}

// The quiet words of a panel that say where its diagram comes from.
const FROM: Record<DiagramOfPath['level'], string> = { map: 'the map', process: 'process', wide: 'wider diagram', change: 'change', part: 'part', function: 'function' };

/** Where the path is in a diagram, in words, from the names of its lit nodes. */
export function whereLine(names: string[], noun = 'nodes'): string {
  if (!names.length) return 'in the whole diagram';
  return names.length === 1 ? `in: ${names[0]}` : `in ${names.length} ${noun}`;
}

/** The names of nodes of a diagram, as plain text. */
const nodeNames = (diagram: Diagram, ids: string[]): string[] => {
  const labels = diagramGraph(diagram).nodes;
  return ids.map((id) => labels[id] ?? id);
};

/** Every file of the repo, from Git: committed files and new files that Git does not ignore. */
export function repoFiles(folder: string): string[] {
  return (tryGit(folder, 'ls-files', '--cached', '--others', '--exclude-standard') ?? '').split('\n').filter(Boolean);
}

const isFolder = (full: string): boolean => {
  try { return statSync(full).isDirectory(); } catch { return false; }
};

/** The id of the repo of a folder: its first commit, the same in every worktree. */
export const idOf = (folder: string): string | undefined => tryGit(folder, 'rev-list', '--max-parents=0', 'HEAD')?.split('\n').pop();

/** The files that a stored change names: the files of its parts and the files in no part. */
const filesOfChange = (change: StoredChange): string[] => [...change.file.parts.flatMap((part) => part.files), ...change.checks.filesInNoPart];

/** "written 12 commits ago", "written at another commit", or nothing when the map was written at the commit that the folder is at. */
export function writtenLine(folder: string, commit: string): string | undefined {
  if (tryGit(folder, 'rev-parse', 'HEAD') === commit) return undefined;
  const behind = commitExists(folder, commit) ? Number(tryGit(folder, 'rev-list', '--count', `${commit}..HEAD`) ?? 0) : 0;
  return behind > 0 ? `written ${behind} commit${behind === 1 ? '' : 's'} ago` : 'written at another commit';
}

/** The diagram one level down from a node: the child of the diagram whose paths meet the paths of the node the most. */
function downOf(diagrams: Diagram[], parent: string, paths: string[]): string | undefined {
  let best: { id: string; score: number } | undefined;
  for (const child of diagrams.filter((diagram) => diagram.parent === parent)) {
    const score = Object.values(child.nodePaths ?? {}).flat().filter((entry) => paths.some((path) => touches(path, entry))).length;
    if (score > 0 && (!best || score > best.score)) best = { id: child.id, score };
  }
  return best?.id;
}

/**
 * What Home shows for the repo of a folder: its map with every node and its look, or no map and the apps that can write one.
 * `address` turns a kept file of the look into an address that the page may load.
 */
export function homeData(store: Store, folder: string, apps: string[] = [], address: (file: string) => string = (file) => file): HomeData {
  const id = idOf(folder);
  const stored = id ? store.getMap(id) : undefined;
  const base: HomeData = { kind: 'home', repo: repoName(folder), folder, apps, remarks: id ? store.repoRemarks(id) : [] };
  if (!id || !stored) return base;
  const files = repoFiles(folder);
  const changes = store.listChanges(id).map((change) => ({ ref: { id: change.id, branch: change.branch, title: change.file.title }, files: filesOfChange(change) }));
  const count = (path: string): number => files.filter((file) => touches(path, file)).length;
  const { diagrams } = stored.map;
  const homeDiagrams: HomeDiagram[] = diagrams.map((diagram) => ({
    id: diagram.id, kind: diagram.kind, title: diagram.title, parent: diagram.parent, mermaid: diagram.mermaid, graph: diagramGraph(diagram), ...schemaOf(diagram),
    nodes: Object.fromEntries(Object.entries(diagram.nodePaths ?? {}).map(([node, paths]) => {
      const under = files.filter((file) => paths.some((path) => touches(path, file)));
      return [node, {
        paths: paths.map((path) => ({ path, files: count(path) })), files: under.length,
        changes: changes.filter((change) => change.files.some((file) => paths.some((path) => touches(path, file)))).map((change) => change.ref),
        down: downOf(diagrams, diagram.id, paths), graphs: paths.find((path) => path.endsWith('/')) ?? paths[0],
      }];
    })),
  }));
  // A node with no diagram under it goes down to the processes that start in its paths: one process opens that process, several open the processes of that node.
  const drawn: ProcessDiagram[] = allProcessDrawings(stored.map);
  for (const diagram of homeDiagrams) {
    for (const [node, home] of Object.entries(diagram.nodes)) {
      const starting = home.down ? [] : processesStartingIn(stored.map, home.paths.map((entry) => entry.path));
      if (starting.length === 1) home.down = processDiagramId(starting[0].id);
      if (starting.length < 2) continue;
      home.down = placeDiagramId(diagram.id, node);
      drawn.push(placeDrawing(stored.map, home.down, `Processes of ${diagram.graph.nodes[node] ?? node}`, starting));
    }
  }
  homeDiagrams.push(...drawn.map(processHomeDiagram));
  const top = diagrams.find((diagram) => !diagram.parent) ?? diagrams[0];
  return { ...base, map: { top: top.id, diagrams: homeDiagrams, written: writtenLine(folder, stored.commit), files: files.length }, look: lookData(store, id, folder, address) };
}

const mapValues = <A, B>(record: Record<string, A>, change: (value: A) => B): Record<string, B> => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, change(value)]));

/** A drawn process as a diagram of Home. The boxes that hold the columns are no part of its graph. */
export const processHomeDiagram = (one: ProcessDiagram): HomeDiagram => {
  const graph = (mermaid: string): DiagramGraph => {
    const whole = diagramGraph({ kind: 'flow', mermaid });
    const column = (id: string): boolean => /^col\d+$/.test(id);
    return { nodes: Object.fromEntries(Object.entries(whole.nodes).filter(([id]) => !column(id))), edges: whole.edges.filter((edge) => !column(edge.from) && !column(edge.to)) };
  };
  return {
    id: one.id, kind: 'flow', title: one.title, mermaid: one.mermaid, graph: graph(one.mermaid), nodes: mapValues(one.nodes, processHomeNode),
    ...(one.edgeLines ? { edgeLines: one.edgeLines } : {}), ...(one.order ? { order: one.order } : {}), ...(one.dots ? { dots: one.dots } : {}),
    ...(one.columns ? { columns: { ...one.columns, graph: graph(one.columns.mermaid) } } : {}),
  };
};

/** A node of a drawn process as a node of Home: its file, where a click goes, and what the pointer shows. */
const processHomeNode = (node: ProcessNode): HomeNode => ({
  paths: node.files.map((path) => ({ path, files: 1 })), files: node.files.length, changes: [], graphs: node.files[0] ?? '', kind: node.kind,
  ...(node.down ? { down: node.down } : {}), ...(node.line ? { line: node.line } : {}), ...(node.note ? { note: node.note } : {}), ...(node.quiet ? { quiet: true as const } : {}),
  ...(node.at?.length ? { at: node.at } : {}), ...(node.calls?.length ? { calls: node.calls } : {}),
  ...(node.steps ? { steps: node.steps } : {}), ...(node.process ? { process: true as const } : {}), ...(node.names ? { names: node.names } : {}),
  ...(node.callers ? { callers: node.callers } : {}),
});

/** The tables of a schema diagram, which the page draws itself; nothing for the other kinds. */
const schemaOf = (diagram: Diagram): { schema?: SchemaDrawing } => (diagram.kind === 'schema' ? { schema: schemaDrawing(diagram) } : {});

/** The graphs page of a folder (ending with "/") or a file: one panel for each diagram that it is a part of, the widest first. */
export function graphsData(store: Store, folder: string, path: string, address: (file: string) => string = (file) => file): GraphsData {
  const id = idOf(folder);
  const found = id ? diagramsOf(store, folder, path) : [];
  const asked = !path.endsWith('/') && isFolder(join(folder, path)) ? `${path}/` : path;
  const byBranch = new Map(id ? store.listChanges(id).map((change) => [change.branch, change]) : []);
  const panels = found.map((entry): GraphPanel | undefined => {
    if (entry.level === 'process') { // a process drawn from the map: a click opens it on Home
      const diagram = entry.diagram!;
      const drawn = entry.drawn!;
      return {
        level: 'process', type: 'flow', line: entry.line, from: FROM.process, mermaid: diagram.mermaid, lit: entry.lit, where: whereLine(nodeNames(diagram, entry.lit).map((name) => name.replace(/ \d+ steps?$/, '')), 'steps'), open: { tab: 'home', diagram: diagram.id, lit: entry.lit, name: diagram.title },
        id: drawn.id, nodes: mapValues(drawn.nodes, processHomeNode), graph: diagramGraph(diagram), ...(drawn.edgeLines ? { edgeLines: drawn.edgeLines } : {}),
      };
    }
    if (entry.level === 'map') {
      const diagram = entry.diagram!;
      const open: Step = diagram.parent ? { tab: 'home', diagram: diagram.id, lit: entry.lit, name: diagram.title } : { tab: 'home', diagram: '', lit: entry.lit, name: 'Home' };
      const nodes = mapValues(diagram.nodePaths ?? {}, (paths) => ({ paths: paths.map((path) => ({ path, files: 0 })) }));
      return { level: 'map', type: diagram.kind, line: entry.line, from: FROM.map, mermaid: diagram.mermaid, lit: entry.lit, where: whereLine(nodeNames(diagram, entry.lit)), open, ...schemaOf(diagram), id: diagram.id, nodes, graph: diagramGraph(diagram) };
    }
    const change = entry.changeId !== undefined ? store.getChange(entry.changeId) : byBranch.get(entry.branch!);
    if (!change) return undefined;
    const from = `${FROM[entry.level]} · branch ${change.branch}`;
    if (entry.level === 'change') {
      const { folder: where, saved } = changeWhere(change, folder);
      let files: ReturnType<typeof changedFiles> = [];
      try { if (!saved?.missing) files = changedFiles(where, change.base, saved && change.head); } catch { /* the base is gone: the parts without counts */ }
      const mermaid = changeMermaid({ parts: change.file.parts, links: change.file.links, files, filesInNoPart: change.checks.filesInNoPart });
      const lit = entry.lit.map((part) => nodeId(change.file.parts.findIndex((candidate) => candidate.id === part)));
      const names = entry.lit.map((part) => change.file.parts.find((candidate) => candidate.id === part)?.name ?? part);
      return { level: 'change', type: 'flow', branch: change.branch, line: entry.line, from, mermaid, lit, where: whereLine(names, 'parts'), open: { tab: 'change', change: change.id, go: { level: 'change', lit: entry.lit }, name: change.file.title } };
    }
    const diagram = entry.diagram!;
    const where = whereLine(nodeNames(diagram, entry.lit));
    if (entry.level === 'wide') {
      return { level: 'wide', type: diagram.kind, branch: change.branch, id: diagram.id, line: entry.line, from, mermaid: diagram.mermaid, lit: entry.lit, where, open: { tab: 'change', change: change.id, go: { level: 'broad', diagram: diagram.id, lit: entry.lit }, name: diagram.title }, ...schemaOf(diagram) };
    }
    // A diagram of a part or of a function: its part is the one it names, else the part that holds its file.
    const part = change.file.parts.find((candidate) => candidate.id === diagram.part)
      ?? change.file.parts.find((candidate) => candidate.files.some((file) => diagram.file && touches(diagram.file, file)));
    const open: Step = part
      ? { tab: 'change', change: change.id, go: { level: 'part', part: part.id, diagram: diagram.id, lit: entry.lit }, name: part.name }
      : { tab: 'change', change: change.id, go: { level: 'change', lit: [] }, name: change.file.title };
    return { ...schemaOf(diagram), level: entry.level, type: diagram.kind, branch: change.branch, id: diagram.id, line: entry.line, from, mermaid: partMermaid(diagram.kind, diagram.mermaid, Object.fromEntries(thingsOf(diagram).things.flatMap((thing) => (thing.code ? [[thing.key, thing.code]] : [])))), lit: entry.lit, where, open };
  }).filter((panel): panel is GraphPanel => !!panel);
  const look = id && store.getMap(id) ? lookData(store, id, folder, address) : undefined;
  return { kind: 'graphs', repo: repoName(folder), folder, path: asked, panels, ...(look ? { look } : {}) };
}

/** Every path that some diagram of the repo stands for: the nodes of the map and of changes, the files of parts and of function diagrams. */
export function diagramPaths(store: Store, folder: string): string[] {
  const id = idOf(folder);
  if (!id) return [];
  const paths = new Set<string>();
  const addDiagram = (diagram: Diagram): void => {
    for (const entries of Object.values(diagram.nodePaths ?? {})) for (const entry of entries) paths.add(entry);
    if (diagram.file) paths.add(diagram.file);
  };
  for (const diagram of store.getMap(id)?.map.diagrams ?? []) addDiagram(diagram);
  for (const change of store.listChanges(id)) {
    for (const part of change.file.parts) for (const file of part.files) paths.add(file);
    for (const diagram of change.file.diagrams ?? []) addDiagram(diagram);
  }
  return [...paths];
}

/** True when a folder (ending with "/") or a file is a part of at least one diagram. */
export const inDiagrams = (paths: string[], path: string): boolean => paths.some((entry) => touches(entry, path));
