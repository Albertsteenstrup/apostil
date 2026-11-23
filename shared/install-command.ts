// Puts the apostil command on the path: a launcher script for an installed extension, a link to out/store/cli.js for a checkout.

import { accessSync, chmodSync, constants, lstatSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

/** The folders that the link may go into, the first one that fits wins. */
export const commandFolders = (home = homedir()): string[] => ['/opt/homebrew/bin', '/usr/local/bin', join(home, '.local', 'bin')];

export interface Installed {
  link?: string; // where the script or link was made
  problem?: string; // why it was not made
}

const writable = (folder: string): boolean => {
  try {
    accessSync(folder, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const exists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

const MARK = '# Written by Apostil for the install at ';
const quoted = (text: string): string => `'${text.replace(/'/g, "'\\''")}'`;

/**
 * The launcher: it runs cli.js on the Node of the editor, or on `node` when the editor is gone.
 * The editor sees ELECTRON_RUN_AS_NODE in this one run only; cli.js removes it before it starts anything else.
 */
export function launcherScript(cli: string, program: string): string {
  return `#!/bin/sh
${MARK}${resolve(cli, '..', '..', '..')}. Do not edit it.
cli=${quoted(cli)}
program=${quoted(program)}
if [ -x "$program" ]; then
  APOSTIL_RUNS_ON=editor ELECTRON_RUN_AS_NODE=1 exec "$program" "$cli" "$@"
fi
if command -v node >/dev/null 2>&1; then
  unset APOSTIL_RUNS_ON
  exec node "$cli" "$@"
fi
echo "apostil: the editor that installed this command is gone. Open VS Code once, or install Node 24." >&2
exit 127
`;
}

/** The cli.js that a script or link of Apostil points at, or undefined when the path is not one of ours. */
export function ownTarget(path: string): string | undefined {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      const target = resolve(dirname(path), readlinkSync(path));
      return target.endsWith(join('out', 'store', 'cli.js')) ? target : undefined;
    }
    const text = readFileSync(path, 'utf8');
    if (text.length > 4000 || !text.startsWith(`#!/bin/sh\n${MARK}`)) return undefined;
    return /^cli='(.*)'$/m.exec(text)?.[1].replace(/'\\''/g, "'");
  } catch {
    return undefined;
  }
}

/** True when a path is a script or a link of Apostil. One whose cli.js is gone is of an older install. */
export function isOwnLink(path: string): boolean {
  const target = ownTarget(path);
  if (!target) return false;
  if (!exists(target)) return true;
  try {
    return JSON.parse(readFileSync(join(target, '..', '..', '..', 'package.json'), 'utf8')).name === 'apostil';
  } catch {
    return false;
  }
}

/** True when the command at `path` is Apostil's and needs writing again: its cli.js is gone, or its script is not the one that would be written now. */
export function needsRefresh(path: string, cli: string, program?: string): boolean {
  const target = ownTarget(path);
  if (!target) return false;
  if (!exists(target)) return true;
  return !!program && !lstatSync(path).isSymbolicLink() && readFileSync(path, 'utf8') !== launcherScript(cli, program);
}

/**
 * Puts "apostil" into the first folder that is on the path and can be written. It replaces only its own script or link.
 * With a `program` (the editor that runs the extension) it writes the launcher; without one, a link to `cli`.
 */
export function installCommand(cli: string, folders = commandFolders(), path = process.env.PATH ?? '', program?: string): Installed {
  const onPath = new Set(path.split(delimiter).filter(Boolean).map((folder) => resolve(folder)));
  const folder = folders.find((candidate) => onPath.has(resolve(candidate)) && writable(candidate));
  if (!folder) return { problem: `None of these folders is on the path and can be written: ${folders.join(', ')}.` };
  const link = join(folder, 'apostil');
  if (exists(link)) {
    if (!isOwnLink(link)) return { problem: `${link} is already there and is not Apostil's command, so it was left as it is.` };
    unlinkSync(link);
  }
  if (program) {
    writeFileSync(link, launcherScript(cli, program));
    chmodSync(link, 0o755);
  } else {
    chmodSync(cli, 0o755);
    symlinkSync(cli, link);
  }
  return { link };
}
