// The saves of the writers of a map keep the record of the map run: which session writes the map, and what is saved so far (shared/map-run.ts).

import { agentFromEnv } from '../shared/agents';
import type { Diagram } from '../shared/change-file';
import { repoId } from '../shared/git';
import { withEnd, withSave, type MapRun, type MapSave } from '../shared/map-run';
import { markGroups } from '../shared/marks';
import { noteGroups, processGroups } from '../shared/note-groups';
import type { Store } from '../shared/store';
import { setsOf } from './marks-save';

/** What a save command of a writer saved, for the record: save-map, add-diagram, add-notes, add-processes or add-marks. */
export function mapSaveOf(command: string, draft: unknown, result: { files?: number }): MapSave {
  const given = draft as Diagram & { group: string; set: string }; // a save that worked had the right shape
  if (command === 'save-map') return { overview: true };
  if (command === 'add-diagram') return { area: given.title };
  if (command === 'add-notes') return { noteFiles: result.files ?? 0 };
  if (command === 'add-processes') return { processGroup: given.group };
  return { marks: given.set };
}

/**
 * True while the writers of this run have work in the map. A run that writes the whole map: notes wait for the first process writers, a set of marks
 * has a group, or a code file needs notes. A run that writes a part asks only for the kinds that it saved: notes, or marks.
 * The costly questions (they read the code files) come last.
 */
export function mapWorkLeft(store: Store, folder: string, run: MapRun): boolean {
  const repo = repoId(folder);
  const stored = store.getMap(repo);
  if (!stored) return true;
  const { map } = stored;
  if (run.whole && !map.processes?.length && processGroups(map).groups.length > 0) return true;
  if ((run.whole || run.parts.marks?.length) && setsOf(store, repo).some((set) => markGroups(folder, map, set.id).groups.length > 0)) return true;
  return (run.whole || !!run.parts.noteFiles) && noteGroups(folder, stored).groups.length > 0;
}

/**
 * After a save of a writer: the first save starts the record when none is open, with the session from the environment; each save adds its part.
 * The record ends at the save that leaves no work for the writers: in a run of the whole skill, the last `apostil add-marks` of its Step 7 (the service writers and the mark writers).
 */
export function recordMapSave(store: Store, folder: string, save: MapSave, env: Record<string, string | undefined> = process.env, now = new Date()): void {
  const repo = repoId(folder);
  const top = store.getMap(repo)?.map.diagrams.find((diagram) => !diagram.parent);
  const at = now.toISOString();
  let run: MapRun | undefined;
  store.changeMapRun(repo, (stored) => (run = withSave(stored, save, agentFromEnv(env), Object.keys(top?.nodePaths ?? {}).length, at)));
  if (run && !mapWorkLeft(store, folder, run)) store.changeMapRun(repo, (stored) => withEnd(stored, at));
}
