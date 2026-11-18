// Starts an agent run: for one sent remark (one that continues the session of a change, or a new session of an app), or a new session that writes the map. No `vscode` import.

import { spawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { newRunCommand, resumeCommand, runOptions, type RunModels } from '../shared/agents';
import { changedBetween, workingFiles } from '../shared/git';
import { storeFolder, type Store } from '../shared/store';
import { inboxText } from '../store/inbox';

/** The session that a run reports on its output: Claude Code prints JSON with `session_id`, Codex a line `thread.started` with the thread id, OpenCode events with `sessionID`. */
export function sessionFromOutput(output: string): string | undefined {
  for (const line of output.split('\n')) {
    try {
      const record = JSON.parse(line);
      const session = record?.session_id ?? (record?.type === 'thread.started' ? record.thread_id : record?.sessionID);
      if (typeof session === 'string' && session) return session;
    } catch { /* not a line of JSON */ }
  }
  return undefined;
}

/**
 * Why a run failed, from its output, or undefined. Codex prints a line `turn.failed` or `error` with a message, OpenCode a line `error` with `error.message`;
 * Claude Code prints a result with `is_error`. A turn that ends well after an error (Codex tried again) is not a failure.
 */
export function problemFromOutput(output: string): string | undefined {
  let problem: string | undefined;
  for (const line of output.split('\n')) {
    try {
      const record = JSON.parse(line);
      if (record?.type === 'turn.completed') problem = undefined;
      const message = record?.type === 'turn.failed' ? record.error?.message : record?.type === 'error' ? record.message ?? record.error?.message : record?.is_error ? record.result ?? failedWords(record) : undefined;
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

/** The rules for the commands and tools that a run of Claude Code was not allowed to use, from its result (`permission_denials`), each once. */
export function deniedRules(output: string): string[] {
  const rules = new Set<string>();
  for (const line of output.split('\n')) {
    try {
      const record = JSON.parse(line);
      if (record?.type !== 'result' || !Array.isArray(record.permission_denials)) continue;
      for (const denial of record.permission_denials) {
        if (denial?.tool_name === 'Bash' && typeof denial.tool_input?.command === 'string') rules.add(allowRule(denial.tool_input.command));
        else if (typeof denial?.tool_name === 'string') rules.add(denial.tool_name);
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
 * Starts the run for a remark as a child process: the resume command of the change's agent, or with `newApp` a new session of that app.
 * It runs in the folder of the change; a remark on the map has no change and runs in `folder`, the open folder, with a new session only.
 * The session that the run reports is kept on the remark. When the process ends and the remark is still running, the remark is open again,
 * and `ended` gets the reason: what the program said, or that it gave no answer. `models` are the models that the owner set in Apostil for the runs;
 * `commentRuns` is his setting `apostil.commentRuns`: "read and edit" (the default) or "read only". The files that the run changed are kept on the remark, from Git before and after.
 */
export function startRun(store: Store, remarkId: number, ended: (problem?: string) => void, newApp?: string, folder?: string, models: RunModels = {}, commentRuns = 'read and edit'): void {
  const remark = store.getRemark(remarkId);
  const change = remark?.changeId === undefined ? undefined : store.getChange(remark.changeId);
  const prompt = remark && inboxText([remark], store, commentRuns === 'read only');
  const where = change?.folder ?? folder;
  const options = { ...runOptions(where ?? '', storeFolder(), models), commentRuns }; // the modes that the person set as default for the app go with the run
  const command = prompt && (newApp ? newRunCommand(newApp, prompt, options) : change?.agent && resumeCommand(change.agent, prompt, options));
  if (!where || !command) return ended(newApp ? `A new session of ${newApp} cannot be started from here.` : 'This agent cannot be continued from here.');
  const before = workingFiles(where);
  const pid = spawnRun(command, where, (session) => store.setRunSession(remarkId, session), (problem) => {
    const after = before && workingFiles(where);
    store.setRemarkChanged(remarkId, before && after ? changedBetween(before, after) : []);
    if (store.getRemark(remarkId)?.state !== 'running') return ended(); // it answered
    store.reopenRemark(remarkId);
    ended(problem ? `${command[0]} gave no answer. It said: ${problem}` : `${command[0]} ended with no answer.`);
  });
  if (pid !== undefined) store.startRemarkRun(remarkId, { pid, session: newApp ? undefined : change?.agent?.session, startedAt: new Date().toISOString() });
}

const SKILLS = join(__dirname, '..', '..', 'skills'); // the skills folder of this extension
export const MAP_DRAFT = '.apostil-map.json'; // the file that the writer saves the map from; taken out of the repo when the run ends

/** The words that start a run that describes the change of the branch after the map: the first words of its prompt. */
export const DESCRIBE_AFTER_MAP = 'Then describe the change of this branch for Apostil, as the skill apostil-describe-change says: the branch has changed files that are not described.';

/**
 * What a new session gets when Home asks it to write the map: the skill with its files, so that it works where the skills are not installed.
 * The session is the main agent of the skill: it starts the overview writer, then one writer for each large area, then one notes writer and one process writer for each group of files.
 * With `describe`, the same session describes the change of the branch after the map, and gets that skill too.
 */
export function mapPrompt(describe = false): string {
  const files = ['SKILL.md', 'overview-writer-prompt.md', 'area-writer-prompt.md', 'notes-writer-prompt.md', 'process-writer-prompt.md', 'service-writer-prompt.md', 'mark-writer-prompt.md', 'look-writer-prompt.md', 'example-map.json', 'example-area-diagram.json'].map((name) => `apostil-map-repo/${name}`)
    .concat('apostil-describe-change/text-rules.md', ...(describe ? ['SKILL.md', 'writer-prompt.md', 'fresh-check-prompt.md'].map((name) => `apostil-describe-change/${name}`) : []));
  return [
    `Write the map of this repo for Apostil Home, with the notes of its code files and its processes, as the skill apostil-map-repo says.${describe ? ` ${DESCRIBE_AFTER_MAP}` : ''} The files of the skills follow. `
      + `The overview writer writes the map file as ${MAP_DRAFT} in the repo folder. An area writer writes its diagram file, a notes writer its notes file, a process writer its processes file, and a service or mark writer its marks file and its icon files, in the repo folder, as its prompt says.`,
    ...files.map((path) => `----- ${path} -----\n${readFileSync(join(SKILLS, path), 'utf8')}`),
  ].join('\n\n');
}

/**
 * Starts a new session of an app in a folder that writes the map of the repo, and with `describe` then the description of the change. Returns false when
 * the app cannot be started from here. `found` gets the session that the run reports on its output: Codex at its start, Claude Code with its result.
 */
export function startMapRun(app: string, folder: string, ended: (problem?: string, facts?: RunFacts) => void, models: RunModels = {}, describe = false, found: (session: string) => void = () => {}): boolean {
  const command = newRunCommand(app, mapPrompt(describe), { ...runOptions(folder, storeFolder(), models), diagrams: true }); // it draws diagrams: the most effort, and it reads the repo
  if (!command) return false;
  spawnRun(command, folder, found, (problem, facts) => {
    rmSync(join(folder, MAP_DRAFT), { force: true });
    ended(problem, facts);
  });
  return true;
}

/** The environment of a run that Apostil starts: the hook `apostil inbox --wait` must not hold it up. */
export const runEnvironment = (): NodeJS.ProcessEnv => ({ ...process.env, APOSTIL_NO_WAIT: '1' });

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
