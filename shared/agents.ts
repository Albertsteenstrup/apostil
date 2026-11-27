// The agent app and session that made a change: how to find it, open it and continue it, or start a new session.

import { accessSync, closeSync, constants, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { WRITERS_AT_ONCE } from './map-estimate';
import { READ_HOOK_COMMAND } from './read-only-command';

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

const READ_TOOLS = ['Read', 'Grep', 'Glob'];

/**
 * What a run that draws diagrams (the map of a repo, the description of a change) uses to read the repo: the read tools, and the commands of git and gh
 * that only read, also those of a pull request that is not checked out (the owner, 18 November: "make sure it has access to read repo").
 */
const READ_REPO = [...READ_TOOLS, 'Bash(git log *)', 'Bash(git show *)', 'Bash(git diff *)', 'Bash(git ls-files *)', 'Bash(git grep *)', 'Bash(git blame *)', 'Bash(git status *)',
  'Bash(ls *)', 'Bash(gh pr view *)', 'Bash(gh pr diff *)'];

/**
 * What a run that describes a change uses, as the skill apostil-describe-change runs it: it reads the repo, writes its drafts whole (apostil-draft.json,
 * apostil-diagram-<id>.json) and saves them with apostil. It changes no code, so it has no Edit.
 */
const DESCRIBE_TOOLS = [...READ_REPO, 'Write'];

/** The settings that only a map run gets, and never the settings files of the person: a hook that allows each shell command that only reads, as the rules of --allowedTools cannot match a command with a pipe or a loop. */
const READ_HOOK_SETTINGS = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: READ_HOOK_COMMAND, timeout: 10 }] }] } };

/**
 * What a Claude Code run may do: its mode, and the command apostil, with which it saves what it writes. A run that a comment starts (`commentRuns` set) also
 * reads the repo and, with "read and edit", edits it: no other command. "Read only" takes the editing tools away also when the mode would accept edits.
 * A run that describes a change (`describe`) gets what the skill runs, and no Edit; a run that writes the map (`diagrams`) reads the repo as it does, and a hook allows its commands that only read.
 */
const claudeRights = ({ claudeMode, commentRuns, describe, diagrams }: RunOptions): string[] => [
  '--permission-mode', claudeRunMode(claudeMode),
  ...(diagrams && !describe ? ['--settings', JSON.stringify(READ_HOOK_SETTINGS)] : []),
  '--allowedTools', 'Bash(apostil *)', ...(describe ? DESCRIBE_TOOLS : diagrams ? READ_REPO : commentRuns === undefined ? [] : commentRuns === 'read only' ? READ_TOOLS : [...READ_TOOLS, 'Edit', 'Write']),
  ...(describe ? ['--disallowedTools', 'Edit', 'NotebookEdit'] : commentRuns === 'read only' ? ['--disallowedTools', 'Edit', 'Write', 'NotebookEdit'] : []),
];

/** Commands that an Antigravity run may never run without a person. */
const AGY_DENY_COMMANDS = ['command(git push *)', 'command(git push)', 'command(rm -rf *)'];

/**
 * What an Antigravity run may do in headless print mode: save with apostil, write files unless a comment run is "read only", and run shell commands
 * (agy has no separate Grep/Glob tool and checks whole compound commands against command() rules) when drawing diagrams or describing a change.
 * Passed via --settings so the person's own settings.json is never written.
 */
function agyRights({ commentRuns, describe, diagrams }: RunOptions): string[] {
  const readOnly = commentRuns === 'read only';
  const allow = [...(readOnly ? [] : ['write_file(*)']), ...(describe || diagrams ? ['command(*)'] : ['command(apostil *)', 'command(apostil)'])];
  const deny = [...(readOnly ? ['write_file(*)'] : []), ...(describe || diagrams ? AGY_DENY_COMMANDS : [])];
  const permissions = { allow, ...(deny.length ? { deny } : {}) };
  return ['--mode', 'accept-edits', '--settings', JSON.stringify({ permissions })];
}

/** A run that draws diagrams: the map of a repo, or the description of a change (whose skill draws the diagrams of the change). */
const drawsDiagrams = (options: RunOptions): boolean => !!(options.diagrams || options.describe);

/** The reasoning effort of a run when nobody chose one: medium for a run that draws diagrams, else high. */
export const runEffort = (options: RunOptions): string => options.effort ?? (drawsDiagrams(options) ? 'medium' : 'high');

/** The model of a run: the one that the person chose (shared/models.ts), else the setting of the app; none: the app takes the model of its own settings. */
const modelOf = (app: string, options: RunOptions): string | undefined =>
  options.model ?? (app === 'claude-code' ? options.claudeModel : app === 'codex' ? options.codexModel : app === 'antigravity' ? options.antigravityModel : app === 'opencode' ? options.opencodeModel : undefined);

const AGY_EFFORT_SUFFIX = /-(low|medium|high|xhigh|max)$/;

/**
 * The words that choose the model and the reasoning effort of a run, the one place that makes them: `--model` and `--effort` for Claude Code and
 * Antigravity (an Antigravity model slug that already ends with an effort takes no `--effort`, which would conflict); `-c model=` and
 * `-c model_reasoning_effort=` for Codex (as it reads its config.toml); for OpenCode `--model provider/model#variant`, where the variant is the effort and
 * needs a model (a model that the person set with a variant keeps it). `withModel` false sets the effort only, so that a session that a run continues keeps
 * its model. With no model, the app takes the model of its own settings.
 */
export function modelWords(app: string, options: RunOptions, withModel = true): string[] {
  const model = withModel ? modelOf(app, options) : undefined;
  const effort = runEffort(options);
  if (app === 'claude-code') return [...(model ? ['--model', model] : []), '--effort', effort];
  if (app === 'codex') return [...(model ? ['-c', `model=${JSON.stringify(model)}`] : []), '-c', `model_reasoning_effort=${JSON.stringify(effort)}`];
  if (app === 'antigravity') return model && AGY_EFFORT_SUFFIX.test(model) ? ['--model', model] : [...(model ? ['--model', model] : []), '--effort', effort];
  if (app === 'opencode' && model) return ['--model', model.includes('#') ? model : `${model}#${effort}`];
  return [];
}

/** The agent that every writer subagent of a map run or a description run of Claude Code starts as: its model and effort are set here, not in words. */
export const WRITER_AGENT = 'apostil-writer';

/**
 * Claude Code's `--agents` for a run with writers: one agent, apostil-writer, with the model (an alias) and the effort of the writers. Claude Code's own
 * docs name `model` and `effort` as fields of an agent; a model that the lead passes when it starts one would win, so the prompt asks it to pass none.
 */
const writerAgents = (options: RunOptions): string[] => (options.writers?.model ? ['--agents', JSON.stringify({
  [WRITER_AGENT]: {
    description: 'A writer or checker of Apostil: it writes or checks one part of a map or a description, as the prompt of its task says.',
    prompt: 'Do the task that the lead gives you, as its prompt says, and nothing more.',
    model: options.writers.model, ...(options.writers.effort ? { effort: options.writers.effort } : {}),
  },
})] : []);

/** The text of a JSON file that may hold comments and commas before a closing bracket (JSONC), as JSON. A "//" inside a string stays. */
const plainJson = (text: string): string =>
  text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_whole, string) => string ?? '').replace(/,(\s*[}\]])/g, '$1');

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
  model?: string; // the model that the person chose for this run, or the lead of a map or description run (shared/models.ts); none: the setting of the app
  effort?: string; // the effort that the person chose, or that of the lead; none: runEffort()
  writers?: { model?: string; effort?: string }; // a map or description run: the model and effort of its writer subagents
  claudeModel?: string; // the setting apostil.claudeModel, empty by default: a new session of a comment then gets the lead of a map run as `model` (freshPick)
  codexModel?: string; // the setting apostil.codexModel, empty by default, as claudeModel
  antigravityModel?: string; // the setting apostil.antigravityModel, empty by default, as claudeModel
  opencodeModel?: string; // the small model that the person set for OpenCode (opencodeSmallModel); none: OpenCode keeps its own
  claudeMode?: string; // the default permission mode of the person for Claude Code (claudeDefaultMode)
  codexSandbox?: string; // the sandbox of the person for Codex (codexDefaultSandbox)
  commentRuns?: string; // set for a run that a comment starts: "read and edit" or "read only" (Claude Code and Antigravity); Codex keeps its sandbox
  describe?: true; // a run that describes a change (words for an agent): what the skill apostil-describe-change runs, and no Edit; it draws diagrams
  diagrams?: true; // a run that writes the map of a repo: it reads the repo, with the most reasoning effort
  sessionId?: string; // a new Claude Code session takes this id, so that its link is known before the run ends
  inTerminal?: true; // a Claude Code session in a terminal that a person can watch and answer: the prompt is its first message (or the next one of a session that it resumes), not a print run
}

/** The models of the runs, as the owner set them in VS Code. */
export interface RunModels { claude?: string; codex?: string; antigravity?: string }

/** The model setting of an app; none for OpenCode, which takes the small model of its own config. */
export const modelSettingOf = (app: string, models: RunModels): string | undefined =>
  (app === 'claude-code' ? models.claude : app === 'codex' ? models.codex : app === 'antigravity' ? models.antigravity : undefined);

/** The options of a run in a folder: the store, the models, and the modes that the person set as default for Claude Code and Codex. */
export const runOptions = (folder: string, store: string, models: RunModels = {}): RunOptions => ({
  store, claudeModel: models.claude, codexModel: models.codex, antigravityModel: models.antigravity, opencodeModel: opencodeSmallModel(folder), claudeMode: claudeDefaultMode(folder), codexSandbox: codexDefaultSandbox(),
});

/**
 * A Codex run with writers may have WRITERS_AT_ONCE agent threads open at once. Codex limits them in its config (`agents.max_threads`, the error "agent
 * thread limit reached", and `agents.max_concurrent_threads_per_session`); -c sets them for this run alone and writes no config.
 */
const codexThreads = (options: RunOptions): string[] => (options.writers?.model
  ? ['-c', `agents.max_threads=${WRITERS_AT_ONCE}`, '-c', `agents.max_concurrent_threads_per_session=${WRITERS_AT_ONCE}`] : []);

/** The words that set the sandbox of a Codex run, its threads when it has writers, its model when one is set, and its effort. */
const codexWords = (options: RunOptions, withModel = true): string[] => [...codexRights(options.store, options.codexSandbox), ...codexThreads(options), ...modelWords('codex', options, withModel)];

/**
 * The command and arguments that continue the session with a prompt, or undefined. A comment run gives no model unless the person chose one, so the session
 * keeps the model that it has, and sets the effort; a run that draws diagrams gives the session the model of its lead, as a new session does.
 */
export function resumeCommand(agent: AgentSession, prompt: string, options: RunOptions = {}): string[] | undefined {
  const { session } = agent;
  if (!session) return undefined;
  const withModel = drawsDiagrams(options) || !!options.model;
  if (agent.app === 'claude-code') {
    const run = options.inTerminal ? ['--resume', session, prompt] : ['-p', '--resume', session, prompt, '--output-format', 'json'];
    return ['claude', ...run, ...modelWords(agent.app, options, withModel), ...writerAgents(options), ...claudeRights(options)];
  }
  if (agent.app === 'codex') return ['codex', 'exec', 'resume', session, prompt, '--json', ...codexWords(options, withModel)];
  if (agent.app === 'antigravity') return ['agy', '-p', prompt, '--conversation', session, '--output-format', 'json', ...modelWords(agent.app, options, withModel), ...agyRights(options)];
  if (agent.app === 'opencode') return ['opencode', 'run', '--session', session, prompt, '--format', 'json', ...modelWords(agent.app, options, withModel)];
  return undefined;
}

/** The command, as a list of words, that continues a session in a terminal, or undefined for an app that has none known. */
export function openSessionCommand(app: string, session: string): string[] | undefined {
  if (app === 'claude-code') return ['claude', '--resume', session];
  if (app === 'codex') return ['codex', 'resume', session];
  if (app === 'antigravity') return ['agy', '--conversation', session];
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
  antigravity: { command: 'agy', say: 'Its sign-in is missing or has expired. Sign in, then try again.' },
};

/** True when the problem of a run is that the app could not sign in. */
export const isSignInProblem = (problem: string): boolean =>
  /failed to authenticate|authentication|unauthori[sz]ed|\b401\b|oauth|not logged in|(log|sign) ?in (again|required)|re-authenticate|session (has )?expired|auth login|invalid api key|api key (is )?(missing|not set)/i.test(problem);

/** The words of a program that does not know an option or a command that Apostil gives it: the program is older or newer than Apostil expects. */
export const isOptionProblem = (problem: string): boolean => /unknown (option|command|argument)|unrecognized (option|argument)|invalid option|did you mean/i.test(problem);

/** What a person can do about a failed run: the kind of fix, and the sentence that says it. The toast of the run offers that fix as a button. */
export type RunFix = { kind: 'set-up' | 'install' | 'sign-in' | 'update' | 'billing' | 'limit' | 'busy' | 'network' | 'locked' | 'allow' | 'none'; say: string };

/** The page that says how to install an app, opened by the fix "Install". */
export const INSTALL: Record<string, string> = { 'claude-code': 'https://code.claude.com/docs/en/setup', codex: 'https://developers.openai.com/codex/cli', antigravity: 'https://antigravity.google/docs/cli/reference' };
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
  if (UPDATE[app] && isOptionProblem(problem)) return { kind: 'update', say: `This ${name} does not know an option that Apostil gives it. Update ${name}, and try again.` };
  if (kind === 'billing') return { kind, say: `The account of ${name} has no credit left. Add credit, and try again.${instead}` };
  if (kind === 'limit') return { kind, say: `${name} reached its usage limit. Try again when it resets.${instead}` };
  if (kind === 'busy') return { kind, say: `The service of ${name} is busy. Try again in a minute.${instead}` };
  if (kind === 'network') return { kind, say: `${name} could not reach its service. Check the connection of this computer, and try again.` };
  if (kind === 'locked') return { kind, say: 'The store of Apostil was busy for a moment. Try again.' };
  if (denied.length) return { kind: 'allow', say: `${name} was not allowed to run ${denied.join(', ')}. Allow ${denied.length === 1 ? 'it' : 'them'} in the settings of ${name} for this repo, and try again.` };
  return { kind: 'none', say: '' };
}

/** The command that updates an app, run in a terminal; undefined when Apostil does not know one. */
export const UPDATE: Record<string, string> = { 'claude-code': 'claude update', antigravity: 'agy update' };

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
  if (app === 'claude-code') return ['claude', ...(options.inTerminal ? [prompt] : ['-p', prompt, '--output-format', 'json']), ...(options.sessionId ? ['--session-id', options.sessionId] : []), ...modelWords(app, options), ...writerAgents(options), ...claudeRights(options)];
  if (app === 'codex') return ['codex', 'exec', prompt, '--json', ...codexWords(options)];
  if (app === 'antigravity') return ['agy', '-p', prompt, '--output-format', 'json', ...modelWords(app, options), ...agyRights(options)];
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
const names = new Map<string, { size: number; mtime: number; name?: unknown }>(); // by file and session, while the file does not change

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

/** The name of a session read from a file, kept while the file keeps its size and time. */
function nameIn<T>(path: string, session: string, read: (path: string) => T | undefined): T | undefined {
  let stat;
  try { stat = statSync(path); } catch { return undefined; }
  const key = `${path}\n${session}`;
  const kept = names.get(key);
  if (kept && kept.size === stat.size && kept.mtime === stat.mtimeMs) return kept.name as T | undefined;
  const name = read(path);
  names.set(key, { size: stat.size, mtime: stat.mtimeMs, name });
  return name;
}

const TITLE_LINES = 50; // Claude Code writes both titles again on each turn, so a title that he gave stands within these lines of its newest title

/** The newest title that he gave a Claude Code session, and the newest one that Claude Code gave it, read from the end of its transcript. */
function claudeTitles(path: string): { given?: string; auto?: string } {
  let auto: string | undefined;
  let after = 0;
  const given = newestLine(path, (line) => {
    const own = field(line, 'custom-title', (record) => record.type === 'custom-title', 'customTitle');
    if (own) return own;
    auto ??= field(line, 'ai-title', (record) => record.type === 'ai-title', 'aiTitle');
    return auto && ++after > TITLE_LINES ? '' : undefined;
  });
  return { ...(given ? { given } : {}), ...(auto ? { auto } : {}) };
}

/** The transcript of a Claude Code session: <session id>.jsonl in one of the folders under ~/.claude/projects. */
export function claudeTranscript(session: string, home: string): string | undefined {
  const projects = join(home, '.claude', 'projects');
  let folders: string[];
  try { folders = readdirSync(projects); } catch { return undefined; }
  return folders.map((folder) => join(projects, folder, `${session}.jsonl`)).find((path) => existsSync(path));
}

/** The newest sessions of Claude Code in a folder, from its transcripts (the folder of ~/.claude/projects named after its path and after its real path). */
export function claudeSessionsIn(folder: string, most: number, home = homedir()): { session: string; at: string }[] {
  let real = folder;
  try { real = realpathSync(folder); } catch { /* the folder as it is */ }
  const found = [...new Set([folder, real].map((path) => path.replace(/[^a-zA-Z0-9]/g, '-')))].flatMap((name) => {
    const projects = join(home, '.claude', 'projects', name);
    let files: string[];
    try { files = readdirSync(projects).filter((file) => /^[\w-]+\.jsonl$/.test(file)); } catch { return []; }
    return files.map((file) => ({ session: file.slice(0, -'.jsonl'.length), at: statSync(join(projects, file), { throwIfNoEntry: false })?.mtimeMs ?? 0 }));
  });
  return found.sort((a, b) => b.at - a.at).slice(0, most).map(({ session, at }) => ({ session, at: new Date(at).toISOString() }));
}

/** The name of a conversation of Antigravity, from ~/.gemini/antigravity-cli/cache/conversation_metadata.json, kept while the file does not change. */
function agyConversationName(path: string, session: string): string | undefined {
  let stat;
  try { stat = statSync(path); } catch { return undefined; }
  const key = `${path}\n${session}`;
  const kept = names.get(key);
  if (kept && kept.size === stat.size && kept.mtime === stat.mtimeMs) return kept.name as string | undefined;
  let name: string | undefined;
  try {
    const summary = JSON.parse(readFileSync(path, 'utf8'))?.conversations?.[session]?.summary;
    if (typeof summary === 'string' && summary.trim()) name = summary.trim();
  } catch { /* not JSON */ }
  names.set(key, { size: stat.size, mtime: stat.mtimeMs, name });
  return name;
}

/**
 * The name of a session, from the files of its app, or undefined when the app keeps none.
 * Claude Code: the newest line of type "custom-title" in the transcript. Codex: the newest "thread_name" of the session in ~/.codex/session_index.jsonl.
 * Antigravity: the summary of the conversation in ~/.gemini/antigravity-cli/cache/conversation_metadata.json.
 */
export function sessionName(agent: AgentSession, home = homedir()): string | undefined {
  const { session } = agent;
  if (!session || !/^[\w-]+$/.test(session)) return undefined;
  if (agent.app === 'claude-code') {
    const transcript = claudeTranscript(session, home);
    const titles = transcript ? nameIn(transcript, session, claudeTitles) : undefined;
    return titles?.given ?? agent.name ?? titles?.auto;
  }
  if (agent.app === 'codex') {
    return nameIn(join(home, '.codex', 'session_index.jsonl'), session, (path) => newestLine(path, (line) => field(line, session, (record) => record.id === session, 'thread_name')));
  }
  if (agent.app === 'antigravity') {
    return agyConversationName(join(home, '.gemini', 'antigravity-cli', 'cache', 'conversation_metadata.json'), session);
  }
  return undefined;
}
