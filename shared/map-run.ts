// The record of a map run: one for a repo while its map is being written. It says which session writes the map and what is saved so far.
// The store keeps it (Store.mapRun and Store.changeMapRun), the saves of the writers add to it (store/map-run.ts), and Home shows its line (mapRunLine).

import { APP_NAMES, sessionOpens, type AgentSession } from './agents';
import { timeLeft, type MapPlan, type SaveKind, type SaveTime, type TimeLeft } from './map-estimate';

/** An open record with no save for this long counts as stopped. */
export const QUIET_MS = 30 * 60_000;

/** What a run saved so far. */
export interface MapRunParts {
  overview?: true;
  areas?: string[]; // the titles of the diagrams of its areas, in the order of their saves
  ofAreas?: number; // how many areas the top diagram has
  noteFiles?: number; // the files whose notes it saved
  processGroups?: string[]; // the groups whose processes it saved, as apostil process-groups names them
  marks?: string[]; // the sets whose marks it saved: "services", and the sets of the look
}

export interface MapRun {
  startedAt: string;
  savedAt?: string; // the last save of a writer
  endedAt?: string;
  stopped?: true; // it ended with work left: the run of Home ended with a problem or with no map
  whole?: true; // it writes the whole map: Home started it, it saved the overview, or it goes on after a run that stopped
  home?: true; // the press of Home started it: a session with no window
  agent?: AgentSession; // the session that writes the map
  parts: MapRunParts;
  plan?: MapPlan; // the plan of the work: made when the run starts, again when the overview is saved and when the last notes are saved
  saves?: SaveTime[]; // the time of each save of a writer, so that the pace of the run can be measured; at most MOST_SAVES
}

/** The record keeps the times of at most this many saves. */
const MOST_SAVES = 600;

/** The kind of a save in the list of times. */
const kindOf = (save: MapSave): SaveKind => ('overview' in save ? 'o' : 'area' in save ? 'a' : 'noteFiles' in save ? 'n' : 'processGroup' in save ? 'p' : 'm');

/** One save of a writer, as the record keeps it: the overview, an area by its title, the notes of so many files, the processes of a group, or the marks of a set. */
export type MapSave = { overview: true } | { area: string } | { noteFiles: number } | { processGroup: string } | { marks: string };

/**
 * Where a run stands. "writing": it is open and saved something in the last 30 minutes. "stopped": it ended with work left, or it writes the whole
 * map and saved nothing for 30 minutes. "done": it ended; a run that wrote only a part of a map (notes alone, as an example) and is quiet also counts as done.
 */
export function mapRunState(run: MapRun, now = Date.now()): 'writing' | 'stopped' | 'done' {
  if (run.endedAt) return run.stopped ? 'stopped' : 'done';
  if (now - Date.parse(run.savedAt ?? run.startedAt) <= QUIET_MS) return 'writing';
  return run.whole ? 'stopped' : 'done';
}

/** The record that the press of Home starts at once, for a new session of an app. */
export const homeRun = (app: string, at: string): MapRun => ({ startedAt: at, whole: true, home: true, agent: { app }, parts: {} });

/**
 * The record after a save of a writer. With no open record, the save starts one; else it adds its part. The record names the session of the newest
 * save; a run of Home keeps its app and takes only the id of the session.
 */
export function withSave(run: MapRun | undefined, save: MapSave, agent: AgentSession | undefined, ofAreas: number | undefined, at: string): MapRun {
  const open = run && mapRunState(run, Date.parse(at)) === 'writing' ? run : undefined;
  const after = run && !open && mapRunState(run, Date.parse(at)) === 'stopped'; // it goes on with the map of a run that stopped
  const parts: MapRunParts = { ...open?.parts, ...(ofAreas ? { ofAreas } : {}) };
  if ('overview' in save) parts.overview = true;
  if ('area' in save) parts.areas = [...(parts.areas ?? []).filter((title) => title !== save.area), save.area];
  if ('noteFiles' in save) parts.noteFiles = (parts.noteFiles ?? 0) + save.noteFiles;
  if ('processGroup' in save) parts.processGroups = [...new Set([...(parts.processGroups ?? []), save.processGroup])];
  if ('marks' in save) parts.marks = [...new Set([...(parts.marks ?? []), save.marks])];
  const session = agent?.session ?? open?.agent?.session;
  const by = open?.home ? { app: open.agent?.app ?? agent?.app ?? '', ...(session ? { session } : {}) } : agent?.session ? agent : open?.agent ?? agent;
  const startedAt = open?.startedAt ?? at;
  const minute = Math.round((Date.parse(at) - Date.parse(startedAt)) / 6_000) / 10; // in tenths of a minute
  const time: SaveTime = 'noteFiles' in save ? ['n', minute, save.noteFiles] : [kindOf(save), minute];
  return {
    startedAt, savedAt: at, ...(open?.whole || after || parts.overview ? { whole: true as const } : {}), ...(open?.home ? { home: true as const } : {}),
    ...(by ? { agent: by } : {}), parts, ...(open?.plan ? { plan: open.plan } : {}), saves: [...(open?.saves ?? []), time].slice(-MOST_SAVES),
  };
}

/** The time left of a run that writes the whole map and has a plan, at `now`; undefined for any other (shared/map-estimate.ts). */
export const runTimeLeft = (run: MapRun, now = Date.now()): TimeLeft | undefined =>
  (run.plan && run.whole && !run.endedAt ? timeLeft(run.plan, run.saves ?? [], Date.parse(run.startedAt), now) : undefined);

/** The record of a run of Home with the session that the run reports on its output. Any other record stays as it is. */
export const withSession = (run: MapRun | undefined, session: string): MapRun | undefined =>
  (run?.home && run.agent && !run.endedAt ? { ...run, agent: { ...run.agent, session } } : undefined);

/** The record with its end: `stopped` when it ended with work left. A record that ended before stays as it is. */
export const withEnd = (run: MapRun | undefined, at: string, stopped = false): MapRun | undefined =>
  (run && !run.endedAt ? { ...run, endedAt: at, ...(stopped ? { stopped: true as const } : {}) } : undefined);

// ----- the words of Home -----

/** The line of Home for a record: its words, and how to reach its session. */
export interface MapRunLine {
  state: 'writing' | 'stopped';
  words: string;
  tip?: string; // the whole id of the session and the titles of the saved areas
  opens?: 'app' | 'terminal'; // "Open the session" opens it in its app, or in a terminal of VS Code that continues it (sessionOpens)
  time?: TimeLeft; // while a run of the whole map writes and has a plan: the minutes left and the share of the bar
  areas?: Record<string, AreaWork>; // the areas of the top diagram with work left, by node id; an area that is not named is done (homeData adds it)
}

/** An area of the top diagram with work left, which writers work on now; `share`: the part of its work that is done. */
export interface AreaWork { state: 'working'; share: number }

const count = (number: number, word: string): string => `${number} ${word}${number === 1 ? '' : 's'}`;
const NAME_LENGTH = 40; // a longer name of a session is cut; the tip holds the id

/** The id of a session, short: the first 8 characters of a long id of hex digits. */
const shortId = (id: string): string => (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(id) ? id.slice(0, 8) : id);

/** What a run saved so far, in words: "overview, 3 of 8 areas, notes of 40 files, processes of 2 areas, services". Empty when it saved nothing. The one place for these words. */
export function partsWords(parts: MapRunParts): string {
  const areas = parts.areas?.length ?? 0;
  const of = parts.ofAreas && areas <= parts.ofAreas ? parts.ofAreas : 0; // a diagram under an area can make more diagrams than areas
  const processAreas = new Set((parts.processGroups ?? []).map((group) => group.replace(/-[0-9a-f]{6}$/, ''))).size; // a group is named "<area>-<six hex digits>"
  const otherSets = (parts.marks ?? []).filter((set) => set !== 'services').length; // the sets of marks that the look of the repo adds
  return [
    parts.overview ? 'overview' : '',
    areas ? (of ? `${areas} of ${count(of, 'area')}` : count(areas, 'area')) : '',
    parts.noteFiles ? `notes of ${count(parts.noteFiles, 'file')}` : '',
    processAreas ? `processes of ${count(processAreas, 'area')}` : '',
    parts.marks?.includes('services') ? 'services' : '',
    otherSets ? `marks of ${count(otherSets, 'set')}` : '',
  ].filter(Boolean).join(', ');
}

/** What a session is called on a line: its name in quotes, cut when it is long, else the short id of the session, else nothing. */
export const sessionCalled = (agent: AgentSession, name?: string): string =>
  (name ? `"${name.length > NAME_LENGTH ? `${name.slice(0, NAME_LENGTH - 1)}…` : name}"` : agent.session ? shortId(agent.session) : '');

/** Which session writes the map, in words. `name` is the name of the session in its app, when it has one. */
function sessionWords(run: MapRun, name?: string): string {
  const app = run.agent && (APP_NAMES[run.agent.app] ?? run.agent.app);
  if (!app) return 'an agent session';
  const called = run.agent ? sessionCalled(run.agent, name) : '';
  if (run.home) return called ? `${app} session ${called} (a session with no window)` : `a ${app} session with no window`;
  return called ? `${app} session ${called}` : `a ${app} session`;
}

/**
 * The line of Home for a record, or undefined when the run is done or there is none. `name` is the name of the session in its app; `alive` says that
 * this window started the run and its program still runs, so a long quiet time is no stop.
 * A session of the Claude desktop app or of Codex opens in its app. Any other session that is known opens in a terminal that continues it; a run of Home
 * only when it stopped, because it has no window and still works while it writes.
 */
export function mapRunLine(run: MapRun | undefined, has: { name?: string; alive?: boolean; now?: number } = {}): MapRunLine | undefined {
  if (!run) return undefined;
  const state = has.alive && !run.endedAt ? 'writing' : mapRunState(run, has.now);
  if (state === 'done') return undefined;
  const session = sessionWords(run, has.name);
  const saved = partsWords(run.parts);
  const words = state === 'writing' ? `Writing the map · ${session} · ${saved || 'nothing saved yet'}` : `The map run of ${session} stopped ${saved ? `after ${saved}` : 'with nothing saved'}`;
  const id = run.agent?.session;
  const tip = [id ? `Session ${id}` : '', run.parts.areas?.length ? `Areas: ${run.parts.areas.join(', ')}` : ''].filter(Boolean).join('\n');
  const opens = run.agent && (!run.home || state === 'stopped') && (!id || /^[\w-]+$/.test(id)) ? sessionOpens(run.agent) : undefined;
  const time = state === 'writing' ? runTimeLeft(run, has.now) : undefined;
  return { state, words, ...(tip ? { tip } : {}), ...(opens ? { opens } : {}), ...(time ? { time } : {}) };
}
