// Connects Claude Code: adds the hook that brings sent remarks into a session to one of its settings files. No `vscode` import.

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { git, tryGit } from '../shared/git';
import { storeFolder } from '../shared/store';
import { recordRepo } from './setup-record';

const WAIT = 'apostil inbox --wait';
const EVENTS = ['SessionStart', 'Stop']; // the hook waits from the start of a session, and again after each turn
const OWN_SETTINGS = '.claude/settings.local.json'; // a person's own settings for one repo, not shared through Git

/** The hook as Claude Code wants it. The page skills/connect-claude-code.md shows the same entry. */
const waitHook = () => ({ hooks: [{ type: 'command', command: WAIT, asyncRewake: true, timeout: 3600 }] });

export interface Connected {
  file: string; // the settings file
  added: boolean; // false when the file had the hook already, or when there is a problem
  problem?: string;
}

/** The settings file of Claude Code for one repo, or with no folder the one for every repo of this person. */
export const settingsFile = (folder?: string, home = homedir()): string => (folder ? join(folder, OWN_SETTINGS) : join(home, '.claude', 'settings.json'));

/** Adds the hook to a settings file and keeps everything else that the file holds. */
export function addWaitHook(file: string): Connected {
  const problem = { file, added: false, problem: `${file} is not in the form of a settings file of Claude Code. Nothing was changed.` };
  let settings: Record<string, any> = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return problem;
    }
  }
  const isRecord = (value: unknown): boolean => typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!isRecord(settings) || !isRecord((settings.hooks ??= {}))) return problem;
  let added = false;
  for (const event of EVENTS) {
    const groups = (settings.hooks[event] ??= []);
    if (!Array.isArray(groups)) return problem;
    if (groups.some(isWaitGroup)) continue;
    groups.push(waitHook());
    added = true;
  }
  if (added) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  }
  return { file, added };
}

/** Adds rules that allow commands (as "Bash(git ls-files *)") to a settings file of Claude Code, and keeps everything else that the file holds. */
export function addAllowRules(file: string, rules: string[]): { file: string; added: string[]; problem?: string } {
  let settings: Record<string, any> = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return { file, added: [], problem: `${file} is not in the form of a settings file of Claude Code. Nothing was changed.` };
    }
  }
  const permissions = (settings.permissions ??= {});
  const allow = (permissions.allow ??= []);
  if (typeof permissions !== 'object' || !Array.isArray(allow)) return { file, added: [], problem: `The permissions in ${file} are not in the form that Claude Code reads. Nothing was changed.` };
  const added = rules.filter((rule) => !allow.includes(rule));
  if (!added.length) return { file, added };
  allow.push(...added);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  return { file, added };
}

/** True when a settings file of Claude Code holds the hook. */
export function hasWaitHook(file: string): boolean {
  try {
    const hooks = JSON.parse(readFileSync(file, 'utf8'))?.hooks ?? {};
    return EVENTS.every((event) => Array.isArray(hooks[event]) && hooks[event].some(isWaitGroup));
  } catch {
    return false;
  }
}

const isWaitGroup = (group: any): boolean => group?.hooks?.some?.((hook: { command?: string }) => hook?.command === WAIT);

/** Takes the hook out of a settings file and keeps everything else. A file that then holds nothing is removed. True when it took something out; with `write` false, when it would. */
export function removeWaitHook(file: string, write = true): boolean {
  let settings: Record<string, any>;
  try {
    settings = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  const hooks = settings?.hooks;
  if (typeof hooks !== 'object' || hooks === null) return false;
  let removed = false;
  for (const event of EVENTS) {
    if (!Array.isArray(hooks[event]) || !hooks[event].some(isWaitGroup)) continue;
    // Only Apostil's entry goes: a group that also holds a hook of the person stays, with that hook.
    hooks[event] = hooks[event].flatMap((group: any) => {
      if (!isWaitGroup(group)) return [group];
      const others = group.hooks.filter((hook: { command?: string }) => hook?.command !== WAIT);
      return others.length ? [{ ...group, hooks: others }] : [];
    });
    if (!hooks[event].length) delete hooks[event];
    removed = true;
  }
  if (!removed || !write) return removed;
  if (!Object.keys(hooks).length) delete settings.hooks;
  if (Object.keys(settings).length) writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  else rmSync(file);
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
  const result = addWaitHook(settingsFile(folder, home));
  if (folder && result.added) keepOutOfGit(folder);
  if (folder && !result.problem) recordRepo(storeFolder(home), folder);
  return result;
}
