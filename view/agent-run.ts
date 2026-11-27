// Starts an agent run: for one sent remark (one that continues the session of a change or another known session, or a new session of an app), or a new session that writes the map. No `vscode` import.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { modelSettingOf, newRunCommand, resumeCommand, runOptions, WRITER_AGENT, type AgentSession, type RunModels, type RunOptions } from '../shared/agents';
import { freshPick, pickFrom, teamOf, teamRun, teamSentence, type RunPick, type Team } from '../shared/models';
import { changedBetween, workingFiles } from '../shared/git';
import { WRITERS_AT_ONCE } from '../shared/map-estimate';
import { storeFolder, type Store } from '../shared/store';
import { inboxText } from '../store/inbox';
import { skillTexts } from '../store/prompt-command';

/** The session that a run reports on its output: Claude Code prints JSON with `session_id`, Codex `thread.started` with `thread_id`, Antigravity `conversation_id`, OpenCode `sessionID`. */
export function sessionFromOutput(output: string): string | undefined {
  for (const line of output.split('\n')) {
    try {
      const record = JSON.parse(line);
      const session = record?.session_id ?? record?.conversation_id ?? (record?.type === 'thread.started' ? record.thread_id : record?.sessionID);
      if (typeof session === 'string' && session) return session;
    } catch { /* not a line of JSON */ }
  }
  return undefined;
}

/**
 * Why a run failed, from its output, or undefined. Codex prints a line `turn.failed` or `error` with a message, OpenCode a line `error` with `error.message`;
 * Claude Code prints a result with `is_error`; Antigravity prints JSON with `status: "ERROR"` and `error`. A turn that ends well after an error (Codex tried again) is not a failure.
 */
export function problemFromOutput(output: string): string | undefined {
  let problem: string | undefined;
  for (const line of output.split('\n')) {
    try {
      const record = JSON.parse(line);
      if (record?.type === 'turn.completed') problem = undefined;
      const message = record?.type === 'turn.failed' ? record.error?.message
        : record?.type === 'error' ? record.message ?? record.error?.message
          : record?.status === 'ERROR' ? record.error ?? 'It stopped with an error.'
            : record?.is_error ? record.result ?? failedWords(record) : undefined;
      if (typeof message === 'string' && message.trim()) problem = message.trim();
    } catch { /* not a line of JSON */ }
  }
  return problem;
}

/** The words for a result of Claude Code that failed with no text of its own: the status of the API, or how it stopped. */
function failedWords(record: { api_error_status?: unknown; subtype?: unknown; terminal_reason?: unknown }): string {
  if (record.api_error_status) return `The API answered with status ${record.api_error_status}.`;
  if (record.subtype === 'error_max_turns') return 'It stopped after the most turns that it may take.';
  return `It stopped with an error${typeof record.terminal_reason === 'string' && record.terminal_reason ? ` (${record.terminal_reason})` : ''}.`;
}

/** Why a program stopped, from the end of its error output: its last two lines that say something. */
export function problemFromErrors(errors: string): string | undefined {
  const lines = errors.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length ? lines.slice(-2).join(' ').slice(0, 400) : undefined;
}

/**
 * The rule of Claude Code that allows a command like this one: the program and its first word, as "Bash(git ls-files *)"; a "cd <folder> &&" in front is
 * left out, and so are the brackets of a subshell or a group ("(apostil map …)" gives "Bash(apostil map *)").
 */
export function allowRule(command: string): string {
  const first = command.split(/&&|\|\||;|\|/).map((part) => part.trim().replace(/^[({]\s*/, '')).find((part) => part && !/^cd\s/.test(part)) ?? command.trim();
  const [program = '', word] = first.split(/\s+/);
  return `Bash(${program}${word && /^[a-z][\w-]*$/i.test(word) ? ` ${word}` : ''} *)`;
}

/** The rules for the commands and tools that a run was not allowed to use: Claude Code (`permission_denials`) and Antigravity (`denied_actions`), each once. */
export function deniedRules(output: string): string[] {
  const rules = new Set<string>();
  for (const line of output.split('\n')) {
    try {
      const record = JSON.parse(line);
      if (record?.type === 'result' && Array.isArray(record.permission_denials)) {
        for (const denial of record.permission_denials) {
          if (denial?.tool_name === 'Bash' && typeof denial.tool_input?.command === 'string') rules.add(allowRule(denial.tool_input.command));
          else if (typeof denial?.tool_name === 'string') rules.add(denial.tool_name);
        }
      }
      if (Array.isArray(record?.denied_actions)) {
        for (const denial of record.denied_actions) if (typeof denial?.action === 'string' && denial.action) rules.add(denial.action);
      }
    } catch { /* not a line of JSON */ }
  }
  return [...rules];
}

/** What a run left that says why it ended so: the rules that it was not allowed to use, and the ends of its output and its error output. */
export interface RunFacts {
  denied: string[];
  output: string;
  errors: string;
}

/**
 * Starts the run for a remark as a child process: the resume command of the change's agent (or of the known session that the remark went to),
 * or with `newApp` a new session of that app.
 * It runs in the folder of the change; a remark on the map has no change and runs in `folder`, the open folder, with a new session only.
 * The session that the run reports is kept on the remark. When the process ends and the remark is still running, the remark is open again,
 * and `ended` gets the reason: what the program said, or that it gave no answer. `models` are the models that the owner set in Apostil for the runs;
 * `commentRuns` is his setting `apostil.commentRuns`: "read and edit" (the default) or "read only". The files that the run changed are kept on the remark, from Git before and after.
 * With `terminals`, it goes to the open terminal of its session in this window, else Claude Code runs in a new terminal (terminalCommand); it runs as a
 * child process when neither can.
 */
export function startRun(store: Store, remarkId: number, ended: (problem?: string) => void, newApp?: string, folder?: string, models: RunModels = {}, commentRuns = 'read and edit', pick?: RunPick, terminals?: RunTerminals): void {
  const remark = store.getRemark(remarkId);
  const change = remark?.changeId === undefined ? undefined : store.getChange(remark.changeId);
  const prompt = remark && inboxText([remark], store, commentRuns === 'read only');
  const where = change?.folder ?? folder;
  // The model and the effort that the picker sent with the comment, or that "Start a run" chose, over those of a new session (freshPick): with no model,
  // a session that a run continues keeps its own.
  const chosen = { ...(newApp ? pickFrom(freshPick(newApp, modelSettingOf(newApp, models))) : {}), ...pickFrom(remark?.to), ...pickFrom(pick) };
  const options = { ...runOptions(where ?? '', storeFolder(), models), commentRuns, ...chosen }; // the modes that the person set as default for the app go with the run
  // The session that the run continues: another session that Apostil knows in the repo when the comment went there, else the session of the change.
  const known = remark?.to?.kind === 'session' && remark.to.session ? { app: remark.to.app, session: remark.to.session } : undefined;
  const agent = known ?? change?.agent;
  const command = prompt && (newApp ? newRunCommand(newApp, prompt, options) : agent && resumeCommand(agent, prompt, options));
  if (!remark || !prompt || !where || !command) return ended(newApp ? `A new session of ${newApp} cannot be started from here.` : 'This agent cannot be continued from here.');
  const before = workingFiles(where);
  const run: CommentRun = {
    keepChanged: () => {
      const after = before && workingFiles(where);
      store.setRemarkChanged(remarkId, before && after ? changedBetween(before, after) : []);
    },
    answered: () => store.getRemark(remarkId)?.state !== 'running',
    noAnswer: (problem) => {
      store.reopenRemark(remarkId);
      ended(problem ? `${command[0]} gave no answer. It said: ${problem}` : `${command[0]} ended with no answer.`);
    },
  };
  if (terminals) {
    // A session whose terminal is open in this window takes the prompt there as its next message: two programs must not write one session.
    const live = !newApp && agent?.session;
    if (live && startInTerminal(store, remarkId, live, (closed) => terminals.type(live, prompt, closed), run, ended)) return;
    const name = `Apostil comment · ${remark.target.label ?? remark.target.kind}`.slice(0, 48);
    const fresh = terminalCommand(prompt, options, newApp, known);
    if (fresh && startInTerminal(store, remarkId, fresh.session, (closed) => terminals.start(fresh.command, where, name, fresh.session, closed), run, ended)) return;
  }
  const pid = spawnRun(command, where, (session) => store.setRunSession(remarkId, session), (problem) => {
    run.keepChanged();
    if (run.answered()) return ended();
    run.noAnswer(problem);
  });
  if (pid !== undefined) store.startRemarkRun(remarkId, { pid, session: newApp ? undefined : agent?.session, startedAt: new Date().toISOString() });
}

/** What a run for a remark does when it ends: keep the files that it changed, look whether the remark has its answer, open the remark again with the reason. */
interface CommentRun {
  keepChanged: () => void;
  answered: () => boolean;
  noAnswer: (problem?: string) => void;
}

type Closed = (code?: number) => void; // gets the exit code when the terminal closes
type InTerminal = { processId: PromiseLike<number | undefined> };

/**
 * The terminals of VS Code that a run for a remark uses (view/run-terminal.ts): `start` starts a command as a session in a terminal that is not shown;
 * `type` types a message into the open terminal of a session in this window. Each gives undefined when it cannot.
 */
export interface RunTerminals {
  start: (command: string[], folder: string, name: string, session: string, closed: Closed) => InTerminal | undefined;
  type: (session: string, text: string, closed: Closed) => InTerminal | undefined;
}

/** The command of Claude Code in a terminal for a remark, with its session: a new session with an id of its own, or a known session that it resumes. */
function terminalCommand(prompt: string, options: RunOptions, newApp?: string, known?: AgentSession): { command: string[]; session: string } | undefined {
  if (newApp === 'claude-code') {
    const session = randomUUID();
    const command = newRunCommand(newApp, prompt, { ...options, inTerminal: true, sessionId: session });
    return command && { command, session };
  }
  const command = !newApp && known?.app === 'claude-code' ? resumeCommand(known, prompt, { ...options, inTerminal: true }) : undefined;
  return command && known?.session ? { command, session: known.session } : undefined;
}

const waiting = new Set<() => void>(); // the runs in a terminal whose remark has no answer yet

/** The store changed: a run in a terminal whose remark has its answer now keeps the files that it changed, and ends. */
export function answersChanged(): void {
  for (const look of waiting) look();
}

/**
 * Runs a remark as a session in a terminal that a person can watch and answer: `begin` starts it there, or gives undefined when it cannot. The remark
 * has the session from the start, and the session stays open after the answer. The changed files are kept once, at the answer or when the terminal
 * closes; a terminal that closes before the answer opens the remark again. The id of its process is kept on the remark, so a run that is gone with
 * its window is found (staleRuns).
 */
function startInTerminal(store: Store, remarkId: number, session: string, begin: (closed: Closed) => InTerminal | undefined, run: CommentRun, ended: () => void): boolean {
  let over = false;
  const finish = (): boolean => {
    if (over) return false;
    over = true;
    waiting.delete(look);
    run.keepChanged();
    return true;
  };
  const look = (): void => { if (run.answered() && finish()) ended(); };
  const started = begin((code) => {
    if (!finish()) return;
    if (run.answered()) return ended();
    run.noAnswer(code ? `It ended with code ${code}.` : undefined);
  });
  if (!started) return false;
  waiting.add(look);
  const startedAt = new Date().toISOString();
  store.startRemarkRun(remarkId, { session, startedAt });
  started.processId.then((pid) => { if (pid !== undefined && !run.answered()) store.startRemarkRun(remarkId, { pid, session, startedAt }); });
  return true;
}

export const MAP_DRAFT = '.apostil-map.json'; // the file that the writer saves the map from; taken out of the repo when the run ends

/** The words that start a run that describes the change of the branch after the map: the first words of its prompt. */
export const DESCRIBE_AFTER_MAP = 'Then describe the change of this branch for Apostil, as the skill apostil-describe-change says: the branch has changed files that are not described.';

/**
 * What a new session gets when Home asks it to write the map: the files of the skill that the lead itself reads, so that it works where the skills are not installed:
 * the skill, the text rules, and the prompt of the look, which the lead writes itself. A writer prints its own prompt and example with `apostil prompt <kind>`.
 * The session is the main agent of the skill: it starts the overview writer, then one writer for each large area, then one notes writer and one process writer for each group of files.
 * With `describe`, the same session describes the change of the branch after the map, and gets that skill too. `team` names the models of the run in
 * plain words: the lead, and the model and effort of every writer (teamSentence in shared/models.ts).
 */
export function mapPrompt(describe = false, team?: Team): string {
  const files = ['apostil-map-repo/SKILL.md', 'apostil-map-repo/look-writer-prompt.md', 'apostil-describe-change/text-rules.md', ...(describe ? ['apostil-describe-change/SKILL.md'] : [])];
  const models = team ? teamSentence(team, WRITER_AGENT) : '';
  return [
    `Write the map of this repo for Apostil Home, with the notes of its code files and its processes, as the skill apostil-map-repo says. The owner started it from Home to map the whole repo, so he has already chosen all of it: ask him nothing, also when there are more than 80 notes groups, and never wait for an answer.${describe ? ` ${DESCRIBE_AFTER_MAP}` : ''}${models ? ` ${models}` : ''} The files of the skills follow. `
      + `The overview writer writes the map file as ${MAP_DRAFT} in the repo folder. An area writer writes its diagram file, a notes writer its notes file, a process writer its processes file, and a service or mark writer its marks file and its icon files, in the repo folder, as its prompt says.`,
    skillTexts(files),
  ].join('\n\n');
}

/**
 * Starts a new session of an app in a folder that writes the map of the repo, and with `describe` then the description of the change. Returns false when
 * the app cannot be started from here. `found` gets the session that the run reports on its output: Codex at its start, Claude Code with its result.
 * `team`: the lead and the writers of the run (teamOf in shared/models.ts: medium effort by default for lead and writers).
 */
export function startMapRun(app: string, folder: string, ended: (problem?: string, facts?: RunFacts) => void, models: RunModels = {}, describe = false, found: (session: string) => void = () => {}, team: Team = teamOf(app), resume?: string): boolean {
  const run = mapRunCommand(app, folder, models, describe, team, false, resume);
  if (!run) return false;
  spawnRun(run.command, folder, found, (problem, facts) => {
    rmSync(join(folder, MAP_DRAFT), { force: true });
    ended(problem, facts);
  });
  return true;
}

/**
 * The command of a new session that writes the map, and the id that a Claude Code session gets from here, so that Home names it from the start.
 * It draws diagrams and reads the repo; its lead and writers take the models and effort of the team. `inTerminal`: Claude Code in a terminal (Home).
 * `resume`: the id of a session that goes on with the map in place of a new one ("Continue" after a stop).
 */
export function mapRunCommand(app: string, folder: string, models: RunModels = {}, describe = false, team: Team = teamOf(app), inTerminal = false, resume?: string): { command: string[]; session?: string } | undefined {
  const session = resume ?? (app === 'claude-code' ? randomUUID() : undefined);
  const options: RunOptions = { ...runOptions(folder, storeFolder(), models), diagrams: true, ...teamRun(team), ...(inTerminal ? { inTerminal } : {}) };
  const command = resume ? resumeCommand({ app, session: resume }, mapPrompt(describe, team), options) : newRunCommand(app, mapPrompt(describe, team), { ...options, ...(session ? { sessionId: session } : {}) });
  return command && { command, ...(session ? { session } : {}) };
}

/**
 * How long Claude Code's print mode waits after the last turn of the lead for writers that still run, before it stops them (its default is 10 minutes,
 * which cut off a real map run). Not 0, which waits for ever: a writer that hangs must not hold the run for ever.
 */
export const WAIT_FOR_WRITERS_MS = 60 * 60_000;

/**
 * The environment of a run that Apostil starts: the hook `apostil inbox --wait` must not hold it up; Claude Code waits up to 60 minutes for writers after
 * the last turn of the lead; and it may run WRITERS_AT_ONCE subagents at once (its own default is 20, so only a lower setting of the person is raised).
 */
export const runEnvironment = (env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => ({
  ...env, APOSTIL_NO_WAIT: '1', CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: String(WAIT_FOR_WRITERS_MS),
  ...(Number(env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS) < WRITERS_AT_ONCE ? { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: String(WRITERS_AT_ONCE) } : {}),
});

const TAIL = 64 * 1024; // the end of the output that is kept: a failed run says why there
const ERROR_TAIL = 8 * 1024; // the end of the error output: a program that stops at once says why there

/**
 * Runs an agent command in a folder as a child process. `found` gets the session that the run reports on its output;
 * `ended` is called once, when the process ends, with a problem when it could not start or said that it failed. Returns the pid.
 */
export function spawnRun(command: string[], folder: string, found: (session: string) => void, ended: (problem?: string, facts?: RunFacts) => void): number | undefined {
  const [program, ...args] = command;
  const child = spawn(program, args, { cwd: folder, env: runEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let tail = '';
  let errors = '';
  child.stderr.on('data', (data: Buffer) => { errors = (errors + data.toString()).slice(-ERROR_TAIL); });
  let session: string | undefined;
  child.stdout.on('data', (data: Buffer) => {
    tail = (tail + data.toString()).slice(-TAIL);
    if (session) return; // found: only the end of the output is kept from here
    output += data.toString();
    session = sessionFromOutput(output.slice(0, output.lastIndexOf('\n') + 1)); // whole lines only
    if (session) found(session);
  });
  let over = false;
  const finish = (problem?: string): void => {
    if (over) return;
    over = true;
    if (!session && (session = sessionFromOutput(output))) found(session);
    ended(problem, { denied: deniedRules(tail), output: tail, errors });
  };
  child.on('error', (error) => finish(`Could not start ${program}: ${error.message}`));
  // A program that stops at once (an option that it does not know, no sign-in) says why on its error output, not in its JSON.
  child.on('close', (code) => finish(problemFromOutput(tail) ?? (code ? problemFromErrors(errors) ?? `It ended with code ${code}.` : undefined)));
  return child.pid;
}
