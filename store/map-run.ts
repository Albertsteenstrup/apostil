// The saves of the writers of a map keep the record of the map run: which session writes the map, what is saved so far, when, and the plan of the work
// (shared/map-run.ts, shared/map-estimate.ts).

import { agentFromEnv } from '../shared/agents';
import type { Diagram } from '../shared/change-file';
import { lineCount, repoId } from '../shared/git';
import { areasOfSize, doneOf, topAreasOfSize, WAVE_MINUTES, type MapPlan } from '../shared/map-estimate';
import { mapFit } from '../shared/map-fit';
import { withEnd, withSave, type AreaWork, type MapRun, type MapSave } from '../shared/map-run';
import { markGroups } from '../shared/marks';
import { areaOf, areasWaitingForNotes, codeFiles, noteGroups, processGroups } from '../shared/note-groups';
import type { Store, StoredMap } from '../shared/store';
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

/** True when the run saved the processes of some group twice: the second process round (Step 5 of the skill) has started. */
const secondRound = (run: MapRun): boolean => (run.saves ?? []).filter(([kind]) => kind === 'p').length > (run.parts.processGroups?.length ?? 0);

/** True when the run saved an overview after its first processes: the fit round of the top diagram (Step 6 of the skill) happened. */
function fitDone(run: MapRun): boolean {
  const saves = run.saves ?? [];
  const first = saves.find(([kind]) => kind === 'p')?.[1];
  return first !== undefined && saves.some(([kind, at]) => kind === 'o' && at >= first);
}

/** True when `apostil map --fit` lists something for the fit round to correct. */
const fitHasWork = (stored: StoredMap): boolean => Object.values(mapFit(stored.map)).some((list) => list.count > 0);

/**
 * True while the writers of this run have work in the map. A run that writes the whole map (its steps run side by side): a group of the process
 * writers has no process yet, the second process round or the fit round is still to come after processes of this run, a set of marks has a group, or a
 * code file needs notes. A run that writes a part asks only for the kinds that it saved: notes, or marks. The costly questions (they read the code files) come last.
 */
export function mapWorkLeft(store: Store, folder: string, run: MapRun): boolean {
  const repo = repoId(folder);
  const stored = store.getMap(repo);
  if (!stored) return true;
  const { map } = stored;
  if (run.whole) {
    const groups = processGroups(map).groups;
    if (groups.some((group) => group.why?.includes('no process yet'))) return true;
    const processed = (run.parts.processGroups?.length ?? 0) > 0;
    if (processed && groups.length > 0 && !secondRound(run)) return true;
    if (processed && !fitDone(run) && fitHasWork(stored)) return true;
  }
  if ((run.whole || run.parts.marks?.length) && setsOf(store, repo).some((set) => markGroups(folder, map, set.id).groups.length > 0)) return true;
  return (run.whole || !!run.parts.noteFiles) && noteGroups(folder, stored).groups.length > 0;
}

/**
 * The plan of the work that a run has left now (shared/map-estimate.ts), from the code files of the repo and what its map holds. Before the overview the
 * steps that are not known yet are expected from the size of the repo; after it the areas are real. `overviewNow`: the overview was just saved for the first
 * time in this run, so the area writers come next. The expected time of the work before this plan stays in `done`, so the bar does not go back.
 */
export function workPlan(store: Store, folder: string, run: MapRun, overviewNow = false, now = new Date()): MapPlan {
  const repo = repoId(folder);
  const stored = store.getMap(repo);
  const map = stored?.map;
  const { files } = codeFiles(folder);
  const lines = files.reduce((sum, file) => sum + lineCount(file.text), 0);
  const at = Math.round((now.getTime() - Date.parse(run.startedAt)) / 6_000) / 10;
  const old = run.plan;
  const overview = map?.diagrams.some((diagram) => !diagram.parent) ? 0 : 1;
  const areasLeft = old ? Math.max(0, old.areas - (run.saves ?? []).filter(([kind, when]) => kind === 'a' && when > old.at).length) : 0;
  const notes = noteGroups(folder, stored).groups;
  const waiting = areasWaitingForNotes(notes);
  const groups = map ? processGroups(map).groups : [];
  const ready = groups.filter((group) => group.why?.includes('no process yet') && !waiting.has(group.area ?? '')).length;
  const processes = map ? ready + (map.diagrams.some((diagram) => !diagram.parent) ? waiting.size : topAreasOfSize(lines)) : topAreasOfSize(lines);
  const services = map ? setsOf(store, repo).reduce((sum, set) => sum + markGroups(folder, map, set.id).groups.length, 0) : topAreasOfSize(lines);
  const again = !secondRound(run) && (processes > 0 || groups.length > 0) ? 1 : 0;
  const fit = !fitDone(run) && (overview || processes > 0 || again) ? 1 : 0;
  // The work before this plan: what the old plan counted as done, or for a run whose first save is the overview, that overview.
  const firstOverview = WAVE_MINUTES.overview + WAVE_MINUTES.overviewPerThousandLines * lines / 1000 + WAVE_MINUTES.lead;
  const done = old ? old.done + doneOf(old, run.saves ?? []) : overviewNow ? firstOverview : 0;
  return {
    at, done: Math.round(done * 10) / 10, lines, overview, areas: overview || overviewNow ? areasOfSize(lines) : areasLeft,
    notes: notes.length, noteFiles: notes.reduce((sum, group) => sum + group.files.length, 0),
    noteLines: notes.reduce((sum, group) => sum + group.lines, 0), longest: Math.max(0, ...notes.map((group) => group.lines)), processes, services, again, fit,
  };
}

/**
 * After a save of a writer: the first save starts the record when none is open, with the session from the environment; each save adds its part and its time.
 * The plan of the work is made when the record starts, again when the overview is first saved (the real areas) and when the last notes are saved (the real
 * groups of the process writers). The plan is made outside the step that changes the record, since it reads the code files; writers save at the same time.
 * The record ends at the save that leaves no work for the writers.
 */
export function recordMapSave(store: Store, folder: string, save: MapSave, env: Record<string, string | undefined> = process.env, now = new Date()): void {
  const repo = repoId(folder);
  const top = store.getMap(repo)?.map.diagrams.find((diagram) => !diagram.parent);
  const at = now.toISOString();
  let run: MapRun | undefined;
  store.changeMapRun(repo, (stored) => (run = withSave(stored, save, agentFromEnv(env), Object.keys(top?.nodePaths ?? {}).length, at)));
  if (!run) return;
  const fresh = run.startedAt === at; // this save started the record
  const overviewNow = 'overview' in save && (run.saves ?? []).filter(([kind]) => kind === 'o').length === 1;
  const notesDone = 'noteFiles' in save && !!run.plan?.notes && noteGroups(folder, store.getMap(repo)).groups.length === 0;
  if (run.whole && (fresh || !run.plan || overviewNow || notesDone)) {
    const plan = workPlan(store, folder, run, overviewNow, now);
    const startedAt = run.startedAt;
    store.changeMapRun(repo, (stored) => (stored?.startedAt === startedAt ? (run = { ...stored, plan }) : undefined));
  }
  if (run && !mapWorkLeft(store, folder, run)) store.changeMapRun(repo, (stored) => withEnd(stored, at));
}

/** The plan of a run that the press of Home starts: the whole work of the repo as it is now. */
export const homePlan = (store: Store, folder: string, run: MapRun): MapRun => ({ ...run, plan: workPlan(store, folder, run) });

// ----- the work of each area, for the cards of Home while a run writes -----

let kept: { key: string; areas: Record<string, AreaWork> } | undefined; // the last answer: it reads the code files, and Home asks again on each reload

/**
 * The areas of the top diagram that have work left in a run of the whole map, by node id; an area that is not named is done. The work of an area: the notes of
 * its code files, then the processes of its group, then its services. Nothing of an area waits for another area: its notes start as soon as the overview
 * is saved, and its processes and its services as soon as its notes are saved. The record says what is saved, not which writer runs, so every area with
 * work left is "working". `share`: its part of the three that is done.
 */
export function areaWork(store: Store, folder: string, stored: StoredMap, run: MapRun): Record<string, AreaWork> {
  const key = `${stored.savedAt}|${run.savedAt ?? run.startedAt}|${folder}`;
  if (kept?.key === key) return kept.areas;
  const { map } = stored;
  const top = map.diagrams.find((diagram) => !diagram.parent);
  const total = new Map<string, number>(); // the code files of each area
  for (const file of codeFiles(folder).files) total.set(areaOf(map, file.path) ?? '', (total.get(areaOf(map, file.path) ?? '') ?? 0) + 1);
  const notes = noteGroups(folder, stored).groups;
  const needing = new Map<string, number>();
  for (const group of notes) needing.set(group.area ?? '', (needing.get(group.area ?? '') ?? 0) + group.files.length);
  const noProcess = new Set(processGroups(map).groups.filter((group) => group.why?.includes('no process yet')).map((group) => group.area ?? ''));
  const marking = new Set(setsOf(store, repoId(folder)).flatMap((set) => markGroups(folder, map, set.id).groups.map((group) => group.area ?? '')));
  const areas: Record<string, AreaWork> = {};
  for (const area of Object.keys(top?.nodePaths ?? {})) {
    const files = total.get(area) ?? 0;
    const notesLeft = needing.get(area) ?? 0;
    const processLeft = noProcess.has(area) || (notesLeft > 0 && files > 0);
    const marksLeft = marking.has(area);
    if (!notesLeft && !processLeft && !marksLeft) continue;
    const share = ((files ? 1 - notesLeft / files : 1) + (processLeft ? 0 : 1) + (marksLeft ? 0 : 1)) / 3;
    areas[area] = { state: 'working', share: Math.round(share * 100) / 100 };
  }
  kept = { key, areas };
  return areas;
}
