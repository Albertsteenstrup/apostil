// The cleanup script of the extension (package.json, "vscode:uninstall"). VS Code or a fork runs it when it removes Apostil for good,
// which it does at its next start. It is the uninstall of "apostil uninstall", run as the editor's step: no window and no question,
// the store stays, and what it did goes, with the date, into <store>/uninstall.log. VS Code stops the script after 5 seconds and then
// removes the storage of the extension itself. The script always ends with exit code 0.

import { appendFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { storeFolder } from '../shared/store';
import { commandFolders } from '../view/install-command';
import { line, thisInstall } from './setup';
import { runningEditor, uninstall, type UninstallRun } from './uninstall';

/** Adds lines to the log of the store. A store that is gone stays gone ("delete my data"): then the lines go nowhere. */
function log(store: string, lines: string[]): void {
  if (existsSync(store)) appendFileSync(join(store, 'uninstall.log'), `${lines.join('\n')}\n`);
}

/** Runs the cleanup of one editor and writes the log: first the date, so that a run that the editor stops still leaves a line. Nothing is thrown. */
export function cleanUp(store: string, title: string, makeRun: () => UninstallRun, at = new Date()): void {
  try {
    log(store, [`${at.toISOString()}  ${title}`]);
    const { lines } = uninstall(makeRun());
    log(store, [...lines, '']);
    console.log(lines.join('\n')); // VS Code keeps this in its own log
  } catch (error) {
    try {
      log(store, [line('left', `The cleanup stopped: ${error instanceof Error ? error.message : String(error)}. Run apostil uninstall, or remove the places by hand.`), '']);
    } catch {
      // nowhere to write
    }
  }
}

if (require.main === module) {
  delete process.env.ELECTRON_RUN_AS_NODE; // the programs that it starts (git, claude) must not run as Node
  const home = homedir();
  const store = storeFolder(home);
  const extension = resolve(__dirname, '..', '..');
  const editor = runningEditor(process.execPath);
  // An editor that started from the Dock has a short path: the folders where Apostil puts its command, and where claude lives, go with it.
  const path = [...new Set([...(process.env.PATH ?? '').split(delimiter), ...commandFolders(home)])].filter(Boolean).join(delimiter);
  cleanUp(store, `${editor?.name ?? 'An editor'} removed the extension in ${extension}.`, () => ({ machine: { home, path }, install: thisInstall(extension), store, removing: { editor, extension } }));
  process.exitCode = 0;
}
