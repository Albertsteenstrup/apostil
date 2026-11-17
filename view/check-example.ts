// Makes the made-up example of the checks: a small library app with one change, as a Git repo in a folder.
// The files are in view/check-example/: before/ holds every file of the commit on "main", after/ the files that the
// branch adds or changes, removed.json the files that it removes, and change-file.json the description of the change.
// The same files give the same commits: the names and the dates of the commits are fixed.
// Usage: node out/view/check-example.js [<empty or new folder>]   (default: a new temporary folder). Prints where it made the repo.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tempFolder } from '../shared/test-repo';

/** The files of the example, in Git. */
export const EXAMPLE_FILES = resolve(__dirname, '../../view/check-example');
export const EXAMPLE_CHANGE_FILE = join(EXAMPLE_FILES, 'change-file.json');
export const EXAMPLE_BRANCH = 'book-holds';

export interface CheckExample {
  folder: string; // the repo, on the branch of the change
  base: string; // the commit on "main" with the files before the change
  head: string; // the commit of the change
  changeFile: string;
  remove(): void; // removes the repo, and its temporary folder when it made one
}

/** The made-up writer of both commits, with fixed dates, so that the same files give the same commits. */
const commitEnv = (date: string): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_AUTHOR_NAME: 'Made-up writer', GIT_AUTHOR_EMAIL: 'writer@example.org', GIT_AUTHOR_DATE: date,
  GIT_COMMITTER_NAME: 'Made-up writer', GIT_COMMITTER_EMAIL: 'writer@example.org', GIT_COMMITTER_DATE: date,
});

/** Makes the repo: the files before the change on "main", then the branch with the change, checked out. */
export function makeCheckExample(folder?: string): CheckExample {
  const target = folder ? resolve(folder) : join(tempFolder('apostil-check-'), 'library-app');
  if (existsSync(target) && readdirSync(target).length) throw new Error(`${target} is not empty. Give an empty or a new folder.`);
  mkdirSync(target, { recursive: true });
  const git = (date: string, ...args: string[]): string =>
    execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd: target, encoding: 'utf8', env: commitEnv(date), stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const BEFORE = '2026-03-01T09:00:00+00:00';
  const AFTER = '2026-03-02T16:30:00+00:00';

  git(BEFORE, 'init', '-q', '-b', 'main');
  cpSync(join(EXAMPLE_FILES, 'before'), target, { recursive: true });
  git(BEFORE, 'add', '-A');
  git(BEFORE, 'commit', '-q', '-m', 'The files before the change');
  const base = git(BEFORE, 'rev-parse', 'HEAD');

  git(AFTER, 'checkout', '-q', '-b', EXAMPLE_BRANCH);
  for (const path of JSON.parse(readFileSync(join(EXAMPLE_FILES, 'removed.json'), 'utf8')) as string[]) rmSync(join(target, path));
  cpSync(join(EXAMPLE_FILES, 'after'), target, { recursive: true });
  git(AFTER, 'add', '-A');
  git(AFTER, 'commit', '-q', '-m', 'Adds holds for books that are out');
  const head = git(AFTER, 'rev-parse', 'HEAD');

  const made = folder ? target : dirname(target);
  return { folder: target, base, head, changeFile: EXAMPLE_CHANGE_FILE, remove: () => rmSync(made, { recursive: true, force: true }) };
}

/** The made-up marks and look of the example: marks.json (drafts of add-marks), look.json (a draft of set-look), and the icons and the film that they name. */
export const EXAMPLE_LOOK = join(EXAMPLE_FILES, 'look');

/**
 * Puts the icons and the film of the made-up look into the top folder of the example repo, under the names that a writer gives them
 * ("apostil-icon-<value>.svg" for add-marks, "apostil-look-<name>" for set-look). A save removes the files that it took; `clean` removes the rest.
 */
export function putLookFiles(folder: string): { clean(): void } {
  const made: string[] = [];
  for (const name of readdirSync(EXAMPLE_LOOK).filter((one) => !one.endsWith('.json'))) {
    const short = name.replace(/^(icon|film)-/, '');
    for (const target of [`apostil-icon-${short}`, `apostil-look-${short}`]) {
      cpSync(join(EXAMPLE_LOOK, name), join(folder, target));
      made.push(target);
    }
  }
  return { clean: () => made.forEach((target) => rmSync(join(folder, target), { force: true })) };
}

if (require.main === module) {
  const example = makeCheckExample(process.argv[2]);
  console.log(JSON.stringify({ folder: example.folder, branch: EXAMPLE_BRANCH, base: example.base, head: example.head, changeFile: example.changeFile }, null, 2));
}
