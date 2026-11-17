// What an agent can ask Apostil: the review context and the diagrams.
// The command line and the helper both call these functions.

import type { Diagram, Note } from './change-file';
import { inNoThingWords, linksChecked, linkThings, REASON_WORDS, thingsOf, type Place, type ThingCode } from './diagram-code';
import { cellsIn, inNoThingPlaces, linesInNoThingOf, rangesText } from './checks';
import { diagramGraph } from './diagram-graph';
import { changedFiles, currentBranch, fileText, repoId, type ChangedFile } from './git';
import { cellOfLine, cellsOfText, inCellText, isNotebookPath } from './notebook';
import { diagramsOf, type RepoMap } from './repo-map';
import type { AppState, OpenPoint, Remark, RemarkTarget, Store, StoredChange } from './store';

/** The change of the branch that a folder has checked out. */
export function changeOfFolder(store: Store, folder: string): StoredChange | undefined {
  return store.findChange(repoId(folder), currentBranch(folder));
}

/** One earlier message in a thread: a comment of the owner or an answer of the agent. */
export interface ThreadLine {
  from: 'owner' | 'agent';
  text: string;
}

/** What was said in the thread of a remark before it. */
export function earlierInThread(store: Store, remark: Remark): ThreadLine[] {
  return store.threadOf(remark.id).filter((other) => other.id < remark.id)
    .flatMap((other): ThreadLine[] => [{ from: 'owner', text: other.text }, ...(other.answer ? [{ from: 'agent' as const, text: other.answer }] : [])]);
}

/** The changed files of a change with their counts, or none when its folder is gone. */
export function filesOfChange(change: StoredChange): ChangedFile[] {
  try {
    return changedFiles(change.folder, change.base);
  } catch {
    return [];
  }
}

const MAX_CODE_LINES = 40;
const linesText = ([first, last]: [number, number]): string => (first === last ? `line ${first}` : `lines ${first}–${last}`);
const KIND_WORDS = {
  flow: { kind: 'flow chart', node: 'Node', edge: 'Arrow' },
  sequence: { kind: 'sequence diagram', node: 'Participant', edge: 'Message' },
  state: { kind: 'state diagram', node: 'State', edge: 'Transition' },
  schema: { kind: 'schema diagram', node: 'Table', edge: 'Relation' },
};

/** The numbered lines of a file, as it is now or at a commit, at most MAX_CODE_LINES. In a notebook the lines count in the text of its cells, and `at` (the head line of their cell) makes the numbers count inside the cell. */
function codeLines(change: StoredChange, file: string, [first, last]: [number, number], commit?: string, at = 0): string[] {
  const end = Math.min(last, first + MAX_CODE_LINES - 1);
  const code = (fileText(change.folder, file, commit) ?? '').split('\n').slice(first - 1, end).map((text, index) => `${first + index - at}: ${text}`);
  return [...code, ...(end < last ? [`(${last - end} more lines)`] : [])];
}

const gone = (what: string, where = 'the change file'): string[] => [`${what}. It is no longer in ${where}.`];

/**
 * The lines of a node, an arrow or a whole diagram, from the diagram that holds it: the same for a diagram of a change and of the map.
 * A node that stands for folders and files names them.
 */
function aboutInDiagram(diagram: Diagram | undefined, target: RemarkTarget, where: string, more: string[] = []): string[] {
  const graph = diagram && diagramGraph(diagram);
  const words = KIND_WORDS[diagram?.kind ?? 'flow'];
  const label = (id: string): string => `"${graph?.nodes[id] ?? id}"`;
  const inDiagram = diagram ? [`In the ${words.kind} "${diagram.title}"`] : [];
  const things = diagram ? thingsOf(diagram).things.filter((thing) => !thing.removed) : [];
  if (target.kind === 'diagram') {
    if (!diagram) return gone(`Diagram "${target.diagram}"`, where);
    return [`Diagram "${diagram.title}", a ${words.kind}`, ...more, 'Its Mermaid text:', ...diagram.mermaid.split('\n')];
  }
  if (target.kind === 'edge') {
    const [from, to] = target.edge ?? ['?', '?'];
    if (!graph || !graph.edges.some((edge) => edge.from === from && edge.to === to)) return gone(`${words.edge} from "${from}" to "${to}"`, where);
    const thing = things.find((one) => one.from === from && one.to === to && (target.name === undefined || one.name === target.name));
    return [...inDiagram, `${words.edge} from ${label(from)} to ${label(to)}${target.name ? `, with the label "${target.name}"` : ''}`, ...codeWords(thing?.code)];
  }
  if (!diagram || !graph || !target.node || !(target.node in graph.nodes)) return gone(`${words.node} "${target.node}"`, where);
  const from = [...new Set(graph.edges.filter((edge) => edge.to === target.node).map((edge) => label(edge.from)))];
  const to = [...new Set(graph.edges.filter((edge) => edge.from === target.node).map((edge) => label(edge.to)))];
  const paths = diagram.nodePaths?.[target.node];
  return [
    ...inDiagram, `${words.node} ${label(target.node)}`,
    ...(from.length ? [`Arrows come from: ${from.join(', ')}`] : []), ...(to.length ? [`Arrows go to: ${to.join(', ')}`] : []),
    ...codeWords(things.find((thing) => thing.key === target.node)?.code),
    ...(paths?.length ? [`It stands for: ${paths.join(', ')}`] : []),
  ];
}

/** The code of a thing in plain lines: each place, or the reason why it has none. */
function codeWords(code: ThingCode | undefined): string[] {
  if (!code) return [];
  if (code.reason) return [`It has no code: ${REASON_WORDS[code.reason]}`];
  return code.places.map((place) => `Its code: ${placeWords(place)}`);
}

/** One place in words: "src/app.py, lines 5–6", "src/app.py, removed lines 3–4 (counted in the file as it was)", "src/app.py, the whole file". */
export const placeWords = (place: Place): string =>
  `${place.file}, ${!place.lines ? 'the whole file' : place.removed ? `removed ${linesText(place.lines)} (counted in the file as it was)` : linesText(place.lines)}`;

/** What the review context says of a whole diagram of a change: whether a second agent read it, and the changed lines in no node and no arrow. */
function aboutDiagramOfChange(change: StoredChange, diagram: Diagram | undefined, files: ChangedFile[]): string[] {
  if (!diagram || diagram.broad) return [];
  const lines = linesInNoThingOf(change.folder, change.base, diagram, files);
  return [
    change.checked?.includes(diagram.id) ? 'Checked: a second agent read each node and arrow against its code.' : 'Not checked yet by a second agent.',
    ...(lines.added.length + lines.removed.length ? [`${inNoThingWords(diagram.kind, lines)}: ${inNoThingPlaces(diagram.file!, lines)}`] : []),
  ];
}

/** What a remark on the map of a repo is about: a node, an arrow or a diagram of the stored map. */
export function aboutMapTarget(map: RepoMap | undefined, target: RemarkTarget): string[] {
  const diagram = map?.diagrams.find((candidate) => candidate.id === target.diagram);
  return ['On the map of the repo', ...aboutInDiagram(diagram, target, 'the map')];
}

/**
 * A few plain lines that say what the thing of a remark is, from the stored change file: the agent answers about that thing.
 * A thing that the change file no longer holds says so.
 */
export function aboutTarget(change: StoredChange, target: RemarkTarget, files: ChangedFile[] = filesOfChange(change)): string[] {
  const { parts, links } = change.file;
  const counted = (path: string): string => {
    const file = files.find((candidate) => candidate.path === path);
    const counts = [file?.added ? `+${file.added}` : '', file?.removed ? `−${file.removed}` : ''].filter(Boolean).join(' ');
    return counts ? `${path} (${counts})` : path;
  };
  const partOf = (id?: string) => parts.find((part) => part.id === id);
  const partName = (id: string): string => `part "${partOf(id)?.name ?? id}"`;
  const diagram = (change.file.diagrams ?? []).find((candidate) => candidate.id === target.diagram);
  // The notes with a place in a cell of a notebook as lines of the text of its cells, as the page names them.
  let notesHere = parts;
  try { notesHere = inCellText(change.file, cellsIn(change.folder, change.base, files)).file.parts; } catch { /* the folder is gone */ }
  const where = (note: Note): string => (note.inCell ? `${note.inCell.words}, ${linesText(note.inCell.lines)}` : linesText(note.lines));

  switch (target.kind) {
    case 'part': {
      const part = partOf(target.part);
      if (!part) return gone(`Part "${target.part}"`);
      return [`Part "${part.name}"${part.note ? `: ${part.note}` : ''}`, `Its files: ${part.files.map(counted).join(', ')}`];
    }
    case 'more-files':
    case 'no-part': {
      const part = partOf(target.part);
      const paths = part ? part.files : change.checks.filesInNoPart;
      return [part ? `The files of part "${part.name}"` : 'The changed files that are in no part', ...paths.map(counted)];
    }
    case 'file': {
      if (!target.file) return gone('A file');
      const owner = parts.find((part) => part.files.includes(target.file!));
      const notes = notesHere.flatMap((part) => part.notes ?? []).filter((note) => note.file === target.file);
      return [`File ${counted(target.file)}`, owner ? `In part "${owner.name}"` : 'In no part',
        ...(notes.length ? ['Notes on it:', ...notes.map((note) => `"${note.title}" (${where(note)})`)] : [])];
    }
    case 'node':
      return aboutInDiagram(diagram, target, 'the change file');
    case 'edge': {
      const [from, to] = target.edge ?? ['?', '?'];
      if (target.diagram) return aboutInDiagram(diagram, target, 'the change file');
      const link = linkThings(links).find((one) => one.from === from && one.to === to && (target.name === undefined || one.name === target.name));
      if (!link) return gone(`The arrow from ${partName(from)} to ${partName(to)}`);
      return ['In the diagram of the change', `Arrow from ${partName(from)} to ${partName(to)}${link.label ? `, with the label "${link.label}"` : ''}`, ...codeWords(link.code)];
    }
    case 'diagram': {
      if (target.diagram) return aboutInDiagram(diagram, target, 'the change file', aboutDiagramOfChange(change, diagram, files));
      return ['The diagram of the change: one node for each part, one arrow for each link.',
        ...(links.length ? [linksChecked(links, change.checked ?? []) ? 'Checked: a second agent read each link against its code.' : 'Its links are not checked yet by a second agent.'] : []),
        ...links.map((link) => `${partName(link.from)} uses ${partName(link.to)}${link.label ? ` (${link.label})` : ''}`)];
    }
    case 'note': {
      const there = notesHere.flatMap((part) => part.notes ?? []).filter((candidate) => candidate.file === target.file && candidate.lines[0] === target.lines?.[0]);
      const note = there.find((candidate) => Boolean(candidate.removed) === Boolean(target.removed)) ?? there[0];
      if (!note) return gone(`A note on ${target.file}`);
      if (!note.removed) return [`Note "${note.title}"`, ...(note.text ? [note.text] : []), `On ${note.file}, ${where(note)}`];
      return [`Note "${note.title}"`, ...(note.text ? [note.text] : []),
        `On ${note.file}, ${where(note)}. These are removed lines: the change removed them, and the numbers count in the file as it was before the change.`,
        ...codeLines(change, files.find((file) => file.path === note.file)?.renamedFrom ?? note.file, note.lines, change.base, note.inCell?.at)];
    }
    case 'test':
      return [`Test ${target.name ?? '?'}`, `In ${target.file}${target.lines ? `, ${linesText(target.lines)}` : ''}`];
    default: {
      // Code lines, and an open point with its lines.
      if (!target.file || !target.lines) return [target.label ?? target.kind];
      // Lines of a notebook count in the text of its cells: said here as a cell and the lines inside it.
      const inCell = isNotebookPath(target.file) ? cellOfLine(cellsOfText(fileText(change.folder, target.file) ?? ''), target.lines[0]) : undefined;
      if (inCell) {
        const at = inCell.cell.at;
        return [`${target.file}, cell ${inCell.cell.number}, ${linesText([target.lines[0] - at, target.lines[1] - at])}`, ...codeLines(change, target.file, target.lines, undefined, at)];
      }
      return [`${target.file}, ${linesText(target.lines)}`, ...codeLines(change, target.file, target.lines)];
    }
  }
}

/** The diagrams that a file is a part of, the widest first, each with its nodes or parts that are about the file. */
export function diagramsOfFile(store: Store, folder: string, file: string): string[] {
  const lines = diagramsOf(store, folder, file).map((entry) => {
    const graph = entry.diagram && diagramGraph(entry.diagram);
    const about = entry.lit.map((id) => `"${graph?.nodes[id] ?? id}"`).join(', ');
    return `${entry.diagram ? '' : 'the diagram of the change '}"${entry.line}"${about ? `: ${about}` : ''}`;
  });
  return lines.length ? ['It is in these diagrams:', ...lines] : [];
}

/** What a remark on a change is about, for the agent: the lines of its thing, and for a file the diagrams that the file is in. */
export const aboutInChange = (store: Store, change: StoredChange, target: RemarkTarget, files?: ChangedFile[]): string[] =>
  [...aboutTarget(change, target, files), ...(target.kind === 'file' && target.file ? diagramsOfFile(store, change.folder, target.file) : [])];

export interface ReviewContext {
  change?: { id: number; branch: string; title: string; reason: string; base: string };
  open: AppState; // what the owner has open and selected
  // remarks that no agent has read yet, and that are not done or closed; a reply has the earlier lines of its thread;
  // `about` says what the owner pointed at; a remark on the map of the repo has "On the map of the repo" first
  remarks: (Pick<Remark, 'id' | 'state' | 'target' | 'text'> & { earlier?: ThreadLine[]; about: string[] })[];
  openPoints: Pick<OpenPoint, 'kind' | 'text' | 'file' | 'lines' | 'diagram' | 'node' | 'edge' | 'name'>[]; // an open point at a node or an arrow names its diagram and thing
}

/** Everything the owner selected, opened and wrote for the change of this folder, and his remarks on the map of its repo. */
export function reviewContext(store: Store, folder: string, markSent = false): ReviewContext {
  const change = changeOfFolder(store, folder);
  const repo = repoId(folder);
  const files = change ? filesOfChange(change) : [];
  const map = store.getMap(repo)?.map;
  const waiting = (remark: Remark): boolean => remark.state !== 'done' && remark.state !== 'closed';
  const entry = (remark: Remark, about: string[]) => {
    const earlier = earlierInThread(store, remark);
    return { id: remark.id, state: remark.state, target: remark.target, text: remark.text, ...(earlier.length ? { earlier } : {}), about };
  };
  const remarks = [
    ...(change ? store.remarks(change.id, true).filter(waiting).map((remark) => entry(remark, aboutInChange(store, change, remark.target, files))) : []),
    ...store.repoRemarks(repo, true).filter(waiting).map((remark) => entry(remark, aboutMapTarget(map, remark.target))),
  ];
  const openPoints = change ? store.openPoints(change.id).map(({ id, changeId, part, used, ...point }) => point) : [];
  if (markSent) {
    if (change) store.markRemarksSent(change.id);
    store.markRepoRemarksSent(repo);
  }
  return {
    ...(change ? { change: { id: change.id, branch: change.branch, title: change.file.title, reason: change.file.reason, base: change.base } } : {}),
    open: store.appState(), remarks, openPoints,
  };
}

export type DiagramTitle = Omit<Diagram, 'mermaid' | 'before'> & { branch: string };

/** One short entry for each diagram of the repo. A path limits the list to diagrams of files under it. */
export function diagramTitles(store: Store, folder: string, path = ''): DiagramTitle[] {
  return store.listChanges(repoId(folder)).flatMap((change) =>
    (change.file.diagrams ?? [])
      .filter((diagram) => !path || (diagram.file ?? '').startsWith(path))
      .map(({ mermaid, before, ...title }) => ({ ...title, branch: change.branch })));
}

export interface ShownDiagram {
  diagram: Diagram;
  branch: string;
  code?: { file: string; lines: [number, number]; text: string }; // the code lines that the diagram is about
}

/** One diagram in full, with the code lines of its function when the notes name them. */
export function showDiagram(store: Store, folder: string, id: string): ShownDiagram | undefined {
  for (const change of store.listChanges(repoId(folder))) {
    const diagram = (change.file.diagrams ?? []).find((candidate) => candidate.id === id);
    if (!diagram) continue;
    const notes = change.file.parts.flatMap((part) => part.notes ?? [])
      .filter((note) => diagram.symbol && note.symbol === diagram.symbol && note.file === diagram.file);
    if (notes.length === 0) return { diagram, branch: change.branch };
    const lines: [number, number] = [Math.min(...notes.map((note) => note.lines[0])), Math.max(...notes.map((note) => note.lines[1]))];
    const text = (fileText(folder, diagram.file!) ?? '').split('\n').slice(lines[0] - 1, lines[1]).join('\n');
    return { diagram, branch: change.branch, code: { file: diagram.file!, lines, text } };
  }
  return undefined;
}
