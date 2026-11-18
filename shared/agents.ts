// The agent app and session that made a change: how to find it, open it and continue it, or start a new session.

import { accessSync, closeSync, constants, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/** The apps that have a name of their own: claude-code, codex, antigravity and opencode. */
export interface AgentSession {
  app: string;
  session?: string; // the id that the app's resume command takes
  hostSession?: string; // the id of the session in the Claude desktop app
  account?: string;
  name?: string; // the name of the session, as the agent gave it to the save
}

/** The agent from the variables of a Claude Code shell, or undefined outside Claude Code. */
export function agentFromEnv(env: Record<string, string | undefined>): AgentSession | undefined {
  const session = env.CLAUDE_CODE_SESSION_ID || undefined;
  const hostSession = env.CLAUDE_CODE_HOST_SESSION_ID || undefined;
  const account = env.CLAUDE_CODE_USER_EMAIL || undefined;
  if (!env.CLAUDECODE && !session && !hostSession && !account) return undefined;
  return { app: 'claude-code', session, hostSession, account };
}

/** The fields of an object that have a value. */
export const definedFields = <T extends object>(fields: T): Partial<T> =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<T>;

/** Puts the given fields over the stored agent. A different app does not keep the old session. */
export function mergeAgent(stored: AgentSession | undefined, given: Partial<AgentSession>): AgentSession | undefined {
  const base = stored && (!given.app || given.app === stored.app) ? stored : undefined;
  const merged = { ...base, ...definedFields(given) } as Partial<AgentSession>;
  return merged.app ? (merged as AgentSession) : undefined;
}

/** The link that opens the session in its app, or undefined. */
export function sessionLink(agent: AgentSession): string | undefined {
  if (agent.app === 'claude-code' && agent.hostSession) return `claude://claude.ai/epitaxy/${agent.hostSession}`;
  if (agent.app === 'codex' && agent.session) return `codex://threads/${agent.session}`;
  return undefined;
}

/**
 * Where a session opens, the one way for every link of a session: in its app when it has a link of its own (the Claude desktop app, Codex),
 * else in a terminal of VS Code with the command that continues it. Undefined when it cannot be opened from here. Never a page in the browser.
 */
export const sessionOpens = (agent: AgentSession): 'app' | 'terminal' | undefined =>
  (sessionLink(agent) ? 'app' : agent.session && openSessionCommand(agent.app, agent.session) ? 'terminal' : undefined);

// What a run of Claude Code may do without a prompt: edit files, and run the apostil command to give its answer. Nothing more.
/** The permission modes of Claude Code in which a run can work with nobody to ask: the run then keeps the mode that the person set as default. */
const RUN_ALONE = ['auto', 'acceptEdits', 'bypassPermissions'];

/**
 * The permission mode that the person set as default for Claude Code in this repo (`permissions.defaultMode`), read as Claude Code reads it:
 * the local settings of the repo, then its shared settings, then the settings of the person. Undefined when none is set.
 * Claude Code saves no "last mode" of a session, so the default is all there is to follow.
 */
export function claudeDefaultMode(folder?: string, home = homedir()): string | undefined {
  const files = [...(folder ? [join(folder, '.claude', 'settings.local.json'), join(folder, '.claude', 'settings.json')] : []), join(home, '.claude', 'settings.json')];
  for (const file of files) {
    try {
      const mode = JSON.parse(readFileSync(file, 'utf8'))?.permissions?.defaultMode;
      if (typeof mode === 'string' && mode) return mode;
    } catch { /* no file, or not JSON: the next one */ }
  }
  return undefined;
}

/** The mode of a Claude Code run that Apostil starts: the default of the person when a run can work alone in it (as "auto"), else acceptEdits, the least that a run needs to write its drafts. */
export const claudeRunMode = (preferred?: string): string => (preferred && RUN_ALONE.includes(preferred) ? preferred : 'acceptEdits');

/** The values of the setting `apostil.commentRuns`: what a run that a comment starts may do in the repo. */
export const COMMENT_RUNS = ['read and edit', 'read only'] as const;
const READ_TOOLS = ['Read', 'Grep', 'Glob'];

/**
 * What a run that describes a change uses, as the skill apostil-describe-change runs it: it reads the code, reads the code before the change and the size
 * of the change with `git show` and `git diff`, writes its drafts whole (apostil-draft.json, apostil-diagram-<id>.json) and saves them with apostil.
 * It changes no code, so it has no Edit.
 */
const DESCRIBE_TOOLS = [...READ_TOOLS, 'Write', 'Bash(git show *)', 'Bash(git diff *)'];

/**
 * What a Claude Code run may do: its mode, and the command apostil, with which it saves what it writes. A run that a comment starts (`commentRuns` set) also
 * reads the repo and, with "read and edit", edits it: no other command. "Read only" takes the editing tools away also when the mode would accept edits.
 * A run that describes a change (`describe`) gets what the skill runs, and no Edit.
 */
const claudeRights = ({ claudeMode, commentRuns, describe }: RunOptions): string[] => [
  '--permission-mode', claudeRunMode(claudeMode),
  '--allowedTools', 'Bash(apostil *)', ...(describe ? DESCRIBE_TOOLS : commentRuns === undefined ? [] : commentRuns === 'read only' ? READ_TOOLS : [...READ_TOOLS, 'Edit', 'Write']),
  ...(describe ? ['--disallowedTools', 'Edit', 'NotebookEdit'] : commentRuns === 'read only' ? ['--disallowedTools', 'Edit', 'Write', 'NotebookEdit'] : []),
];

/**
 * The small model of each app, which every new session that Apostil starts takes unless the owner set another (the settings apostil.claudeModel and
 * apostil.codexModel). A run that continues a session gives no model: the session keeps the model that it has.
 */
export const SMALL_MODELS: Record<string, string> = { 'claude-code': 'haiku', codex: 'luna' };

/**
 * The words that choose the model of a run: `--model` for Claude Code and OpenCode, `-c model=` for Codex (as it reads its config.toml).
 * None when no model is set: the app then takes the model of its own settings.
 */
export function modelWords(app: string, { claudeModel, codexModel, opencodeModel }: RunOptions): string[] {
  if (app === 'claude-code' && claudeModel) return ['--model', claudeModel];
  if (app === 'codex' && codexModel) return ['-c', `model=${JSON.stringify(codexModel)}`];
  if (app === 'opencode' && opencodeModel) return ['--model', opencodeModel];
  return [];
}

/** The text of a JSON file that may hold comments and commas before a closing bracket (JSONC), as JSON. A "//" inside a string stays. */
const plainJson = (text: string): string =>
  text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (all, string) => string ?? '').replace(/,(\s*[}\]])/g, '$1');

/**
 * The small model that the person set for OpenCode (`small_model`, "provider/model"), read as OpenCode reads its config, and never written:
 * opencode.json or opencode.jsonc in the folder of the run, then the file that OPENCODE_CONFIG names, then the global one in ~/.config/opencode.
 * Undefined when none names it: OpenCode then keeps the model of its own settings.
 */
export function opencodeSmallModel(folder?: string, home = homedir(), env: Record<string, string | undefined> = process.env): string | undefined {
  const global = join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode');
  const files = [
    ...(folder ? [join(folder, 'opencode.json'), join(folder, 'opencode.jsonc')] : []),
    ...(env.OPENCODE_CONFIG ? [env.OPENCODE_CONFIG] : []),
    join(global, 'opencode.json'), join(global, 'opencode.jsonc'),
  ];
  for (const file of files) {
    try {
      const model = JSON.parse(plainJson(readFileSync(file, 'utf8')))?.small_model;
      if (typeof model === 'string' && model.trim()) return model.trim();
    } catch { /* no file, or not JSON: the next one */ }
  }
  return undefined;
}

/**
 * The sandbox that the person set for Codex: `sandbox_mode` in config.toml (in CODEX_HOME, else ~/.codex), in the profile that it names, else at its top.
 * Only simple lines `key = "value"` are read. Codex itself reads the rest of that file, so its approval rules and its reviewer stay as the person set them.
 */
export function codexDefaultSandbox(home = homedir(), codexHome = process.env.CODEX_HOME): string | undefined {
  let text: string;
  try {
    text = readFileSync(join(codexHome || join(home, '.codex'), 'config.toml'), 'utf8');
  } catch {
    return undefined;
  }
  const sections = new Map<string, Record<string, string>>([['', {}]]);
  let section = '';
  for (const line of text.split('\n')) {
    const head = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (head) sections.set((section = head[1].trim()), sections.get(head[1].trim()) ?? {});
    const pair = line.match(/^\s*([A-Za-z_]+)\s*=\s*"([^"]*)"/);
    if (pair) sections.get(section)![pair[1]] = pair[2];
  }
  const top = sections.get('')!;
  return (top.profile && sections.get(`profiles.${top.profile}`)?.sandbox_mode) || top.sandbox_mode || undefined;
}

/**
 * What a run of Codex may do: write in the folder of the change, and in the folder of Apostil's store, where `apostil answer` keeps its answer.
 * Without the store, the sandbox of Codex refuses that write ("attempt to write a readonly database").
 */
const codexRights = (store?: string, sandbox?: string): string[] => (sandbox === 'danger-full-access'
  ? ['-c', 'sandbox_mode="danger-full-access"'] // the person lets Codex work with no sandbox: the run keeps that
  : ['-c', 'sandbox_mode="workspace-write"', ...(store ? ['-c', `sandbox_workspace_write.writable_roots=[${JSON.stringify(store)}]`] : [])]);

/** What a run needs from outside: the folder of Apostil's store, the models, and what the run is for. */
export interface RunOptions {
  store?: string;
  claudeModel?: string; // the model of a Claude Code run (setting apostil.claudeModel, "haiku" by default); empty: Claude Code takes the model of its own settings
  codexModel?: string; // the model of a Codex run (setting apostil.codexModel, "luna" by default); empty: Codex takes the model of its own settings
  opencodeModel?: string; // the small model that the person set for OpenCode (opencodeSmallModel); none: OpenCode keeps its own
  claudeMode?: string; // the default permission mode of the person for Claude Code (claudeDefaultMode)
  codexSandbox?: string; // the sandbox of the person for Codex (codexDefaultSandbox)
  commentRuns?: string; // set for a run that a comment starts: "read and edit" or "read only" (Claude Code); Codex keeps its sandbox
  describe?: true; // a run that describes a change (words for an agent): what the skill apostil-describe-change runs, and no Edit
  sessionId?: string; // a new Claude Code session takes this id, so that its link is known before the run ends
}

/** The models of the runs, as the owner set them in VS Code. */
export interface RunModels { claude?: string; codex?: string }

/** The options of a run in a folder: the store, the models, and the modes that the person set as default for Claude Code and Codex. */
export const runOptions = (folder: string, store: string, models: RunModels = {}): RunOptions => ({
  store, claudeModel: models.claude, codexModel: models.codex, opencodeModel: opencodeSmallModel(folder), claudeMode: claudeDefaultMode(folder), codexSandbox: codexDefaultSandbox(),
});

/** The words that set the sandbox of a Codex run, and its model when one is set. */
const codexWords = (options: RunOptions): string[] => [...codexRights(options.store, options.codexSandbox), ...modelWords('codex', options)];

/** The command and arguments that continue the session with a prompt, or undefined. */
export function resumeCommand(agent: AgentSession, prompt: string, options: RunOptions = {}): string[] | undefined {
  const { session } = agent;
  if (!session) return undefined;
  // No model: the session keeps the model that it has (SMALL_MODELS is for a new session only).
  if (agent.app === 'claude-code') return ['claude', '-p', '--resume', session, prompt, '--output-format', 'json', ...claudeRights(options)];
  if (agent.app === 'codex') return ['codex', 'exec', 'resume', session, prompt, '--json', ...codexRights(options.store, options.codexSandbox)];
  if (agent.app === 'antigravity') return ['agy', '-p', prompt, '--conversation', session];
  if (agent.app === 'opencode') return ['opencode', 'run', '--session', session, prompt, '--format', 'json'];
  return undefined;
}

/** The command, as a list of words, that continues a session in a terminal, or undefined for an app that has none known. */
export function openSessionCommand(app: string, session: string): string[] | undefined {
  if (app === 'claude-code') return ['claude', '--resume', session];
  if (app === 'codex') return ['codex', 'resume', session];
  if (app === 'opencode') return ['opencode', '--session', session];
  return undefined;
}

/** The program of each agent app on the path, in the order that "@" offers them. */
export const APP_PROGRAMS: Record<string, string> = { 'claude-code': 'claude', codex: 'codex', antigravity: 'agy', opencode: 'opencode' };
/** The name of each app, as a person knows it. The pages have their own copy (view/media/tools.js), because they cannot import this file. */
export const APP_NAMES: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex', antigravity: 'Antigravity', opencode: 'OpenCode' };

/**
 * How a person signs in to an agent app in a terminal, for an app whose run said that it could not sign in: the command, and what to do there.
 * A run that Apostil starts has no person, so the app cannot ask for the sign-in by itself.
 */
export const SIGN_IN: Record<string, { command: string; say: string }> = {
  'claude-code': { command: 'claude auth login', say: 'Its sign-in is missing or has expired. Sign in, then try again.' },
  codex: { command: 'codex login', say: 'Its sign-in is missing or has expired. Sign in, then try again.' },
};

/** True when the problem of a run is that the app could not sign in. */
export const isSignInProblem = (problem: string): boolean =>
  /failed to authenticate|authentication|unauthori[sz]ed|\b401\b|oauth|not logged in|(log|sign) ?in (again|required)|re-authenticate|session (has )?expired|auth login|invalid api key|api key (is )?(missing|not set)/i.test(problem);

/** The words of a program that does not know an option or a command that Apostil gives it: the program is older or newer than Apostil expects. */
export const isOptionProblem = (problem: string): boolean => /unknown (option|command|argument)|unrecognized (option|argument)|invalid option|did you mean/i.test(problem);

/** What a person can do about a failed run: the kind of fix, and the sentence that says it. The toast of the run offers that fix as a button. */
export type RunFix = { kind: 'set-up' | 'install' | 'sign-in' | 'update' | 'billing' | 'limit' | 'busy' | 'network' | 'locked' | 'allow' | 'none'; say: string };

/** The page that says how to install an app, opened by the fix "Install". */
export const INSTALL: Record<string, string> = { 'claude-code': 'https://code.claude.com/docs/en/setup', codex: 'https://developers.openai.com/codex/cli' };
/** The page where a person adds credit for an app that runs with an API key, opened by the fix "Open billing". */
export const BILLING: Record<string, string> = { 'claude-code': 'https://console.anthropic.com/settings/billing' };

/** The words of each kind of failure that a run of an agent app can end with, in the order in which they are tried. */
const FAILURE_WORDS: [RunFix['kind'], RegExp][] = [
  ['install', /could not start \S+: .*(enoent|not found)|(claude|codex|agy|opencode): command not found|command not found: (claude|codex|agy|opencode)/i],
  ['billing', /credit balance|billing|payment required|\b402\b|insufficient (credit|funds|quota)/i],
  ['limit', /usage limit|rate limit|limit reached|\b429\b|too many requests|quota exceeded|resets? (at|in)\b/i],
  ['busy', /overloaded|\b(500|502|503|529)\b|internal server error|temporarily unavailable|service unavailable/i],
  ['network', /enotfound|econnrefused|econnreset|etimedout|getaddrinfo|fetch failed|network|connection (error|refused|reset|closed)|offline|timed out/i],
  ['locked', /database is locked|sqlite_busy/i],
];

/**
 * The fix for a failed run of an app. `denied` are the rules of Claude Code for the commands that the run was not allowed to use;
 * `noCommand` is true when the command apostil is not on the path, so that a run cannot save what it writes.
 */
export function runFix(app: string, problem: string, denied: string[] = [], noCommand = false, other?: string): RunFix {
  const name = APP_NAMES[app] ?? app;
  const instead = other ? ` Or use ${APP_NAMES[other] ?? other} now.` : '';
  if (noCommand) return { kind: 'set-up', say: `The command apostil is not on the path, so ${name} cannot save what it writes. Set up Apostil for your agents, and try again.` };
  const kind = FAILURE_WORDS.find(([, words]) => words.test(problem))?.[0];
  if (kind === 'install') return { kind, say: `${name} is not on the path of VS Code. Install it, and try again.${instead}` };
  if (SIGN_IN[app] && isSignInProblem(problem)) return { kind: 'sign-in', say: SIGN_IN[app].say };
  if (app === 'claude-code' && isOptionProblem(problem)) return { kind: 'update', say: `This ${name} does not know an option that Apostil gives it. Update ${name}, and try again.` };
  if (kind === 'billing') return { kind, say: `The account of ${name} has no credit left. Add credit, and try again.${instead}` };
  if (kind === 'limit') return { kind, say: `${name} reached its usage limit. Try again when it resets.${instead}` };
  if (kind === 'busy') return { kind, say: `The service of ${name} is busy. Try again in a minute.${instead}` };
  if (kind === 'network') return { kind, say: `${name} could not reach its service. Check the connection of this computer, and try again.` };
  if (kind === 'locked') return { kind, say: 'The store of Apostil was busy for a moment. Try again.' };
  if (denied.length) return { kind: 'allow', say: `${name} was not allowed to run ${denied.join(', ')}. Allow ${denied.length === 1 ? 'it' : 'them'} in the settings of ${name} for this repo, and try again.` };
  return { kind: 'none', say: '' };
}

/** The command that updates an app, run in a terminal; undefined when Apostil does not know one. */
export const UPDATE: Record<string, string> = { 'claude-code': 'claude update' };

/** What a button of a failed run does. The layer in VS Code (view/run-settings.ts) carries it out. */
export type RunDeed =
  | { do: 'again' } // the same run once more
  | { do: 'terminal'; name: string; command: string; thenAgain: boolean } // a terminal with the command typed and started; `thenAgain`: then one question with "Try again"
  | { do: 'page'; address: string } // a web page
  | { do: 'instead' } // the same run with the other app
  | { do: 'allow' } // the rules into the settings of Claude Code for the repo, then the run again
  | { do: 'set-up' } // "Set up for agents", then the run again when the command is on the path
  | { do: 'model' } // the setting of the model for Codex runs
  | { do: 'output'; text: string }; // what the program said at its end
export interface RunButton { label: string; deed: RunDeed }

/**
 * The words and the buttons of a run that gave no answer. The fix that Apostil knows (`runFix`) is the first button, so VS Code shows it as the main one:
 * sign in or update in a terminal, allow the commands that the run was not allowed to use, set up Apostil, the page that installs the app or adds credit.
 * Where the app cannot run now (not installed, no credit, its limit, busy), the other connected app (`instead`) can do the same work at once.
 * With `again`, "Try again" starts the same run once more; "Allow" and "Set up" try again by themselves. A failure that passes by itself (busy, network,
 * a locked store) has no button of its own. When Codex refused its model, the first button opens the setting that names another one.
 * With no known fix, "Show the output" shows what the program said (`said`).
 */
export function runProblem(problem: string, has: { app?: string; again?: boolean; denied?: string[]; noCommand?: boolean; instead?: string; said?: string } = {}): { say: string; buttons: RunButton[] } {
  const app = has.app ?? '';
  const name = APP_NAMES[app] ?? app;
  const fix = runFix(app, problem, has.denied, has.noCommand, has.instead);
  const fixes: Partial<Record<RunFix['kind'], RunButton | undefined>> = {
    'sign-in': SIGN_IN[app] && { label: 'Sign in in a terminal', deed: { do: 'terminal', name: `Sign in to ${name}`, command: SIGN_IN[app].command, thenAgain: !!has.again } },
    update: UPDATE[app] ? { label: `Update ${name}`, deed: { do: 'terminal', name: `Update ${name}`, command: UPDATE[app], thenAgain: false } } : undefined,
    allow: { label: 'Allow and try again', deed: { do: 'allow' } },
    'set-up': { label: 'Set up and try again', deed: { do: 'set-up' } },
    install: INSTALL[app] ? { label: `Install ${name}`, deed: { do: 'page', address: INSTALL[app] } } : undefined,
    billing: BILLING[app] ? { label: 'Open billing', deed: { do: 'page', address: BILLING[app] } } : undefined,
  };
  const fixButton = fixes[fix.kind];
  const buttons: RunButton[] = [
    ...(problem.startsWith('codex') && /\bmodel\b/i.test(problem) ? [{ label: 'Set the model for Codex', deed: { do: 'model' } } as RunButton] : []),
    ...(fixButton ? [fixButton] : []),
    ...(has.instead && ['install', 'billing', 'limit', 'busy'].includes(fix.kind) ? [{ label: `Use ${APP_NAMES[has.instead] ?? has.instead} instead`, deed: { do: 'instead' } } as RunButton] : []),
    ...(has.again && fix.kind !== 'allow' && fix.kind !== 'set-up' ? [{ label: 'Try again', deed: { do: 'again' } } as RunButton] : []),
    ...(fix.kind === 'none' && has.said ? [{ label: 'Show the output', deed: { do: 'output', text: has.said } } as RunButton] : []),
  ];
  return { say: fix.say ? `${problem} ${fix.say}` : problem, buttons };
}

/** The command and arguments that start a new session of an app with a prompt, or undefined. The run may edit files and give its answer, and nothing more. */
export function newRunCommand(app: string, prompt: string, options: RunOptions = {}): string[] | undefined {
  if (app === 'claude-code') return ['claude', '-p', prompt, '--output-format', 'json', ...(options.sessionId ? ['--session-id', options.sessionId] : []), ...modelWords(app, options), ...claudeRights(options)];
  if (app === 'codex') return ['codex', 'exec', prompt, '--json', ...codexWords(options)];
  if (app === 'antigravity') return ['agy', '-p', prompt, '--mode', 'accept-edits'];
  if (app === 'opencode') return ['opencode', 'run', prompt, '--format', 'json', ...modelWords(app, options)]; // its JSON events name the session (sessionID)
  return undefined;
}

/** The first executable file of this name in a folder of the path, or undefined. */
export function findOnPath(program: string, path: string): string | undefined {
  return path.split(delimiter).filter(Boolean).map((folder) => join(folder, program)).find((file) => {
    try {
      accessSync(file, constants.X_OK);
      return statSync(file).isFile();
    } catch {
      return false;
    }
  });
}

const onPath = (program: string, path: string): boolean => findOnPath(program, path) !== undefined;

/** The apps whose program is on the path, in the order of APP_PROGRAMS. */
export const installedApps = (path = process.env.PATH ?? ''): string[] =>
  Object.keys(APP_PROGRAMS).filter((app) => onPath(APP_PROGRAMS[app], path));

// ----- the name of a session, from the files of its app -----

const PIECE = 64 * 1024; // a transcript is read from its end in pieces of this size, never whole
const names = new Map<string, { size: number; mtime: number; name?: string }>(); // by file and session, while the file does not change

/** The value of the newest line of a file that `pick` takes, reading the file from its end in pieces. */
export function newestLine<T>(path: string, pick: (line: string) => T | undefined): T | undefined {
  let fd: number;
  try { fd = openSync(path, 'r'); } catch { return undefined; }
  try {
    let end = fstatSync(fd).size;
    let rest = Buffer.alloc(0); // the start of a line whose earlier part lies in the next piece
    while (end > 0) {
      const start = Math.max(0, end - PIECE);
      const piece = Buffer.alloc(end - start);
      readSync(fd, piece, 0, piece.length, start);
      const text = Buffer.concat([piece, rest]);
      const cut = start === 0 ? -1 : text.indexOf(10);
      end = start;
      if (cut < 0 && start > 0) { rest = text; continue; } // one line longer than a piece
      const lines = text.subarray(cut + 1).toString('utf8').split('\n');
      for (let index = lines.length - 1; index >= 0; index--) {
        const value = pick(lines[index]);
        if (value !== undefined) return value;
      }
      rest = cut >= 0 ? text.subarray(0, cut) : Buffer.alloc(0);
    }
    return undefined;
  } finally {
    closeSync(fd);
  }
}

/** The value of one field of a JSON line when the line has the given type, else undefined. */
const field = (line: string, mark: string, test: (record: Record<string, unknown>) => boolean, key: string): string | undefined => {
  if (!line.includes(mark)) return undefined;
  try {
    const record = JSON.parse(line);
    return test(record) && typeof record[key] === 'string' && record[key] ? record[key] : undefined;
  } catch {
    return undefined;
  }
};

/** The newest name of a session in a file, kept while the file keeps its size and time. */
function nameIn(path: string, session: string, pick: (line: string) => string | undefined): string | undefined {
  let stat;
  try { stat = statSync(path); } catch { return undefined; }
  const key = `${path}\n${session}`;
  const kept = names.get(key);
  if (kept && kept.size === stat.size && kept.mtime === stat.mtimeMs) return kept.name;
  const name = newestLine(path, pick);
  names.set(key, { size: stat.size, mtime: stat.mtimeMs, name });
  return name;
}

/** The transcript of a Claude Code session: <session id>.jsonl in one of the folders under ~/.claude/projects. */
function claudeTranscript(session: string, home: string): string | undefined {
  const projects = join(home, '.claude', 'projects');
  let folders: string[];
  try { folders = readdirSync(projects); } catch { return undefined; }
  return folders.map((folder) => join(projects, folder, `${session}.jsonl`)).find((path) => existsSync(path));
}

/**
 * The name of a session, from the files of its app, or undefined when the app keeps none.
 * Claude Code: the newest line of type "custom-title" in the transcript. Codex: the newest "thread_name" of the session in ~/.codex/session_index.jsonl.
 */
export function sessionName(agent: AgentSession, home = homedir()): string | undefined {
  const { session } = agent;
  if (!session || !/^[\w-]+$/.test(session)) return undefined;
  if (agent.app === 'claude-code') {
    const transcript = claudeTranscript(session, home);
    return transcript && nameIn(transcript, session, (line) => field(line, 'custom-title', (record) => record.type === 'custom-title', 'customTitle'));
  }
  if (agent.app === 'codex') {
    return nameIn(join(home, '.codex', 'session_index.jsonl'), session, (line) => field(line, session, (record) => record.id === session, 'thread_name'));
  }
  return undefined;
}
