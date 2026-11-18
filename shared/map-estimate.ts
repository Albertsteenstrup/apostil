// The time left of a map run (build 84): the expected time of the work that is left, from the plan of the run, multiplied by the pace of this run.
// store/map-run.ts makes the plan when a run starts, and again when the overview is saved and when the last notes are saved; Home shows the result.
// No `vscode` import.

/** How many writers run at once: the skill starts up to this many and starts the next when one ends. Writers of all kinds share these places. */
export const WRITERS_AT_ONCE = 16;

/**
 * The minutes of one wave of writers of each step, and of the lead between two steps. They come from real runs of November 2026 (Claude Code, the lead
 * on Sonnet, the writers on Haiku at max): a wave of notes groups of 900 lines took about 12 minutes, so groups of 400 lines start at 8. The main session
 * sets them again after the next real run.
 */
export const WAVE_MINUTES = { overview: 4, overviewPerThousandLines: 0.1, areas: 4, notes: 8, processes: 15, again: 8, fit: 8, services: 10, lead: 2 };

/** The kinds of save that the record keeps the time of: the overview, an area, notes, the processes of a group, the marks of a group. */
export type SaveKind = 'o' | 'a' | 'n' | 'p' | 'm';

/** One save of a writer in the record: its kind, the minutes from the start of the run, and for notes the files that it saved. */
export type SaveTime = [kind: SaveKind, minute: number, files?: number];

/** The plan of the work of a run: how many units each step has left when it was made. Counts only, so that the record stays small. */
export interface MapPlan {
  at: number; // the minutes from the start of the run when it was made; the saves after it count against it (the save that made it counts before it)
  done: number; // the expected minutes of the work that the run did before this plan
  lines: number; // the code lines of the repo
  overview: number; // 1 while the overview is still to write
  areas: number; // the diagrams of areas that are expected
  notes: number; // the groups of the notes writers
  noteFiles: number; // the code files in those groups
  processes: number; // the groups of the process writers that are expected
  services: number; // the groups of the service and mark writers that are expected
  again: number; // 1 while the second process round is still to come
  fit: number; // 1 while the fit round of the top diagram is still to come
}

/** The diagrams of areas that a repo of this size gets before the overview names them: none under 1,000 code lines, then more with the size, at most 8. */
export const areasOfSize = (lines: number): number => (lines < 1000 ? 0 : Math.min(8, Math.round(1.2 * Math.sqrt(lines / 1000))));

/** The areas of a top diagram of a repo of this size, before the overview is saved; the groups of processes and of services are about one for each area. */
export const topAreasOfSize = (lines: number): number => Math.min(12, Math.max(3, Math.round(3 + 1.5 * Math.sqrt(lines / 1000))));

/** One step of a plan: its units, the minutes of one wave, the share of it that is done, and the kinds of save that it makes. */
interface Step { units: number; wave: number; share: number; kinds: SaveKind[] }

/** The expected minutes of a step: its waves (its units divided by the writers at once, rounded up) times the minutes of a wave, and the lead before it. */
const expected = (step: Step): number => (step.units ? Math.ceil(step.units / WRITERS_AT_ONCE) * step.wave + WAVE_MINUTES.lead : 0);

/** The steps of a plan in their order, each with the share of it that the saves since the plan did. */
function stepsOf(plan: MapPlan, saves: SaveTime[]): Step[] {
  const since = saves.filter(([, at]) => at > plan.at);
  const count = (kind: SaveKind): number => since.filter(([one]) => one === kind).length;
  const share = (done: number, of: number): number => (of ? Math.min(1, done / of) : 1);
  const notes = share(since.reduce((sum, [kind, , files]) => sum + (kind === 'n' ? files ?? 0 : 0), 0), plan.noteFiles);
  return [
    { units: plan.overview, wave: WAVE_MINUTES.overview + WAVE_MINUTES.overviewPerThousandLines * plan.lines / 1000, share: share(count('o'), plan.overview), kinds: ['o'] },
    // The area writers run beside the notes writers and are shorter: when the notes are done, so are they, also when fewer areas got a diagram than expected.
    { units: plan.areas, wave: WAVE_MINUTES.areas, share: notes === 1 && plan.noteFiles ? 1 : share(count('a'), plan.areas), kinds: ['a'] },
    { units: plan.notes, wave: WAVE_MINUTES.notes, share: notes, kinds: ['n'] },
    { units: plan.processes, wave: WAVE_MINUTES.processes, share: share(count('p'), plan.processes), kinds: ['p'] },
    { units: plan.services, wave: WAVE_MINUTES.services, share: share(count('m'), plan.services), kinds: ['m'] },
    { units: plan.again, wave: WAVE_MINUTES.again, share: count('p') > plan.processes ? 1 : 0, kinds: ['p'] },
    { units: plan.fit, wave: WAVE_MINUTES.fit, share: count('o') > plan.overview ? 1 : 0, kinds: ['o', 'a'] },
  ];
}

/** The expected minutes of the work of a plan that its saves did, without the time that the step of now has run. */
export const doneOf = (plan: MapPlan, saves: SaveTime[]): number => stepsOf(plan, saves).reduce((sum, step) => sum + expected(step) * step.share, 0);

/** The expected minutes of the work of a whole plan. */
export const expectedOf = (plan: MapPlan): number => stepsOf(plan, []).reduce((sum, step) => sum + expected(step), 0);

/** What Home shows of a run: the minutes left (0: less than a minute) and the share of the bar. */
export interface TimeLeft { minutes: number; share: number }

/**
 * The time left of a run at `now`: the expected time of the work left, multiplied by the pace of this run.
 * - The step of now is the first step that is not done. It counts the time that it has already run: its time left is the smaller of its share left and its
 *   time less what it ran, and never less than a tenth of it, so a slow writer does not bring it to nothing.
 * - The pace is the time that the done work took, divided by its expected time. While little is done, it stays near 1; it counts more as more is done.
 * - The bar is the expected time of the work done out of the expected time of all work, so it moves at an even pace.
 * `minutes` is not rounded; shownTime() rounds it.
 */
export function timeLeft(plan: MapPlan, saves: SaveTime[], startedAt: number, now: number): TimeLeft {
  const minute = (now - startedAt) / 60_000;
  const steps = stepsOf(plan, saves);
  const done = plan.done + doneOf(plan, saves);
  const all = plan.done + expectedOf(plan);
  const last = Math.max(0, ...saves.map(([, at]) => at));
  const took = done > 0.5 ? Math.min(4, Math.max(0.25, last / done)) : 1;
  const pace = 1 + (took - 1) * (all ? done / all : 0);
  const at = steps.findIndex((step) => expected(step) > 0 && step.share < 1);
  let left = 0;
  steps.forEach((step, index) => {
    const whole = expected(step);
    if (index !== at) { left += whole * (1 - step.share); return; }
    const kinds = new Set(steps.slice(0, index).flatMap((one) => one.kinds));
    const start = Math.max(plan.at, ...saves.filter(([kind, when]) => kinds.has(kind) && when > plan.at).map(([, when]) => when));
    left += Math.max(0.1 * whole, Math.min(whole * (1 - step.share), whole - (minute - start) / pace));
  });
  return { minutes: left * pace, share: all ? Math.min(1, Math.max(0, (all - left) / all)) : 0 };
}

/** The minutes that Home shows, and a higher number that only one computation gave so far (`rise`). */
export interface ShownTime { minutes: number; rise?: number }

/** Whole minutes: 0 for less than a minute. */
const wholeMinutes = (minutes: number): number => (minutes < 1 ? 0 : Math.round(minutes));

/**
 * The minutes that Home shows after a new computation. A fall shows at once. A rise shows only when two computations in a row agree on it: the first one
 * is held back, and the second shows the smaller of the two, so the number does not jump up and down.
 */
export function shownTime(before: ShownTime | undefined, minutes: number): ShownTime {
  const now = wholeMinutes(minutes);
  if (!before || now <= before.minutes) return { minutes: now };
  if (before.rise !== undefined) return { minutes: Math.min(before.rise, now) };
  return { minutes: before.minutes, rise: now };
}

/** The words of the time left: "About 14 min left", or "Less than a minute left". The page says the same (timeWords in media/tools.js). */
export const timeWords = (minutes: number): string => (minutes < 1 ? 'Less than a minute left' : `About ${minutes} min left`);
