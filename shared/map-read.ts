// What an agent reads of the map of a repo in small pieces, as plain lines: the overview, a word search over notes, processes and diagrams, and the
// notes of files, a process and a diagram. A note shows at its lines now, found again by the text of its lines (linesNow: the rule of the editor).

import type { Note } from './change-file';
import { codeText } from './comment-lines';
import type { ShownDiagram } from './context';
import { thingsOf } from './diagram-code';
import { diagramGraph } from './diagram-graph';
import { fileText } from './git';
import { linesNow, noteKey } from './notes-beside-code';
import { parentsWithCalls } from './process-diagrams';
import { isTestPath, parseKey, stepKey, type Process } from './processes';
import { FILE_NOTES_PART, noteCount, notedFileCount } from './repo-map';
import type { StoredMap } from './store';

const CHANGED = '(changed since the map)';
/** What the overview and the search say in a repo with no map. */
export const NO_MAP_WORDS = 'This repo has no map of Apostil. Find and read the code as you would without Apostil.';
const NODE_PATHS = 8; // the folders and files of a node of the top diagram that the overview names; the others are counted
const AREAS = 40; // the other diagrams that the overview names; the others are counted
const K1 = 1.2; // BM25: how soon more of one word in a document stops adding to its score
const B = 0.75; // BM25: how much less a word counts in a long document

/** The commands that the overview names last: what an agent reads next. */
const NEXT = [
  'apostil find "<words of your task>"   the notes, processes and diagrams that match, best first',
  'apostil notes <path> [<path> ...] --text   the notes of files, at their lines now',
  'apostil process <id> --text   the steps of a process, in the order that the code runs them',
  'apostil diagram <id>   one diagram',
];

/** "1 note", "3 notes". */
export const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** At most `most` items, then "and <n> more". */
const shortList = (items: string[], most: number): string => [...items.slice(0, most), ...(items.length > most ? [`and ${items.length - most} more`] : [])].join(', ');

// ----- the notes of a file at their lines now -----

/** One note of a file of the map: its lines now; or its saved lines and `changed` when the text of its lines is no longer in the file. */
export interface NoteNow {
  note: Note;
  lines: [number, number];
  changed?: true;
}

/**
 * The notes of one file of the map at their lines now, in the order of those lines. `text` is the file now; with no file, every note is changed.
 * A note in a cell of a notebook keeps its lines in the cell. A note of a map of an older version, which kept no text of its lines, keeps its saved lines.
 */
export function notesNow(stored: StoredMap, path: string, text: string | undefined): NoteNow[] {
  const lines = text?.split('\n') ?? [];
  const kept = stored.map.noteCode ?? {};
  return (stored.map.fileNotes ?? []).flatMap((note, index): NoteNow[] => {
    if (note.file !== path) return [];
    const code = kept[noteKey(FILE_NOTES_PART, index)];
    const now = code && linesNow(note, code, lines);
    if (code && !now) return [{ note, lines: note.lines, changed: true }];
    return [{ note, lines: now && note.cell === undefined ? now : note.lines }];
  }).sort((a, b) => a.lines[0] - b.lines[0]);
}

/** The notes of some files at their lines now, by the key of each note (its saved lines, as a step names it). Each file is read once. */
function notesAt(folder: string, stored: StoredMap, files: string[]): Map<string, NoteNow> {
  const found = new Map<string, NoteNow>();
  for (const file of new Set(files)) for (const here of notesNow(stored, file, fileText(folder, file))) found.set(stepKey(here.note), here);
  return found;
}

/** The ids of the processes that each note is a step of, by the key of the note. */
export function processesByStep(processes: Process[] = []): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const process of processes) for (const key of new Set(process.steps)) by.set(key, [...(by.get(key) ?? []), process.id]);
  return by;
}

/** Where a note stands now: "<from>-<to>", or with its path first "<path>:<from>-<to>"; a note in a cell of a notebook names its cell ("#<cell>:"). */
const placeOf = (here: NoteNow, withPath: boolean): string => {
  const key = stepKey({ ...here.note, lines: here.lines });
  return withPath ? key : key.slice(here.note.file.length).replace(/^:/, '');
};

/** One note as a line: "<place>  <title>: <text>  [<process ids>]", then "(changed since the map)" when the text of its lines changed. */
function noteLine(here: NoteNow, processes: string[] | undefined, withPath: boolean): string {
  const { note } = here;
  return [`${placeOf(here, withPath)}  ${note.title}${note.text ? `: ${note.text}` : ''}`, processes?.length ? `[${processes.join(', ')}]` : '', here.changed ? CHANGED : '']
    .filter(Boolean).join('  ');
}

/** What `apostil notes <path> ... --text` prints: for each file the line "<path>  <n> notes" (", <m> changed since the map" when some changed), then a line for each note. */
export function notesText(folder: string, stored: StoredMap, paths: string[]): string {
  const steps = processesByStep(stored.map.processes);
  return paths.map((path) => {
    const notes = notesNow(stored, path, fileText(folder, path));
    const changed = notes.filter((one) => one.changed).length;
    const heading = `${path}  ${count(notes.length, 'note')}${changed ? `, ${changed} changed since the map` : ''}`;
    return [heading, ...notes.map((one) => noteLine(one, steps.get(stepKey(one.note)), false))].join('\n');
  }).join('\n\n');
}

// ----- a process and a diagram -----

/**
 * What `apostil process <id> --text` prints: its title and what it does, a line for each step at its lines now ("<path>:<from>-<to>  <title>"; a step
 * under another step, as the drawings nest it, stands two spaces further in), then its handoffs. Undefined when the map has no such process.
 */
export function processText(folder: string, stored: StoredMap, id: string): string | undefined {
  const process = (stored.map.processes ?? []).find((one) => one.id === id);
  if (!process) return undefined;
  const notes = notesAt(folder, stored, process.steps.map((key) => parseKey(key)?.file ?? ''));
  const parents = parentsWithCalls(process, process.steps);
  const depth = (key: string): number => { const outer = parents.get(key); return outer ? 1 + depth(outer) : 0; };
  const steps = process.steps.map((key) => {
    const here = notes.get(key);
    const line = here ? [`${placeOf(here, true)}  ${here.note.title}`, here.changed ? CHANGED : ''].filter(Boolean).join('  ') : `${key}  (its note is gone from the map)`;
    return `${'  '.repeat(depth(key))}${line}`;
  });
  const handoffs = (stored.map.handoffs ?? []).filter((one) => one.from === id || one.to === id)
    .map((one) => `${one.from} -> ${one.to}: ${one.label ?? one.name}  (${one.name}, ${one.fromLine.file}:${one.fromLine.line} -> ${one.toLine.file}:${one.toLine.line})`);
  return [`process ${process.id}  ${process.title}`, process.summary, `${count(steps.length, 'step')}:`, ...steps, ...(handoffs.length ? ['Handoffs:', ...handoffs] : [])].join('\n');
}

/**
 * What `apostil diagram <id> --text` prints: its id, title and kind, its Mermaid text, then a line for each node that leads to code, "<node>: <paths>":
 * the folders and files of a node of the map, the lines of a box of a drawn process, or the code of a node of a change.
 */
export function diagramAsText(shown: ShownDiagram): string {
  const { diagram } = shown;
  const things = thingsOf(diagram).things.filter((thing) => !thing.removed);
  const where = (id: string): string => shown.where?.[id] || (diagram.nodePaths?.[id] ?? []).join(', ') || codeText(things.find((thing) => thing.key === id)?.code);
  const nodes = Object.keys(diagramGraph(diagram).nodes).filter(where).map((id) => `${id}: ${where(id)}`);
  const about = [diagram.kind, ...(shown.branch ? [`of the change on ${shown.branch}`] : [])].join(', ');
  const code = shown.code ? [`Its code: ${shown.code.file}:${shown.code.lines[0]}-${shown.code.lines[1]}`] : [];
  return [`diagram ${diagram.id}  ${diagram.title} (${about})`, diagram.mermaid, ...nodes, ...code].join('\n');
}

// ----- the overview -----

/**
 * What `apostil overview` prints, the first thing an agent reads of a map: the top diagram (its nodes with their folders and files, its arrows), the
 * other diagrams, the counts, and the commands to read next. It lists no process: apostil find finds them.
 */
export function mapOverview(stored: StoredMap): string {
  const { map } = stored;
  const top = map.diagrams.find((diagram) => !diagram.parent) ?? map.diagrams[0];
  const graph = diagramGraph(top);
  const nodes = Object.entries(graph.nodes).map(([id, label]) => {
    const paths = top.nodePaths?.[id] ?? [];
    return `${id}${label !== id ? `  ${label}` : ''}${paths.length ? `: ${shortList(paths, NODE_PATHS)}` : ''}`;
  });
  const arrows = graph.edges.map((edge) => `${edge.from} -> ${edge.to}${edge.label ? `: ${edge.label}` : ''}`);
  const others = map.diagrams.filter((diagram) => diagram !== top).map((diagram) => `diagram ${diagram.id}  ${diagram.title}`);
  return [
    `diagram ${top.id}  ${top.title}`, 'Its nodes, with their folders and files:', ...nodes, ...(arrows.length ? ['Its arrows:', ...arrows] : []),
    ...(others.length ? ['', 'The diagrams of its areas:', ...others.slice(0, AREAS), ...(others.length > AREAS ? [`and ${others.length - AREAS} more: apostil diagrams lists them`] : [])] : []),
    '', `${count((map.processes ?? []).length, 'process', 'processes')} and ${count(noteCount(map), 'note')} in ${count(notedFileCount(map), 'file')}.`,
    '', 'Next:', ...NEXT,
  ].join('\n');
}

// ----- the search -----

/** Small words that say nothing about the code. */
const COMMON = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'with']);

/**
 * A word with its endings stripped: "es" after s, x, z, ch or sh, else "s"; then "ing" or "ed" when a vowel stays before it; then a last "e". So "parse",
 * "parses", "parsed" and "parsing" meet, "file" meets "files", and "setting" meets "settings". A double last letter that ing or ed leaves is made single.
 */
function stem(word: string): string {
  let base = word;
  if (/(ss|x|z|ch|sh)es$/.test(base)) base = base.slice(0, -2);
  else if (/[^s]s$/.test(base) && base.length > 3) base = base.slice(0, -1);
  const cut = /^(.{3,}?)(ing|ed)$/.exec(base);
  if (cut && /[aeiouy]/.test(cut[1])) base = cut[1].length > 3 ? cut[1].replace(/([^aeioulsz])\1$/, '$1') : cut[1]; // "running", "stopped"; not "added"
  return base.length > 3 ? base.replace(/e$/, '') : base;
}

/** The words of a text for the search: camelCase and snake_case split, small letters only, no common small word, each stemmed. */
export function wordsOf(text: string): string[] {
  return text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/)
    .filter((word) => word.length > 1 && !COMMON.has(word)).map(stem);
}

/** The documents that hold a word of the query, best first, by BM25: a rarer word counts more, and a word counts less in a long document. Ties keep their order. */
export function rank(documents: string[][], query: string[]): number[] {
  const counts = documents.map((words) => words.reduce((seen, word) => seen.set(word, (seen.get(word) ?? 0) + 1), new Map<string, number>()));
  const average = documents.reduce((sum, words) => sum + words.length, 0) / Math.max(documents.length, 1);
  const weight = new Map(query.map((word) => {
    const holding = counts.filter((seen) => seen.has(word)).length;
    return [word, Math.log(1 + (documents.length - holding + 0.5) / (holding + 0.5))];
  }));
  const scored = documents.map((words, at) => ({ at, score: query.reduce((sum, word) => {
    const times = counts[at].get(word) ?? 0;
    return sum + (times && weight.get(word)! * times * (K1 + 1) / (times + K1 * (1 - B + B * words.length / average)));
  }, 0) }));
  return scored.filter((one) => one.score > 0).sort((a, b) => b.score - a.score || a.at - b.at).map((one) => one.at);
}

/**
 * What `apostil find <words>` prints: the notes of files, the processes and the diagrams of the map that match the words, best first, in four groups:
 * at most `limit` notes of the code, each at its lines now, then a quarter of that (at least 3) of processes, of diagrams and of notes of test files.
 * Notes of tests have a group of their own: they are short and say the words of the code again, so they would push the notes of the code down.
 * A note is found by the words of its path, its title, its text and the names in the first line of its code (a def, func or class line names what
 * it defines); a process by its title, its summary and the titles of its steps; a diagram by its title and the labels of its nodes.
 */
export function findInMap(folder: string, stored: StoredMap, words: string, limit = 20): string {
  const query = [...new Set(wordsOf(words))];
  const { map } = stored;
  const notes = map.fileNotes ?? [];
  const processes = map.processes ?? [];
  const kept = map.noteCode ?? {};
  const titles = new Map(notes.map((note) => [stepKey(note), note.title]));
  const noteHits = rank(notes.map((note, index) => wordsOf(`${note.file} ${note.title} ${note.text ?? ''} ${kept[noteKey(FILE_NOTES_PART, index)]?.[0] ?? ''}`)), query);
  const processHits = rank(processes.map((process) => wordsOf([process.title, process.summary, ...process.steps.map((key) => titles.get(key) ?? '')].join(' '))), query);
  const diagramHits = rank(map.diagrams.map((diagram) => wordsOf([diagram.title, ...Object.values(diagramGraph(diagram).nodes)].join(' '))), query);
  if (!noteHits.length && !processHits.length && !diagramHits.length) return `Nothing in the map matches "${words}". Try other words, or read apostil overview.`;
  const few = Math.max(3, Math.ceil(limit / 4));
  const codeHits = noteHits.filter((at) => !isTestPath(notes[at].file));
  const testHits = noteHits.filter((at) => isTestPath(notes[at].file));
  const now = notesAt(folder, stored, [...codeHits.slice(0, limit), ...testHits.slice(0, few)].map((at) => notes[at].file));
  const steps = processesByStep(processes);
  const group = (name: string, hits: number[], most: number, line: (at: number) => string): string =>
    (hits.length ? [`${name} (${Math.min(most, hits.length)} of ${hits.length} that match):`, ...hits.slice(0, most).map(line)].join('\n') : '');
  const noteOf = (at: number): string => noteLine(now.get(stepKey(notes[at]))!, steps.get(stepKey(notes[at])), true);
  return [
    group('Notes', codeHits, limit, noteOf),
    group('Processes', processHits, few, (at) => `process ${processes[at].id}  ${processes[at].title} (${count(processes[at].steps.length, 'step')})`),
    group('Diagrams', diagramHits, few, (at) => `diagram ${map.diagrams[at].id}  ${map.diagrams[at].title}`),
    group('Notes of tests', testHits, few, noteOf),
  ].filter(Boolean).join('\n\n');
}
