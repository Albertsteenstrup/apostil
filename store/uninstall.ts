// "apostil uninstall": takes away what Apostil put on this computer, in this order: the setup of every repo of the record and of the home folder,
// VS Code's storage of the extension, its settings, the Claude mod, the command on the path, the extension. The store stays unless it is asked to go.
// It touches only what Apostil wrote, and prints one line for each place. A dry run prints the same lines and changes nothing.
// The same function serves "apostil uninstall", "Apostil: Uninstall…" in VS Code (inVsCode) and the cleanup script that an editor runs (removing).

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { tryGit } from '../shared/git';
import { Store } from '../shared/store';
import { isOwnLink, ownTarget } from '../shared/install-command';
import { exitOf } from './doctor';
import { line, setup, short, type Install, type Machine } from './setup';
import { RECORD_FILE, recordRepo, setUpRepos } from './setup-record';

export const EXTENSION_ID = 'apostil.apostil';
const STORE_FILE = 'apostil.sqlite'; // the database of the store (shared/store.ts)
const STATE_FILE = join('globalStorage', 'state.vscdb'); // where VS Code keeps the saved answers (global state) of every extension, in its user folder
const STATE_KEYS = [EXTENSION_ID, 'workbench.view.extension.apostil.state.hidden']; // the answers of Apostil, and the view state of its sidebar
const STATE_WAIT = 2000; // milliseconds that the database may be busy: the editor may be open
const SERVER_FOLDERS = ['.vscode-server', '.cursor-server', '.windsurf-server', '.vscode-server-insiders']; // the folders of an editor that runs on a remote machine

/**
 * VS Code and the forks that have a command of their own: the folder of their extensions in the home folder, the folder of their user data
 * (in ~/Library/Application Support on macOS), and how the path of their program looks.
 */
export const EDITORS = [
  { name: 'VS Code', command: 'code', folder: '.vscode', data: 'Code', program: /visual studio code\.app|\/code(\/|$)/i },
  { name: 'VS Code Insiders', command: 'code-insiders', folder: '.vscode-insiders', data: 'Code - Insiders', program: /visual studio code - insiders\.app|code-insiders/i },
  { name: 'Cursor', command: 'cursor', folder: '.cursor', data: 'Cursor', program: /cursor\.app|\/cursor(\/|$)/i },
  { name: 'Windsurf', command: 'windsurf', folder: '.windsurf', data: 'Windsurf', program: /windsurf\.app|\/windsurf(\/|$)/i },
  { name: 'VSCodium', command: 'codium', folder: '.vscode-oss', data: 'VSCodium', program: /vscodium\.app|\/codium(\/|$)/i },
  { name: 'Antigravity', command: 'antigravity', folder: '.antigravity', data: 'Antigravity', program: /antigravity\.app|\/antigravity(\/|$)/i },
];
export type Editor = (typeof EDITORS)[number];

/** The editor whose program runs at this path, or undefined for one that Apostil does not know. */
export const runningEditor = (program: string): Editor | undefined => EDITORS.find((editor) => editor.program.test(program));

/** The look of Apostil sets these settings to its theme (theme/choose-look.ts). Set to that theme, they are Apostil's too. */
export const THEME_SETTINGS = ['workbench.colorTheme', 'workbench.preferredLightColorTheme', 'workbench.preferredDarkColorTheme'];
const APOSTIL_THEME = 'Apostil Light';

/** True for a setting that Apostil wrote: one that starts with "apostil.", or a theme setting that names its theme. */
export const isApostilSetting = (key: string, value: unknown): boolean => key.startsWith('apostil.') || (THEME_SETTINGS.includes(key) && value === APOSTIL_THEME);

const children = (folder: string): string[] => {
  try {
    return readdirSync(folder);
  } catch {
    return [];
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

/** The user folders of VS Code, VS Code Insiders and the forks with VS Code's layout (Cursor, Windsurf, VSCodium, …), each with its profiles; with an editor, only its own. */
export function editorUserFolders(home: string, editor?: Editor): string[] {
  const base = process.platform === 'darwin' ? join(home, 'Library', 'Application Support') : process.platform === 'win32' ? join(home, 'AppData', 'Roaming') : join(home, '.config');
  return (editor ? [editor.data] : children(base)).map((app) => join(base, app, 'User')).filter((user) => existsSync(join(user, 'globalStorage')) || existsSync(join(user, 'settings.json')))
    .flatMap((user) => [user, ...children(join(user, 'profiles')).map((id) => join(user, 'profiles', id))]);
}

/** True when a folder of extensions holds Apostil: its list (extensions.json) names it, or, with no list, a folder of it that is not marked as removed. */
function hasApostil(extensions: string): boolean {
  const read = (name: string): any => {
    try {
      return JSON.parse(readFileSync(join(extensions, name), 'utf8'));
    } catch {
      return undefined;
    }
  };
  const listed = read('extensions.json');
  if (Array.isArray(listed)) return listed.some((one) => String(one?.identifier?.id ?? '').toLowerCase() === EXTENSION_ID);
  const removed = read('.obsolete') ?? {};
  return children(extensions).some((name) => name.toLowerCase().startsWith(`${EXTENSION_ID}-`) && !removed[name]);
}

/** The user folders of the editors that run on this machine as a remote server (over SSH, in a container), when they are there. */
export const serverUserFolders = (home: string): string[] => SERVER_FOLDERS.map((folder) => join(home, folder, 'data', 'User')).filter((user) => existsSync(user));

const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Where the store is, its size and what it holds: "~/.apostil (2.1 MB): maps of 3 repos, 12 described changes, 40 comments". Undefined when it is not there. */
export function storeFacts(store: string, home: string): string | undefined {
  if (!existsSync(store)) return undefined;
  let size = 'size unknown';
  try {
    const bytes = readdirSync(store, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).reduce((sum, entry) => sum + statSync(join(entry.parentPath, entry.name)).size, 0);
    size = bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  } catch {
    // a file that cannot be read: the size stays unknown
  }
  let holds = 'no maps and no described changes';
  if (existsSync(join(store, STORE_FILE))) {
    try {
      const read = new Store(store, true);
      const counts = read.counts();
      read.close();
      holds = `maps of ${count(counts.maps, 'repo')}, ${count(counts.changes, 'described change')}, ${count(counts.remarks, 'comment')}`;
    } catch {
      holds = 'it could not be read';
    }
  }
  return `${short(store, home)} (${size}): ${holds}`;
}

export interface UninstallRun {
  machine: Machine;
  install: Install;
  store: string;
  folder?: string; // the folder where it runs: its repo is undone too, also when the record does not hold it
  dryRun?: boolean;
  deleteData?: boolean;
  inVsCode?: boolean; // the command of VS Code takes away the settings and the extension itself, through VS Code
  removing?: { editor?: Editor; extension: string }; // the cleanup script of an editor that removes the extension in this folder for good
}

type Say = (word: string, text: string) => void;
/** Makes one change, or none in a dry run. True when it worked; on a throw it says "left" with the reason and the step by hand. */
type Change = (place: string, byHand: string, act: () => void) => boolean;

/** Takes Apostil's settings out of the settings files of VS Code and its forks. A file that is not plain JSON stays, and the line names its keys. */
function removeSettings(home: string, users: string[], say: Say, change: Change): void {
  let found = false;
  for (const file of users.map((user) => join(user, 'settings.json')).filter((one) => existsSync(one))) {
    const text = readFileSync(file, 'utf8');
    let settings: Record<string, unknown> | undefined;
    try {
      const read = JSON.parse(text);
      if (read && typeof read === 'object' && !Array.isArray(read)) settings = read;
    } catch {
      // comments or a comma at the end: VS Code reads it, JSON does not
    }
    const keys = settings ? Object.keys(settings).filter((key) => isApostilSetting(key, settings![key]))
      : [...text.matchAll(/"([\w.]+)"\s*:\s*(?:"([^"]*)")?/g)].filter((match) => isApostilSetting(match[1], match[2])).map((match) => match[1]);
    if (!keys.length) continue;
    found = true;
    if (!settings) {
      say('left', `${short(file, home)} is not plain JSON (it may hold comments), so Apostil did not change it. Remove these settings in it by hand: ${keys.join(', ')}.`);
      continue;
    }
    const kept = Object.fromEntries(Object.entries(settings).filter(([key]) => !keys.includes(key)));
    const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? '    '; // the file keeps its spacing
    const place = `The settings ${keys.join(', ')} in ${short(file, home)}`;
    if (change(place, 'Remove them in the file by hand.', () => writeFileSync(file, `${JSON.stringify(kept, null, indent)}${text.endsWith('\n') ? '\n' : ''}`))) say('removed', place);
  }
  if (!found) say('nothing', 'Settings of Apostil in VS Code: none found.');
}

/**
 * Takes the saved answers of Apostil (the global state of the extension and the view state of its sidebar) out of the database of VS Code in each user folder.
 * Without them a new install asks again whether to set up the look and whether to map a repo. A database that cannot be opened or written stays, and the line says so.
 */
function removeSavedAnswers(home: string, users: string[], say: Say, change: Change, failed: (place: string, error: unknown, byHand: string) => void): void {
  const byHand = 'Close the editor and run apostil uninstall again.';
  const marks = STATE_KEYS.map(() => '?').join(', ');
  let said = false; // a line for a file: removed, or left with the reason
  for (const file of users.map((user) => join(user, STATE_FILE)).filter((one) => existsSync(one))) {
    const place = `VS Code's saved answers of Apostil in ${short(file, home)}`;
    let rows = 0;
    try {
      const read = new DatabaseSync(file, { readOnly: true, timeout: STATE_WAIT });
      try {
        rows = Number((read.prepare(`SELECT count(*) AS n FROM ItemTable WHERE key IN (${marks})`).get(...STATE_KEYS) as { n: number }).n);
      } finally {
        read.close();
      }
    } catch (error) {
      failed(place, error, byHand);
      said = true;
      continue;
    }
    if (!rows) continue;
    said = true;
    const act = (): void => {
      const write = new DatabaseSync(file, { timeout: STATE_WAIT });
      try {
        write.prepare(`DELETE FROM ItemTable WHERE key IN (${marks})`).run(...STATE_KEYS);
      } finally {
        write.close();
      }
    };
    if (change(place, byHand, act)) say('removed', place);
  }
  if (!said) say('nothing', "VS Code's saved answers of Apostil: none found.");
}

/** The mods of Apostil that Claude's own plugin file lists: read when the command claude is not on the path (the desktop app has none), and by the quick run of an editor. */
function modsInPluginFile(home: string): string[] {
  try {
    const file = JSON.parse(readFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'));
    return Object.keys(file?.plugins ?? {}).filter((id) => id.split('@')[0] === 'apostil');
  } catch {
    return [];
  }
}

/**
 * The Claude mod "apostil", through Claude's own plugin command, when Claude's plugin list has it; then its marketplace, when that is Apostil's alone.
 * A quick run (an editor stops its cleanup script after 5 seconds) asks claude only when Claude's plugin file lists a mod of Apostil.
 */
function removeMod(machine: Machine, dryRun: boolean, say: Say, quick = false): boolean {
  if (quick && !modsInPluginFile(machine.home).length) {
    say('nothing', "The Claude mod apostil: Claude's plugin file lists none.");
    return true;
  }
  const claude = (...args: string[]) => exitOf(machine, 'claude', ['plugin', ...args], 60_000);
  const list = claude('list', '--json');
  if (!list) {
    const found = modsInPluginFile(machine.home);
    for (const id of found) say('left', `The Claude mod ${id}: the command claude is not on the path. In Claude, open Plugins, remove apostil, then remove its marketplace ${id.split('@')[1] ?? ''}.`);
    if (!found.length) say('nothing', 'The Claude mod apostil: no claude command on the path, and Claude\'s plugin file lists none.');
    return !found.length;
  }
  let plugins: { id: string; scope?: string }[];
  try {
    plugins = (JSON.parse(list.out.slice(list.out.indexOf('['))) as { id: unknown; scope?: string }[]).filter((one): one is { id: string; scope?: string } => typeof one?.id === 'string');
  } catch {
    say('left', 'The Claude mod apostil: claude plugin list gave no list, so Apostil could not look. Run claude plugin list.');
    return false;
  }
  const mods = plugins.filter((one) => one.id.split('@')[0] === 'apostil');
  if (!mods.length) say('nothing', 'The Claude mod apostil: not installed.');
  let ok = true;
  for (const mod of mods) {
    const scope = mod.scope ?? 'user';
    if (dryRun || claude('uninstall', mod.id, '--scope', scope)?.status === 0) say('removed', `The Claude mod ${mod.id}, through claude plugin uninstall`);
    else {
      ok = false;
      say('left', `The Claude mod ${mod.id}: claude plugin uninstall did not work. Run claude plugin uninstall ${mod.id} --scope ${scope}.`);
    }
  }
  // A marketplace named after Apostil, from which no other installed mod comes, was there for this mod only.
  const markets = [...new Set(mods.map((mod) => mod.id.split('@')[1] ?? ''))].filter((market) => market.includes('apostil') && plugins.every((one) => mods.includes(one) || !one.id.endsWith(`@${market}`)));
  for (const market of markets) {
    if (dryRun || claude('marketplace', 'remove', market)?.status === 0) say('removed', `The marketplace ${market} of the Claude mod, through claude plugin marketplace remove`);
    else say('left', `The marketplace ${market} of the Claude mod: run claude plugin marketplace remove ${market}.`);
  }
  return ok;
}

/** Takes Apostil away. One line for each place: removed, left (and why), kept, skipped or nothing; ok: false when a step that should work did not. */
export function uninstall({ machine, install, store, folder, dryRun = false, deleteData = false, inVsCode = false, removing }: UninstallRun): { lines: string[]; ok: boolean } {
  const { home } = machine;
  const lines: string[] = [];
  const say: Say = (word, text) => { lines.push(line(word, text)); };
  let ok = true;
  // One step that fails does not end the run: its line says why and what to do by hand, and the next place follows.
  const failed = (place: string, error: unknown, byHand: string): void => {
    say('left', `${place}: ${error instanceof Error ? error.message : String(error)}. ${byHand}`);
    ok = false;
  };
  const change: Change = (place, byHand, act) => {
    if (dryRun) return true;
    try {
      act();
      return true;
    } catch (error) {
      failed(place, error, byHand);
      return false;
    }
  };
  const facts = storeFacts(store, home); // read first: the undo of each repo takes it out of the record in the store, and a dry run must say the same
  // The cleanup of one editor keeps what all editors share while another editor still has Apostil. It never looks at the folder that it removes.
  const inside = (path: string, folder: string): boolean => !relative(folder, path).startsWith('..') && !isAbsolute(relative(folder, path));
  const others = removing ? EDITORS.filter((editor) => !inside(removing.extension, join(home, editor.folder)) && hasApostil(join(home, editor.folder, 'extensions'))) : [];
  if (others.length) say('kept', `The skills, the hooks, the Git exclude lines, the command and the Claude mod: ${others.map((editor) => editor.name).join(' and ')} still has Apostil.`);
  const shared = !others.length;

  // 1. The setup of every repo of the record and of the repo of this folder, then of the home folder: exactly the undo of setup and connect.
  const undo = (repo?: string): void => {
    try {
      lines.push(...setup({ install, machine, repo, undo: true, dryRun, store }).lines);
    } catch (error) {
      failed(repo ? short(repo, home) : 'The setup for all repos', error, `Run apostil setup ${repo ? '--undo in that repo' : '--all --undo'} again, or remove the skills and the hook by hand.`);
    }
  };
  const here = folder ? tryGit(folder, 'rev-parse', '--show-toplevel') : undefined;
  for (const repo of shared ? [...new Set([...setUpRepos(store), ...(here ? [here] : [])])] : []) {
    if (tryGit(repo, 'rev-parse', '--show-toplevel') !== undefined) undo(repo);
    else {
      say('skipped', `${short(repo, home)}: the folder is gone, or it is no Git repo any more.`);
      change(`The record of ${short(repo, home)}`, 'It does no harm.', () => recordRepo(store, repo, false));
    }
  }
  if (shared) undo();

  // 2. VS Code's storage of the extension (the avatars, for example), in VS Code and in each fork. An editor that removes the extension removes its own.
  const storages = (removing ? [] : editorUserFolders(home)).map((user) => join(user, 'globalStorage', EXTENSION_ID)).filter((one) => existsSync(one));
  for (const storage of storages) {
    const place = `VS Code's storage of Apostil in ${short(storage, home)}`;
    if (change(place, 'Remove the folder by hand.', () => rmSync(storage, { recursive: true, force: true }))) say('removed', place);
  }
  if (!removing && !storages.length) say('nothing', "VS Code's storage of Apostil: none found.");

  // 2b. The saved answers of the extension in VS Code's database. The editor does not clear them when it removes the extension, so this runs for an editor's cleanup too (for its own folders).
  if (!removing) removeSavedAnswers(home, [...editorUserFolders(home), ...serverUserFolders(home)], say, change, failed);
  else if (removing.editor) removeSavedAnswers(home, editorUserFolders(home, removing.editor), say, change, failed);

  // 3. The settings. In VS Code, its command takes them away through VS Code, which also reads a file with comments. An editor's cleanup: only its own.
  if (removing && !removing.editor) say('left', 'The settings: the editor that removes Apostil is not one that Apostil knows. Remove its settings that start with apostil. by hand.');
  else if (!inVsCode) removeSettings(home, editorUserFolders(home, removing?.editor), say, change);

  // 4. The Claude mod.
  if (shared) ok = removeMod(machine, dryRun, say, !!removing) && ok;

  // 5. The command apostil in each folder of the path: only a launcher or a link of Apostil. An editor's cleanup removes only one that points
  // into an Apostil folder of the extensions that it cleans; one for another editor or for a checkout stays.
  const real = (path: string): string => {
    try {
      return realpathSync(path);
    } catch {
      return path; // a folder of an older version that is gone already
    }
  };
  const ours = (command: string): boolean => (removing ? relative(real(dirname(removing.extension)), real(ownTarget(command) ?? '/')).split(sep)[0].toLowerCase().startsWith(`${EXTENSION_ID}-`) : isOwnLink(command));
  const commands = shared ? [...new Set(machine.path.split(delimiter).filter(Boolean).map((one) => join(resolve(one), 'apostil')))].filter(exists) : [];
  for (const command of commands) {
    if (!ours(command)) {
      say('left', `${short(command, home)}: it is not ${removing ? 'a launcher or link of this extension' : 'a launcher or link of Apostil'}, so it stays.`);
      continue;
    }
    const place = `The command ${short(command, home)}`;
    if (change(place, `Remove it by hand: rm ${command}`, () => unlinkSync(command))) say('removed', place);
  }
  if (shared && !commands.length) say('nothing', 'The command apostil: not on the path.');

  // 6. The extension, through the command of each editor that has it. With no command, the line says how in the editor. An editor's cleanup has none.
  if (!inVsCode && !removing) {
    let found = false;
    for (const editor of EDITORS) {
      const list = exitOf(machine, editor.command, ['--list-extensions'], 60_000);
      const has = list ? list.out.split('\n').some((id) => id.trim().toLowerCase() === EXTENSION_ID) : children(join(home, editor.folder, 'extensions')).some((name) => name.toLowerCase().startsWith(`${EXTENSION_ID}-`));
      if (!has) continue;
      found = true;
      const how = `In ${editor.name}, open Extensions, find Apostil and press Uninstall.`;
      if (!list) say('left', `The extension in ${editor.name}: the command ${editor.command} is not on the path. ${how}`);
      else if (dryRun || exitOf(machine, editor.command, ['--uninstall-extension', EXTENSION_ID], 60_000)?.status === 0) {
        // The editor only drops the extension from its list; its folder stays until the editor starts again, which may never happen now.
        if (!dryRun) {
          const extensions = join(home, editor.folder, 'extensions');
          for (const name of children(extensions).filter((one) => one.toLowerCase().startsWith(`${EXTENSION_ID}-`))) change(`The folder ${name}`, `Remove it by hand: rm -r ${join(extensions, name)}`, () => rmSync(join(extensions, name), { recursive: true, force: true }));
        }
        say('removed', `The extension in ${editor.name}, through ${editor.command} --uninstall-extension`);
      }
      else {
        ok = false;
        say('left', `The extension in ${editor.name}: ${editor.command} --uninstall-extension did not work. ${how}`);
      }
    }
    if (!found) say('nothing', 'The extension: no editor has it.');
  }

  // 7. The store: kept, unless deleteData. Only a folder with Apostil's own files goes, and never one that holds the home folder
  // (APOSTIL_HOME may name a folder with other files). After a real run the command is gone, so the line says how by hand.
  const byHand = `rm -r ${/[\s"'$\\]/.test(short(store, home)) ? JSON.stringify(store) : short(store, home)}`;
  const holdsHome = !relative(store, home).startsWith('..') && !isAbsolute(relative(store, home));
  const isStore = [STORE_FILE, RECORD_FILE].some((name) => existsSync(join(store, name)));
  if (!facts) say('nothing', `The store ${short(store, home)}: not there.`);
  else if (!deleteData || removing) say('kept', `The store ${facts}. ${dryRun ? 'apostil uninstall --delete-data removes it.' : `To delete it later: ${byHand}`}`);
  else if (holdsHome || !isStore) say('left', `The store ${facts}: ${holdsHome ? 'it holds the home folder' : `it holds neither ${STORE_FILE} nor ${RECORD_FILE}`}, so it stays.`);
  else if (change(`The store ${facts}`, `Delete it by hand: ${byHand}`, () => rmSync(store, { recursive: true, force: true }))) say('removed', `The store ${facts}`);
  return { lines, ok };
}
