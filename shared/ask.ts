// Words for an agent, sent with one press in place of a copy: which session gets them, the record of the run that they start, and the line after the press.
// The store keeps the records (Store.askRun), view/ask-run.ts starts the runs, and the page shows the press and the line.

import { APP_NAMES, resumeCommand, sessionOpens, type AgentSession } from './agents';
import { sessionCalled } from './map-run';
import type { Team } from './models';

/** The words that ask an agent to describe a pull request that has no description of Apostil. */
export const describeWords = (number: number): string => `Describe pull request #${number} for Apostil`;

/** A session that Apostil knows in a repo, of a stored change or of a run that it started: when it last worked, and the folder that it runs in. */
export interface KnownSession {
  agent: AgentSession;
  at: string; // an ISO time
  folder?: string;
}

/** Where words go: a session that a run continues, or a new session of an app. `ofChange`: the session that made the change of the page. */
export type AskTo = { kind: 'current'; agent: AgentSession; folder?: string; ofChange?: true } | { kind: 'new'; app: string };

/** True when a run can continue the session from here and its app is installed. */
const canContinue = (agent: AgentSession | undefined, installed: string[]): agent is AgentSession => !!agent && installed.includes(agent.app) && !!resumeCommand(agent, '');

/**
 * Where words for an agent go. On the page of a change (`change`), the session that made it, as "@claude-current" does; elsewhere the newest session
 * that Apostil knows in this repo. Only a session that a run can continue, of an installed app. With none, a new session of `app`, the app of
 * appToStart (shared/map-app.ts). Undefined when no app can be started: the words then stay as text.
 */
export function askTo(known: KnownSession[], installed: string[], app: string | undefined, change?: { agent?: AgentSession; folder?: string }): AskTo | undefined {
  if (change && canContinue(change.agent, installed)) return { kind: 'current', agent: change.agent, folder: change.folder, ofChange: true };
  const newest = change ? undefined : known.filter((one) => canContinue(one.agent, installed)).sort((a, b) => b.at.localeCompare(a.at))[0];
  if (newest) return { kind: 'current', agent: newest.agent, folder: newest.folder };
  return app ? { kind: 'new', app } : undefined;
}

const appName = (app: string): string => APP_NAMES[app] ?? app;

/**
 * The words of the press, a direct link that does the work: it names the session that will write the description, so that nobody is surprised,
 * and never asks the person to give words to an agent. `name` is the name of the session in its app.
 */
export function askPress(to: AskTo, name?: string): { label: string; tip: string } {
  if (to.kind === 'new') return { label: `Describe it with a new ${appName(to.app)} session`, tip: `Starts a new ${appName(to.app)} session that writes the description.` };
  const app = appName(to.agent.app);
  const id = to.agent.session ? ` (session ${to.agent.session})` : '';
  if (to.ofChange) return { label: 'Describe it with the session of this change', tip: `The ${app} session that made this change writes the description${id}.` };
  return { label: `Describe it with ${app} session ${sessionCalled(to.agent, name)}`, tip: `The newest ${app} session that Apostil knows in this repo writes the description${id}.` };
}

/** The record of a run that words started: the session (its app, and its id when known), where it runs, and how it ended. */
export interface AskRun {
  to: 'current' | 'new';
  agent: AgentSession;
  folder: string;
  startedAt: string;
  pid?: number;
  endedAt?: string;
  problem?: string; // why it failed
}

/** Where a run of words stands: working while its program runs, done when it ended well, stopped when it failed or its program is gone with no end. */
export const askState = (run: AskRun, alive: boolean): 'working' | 'done' | 'stopped' =>
  (run.endedAt ? (run.problem ? 'stopped' : 'done') : alive ? 'working' : 'stopped');

/** The line after the press: which session writes the description ("Description by a new Claude Code session 1a2b3c4d"), its state, and where "Open the session" opens it (sessionOpens). */
export interface AskLine {
  words: string;
  state: 'working' | 'done' | 'stopped';
  tip?: string;
  opens?: 'app' | 'terminal';
}

/** The line of a run of words. `alive`: its program still runs. `name`: the name of the session in its app. */
export function askLine(run: AskRun, alive: boolean, name?: string): AskLine {
  const called = sessionCalled(run.agent, name);
  const session = `${run.to === 'new' ? 'a new ' : ''}${appName(run.agent.app)} session${called ? ` ${called}` : ''}`;
  const opens = sessionOpens(run.agent);
  return { words: `Description by ${session}`, state: askState(run, alive), ...(run.agent.session ? { tip: `Session ${run.agent.session}` } : {}), ...(opens ? { opens } : {}) };
}

/** What the page gets for its words: the press (when an app can be started and no run of them works or is done), and the line of their run. */
export interface AskView {
  words: string;
  press?: { label: string; tip: string };
  team?: Team; // with the press: the team of the run; the control after the press shows and changes its lead and effort, never its writers
  line?: AskLine;
  problem?: string; // why the last press started no run, in one sentence (the branch of the pull request could not be checked out)
}
