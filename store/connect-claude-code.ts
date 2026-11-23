// Connects Claude Code: the hooks of Apostil and the rules that allow commands, in one of its settings files.
// Three hooks: the wait hook brings sent remarks into a session (apostil connect), the hint tells the agent at its start to use the map (added by hand; apostil setup leaves it out),
// and the pull-request hook tells the agent to describe a pull request that it opened (apostil setup adds it).

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { git, tryGit } from '../shared/git';
import { storeFolder } from '../shared/store';
import { recordRepo } from './setup-record';

const OWN_SETTINGS = '.claude/settings.local.json'; // a person's own settings for one repo, not shared through Git

/** A hook of Apostil: the events where it runs, the tools it is for (a matcher; none: all), and its entry as Claude Code wants it. Its command alone finds it again. */
export interface ApostilHook {
  events: string[];
  matcher?: string;
  hook: { type: 'command'; command: string; asyncRewake?: boolean; timeout: number };
}

/** The wait hook: it waits from the start of a session, and again after each turn. The page skills/connect-claude-code.md shows the same entry. */
export const WAIT_HOOK: ApostilHook = { events: ['SessionStart', 'Stop'], hook: { type: 'command', command: 'apostil inbox --wait', asyncRewake: true, timeout: 3600 } };

/** The hint: at the start of a session in a repo with a map, it tells the agent which commands read the map (store/hint.ts). */
export const HINT_HOOK: ApostilHook = { events: ['SessionStart'], hook: { type: 'command', command: 'apostil hint', timeout: 10 } };

/** The pull-request hook: after a Bash command, it tells the agent to describe a pull request that the command opened (store/pr-hook.ts). */
export const PR_HOOK: ApostilHook = { events: ['PostToolUse'], matcher: 'Bash', hook: { type: 'command', command: 'apostil pr-hook', timeout: 10 } };

/** The rules that allow the commands that only read the map, so that the person is not asked for each. */
export const READ_MAP_RULES = ['overview*', 'find *', 'notes *', 'process *', 'diagram *', 'diagrams*', 'tests *', 'why *'].map((command) => `Bash(apostil ${command})`);

export interface Connected {
  file: string; // the settings file
  added: boolean; // false when the file had the hook already, or when there is a problem
  problem?: string;
}

/** The settings file of Claude Code for one repo, or with no folder the one for every repo of this person. */
export const settingsFile = (folder?: string, home = homedir()): string => (folder ? join(folder, OWN_SETTINGS) : join(home, '.claude', 'settings.json'));

const notSettings = (file: string): string => `${file} is not in the form of a settings file of Claude Code. Nothing was changed.`;

/** What a settings file holds: {} when there is no file, undefined when it is not JSON. */
function readSettings(file: string): any {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Writes a settings file; one that holds nothing any more is removed. */
function writeSettings(file: string, settings: Record<string, unknown>): void {
  if (!Object.keys(settings).length) return rmSync(file, { force: true });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

/** Adds a hook of Apostil to a settings file, once for each of its events, and keeps everything else that the file holds. */
export function addHook(file: string, apostil: ApostilHook): Connected {
  const problem = { file, added: false, problem: notSettings(file) };
  const settings = readSettings(file);
  const isRecord = (value: unknown): boolean => typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!isRecord(settings) || !isRecord((settings.hooks ??= {}))) return problem;
  let added = false;
  for (const event of apostil.events) {
    const groups = (settings.hooks[event] ??= []);
    if (!Array.isArray(groups)) return problem;
    if (groups.some(holds(apostil))) continue;
    groups.push({ ...(apostil.matcher ? { matcher: apostil.matcher } : {}), hooks: [{ ...apostil.hook }] });
    added = true;
  }
  if (added) writeSettings(file, settings);
  return { file, added };
}

/** Adds rules that allow commands (as "Bash(git ls-files *)") to a settings file of Claude Code, and keeps everything else that the file holds. */
export function addAllowRules(file: string, rules: string[]): { file: string; added: string[]; problem?: string } {
  const settings = readSettings(file);
  if (settings === undefined) return { file, added: [], problem: notSettings(file) };
  const permissions = (settings.permissions ??= {});
  const allow = (permissions.allow ??= []);
  if (typeof permissions !== 'object' || !Array.isArray(allow)) return { file, added: [], problem: `The permissions in ${file} are not in the form that Claude Code reads. Nothing was changed.` };
  const added = rules.filter((rule) => !allow.includes(rule));
  if (!added.length) return { file, added };
  allow.push(...added);
  writeSettings(file, settings);
  return { file, added };
}

/** Takes exactly these allow rules out of a settings file and keeps everything else. A file that then holds nothing is removed. True when it took one out; with `write` false, when it would. */
export function removeAllowRules(file: string, rules: string[], write = true): boolean {
  const settings = existsSync(file) ? readSettings(file) : undefined;
  const allow = settings?.permissions?.allow;
  if (!Array.isArray(allow) || !allow.some((rule) => rules.includes(rule))) return false;
  if (!write) return true;
  settings.permissions.allow = allow.filter((rule) => !rules.includes(rule));
  if (!settings.permissions.allow.length) delete settings.permissions.allow;
  if (!Object.keys(settings.permissions).length) delete settings.permissions;
  writeSettings(file, settings);
  return true;
}

/** True when a settings file of Claude Code holds a hook of Apostil at each of its events. */
export function hasHook(file: string, apostil: ApostilHook): boolean {
  const hooks = (existsSync(file) && readSettings(file)?.hooks) || {};
  return apostil.events.every((event) => Array.isArray(hooks[event]) && hooks[event].some(holds(apostil)));
}

/** True for a group of hooks that holds the hook of Apostil. */
const holds = (apostil: ApostilHook) => (group: any): boolean => group?.hooks?.some?.((hook: { command?: string }) => hook?.command === apostil.hook.command);

/** Takes a hook of Apostil out of a settings file and keeps everything else. A file that then holds nothing is removed. True when it took something out; with `write` false, when it would. */
export function removeHook(file: string, apostil: ApostilHook, write = true): boolean {
  const settings = existsSync(file) ? readSettings(file) : undefined;
  const hooks = settings?.hooks;
  if (typeof hooks !== 'object' || hooks === null) return false;
  let removed = false;
  for (const event of apostil.events) {
    if (!Array.isArray(hooks[event]) || !hooks[event].some(holds(apostil))) continue;
    // Only Apostil's entry goes: a group that also holds a hook of the person stays, with that hook.
    hooks[event] = hooks[event].flatMap((group: any) => {
      if (!holds(apostil)(group)) return [group];
      const others = group.hooks.filter((hook: { command?: string }) => hook?.command !== apostil.hook.command);
      return others.length ? [{ ...group, hooks: others }] : [];
    });
    if (!hooks[event].length) delete hooks[event];
    removed = true;
  }
  if (!removed || !write) return removed;
  if (!Object.keys(hooks).length) delete settings.hooks;
  writeSettings(file, settings);
  return true;
}

/** The exclude file of Git for a repo: what it lists, Git does not show as new, and it is not shared. */
const excludeFile = (folder: string): string => resolve(folder, git(folder, 'rev-parse', '--git-path', 'info/exclude'));

/** Git must not list a file or folder that Apostil put into a repo as new: it goes into .git/info/exclude when nothing ignores it yet. */
export function keepOutOfGit(folder: string, path = OWN_SETTINGS): void {
  if (!tryGit(folder, 'ls-files', '--others', '--exclude-standard', '--', path)) return; // ignored already, or not a Git repo
  addExcludeLine(folder, path);
}

/** The draft files that a writer puts in the top folder of a repo. A saved draft is removed; one that stays must not show as a new file. */
export const DRAFT_LINES = ['/apostil-draft.json', '/apostil-points*.json', '/apostil-map.json', '/apostil-diagram*.json', '/apostil-notes*.json', '/apostil-processes*.json', '/apostil-marks*.json', '/apostil-icon-*', '/apostil-look*', '/apostil-issue.md'];

/** Adds a line to the exclude file of the repo, unless it is there. */
export function addExcludeLine(folder: string, path: string): void {
  const exclude = excludeFile(folder);
  mkdirSync(dirname(exclude), { recursive: true });
  const text = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  if (text.split('\n').includes(path)) return;
  appendFileSync(exclude, `${text && !text.endsWith('\n') ? '\n' : ''}${path}\n`);
}

/** Takes the lines that keepOutOfGit() added for these paths out of the exclude file again. */
export function letGitSee(folder: string, paths: string[]): void {
  const exclude = excludeFile(folder);
  if (!existsSync(exclude)) return;
  const text = readFileSync(exclude, 'utf8');
  const kept = text.split('\n').filter((line) => !paths.includes(line)).join('\n');
  if (kept !== text) writeFileSync(exclude, kept);
}

/** Connects Claude Code for the repo in a folder, or with no folder for every repo. The folder goes into the record of the store, so that an uninstall finds it. */
export function connectClaudeCode(folder?: string, home = homedir()): Connected {
  const result = addHook(settingsFile(folder, home), WAIT_HOOK);
  if (folder && result.added) keepOutOfGit(folder);
  if (folder && !result.problem) recordRepo(storeFolder(home), folder);
  return result;
}
