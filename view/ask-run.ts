// Words for an agent that one press sends: the session that gets them, the run that they start, and what the page shows of it. No `vscode` import.

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { newRunCommand, resumeCommand, runOptions, sessionName, WRITER_AGENT, type AgentSession, type RunModels } from '../shared/agents';
import { teamFrom, teamOf, teamRun, teamSentence } from '../shared/models';
import { askLine, askPress, askTo, type AskRun, type AskTo, type AskView } from '../shared/ask';
import { appToStart } from '../shared/map-app';
import { isAlive, storeFolder, type Store } from '../shared/store';
import { spawnRun, type RunFacts } from './agent-run';
import { idOf } from '../shared/home-data';
import { connectedApps } from './new-repo-steps';
import { pullFolder, realFolder, removePullFolder, worktreeWithHead, type PullHead } from './pull-folder';

/** The change of the page, whose session gets the words there; elsewhere none. */
export type OfChange = { agent?: AgentSession; folder?: string };

/** What words are about: the change of the page (its session gets them), or a pull request of the repo, whose head branch the run needs checked out. */
export interface AskAbout {
  change?: OfChange;
  pull?: PullHead;
}

/** The sentence after the words of a run for a pull request: Apostil checked its branch out, so the agent need not try. */
export const ON_BRANCH = 'The branch of the pull request is checked out in this folder.';

/**
 * Where words go from a folder (askTo): the session of the change, else the newest session that Apostil knows in the repo, else a new session of the app
 * that the press of Home starts. A session continues only in its own folder: for a pull request, only a session whose folder has its head branch checked out, with
 * its last commit, counts.
 */
function askToFrom(store: Store, folder: string, installed: string[], about: AskAbout = {}): AskTo | undefined {
  const repo = idOf(folder);
  const app = appToStart(store.startedRuns(), repo, installed, connectedApps(installed, folder));
  const known = repo ? store.knownSessions(repo, folder) : [];
  const there = about.pull && worktreeWithHead(folder, about.pull); // its branch, with the last commit of the pull request
  const usable = about.pull ? known.filter((one) => !!there && !!one.folder && realFolder(one.folder) === realFolder(there)) : known;
  return askTo(usable, installed, app, about.change);
}

const nameOf = (agent: AgentSession): string | undefined => sessionName(agent) ?? agent.name;

/** The record of the run that these words started in the repo of a folder, or undefined. */
export function askRunOf(store: Store, folder: string, words: string): AskRun | undefined {
  const repo = idOf(folder);
  return repo ? store.askRun(repo, words) : undefined;
}

const appOf = (to: AskTo): string => (to.kind === 'current' ? to.agent.app : to.app);

/**
 * What the page shows for its words: the line of their run when one started, and the press when an app can be started and no run of them works or is
 * done, with the team of the run for the control after the press (it shows the lead and its effort).
 */
export function askView(store: Store, folder: string, words: string, installed: string[], about: AskAbout = {}): AskView {
  const run = askRunOf(store, folder, words);
  const line = run && askLine(run, run.pid !== undefined && isAlive(run.pid), nameOf(run.agent));
  const to = !line || line.state === 'stopped' ? askToFrom(store, folder, installed, about) : undefined;
  return { words, ...(to ? { press: askPress(to, to.kind === 'current' ? nameOf(to.agent) : undefined), team: teamOf(appOf(to)) } : {}), ...(line ? { line } : {}) };
}

/**
 * Sends words to the session that the press names: a run continues it in its folder, or starts a new session of its app, with what the skill
 * apostil-describe-change runs (`describe`). A new session runs in `folder`; for a pull request, in a folder with its head branch checked out, which Apostil
 * finds or makes (view/pull-folder.ts) and removes when the run ends, if it made it. The record keeps the session (a new Claude Code session gets its id at
 * once) and the end. `changed` is called when the record changes, `ended` when the run ends, with its problem when it failed or was not allowed a command.
 * `team`: the lead and the effort that the control after the press sent (checked by teamFrom), else the default: the second smallest model leads at the
 * most effort. The writers are always the smallest model at its most effort. A session that the run continues takes the lead's model.
 * Gives back true when the run started, false when no app can be started from here, and one sentence when the branch of the pull request could not be checked out.
 */
export async function startAsk(store: Store, folder: string, words: string, installed: string[], models: RunModels, changed: () => void, ended: (problem?: string, facts?: RunFacts) => void, about: AskAbout = {}, team?: unknown): Promise<boolean | string> {
  const repo = idOf(folder);
  const to = askToFrom(store, folder, installed, about);
  if (!repo || !to) return false;
  const got = about.pull ? await pullFolder(folder, about.pull, storeFolder()) : undefined;
  if (got && 'problem' in got) return got.problem;
  const where = got?.folder ?? (to.kind === 'current' && to.folder && existsSync(to.folder) ? to.folder : folder);
  /** Removes the worktree that Apostil made for this run, once the run is over or did not start. */
  const tidy = async (): Promise<void> => { if (got?.made) await removePullFolder(folder, got.folder, storeFolder()); };
  const lead = teamFrom(appOf(to), team);
  const first = about.pull ? `${words}. ${ON_BRANCH}` : words;
  const sentence = teamSentence(lead, WRITER_AGENT); // the models of the lead and the writers, in plain words
  const prompt = sentence ? `${first.replace(/\.?$/, '.')} ${sentence}` : first;
  const sessionId = to.kind === 'new' && to.app === 'claude-code' ? randomUUID() : undefined;
  const options = { ...runOptions(where, storeFolder(), models), describe: true as const, sessionId, ...teamRun(lead) };
  const command = to.kind === 'current' ? resumeCommand(to.agent, prompt, options) : newRunCommand(to.app, prompt, options);
  if (!command) {
    await tidy();
    return false;
  }
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
    // A run that was not allowed a command ended before it was done, also when it says that it ended well.
    const why = problem ?? (facts?.denied.length ? 'It ended before it was done.' : undefined);
    record({ endedAt: new Date().toISOString(), ...(why ? { problem: why } : {}) });
    void tidy().then(() => ended(why, facts));
  });
  record(pid === undefined ? {} : { pid });
  return true;
}
