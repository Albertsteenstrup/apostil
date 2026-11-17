// "apostil setup": the skills where each agent app of this machine reads them. The hook of Claude Code is a step of its own; undo still takes it away. No `vscode` import.
// Every function takes the home folder and the path, so that a test can give folders of its own. A setup for a repo adds the repo to the record in the store; its undo takes it out.

import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { APP_PROGRAMS, findOnPath } from '../shared/agents';
import { tryGit } from '../shared/git';
import { storeFolder } from '../shared/store';
import { addExcludeLine, DRAFT_LINES, keepOutOfGit, letGitSee, removeWaitHook, settingsFile } from './connect-claude-code';
import { recordRepo } from './setup-record';

/** The home folder and the PATH of the person. */
export interface Machine {
  home: string;
  path: string;
}

/** What this install of Apostil brings: its skills folder and its version. */
export interface Install {
  skills: string;
  version: string;
}

/** The two agent apps that setup handles, and where each reads skills, relative to a repo or to the home folder. */
export const SETUP_APPS = [
  { id: 'claude-code', name: 'Claude Code', own: '.claude', skills: '.claude/skills' },
  { id: 'codex', name: 'Codex', own: '.codex', skills: '.agents/skills' },
];
export type SetupApp = (typeof SETUP_APPS)[number];

/** A skill folder that Apostil put there holds this file, with the version that put it. */
export const VERSION_FILE = '.apostil-version';

/** The last line of `apostil setup` in a terminal, where nothing can be pressed: where the press is, and the words for an agent. */
export const NEXT_STEP = 'Now open the repo in VS Code and press "Map this repo" on Apostil Home, or ask your agent: "Map this repo for Apostil."';

/** The install that runs this code: the skills and package.json two folders above out/store. */
export function thisInstall(root = join(__dirname, '..', '..')): Install {
  return { skills: join(root, 'skills'), version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version };
}

/** The names of the skills of an install: each folder with a SKILL.md. */
export const skillNames = (install: Install): string[] =>
  readdirSync(install.skills).filter((name) => existsSync(join(install.skills, name, 'SKILL.md'))).sort();

/** True when an app is on this machine: its command on the path, or its folder in the home folder. */
export const appIsHere = (app: SetupApp, machine: Machine): boolean =>
  !!findOnPath(APP_PROGRAMS[app.id], machine.path) || existsSync(join(machine.home, app.own));

/** What is in a skill folder: nothing, a folder that Apostil put there (with its version), or one that someone else put there. */
export type SkillThere = { kind: 'none' } | { kind: 'apostil'; version: string } | { kind: 'other'; works: boolean };
export function skillThere(folder: string): SkillThere {
  try {
    lstatSync(folder);
  } catch {
    return { kind: 'none' };
  }
  try {
    return { kind: 'apostil', version: readFileSync(join(folder, VERSION_FILE), 'utf8').trim() };
  } catch {
    return { kind: 'other', works: existsSync(join(folder, 'SKILL.md')) }; // a link made by hand to a checkout works too
  }
}

/** Where an app finds each skill: for the repo first, then for all repos. A skill that it does not find has no "there". */
export function skillsSeen(app: SetupApp, install: Install, machine: Machine, repo?: string): { name: string; there?: SkillThere; scope: string }[] {
  const places = [...(repo ? [{ base: repo, scope: 'this repo' }] : []), { base: machine.home, scope: 'all repos' }];
  return skillNames(install).map((name) => {
    for (const place of places) {
      const there = skillThere(join(place.base, app.skills, name));
      if (there.kind === 'apostil' || (there.kind === 'other' && there.works)) return { name, there, scope: place.scope };
    }
    return { name, scope: '' };
  });
}

/** True when an agent app of this machine sees all the skills, for the repo or for all repos. */
export const someAppSeesSkills = (install: Install, machine: Machine, repo?: string): boolean =>
  SETUP_APPS.some((app) => appIsHere(app, machine) && skillsSeen(app, install, machine, repo).every((skill) => skill.there));

/** True when setup put a skill of another version for the repo (with no repo: for all repos). After an update of the extension it runs setup again. */
export const hasOlderCopy = (install: Install, machine: Machine, repo?: string): boolean =>
  SETUP_APPS.some((app) => skillNames(install).some((name) => {
    const there = skillThere(join(repo ?? machine.home, app.skills, name));
    return there.kind === 'apostil' && there.version !== install.version;
  }));

/** A path with ~ for the home folder, so that a pasted line does not show the name of the person's account. */
export const short = (path: string, home: string): string => (path === home || path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path);

/** One line for a person: a word (added, removed, left, …) and what it is about. */
export const line = (word: string, text: string): string => `${word.padEnd(8)} ${text}`;

/** The skill folders that an undo looks at: those of this install, those that Apostil put there (also of another version), and any other one with its name. */
function skillsToUndo(install: Install, folder: string): string[] {
  let there: string[] = [];
  try {
    there = readdirSync(folder).filter((name) => name.startsWith('apostil-') || existsSync(join(folder, name, VERSION_FILE)));
  } catch {
    // no skills folder
  }
  return [...new Set([...skillNames(install), ...there])].sort();
}

/** The draft files that a writer left in the top folder of a repo and Git does not track. An undo leaves them, and says so. */
function draftsLeft(repo: string): string[] {
  const patterns = DRAFT_LINES.map((path) => new RegExp(`^${path.slice(1).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)); // * is the only wildcard
  return readdirSync(repo).filter((name) => patterns.some((pattern) => pattern.test(name)) && !tryGit(repo, 'ls-files', '--', name));
}

/** Removes a folder when it is empty, and then its parent when that is empty too. */
function removeIfEmpty(folder: string, levels: number): void {
  for (let index = 0; index < levels; index++, folder = dirname(folder)) {
    try {
      if (readdirSync(folder).length) return;
      rmdirSync(folder);
    } catch {
      return;
    }
  }
}

/**
 * The path in the repo of the skills folder of an app, as Git sees it: when `.claude/skills` is a link to another folder of the repo,
 * the copies really are in that folder, and a line of the exclude file must name it. Git does not look through a link.
 */
export function skillsInRepo(repo: string, skills: string): string {
  try {
    const real = relative(realpathSync(repo), realpathSync(join(repo, skills))).split(sep).join('/');
    return real && !real.startsWith('..') && !isAbsolute(real) ? real : skills;
  } catch {
    return skills; // not there yet
  }
}

export interface SetupRun {
  install: Install;
  machine: Machine;
  repo?: string; // the top folder of a repo; with none, every repo of the person
  undo?: boolean;
  dryRun?: boolean; // with undo: the same lines, and nothing changes
  store?: string; // the store that keeps the record of the repos; by default the one of the home folder
}

/** Sets up, or with undo takes away what setup added. One line for each thing that it did or found, and whether all went well. */
export function setup({ install, machine, repo, undo, dryRun, store = storeFolder(machine.home) }: SetupRun): { lines: string[]; ok: boolean } {
  const base = repo ?? machine.home;
  const scope = repo ? short(repo, machine.home) : 'all repos';
  const write = !(undo && dryRun);
  const lines: string[] = [];
  const ok = true;

  for (const app of SETUP_APPS) {
    const here = appIsHere(app, machine);
    if (!here && !undo) {
      lines.push(line('skipped', `${app.name}: not on this machine.`));
      continue;
    }
    const folder = join(base, app.skills);
    for (const name of undo ? skillsToUndo(install, folder) : skillNames(install)) {
      const target = join(folder, name);
      const there = skillThere(target);
      const where = `${app.name}: the skill ${name} in ${short(folder, machine.home)}`;
      if (there.kind === 'other') {
        lines.push(line('left', `${short(target, machine.home)}: Apostil did not put it there, so it stays as it is.`));
        continue;
      }
      if (undo) {
        if (there.kind === 'none') continue;
        if (write) {
          rmSync(target, { recursive: true, force: true });
          if (repo) letGitSee(repo, [...new Set([`${app.skills}/${name}/`, `${skillsInRepo(repo, app.skills)}/${name}/`])]);
        }
        lines.push(line('removed', where));
        continue;
      }
      rmSync(target, { recursive: true, force: true });
      cpSync(join(install.skills, name), target, { recursive: true });
      writeFileSync(join(target, VERSION_FILE), `${install.version}\n`);
      if (repo) keepOutOfGit(repo, `${skillsInRepo(repo, app.skills)}/${name}/`);
      const word = there.kind === 'none' ? 'added' : there.kind === 'apostil' && there.version === install.version ? 'there' : 'updated';
      lines.push(line(word, `${where}${there.kind === 'apostil' && word === 'updated' ? ` (was ${there.version})` : ''}`));
    }
    if (undo && write) removeIfEmpty(folder, 2); // the skills folder, then .claude or .agents, when setup left them empty
  }

  if (repo) {
    if (!undo) DRAFT_LINES.forEach((path) => addExcludeLine(repo, path));
    else {
      if (write) letGitSee(repo, DRAFT_LINES);
      for (const name of draftsLeft(repo)) lines.push(line('left', `${short(join(repo, name), machine.home)}: a draft that an agent did not save. Delete it when you do not need it.`));
    }
    if (write) recordRepo(store, repo, !undo);
  }

  const settings = settingsFile(repo, machine.home);
  if (undo) {
    if (removeWaitHook(settings, write)) {
      lines.push(line('removed', `Claude Code: the hook in ${short(settings, machine.home)}`));
      if (write && repo && !existsSync(settings)) {
        letGitSee(repo, ['.claude/settings.local.json']);
        removeIfEmpty(dirname(settings), 1);
      }
    }
    if (!lines.length) lines.push(line('nothing', `Apostil had set up nothing for ${scope}.`));
    return { lines, ok };
  }
  if (!SETUP_APPS.some((app) => appIsHere(app, machine))) {
    lines.push(line('missing', 'No agent app on this machine. Install Claude Code or Codex, then run apostil setup again.'));
    return { lines, ok: false };
  }
  lines.push('', NEXT_STEP);
  return { lines, ok };
}
