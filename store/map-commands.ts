// The commands for the map of a repo: map-material, check-map, save-map, add-diagram, add-notes, note-groups, notes, add-processes, process-groups, processes, process, map and diagrams-of;
// what an agent reads of the map as plain text: overview and find; and the marks and the look: add-marks, mark-groups, marks, set-look, look and look-slots.

import { afterSave, readJson } from './read-input';
import { fileText, repoId } from '../shared/git';
import { codeFiles, fileNotesSource, filesNeedingNotes, groupProcessFacts, noteGroups, notesOf, readyProcessGroups } from '../shared/note-groups';
import { findInMap, mapOverview, NO_MAP_WORDS, notesNow, notesText, processText } from '../shared/map-read';
import { notesOfFile } from '../shared/notes-beside-code';
import { processFacts, processWithHandoffs, stepKey } from '../shared/processes';
import { diagramsOf, noteCount } from '../shared/repo-map';
import type { Store } from '../shared/store';
import { DEFAULT_RULES, type Look } from '../shared/look';
import { lookSlots } from '../shared/look-slots';
import { mapFit } from '../shared/map-fit';
import { markFacts, readyMarkGroups, SERVICES } from '../shared/marks';
import { lookChanges } from './look-changes';
import { mapForWriters, mapMaterial } from './map-material';
import { mapSaveOf, recordMapSave } from './map-run';
import { addMarksToMap, checkLook, setLook, setsOf, valuesOf } from './marks-save';
import { addProcessesToMap } from './processes-save';
import { addDiagramToMap, addNotesToMap, checkMapDraft, saveMapDraft } from './save';

/** What `apostil map` says when code files need notes: notes do not need a change, the notes writers write them. */
export const notesHint = (files: number): string =>
  `${files} code ${files === 1 ? 'file needs' : 'files need'} notes. Notes on the code as it is come with the map and need no change and no commit: run apostil note-groups and start one notes writer for each group (skill apostil-map-repo, Step 3).`;

export const MAP_USAGE: Record<string, string> = {
  'map-material': 'apostil map-material',
  'check-map': 'apostil check-map <map.json> (or - for the JSON on standard input)',
  'save-map': 'apostil save-map <map.json> (or - for standard input)',
  'add-diagram': 'apostil add-diagram <diagram.json> (or - for standard input)',
  'add-notes': 'apostil add-notes <notes.json> (or - for standard input)',
  'note-groups': 'apostil note-groups [--all]',
  notes: 'apostil notes <path> [<path> ...] [--text] (several paths print { "files": [ ... ] }, one entry for each; a note has "now": [from, to] when its lines moved, and "changed": true when their text is no longer in the file; --text: plain lines, each note at its lines now)',
  'add-processes': 'apostil add-processes <processes.json> (or - for standard input)',
  'process-groups': 'apostil process-groups [--all]',
  processes: 'apostil processes [--group <name>] (--group: only the files and the processes of that group of process-groups)',
  process: 'apostil process <id> [--text] (--text: plain lines, each step at its lines now)',
  overview: 'apostil overview (plain text: the top diagram of the map, its other diagrams, the counts, and the commands to read next; read it first)',
  find: 'apostil find <words> [--limit <n>] (plain text: the notes, processes and diagrams of the map that match the words, best first; at most n notes, 20 by default)',
  map: 'apostil map [--fit] (--fit: where the notes and the processes do not fit the diagrams, and the used code with no note)',
  'diagrams-of': 'apostil diagrams-of <path> [--full]',
  'add-marks': 'apostil add-marks <marks.json> (or - for standard input)',
  'mark-groups': 'apostil mark-groups --set <id> [--all]',
  marks: 'apostil marks [--set <id>]',
  'set-look': 'apostil set-look [--check] <look.json> (or - for standard input; --check checks it, files too, and saves nothing)',
  look: 'apostil look',
  'look-slots': 'apostil look-slots [<area> | --find "<words>" | --all] (no argument: the core and one line for each area)',
};

/** The flags of a map command: --full, --all, --set <id>, --group <name>, --check, and --find <words> (an empty text when no words follow). */
export interface MapFlags {
  full?: boolean;
  all?: boolean;
  set?: string;
  group?: string;
  check?: boolean;
  find?: string;
  fit?: boolean;
  text?: boolean; // plain lines in place of JSON: apostil notes and apostil process
  limit?: string; // apostil find: the most notes to print
  more?: string[]; // the words after the first argument: the other paths of apostil notes, the other words of apostil find
}

/**
 * Runs one of the map commands. Returns what to print and if the command did its work.
 * A save of a writer that worked is kept in the record of the map run (store/map-run.ts); `env` says which session saves.
 */
export function runMapCommand(store: Store, command: string, argument: string, folder: string, flags: MapFlags = {}, env: Record<string, string | undefined> = process.env): Done {
  const { full = false, all = false } = flags;
  const draft = (): unknown => readJson(argument);
  /** The answer of a save command of a writer, for the JSON that it was given. */
  const saved = (given: unknown, result: { saved: boolean; files?: number }): Done => {
    try {
      if (result.saved) recordMapSave(store, folder, mapSaveOf(command, given, result), env);
    } catch { /* the record is a help for the owner: a save never fails for it */ }
    return { output: result.saved ? afterSave(result, folder, argument) : result, ok: result.saved };
  };
  const NO_MAP = { output: { problems: ['This repo has no saved map. Save one with apostil save-map.'] }, ok: false };
  // The plain text commands: a problem is one plain line too.
  const said = (output: string, ok = true): Done => ({ output, ok, text: true });
  const NO_MAP_TEXT = said(NO_MAP_WORDS, false);
  if (command in MARK_COMMANDS) return MARK_COMMANDS[command](store, folder, argument, flags);
  switch (command) { // the five saves of the writers first
    case 'map-material': return { output: mapMaterial(store, folder), ok: true };
    case 'check-map': {
      const result = checkMapDraft(folder, draft());
      return { output: result, ok: result.problems.length === 0 };
    }
    case 'save-map': { const given = draft(); return saved(given, saveMapDraft(store, folder, given)); }
    case 'add-diagram': { const given = draft(); return saved(given, addDiagramToMap(store, folder, given)); }
    case 'add-notes': { const given = draft(); return saved(given, addNotesToMap(store, folder, given)); }
    case 'add-processes': { const given = draft(); return saved(given, addProcessesToMap(store, folder, given)); }
    case 'add-marks': { const given = draft(); return saved(given, addMarksToMap(store, folder, given)); }
    case 'note-groups': return { output: noteGroups(folder, store.getMap(repoId(folder)), all), ok: true };
    case 'notes': {
      const stored = store.getMap(repoId(folder));
      const paths = [argument, ...(flags.more ?? [])].filter(Boolean);
      if (!paths.length) return { output: { problems: [`Usage: ${MAP_USAGE.notes}`] }, ok: false };
      if (!stored) return flags.text ? NO_MAP_TEXT : NO_MAP;
      if (flags.text) return said(notesText(folder, stored, paths));
      const source = fileNotesSource(stored);
      // The notes of one file: how many still stand at the text of their lines, and each with its key, as a step of a process names it, and the processes that it is a step of.
      // A note whose lines moved has "now", its lines now; a note whose text is no longer in the file has "changed".
      const notesOfPath = (path: string) => {
        const text = fileText(folder, path);
        const standing = notesOfFile([source], path, text ?? '', () => undefined);
        const now = new Map(notesNow(stored, path, text).map((here) => [stepKey(here.note), here]));
        const notes = notesOf(stored.map, path).map((note) => {
          const key = stepKey(note);
          const processes = (stored.map.processes ?? []).filter((process) => process.steps.includes(key)).map((process) => process.id);
          const here = now.get(key);
          const moved = here && !here.changed && (here.lines[0] !== note.lines[0] || here.lines[1] !== note.lines[1]);
          return { key, ...note, ...(processes.length ? { processes } : {}), ...(moved ? { now: here.lines } : {}), ...(here?.changed ? { changed: true } : {}) };
        });
        return { file: path, notes, standing: standing.notes.length, older: standing.older };
      };
      // One path prints its file; several print one entry for each, so that a writer reads them in one plain command.
      return { output: paths.length === 1 ? notesOfPath(paths[0]) : { files: paths.map(notesOfPath) }, ok: true };
    }
    case 'process-groups': {
      const stored = store.getMap(repoId(folder));
      return stored ? { output: readyProcessGroups(folder, stored, all), ok: true } : NO_MAP; // only the areas whose notes are all saved
    }
    case 'processes': {
      const stored = store.getMap(repoId(folder));
      if (!stored) return NO_MAP;
      if (flags.group === undefined) return { output: processFacts(stored.map), ok: true };
      // The check of one group: its writer runs it before it reports, and the lead starts its second round from it at once.
      const facts = groupProcessFacts(stored.map, flags.group);
      return facts ? { output: facts, ok: true } : { output: { problems: [`No group of the process writers is named "${flags.group}". apostil process-groups --all names them.`] }, ok: false };
    }
    case 'process': {
      const stored = store.getMap(repoId(folder));
      if (!stored) return flags.text ? NO_MAP_TEXT : NO_MAP;
      const problem = `The map has no process "${argument}". apostil find <words> finds processes, and apostil notes <path> names the processes of each note.`;
      if (flags.text) {
        const lines = processText(folder, stored, argument);
        return lines ? said(lines) : said(problem, false);
      }
      const process = processWithHandoffs(stored.map, argument);
      return process ? { output: process, ok: true } : { output: { problems: [problem] }, ok: false };
    }
    case 'overview': {
      const stored = store.getMap(repoId(folder));
      return stored ? said(mapOverview(stored)) : NO_MAP_TEXT;
    }
    case 'find': {
      const words = [argument, ...(flags.more ?? [])].join(' ').trim();
      const limit = Number(flags.limit ?? 20);
      if (!words) return said(`Usage: ${MAP_USAGE.find}`, false);
      if (!Number.isInteger(limit) || limit < 1) return said('--limit takes a whole number above 0.', false);
      const stored = store.getMap(repoId(folder));
      return stored ? said(findInMap(folder, stored, words, limit)) : NO_MAP_TEXT;
    }
    case 'map': {
      const stored = store.getMap(repoId(folder));
      if (!stored) return NO_MAP;
      if (flags.fit) return { output: mapFit(stored.map, codeFiles(folder).files), ok: true };
      // How many notes the map holds and in how many files, and what to do when code files lack notes: an agent that is asked for notes reads this, and does not ask for a commit.
      // The notes of files are not printed: an area writer reads this, and it must stay short.
      const notes = noteCount(stored.map);
      const notedFiles = new Set([...(stored.map.fileNotes ?? []), ...stored.map.diagrams.flatMap((diagram) => diagram.notes ?? [])].map((note) => note.file)).size;
      const needing = filesNeedingNotes(folder, stored);
      // The notes come first: a process is made of notes. Then the hint of the processes, when work is left for the process writers.
      const flow = processFacts(stored.map);
      const hint = needing ? notesHint(needing) : flow.hint;
      return { output: { ...mapForWriters(stored), notes, notedFiles, processes: flow.processes, ...(hint ? { hint } : {}) }, ok: true };
    }
    default: {
      if (!argument) return { output: { problems: ['Usage: apostil diagrams-of <path> [--full]'] }, ok: false };
      const found = diagramsOf(store, folder, argument);
      // The drawing of a process is for the graphs page; an agent reads the diagram.
      const shown = found.map(({ drawn: _drawn, ...entry }) => (entry.diagram && !full ? { ...entry, diagram: { ...entry.diagram, mermaid: undefined, before: undefined } } : entry));
      return { output: shown, ok: true };
    }
  }
}

type Done = { output: unknown; ok: boolean; compact?: true; text?: true }; // text: the output is plain text, printed as it is

/** The commands of marks and of the look, but the save of marks (add-marks, with the saves of the other writers). */
const MARK_COMMANDS: Record<string, (store: Store, folder: string, argument: string, flags: MapFlags) => Done> = {
  'mark-groups': (store, folder, _argument, { all = false, set }) => {
    const repo = repoId(folder);
    const found = setsOf(store, repo).find((one) => one.id === set);
    if (!found) return { output: { problems: [`Give the set: apostil mark-groups --set <id>. The sets of this repo are ${setsOf(store, repo).map((one) => one.id).join(', ')}.`] }, ok: false };
    const { values: _values, ...about } = found;
    // The known values come first, so that a writer reuses their ids; for each, whether Apostil keeps its icon.
    const values = valuesOf(store, repo, found.id).map((value) => ({ id: value.id, name: value.name, ...(value.site ? { site: value.site } : {}), icon: !!value.icon }));
    return { output: { set: about, values, ...readyMarkGroups(folder, store.getMap(repo), found.id, all) }, ok: true }; // only the areas whose notes are all saved
  },
  marks: (store, folder, _argument, { set }) => {
    const repo = repoId(folder);
    return { output: markFacts(folder, store.getMap(repo)?.map, setsOf(store, repo), (one) => valuesOf(store, repo, one), set), ok: true };
  },
  // With --check: the problems, and what each rule picks now; nothing is saved and no file is removed. Else the save, and the same changes after it.
  'set-look': (store, folder, argument, { check }) => {
    const draft = readJson(argument);
    if (check) {
      const problems = checkLook(store, folder, draft);
      const said = problems.length ? { changes: [], notes: [] } : lookChanges(store, folder, draft as Look);
      return { output: { ok: !problems.length, problems, ...said }, ok: !problems.length };
    }
    const result = setLook(store, folder, draft);
    return { output: result.saved ? afterSave({ ...result, ...lookChanges(store, folder, draft as Look) }, folder, argument) : result, ok: result.saved };
  },
  // The one list in parts: the core and the index, one area, a search, or all of it (shared/look-slots.ts).
  'look-slots': (_store, _folder, argument, { find, all = false }) => lookSlots(argument, find, all),
  look: (store, folder) => {
    const stored = store.getLook(repoId(folder));
    // With no look saved, the default look applies: the logos of the services at the upper right of a node, a step and a call, and at the left of each service line of a note.
    return { output: stored ? { savedAt: stored.savedAt, ...stored.look } : { look: 'default', rules: DEFAULT_RULES, sets: [SERVICES] }, ok: true };
  },
};
