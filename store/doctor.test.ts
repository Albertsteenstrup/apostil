// Tests for "apostil doctor": each line in its ok form and its missing form, the exit, and that it writes nothing and holds no private text.

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkChangeFile } from '../shared/checks';
import { baseOf, currentBranch, headCommit, repoId } from '../shared/git';
import { Store } from '../shared/store';
import { makeTestRepo, runApostil, tempFolder, testChangeFile, testMachine } from '../shared/test-repo';
import { connectClaudeCode } from './connect-claude-code';
import { doctor } from './doctor';
import { setup, thisInstall, VERSION_FILE, type Machine } from './setup';

const install = thisInstall();
const version = install.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // the version of this install in a pattern: the tests hold no copy of the number
const cli = join(__dirname, 'cli.js');

/** A stand-in program in the bin folder of a machine. */
function program(machine: Machine, name: string, script: string): void {
  writeFileSync(join(machine.path, name), `#!/bin/sh\n${script}\n`);
  chmodSync(join(machine.path, name), 0o755);
}

/** Every file below a folder with its time, to see that nothing was written. */
function snapshot(folder: string): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true }).map((entry) => {
    const path = join(entry.parentPath, entry.name);
    return `${path} ${statSync(path).mtimeMs}`;
  }).sort();
}

const lineOf = (lines: string[], text: string): string => lines.find((line) => line.includes(text)) ?? `no line with "${text}" in:\n${lines.join('\n')}`;

test('doctor on a machine with everything: each line is ok, it lists the repos of the record and names uninstall, the exit is 0, and nothing is written', () => {
  const repo = makeTestRepo();
  const machine = testMachine({ claude: 'command', codex: 'command' });
  chmodSync(cli, 0o755); // as installCommand() does
  symlinkSync(cli, join(machine.path, 'apostil'));
  program(machine, 'gh', 'echo "Logged in to github.com account someone (keyring)"; echo "Token: gho_secret"; exit 0');
  program(machine, 'code', 'echo other.extension; echo apostil.apostil');
  setup({ install, machine, repo: repo.folder });
  connectClaudeCode(repo.folder, machine.home);
  const store = join(machine.home, '.apostil'); // where setup and connect keep the record of the repo
  const saved = new Store(store);
  const base = baseOf(repo.folder, currentBranch(repo.folder));
  saved.saveChange({ repoId: repoId(repo.folder), folder: repo.folder, branch: 'feature', base, head: headCommit(repo.folder), file: testChangeFile(), checks: checkChangeFile(repo.folder, base, testChangeFile()), agent: { app: 'claude-code', account: 'someone@example.com' } });
  saved.close();

  const before = [snapshot(repo.folder), snapshot(machine.home), snapshot(store)];
  const { lines, ok } = doctor({ folder: repo.folder, machine, install, cli, store, node: '24.1.0' });
  assert.equal(ok, true, lines.join('\n'));
  assert.deepEqual(lines.slice(0, -1).map((line) => line.split(' ')[0]), Array(9).fill('ok'), lines.join('\n'));
  assert.equal(lineOf(lines, 'Set up in'), `ok       Set up in 1 repo: ${repo.folder}.`);
  assert.match(lines.at(-1)!, /^To remove Apostil: apostil uninstall\./);
  assert.match(lineOf(lines, 'Node'), /^ok +Node 24 or newer \(the command runs on 24\.1\.0, the Node of this machine\)\.$/);
  assert.match(lineOf(lines, 'command apostil'), /from this install/);
  assert.match(lineOf(lines, 'Git repo'), /1 saved change, no map/);
  assert.match(lineOf(lines, 'Claude Code sees'), new RegExp(`for this repo\\), of version ${version}`));
  assert.match(lineOf(lines, 'Codex sees'), /for this repo/);
  assert.match(lineOf(lines, 'hook'), /^ok +The hook of Claude Code: added \(for this repo\)/);
  assert.match(lineOf(lines, 'gh is there'), /signed in/);
  assert.match(lineOf(lines, 'VS Code extension'), /^ok/);
  assert.deepEqual([snapshot(repo.folder), snapshot(machine.home), snapshot(store)], before);
  const text = lines.join('\n');
  assert.doesNotMatch(text, /@|gho_|someone|def start/); // no e-mail address, no token, no account, no code
  repo.remove();
});

test('doctor with things missing: each line says what corrects it, and the exit follows what every use needs, also on the command line', () => {
  const folder = tempFolder('apostil-not-a-repo-');
  const machine = testMachine();
  const store = join(tempFolder('apostil-store-'), 'none');
  const empty = doctor({ folder, machine, install, cli, store, node: '22.4.0' });
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.lines.slice(0, -1).map((line) => line.split(' ')[0]), Array(6).fill('missing'), empty.lines.join('\n'));
  assert.match(lineOf(empty.lines, 'Node'), /runs on 22\.4\.0, the Node of this machine\)\. Fix: install Node 24/);
  assert.match(lineOf(empty.lines, 'command apostil'), /Fix: "Apostil: Install the apostil command"/);
  assert.match(lineOf(empty.lines, 'Git repo'), /^missing .*Fix: run apostil in a Git repo/);
  assert.match(lineOf(empty.lines, 'Claude Code is on'), /Fix: install Claude Code if you use it/);
  assert.match(lineOf(empty.lines, 'Codex is on'), /Fix: install Codex/);
  assert.match(lineOf(empty.lines, 'gh is there'), /^missing .*Only pull requests need it\. Fix: install the GitHub CLI/);
  assert.equal(empty.lines.some((line) => line.includes('VS Code extension')), false); // no "code" command: no line about the extension
  assert.deepEqual(readdirSync(machine.home), []);
  assert.match(lineOf(doctor({ folder, machine, install, cli, store, node: '24.22.1', onEditor: true }).lines, 'Node'), /^ok +Node 24 or newer \(the command runs on 24\.22\.1, the Node of the editor\)/);

  // Another apostil on the path, the skills of an older version for Claude Code, none for Codex, no hook (optional), gh not signed in, the extension not installed.
  const repo = makeTestRepo();
  const other = testMachine({ claude: 'folder', codex: 'folder' });
  program(other, 'apostil', 'exit 0');
  program(other, 'gh', 'exit 1');
  program(other, 'code', 'echo other.extension');
  setup({ install, machine: other }); // for all repos
  for (const name of readdirSync(join(other.home, '.claude', 'skills'))) writeFileSync(join(other.home, '.claude', 'skills', name, VERSION_FILE), '0.0.1\n');
  rmSync(join(other.home, '.agents', 'skills', 'apostil-map-repo'), { recursive: true });

  const found = doctor({ folder: repo.folder, machine: other, install, cli, store, node: '24.0.0' });
  assert.equal(found.ok, false, found.lines.join('\n')); // another apostil on the path
  assert.match(lineOf(found.lines, 'command apostil'), /^missing +The command apostil on the path is another install \(.*apostil-bin-.*\/apostil\)\. Fix/);
  assert.match(lineOf(found.lines, 'Git repo'), /^ok .*no saved change yet, no map/);
  assert.match(lineOf(found.lines, 'Claude Code sees'), new RegExp(`^missing .*for all repos\\), of version 0\\.0\\.1; this install is ${version}\\. Fix: apostil setup again`));
  assert.match(lineOf(found.lines, 'Codex sees'), /^missing .*It does not see apostil-map-repo\. Fix: apostil setup/);
  assert.match(lineOf(found.lines, 'hook'), /^ok +The hook of Claude Code: not added \(optional\)/); // never missing
  assert.match(lineOf(found.lines, 'gh is there'), /^missing +gh is there but not signed in\. .*Fix: gh auth login\./);
  assert.match(lineOf(found.lines, 'VS Code extension'), new RegExp(`^missing .*Fix: code --install-extension apostil-${version}\\.vsix`));
  repo.remove();

  // setup copies the skill apostil-report-issue, doctor sees it, and doctor names it when it is gone.
  {
    const reporting = makeTestRepo();
    const machine = testMachine({ claude: 'command' });
    setup({ install, machine, repo: reporting.folder });
    const skill = join(reporting.folder, '.claude', 'skills', 'apostil-report-issue');
    assert.match(readFileSync(join(skill, 'SKILL.md'), 'utf8'), /^name: apostil-report-issue$/m);
    const none = join(tempFolder('apostil-store-'), 'none');
    assert.match(lineOf(doctor({ folder: reporting.folder, machine, install, cli, store: none }).lines, 'Claude Code sees'), /^ok +Claude Code sees the skills \(for this repo\)/);
    rmSync(skill, { recursive: true });
    assert.match(lineOf(doctor({ folder: reporting.folder, machine, install, cli, store: none }).lines, 'Claude Code sees'), /^missing .*It does not see apostil-report-issue\. Fix: apostil setup/);
    reporting.remove();
  }

  // apostil doctor on the command line exits with 1 when the command is not on the path, and makes no store.
  const bare = testMachine({ claude: 'folder' });
  mkdirSync(join(bare.home, '.claude', 'skills'), { recursive: true });
  const run = runApostil(['doctor'], { cwd: bare.home, env: { HOME: bare.home, PATH: bare.path, APOSTIL_HOME: join(bare.home, 'store') } });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /^ok +Node 24/m);
  assert.match(run.stdout, /^missing +The command apostil on the path\./m);
  assert.deepEqual(readdirSync(bare.home), ['.claude']); // no store was made
});
