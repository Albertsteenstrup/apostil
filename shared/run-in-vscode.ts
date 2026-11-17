// Runs a check script inside a second VS Code window that has its own settings and extensions folders.
// The owner's own VS Code settings are never touched. The check of the .vsix file starts here; view/window-check.mjs starts its own window.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const CODE = process.env.APOSTIL_VSCODE ?? '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
const LIMIT_MS = 90_000;

export interface VsCodeRun {
  script: string; // a built script that exports run(); VS Code calls it inside its extension host
  folder: string; // the folder that the window opens
  env?: (temp: string) => Record<string, string>; // more environment variables; temp is a folder that is removed afterwards
  extension?: string; // the extension under development; by default this repo
  prepare?: (temp: string) => void; // runs before the window starts, for example to install a .vsix into temp/e
}

/**
 * The settings of every window that a check starts. The checks were written for a window that starts with no tab,
 * so Home does not open by itself in place of the empty editor area; view/window-check.mjs turns it on for its first part.
 */
export const CHECK_SETTINGS = { 'apostil.homeWhenEmpty': false };

/** Starts the window with this repo as the extension, waits for the script, and returns the exit code. 0 means run() ended without an error. */
export async function runInVsCode({ script, folder, env, extension = resolve(__dirname, '../..'), prepare }: VsCodeRun): Promise<number> {
  const temp = mkdtempSync('/tmp/ap-'); // short: VS Code fails when its socket path is longer than 103 characters
  const args = [
    `--extensionDevelopmentPath=${extension}`, `--extensionTestsPath=${script}`,
    `--user-data-dir=${join(temp, 'u')}`, `--extensions-dir=${join(temp, 'e')}`,
    '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', folder,
  ];
  mkdirSync(join(temp, 'u', 'User'), { recursive: true });
  writeFileSync(join(temp, 'u', 'User', 'settings.json'), JSON.stringify(CHECK_SETTINGS));
  prepare?.(temp);
  const child = spawn(CODE, args, { env: { ...process.env, ...env?.(temp) }, stdio: ['ignore', 'pipe', 'pipe'] });
  // VS Code prints much of its own; show only the lines of the check.
  const show = (data: Buffer): void => {
    for (const line of data.toString().split('\n')) if (/PASS|FAIL|Error|NOTE/.test(line)) console.log(line);
  };
  child.stdout.on('data', show);
  child.stderr.on('data', show);
  const timer = setTimeout(() => { console.log('FAIL  VS Code did not end within 90 seconds; stopped it.'); child.kill('SIGKILL'); }, LIMIT_MS);
  const code: number = await new Promise((done) => child.on('exit', (exit) => done(exit ?? 1)));
  clearTimeout(timer);
  rmSync(temp, { recursive: true, force: true });
  console.log(code === 0 ? 'The check inside VS Code passed.' : `The check inside VS Code failed with exit code ${code}.`);
  return code;
}
