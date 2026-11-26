// The processes of a repo: jobs of the code from their start to their result, whose steps are the notes of files of the map.
// Process writers save them with `apostil add-processes` (store/processes-save.ts); this file holds their form, the keys of the steps and what is read back.

import type { Note } from './change-file';
import type { CellName } from './notebook';

/** An arrow between two steps of one process: a call, the start of a script, a value or a file that one step writes and the other reads. */
export interface Arrow {
  from: string; // the key of a step
  to: string;
  label?: string; // at most 4 words
  fromLine: number; // a line of the step "from": where the code calls, starts or writes; for a branch, the line of the condition or the loop
  toLine?: number; // a line of the step "to": where the target is defined or reads; a branch has none
  name?: string; // a word that stands on both lines; a branch has none
  kind?: 'branch'; // a jump between two steps inside one outer step, which otherwise follow the order of the list
}

/** A call out of the repo: a library or a program. */
export interface OutsideArrow {
  from: string; // the key of a step
  to: string; // the library or the program
  label?: string;
  fromLine: number; // a line of the step that holds `name`
  name: string;
}

/** A line of a file, for an end of a handoff; in a notebook, a line inside a cell. */
export interface LineAt {
  file: string;
  cell?: CellName;
  line: number;
}

/** A file or a value that one process makes and another reads. */
export interface Handoff {
  from: string; // the id of a process
  to: string;
  label?: string;
  name: string; // a word that stands on both lines
  fromLine: LineAt;
  toLine: LineAt;
  group?: string; // the group that saved it: its next save replaces it
}

export interface Process {
  id: string; // small letters, digits and "-"; one in the map
  title: string; // a bare verb, at most 6 words
  summary: string; // one sentence of at most 20 words
  group: string; // the group of the writer that saved it
  steps: string[]; // keys of notes, in the order the code runs them; the first is where the process starts
  arrows?: Arrow[];
  outside?: OutsideArrow[];
}

/** A note that takes part in no process, with the reason. */
export interface SetAside {
  note: string;
  why: string; // at most 12 words
  group?: string;
}

/** The processes of a map, as the map holds them. */
export interface MapProcesses {
  processes?: Process[];
  handoffs?: Handoff[];
  notInProcess?: SetAside[];
  fileNotes?: Note[];
}

/**
 * The key of a note: "<file>:<first>-<last>"; a note in a cell of a notebook is "<file>#<cell>:<first>-<last>", with the lines counted inside that cell.
 * A step of a process names its note by this key.
 */
export const stepKey = (note: Pick<Note, 'file' | 'cell' | 'lines'>): string => `${note.file}${note.cell !== undefined ? `#${note.cell}` : ''}:${note.lines[0]}-${note.lines[1]}`;

export interface StepPlace {
  file: string;
  cell?: string;
  from: number;
  to: number;
}

/** The file, the cell and the lines of a key, or undefined when it is no key. */
export function parseKey(key: unknown): StepPlace | undefined {
  const match = typeof key === 'string' ? /^(.+?)(?:#([^#:/]+))?:(\d+)-(\d+)$/.exec(key) : null;
  if (!match) return undefined;
  return { file: match[1], ...(match[2] !== undefined ? { cell: match[2] } : {}), from: Number(match[3]), to: Number(match[4]) };
}

/** True when a line (in the same file and cell) lies inside the lines of a key. */
export const holdsLine = (key: string, at: { file: string; cell?: CellName; line: number }): boolean => {
  const place = parseKey(key);
  return !!place && place.file === at.file && (place.cell ?? '') === String(at.cell ?? '') && at.line >= place.from && at.line <= place.to;
};

/**
 * A test file: a folder named test, tests, __tests__ or spec, or a name such as test_x.py, x_test.go, x.test.ts or x.spec.js, or conftest.py.
 * The notes of a test file need no process. The one rule for a test path.
 */
export const isTestPath = (path: string): boolean =>
  /(^|\/)(tests?|__tests__|spec)\//.test(path) || /(^|\/)(test_[^/]*|[^/]*_test\.[a-z]+|[^/]*\.(test|spec)\.[a-z]+|conftest\.py)$/i.test(path);

/** The step of a list that holds a step most closely: the smallest other step in the same file and cell whose lines hold its lines, or undefined. */
export function parentOf(key: string, steps: string[]): string | undefined {
  const own = parseKey(key);
  if (!own) return undefined;
  let best: { key: string; size: number } | undefined;
  for (const other of steps) {
    const place = parseKey(other);
    if (!place || other === key || place.file !== own.file || place.cell !== own.cell || place.from > own.from || place.to < own.to) continue;
    if (place.from === own.from && place.to === own.to) continue;
    const size = place.to - place.from;
    if (!best || size < best.size) best = { key: other, size };
  }
  return best?.key;
}

/** The outer step of each step of a process (undefined at the top), by its key. */
export const parentsOf = (steps: string[]): Map<string, string | undefined> => new Map(steps.map((key) => [key, parentOf(key, steps)]));

/** The keys of the notes of a map. */
export const noteKeys = (map: MapProcesses): Set<string> => new Set((map.fileNotes ?? []).map(stepKey));

/** The steps of a process that name a note that is gone: the notes of its file were written again. A process with one is stale. Found when the map is read. */
export const goneSteps = (process: Process, keys: Set<string>): string[] => process.steps.filter((key) => !keys.has(key));

/** The notes that need a process: the notes of files that are not test files. */
export const notesNeedingProcess = (map: MapProcesses): Note[] => (map.fileNotes ?? []).filter((note) => !isTestPath(note.file));

/** The keys of the notes that are a step of a process, or set aside. */
export function coveredKeys(map: MapProcesses): { steps: Set<string>; aside: Set<string> } {
  return { steps: new Set((map.processes ?? []).flatMap((process) => process.steps)), aside: new Set((map.notInProcess ?? []).map((one) => one.note)) };
}

/** The notes that need a process and are in no process and not set aside. */
export function notesInNoProcess(map: MapProcesses): Note[] {
  const { steps, aside } = coveredKeys(map);
  return notesNeedingProcess(map).filter((note) => !steps.has(stepKey(note)) && !aside.has(stepKey(note)));
}

/** A process that is a part of another process, and why: the fold writers write `into` again with its steps, and the save takes it out of the map. */
export interface Fold {
  process: string;
  into: string;
  why: 'starts inside' | 'mostly inside' | 'same job';
}

const MOSTLY_INSIDE = 0.8;
const SAME_JOB = 0.6;

/**
 * The processes that can fold into another, each once, by the first rule that holds. "starts inside": its first step is a later step of another process,
 * the largest. "mostly inside": 80% of its steps are steps of one bigger process, the largest. "same job": it shares 60% of all the steps of the two with a
 * process of another group that has at least as many steps, the largest. `into` is the end of the chain of folds; in a loop the largest process of the loop is the end.
 */
export function processFolds(processes: Process[]): Fold[] {
  const steps = new Map(processes.map((process) => [process.id, new Set(process.steps)]));
  const size = (process: Process): number => steps.get(process.id)!.size;
  const shared = (a: Process, b: Process): number => [...steps.get(a.id)!].filter((key) => steps.get(b.id)!.has(key)).length;
  // On a tie the first in the map, so that every process of a loop finds the same end.
  const largest = (list: Process[]): Process | undefined => list.reduce<Process | undefined>((best, one) => (!best || size(one) > size(best) ? one : best), undefined);
  const next = new Map<string, Pick<Fold, 'into' | 'why'>>();
  for (const process of processes) {
    const others = processes.filter((other) => other !== process);
    const startsIn = largest(others.filter((other) => other.steps.indexOf(process.steps[0]) > 0));
    const mostlyIn = largest(others.filter((other) => size(other) > size(process) && shared(process, other) / size(process) >= MOSTLY_INSIDE));
    const sameJob = largest(others.filter((other) => other.group !== process.group && size(other) >= size(process)
      && shared(process, other) / (size(process) + size(other) - shared(process, other)) >= SAME_JOB));
    const fold: Pick<Fold, 'into' | 'why'> | undefined = startsIn ? { into: startsIn.id, why: 'starts inside' }
      : mostlyIn ? { into: mostlyIn.id, why: 'mostly inside' } : sameJob ? { into: sameJob.id, why: 'same job' } : undefined;
    if (fold) next.set(process.id, fold);
  }
  const end = (id: string): string => {
    const chain: string[] = [];
    let at = id;
    while (next.has(at) && !chain.includes(at)) {
      chain.push(at);
      at = next.get(at)!.into;
    }
    if (!next.has(at)) return at;
    const loop = chain.slice(chain.indexOf(at));
    return largest(processes.filter((process) => loop.includes(process.id)))!.id;
  };
  return processes.flatMap((process) => {
    const fold = next.get(process.id);
    if (!fold) return [];
    const into = end(process.id);
    return into === process.id ? [] : [{ process: process.id, into, why: fold.why }];
  });
}

const KEYS_SHOWN = 5;
const STALE_SHOWN = 20;

/** What `apostil processes` says when work is left. */
export const processHint = (left: number, stale: number, none: boolean, folds: number): string | undefined => {
  if (none) return 'This map has no processes yet. Run apostil process-groups and start one process writer for each group (skill apostil-map-repo, Step 4).';
  const what = [left ? `${left} ${left === 1 ? 'note is' : 'notes are'} in no process` : '', stale ? `${stale} ${stale === 1 ? 'process is' : 'processes are'} stale` : ''].filter(Boolean).join(', and ');
  return [
    what ? `${what}. Run apostil process-groups and start one process writer for each group that it lists (skill apostil-map-repo, Step 4).` : '',
    folds ? `${folds} ${folds === 1 ? 'process' : 'processes'} can fold into another process. Start one fold writer for each "into" of "fold" in apostil processes (skill apostil-map-repo, Step 6).` : '',
  ].filter(Boolean).join(' ') || undefined;
};

/** The counts that `apostil processes` prints: never whole processes, because an agent reads it. */
export function processFacts(map: MapProcesses) {
  const keys = noteKeys(map);
  const processes = map.processes ?? [];
  const { steps, aside } = coveredKeys(map);
  const left = notesInNoProcess(map);
  const byFile = new Map<string, string[]>();
  for (const note of left) byFile.set(note.file, [...(byFile.get(note.file) ?? []), stepKey(note)]);
  const stale = processes.map((process) => ({ id: process.id, group: process.group, gone: goneSteps(process, keys) })).filter((one) => one.gone.length);
  const fold = processFolds(processes);
  const hint = processHint(left.length, stale.length, processes.length === 0 && notesNeedingProcess(map).length > 0, fold.length);
  return {
    processes: processes.length,
    steps: [...steps].filter((key) => keys.has(key)).length,
    setAside: [...aside].filter((key) => keys.has(key) && !steps.has(key)).length,
    notes: notesNeedingProcess(map).length,
    notInProcess: {
      count: left.length,
      files: [...byFile].map(([file, notes]) => ({ file, count: notes.length, notes: notes.slice(0, KEYS_SHOWN) })),
    },
    stale: stale.slice(0, STALE_SHOWN).map((one) => ({ id: one.id, group: one.group, gone: one.gone.length })),
    ...(stale.length > STALE_SHOWN ? { moreStale: stale.length - STALE_SHOWN } : {}),
    fold,
    ...(hint ? { hint } : {}),
  };
}

/** One process with its handoffs in and out: what `apostil process <id>` prints. */
export function processWithHandoffs(map: MapProcesses, id: string) {
  const process = (map.processes ?? []).find((one) => one.id === id);
  if (!process) return undefined;
  const handoffs = (map.handoffs ?? []).filter((handoff) => handoff.from === id || handoff.to === id);
  return { ...process, gone: goneSteps(process, noteKeys(map)), handoffs };
}
