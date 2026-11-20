// Builds what the page shows for one change, from the store and from Git, and answers what a hover window asks for.
// VS Code and the example script both use these functions, so the page sees the same data in both.

import { basename, dirname } from 'node:path';
import { opencodeSmallModel, resumeCommand, sessionLink, sessionName, type AgentSession, type RunModels } from '../shared/agents';
import { menuOf, sessionPick, type ModelMenu, type RunPick } from '../shared/models';
import type { ChangeFile, Diagram, Link, Note } from '../shared/change-file';
import { cellsIn, checkChangeFile, fileChange } from '../shared/checks';
import { diagramChange, withRemoved, type DiagramChange, type DrawnEdge } from '../shared/diagram-change';
import { inNoThingWords, linesInNoThing, linkThings, linksChecked, REASON_WORDS, thingCounts, thingsOf, type FileChange, type Thing, type ThingCode } from '../shared/diagram-code';
import { diagramGraph, type DiagramGraph } from '../shared/diagram-graph';
import { schemaDrawing, type SchemaDrawing } from '../shared/schema';
import { findTests } from '../shared/find-tests';
import { addedLines, diffLines, removedLines, toRanges, type DiffLine, type RemovedLine } from '../shared/diff-lines';
import { notesInRepo } from '../shared/notes-beside-code';
import { baseBranchOf, baseOf, changedFiles, commitExists, fileBytes, fileDiff, fileModes, fileText, linkTarget, notebookChange, rawFileText, repoId, tryGit, type ChangedFile } from '../shared/git';
import { cellHead, cellsAt, inCellText, isNotebookPath, placeInCell, readNotebook, type NotebookCells } from '../shared/notebook';
import { githubRepoOf, type PullRequestView } from '../shared/read-pull-request';
import { changeWhere, savedWords, type SavedAt } from '../shared/change-rows';
import { repoDiagramOf, type RepoDiagram } from '../shared/repo-diagram';
import type { RepoMap } from '../shared/repo-map';
import type { CheckResult, OpenPoint, Remark, RemarkTo, Store } from '../shared/store';
import { broadMermaid, broadTotal, changeMermaid, drillUpStyle, partMermaid, type BroadTotal } from './change-diagram';
import { lookData, standingMarks, type LookData, type MarkHere } from './look-data';

export interface PageNote extends Note {
  key: string; // "<part id>/<index>", the same in every load of the page
  part: string;
  linkedTests: number; // tests of this note alone: the ones that the agent linked
  failed?: string; // why the line check failed
  check?: string; // the text of a fresh-check point that the code does not support this note
  pointId?: number;
  from?: { title: string; branch: string; map?: true }; // a note of another saved change or of the map, found by the text of its lines: where it came from (for the map, the title of its diagram); it has no colour of the diff
}

/** The code of a node or an arrow as the page shows it: its places or its reason in words, and its diff (the sum over its places). */
export type PageCode = ThingCode & { why?: string; counts?: { added: number; removed: number } };

/** A link between parts as the page shows it: `code` holds its places or its reason, and its diff (page data of pageCodes). */
export type PageLink = Link & { code?: PageCode };

/** The code of each thing as the page shows it, by its key: its places or its reason in words, and its diff, the sum over its places. */
export function pageCodes(things: Thing[], fileChange: (path: string) => FileChange): Record<string, PageCode> {
  const counts = thingCounts(things, fileChange);
  const code: Record<string, PageCode> = {};
  for (const thing of things) {
    if (!thing.code) continue;
    const count = counts[thing.key];
    const diff = count && (count.added || count.removed) ? { added: count.added, removed: count.removed } : undefined;
    code[thing.key] = { ...thing.code, ...(thing.code.reason ? { why: REASON_WORDS[thing.code.reason] } : {}), ...(diff ? { counts: diff } : {}) };
  }
  return code;
}

/**
 * A diagram as the page draws it. A diagram of a part also has: `code`, the code of each thing by its key (shared/diagram-code.ts); `edges`, its arrows in the
 * order of the drawing, each with its key; `inNoThing`, the changed lines of the code that it covers that are in no node and no arrow; `checked`, whether a second agent read it.
 */
export type PageDiagram = Diagram & {
  draw: string; plain?: string; change?: DiagramChange; difference?: BroadTotal; graph: DiagramGraph;
  code: Record<string, PageCode>; edges: DrawnEdge[]; inNoThing?: number[]; inNoThingRemoved?: number[]; inNoThingWords?: string; checked: boolean;
  schema?: SchemaDrawing; // a schema diagram: its tables and relations, which the page draws itself
};

/** A changed file as the page shows it. */
export interface PageFile extends ChangedFile {
  what?: string; // one line in place of its text: "Binary file, 4 KB", "Empty file", "Link to <path>", "Only the mode changed: now executable"
  picture?: true; // a picture: the page shows it, before and after for a changed one
  quiet?: string; // one quiet line beside its name: "only outputs changed" (it starts folded), "does not read as a notebook, shown as text"
  cells?: NotebookCells; // a notebook: its cells before and now, for the heads of the cells in its rows
}

export interface PagePart {
  id: string;
  name: string;
  note?: string;
  files: string[];
  diagrams: string[]; // ids of the diagrams that explain this part
  drillUp?: string; // the change diagram after drill up from this part: its diagram whole, or the part lit
  drillUpPlain?: string; // the same without the removed things of its diagram, for when that text does not draw
}

/** The agent of a change, with the link that opens its session and whether a run can continue it from here. */
export interface PageAgent extends AgentSession {
  link?: string;
  canResume: boolean;
}

/** The name of a session comes from the app's own files when it has one there, else from the save. */
export const agentOf = (agent: AgentSession): PageAgent => ({
  ...agent, name: sessionName(agent) ?? agent.name, link: sessionLink(agent), canResume: !!resumeCommand(agent, ''),
});

export interface PageData {
  changeId: number;
  repo: string;
  folder: string; // where Git is read
  branch: string;
  base: string;
  baseBranch?: string; // the branch that the change is compared with, when it is not the main branch
  title: string;
  reason: string;
  outOfDate: boolean; // the check was run again because the branch moved
  checks: CheckResult;
  files: PageFile[]; // every changed file, from Git
  parts: PagePart[];
  links: PageLink[]; // each link with its code
  linksChecked: boolean; // a second agent read every link against its code for this save
  // "draw" is the Mermaid text that the page renders; "difference" the parts that a change adds and removes; "graph" its nodes and arrows, for comments on them.
  // A diagram of a part: "change" is what the change did to it, and "plain" the text without the removed things, for when "draw" does not draw.
  diagrams: PageDiagram[];
  changeDiagram: string;
  altered: string[]; // ids of the broad diagrams that this change alters: each one is a card under the change
  notes: PageNote[];
  functionTests: Record<string, number>; // the tests that call a function, by its name; shown once for the function
  openPoints: OpenPoint[]; // every finding of the fresh check; one that belongs to a note is also on that note
  remarks: Remark[]; // every remark with its state and answer
  agent?: PageAgent;
  listening: boolean; // the session of the change has a live waiter, so a sent remark reaches it
  apps: string[]; // the connected agent apps (on the path, with the skills of Apostil), Claude Code first: "@" and the picker of a card offer them
  sendTo?: SendTo; // what the picker of a card offers besides the apps: the known sessions, the model of a new session, the last choice
  onHome: Record<string, RepoDiagram>; // by the id of a diagram of this change: the repo diagram that it draws on ("of"), which the link "on Home" opens
  head?: string; // the commit that the diffs end at: a pull request, or a change, that is not checked out
  savedWords?: string; // one quiet line: the change is shown as saved at a commit, or that this clone has no such commit
  pullOnly?: PullOnly; // a pull request with no stored change: the page has "Conversation" and "Diffs"
  branchOnly?: true; // the open branch with no change file: the page has "Diffs", and "Conversation" when the branch has a pull request
  plain?: true; // a file tab with no change: the code as it is, with no diff, and the notes beside it
  look?: LookData; // the look of the repo for the page and its file tabs; the marks of a file come with its code
}

/** What the picker of where a comment goes offers, besides the connected apps. */
export interface SendTo {
  // the other sessions that Apostil knows in the repo and that a run can continue in its folder, newest first, each with the model and effort it last used
  sessions: { app: string; session: string; name?: string; at: string; run?: RunPick }[];
  models: Record<string, ModelMenu>; // by app: its newest models (shared/models.ts) and the model of a new session (its setting, the small model of OpenCode)
  own?: RunPick; // the model and effort that the session of the change last used
  last?: RemarkTo | null; // where the newest comment of the repo went (null: to no agent); missing when the repo has none
}

/** The model settings of the runs by app: Claude Code, Codex and Antigravity from VS Code, OpenCode its small model of its own config. */
const settingsOf = (models: RunModels, folder: string): Record<string, string | undefined> => ({ 'claude-code': models.claude, codex: models.codex, antigravity: models.antigravity, opencode: opencodeSmallModel(folder) });

/** The menus of the models of each connected app (shared/models.ts), for the picker of a comment on a change and on Home. */
export const menusOf = (apps: string[], models: RunModels, folder: string): Record<string, ModelMenu> => {
  const settings = settingsOf(models, folder);
  return Object.fromEntries(apps.filter((app) => app in settings).map((app) => [app, menuOf(app, settings[app])]));
};

/**
 * The sessions, models and last choice of the picker of a change: only connected apps, and sessions other than the session of the change. Each session
 * has what it last used, from its own record; a new session the model of the setting.
 */
export function sendToOf(store: Store, repo: string, folder: string, apps: string[], models: RunModels, own?: AgentSession): SendTo {
  const newest = new Map<string, SendTo['sessions'][number]>();
  for (const one of store.knownSessions(repo, folder)) {
    const { app, session } = one.agent;
    if (!session || session === own?.session || !apps.includes(app) || (one.folder ?? folder) !== folder || !resumeCommand(one.agent, '')) continue;
    const key = `${app}:${session}`;
    if ((newest.get(key)?.at ?? '') >= one.at) continue;
    const name = sessionName(one.agent) ?? one.agent.name;
    newest.set(key, { app, session, ...(name ? { name } : {}), at: one.at });
  }
  const settings = settingsOf(models, folder);
  const newestFirst = [...newest.values()].sort((a, b) => b.at.localeCompare(a.at));
  const sessions = newestFirst.filter((one) => newestFirst.filter((other) => other.app === one.app).indexOf(one) < 3) // a picker shows at most 3 of each app
    .map((one) => ({ ...one, run: sessionPick(one.app, one.session, settings[one.app]) }));
  const last = store.lastRemarkTo(repo);
  return {
    sessions,
    models: menusOf(apps, models, folder),
    ...(own?.session && apps.includes(own.app) && own.app in settings ? { own: sessionPick(own.app, own.session, settings[own.app]) } : {}),
    ...(last !== undefined ? { last } : {}),
  };
}

/** A page for a pull request with no stored change. */
export interface PullOnly {
  link: string;
  number: number;
  local: boolean; // its commits are in the folder, so "Diffs" shows its diffs
  otherRepo: boolean; // a pull request of another repo: "Conversation" and the list of its files only
  fetch?: string; // the command that gets its commits, when they are not in the folder
  remote?: string; // the remote of that command: Apostil runs it itself in the background
  fetching?: boolean; // Apostil is getting its commits now
  fetchProblem?: string; // what git said when getting them failed
}

/** The stored map of the repo of a folder. */
export function mapOfFolder(store: Store, folder: string): RepoMap | undefined {
  const id = tryGit(folder, 'rev-list', '--max-parents=0', 'HEAD')?.split('\n').pop();
  return id ? store.getMap(id)?.map : undefined;
}

/** The page data of a stored change. `openFolder` is used when the folder of the change is gone. */
export function pageData(store: Store, changeId: number, openFolder: string, apps: string[] = [], models: RunModels = {}): PageData | undefined {
  const change = store.getChange(changeId);
  if (!change) return undefined;
  const { folder, saved } = changeWhere(change, openFolder);
  const head = tryGit(folder, 'rev-parse', change.branch);
  const outOfDate = !saved && head !== undefined && head !== change.head;
  const checks = outOfDate ? checkChangeFile(folder, change.base, change.file) : change.checks;
  return buildPage({
    changeId, folder, branch: change.branch, base: change.base, file: change.file, checks, outOfDate, saved,
    openPoints: store.openPoints(changeId), remarks: store.remarks(changeId),
    agent: change.agent, listening: isListening(store, change.agent), apps, map: mapOfFolder(store, folder), checked: change.checked ?? [],
    sendTo: sendToOf(store, change.repoId, change.folder, apps, models, change.agent),
  });
}

/** True when a live waiter holds the session of the agent. */
export function isListening(store: Store, agent: AgentSession | undefined): boolean {
  return !!agent?.session && store.waiters().some((waiter) => waiter.alive && waiter.session === agent.session);
}

interface PageInput {
  changeId: number;
  folder: string;
  branch: string;
  base: string;
  file: ChangeFile;
  checks: CheckResult;
  outOfDate: boolean;
  openPoints: OpenPoint[];
  remarks: Remark[];
  agent?: AgentSession;
  listening: boolean;
  apps: string[];
  saved?: SavedAt; // the folder is not on the branch: files and diffs come from the saved commit
  map?: RepoMap; // the stored map of the repo: the diagrams that the diagrams of the change draw on
  checked: string[]; // the diagrams that a second agent read for this save, and "links:<part id>" for the links that leave a part
  sendTo?: SendTo;
}

/** What partDiagram reads from Git: the lines of a file that the change added and removed, the lines of a file now, and two facts of the diagram. */
export interface PartFacts {
  fileChange(path: string): FileChange;
  text(path: string): string[];
  fileIsNew: boolean; // the change added the file of the diagram
  checked: boolean; // a second agent read the diagram for this save
}

/** A diagram of a part as the page draws it: the code of each thing with its diff, what the change did to it, and the changed lines in no node and no arrow. */
export function partDiagram(diagram: Diagram, facts: PartFacts): PageDiagram {
  const graph = diagramGraph(diagram);
  const { things } = thingsOf(diagram);
  const counts = thingCounts(things, facts.fileChange);
  const change = diagramChange(diagram, { counts, fileIsNew: facts.fileIsNew });
  const code = pageCodes(things, facts.fileChange);
  const added = diagram.file ? facts.fileChange(diagram.file).added : [];
  const inNoThing = diagram.covers && diagram.file
    ? linesInNoThing(diagram, things, (line) => added.some(([first, last]) => first <= line && line <= last), facts.text(diagram.file), facts.fileChange(diagram.file).removed)
    : { added: [], removed: [] };
  const plain = partMermaid(diagram.kind, diagram.mermaid, code, things.filter((thing) => thing.node && !thing.removed).map((thing) => thing.key));
  const back = withRemoved(diagram, change, plain); // the removed things put back, a removed step with its line too
  const draw = back && partMermaid(diagram.kind, back, code, things.filter((thing) => thing.node && thing.removed).map((thing) => thing.key));
  return {
    ...diagram, draw: draw ?? plain, ...(draw ? { plain } : {}), ...(change ? { change } : {}), graph, code,
    edges: change?.edges ?? graph.edges.map((edge, at) => ({ ...edge, key: `edge:${at}` })), checked: facts.checked,
    ...(diagram.kind === 'schema' ? { schema: schemaDrawing(diagram, change) } : {}),
    ...(inNoThing.added.length + inNoThing.removed.length ? { inNoThing: inNoThing.added, inNoThingRemoved: inNoThing.removed, inNoThingWords: inNoThingWords(diagram.kind, inNoThing) } : {}),
  };
}

function buildPage(input: PageInput): PageData {
  const { folder, saved } = input;
  const head = saved?.missing ? undefined : saved?.commit; // read at the saved commit, not in the working tree
  const files = saved?.missing ? [] : describeFiles(folder, input.base, changedFiles(folder, input.base, head), head);
  const named = underNewNames(input.file, input.checks, files);
  const { checks } = named;
  const cells = cellsIn(folder, input.base, files, head);
  const file = inCellText(named.file, cells).file; // a place in a cell of a notebook as lines of the text of its cells
  // An open point in a cell of a notebook goes the same way, so that it finds its note and its rows.
  const openPoints = input.openPoints.map((point) => {
    const at = point.cell !== undefined && point.file && point.lines ? cells(point.file, false) : undefined;
    const found = at && placeInCell(at, point.file!, point.cell!, point.lines!);
    return found && 'lines' in found ? { ...point, lines: found.lines, inCell: found.inCell } : point;
  });
  const fileChanges = new Map<string, FileChange>();
  const changeOfFile = (path: string): FileChange => {
    if (!fileChanges.has(path)) fileChanges.set(path, fileChange(folder, input.base, path, files, head));
    return fileChanges.get(path)!;
  };
  const diagrams = (file.diagrams ?? []).map((diagram): PageDiagram => {
    if (!diagram.broad) {
      return partDiagram(diagram, {
        fileChange: changeOfFile, text: (path) => (fileText(folder, path, head) ?? '').split('\n'),
        fileIsNew: !!diagram.file && files.find((one) => one.path === diagram.file)?.status === 'added', checked: input.checked.includes(diagram.id),
      });
    }
    const graph = diagramGraph(diagram);
    return {
      ...diagram, draw: broadMermaid(diagram), difference: broadTotal(diagram), graph, code: {}, edges: graph.edges.map((edge, at) => ({ ...edge, key: `edge:${at}` })), checked: false,
      ...(diagram.kind === 'schema' ? { schema: schemaDrawing(diagram) } : {}),
    };
  });
  const diagramInput = { parts: file.parts, links: file.links, files, filesInNoPart: checks.filesInNoPart };
  const linkCode = pageCodes(linkThings(file.links), changeOfFile);
  const links: PageLink[] = file.links.map((link, at) => ({ ...link, ...(linkCode[`link:${at}`] ? { code: linkCode[`link:${at}`] } : {}) }));

  const parts: PagePart[] = file.parts.map((part) => {
    const own = diagrams.filter((diagram) => diagram.part === part.id && !diagram.broad);
    const first = own[0];
    const whole = first && drillUpStyle(first) === 'whole';
    const withGone = whole && first.plain ? withRemoved(first, first.change, first.mermaid) : undefined; // its removed things, put back
    return {
      id: part.id, name: part.name, note: part.note, files: part.files, diagrams: own.map((diagram) => diagram.id),
      drillUp: first ? changeMermaid(diagramInput, { part: part.id, whole: whole ? withGone ?? first.mermaid : undefined }) : undefined,
      ...(withGone ? { drillUpPlain: changeMermaid(diagramInput, { part: part.id, whole: first.mermaid }) } : {}),
    };
  });

  // Each "note-not-supported" point belongs to the note whose lines hold its first line.
  const functionTests: Record<string, number> = {};
  const notes: PageNote[] = file.parts.flatMap((part) => (part.notes ?? []).map((note, index) => {
    const failed = checks.badNotes.find((bad) => bad.part === part.id && bad.title === note.title)?.problem;
    if (note.symbol && functionTests[note.symbol] === undefined) functionTests[note.symbol] = findTests(folder, note.symbol).length;
    return { ...note, key: `${part.id}/${index}`, part: part.id, linkedTests: note.tests?.length ?? 0, failed };
  }));
  for (const point of openPoints) {
    const note = point.kind === 'note-not-supported' && point.lines
      ? notes.find((candidate) => candidate.file === point.file && candidate.lines[0] <= point.lines![0] && point.lines![0] <= candidate.lines[1] && !candidate.check)
      : undefined;
    if (note) Object.assign(note, { check: point.text, pointId: point.id });
  }

  return {
    changeId: input.changeId, repo: repoName(folder), folder, branch: input.branch, base: input.base, baseBranch: baseBranchOf(folder, input.branch, input.base),
    title: file.title, reason: file.reason, outOfDate: input.outOfDate, checks, files, parts, links, linksChecked: linksChecked(file.links, input.checked), diagrams,
    changeDiagram: changeMermaid(diagramInput),
    altered: diagrams.filter((diagram) => diagram.difference).map((diagram) => diagram.id),
    notes, functionTests, openPoints, remarks: input.remarks,
    agent: input.agent && agentOf(input.agent), listening: input.listening, apps: input.apps, ...(input.sendTo ? { sendTo: input.sendTo } : {}),
    onHome: Object.fromEntries((file.diagrams ?? []).flatMap((diagram) => {
      const repo = repoDiagramOf(input.map, diagram);
      return repo ? [[diagram.id, repo]] : [];
    })),
    ...(saved ? { savedWords: savedWords(saved), ...(head ? { head } : {}) } : {}),
  };
}

/**
 * A renamed file under its new name only: a part or a note that names its old path names the new path on the page,
 * so a part lists it once. The checks keep their message about the old path (renamedFiles).
 */
function underNewNames(file: ChangeFile, checks: CheckResult, files: ChangedFile[]): { file: ChangeFile; checks: CheckResult } {
  const newName = new Map(files.flatMap((one) => (one.renamedFrom ? [[one.renamedFrom, one.path] as const] : [])));
  if (!newName.size) return { file, checks };
  const named = (path: string): string => newName.get(path) ?? path;
  const parts = file.parts.map((part) => ({
    ...part, files: [...new Set(part.files.map(named))], notes: part.notes?.map((note) => (note.removed ? note : { ...note, file: named(note.file) })),
  }));
  const inParts = new Set(parts.flatMap((part) => part.files));
  return {
    file: { ...file, parts },
    checks: { ...checks, filesInNoPart: checks.filesInNoPart.filter((path) => !inParts.has(path)), filesNotChanged: checks.filesNotChanged.filter((path) => !newName.has(path)) },
  };
}

const PICTURE = /\.(png|jpe?g|gif|webp|bmp|ico)$/i;
const LINK = '120000';
const RUNS = '100755';

/** "4 KB": the size of a file in plain words. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} byte${bytes === 1 ? '' : 's'}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const QUIET = { 'only-outputs': 'only outputs changed', 'not-read': 'does not read as a notebook, shown as text' };

/** Gives each file whose text is not worth showing one line that says what it is, and a notebook its cells. */
function describeFiles(folder: string, base: string, files: ChangedFile[], head?: string): PageFile[] {
  const modes = fileModes(folder, base, head);
  return files.map((one) => {
    const cells = notebookChange(folder, base, one, head)?.heads;
    const file: PageFile = { ...one, ...(one.notebook ? { quiet: QUIET[one.notebook] } : {}), ...(cells ? { cells } : {}) };
    const mode = modes.get(file.path);
    const gone = file.status === 'removed';
    const commit = gone ? base : head; // where the file is read: a removed file at the base, else as it is now
    const target = !mode || mode[gone ? 'before' : 'now'] === LINK ? linkTarget(folder, file.path, commit) : undefined; // a new file that Git does not know yet has no mode
    if (target !== undefined) return { ...file, what: `Link to ${target.trim()}` };
    if (file.binary) {
      const bytes = fileBytes(folder, file.path, commit);
      const size = bytes ? sizeText(bytes.length) : '';
      return PICTURE.test(file.path) ? { ...file, picture: true, what: `Picture${size ? `, ${size}` : ''}` } : { ...file, what: `Binary file${size ? `, ${size}` : ''}` };
    }
    if (file.status === 'added' && !file.added) return { ...file, what: 'Empty file' };
    if (mode && mode.before !== mode.now && !file.added && !file.removed && !file.renamedFrom) {
      return { ...file, what: `Only the mode changed: now ${mode.now === RUNS ? 'executable' : 'not executable'}` };
    }
    return file;
  });
}

/** The name of the repo: the folder that holds its shared .git folder, so every worktree shows the same name. */
export function repoName(folder: string): string {
  const common = tryGit(folder, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  return common ? basename(dirname(common)) : basename(folder);
}

/** Page data for a change file that is not stored, for the example page in a browser. */
export function examplePage(folder: string, base: string, file: ChangeFile, openPoints: OpenPoint[], remarks: Remark[] = [], agent?: AgentSession, apps: string[] = [], map?: RepoMap, changeId = 0, checked: string[] = [], sendTo?: SendTo): PageData {
  return buildPage({
    changeId, folder, branch: tryGit(folder, 'branch', '--show-current') ?? 'example', base, file,
    checks: checkChangeFile(folder, base, file), outOfDate: false, openPoints, remarks, agent, listening: false, apps, map, checked, sendTo,
  });
}

/**
 * The page of a pull request with no stored change. Its commits in the folder: its files from Git, all in no part.
 * Not in the folder, or another repo: the files and counts from GitHub, and no diffs.
 */
export function pullOnlyPage(folder: string, pull: PullRequestView, apps: string[] = []): PageData {
  const github = githubRepoOf(folder);
  const otherRepo = !github || github.slug.toLowerCase() !== pull.repo.toLowerCase();
  const base = !otherRepo && commitExists(folder, pull.baseOid) && commitExists(folder, pull.headOid) ? tryGit(folder, 'merge-base', pull.baseOid, pull.headOid) : undefined;
  const files: PageFile[] = base ? describeFiles(folder, base, changedFiles(folder, base, pull.headOid), pull.headOid) : pull.files;
  const pullOnly: PullOnly = {
    link: pull.url, number: pull.number, local: !!base, otherRepo,
    fetch: !base && !otherRepo ? `git fetch ${github!.remote} pull/${pull.number}/head` : undefined,
    remote: !base && !otherRepo ? github!.remote : undefined,
  };
  return {
    changeId: 0, repo: pull.repo, folder, branch: pull.head, base: base ?? pull.baseOid, head: pull.headOid, title: pull.title, reason: '', outOfDate: false,
    checks: { filesInNoPart: files.map((file) => file.path), filesInTwoParts: [], filesNotChanged: [], generated: [], badNotes: [] },
    files, parts: [], links: [], linksChecked: false, diagrams: [], changeDiagram: '', altered: [], notes: [], functionTests: {}, openPoints: [], remarks: [],
    listening: false, apps, onHome: {}, pullOnly,
  };
}

/** The page of the open branch with no change file: its changed files against its base, committed or not, with their diffs, all in no part. */
export function branchPage(folder: string, apps: string[] = [], store?: Store, models: RunModels = {}): PageData {
  const branch = tryGit(folder, 'branch', '--show-current') || 'detached';
  const base = baseOf(folder, branch);
  const files = describeFiles(folder, base, changedFiles(folder, base));
  return {
    changeId: 0, repo: repoName(folder), folder, branch, base, title: '', reason: '', outOfDate: false,
    checks: { filesInNoPart: files.map((file) => file.path), filesInTwoParts: [], filesNotChanged: [], generated: [], badNotes: [] },
    files, parts: [], links: [], linksChecked: false, diagrams: [], changeDiagram: '', altered: [], notes: [], functionTests: {}, openPoints: [],
    listening: false, apps, onHome: {}, branchOnly: true, ...repoComments(folder, apps, store, models),
  };
}

/** The page of a file tab when the branch has no stored change: no change and no diff, only the code and the notes of other changes beside it. */
export function filePage(folder: string, apps: string[] = [], store?: Store, models: RunModels = {}): PageData {
  return {
    changeId: 0, repo: repoName(folder), folder, branch: tryGit(folder, 'branch', '--show-current') || 'detached', base: tryGit(folder, 'rev-parse', 'HEAD') ?? '', title: '', reason: '', outOfDate: false,
    checks: { filesInNoPart: [], filesInTwoParts: [], filesNotChanged: [], generated: [], badNotes: [] },
    files: [], parts: [], links: [], linksChecked: false, diagrams: [], changeDiagram: '', altered: [], notes: [], functionTests: {}, openPoints: [],
    listening: false, apps, onHome: {}, plain: true, ...repoComments(folder, apps, store, models),
  };
}

/**
 * The comments of a page with no change (a file tab, the open branch), and where a new one can go.
 * With no change, a comment on code is one of the repo, as a comment on the map is: the threads on files show on these pages, the others on Home.
 */
function repoComments(folder: string, apps: string[], store?: Store, models: RunModels = {}): Pick<PageData, 'remarks' | 'sendTo'> {
  const repo = store ? (() => { try { return repoId(folder); } catch { return undefined; } })() : undefined;
  if (!store || !repo) return { remarks: [] };
  return { remarks: repoRemarksOnFiles(store.repoRemarks(repo)), sendTo: sendToOf(store, repo, folder, apps, models) };
}

/** The threads of the repo whose first comment is on a file (lines of code, a note beside it): the file tab shows them, Home does not. */
export const repoRemarksOnFiles = (remarks: Remark[]): Remark[] => {
  const onFile = new Set(remarks.filter((remark) => !remark.thread && 'file' in remark.target && !!remark.target.file).map((remark) => remark.id));
  return remarks.filter((remark) => onFile.has(remark.thread ?? remark.id));
};

/**
 * The notes of other saved changes of the repo beside a file of a page, found by the text of their lines (shared/notes-beside-code.ts).
 * The notes of the change of the page are on the page already, so they are left out, as is a note of another change that the page has at the same lines.
 */
export function notesBeside(store: Store, page: PageData, path: string, lines: string[]): PageNote[] {
  let found;
  try { found = notesInRepo(store, page.folder, path, lines.join('\n')); } catch { return []; }
  const own = page.notes.filter((note) => note.file === path && !note.removed);
  return found.notes
    .filter((here) => (here.change.map || here.change.id !== page.changeId) && !own.some((note) => note.title === here.note.title && note.lines[0] === here.lines[0] && note.lines[1] === here.lines[1]))
    .map((here) => ({
      file: path, lines: here.lines, title: here.note.title, ...(here.note.text ? { text: here.note.text } : {}), ...(here.note.symbol ? { symbol: here.note.symbol } : {}),
      key: `beside:${here.key}`, part: '', linkedTests: 0, from: { title: here.change.title, branch: here.change.branch, ...(here.change.map ? { map: true as const } : {}) },
    }));
}

/** Gives the notes of other changes beside a file, for the answer to "code:<path>". */
export type OtherNotes = (path: string, lines: string[]) => PageNote[];

/**
 * The look of the repo of a page, for the whole page of a change and its file tabs; also for a repo with no map, whose look then has no marks.
 * `address` turns a kept file of the look into an address that the page may load (a picture in place of a step). Its marks are those of the files of
 * the parts and of the places of their diagrams: the parts and the steps of their flow charts roll them up. A file tab gets the marks of
 * its file with its code.
 */
export function lookOfPage(store: Store, page: PageData, address: (file: string) => string = (file) => file): LookData | undefined {
  try {
    const places = page.diagrams.filter((diagram) => !diagram.broad).flatMap((diagram) => Object.values(diagram.code).flatMap((code) => code.places.map((place) => place.file)));
    return { ...lookData(store, repoId(page.folder), page.folder, address, false), marks: marksIn(store, page, [...page.parts.flatMap((part) => part.files), ...places]) };
  } catch {
    return undefined;
  }
}

/**
 * The marks of the map that stand in some files of a page, each with its line in the file as the change has it. None for a page that shows a commit
 * (a change or a pull request that is not checked out): a mark stands in the text of the folder, and the lines of the page are those of the commit.
 */
function marksIn(store: Store, page: PageData, paths: string[]): MarkHere[] {
  if (page.head) return [];
  const wanted = new Set(paths);
  try {
    return standingMarks(page.folder, (store.getMap(repoId(page.folder))?.map.marks ?? []).filter((mark) => wanted.has(mark.file)));
  } catch {
    return [];
  }
}

/** The marks of the map that stand at the lines of a file now, for the answer to "code:<path>": the note cards show those at their lines. */
export const marksBeside = (store: Store, page: PageData, path: string): MarkHere[] => marksIn(store, page, [path]);

// ----- where GitHub takes a comment on code -----

/** The lines of one file that are in the diff of a pull request, as ranges: right in the file as it is now, left in the file as it was. */
export interface DiffRanges {
  right: [number, number][];
  left: [number, number][];
}

/** What the comment box needs to offer "@github": the code here is at the head commit, the files changed here and not committed, and the lines of the diff. */
export interface PullLines {
  atHead: boolean;
  dirty: string[];
  files: Record<string, DiffRanges>;
}

/** The hunks of a diff of many files, as the ranges of lines on each side. GitHub takes a comment on any line of a hunk. */
export function diffRanges(diff: string): Record<string, DiffRanges> {
  const files: Record<string, DiffRanges> = {};
  let file: DiffRanges | undefined;
  let before = ''; // the path after "---": a removed file has "+++ /dev/null" and keeps its old path
  let head = false; // between "diff --git" and the first hunk, where "---" and "+++" name the file; inside a hunk they are lines of code
  for (const text of diff.split('\n')) {
    if (text.startsWith('diff --git ')) { head = true; file = undefined; continue; }
    if (head && text.startsWith('--- ')) { before = text.replace(/^--- (a\/)?/, ''); continue; }
    if (head && text.startsWith('+++ ')) {
      const path = text === '+++ /dev/null' ? before : text.replace(/^\+\+\+ (b\/)?/, '');
      file = files[path] = { right: [], left: [] };
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(text);
    if (!hunk || !file) continue;
    head = false;
    const [left, leftCount, right, rightCount] = [hunk[1], hunk[2] ?? '1', hunk[3], hunk[4] ?? '1'].map(Number);
    if (rightCount) file.right.push([right, right + rightCount - 1]);
    if (leftCount) file.left.push([left, left + leftCount - 1]);
  }
  return files;
}

/**
 * Where GitHub takes a comment on the code of a pull request. The line numbers of the page are right only when its code is the head commit:
 * a page of a pull request reads that commit, a change reads the folder, which must be at it. The diff is the one GitHub shows, from the merge base.
 */
export function pullLines(page: PageData, pull: PullRequestView): PullLines {
  const head = page.head ?? tryGit(page.folder, 'rev-parse', 'HEAD');
  if (!pull.headOid || head !== pull.headOid) return { atHead: false, dirty: [], files: {} };
  const base = (commitExists(page.folder, pull.baseOid) ? tryGit(page.folder, 'merge-base', pull.baseOid, pull.headOid) : undefined) ?? page.base;
  const diff = tryGit(page.folder, 'diff', '-U3', '--no-color', '--no-ext-diff', '-M', base, pull.headOid) ?? '';
  const dirty = page.head ? [] : (tryGit(page.folder, 'diff', '--name-only', 'HEAD') ?? '').split('\n').filter(Boolean);
  return { atHead: true, dirty, files: diffRanges(diff) };
}

// ----- answers for the hover windows and the code view -----

export { addedLines, diffLines, removedLines, toRanges, type DiffLine, type RemovedLine };

export interface CodeAnswer {
  cells?: NotebookCells; // a notebook: where its cells stand, before and now
  lines: string[]; // the whole file as it is now; for a removed file, as it was at the base
  changed: [number, number][]; // the added and changed lines, as ranges
  removed: RemovedLine[]; // the removed lines of a changed file, each at its place in the file as it is now
  status?: ChangedFile['status']; // missing for a file that the change does not touch
  notes?: PageNote[]; // the notes of other saved changes beside this file, found by the text of their lines
}

export interface TestRow {
  name: string;
  file: string;
  line: number;
  isNew: boolean; // the change adds this test
  added: { line: number; text: string }[]; // its added lines, at most eight
}

export interface TestsAnswer {
  groups: { name: string; tests: TestRow[] }[];
  newCount: number;
}

/** A picture before and after the change, each as a data address with its size; a side is missing when the file is not there or is too large to send. */
export interface PictureAnswer {
  before?: { src: string; size: string };
  after?: { src: string; size: string };
}

const PICTURE_MAX = 4 * 1024 * 1024; // a larger picture is named, not shown
const PICTURE_TYPES: Record<string, string> = { jpg: 'jpeg', jpeg: 'jpeg', ico: 'x-icon' };

function pictureOf(page: PageData, path: string): PictureAnswer | undefined {
  const file = page.files.find((candidate) => candidate.path === path);
  if (!file?.picture) return undefined;
  const ending = path.split('.').pop()!.toLowerCase();
  const side = (bytes: Buffer | undefined) => (bytes && bytes.length <= PICTURE_MAX
    ? { src: `data:image/${PICTURE_TYPES[ending] ?? ending};base64,${bytes.toString('base64')}`, size: sizeText(bytes.length) } : undefined);
  return {
    before: file.status === 'added' ? undefined : side(fileBytes(page.folder, file.renamedFrom ?? path, page.base)),
    after: file.status === 'removed' ? undefined : side(fileBytes(page.folder, path, page.head)),
  };
}

/**
 * Answers one question of the page: "diff:<path>", "code:<path>", "picture:<path>", "tests:<function>" or "linked:<note key>".
 * With `others`, the code of a file comes with the notes of other saved changes beside it.
 */
export function answer(page: PageData, question: string, others?: OtherNotes, marksOf?: (path: string) => MarkHere[]): unknown {
  const [kind, ...rest] = question.split(':');
  const key = rest.join(':');
  if (kind === 'diff') return diffLines(fileDiff(page.folder, page.base, key, page.head, page.files.find((file) => file.path === key)?.renamedFrom));
  if (kind === 'code') {
    const code = codeOf(page, key);
    const beside = code.status !== 'removed' && !page.head;
    const notes = others && beside ? others(key, code.lines) : [];
    const marks = marksOf && beside ? marksOf(key) : [];
    return { ...code, ...(notes.length ? { notes } : {}), ...(marks.length ? { marks } : {}) };
  }
  if (kind === 'picture') return pictureOf(page, key);
  if (kind === 'tests' || kind === 'linked') return testsOf(page, kind, key);
  return undefined;
}

/** The cells of a notebook that the change does not touch, as it is now: their heads, with nothing before. */
function cellsNow(page: PageData, path: string): NotebookCells | undefined {
  const cells = isNotebookPath(path) ? readNotebook(rawFileText(page.folder, path, page.head) ?? '') : undefined;
  return cells && { now: cellsAt(cells).map((cell) => cellHead(cell, `now:${cell.number}`)), before: [] };
}

function codeOf(page: PageData, path: string): CodeAnswer {
  const code = plainCodeOf(page, path);
  const file = page.files.find((candidate) => candidate.path === path);
  const cells = file ? file.cells : cellsNow(page, path);
  return cells ? { cells, ...code } : code;
}

function plainCodeOf(page: PageData, path: string): CodeAnswer {
  const file = page.files.find((candidate) => candidate.path === path);
  if (file?.status === 'removed') return { lines: (fileText(page.folder, path, page.base) ?? '').replace(/\n$/, '').split('\n'), changed: [], removed: [], status: 'removed' };
  const text = fileText(page.folder, path, page.head) ?? '';
  const lines = text.replace(/\n$/, '').split('\n');
  if (page.plain) return { lines, changed: [], removed: [] };
  if (file?.status === 'added') return { lines, changed: [[1, lines.length]], removed: [], status: 'added' };
  const diff = fileDiff(page.folder, page.base, path, page.head, file?.renamedFrom);
  return { lines, changed: toRanges(addedLines(diff)), removed: removedLines(diff), status: file?.status };
}

// The start of a test in Python, and in JavaScript or TypeScript.
const TEST_START = /^\s*(?:async\s+)?def\s+(test\w*)|^\s*(?:test|it)\(\s*['"`](.+?)['"`]/;

/** The tests of a function ("tests:<name>"), or the tests that the agent linked to one note ("linked:<note key>"). */
function testsOf(page: PageData, kind: 'tests' | 'linked', key: string): TestsAnswer | undefined {
  const note = kind === 'linked' ? page.notes.find((candidate) => candidate.key === key) : undefined;
  if (kind === 'linked' && !note) return undefined;
  const added = new Map<string, Set<number>>();
  const addedIn = (file: string): Set<number> => {
    if (!added.has(file)) {
      const changed = page.files.some((candidate) => candidate.path === file);
      added.set(file, new Set(changed ? codeOf(page, file).changed.flatMap(([first, last]) => Array.from({ length: last - first + 1 }, (_, at) => first + at)) : []));
    }
    return added.get(file)!;
  };
  const row = (file: string, line: number, name?: string): TestRow => {
    const lines = (fileText(page.folder, file) ?? '').split('\n');
    let start = line;
    while (start > 1 && !TEST_START.test(lines[start - 1] ?? '')) start--;
    let end = start;
    if (!TEST_START.test(lines[start - 1] ?? '')) start = end = line; // no test around the call: show the call only
    else while (end < lines.length && end - start < 60 && !TEST_START.test(lines[end] ?? '')) end++;
    const isAdded = addedIn(file);
    const body: TestRow['added'] = [];
    for (let at = start; at <= end; at++) if (isAdded.has(at) && body.length < 8) body.push({ line: at, text: lines[at - 1] });
    return { name: name ?? basename(file), file, line, isNew: isAdded.has(start), added: isAdded.has(start) ? body : [] };
  };

  const found = kind === 'tests' ? findTests(page.folder, key) : [];
  const inTests = found.filter((test) => test.name);
  const linked = (note?.tests ?? []).map((test) => {
    const [file, name] = test.split('::');
    const lines = (fileText(page.folder, file) ?? '').split('\n');
    const at = lines.findIndex((text) => TEST_START.exec(text)?.slice(1).includes(name));
    return row(file, at >= 0 ? at + 1 : 1, name);
  });
  const groups = [
    { name: 'integration', tests: inTests.filter((test) => test.group === 'integration').map((test) => row(test.file, test.line, test.name)) },
    { name: 'unit', tests: inTests.filter((test) => test.group === 'unit').map((test) => row(test.file, test.line, test.name)) },
    { name: 'calls from a test file, outside a test', tests: found.filter((test) => !test.name).map((test) => row(test.file, test.line)) },
    { name: 'linked by the agent', tests: linked },
  ].filter((group) => group.tests.length > 0);
  return { groups, newCount: groups.flatMap((group) => group.tests).filter((test) => test.isNew).length };
}

/** Every question that the page can ask about this change, for the example page that has no VS Code to ask. */
export function allQuestions(page: PageData): string[] {
  const generated = new Set(page.checks.generated);
  const questions = page.files.flatMap((file) => (file.picture ? [`picture:${file.path}`] : file.what ? []
    : [`diff:${file.path}`, ...(generated.has(file.path) ? [] : [`code:${file.path}`])]));
  for (const part of page.parts) for (const path of part.files) if (!page.files.some((file) => file.path === path)) questions.push(`code:${path}`);
  for (const code of [...page.diagrams.flatMap((diagram) => Object.values(diagram.code)), ...page.links.flatMap((link) => (link.code ? [link.code] : []))]) {
    for (const place of code.places) questions.push(`code:${place.file}`);
  }
  for (const name of Object.keys(page.functionTests)) questions.push(`tests:${name}`);
  for (const note of page.notes) if (note.linkedTests) questions.push(`linked:${note.key}`);
  return [...new Set(questions)];
}

/** Where a file tab starts: at its lines, or at its first or last change. */
export interface TabStart { lines?: [number, number]; at?: 'first' | 'last' }

/**
 * The start of a file tab goes to its page once, with the first data that the page gets. A view whose page is still loading keeps its start:
 * a load of the data in that moment (the store changed) must not use it up, or the tab opens at the top of the file.
 */
export function takeStart(view: TabStart & { ready: boolean }): TabStart {
  const { lines, at } = view;
  if (view.ready) Object.assign(view, { lines: undefined, at: undefined });
  return { lines, at };
}
