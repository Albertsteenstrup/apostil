// The Apostil store: one SQLite file in ~/.apostil that every part reads and writes.
// Set APOSTIL_HOME to use another folder, for example in a test.

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { AgentSession } from './agents';
import type { AskRun, KnownSession } from './ask';
import type { ChangeFile } from './change-file';
import type { Look } from './look';
import type { StartedRun } from './map-app';
import type { MapRun } from './map-run';
import type { MarkValue } from './marks';
import type { NoteCode, NoteSource } from './notes-beside-code';
import type { RepoMap } from './repo-map';

/** What the tool's own checks found in a change file. */
export interface CheckResult {
  filesInNoPart: string[]; // changed, hand-written, and in no part
  filesInTwoParts: string[];
  filesNotChanged: string[]; // named in a part, but not changed
  generated: string[]; // changed files that are folded
  badNotes: { part: string; title: string; problem: string }[];
  renamedFiles?: { from: string; to: string; problem: string }[]; // a part names the old path of a renamed file; missing when there is none
}

export interface StoredChange {
  id: number;
  repoId: string; // the same for every worktree of one repo
  folder: string; // the worktree folder that the change was written in
  branch: string;
  base: string; // the commit that the branch started from
  head: string; // the newest commit when the change file was saved
  savedAt: string;
  firstSavedAt?: string; // the first save of the branch; missing in a change saved before the store kept it
  file: ChangeFile;
  checks: CheckResult;
  missingSince?: string; // set when the folder and the commits were not found
  agent?: AgentSession; // the agent app and session that made the change
  noteCode?: NoteCode; // the text of the lines of each note at the save, so that a note finds its lines after the branch is gone; missing in a change saved before the save kept it
  checked?: string[]; // the ids of the diagrams that a second agent read against their code, and "links:<part id>" for the links that leave a part, for this save; a new save takes them away
}

export type NewChange = Omit<StoredChange, 'id' | 'savedAt' | 'firstSavedAt' | 'missingSince'>;

/** One finding of the fresh check: a note that the code does not support, code that no note mentions, or a node or an arrow of a diagram that its code does not support. */
export interface OpenPoint {
  id: number;
  changeId: number;
  kind: 'note-not-supported' | 'no-note' | 'thing-not-supported';
  text: string;
  file?: string;
  lines?: [number, number];
  cell?: string | number; // in a notebook: the cell of `lines`, as a note names it; `lines` then count inside that cell
  inCell?: import('./notebook').InCell; // set by the page, never stored: `lines` were turned into lines of the text of the cells
  diagram?: string; // a thing of a diagram: the diagram id, and the node id or the two ends and the label of the arrow; a link between parts has its ends and label and no diagram
  node?: string;
  edge?: [string, string];
  name?: string;
  part?: string; // the part that the fresh check looked at
  used: boolean; // true when the owner turned it into a remark
}

export type NewOpenPoint = Omit<OpenPoint, 'id' | 'changeId' | 'used' | 'part' | 'inCell'>;

/**
 * The place that a remark belongs to. The ids are those of the change file and of the Mermaid text, never those of a drawing.
 * part, file, lines, note, open-point: as the names say. more-files: the line "5 more files" of a part (no part: of the files in no part).
 * no-part: the box of the files in no part. diagram: a diagram as a whole (no `diagram`: the diagram of the change).
 * node: a node, a participant or a state of a diagram. edge: an arrow, a message or a transition. test: a test in the window of tests.
 */
export interface RemarkTarget {
  kind: 'part' | 'file' | 'lines' | 'note' | 'open-point' | 'more-files' | 'no-part' | 'diagram' | 'node' | 'edge' | 'test';
  part?: string;
  file?: string;
  lines?: [number, number];
  label?: string; // what the owner sees, for example: Part "Service"
  diagram?: string; // the id of the diagram of a node, an edge or a whole diagram; missing for the diagram of the change
  node?: string; // the id of a node in the Mermaid text, or the id of a part in the diagram of the change
  edge?: [string, string]; // the ids of the two ends of an edge
  name?: string; // the label of an edge, which tells two edges between the same nodes apart; the name of a test
  removed?: boolean; // for a note or code lines: on removed lines, counted in the file as it was
  view?: 'diffs'; // where the owner stuck it, when it is not where its kind shows: a file on the Diffs page
  kept?: Kept; // what the thing was when the comment was saved: its ids can name another thing, or none, when the map or the change is written again
}

/** The title, the diagram, the file and the lines of a thing, as they were when a comment was put on it. */
export interface Kept {
  title: string;
  diagram?: string; // the title of its diagram
  file?: string;
  lines?: [number, number];
}

// open: the owner wrote it. sent: the owner asked an agent to act. running: an agent took it. done: answered. closed: resolved by the owner.
export type RemarkState = 'open' | 'sent' | 'running' | 'done' | 'closed';

export interface Remark {
  id: number;
  changeId?: number; // missing on a remark on the map of a repo
  repoId?: string; // set on a remark on the map of a repo, which belongs to no change
  target: RemarkTarget;
  text: string;
  createdAt: string;
  sentAt?: string; // set when an agent has read it
  state: RemarkState;
  answer?: string; // what the agent said it did
  answeredAt?: string;
  run?: { pid?: number; session?: string; startedAt: string }; // the agent run that works on it
  thread?: number; // the remark that started its thread; missing on the first remark of a thread
  to?: RemarkTo; // whom the owner sent it to
  closedBy?: string; // the agent app that resolved it; missing when the owner resolved it
  changed?: string[]; // the files that the run that Apostil started for it changed, by Git before and after the run; missing when it changed none
}

/** Whom a remark was sent to: the session of an app that made the change ("current"), or a new session of an app. */
export interface RemarkTo {
  app: string;
  kind: 'current' | 'new';
}

/** What the owner has open and selected in the app right now. */
export interface AppState {
  folder?: string;
  changeId?: number;
  view?: 'diagram' | 'code';
  part?: string;
  file?: string;
  lines?: [number, number];
  selectedText?: string;
  openFiles?: string[];
}

/** One row of the small table that shows if the tool helps. */
export interface UsageRow {
  changeId: number;
  branch: string;
  filesInNoPart: number;
  openPoints: number;
  openPointsUsed: number;
  secondsOpen: number;
}

// A remark belongs to a change, or with no change to the map of a repo (repo_id).
const REMARK_TABLE = `remark (
  id integer primary key,
  change_id integer references change(id) on delete cascade,
  target_json text not null, text text not null, created_at text not null, sent_at text
)`;

const SCHEMA = `
create table if not exists change (
  id integer primary key,
  repo_id text not null, folder text not null, branch text not null,
  base text not null, head text not null, saved_at text not null,
  file_json text not null, checks_json text not null, missing_since text,
  unique (repo_id, branch)
);
create table if not exists open_point (
  id integer primary key,
  change_id integer not null references change(id) on delete cascade,
  kind text not null, text text not null, file text, line_from integer, line_to integer, part text,
  used integer not null default 0
);
create table if not exists ${REMARK_TABLE};
create table if not exists waiter (session text primary key, pid integer not null);
create table if not exists app_state (id integer primary key check (id = 1), state_json text not null);
create table if not exists view_log (
  id integer primary key,
  change_id integer not null references change(id) on delete cascade,
  opened_at text not null, seconds integer not null
);`;

// Columns that were added after the first version. A store from an older version gets them when it is opened.
const ADDED_COLUMNS: [table: string, column: string, type: string][] = [
  ['open_point', 'part', 'text'],
  ['change', 'agent_json', 'text'],
  ['remark', 'state', "text not null default 'open'"],
  ['remark', 'answer', 'text'],
  ['remark', 'answered_at', 'text'],
  ['remark', 'run_json', 'text'],
  ['remark', 'thread', 'integer'],
  ['remark', 'to_json', 'text'],
  ['remark', 'closed_by', 'text'],
  ['remark', 'repo_id', 'text'],
  ['remark', 'changed_json', 'text'], // the files that the run for the remark changed, from Git before and after the run
  ['change', 'checked_json', 'text'],
  ['open_point', 'target_json', 'text'],
  ['change', 'note_code_json', 'text'],
  ['change', 'first_saved_at', 'text'], // a change of an older store keeps none: the list then takes another date for "created"
];

type Row = Record<string, any>;
const now = (): string => new Date().toISOString();
const lines = (row: Row): [number, number] | undefined => (row.line_from ? [row.line_from, row.line_to] : undefined);

const toChange = (row: Row): StoredChange => ({
  id: row.id, repoId: row.repo_id, folder: row.folder, branch: row.branch, base: row.base, head: row.head,
  savedAt: row.saved_at, file: JSON.parse(row.file_json), checks: JSON.parse(row.checks_json),
  ...(row.first_saved_at ? { firstSavedAt: row.first_saved_at } : {}),
  missingSince: row.missing_since ?? undefined, agent: row.agent_json ? JSON.parse(row.agent_json) : undefined,
  ...(row.checked_json ? { checked: JSON.parse(row.checked_json) } : {}),
  ...(row.note_code_json ? { noteCode: JSON.parse(row.note_code_json) } : {}),
});

const toRemark = (row: Row): Remark => ({
  id: row.id, changeId: row.change_id ?? undefined, repoId: row.repo_id ?? undefined, target: JSON.parse(row.target_json), text: row.text,
  createdAt: row.created_at, sentAt: row.sent_at ?? undefined, state: row.state,
  answer: row.answer ?? undefined, answeredAt: row.answered_at ?? undefined, run: row.run_json ? JSON.parse(row.run_json) : undefined,
  thread: row.thread ?? undefined, to: row.to_json ? JSON.parse(row.to_json) : undefined, closedBy: row.closed_by ?? undefined,
  changed: row.changed_json ? JSON.parse(row.changed_json) : undefined,
});

/** The remarks grouped by thread, each thread in the order of its remarks, the threads in the order of their first remark. */
export function threadsOf(remarks: Remark[]): Remark[][] {
  const threads = new Map<number, Remark[]>();
  for (const remark of [...remarks].sort((a, b) => a.id - b.id)) {
    const key = remark.thread ?? remark.id;
    threads.set(key, [...(threads.get(key) ?? []), remark]);
  }
  return [...threads.values()];
}

/** True while a process with this id runs. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'; // it runs, but belongs to another user
  }
}

// ----- the map of a repo: one for each repo, not tied to a change -----

export interface StoredMap {
  map: RepoMap;
  savedAt: string;
  commit: string; // the commit that the map was written at
}

const MAP_SCHEMA = `
create table if not exists repo_map (
  repo_id text primary key, saved_at text not null, commit_id text not null, map_json text not null
);`;

// When the owner last opened the conversation of each pull request: GitHub keeps no such mark.
const LOOK_SCHEMA = `
create table if not exists pull_request_look (
  repo text not null, number integer not null, looked_at text not null, primary key (repo, number)
);`;

// The values of mark sets that Apostil has seen, in every repo (a service, with its name, web address and icon), and the look of each repo (shared/look.ts).
// The icons and the files of a look are files of their own beside the database: icons/<set>/<value>.<ending> and looks/<repo id>/<name>.
const MARK_SCHEMA = `
create table if not exists mark_value (
  set_id text not null, value_id text not null, value_json text not null, primary key (set_id, value_id)
);
create table if not exists repo_look (
  repo_id text primary key, saved_at text not null, look_json text not null
);`;

// The run that writes the map of a repo now, or the last one: one record for a repo (shared/map-run.ts).
// And the run that words for an agent started, one for each words of a repo (shared/ask.ts).
const RUN_SCHEMA = `
create table if not exists map_run (repo_id text primary key, run_json text not null);
create table if not exists ask_run (repo_id text not null, words text not null, run_json text not null, primary key (repo_id, words));`;

/** The store of a home folder: ~/.apostil, or APOSTIL_HOME when it is set. */
export const storeFolder = (home = homedir()): string => process.env.APOSTIL_HOME ?? join(home, '.apostil');

// The notes of a change that the cleanup removed, with the text of their lines: they stand beside the code as long as that code is there.
const REPLACED = 1_000_000_000; // the ids of the kept notes of replaced descriptions start below minus this number, far from the ids of removed changes
const KEPT_SCHEMA = `
create table if not exists kept_notes (
  change_id integer primary key, repo_id text not null, branch text not null, head text not null, saved_at text not null,
  title text not null, parts_json text not null, note_code_json text not null
);`;

export class Store {
  private db: DatabaseSync;

  /** With readOnly the store must exist already, and nothing is written: for "apostil doctor". */
  constructor(readonly folder: string = storeFolder(), readOnly = false) {
    if (readOnly) {
      // With no "-wal" file nobody has the store open: "immutable" then reads it without making the files that SQLite keeps beside it.
      const file = join(folder, 'apostil.sqlite');
      this.db = new DatabaseSync(existsSync(`${file}-wal`) ? file : `${pathToFileURL(file).href}?immutable=1`, { readOnly: true });
      return;
    }
    mkdirSync(folder, { recursive: true });
    this.db = new DatabaseSync(join(folder, 'apostil.sqlite'));
    // Several agents can save at the same time: wait for a lock, do not fail. The wait must be set first.
    this.db.exec('pragma busy_timeout = 5000; pragma journal_mode = wal; pragma foreign_keys = on;');
    this.db.exec(SCHEMA);
    this.db.exec(MAP_SCHEMA);
    this.db.exec(LOOK_SCHEMA);
    this.db.exec(KEPT_SCHEMA);
    this.db.exec(MARK_SCHEMA);
    this.db.exec(RUN_SCHEMA);
    for (const [table, column, type] of ADDED_COLUMNS) {
      const has = (this.db.prepare(`pragma table_info(${table})`).all() as Row[]).some((row) => row.name === column);
      try {
        if (!has) this.db.exec(`alter table ${table} add column ${column} ${type}`);
      } catch {
        // Another process added the column at the same moment.
      }
    }
    this.allowRemarksWithoutChange();
  }

  /** A store from before the remarks on the map has "change_id not null": its remark table is made again, with every row. */
  private allowRemarksWithoutChange(): void {
    const changeColumn = () => (this.db.prepare('pragma table_info(remark)').all() as Row[]).find((row) => row.name === 'change_id');
    if (!changeColumn()?.notnull) return;
    this.db.exec('begin immediate');
    try {
      if (changeColumn()?.notnull) { // another process may have done it meanwhile
        const columns = (this.db.prepare('pragma table_info(remark)').all() as Row[]).map((row) => row.name).join(', ');
        const added = ADDED_COLUMNS.filter(([table]) => table === 'remark').map(([, column, type]) => `alter table remark_new add column ${column} ${type};`).join('\n');
        this.db.exec(`create table ${REMARK_TABLE.replace('remark (', 'remark_new (')};\n${added}
          insert into remark_new (${columns}) select ${columns} from remark;
          drop table remark;
          alter table remark_new rename to remark;`);
      }
      this.db.exec('commit');
    } catch (error) {
      this.db.exec('rollback');
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  // ----- changes -----

  /** Saves a change. A branch of a repo has one change: a new save replaces the old one and keeps its remarks and the time of its first save. */
  saveChange(change: NewChange): number {
    const at = now();
    const row = this.db.prepare(`
      insert into change (repo_id, folder, branch, base, head, saved_at, file_json, checks_json, agent_json, note_code_json, first_saved_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict (repo_id, branch) do update set
        folder = excluded.folder, base = excluded.base, head = excluded.head, saved_at = excluded.saved_at,
        file_json = excluded.file_json, checks_json = excluded.checks_json, missing_since = null, checked_json = null,
        agent_json = coalesce(excluded.agent_json, agent_json), note_code_json = excluded.note_code_json
      returning id`).get(change.repoId, change.folder, change.branch, change.base, change.head, at,
      JSON.stringify(change.file), JSON.stringify(change.checks), change.agent ? JSON.stringify(change.agent) : null,
      change.noteCode ? JSON.stringify(change.noteCode) : null, at) as Row;
    return Number(row.id);
  }

  /** The changes of one repo, the newest first. */
  listChanges(repoId: string): StoredChange[] {
    return (this.db.prepare('select * from change where repo_id = ? order by saved_at desc').all(repoId) as Row[]).map(toChange);
  }

  allChanges(): StoredChange[] {
    return (this.db.prepare('select * from change order by saved_at desc').all() as Row[]).map(toChange);
  }

  /** How many repos have a map, and how many described changes and comments the store holds: for "apostil uninstall". */
  counts(): { maps: number; changes: number; remarks: number } {
    const count = (table: string): number => Number((this.db.prepare(`select count(*) as n from ${table}`).get() as Row).n);
    return { maps: count('repo_map'), changes: count('change'), remarks: count('remark') };
  }

  getChange(id: number): StoredChange | undefined {
    const row = this.db.prepare('select * from change where id = ?').get(id) as Row | undefined;
    return row && toChange(row);
  }

  findChange(repoId: string, branch: string): StoredChange | undefined {
    const row = this.db.prepare('select * from change where repo_id = ? and branch = ?').get(repoId, branch) as Row | undefined;
    return row && toChange(row);
  }

  /** Marks a change as missing since a moment, or clears the mark with undefined. */
  markMissing(id: number, since: string | undefined): void {
    this.db.prepare('update change set missing_since = ? where id = ?').run(since ?? null, id);
  }

  /**
   * Keeps the notes of a change and the text of their lines: before the cleanup removes the change, or (`replaced`) before a description of later commits
   * of the same branch takes its place. A removed change keeps them under its own id; a replaced description gets a number of its own below zero, so that
   * each description of a branch is kept. A change saved before the text was kept has nothing to keep.
   */
  keepNotes(change: StoredChange, replaced = false): void {
    if (!change.noteCode || !Object.keys(change.noteCode).length) return;
    const parts = change.file.parts.filter((part) => part.notes?.length).map((part) => ({ id: part.id, notes: part.notes }));
    const id = replaced ? Number((this.db.prepare('select coalesce(min(change_id), 0) - 1 as next from kept_notes where change_id < 0').get() as Row).next) : change.id;
    this.db.prepare(`insert into kept_notes (change_id, repo_id, branch, head, saved_at, title, parts_json, note_code_json) values (?, ?, ?, ?, ?, ?, ?, ?)
      on conflict (change_id) do update set repo_id = excluded.repo_id, branch = excluded.branch, head = excluded.head, saved_at = excluded.saved_at,
        title = excluded.title, parts_json = excluded.parts_json, note_code_json = excluded.note_code_json`)
      .run(id, change.repoId, change.branch, change.head, change.savedAt, change.file.title, JSON.stringify(parts), JSON.stringify(change.noteCode));
  }

  /** The kept notes of the removed changes and the replaced descriptions of a repo, the newest first. Their ids are negative and each is another one, so that they never meet the id of a stored change. */
  keptNotes(repoId: string): NoteSource[] {
    return (this.db.prepare('select * from kept_notes where repo_id = ? order by saved_at desc').all(repoId) as Row[]).map((row) => ({
      id: Number(row.change_id) > 0 ? -Number(row.change_id) : Number(row.change_id) - REPLACED, branch: row.branch, head: row.head, savedAt: row.saved_at,
      file: { title: row.title, parts: JSON.parse(row.parts_json) }, noteCode: JSON.parse(row.note_code_json),
    }));
  }

  removeChange(id: number): void {
    this.db.prepare('delete from change where id = ?').run(id);
  }

  // ----- open points of the fresh check -----

  /** Replaces the open points of a change. With a part, it replaces only the points of that part. */
  setOpenPoints(changeId: number, points: NewOpenPoint[], part?: string): void {
    this.db.prepare('delete from open_point where change_id = ? and (? is null or part = ?)').run(changeId, part ?? null, part ?? null);
    const add = this.db.prepare('insert into open_point (change_id, kind, text, file, line_from, line_to, part, target_json) values (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const point of points) {
      // An edge with no diagram: a link between parts. A cell of a notebook is kept beside the thing.
      const thing = point.diagram || point.edge || point.cell !== undefined ? JSON.stringify({ diagram: point.diagram, node: point.node, edge: point.edge, name: point.name, cell: point.cell }) : null;
      add.run(changeId, point.kind, point.text, point.file ?? null, point.lines?.[0] ?? null, point.lines?.[1] ?? null, part ?? null, thing);
    }
  }

  openPoints(changeId: number): OpenPoint[] {
    return (this.db.prepare('select * from open_point where change_id = ? order by id').all(changeId) as Row[]).map((row) => ({
      id: row.id, changeId: row.change_id, kind: row.kind, text: row.text, file: row.file ?? undefined, lines: lines(row),
      ...(row.target_json ? JSON.parse(row.target_json) : {}), part: row.part ?? undefined, used: row.used === 1,
    }));
  }

  /** Keeps that a second agent read these diagrams of a change, or the links that leave a part ("links:<part id>"), against their code. A new save of the change takes the mark away. */
  markChecked(changeId: number, diagrams: string[]): void {
    const stored = this.getChange(changeId)?.checked ?? [];
    this.db.prepare('update change set checked_json = ? where id = ?').run(JSON.stringify([...new Set([...stored, ...diagrams])]), changeId);
  }

  markOpenPointUsed(id: number): void {
    this.db.prepare('update open_point set used = 1 where id = ?').run(id);
  }

  // ----- remarks of the owner -----

  /** Adds a remark. With a thread, it is a reply in the thread that this remark started. */
  addRemark(changeId: number, target: RemarkTarget, text: string, thread?: number): number {
    const result = this.db.prepare('insert into remark (change_id, target_json, text, created_at, thread) values (?, ?, ?, ?, ?)')
      .run(changeId, JSON.stringify(target), text, now(), thread ?? null);
    return Number(result.lastInsertRowid);
  }

  /** Adds a remark on the map of a repo: it belongs to no change. With a thread, it is a reply. */
  addRepoRemark(repoId: string, target: RemarkTarget, text: string, thread?: number): number {
    const result = this.db.prepare('insert into remark (repo_id, target_json, text, created_at, thread) values (?, ?, ?, ?, ?)')
      .run(repoId, JSON.stringify(target), text, now(), thread ?? null);
    return Number(result.lastInsertRowid);
  }

  /** The remarks on the map of a repo. */
  repoRemarks(repoId: string, onlyUnsent = false): Remark[] {
    const sql = `select * from remark where change_id is null and repo_id = ? ${onlyUnsent ? "and sent_at is null and state != 'closed'" : ''} order by id`;
    return (this.db.prepare(sql).all(repoId) as Row[]).map(toRemark);
  }

  /** One remark, of a change or of the map of a repo. */
  getRemark(id: number): Remark | undefined {
    const row = this.db.prepare('select * from remark where id = ?').get(id) as Row | undefined;
    return row && toRemark(row);
  }

  remarks(changeId: number, onlyUnsent = false): Remark[] {
    const sql = `select * from remark where change_id = ? ${onlyUnsent ? "and sent_at is null and state != 'closed'" : ''} order by id`;
    return (this.db.prepare(sql).all(changeId) as Row[]).map(toRemark);
  }

  /** Sets an open remark to sent: the owner asked an agent to act on it, and with `to`, which one. */
  sendRemark(id: number, to?: RemarkTo): void {
    this.db.prepare("update remark set state = 'sent', to_json = coalesce(?, to_json) where id = ? and state = 'open'").run(to ? JSON.stringify(to) : null, id);
  }

  /** Sets a remark to running while an agent run works on it. */
  startRemarkRun(id: number, run: { pid?: number; session?: string; startedAt: string }): void {
    this.db.prepare("update remark set state = 'running', run_json = ? where id = ?").run(JSON.stringify(run), id);
  }

  /** Stores the answer of the agent and sets the remark to done. */
  answerRemark(id: number, text: string): Remark | undefined {
    const row = this.db.prepare("update remark set state = 'done', answer = ?, answered_at = ? where id = ? returning *").get(text, now(), id) as Row | undefined;
    return row && toRemark(row);
  }

  /** Sets a remark to open again and drops its run, for a run that ended with no answer. */
  reopenRemark(id: number): void {
    this.db.prepare("update remark set state = 'open', run_json = null where id = ?").run(id);
  }

  /** Resolves a remark; `by` is the agent app that resolved it. */
  closeRemark(id: number, by?: string): void {
    this.db.prepare("update remark set state = 'closed', closed_by = ? where id = ?").run(by ?? null, id);
  }

  /** Keeps the files that the run for a remark changed (none: the field is cleared). */
  setRemarkChanged(remarkId: number, files: string[]): void {
    this.db.prepare('update remark set changed_json = ? where id = ?').run(files.length ? JSON.stringify(files) : null, remarkId);
  }

  /** Keeps the session of the run that works on a remark, so that its link works after the run too. */
  setRunSession(remarkId: number, session: string): void {
    this.db.prepare("update remark set run_json = json_set(coalesce(run_json, '{}'), '$.session', ?) where id = ?").run(session, remarkId);
  }

  /** The remarks of the thread that holds this remark, in order. */
  threadOf(id: number): Remark[] {
    const row = this.db.prepare('select coalesce(thread, id) as root from remark where id = ?').get(id) as Row | undefined;
    if (!row) return [];
    return (this.db.prepare('select * from remark where id = ? or thread = ? order by id').all(row.root, row.root) as Row[]).map(toRemark);
  }

  /** Resolves a thread: every remark of it is closed, by the owner or by the agent app `by`. */
  closeThread(id: number, by?: string): void {
    for (const remark of this.threadOf(id)) this.closeRemark(remark.id, by);
  }

  /** Opens a resolved thread again: an answered remark is done again, the others open. */
  reopenThread(id: number): void {
    const ids = this.threadOf(id).map((remark) => remark.id);
    const reopen = this.db.prepare("update remark set state = case when answer is not null then 'done' else 'open' end, closed_by = null where id = ? and state = 'closed'");
    for (const remarkId of ids) reopen.run(remarkId);
  }

  /** The running remarks whose process no longer lives. */
  staleRuns(changeId: number): Remark[] {
    return this.remarks(changeId).filter((remark) => remark.state === 'running' && remark.run?.pid !== undefined && !isAlive(remark.run.pid));
  }

  removeRemark(id: number): void {
    this.db.prepare('delete from remark where id = ?').run(id);
  }

  /** Marks the unsent remarks of a change as read by an agent. */
  markRemarksSent(changeId: number): void {
    this.db.prepare('update remark set sent_at = ? where change_id = ? and sent_at is null').run(now(), changeId);
  }

  /** Marks the unsent remarks on the map of a repo as read by an agent. */
  markRepoRemarksSent(repoId: string): void {
    this.db.prepare('update remark set sent_at = ? where change_id is null and repo_id = ? and sent_at is null').run(now(), repoId);
  }

  // ----- the waiter of a session: the program that fetches sent remarks for a live session -----

  /** Makes a process the one waiter of a session. */
  setWaiter(session: string, pid: number): void {
    this.db.prepare('insert into waiter (session, pid) values (?, ?) on conflict (session) do update set pid = excluded.pid').run(session, pid);
  }

  /** The process that waits for a session, or undefined. */
  waiterOf(session: string): number | undefined {
    const row = this.db.prepare('select pid from waiter where session = ?').get(session) as Row | undefined;
    return row?.pid;
  }

  /** Removes the waiter of a session, when this process still holds it. */
  removeWaiter(session: string, pid: number): void {
    this.db.prepare('delete from waiter where session = ? and pid = ?').run(session, pid);
  }

  /** Every session that has a waiter, and if the waiter lives. */
  waiters(): { session: string; pid: number; alive: boolean }[] {
    return (this.db.prepare('select * from waiter order by session').all() as Row[]).map((row) => ({ session: row.session, pid: row.pid, alive: isAlive(row.pid) }));
  }

  // ----- what the owner has open -----

  setAppState(state: AppState): void {
    this.db.prepare('insert into app_state (id, state_json) values (1, ?) on conflict (id) do update set state_json = excluded.state_json')
      .run(JSON.stringify(state));
  }

  appState(): AppState {
    const row = this.db.prepare('select state_json from app_state where id = 1').get() as Row | undefined;
    return row ? JSON.parse(row.state_json) : {};
  }

  // ----- when the owner last looked at a pull request -----

  /** The time that he last opened the conversation of a pull request ("owner/name" and number), or undefined. */
  lastLooked(repo: string, number: number): string | undefined {
    const row = this.db.prepare('select looked_at from pull_request_look where repo = ? and number = ?').get(repo, number) as Row | undefined;
    return row?.looked_at;
  }

  setLooked(repo: string, number: number, at: string = now()): void {
    this.db.prepare('insert into pull_request_look (repo, number, looked_at) values (?, ?, ?) on conflict (repo, number) do update set looked_at = excluded.looked_at')
      .run(repo, number, at);
  }

  // ----- the small table that shows if the tool helps -----

  logView(changeId: number, seconds: number): void {
    this.db.prepare('insert into view_log (change_id, opened_at, seconds) values (?, ?, ?)').run(changeId, now(), Math.round(seconds));
  }

  usage(repoId: string): UsageRow[] {
    return this.listChanges(repoId).map((change) => {
      const points = this.openPoints(change.id);
      const seconds = this.db.prepare('select coalesce(sum(seconds), 0) as total from view_log where change_id = ?').get(change.id) as Row;
      return {
        changeId: change.id, branch: change.branch, filesInNoPart: change.checks.filesInNoPart.length,
        openPoints: points.length, openPointsUsed: points.filter((point) => point.used).length, secondsOpen: Number(seconds.total),
      };
    });
  }

  // ----- the map of a repo -----

  /** Saves the map of a repo. A new save replaces the old map. */
  saveMap(repoId: string, commit: string, map: RepoMap): void {
    this.db.prepare(`
      insert into repo_map (repo_id, saved_at, commit_id, map_json) values (?, ?, ?, ?)
      on conflict (repo_id) do update set saved_at = excluded.saved_at, commit_id = excluded.commit_id, map_json = excluded.map_json`)
      .run(repoId, now(), commit, JSON.stringify(map));
  }

  /** Reads the map, lets `change` return a new one, and saves it, all in one step, so that two writers at once lose nothing. `change` returns undefined to save nothing. */
  updateMap(repoId: string, commit: string, change: (stored: RepoMap | undefined) => RepoMap | undefined): void {
    this.db.exec('begin immediate');
    try {
      const next = change(this.getMap(repoId)?.map);
      if (next) this.saveMap(repoId, commit, next);
      this.db.exec('commit');
    } catch (error) {
      this.db.exec('rollback');
      throw error;
    }
  }

  removeMap(repoId: string): void {
    this.db.prepare('delete from repo_map where repo_id = ?').run(repoId);
  }

  /** The stored map of a repo, or undefined. */
  getMap(repoId: string): StoredMap | undefined {
    const row = this.db.prepare('select * from repo_map where repo_id = ?').get(repoId) as Row | undefined;
    return row && { map: JSON.parse(row.map_json), savedAt: row.saved_at, commit: row.commit_id };
  }

  // ----- the run that writes the map -----

  /** The record of the map run of a repo: the run that writes its map now, or the last one. */
  mapRun(repoId: string): MapRun | undefined {
    const row = this.db.prepare('select run_json from map_run where repo_id = ?').get(repoId) as Row | undefined;
    return row && JSON.parse(row.run_json);
  }

  /** The runs that Apostil started, in any repo: the map runs of its press, and the runs for a remark or for words that it sent to a new session of an app. */
  startedRuns(): StartedRun[] {
    const maps = (this.db.prepare('select repo_id, run_json from map_run').all() as Row[])
      .map((row): [string, MapRun] => [row.repo_id, JSON.parse(row.run_json)]).filter(([, run]) => run.home && run.agent?.app)
      .map(([repoId, run]): StartedRun => ({ app: run.agent!.app, at: run.startedAt, repoId }));
    const remarks = (this.db.prepare('select r.to_json, r.run_json, coalesce(r.repo_id, c.repo_id) as repo_id from remark r left join change c on c.id = r.change_id where r.to_json is not null and r.run_json is not null').all() as Row[])
      .map((row) => ({ to: JSON.parse(row.to_json) as RemarkTo, run: JSON.parse(row.run_json) as { startedAt: string }, repoId: row.repo_id as string }))
      .filter(({ to, repoId }) => to.kind === 'new' && repoId)
      .map(({ to, run, repoId }): StartedRun => ({ app: to.app, at: run.startedAt, repoId }));
    const asks = this.askRuns().filter(({ run }) => run.to === 'new').map(({ repoId, run }): StartedRun => ({ app: run.agent.app, at: run.startedAt, repoId }));
    return [...maps, ...remarks, ...asks];
  }

  /**
   * The sessions that Apostil knows in a repo, for words to the newest one (shared/ask.ts): the agents of its stored changes, and the sessions of the runs
   * that it started there (a run for a remark, the map run, a run of words). `folder` is the folder of the repo where a run without its own folder ran.
   */
  knownSessions(repoId: string, folder?: string): KnownSession[] {
    const changes = this.listChanges(repoId).filter((change) => change.agent?.session).map((change): KnownSession => ({ agent: change.agent!, at: change.savedAt, folder: change.folder }));
    const remarks = (this.db.prepare(`select r.run_json, r.to_json, c.agent_json, c.folder from remark r left join change c on c.id = r.change_id
      where coalesce(r.repo_id, c.repo_id) = ? and r.run_json is not null`).all(repoId) as Row[])
      .map((row) => ({ run: JSON.parse(row.run_json) as NonNullable<Remark['run']>, to: row.to_json ? JSON.parse(row.to_json) as RemarkTo : undefined, agent: row.agent_json ? JSON.parse(row.agent_json) as AgentSession : undefined, folder: row.folder as string | null }))
      .filter(({ run, to, agent }) => run.session && (to?.kind === 'new' || agent))
      // A run that continued the session of the change keeps what the change knows of it (the id in the desktop app); a new session has only its id.
      .map(({ run, to, agent, folder: own }): KnownSession => ({ agent: to?.kind === 'new' ? { app: to.app, session: run.session } : { ...agent!, session: run.session }, at: run.startedAt, folder: own ?? folder }));
    const map = this.mapRun(repoId);
    const maps = map?.agent?.session ? [{ agent: map.agent, at: map.savedAt ?? map.startedAt, folder }] : [];
    // A run of words that failed may have no session behind its id (a new Claude Code session gets its id before it starts): it is left out.
    const asks = this.askRuns(repoId).filter(({ run }) => run.agent.session && !run.problem).map(({ run }): KnownSession => ({ agent: run.agent, at: run.startedAt, folder: run.folder }));
    return [...changes, ...remarks, ...maps, ...asks];
  }

  // ----- the runs of words for an agent (shared/ask.ts) -----

  /** The record of the run that these words started in a repo, or undefined. */
  askRun(repoId: string, words: string): AskRun | undefined {
    const row = this.db.prepare('select run_json from ask_run where repo_id = ? and words = ?').get(repoId, words) as Row | undefined;
    return row && JSON.parse(row.run_json);
  }

  /** Keeps the record of the run of words; a new run of the same words replaces it. */
  setAskRun(repoId: string, words: string, run: AskRun): void {
    this.db.prepare('insert into ask_run (repo_id, words, run_json) values (?, ?, ?) on conflict (repo_id, words) do update set run_json = excluded.run_json').run(repoId, words, JSON.stringify(run));
  }

  /** The records of the runs of words, of one repo or of all. */
  private askRuns(repoId?: string): { repoId: string; run: AskRun }[] {
    const rows = (repoId ? this.db.prepare('select repo_id, run_json from ask_run where repo_id = ?').all(repoId) : this.db.prepare('select repo_id, run_json from ask_run').all()) as Row[];
    return rows.map((row) => ({ repoId: row.repo_id, run: JSON.parse(row.run_json) }));
  }

  /** Reads the record of the map run, lets `change` return the new one, and keeps it, all in one step, so that two writers at once lose no part. `change` returns undefined to keep it as it is. */
  changeMapRun(repoId: string, change: (run: MapRun | undefined) => MapRun | undefined): void {
    this.db.exec('begin immediate');
    try {
      const next = change(this.mapRun(repoId));
      if (next) this.db.prepare('insert into map_run (repo_id, run_json) values (?, ?) on conflict (repo_id) do update set run_json = excluded.run_json').run(repoId, JSON.stringify(next));
      this.db.exec('commit');
    } catch (error) {
      this.db.exec('rollback');
      throw error;
    }
  }

  // ----- marks and looks -----

  /** The values of a mark set that Apostil has seen in any repo, in the order of their ids. */
  markValues(set: string): MarkValue[] {
    return (this.db.prepare('select value_json from mark_value where set_id = ? order by value_id').all(set) as Row[]).map((row) => JSON.parse(row.value_json));
  }

  /** Keeps a value of a mark set, or replaces the one with the same id. */
  saveMarkValue(set: string, value: MarkValue): void {
    this.db.prepare('insert into mark_value (set_id, value_id, value_json) values (?, ?, ?) on conflict (set_id, value_id) do update set value_json = excluded.value_json')
      .run(set, value.id, JSON.stringify(value));
  }

  /** The kept icon of a value: icons/<set>/<value>.<ending>. */
  iconFile(set: string, value: string, ending: string): string {
    return join(this.folder, 'icons', set, `${value}.${ending}`);
  }

  /** The folder of the files of the look of a repo: its pictures, films and icons of buttons. */
  lookFolder(repoId: string): string {
    return join(this.folder, 'looks', repoId);
  }

  /** The look of a repo, or undefined when none is saved: then the default look applies. */
  getLook(repoId: string): { look: Look; savedAt: string } | undefined {
    const row = this.db.prepare('select * from repo_look where repo_id = ?').get(repoId) as Row | undefined;
    return row && { look: JSON.parse(row.look_json), savedAt: row.saved_at };
  }

  /** Saves the look of a repo; a new save replaces the old look. */
  saveLook(repoId: string, look: Look): void {
    this.db.prepare('insert into repo_look (repo_id, saved_at, look_json) values (?, ?, ?) on conflict (repo_id) do update set saved_at = excluded.saved_at, look_json = excluded.look_json')
      .run(repoId, now(), JSON.stringify(look));
  }
}
