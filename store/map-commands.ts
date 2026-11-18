// The commands for the map of a repo: map-material, check-map, save-map, add-diagram, add-notes, note-groups, notes, add-processes, process-groups, processes, process, map and diagrams-of;
// and the marks and the look: add-marks, mark-groups, marks, set-look, look and look-slots.

import { afterSave, readJson } from './read-input';
import { fileText, repoId } from '../shared/git';
import { fileNotesSource, filesNeedingNotes, noteGroups, notesOf, readyProcessGroups } from '../shared/note-groups';
import { notesOfFile } from '../shared/notes-beside-code';
import { processFacts, processWithHandoffs, stepKey } from '../shared/processes';
import { diagramsOf, noteCount } from '../shared/repo-map';
import type { Store } from '../shared/store';
import { DEFAULT_RULES, type Look } from '../shared/look';
import { lookSlots } from '../shared/look-slots';
import { mapFit } from '../shared/map-fit';
import { markFacts, markGroups, SERVICES } from '../shared/marks';
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
  notes: 'apostil notes <path>',
  'add-processes': 'apostil add-processes <processes.json> (or - for standard input)',
  'process-groups': 'apostil process-groups [--all]',
  processes: 'apostil processes',
  process: 'apostil process <id>',
  map: 'apostil map [--fit] (--fit: where the notes and the processes do not fit the diagrams)',
  'diagrams-of': 'apostil diagrams-of <path> [--full]',
  'add-marks': 'apostil add-marks <marks.json> (or - for standard input)',
  'mark-groups': 'apostil mark-groups --set <id> [--all]',
  marks: 'apostil marks [--set <id>]',
  'set-look': 'apostil set-look [--check] <look.json> (or - for standard input; --check checks it, files too, and saves nothing)',
  look: 'apostil look',
  'look-slots': 'apostil look-slots [<area> | --find "<words>" | --all] (no argument: the core and one line for each area)',
};

/** The flags of a map command: --full, --all, --set <id>, --check, and --find <words> (an empty text when no words follow). */
export interface MapFlags {
  full?: boolean;
  all?: boolean;
  set?: string;
  check?: boolean;
  find?: string;
  fit?: boolean;
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
      if (!argument) return { output: { problems: ['Usage: apostil notes <path>'] }, ok: false };
      if (!stored) return NO_MAP;
      // How many of its notes still stand at the text of their lines. Each note with its key, as a step of a process names it, and the processes that it is a step of.
      const standing = notesOfFile([fileNotesSource(stored)], argument, fileText(folder, argument) ?? '', () => undefined);
      const notes = notesOf(stored.map, argument).map((note) => {
        const key = stepKey(note);
        const processes = (stored.map.processes ?? []).filter((process) => process.steps.includes(key)).map((process) => process.id);
        return { key, ...note, ...(processes.length ? { processes } : {}) };
      });
      return { output: { file: argument, notes, standing: standing.notes.length, older: standing.older }, ok: true };
    }
    case 'process-groups': {
      const stored = store.getMap(repoId(folder));
      return stored ? { output: readyProcessGroups(folder, stored, all), ok: true } : NO_MAP; // only the areas whose notes are all saved
    }
    case 'processes': {
      const stored = store.getMap(repoId(folder));
      return stored ? { output: processFacts(stored.map), ok: true } : NO_MAP;
    }
    case 'process': {
      const stored = store.getMap(repoId(folder));
      if (!stored) return NO_MAP;
      const process = processWithHandoffs(stored.map, argument);
      return process ? { output: process, ok: true } : { output: { problems: [`The map has no process "${argument}". apostil processes counts them, and apostil notes <path> names the processes of each note.`] }, ok: false };
    }
    case 'map': {
      const stored = store.getMap(repoId(folder));
      if (!stored) return NO_MAP;
      if (flags.fit) return { output: mapFit(stored.map), ok: true };
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

type Done = { output: unknown; ok: boolean; compact?: true };

/** The commands of marks and of the look, but the save of marks (add-marks, with the saves of the other writers). */
const MARK_COMMANDS: Record<string, (store: Store, folder: string, argument: string, flags: MapFlags) => Done> = {
  'mark-groups': (store, folder, _argument, { all = false, set }) => {
    const repo = repoId(folder);
    const found = setsOf(store, repo).find((one) => one.id === set);
    if (!found) return { output: { problems: [`Give the set: apostil mark-groups --set <id>. The sets of this repo are ${setsOf(store, repo).map((one) => one.id).join(', ')}.`] }, ok: false };
    const { values: _values, ...about } = found;
    // The known values come first, so that a writer reuses their ids; for each, whether Apostil keeps its icon.
    const values = valuesOf(store, repo, found.id).map((value) => ({ id: value.id, name: value.name, ...(value.site ? { site: value.site } : {}), icon: !!value.icon }));
    return { output: { set: about, values, ...markGroups(folder, store.getMap(repo)?.map, found.id, all) }, ok: true };
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
    // With no look saved, the default look applies: today's look, with the logos of the services at the upper right of a node, a step and a call, and at the left of each service line of a note.
    return { output: stored ? { savedAt: stored.savedAt, ...stored.look } : { look: 'default', rules: DEFAULT_RULES, sets: [SERVICES] }, ok: true };
  },
};
