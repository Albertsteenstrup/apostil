// Words for an agent that one press sends: the session that gets them, the run that they start, and what the page shows of it. No `vscode` import.

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { newRunCommand, resumeCommand, runOptions, sessionName, type AgentSession, type RunModels } from '../shared/agents';
import { askLine, askPress, askTo, type AskRun, type AskTo, type AskView } from '../shared/ask';
import { appToStart } from '../shared/map-app';
import { isAlive, storeFolder, type Store } from '../shared/store';
import { spawnRun, type RunFacts } from './agent-run';
import { idOf } from './home-data';
import { connectedApps } from './new-repo-steps';

/** The change of the page, whose session gets the words there; elsewhere none. */
export type OfChange = { agent?: AgentSession; folder?: string };

/** Where words go from a folder (askTo): the session of the change, else the newest session that Apostil knows in the repo, else a new session of the app that the press of Home starts. */
function askToFrom(store: Store, folder: string, installed: string[], change?: OfChange): AskTo | undefined {
  const repo = idOf(folder);
  const app = appToStart(store.startedRuns(), repo, installed, connectedApps(installed, folder));
  return askTo(repo ? store.knownSessions(repo, folder) : [], installed, app, change);
}

const nameOf = (agent: AgentSession): string | undefined => sessionName(agent) ?? agent.name;

/** The record of the run that these words started in the repo of a folder, or undefined. */
export function askRunOf(store: Store, folder: string, words: string): AskRun | undefined {
  const repo = idOf(folder);
  return repo ? store.askRun(repo, words) : undefined;
}

/** What the page shows for its words: the line of their run when one started, and the press when an app can be started and no run of them works or is done. */
export function askView(store: Store, folder: string, words: string, installed: string[], change?: OfChange): AskView {
  const run = askRunOf(store, folder, words);
  const line = run && askLine(run, run.pid !== undefined && isAlive(run.pid), nameOf(run.agent));
  const to = !line || line.state === 'stopped' ? askToFrom(store, folder, installed, change) : undefined;
  return { words, ...(to ? { press: askPress(to, to.kind === 'current' ? nameOf(to.agent) : undefined) } : {}), ...(line ? { line } : {}) };
}

/**
 * Sends words to the session that the press names: a run continues it in its folder, or starts a new session of its app in `folder`, with what the skill
 * apostil-describe-change runs (`describe`). The record keeps the session (a new Claude Code session gets its id at once) and the end. `changed` is called
 * when the record changes, `ended` when the run ends, with its problem when it failed or was not allowed a command. Returns false when no app can be started from here.
 */
export function startAsk(store: Store, folder: string, words: string, installed: string[], models: RunModels, changed: () => void, ended: (problem?: string, facts?: RunFacts) => void, change?: OfChange): boolean {
  const repo = idOf(folder);
  const to = askToFrom(store, folder, installed, change);
  if (!repo || !to) return false;
  const where = to.kind === 'current' && to.folder && existsSync(to.folder) ? to.folder : folder;
  const sessionId = to.kind === 'new' && to.app === 'claude-code' ? randomUUID() : undefined;
  const options = { ...runOptions(where, storeFolder(), models), describe: true as const, sessionId };
  const command = to.kind === 'current' ? resumeCommand(to.agent, words, options) : newRunCommand(to.app, words, options);
  if (!command) return false;
  const agent: AgentSession = to.kind === 'current' ? to.agent : { app: to.app, ...(sessionId ? { session: sessionId } : {}) };
  const startedAt = new Date().toISOString();
  store.setAskRun(repo, words, { to: to.kind, agent, folder: where, startedAt });
  /** Adds to the record of this run; a newer run of the same words is left as it is. */
  const record = (more: Partial<AskRun>): void => {
    const now = store.askRun(repo, words);
    if (now?.startedAt !== startedAt) return;
    store.setAskRun(repo, words, { ...now, ...more });
    changed();
  };
  const pid = spawnRun(command, where, (session) => record({ agent: { ...agent, session } }), (problem, facts) => {
    // A run that was not allowed a command (to get the branch of a pull request, for one) ended before it was done, also when it says that it ended well.
    const why = problem ?? (facts?.denied.length ? 'It ended before it was done.' : undefined);
    record({ endedAt: new Date().toISOString(), ...(why ? { problem: why } : {}) });
    ended(why, facts);
  });
  record(pid === undefined ? {} : { pid });
  return true;
}
