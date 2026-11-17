// The commands for the map of a repo: map-material, check-map, save-map, add-diagram, add-notes, note-groups, notes, add-processes, process-groups, processes, process, map and diagrams-of;
// and the marks and the look: add-marks, mark-groups, marks, set-look, look and look-slots.

import { afterSave, readJson } from './read-input';
import { fileText, repoId } from '../shared/git';
import { fileNotesSource, filesNeedingNotes, noteGroups, notesOf, processGroups } from '../shared/note-groups';
import { notesOfFile } from '../shared/notes-beside-code';
import { processFacts, processWithHandoffs, stepKey } from '../shared/processes';
import { diagramsOf, noteCount } from '../shared/repo-map';
import type { Store } from '../shared/store';
import { DEFAULT_RULES, LOOK_PARTS } from '../shared/look';
import { markFacts, markGroups, SERVICES } from '../shared/marks';
import { mapForWriters, mapMaterial } from './map-material';
import { addMarksToMap, setLook, setsOf, valuesOf } from './marks-save';
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
  map: 'apostil map',
  'diagrams-of': 'apostil diagrams-of <path> [--full]',
  'add-marks': 'apostil add-marks <marks.json> (or - for standard input)',
  'mark-groups': 'apostil mark-groups --set <id> [--all]',
  marks: 'apostil marks [--set <id>]',
  'set-look': 'apostil set-look <look.json> (or - for standard input)',
  look: 'apostil look',
  'look-slots': 'apostil look-slots',
};

/** Runs one of the map commands. Returns what to print and if the command did its work. */
export function runMapCommand(store: Store, command: string, argument: string, folder: string, full: boolean, all = false, set?: string): { output: unknown; ok: boolean } {
  const draft = (): unknown => readJson(argument);
  const NO_MAP = { output: { problems: ['This repo has no saved map. Save one with apostil save-map.'] }, ok: false };
  if (command in MARK_COMMANDS) return MARK_COMMANDS[command](store, folder, argument, all, set);
  switch (command) {
    case 'map-material': return { output: mapMaterial(store, folder), ok: true };
    case 'check-map': {
      const result = checkMapDraft(folder, draft());
      return { output: result, ok: result.problems.length === 0 };
    }
    case 'save-map': {
      const result = saveMapDraft(store, folder, draft());
      return { output: result.saved ? afterSave(result, folder, argument) : result, ok: result.saved };
    }
    case 'add-diagram': {
      const result = addDiagramToMap(store, folder, draft());
      return { output: result.saved ? afterSave(result, folder, argument) : result, ok: result.saved };
    }
    case 'add-notes': {
      const result = addNotesToMap(store, folder, draft());
      return { output: result.saved ? afterSave(result, folder, argument) : result, ok: result.saved };
    }
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
    case 'add-processes': {
      const result = addProcessesToMap(store, folder, draft());
      return { output: result.saved ? afterSave(result, folder, argument) : result, ok: result.saved };
    }
    case 'process-groups': {
      const stored = store.getMap(repoId(folder));
      return stored ? { output: processGroups(stored.map, all), ok: true } : NO_MAP;
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

type Done = { output: unknown; ok: boolean };

/** The commands of marks and of the look. */
const MARK_COMMANDS: Record<string, (store: Store, folder: string, argument: string, all: boolean, set?: string) => Done> = {
  'add-marks': (store, folder, argument) => {
    const result = addMarksToMap(store, folder, readJson(argument));
    return { output: result.saved ? afterSave(result, folder, argument) : result, ok: result.saved };
  },
  'mark-groups': (store, folder, _argument, all, set) => {
    const repo = repoId(folder);
    const found = setsOf(store, repo).find((one) => one.id === set);
    if (!found) return { output: { problems: [`Give the set: apostil mark-groups --set <id>. The sets of this repo are ${setsOf(store, repo).map((one) => one.id).join(', ')}.`] }, ok: false };
    const { values: _values, ...about } = found;
    // The known values come first, so that a writer reuses their ids; for each, whether Apostil keeps its icon.
    const values = valuesOf(store, repo, found.id).map((value) => ({ id: value.id, name: value.name, ...(value.site ? { site: value.site } : {}), icon: !!value.icon }));
    return { output: { set: about, values, ...markGroups(folder, store.getMap(repo)?.map, found.id, all) }, ok: true };
  },
  marks: (store, folder, _argument, _all, set) => {
    const repo = repoId(folder);
    return { output: markFacts(folder, store.getMap(repo)?.map, setsOf(store, repo), (one) => valuesOf(store, repo, one), set), ok: true };
  },
  'set-look': (store, folder, argument) => {
    const result = setLook(store, folder, readJson(argument));
    return { output: result.saved ? afterSave(result, folder, argument) : result, ok: result.saved };
  },
  // Every component that a look can change, its slots with their fields and the kinds of their values, what a rule can pick, and every action: the one list.
  'look-slots': () => ({ output: LOOK_PARTS, ok: true }),
  look: (store, folder) => {
    const stored = store.getLook(repoId(folder));
    // With no look saved, the default look applies: today's look, with the logos of the services at the upper right of a node, a step and a note.
    return { output: stored ? { savedAt: stored.savedAt, ...stored.look } : { look: 'default', rules: DEFAULT_RULES, sets: [SERVICES] }, ok: true };
  },
};
