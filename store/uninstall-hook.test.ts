// Tests for the cleanup script that an editor runs when it removes Apostil for good, in a home folder of its own.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { makeTestRepo, tempFolder } from '../shared/test-repo';
import { installCommand } from '../view/install-command';
import { connectClaudeCode } from './connect-claude-code';
import { setup, thisInstall } from './setup';
import { cleanUp } from './uninstall-hook';
import { runningEditor } from './uninstall';

delete process.env.APOSTIL_HOME; // the store is the one of the home folder of each test
const install = thisInstall();
const VS_CODE = '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)';

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Apostil set up for a repo and for all repos, with its launcher into the extension that VS Code removes, and a link of the person to a checkout. */
function setUpHome() {
  const home = tempFolder('apostil-home-');
  const settings = (app: string) => join(home, ...(process.platform === 'darwin' ? ['Library', 'Application Support'] : ['.config']), app, 'User', 'settings.json');
  const machine = { home, path: [join(home, '.local', 'bin'), join(home, 'bin')].join(':') };
  const store = join(home, '.apostil');
  const repo = makeTestRepo();
  write(join(home, '.claude', 'settings.json'), '{}\n');
  mkdirSync(join(home, '.codex'));
  setup({ install, machine, repo: repo.folder });
  setup({ install, machine });
  connectClaudeCode(repo.folder, home);
  const extension = join(home, '.vscode', 'extensions', 'apostil.apostil-9.9.9');
  write(join(extension, 'package.json'), '{ "name": "apostil" }');
  write(join(extension, 'out', 'store', 'cli.js'), '');
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  assert.ok(installCommand(join(extension, 'out', 'store', 'cli.js'), [join(home, '.local', 'bin')], machine.path, VS_CODE).link);
  const checkout = join(home, 'code', 'apostil');
  write(join(checkout, 'package.json'), '{ "name": "apostil" }');
  write(join(checkout, 'out', 'store', 'cli.js'), '');
  mkdirSync(join(home, 'bin'));
  symlinkSync(join(checkout, 'out', 'store', 'cli.js'), join(home, 'bin', 'apostil'));
  write(settings('Code'), '{\n    "apostil.codexModel": "made-up",\n    "editor.fontSize": 14\n}\n');
  write(settings('Cursor'), '{\n    "apostil.codexModel": "made-up"\n}\n');
  return { home, store, repo, extension, settings, run: { machine, install, store, removing: { editor: runningEditor(VS_CODE), extension } } };
}

const skillsThere = (folder: string): boolean => existsSync(join(folder, '.claude', 'skills', 'apostil-map-repo'));

test('while another editor still has Apostil, the cleanup of VS Code keeps the shared setup, takes only its own settings, keeps the store and writes the log', () => {
  assert.deepEqual([VS_CODE, '/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron', '/Applications/Cursor.app/Contents/MacOS/Cursor'].map((path) => runningEditor(path)?.name), ['VS Code', 'VS Code Insiders', 'Cursor']);
  const { home, store, repo, settings, run } = setUpHome();
  write(join(home, '.cursor', 'extensions', 'extensions.json'), JSON.stringify([{ identifier: { id: 'apostil.apostil' }, version: '9.9.9' }]));
  cleanUp(store, 'VS Code removed the extension.', () => run, new Date('2026-11-16T12:00:00Z'));

  const logged = readFileSync(join(store, 'uninstall.log'), 'utf8');
  assert.match(logged, /^2026-11-16T12:00:00\.000Z  VS Code removed the extension\.\nkept +The skills, the hooks, the Git exclude lines, the command and the Claude mod: Cursor still has Apostil\.\n/);
  assert.match(logged, /^removed +The settings apostil\.codexModel in .*Code\/User\/settings\.json$/m);
  assert.match(logged, /^kept +The store ~\/\.apostil .*To delete it later: rm -r ~\/\.apostil$/m);
  assert.equal(readFileSync(settings('Code'), 'utf8'), '{\n    "editor.fontSize": 14\n}\n');
  assert.equal(readFileSync(settings('Cursor'), 'utf8'), '{\n    "apostil.codexModel": "made-up"\n}\n');
  assert.ok(skillsThere(repo.folder) && skillsThere(home) && existsSync(join(home, '.local', 'bin', 'apostil')));
  repo.remove();
});

test('when no other editor has Apostil, the cleanup removes the shared setup, and only a command that points into the removed extension', () => {
  const { home, store, repo, run } = setUpHome();
  cleanUp(store, 'VS Code removed the extension.', () => run);
  const logged = readFileSync(join(store, 'uninstall.log'), 'utf8');
  assert.equal(skillsThere(repo.folder) || skillsThere(home) || existsSync(join(repo.folder, '.claude')), false, logged);
  assert.equal(readFileSync(join(repo.folder, '.git', 'info', 'exclude'), 'utf8').includes('apostil'), false);
  assert.equal(existsSync(join(home, '.local', 'bin', 'apostil')), false);
  assert.equal(existsSync(join(home, 'bin', 'apostil')), true);
  assert.match(logged, /^left +~\/bin\/apostil: it is not a launcher or link of this extension, so it stays\.$/m);
  assert.match(logged, /^nothing +The Claude mod apostil: Claude's plugin file lists none\.$/m);
  assert.equal(/^removed +The extension|VS Code's storage/m.test(logged), false); // the editor does both itself
  repo.remove();
});

test('the cleanup throws nothing: an error goes into the log, and a store that is gone stays gone', () => {
  const store = tempFolder('apostil-store-');
  cleanUp(store, 'VS Code removed the extension.', () => { throw new Error('boom'); });
  assert.match(readFileSync(join(store, 'uninstall.log'), 'utf8'), /^left +The cleanup stopped: boom\./m);
  const gone = join(store, 'deleted');
  cleanUp(gone, 'VS Code removed the extension.', () => { throw new Error('boom'); });
  assert.equal(existsSync(gone), false);
});
