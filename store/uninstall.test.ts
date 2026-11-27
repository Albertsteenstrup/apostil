// Tests for "apostil uninstall" in a home folder of its own: what it takes away, what stays, the dry run, and the store.
// Stand-ins for claude and code answer from a folder outside the home folder; nothing here runs a real app.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { checkChangeFile } from '../shared/checks';
import { baseOf, currentBranch, headCommit, repoId } from '../shared/git';
import { Store } from '../shared/store';
import { makeTestRepo, tempFolder, testChangeFile } from '../shared/test-repo';
import { installCommand } from '../shared/install-command';
import { connectClaudeCode } from './connect-claude-code';
import { setup, thisInstall } from './setup';
import { setUpRepos } from './setup-record';
import { EDITORS, uninstall } from './uninstall';

delete process.env.APOSTIL_HOME; // the store is the one of the home folder of each test
const install = thisInstall();
const cli = join(__dirname, 'cli.js');

/** Every folder, file and link below a folder, with what a file holds. */
function snapshot(folder: string, skip: (path: string) => boolean = () => false): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true }).map((entry) => join(entry.parentPath, entry.name)).filter((path) => !skip(relative(folder, path))).map((path) => {
    const stat = lstatSync(path);
    return `${relative(folder, path)} ${stat.isSymbolicLink() ? `-> ${readlinkSync(path)}` : stat.isDirectory() ? '/' : readFileSync(path, 'utf8')}`;
  }).sort();
}

/** The database of VS Code's saved answers changes bytes when a row goes, so the snapshots skip it; the rows are checked with rowsOf(). */
const isVsCodeDatabase = (path: string): boolean => path.endsWith('state.vscdb');

const APOSTIL_ROWS: [string, string][] = [
  ['apostil.apostil', '{"apostil.askedForLook":true,"apostil.askedForCommand":true,"apostil.askedForMap.repo":true}'],
  ['workbench.view.extension.apostil.state.hidden', '[{"id":"apostil.home","isHidden":false}]'],
];

/** A database of VS Code's saved answers: a row of another extension, and with apostil, the rows of Apostil. */
function writeStateDatabase(user: string, apostil: boolean): string {
  const file = join(user, 'globalStorage', 'state.vscdb');
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
  const insert = db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)');
  for (const [key, value] of [['other.extension', '{"other.asked":true}'], ...(apostil ? APOSTIL_ROWS : [])]) insert.run(key, value);
  db.close();
  return file;
}

/** The keys in a database of VS Code, sorted. */
function rowsOf(file: string): string[] {
  const db = new DatabaseSync(file, { readOnly: true });
  const keys = (db.prepare('SELECT key FROM ItemTable').all() as { key: string }[]).map((row) => row.key).sort();
  db.close();
  return keys;
}

function write(path: string, text: string, mode = 0o644): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  chmodSync(path, mode);
}

/**
 * A home folder with the person's own things, then Apostil as the product installs it: setup for a repo and for all repos, both hooks,
 * the launcher, VS Code's storage, Apostil's settings, a Claude mod, the extension and a store. A second repo of the record is gone.
 */
function installedHome() {
  const home = tempFolder('apostil-home-');
  const bin = tempFolder('apostil-bin-'); // the stand-ins, and what they remember
  const user = join(home, ...(process.platform === 'darwin' ? ['Library', 'Application Support'] : ['.config']), 'Code', 'User');
  const machine = { home, path: [bin, join(home, 'bin'), join(home, '.local', 'bin')].join(':') };
  const store = join(home, '.apostil');
  write(join(bin, 'claude'), `#!/bin/sh
case "$*" in
  "plugin list --json") if [ -e "${bin}/mod-gone" ]; then echo '[{"id":"other@market","scope":"user"}]'; else echo '[{"id":"apostil@apostil","scope":"user"},{"id":"other@market","scope":"user"}]'; fi ;;
  "plugin uninstall apostil@apostil --scope user") : > "${bin}/mod-gone" ;;
  "plugin marketplace remove apostil") : > "${bin}/market-gone" ;;
  *) exit 1 ;;
esac
`, 0o755);
  write(join(bin, 'code'), `#!/bin/sh
case "$*" in
  "--list-extensions") echo other.extension; [ -e "${bin}/extension-gone" ] || echo apostil.apostil ;;
  "--uninstall-extension apostil.apostil") : > "${bin}/extension-gone" ;;
  *) exit 1 ;;
esac
`, 0o755);

  // The person's own things: they must stay as they are.
  const repo = makeTestRepo();
  write(join(repo.folder, '.git', 'info', 'exclude'), '# my own line\n*.log\n');
  write(join(home, '.claude', 'skills', 'my-notes', 'SKILL.md'), 'Keep notes.\n');
  write(join(home, '.claude', 'skills', 'apostil-notes', 'SKILL.md'), 'My own skill with a name like Apostil\'s.\n');
  write(join(home, '.agents', 'skills', 'my-checks', 'SKILL.md'), 'Run checks.\n');
  write(join(home, '.claude', 'settings.json'), `${JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] } }, null, 2)}\n`);
  write(join(home, '.codex', 'config.toml'), 'model = "made-up"\n');
  write(join(home, 'bin', 'apostil'), '#!/bin/sh\necho mine\n', 0o755);
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  write(join(user, 'settings.json'), '{\n    "editor.fontSize": 14\n}\n');
  const state = writeStateDatabase(user, false);
  const before = { home: snapshot(home, isVsCodeDatabase), repo: snapshot(repo.folder, inGit) };

  // Apostil.
  setup({ install, machine, repo: repo.folder });
  setup({ install, machine });
  connectClaudeCode(repo.folder, home);
  connectClaudeCode(undefined, home);
  const gone = makeTestRepo();
  setup({ install, machine, repo: gone.folder });
  gone.remove();
  assert.ok(installCommand(cli, [join(home, '.local', 'bin')], machine.path, '/Applications/Made Up.app/Contents/MacOS/Code').link);
  write(join(user, 'globalStorage', 'apostil.apostil', 'avatars', 'mira.png'), 'png');
  writeStateDatabase(user, true);
  write(join(user, 'settings.json'), '{\n    "editor.fontSize": 14,\n    "apostil.codexModel": "made-up",\n    "workbench.colorTheme": "Apostil Light"\n}\n');
  const saved = new Store(store);
  const base = baseOf(repo.folder, currentBranch(repo.folder));
  saved.saveChange({ repoId: repoId(repo.folder), folder: repo.folder, branch: 'feature', base, head: headCommit(repo.folder), file: testChangeFile(), checks: checkChangeFile(repo.folder, base, testChangeFile()) });
  saved.close();
  assert.deepEqual(setUpRepos(store), [gone.folder, repo.folder].sort()); // setup and connect wrote the record
  return { home, bin, user, state, machine, store, repo, gone, before, run: { machine, install, store, folder: repo.folder } };
}

/** In a repo, Git's own files change with every command; only the exclude file is Apostil's. */
const inGit = (path: string): boolean => path.startsWith('.git/') && path !== '.git/info/exclude';

const lineWith = (lines: string[], text: string): string => lines.find((one) => one.includes(text)) ?? `no line with "${text}" in:\n${lines.join('\n')}`;

test('a dry run changes nothing; then uninstall prints the same lines and leaves the home folder and the repo as before Apostil, except the store', () => {
  const { home, bin, state, store, repo, gone, before, run } = installedHome();
  const installed = { home: snapshot(home), repo: snapshot(repo.folder, inGit) };
  const dry = uninstall({ ...run, dryRun: true });
  assert.deepEqual({ home: snapshot(home), repo: snapshot(repo.folder, inGit) }, installed);
  assert.deepEqual(readdirSync(bin).sort(), ['claude', 'code']); // the stand-ins were only asked for their lists
  assert.deepEqual(rowsOf(state), ['apostil.apostil', 'other.extension', 'workbench.view.extension.apostil.state.hidden']);

  const done = uninstall(run);
  assert.equal(done.ok, true, done.lines.join('\n'));
  assert.deepEqual(done.lines.slice(0, -1), dry.lines.slice(0, -1)); // the same lines; only the line of the store differs, below
  assert.deepEqual(snapshot(home, (path) => path === '.apostil' || path.startsWith('.apostil/') || isVsCodeDatabase(path)), before.home);
  assert.deepEqual(rowsOf(state), ['other.extension']); // the rows of another extension stay
  assert.deepEqual(snapshot(repo.folder, inGit), before.repo);
  assert.deepEqual(readdirSync(bin).sort(), ['claude', 'code', 'extension-gone', 'market-gone', 'mod-gone']);

  // One line for each place; what is not Apostil's stays, with a line that says so.
  const { lines } = done;
  assert.match(lineWith(lines, gone.folder), /^skipped .*the folder is gone/);
  assert.match(lineWith(lines, 'apostil-notes'), /^left +~\/\.claude\/skills\/apostil-notes: Apostil did not put it there/);
  assert.match(lineWith(lines, '~/bin/apostil'), /^left +.*not a launcher or link of Apostil/);
  assert.match(lineWith(lines, '~/.local/bin/apostil'), /^removed +The command/);
  assert.match(lineWith(lines, 'apostil.codexModel'), /^removed +The settings apostil\.codexModel, workbench\.colorTheme in ~\//);
  assert.match(lineWith(lines, "VS Code's storage"), /^removed /);
  assert.match(lineWith(lines, "VS Code's saved answers"), /^removed +VS Code's saved answers of Apostil in ~\/.*\/Code\/User\/globalStorage\/state\.vscdb$/);
  assert.match(lineWith(lines, 'Claude mod apostil@apostil'), /^removed /);
  assert.match(lineWith(lines, 'marketplace'), /^removed +The marketplace apostil /); // "market" holds another mod: no line
  assert.match(lineWith(lines, 'The extension'), /^removed +The extension in VS Code, through code --uninstall-extension/);
  assert.match(dry.lines.at(-1)!, /^kept +The store ~\/\.apostil \(\d+ KB\): maps of 0 repos, 1 described change, 0 comments\. apostil uninstall --delete-data removes it\.$/);
  assert.match(lines.at(-1)!, /^kept +The store ~\/\.apostil \(\d+ KB\): maps of 0 repos, 1 described change, 0 comments\. To delete it later: rm -r ~\/\.apostil$/); // the command is gone now
  assert.equal(existsSync(join(store, 'apostil.sqlite')), true);
  assert.deepEqual(setUpRepos(store), []);
  repo.remove();
});

test('with --delete-data the store goes too, and a second run finds nothing more', () => {
  const { home, store, repo, before, run } = installedHome();
  const done = uninstall({ ...run, deleteData: true });
  assert.match(done.lines.at(-1)!, /^removed +The store ~\/\.apostil \(/);
  assert.equal(existsSync(store), false);
  assert.deepEqual(snapshot(home, isVsCodeDatabase), before.home);
  const again = uninstall({ ...run, deleteData: true });
  assert.deepEqual(again.lines.filter((one) => one.startsWith('removed')), [], again.lines.join('\n'));
  repo.remove();
});

test('the cleanup of an editor that removed the extension clears the saved answers in its own folders, which the editor does not clear', () => {
  const { home, state, repo, run } = installedHome();
  const done = uninstall({ ...run, removing: { editor: EDITORS[0], extension: join(home, '.vscode', 'extensions', 'apostil.apostil-0.5.2') } });
  assert.match(lineWith(done.lines, "VS Code's saved answers"), /^removed /);
  assert.deepEqual(rowsOf(state), ['other.extension']);
  repo.remove();
});

test('the saved answers in the user folder of a remote server go too, and a database that cannot be read is left with the step by hand, and the run goes on', () => {
  const home = tempFolder('apostil-home-');
  const server = join(home, '.vscode-server', 'data', 'User');
  const file = writeStateDatabase(server, true);
  const broken = join(home, ...(process.platform === 'darwin' ? ['Library', 'Application Support'] : ['.config']), 'Cursor', 'User');
  write(join(broken, 'globalStorage', 'state.vscdb'), 'not a database');
  const machine = { home, path: '/nowhere' };
  const store = join(home, 'store');
  const done = uninstall({ machine, install, store });
  assert.deepEqual(rowsOf(file), ['other.extension']);
  assert.match(lineWith(done.lines, '~/.vscode-server/'), /^removed +VS Code's saved answers of Apostil in ~\/\.vscode-server\/data\/User\/globalStorage\/state\.vscdb$/);
  assert.match(lineWith(done.lines, 'Cursor/User'), /^left +VS Code's saved answers of Apostil in .*: .*\. Close the editor and run apostil uninstall again\.$/);
  assert.equal(done.ok, false);
});

test('a home with no saved answers prints the line "none found", and a dry run keeps the rows', () => {
  const home = tempFolder('apostil-home-');
  const user = join(home, ...(process.platform === 'darwin' ? ['Library', 'Application Support'] : ['.config']), 'Code', 'User');
  const machine = { home, path: '/nowhere' };
  const store = join(home, 'store');
  assert.match(lineWith(uninstall({ machine, install, store }).lines, "VS Code's saved answers"), /^nothing +VS Code's saved answers of Apostil: none found\.$/);
  const file = writeStateDatabase(user, false); // a database with the rows of another extension only
  assert.match(lineWith(uninstall({ machine, install, store }).lines, "VS Code's saved answers"), /^nothing /);
  writeStateDatabase(user, true);
  uninstall({ machine, install, store, dryRun: true });
  assert.equal(rowsOf(file).length, 3);
});

test('what uninstall cannot do or must not touch is left, with the reason and the step by hand, and the run goes on', () => {
  const home = tempFolder('apostil-home-');
  const locked = join(home, 'locked');
  mkdirSync(locked);
  assert.ok(installCommand(cli, [locked], locked, '/Applications/Made Up.app/Contents/MacOS/Code').link);
  chmodSync(locked, 0o555); // the launcher cannot be removed
  write(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'apostil@apostil': [{ scope: 'user' }] } })); // a mod of the desktop app, no claude command
  const other = tempFolder('apostil-other-'); // a folder in APOSTIL_HOME that is no store
  write(join(other, 'notes.txt'), 'mine');

  const done = uninstall({ machine: { home, path: locked }, install, store: other, deleteData: true });
  chmodSync(locked, 0o755);
  assert.equal(done.ok, false);
  assert.match(lineWith(done.lines, 'Claude mod'), /^left +The Claude mod apostil@apostil: the command claude is not on the path\. In Claude, open Plugins, remove apostil, then remove its marketplace apostil\.$/);
  assert.match(lineWith(done.lines, 'The command'), /^left +The command ~\/locked\/apostil: EACCES.*\. Remove it by hand: rm /);
  assert.equal(existsSync(join(locked, 'apostil')), true);
  assert.match(done.lines.at(-1)!, /^left +The store .*: it holds neither apostil\.sqlite nor repos-set-up\.json, so it stays\.$/);
  assert.equal(readFileSync(join(other, 'notes.txt'), 'utf8'), 'mine');
});

test('apostil uninstall is the first command of the help, and --dry-run on the command line says that nothing changes', () => {
  const home = tempFolder('apostil-home-');
  const env = { ...process.env, HOME: home, PATH: '/usr/bin:/bin', APOSTIL_HOME: join(home, 'store') };
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env });
  assert.match(JSON.parse(help.stdout).commands[0], /^apostil uninstall \[--dry-run\] \[--delete-data\]/);
  const dry = spawnSync(process.execPath, [cli, 'uninstall', '--dry-run'], { cwd: home, encoding: 'utf8', env });
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.match(dry.stdout, /^Dry run: nothing changes\./);
  assert.match(dry.stdout, /^nothing +The store ~\/store: not there\.$/m);
  assert.deepEqual(readdirSync(home), []);
});
