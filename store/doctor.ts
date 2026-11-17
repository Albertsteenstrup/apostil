// "apostil doctor": one line for each thing that Apostil needs, ok or missing, and for a missing thing the step that corrects it. It writes nothing.
// It also lists the repos where setup ran, and ends with the command that removes Apostil.
// The lines hold no token, no e-mail address and no code, so that a person can paste them into feedback. No `vscode` import.

import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { findOnPath } from '../shared/agents';
import { repoId, tryGit } from '../shared/git';
import { Store } from '../shared/store';
import { ownTarget } from '../view/install-command';
import { hasWaitHook, settingsFile } from './connect-claude-code';
import { appIsHere, SETUP_APPS, short, skillsSeen, type Install, type Machine } from './setup';
import { setUpRepos } from './setup-record';

export interface DoctorRun {
  folder: string;
  machine: Machine;
  install: Install;
  cli: string; // the cli.js of this install
  store: string; // the store folder
  node?: string; // the version of Node, for a test
  onEditor?: boolean; // true when the command runs on the Node of the editor (the launcher says so), for a test
}

const SETUP_FIX = 'Fix: apostil setup (this repo) or apostil setup --all (all repos), or "Apostil: Set up for agents" in VS Code.';

const realPath = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** The exit code and the output of a program of the path, or undefined when it is not on the path. */
export function exitOf(machine: Machine, program: string, args: string[], timeout = 10_000): { status: number | null; out: string; errors: string } | undefined {
  const file = findOnPath(program, machine.path);
  if (!file) return undefined;
  const result = spawnSync(file, args, { encoding: 'utf8', timeout, cwd: machine.home, env: { ...process.env, PATH: machine.path, HOME: machine.home } });
  return { status: result.status, out: result.stdout ?? '', errors: result.stderr ?? '' };
}

/** The lines, and ok: false when a thing that every use needs is missing. */
export function doctor({ folder, machine, install, cli, store, node = process.versions.node, onEditor = process.env.APOSTIL_RUNS_ON === 'editor' }: DoctorRun): { lines: string[]; ok: boolean } {
  const lines: string[] = [];
  let ok = true;
  const say = (good: boolean, text: string, fix = '', needed = false): void => {
    lines.push(`${(good ? 'ok' : 'missing').padEnd(8)} ${text}${good || !fix ? '' : ` ${fix}`}`);
    if (!good && needed) ok = false;
  };

  say(Number(node.split('.')[0]) >= 24, `Node 24 or newer (the command runs on ${node}, the Node of ${onEditor ? 'the editor' : 'this machine'}).`, 'Fix: install Node 24 or newer from nodejs.org.', true);

  const command = findOnPath('apostil', machine.path);
  const commandFix = 'Fix: "Apostil: Install the apostil command" in VS Code, or npm link in a checkout of Apostil.';
  if (command && realPath(ownTarget(command) ?? command) !== realPath(cli)) say(false, `The command apostil on the path is another install (${short(realPath(command), machine.home)}).`, commandFix, true);
  else say(!!command, `The command apostil on the path${command ? ', from this install' : ''}.`, commandFix, true);

  const repo = tryGit(folder, 'rev-parse', '--show-toplevel');
  if (repo) {
    let facts = 'no saved change yet, no map';
    if (existsSync(join(store, 'apostil.sqlite'))) {
      try {
        const read = new Store(store, true);
        const id = repoId(repo);
        const saved = read.listChanges(id).length;
        facts = `${saved} saved change${saved === 1 ? '' : 's'}, ${read.getMap(id) ? 'a map' : 'no map'}`;
        read.close();
      } catch {
        facts = 'the store could not be read';
      }
    }
    say(true, `This folder is a Git repo: ${facts}.`);
  } else say(false, 'This folder is a Git repo.', 'Fix: run apostil in a Git repo; Apostil shows the changes of a repo.');

  // For each app: is it here, does it see the skills (for this repo first, then for all repos), and of which version.
  let seenByOne = false;
  for (const app of SETUP_APPS) {
    if (!appIsHere(app, machine)) {
      say(false, `${app.name} is on this machine.`, `Fix: install ${app.name} if you use it. Apostil needs one agent app.`);
      continue;
    }
    const found = skillsSeen(app, install, machine, repo);
    const missingSkills = found.filter((skill) => !skill.there).map((skill) => skill.name);
    if (missingSkills.length) {
      say(false, `${app.name} sees the skills. It does not see ${missingSkills.join(', ')}.`, SETUP_FIX);
      continue;
    }
    seenByOne = true;
    const scopes = [...new Set(found.map((skill) => skill.scope))].join(' and ');
    const versions = [...new Set(found.map((skill) => (skill.there?.kind === 'apostil' ? skill.there.version : 'by hand')))];
    const old = versions.filter((version) => version !== install.version && version !== 'by hand');
    if (old.length) say(false, `${app.name} sees the skills (for ${scopes}), of version ${old.join(', ')}; this install is ${install.version}.`, 'Fix: apostil setup again, for the same repos.');
    else say(true, `${app.name} sees the skills (for ${scopes}), ${versions.includes('by hand') ? 'put there by hand' : `of version ${install.version}`}.`);
  }
  if (!seenByOne) ok = false;

  if (appIsHere(SETUP_APPS[0], machine)) {
    const files = [...(repo ? [{ file: settingsFile(repo), scope: 'this repo' }, { file: join(repo, '.claude', 'settings.json'), scope: 'this repo' }] : []), { file: settingsFile(undefined, machine.home), scope: 'all repos' }];
    const hook = files.find((one) => hasWaitHook(one.file));
    lines.push(`${'ok'.padEnd(8)} The hook of Claude Code: ${hook ? `added (for ${hook.scope})` : 'not added (optional)'}. It brings the comments that you send into a session.`);
  }

  const gh = exitOf(machine, 'gh', ['auth', 'status']);
  if (!gh) say(false, 'gh is there. Only pull requests need it.', 'Fix: install the GitHub CLI, then gh auth login.');
  else say(gh.status === 0, `gh is there${gh.status === 0 ? ' and signed in' : ' but not signed in'}. Only pull requests need it.`, 'Fix: gh auth login.');

  const code = exitOf(machine, 'code', ['--list-extensions']);
  if (code) {
    const installed = code.out.split('\n').some((id) => id.trim().toLowerCase() === 'apostil.apostil');
    say(installed, 'The VS Code extension is installed.', `Fix: code --install-extension apostil-${install.version}.vsix`);
  }

  // The record of the repos where setup or connect wrote: "apostil uninstall" undoes each one.
  const repos = setUpRepos(store).map((one) => `${short(one, machine.home)}${existsSync(one) ? '' : ' (gone)'}`);
  if (repos.length) say(true, `Set up in ${repos.length} repo${repos.length === 1 ? '' : 's'}: ${repos.join(', ')}.`);
  lines.push('To remove Apostil: apostil uninstall. With --dry-run it only lists what it would remove.');
  return { lines, ok };
}
