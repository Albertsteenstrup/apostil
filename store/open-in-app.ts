// Opens a folder in Apostil, as "code ." does for VS Code. Until the fork exists, Apostil is VS Code with its extension:
// from a checkout, VS Code with this repo as the extension; from an installed extension, VS Code as it is.

import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

const VS_CODE = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
const REPO_ROOT = join(__dirname, '..', '..');
const isCheckout = (root: string): boolean => existsSync(join(root, 'tsconfig.json')); // the file to install leaves the build files out

const onPath = (program: string, env: Record<string, string | undefined>): boolean =>
  (env.PATH ?? '').split(delimiter).some((folder) => {
    try {
      accessSync(join(folder, program), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });

/** The program and its arguments that open a folder. The program is APOSTIL_APP when it is set. */
export function openCommand(folder: string, env: Record<string, string | undefined>, root = REPO_ROOT): string[] {
  const path = resolve(folder);
  if (env.APOSTIL_APP) return [env.APOSTIL_APP, path];
  return [onPath('code', env) ? 'code' : VS_CODE, ...(isCheckout(root) ? [`--extensionDevelopmentPath=${root}`] : []), path];
}

/** True when a program is there to open a folder: APOSTIL_APP, the command "code", or VS Code in its usual place. */
export function canOpen(env: Record<string, string | undefined>): boolean {
  return Boolean(env.APOSTIL_APP) || onPath('code', env) || existsSync(VS_CODE);
}

/** Starts the app detached and does not wait for it. */
export function openInApp(folder: string): void {
  const [program, ...args] = openCommand(folder, process.env);
  spawn(program, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}
