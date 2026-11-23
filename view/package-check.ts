// The check of the .vsix file. Two halves in one file:
// - `node out/view/package-check.js` installs apostil-<version>.vsix into a VS Code of its own and starts it on a test repo.
// - Inside that window run() takes a home folder and a path of its own, answers "Set up for agents" with "This repo",
//   and checks the list, the page, the link of the command and the skills. The real home folder is read before and after, never written.

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { checkChangeFile } from '../shared/checks';
import { baseOf, currentBranch, git, headCommit, repoId } from '../shared/git';
import { CODE, runInVsCode } from '../shared/run-in-vscode';
import { Store } from '../shared/store';
import { makeTestRepo, testChangeFile } from '../shared/test-repo';
import { hasHook, HINT_HOOK, READ_MAP_RULES, WAIT_HOOK } from '../store/connect-claude-code';
import { skillNames, thisInstall } from '../store/setup';

async function waitFor(what: string, test: () => boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`Waited ${ms / 1000} s for: ${what}`);
    await new Promise((done) => setTimeout(done, 200));
  }
  console.log(`PASS  ${what}`);
}

const pass = (what: string, ok: boolean, detail = ''): void => {
  if (!ok) throw new Error(`FAIL  ${what}${detail ? `: ${detail}` : ''}`);
  console.log(`PASS  ${what}`);
};

/** Runs inside the extension host. Home and path change first, before anything can write. */
export async function run(): Promise<void> {
  const trial = process.env.APOSTIL_TRIAL;
  if (!trial || !trial.startsWith('/tmp/')) throw new Error('APOSTIL_TRIAL must name the temporary folder of the trial.');
  const home = join(trial, 'home');
  const bin = join(trial, 'bin');
  const localBin = join(home, '.local', 'bin'); // the one folder of commandFolders() that is on the trial path
  process.env.HOME = home;
  process.env.PATH = [localBin, bin, '/usr/bin', '/bin'].join(':');
  pass('the trial has a home folder of its own, and no folder of the real path', homedir() === home && !/homebrew|\/usr\/local/.test(process.env.PATH));

  const vscode = await import('vscode');
  const folder = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const extension = vscode.extensions.getExtension('apostil.apostil');
  if (!extension) throw new Error('The extension apostil.apostil is not installed.');
  pass('the extension is the installed one, not a checkout', extension.extensionPath.startsWith(join(trial, 'e')), extension.extensionPath);
  const files = readdirSync(extension.extensionPath).filter((name) => name !== '.vsixmanifest').sort();
  pass('the install holds out, skills, view, theme and package.json, and no docs, design or research', files.join() === 'out,package.json,readme.md,skills,theme,view', files.join());
  const api = await extension.activate();

  // The set-up step is open: the stand-ins claude and codex are on the path, and no skill is there yet. Home with no map then shows "Set up for agents".
  await vscode.commands.executeCommand('workbench.view.extension.apostil');
  await waitFor('no agent app has the skills yet, so the set-up step is open', () => api.needsSetup() === true);

  // "Set up for agents", answered with "This repo". A stand-in for the question cannot reach the installed extension, so the answer goes with the command.
  await vscode.commands.executeCommand('apostil.setUp', folder, 'This repo');
  const link = join(localBin, 'apostil');
  const cli = join(extension.extensionPath, 'out', 'store', 'cli.js');
  const script = existsSync(link) ? readFileSync(link, 'utf8') : '';
  pass('the command is a launcher script for the cli.js inside the installed extension, not a link, in the folder of the trial path', !lstatSync(link).isSymbolicLink() && script.includes(`cli='${cli}'`) && script.includes(`program='${process.execPath}'`), script.split('\n').slice(0, 4).join(' | '));
  const version = thisInstall(extension.extensionPath).version;
  for (const skills of ['.claude/skills', '.agents/skills']) {
    const names = readdirSync(join(folder, skills)).sort();
    pass(`"Set up for agents" puts every skill of the install into ${skills} of the repo, of version ${version}`,
      names.join() === skillNames(thisInstall(extension.extensionPath)).join() && names.every((name) => readFileSync(join(folder, skills, name, '.apostil-version'), 'utf8').trim() === version), names.join());
  }
  const settings = join(folder, '.claude', 'settings.local.json');
  const allowed: string[] = existsSync(settings) ? JSON.parse(readFileSync(settings, 'utf8')).permissions?.allow ?? [] : [];
  pass('and for Claude Code the rules that allow the reads of the map, and neither the hint nor the wait hook', !hasHook(settings, HINT_HOOK) && READ_MAP_RULES.every((rule) => allowed.includes(rule)) && !hasHook(settings, WAIT_HOOK));
  pass('Git shows no change in the repo', git(folder, 'status', '--porcelain') === '');
  await waitFor('an agent app has the skills now, so the set-up step is done', () => api.needsSetup() === false);

  // The command from the install: --version, setup --undo, setup --repo, doctor. The path holds no node at all: the command runs on the Node of the editor.
  const env = { ...process.env, PATH: [localBin, bin, '/usr/bin', '/bin'].join(':') };
  pass('the trial path holds no node', ['/usr/bin', '/bin', bin, localBin].every((folder) => !existsSync(join(folder, 'node'))));
  const apostil = (...args: string[]) => spawnSync('apostil', args, { cwd: folder, env, encoding: 'utf8' });
  const storeNow = (): string => readdirSync(process.env.APOSTIL_HOME!).sort().map((name) => `${name} ${statSync(join(process.env.APOSTIL_HOME!, name)).mtimeMs}`).join();
  const storeBefore = storeNow();
  const first = apostil('--version');
  pass('apostil --version prints the version', first.stdout.trim() === version, `${first.stdout} ${first.stderr} ${first.status}`);
  pass('and saves nothing', storeNow() === storeBefore);
  apostil('setup', '--undo');
  pass('apostil setup --undo takes the skills away', !existsSync(join(folder, '.claude')) && !existsSync(join(folder, '.agents')));
  const setUp = apostil('setup', '--repo');
  for (const line of setUp.stdout.trim().split('\n')) console.log(`NOTE  setup: ${line}`);
  pass('apostil setup --repo from the install puts the skills into the repo', setUp.status === 0 && existsSync(join(folder, '.claude', 'skills', 'apostil-describe-change', 'SKILL.md')) && existsSync(join(folder, '.agents', 'skills', 'apostil-map-repo', 'SKILL.md')));
  const doctor = apostil('doctor');
  for (const line of doctor.stdout.trim().split('\n')) console.log(`NOTE  doctor: ${line}`);
  pass('apostil doctor says that the command runs on the Node of the editor', /^ok +Node 24 or newer \(the command runs on [\d.]+, the Node of the editor\)/m.test(doctor.stdout), doctor.stdout.split('\n')[0]);
  pass('apostil doctor says ok for Node, the command, the repo, both apps and the hook', doctor.status === 0 && doctor.stdout.split('\n').filter((line) => line.startsWith('ok')).length >= 6);

  // The list and the page load a saved change.
  const store = new Store(process.env.APOSTIL_HOME);
  const file = testChangeFile();
  const base = baseOf(folder, currentBranch(folder));
  const id = store.saveChange({ repoId: repoId(folder), folder, branch: currentBranch(folder), base, head: headCommit(folder), file, checks: checkChangeFile(folder, base, file) });
  await vscode.commands.executeCommand('apostil.refresh');
  await waitFor('the list draws the saved change', () => api.listShown() === 1);
  await vscode.commands.executeCommand('apostil.openChange', id);
  await waitFor('the page draws the diagram of the change', () => api.rendered()?.nodes === 2);
  store.close();
}

/** The real places that setup or the install could write: read before and after the trial. */
function realPlaces(): string {
  const places = ['.claude/skills', '.claude/settings.json', '.agents', '.agents/skills', '.codex', '.local/bin/apostil', '.apostil'].map((path) => join(homedir(), path));
  return [...places, '/opt/homebrew/bin/apostil', '/usr/local/bin/apostil'].map((place) => {
    try {
      const stat = lstatSync(place);
      return `${place} ${stat.isSymbolicLink() ? readlinkSync(place) : ''} ${stat.isDirectory() ? readdirSync(place).filter((name) => name.startsWith('apostil')).join() : statSync(place).mtimeMs}`;
    } catch {
      return `${place} none`;
    }
  }).join('\n');
}

async function start(): Promise<void> {
  const root = resolve(__dirname, '../..');
  const version = thisInstall(root).version;
  const vsix = resolve(process.argv[2] ?? join(root, `apostil-${version}.vsix`));
  if (!existsSync(vsix)) throw new Error(`${vsix} is not there. Run npm run package first.`);
  const before = realPlaces();
  const repo = makeTestRepo();
  const host = mkdtempSync('/tmp/ap-host-'); // an empty extension for --extensionDevelopmentPath: the one under check is the installed one
  writeFileSync(join(host, 'package.json'), JSON.stringify({ name: 'package-check-host', publisher: 'apostil', version: '0.0.0', engines: { vscode: '^1.100.0' } }));
  // VS Code itself does not start with another HOME, so run() sets HOME inside its extension host; the install of the .vsix gets it here.
  const trialPath = (temp: string) => [join(temp, 'home', '.local', 'bin'), join(temp, 'bin'), '/usr/bin', '/bin'].join(':');
  const code = await runInVsCode({
    script: __filename,
    folder: repo.folder,
    extension: host,
    prepare: (temp) => {
      // Stand-ins for the apps (they only exit), a home folder of its own, and the .vsix installed into temp/e.
      mkdirSync(join(temp, 'bin'));
      mkdirSync(join(temp, 'home', '.local', 'bin'), { recursive: true });
      for (const program of ['claude', 'codex']) writeFileSync(join(temp, 'bin', program), '#!/bin/sh\nexit 0\n');
      writeFileSync(join(temp, 'bin', 'gh'), '#!/bin/sh\necho "[]"\n');
      for (const program of ['claude', 'codex', 'gh']) chmodSync(join(temp, 'bin', program), 0o755);
      const cli = join(dirname(dirname(CODE)), 'Resources', 'app', 'bin', 'code');
      const installed = execFileSync(cli, ['--install-extension', vsix, `--extensions-dir=${join(temp, 'e')}`, `--user-data-dir=${join(temp, 'u')}`], { encoding: 'utf8', env: { ...process.env, HOME: join(temp, 'home'), PATH: trialPath(temp) } });
      console.log(`NOTE  ${installed.trim().split('\n').pop()}`);
    },
    // VSCODE_CLI keeps this environment: without it VS Code takes PATH from the login shell.
    env: (temp) => ({ PATH: trialPath(temp), APOSTIL_TRIAL: temp, APOSTIL_HOME: join(temp, 'store'), VSCODE_CLI: '1' }),
  });
  rmSync(host, { recursive: true, force: true });
  repo.remove();
  const same = realPlaces() === before;
  console.log(same ? 'PASS  the real home folder and the folders of the real path are as they were' : `FAIL  a real place changed:\n${before}\n---\n${realPlaces()}`);
  process.exit(code || (same ? 0 : 1));
}

if (require.main === module) void start();
