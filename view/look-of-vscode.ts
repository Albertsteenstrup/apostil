// What the look of a repo turns on in VS Code's own editor and frame: the marks in the margin, the answers of the search with #, the
// right-click entries and keys with the line facts they need, the first page, and the rows of the list "Look". Each part is off until a rule of the
// look says "show": { "shown": true } (the first page: a "click"). The pick logic is the pages' own: the first part of view/media/marks.js, read in
// Node. No `vscode` import: the extension (look-in-vscode.ts) and the tests use it.

import { type Look, type LookAction, type LookRule, type Target } from '../shared/look';
import { markLineNow, marksNow, type Mark } from '../shared/marks';
import { mapSource, type NoteHere } from '../shared/notes-beside-code';
import { parentsOf, parseKey, stepKey, type Process } from '../shared/processes';
import type { RepoMap } from '../shared/repo-map';
import type { Store } from '../shared/store';
import { notesAtLine } from './note-lines';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Marks = require('../../view/media/marks.js');

export const ANSWERS_MOST = 200; // answers of one search with #
export const ROWS_MOST = 50; // rows in a group of the list "Look", then "n more"

type Thing = { kind: string; fields?: Record<string, unknown>; paths?: string[]; marks?: Mark[] };

/** True when the rules turn a part on for a thing: the rule that names it most closely says "show": { "shown": true }. */
export const isShown = (rules: LookRule[], thing: Thing): boolean => Marks.resolve(rules, thing)['show.shown'] === true;

/** The id of the value of a mark: "<set>:<value>". */
export const keyOf = (mark: Pick<Mark, 'set' | 'value'>): string => `${mark.set}:${mark.value}`;

// ----- A. the margin -----

/** One line of the margin: the value whose icon stands there. */
export interface MarginMark { line: number; key: string }

/** A mark that stands now, with its line now: all that the entries and the list read of it. */
export type MarkAt = Pick<Mark, 'set' | 'value' | 'file'> & { at: number };

/** The marks of one file that stand at the text of their lines in a text (a file, or one side of a diff), each with its line there. */
export function marksIn<T extends Mark>(marks: T[], path: string, lines: string[]): (T & { at: number })[] {
  return marks.filter((mark) => mark.file === path).flatMap((mark) => { const at = markLineNow(mark, lines); return at === undefined ? [] : [{ ...mark, at }]; });
}

/**
 * The marks in the margin of one text (a file, or one side of a diff): each mark placed by the text of its line in this text, and at each line whose
 * rule shows it one icon, by the one rule of the margin that the file tab uses too (Marks.marginIcons in view/media/marks.js). At most 200 lines.
 */
export function marginMarks(rules: LookRule[], marks: Mark[], path: string, lines: string[], setOrder: string[]): MarginMark[] {
  const look = { rules, sets: setOrder.map((id) => ({ id })) };
  return (Marks.marginIcons(look, path, marksIn(marks, path, lines)) as [number, string][]).map(([line, key]) => ({ line, key }));
}

/** A round chip with the first letter of a name, as on a node, for a value with no icon: an SVG as a data address. */
export function letterIcon(name: string): string {
  const letter = (name.trim()[0] ?? '?').toUpperCase().replace(/[<>&"']/g, '?');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.5" fill="#eef1f4" stroke="#8a96a3"/>`
    + `<text x="8" y="11.5" font-family="sans-serif" font-size="10" font-weight="600" text-anchor="middle" fill="#2f3b47">${letter}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// ----- the places of a value: one function for the right-click entry and the list "Look" -----

export interface Place { file: string; line: number; text: string }

/** The places where a value of a set stands now, by file and line, each with the text of its line. Reads each file once. */
export function placesOf(folder: string, marks: Mark[], key: string): Place[] {
  return marksNow(folder, marks.filter((mark) => keyOf(mark) === key)).flatMap(({ mark, at }) => (at === undefined ? [] : [{ file: mark.file, line: at, text: mark.code.trim() }]))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

// ----- the steps of the processes -----

/** A step of a drawn process: its process, its place in the list, and where Home shows it (its own drawing and node, and the top step of the process). */
export interface StepRef { process: Process; index: number; drawing: string; node: string; top: string }

/** Each step of the processes by the key of its note, in the first process that names it, with the drawing and the node that show it. */
export function stepsByKey(processes: Process[]): Map<string, StepRef> {
  const steps = new Map<string, StepRef>();
  for (const process of processes) {
    const parent = parentsOf(process.steps);
    const first = (key: string): number => process.steps.indexOf(key);
    const topOf = (key: string): string => { let at = key; while (parent.get(at) !== undefined) at = parent.get(at)!; return at; };
    process.steps.forEach((key, index) => {
      if (steps.has(key)) return;
      const outer = parent.get(key);
      const drawing = `process:${process.id}${outer === undefined ? '' : `/${first(outer)}`}`;
      steps.set(key, { process, index, drawing, node: `s${first(key)}`, top: `s${first(topOf(key))}` });
    });
  }
  return steps;
}

/** The key of a note that stands, when it is a note of a file of the map: only those are steps of a process. */
const stepKeyOf = (here: NoteHere): string | undefined => (here.change.map && here.change.title === '' ? stepKey(here.note) : undefined);

// ----- B. the search with # -----

export type Of = 'note' | 'step' | 'process';
export interface Answer { of: Of; title: string; file: string; line: number; where: string }

const linesWords = ([first, last]: [number, number]): string => (first === last ? `line ${first}` : `lines ${first}–${last}`);

/**
 * Every answer of the search with # that the rules turn on, each with where it is in quiet words ("step 3 of 14"; VS Code adds the path of the file): the notes that stand now (the notes of each file, as notesInRepo finds them), the steps
 * of the processes and the processes, each by its title. A note that is a step answers as a step when steps are on, else as a note. A process
 * opens the first line of its first step.
 */
export function searchAnswers(rules: LookRule[], notes: { path: string; notes: NoteHere[] }[], processes: Process[]): Answer[] {
  const on = (['note', 'step', 'process'] as Of[]).filter((of) => isShown(rules, { kind: 'symbol-search', fields: { of } }));
  if (!on.length) return [];
  const steps = stepsByKey(processes);
  const answers: Answer[] = [];
  const firstLine = new Map<string, number>(); // the line now of each step that stands, by its key
  for (const { path, notes: here } of notes) {
    for (const one of here) {
      const key = stepKeyOf(one);
      const step = key ? steps.get(key) : undefined;
      if (key) firstLine.set(key, one.lines[0]);
      if (step && on.includes('step')) answers.push({ of: 'step', title: one.note.title, file: path, line: one.lines[0], where: `step ${step.index + 1} of ${step.process.steps.length}` });
      else if (on.includes('note')) answers.push({ of: 'note', title: one.note.title, file: path, line: one.lines[0], where: linesWords(one.lines) });
    }
  }
  if (on.includes('process')) {
    for (const process of processes) {
      const place = parseKey(process.steps[0]);
      if (!place) continue;
      answers.push({ of: 'process', title: process.title, file: place.file, line: firstLine.get(process.steps[0]) ?? place.from, where: `process of ${process.steps.length} steps` });
    }
  }
  return answers;
}

/** The answers whose title holds each word of the search, its letters in their order (VS Code scores them itself), at most 200. */
export function answersFor(answers: Answer[], query: string): Answer[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const holds = (title: string, word: string): boolean => { let at = 0; for (const letter of title) if (letter === word[at]) at++; return at === word.length; };
  return answers.filter((answer) => words.every((word) => holds(answer.title.toLowerCase(), word))).slice(0, ANSWERS_MOST);
}

// ----- C and D. the right-click entries and the keys -----

export const ENTRIES = ['note', 'process', 'mark', 'actions'] as const;
const PLACES = { editor: 'editor', 'file-tab': 'fileTab', explorer: 'explorer' } as const;
const ACTION_KEYS = 9;

/**
 * The context keys that the extension sets for the entries and keys that the look turns on; package.json shows an entry and lets a key work by them.
 * apostil.lookMenu.<entry>.<editor|fileTab|explorer>, apostil.lookKey.<entry> and apostil.lookKey.action1 to action9 (only for an action that
 * the look has), apostil.lookEntry.<entry> (the command palette: on in some menu or as a key), and apostil.lookList.
 */
export function lookKeys(rules: LookRule[], actions: number, hasPages: boolean): Record<string, boolean> {
  const keys: Record<string, boolean> = {};
  for (const entry of ENTRIES) {
    let any = false;
    for (const [place, name] of Object.entries(PLACES)) any = (keys[`apostil.lookMenu.${entry}.${name}`] = isShown(rules, { kind: 'menu-entry', fields: { entry, in: place } })) || any;
    keys[`apostil.lookKey.${entry}`] = isShown(rules, { kind: 'key', fields: { entry } });
    keys[`apostil.lookEntry.${entry}`] = any || keys[`apostil.lookKey.${entry}`];
  }
  for (let at = 1; at <= ACTION_KEYS; at++) keys[`apostil.lookKey.action${at}`] = at <= actions && isShown(rules, { kind: 'key', fields: { entry: `action-${at}` } });
  keys['apostil.lookList'] = listGroups(rules, hasPages).length > 0;
  return keys;
}

/** What a line has for the right-click entries: the narrowest note that holds it, the steps of processes at it, and the marks that stand at it. */
export interface LineFacts { note?: NoteHere; steps: StepRef[]; marks: MarkAt[] }

export function lineFacts(line: number, notes: NoteHere[], steps: Map<string, StepRef>, marks: MarkAt[]): LineFacts {
  const here = notesAtLine(notes, line);
  // The narrowest step of each process that holds the line.
  const size = (one: NoteHere): number => one.lines[1] - one.lines[0];
  const byProcess = new Map<string, StepRef>();
  for (const one of notes.filter((note) => note.lines[0] <= line && line <= note.lines[1]).sort((a, b) => size(a) - size(b))) {
    const key = stepKeyOf(one);
    const step = key ? steps.get(key) : undefined;
    if (step && !byProcess.has(step.process.id)) byProcess.set(step.process.id, step);
  }
  return { ...(here[0] ? { note: here[0] } : {}), steps: [...byProcess.values()], marks: marks.filter((mark) => mark.at === line) };
}

/**
 * The context keys of the file in front: apostil.fileHas.note, .process and .mark. An entry stands when its file has what it needs anywhere (VS Code
 * builds a right-click menu before it tells the extension the line of the click); on a line with nothing for it, the command says so.
 */
export const fileKeys = (notes: NoteHere[] | undefined, steps: Map<string, StepRef>, marks: MarkAt[] | undefined): Record<string, boolean> => ({
  'apostil.fileHas.note': !!notes?.length,
  'apostil.fileHas.process': !!notes?.some((one) => { const key = stepKeyOf(one); return !!key && steps.has(key); }),
  'apostil.fileHas.mark': !!marks?.length,
});

/**
 * Where "Open This Note on Home" goes: the step of a drawn process that holds the note, in its own drawing; else the node of a diagram of the map
 * whose path holds its file most closely. Undefined when no diagram of the map holds it.
 */
export function noteOnHome(note: NoteHere, steps: Map<string, StepRef>, map: RepoMap | undefined): Target | undefined {
  const key = stepKeyOf(note);
  const step = key ? steps.get(key) : undefined;
  if (step) return { place: { diagram: step.drawing, node: step.node } };
  let best: { diagram: string; node: string; length: number } | undefined;
  for (const diagram of map?.diagrams ?? []) {
    for (const [node, paths] of Object.entries(diagram.nodePaths ?? {})) {
      for (const path of paths) {
        const holds = path === note.note.file || (path.endsWith('/') && note.note.file.startsWith(path));
        if (holds && (!best || path.length > best.length)) best = { diagram: diagram.id, node, length: path.length };
      }
    }
  }
  return best && { place: { diagram: best.diagram, node: best.node } };
}

/** Where "Show the Process of This Line" goes for one step: its process, at the top step that holds it, lit. */
export const processOfStep = (step: StepRef): Target => ({ place: { diagram: `process:${step.process.id}`, node: step.top } });

/**
 * The words of the default key of an action (1 to 9) or an entry, as VS Code writes keys on a Mac: Control+Option. Only a Mac has these keys by
 * default; on Windows and Linux Ctrl+Alt is AltGr, which types characters, so a user there sets a key in VS Code's Keyboard Shortcuts.
 */
export const keyWords = (key: string): string => `⌃⌥${key.toUpperCase()}`;

/** The rows of "Actions of the Look…": the name, the key of each of the first nine where one is bound (a Mac, when the look turns it on), and what it does. */
export function actionRows(actions: LookAction[], keys: Record<string, boolean>, mac: boolean): { label: string; description?: string; detail: string; action: LookAction }[] {
  return actions.map((action, at) => ({
    label: action.name, ...(mac && keys[`apostil.lookKey.action${at + 1}`] ? { description: keyWords(String(at + 1)) } : {}), detail: Marks.targetWords(action.target), action,
  }));
}

// ----- E. the first page -----

/** A tab of the window, as far as the start step needs it: a view of Apostil by its kind and name, or another tab. */
export interface TabNow { kind: 'home' | 'graphs' | 'page' | 'other'; name: string }

/** The view of Apostil that a target of the first page opens: its kind of tab and its name. */
export function viewOf(target: Target, pages: { id: string; title: string }[] = []): TabNow {
  const { page } = target;
  if (page !== undefined) return { kind: 'page', name: pages.find((one) => one.id === page)?.title ?? page };
  if (target.graphs) return { kind: 'graphs', name: target.graphs.endsWith('/') ? `${target.graphs.replace(/\/$/, '').split('/').pop()}/` : target.graphs.split('/').pop()! };
  return { kind: 'home', name: 'Home' };
}

/** What opens by itself: Home, the first page (beside the tabs there), or nothing. */
export type Opens = { home: true } | { first: Target; beside: boolean } | undefined;

/**
 * The one rule of what opens by itself. `start`: the window starts on the repo, after VS Code brought back its tabs; else the last tab closed.
 * With the setting off (or no Git repo) nothing opens. A first page opens once at the start, beside the tabs that are there, unless a tab of its view
 * is there already; in an empty editor area it takes the place of Home. With no first page, Home opens in an empty editor area.
 */
export function whatOpens({ tabs, first, on, start, pages }: { tabs: TabNow[]; first?: Target; on: boolean; start: boolean; pages?: { id: string; title: string }[] }): Opens {
  if (!on) return undefined;
  if (first) {
    const view = viewOf(first, pages);
    if (start && tabs.some((tab) => tab.kind === view.kind && tab.name === view.name)) return undefined;
    if (start || !tabs.length) return { first, beside: tabs.length > 0 };
    return undefined;
  }
  return tabs.length ? undefined : { home: true };
}

/** The target of the first page that the rules give, if any. */
export const firstPageOf = (rules: LookRule[]): Target | undefined => Marks.resolve(rules, { kind: 'first-page' }).click;

// ----- F. the list "Look" -----

/** The groups of the list that the rules turn on: "marks", and "pages" when the look has pages. */
export function listGroups(rules: LookRule[], hasPages: boolean): ('marks' | 'pages')[] {
  return (['marks', 'pages'] as const).filter((group) => (group === 'marks' || hasPages) && isShown(rules, { kind: 'look-list', fields: { group } }));
}

/** A row of the list "Look": its words, its quiet words, the value whose icon it has, and what a click does. */
export interface LookRow {
  id: string;
  label: string;
  quiet?: string;
  icon?: string; // "<set>:<value>"
  places?: string; // a click lists the places of this value
  target?: Target; // a click carries out this target
  more?: string; // "n more": a click opens the rest of this group
  rows?: LookRow[];
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

/** At most 50 rows, then one row "n more" that opens the rest; `open` holds the groups whose rest is open. */
function capped(id: string, rows: LookRow[], open: Set<string>): LookRow[] {
  if (rows.length <= ROWS_MOST || open.has(id)) return rows;
  return [...rows.slice(0, ROWS_MOST), { id: `${id}/more`, label: `${rows.length - ROWS_MOST} more`, more: id }];
}

/**
 * The rows of the list "Look": "Marks" with each set and under it each value with its icon and "12 lines · 3 files", and "Pages" with each page of
 * the look, the first page with "first page". `marks` are the marks that stand now, each with its line now.
 */
export function lookRows({ rules, sets, values, marks, pages, open = new Set() }: {
  rules: LookRule[]; sets: { id: string; name: string }[]; values: Record<string, { name: string }>; marks: MarkAt[];
  pages: { id: string; title: string }[]; open?: Set<string>;
}): LookRow[] {
  const groups = listGroups(rules, pages.length > 0);
  const first = firstPageOf(rules);
  return groups.map((group) => {
    if (group === 'pages') {
      const rows = pages.map((page) => ({ id: `pages/${page.id}`, label: page.title, ...(first?.page === page.id ? { quiet: 'first page' } : {}), target: { page: page.id } }));
      return { id: 'pages', label: 'Pages', rows: capped('pages', rows, open) };
    }
    const rows = sets.map((set) => {
      const own = marks.filter((mark) => mark.set === set.id);
      const keys = [...new Set(own.map(keyOf))].sort((a, b) => (values[a]?.name ?? a).localeCompare(values[b]?.name ?? b));
      const valueRows = keys.map((key) => {
        const at = own.filter((mark) => keyOf(mark) === key);
        const lines = new Set(at.map((mark) => `${mark.file}:${mark.at}`)).size;
        return { id: `marks/${key}`, label: values[key]?.name ?? key.split(':')[1], quiet: `${plural(lines, 'line')} · ${plural(new Set(at.map((mark) => mark.file)).size, 'file')}`, icon: key, places: key };
      });
      return { id: `marks/${set.id}`, label: set.name, ...(valueRows.length ? {} : { quiet: 'no marks now' }), rows: capped(`marks/${set.id}`, valueRows, open) };
    });
    return { id: 'marks', label: 'Marks', rows: capped('marks', rows, open) };
  });
}

// ----- what the parts read of the store -----

/** The look of a repo as the parts of VS Code read it: its own rules, actions and pages, and the map with its marks and processes. */
export interface VsCodeLook {
  rules: LookRule[];
  actions: LookAction[];
  pages: { id: string; title: string }[];
  map?: RepoMap;
}

/** Reads the look and the map of a repo from the store. With no look saved, nothing is on. */
export function vscodeLook(store: Store, repo: string | undefined): VsCodeLook {
  const look: Look | undefined = repo ? store.getLook(repo)?.look : undefined;
  return { rules: look?.rules ?? [], actions: look?.actions ?? [], pages: look?.pages ?? [], map: repo ? store.getMap(repo)?.map : undefined };
}

/** The files that some saved change or the map has notes in: the files whose notes the search with # reads. */
export function notedFiles(store: Store, repo: string): string[] {
  const stored = store.getMap(repo);
  const sources = [...store.listChanges(repo), ...store.keptNotes(repo), ...(stored ? [mapSource(stored)] : [])];
  return [...new Set(sources.flatMap((source) => source.file.parts.flatMap((part) => (part.notes ?? []).filter((note) => !note.removed).map((note) => note.file))))].sort();
}
