// Small helpers that read facts from Git. Every part uses these, so no part calls git by itself.

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { diffLines } from './diff-lines';
import { isHeadLine, isNotebookPath, notebookCells, notebookText, readNotebook, type Cell, type NotebookCells } from './notebook';
import { textDiff } from './text-diff';

/**
 * Runs git in a folder and returns its output without the last line break. Throws when git fails.
 * File names come as they are, also with letters outside ASCII: without the setting, Git prints "docs/\345\233\276.md".
 */
export function git(folder: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: folder, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\n$/, '');
}

/** Like git(), but returns undefined when git fails. */
export function tryGit(folder: string, ...args: string[]): string | undefined {
  try {
    return git(folder, ...args);
  } catch {
    return undefined;
  }
}

export const repoRoot = (folder: string): string => git(folder, 'rev-parse', '--show-toplevel');

/** The commits of a range such as "base..head", from one call of git: how many, and when the first one was written (ISO). None when git fails. */
export function commitsOf(folder: string, range: string): { count: number; first?: string } {
  const dates = (tryGit(folder, 'log', '--format=%aI', range) ?? '').split('\n').filter(Boolean);
  return { count: dates.length, first: dates[dates.length - 1] };
}
export const headCommit = (folder: string): string => git(folder, 'rev-parse', 'HEAD');
export const currentBranch = (folder: string): string => git(folder, 'branch', '--show-current') || 'detached';
export const commitExists = (folder: string, commit: string): boolean => tryGit(folder, 'cat-file', '-e', `${commit}^{commit}`) !== undefined;

/**
 * The files of a repo as Git lists them: the files that it tracks, and the new files that it does not ignore.
 * So code that is not committed yet counts as code of the repo. Undefined when the folder is no Git repo.
 */
export function repoFiles(folder: string): string[] | undefined {
  const listed = tryGit(folder, 'ls-files', '--cached', '--others', '--exclude-standard');
  return listed === undefined ? undefined : [...new Set(listed.split('\n').filter(Boolean))];
}

/** The same id for every worktree of one repo: its first commit. */
export function repoId(folder: string): string {
  return git(folder, 'rev-list', '--max-parents=0', 'HEAD').split('\n').pop()!;
}

/** True when a local branch still holds this commit. */
export function branchHolds(folder: string, commit: string): boolean {
  return (tryGit(folder, 'branch', '--contains', commit, '--format=%(refname:short)') ?? '').trim().length > 0;
}

/**
 * The commit that a branch started from. Git records where a branch was created;
 * when that record is gone, the base is the point where the branch left the main branch.
 * Git drops old records after 90 days, so the oldest record counts only when it is the one of the creation.
 */
export function baseOf(folder: string, branch: string): string {
  const mains = mainBranches(folder);
  // The main branch is not one task: its change is only what is not committed yet.
  if (mains.includes(branch)) return headCommit(folder);
  const oldest = (tryGit(folder, 'reflog', 'show', '--format=%H %gs', branch) ?? '').split('\n').filter(Boolean).pop() ?? '';
  if (oldest.includes(' branch: Created from ')) return oldest.split(' ')[0];
  for (const main of mains.flatMap((name) => [`origin/${name}`, name])) {
    const base = tryGit(folder, 'merge-base', main, 'HEAD');
    if (base) return base;
  }
  return headCommit(folder);
}

/**
 * The branch that a change is compared with, when it is not a main branch (a branch on top of another one, as in a stack):
 * a local branch whose tip is the base, else the branch that the branch was created from. Undefined for a main branch or when Git does not say.
 */
export function baseBranchOf(folder: string, branch: string, base: string): string | undefined {
  const mains = mainBranches(folder);
  const isMain = (name: string) => mains.includes(name.replace(/^origin\//, ''));
  if (isMain(branch)) return undefined; // the main branch is compared with its own last commit
  const tips = (tryGit(folder, 'branch', '--points-at', base, '--format=%(refname:short)') ?? '').split('\n').filter((name) => name && name !== branch);
  if (tips.length) return tips.some(isMain) ? undefined : tips[0];
  const oldest = (tryGit(folder, 'reflog', 'show', '--format=%gs', branch) ?? '').split('\n').filter(Boolean).pop() ?? '';
  const from = /^branch: Created from (.+)$/.exec(oldest)?.[1];
  return from && from !== 'HEAD' && !isMain(from) ? from : undefined;
}

/** The names that the main branch can have: the default branch of the remote (some repos call it "trunk" or "develop"), then main and master. */
function mainBranches(folder: string): string[] {
  const remote = tryGit(folder, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')?.replace(/^origin\//, '');
  return [...new Set([remote, 'main', 'master'].filter((name): name is string => Boolean(name)))];
}

// A file counts as renamed only when three quarters of it are the same. With Git's own 50%, two generated files that only look alike count as one renamed file.
const RENAMED = '-M75%';

export interface ChangedFile {
  path: string; // for a renamed file, the new path
  added: number;
  removed: number;
  status: 'added' | 'changed' | 'removed';
  renamedFrom?: string; // the old path of a renamed file; its counts are only the lines that really changed
  binary?: true; // Git counts no lines in it
  notebook?: 'only-outputs' | 'not-read'; // a notebook in which only outputs or run counts changed; a .ipynb file that does not read as a notebook, shown as text
}

/** Reads the "-z" output of "git diff --name-status": a letter and a path; a rename or a copy has two paths. */
function readStatus(output: string): Map<string, { status: ChangedFile['status']; from?: string }> {
  const out = new Map<string, { status: ChangedFile['status']; from?: string }>();
  const words = output.split('\0').filter(Boolean);
  for (let at = 0; at < words.length;) {
    const letter = words[at][0];
    if (letter === 'R' || letter === 'C') {
      out.set(words[at + 2], { status: 'changed', ...(letter === 'R' ? { from: words[at + 1] } : {}) });
      at += 3;
    } else {
      out.set(words[at + 1], { status: letter === 'A' ? 'added' : letter === 'D' ? 'removed' : 'changed' });
      at += 2;
    }
  }
  return out;
}

/**
 * Every file that differs from the base: commits on the branch, edits that are not committed, and new files.
 * Git finds renames: a renamed file is one file with its new path and `renamedFrom`.
 * With `head`, only the commits from the base to that commit: a pull request that is not checked out.
 */
export function changedFiles(folder: string, base: string, head?: string): ChangedFile[] {
  const range = head ? [base, head] : [base];
  const status = readStatus(git(folder, 'diff', '--name-status', '-z', RENAMED, ...range));
  const files: ChangedFile[] = [];
  // With "-z", a counted line is "added<TAB>removed<TAB>path"; for a rename the path is empty and the old and new path follow.
  const words = git(folder, 'diff', '--numstat', '-z', RENAMED, ...range).split('\0');
  for (let at = 0; at < words.length; at++) {
    if (!words[at]) continue;
    const [added, removed, inline] = words[at].split('\t');
    const path = inline || words[(at += 2)];
    files.push({
      path, added: Number(added) || 0, removed: Number(removed) || 0, status: status.get(path)?.status ?? 'changed',
      ...(status.get(path)?.from ? { renamedFrom: status.get(path)!.from } : {}), ...(added === '-' ? { binary: true as const } : {}),
    });
  }
  if (!head) {
    for (const path of git(folder, 'ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)) {
      const bytes = fileBytes(folder, path);
      if (!bytes) continue; // a repo inside the repo, which Git lists as a folder
      const binary = isBinary(bytes);
      files.push({ path, added: binary ? 0 : lineCount(bytes.toString('utf8')), removed: 0, status: 'added', ...(binary ? { binary: true as const } : {}) });
    }
  }
  return files.map((file) => (isNotebookPath(file.path) && !file.binary ? notebookCounts(folder, base, file, head) : file));
}

/** A changed notebook counted by the lines of its cells: outputs, run counts and other data of a cell are not part of the change. */
function notebookCounts(folder: string, base: string, file: ChangedFile, head?: string): ChangedFile {
  const sides = notebookSides(folder, base, file.path, head, file.renamedFrom);
  if (!sides) return { ...file, notebook: 'not-read' };
  const lines = notebookDiff(sides, file.path).split('\n').filter((line) => /^[+-](?![+-]{2} )/.test(line) && !isHeadLine(line.slice(1)));
  const added = lines.filter((line) => line[0] === '+').length;
  const removed = lines.length - added;
  return { ...file, added, removed, ...(file.status === 'changed' && !added && !removed && !file.renamedFrom ? { notebook: 'only-outputs' as const } : {}) };
}

/** The cells of a notebook before and now (a side is empty when the file is not there), or undefined when a side that is there does not read as a notebook. */
export function notebookSides(folder: string, base: string, path: string, head?: string, renamedFrom?: string): { before: Cell[]; now: Cell[] } | undefined {
  const read = (text: string | undefined): Cell[] | undefined => (text === undefined ? [] : readNotebook(text));
  const before = read(rawFileText(folder, renamedFrom ?? path, base));
  const now = read(rawFileText(folder, path, head));
  return before && now ? { before, now } : undefined;
}

/** The diff of the texts of the cells of a notebook before and now, as Git writes a diff. */
function notebookDiff(sides: { before: Cell[]; now: Cell[] }, path: string): string {
  const [before, now] = [notebookText(sides.before), notebookText(sides.now)];
  const key = `${path}\0${before}\0${now}`;
  if (!diffs.has(key)) {
    if (diffs.size >= 50) diffs.delete(diffs.keys().next().value!);
    diffs.set(key, textDiff(before, now, path));
  }
  return diffs.get(key)!;
}

// The diffs of the texts of the cells, by their two texts: one page asks for the diff of a notebook more than once (its counts, its cells, its rows).
const diffs = new Map<string, string>();

/** A changed notebook by its cells: its cells before and now, and the heads of its cells with what the change did to each (shared/notebook.ts). Undefined when it does not read as a notebook. */
export function notebookChange(folder: string, base: string, file: Pick<ChangedFile, 'path' | 'renamedFrom' | 'notebook' | 'binary'>, head?: string): { sides: { before: Cell[]; now: Cell[] }; heads: NotebookCells } | undefined {
  const sides = isNotebookPath(file.path) && file.notebook !== 'not-read' && !file.binary ? notebookSides(folder, base, file.path, head, file.renamedFrom) : undefined;
  if (!sides) return undefined;
  const lines = diffLines(notebookDiff(sides, file.path));
  const of = (sign: string) => new Set(lines.filter((line) => line.sign === sign).map((line) => line.line));
  return { sides, heads: notebookCells(sides.before, sides.now, of('-'), of('+')) };
}

/** The path in the repo of a file that Git does not track, or undefined (a tracked file, a file outside the repo, or "-"). A draft file is no file of the change. */
export function untrackedInRepo(folder: string, file: string): string | undefined {
  if (file === '-' || !existsSync(file)) return undefined;
  const inside = relative(realpathSync(repoRoot(folder)), realpathSync(file));
  if (inside.startsWith('..') || isAbsolute(inside)) return undefined;
  return tryGit(folder, 'ls-files', '--error-unmatch', '--', inside) === undefined ? inside : undefined;
}

/** True for the bytes of a binary file: as Git decides, a zero byte in the first 8000 bytes. */
const isBinary = (bytes: Buffer): boolean => bytes.subarray(0, 8000).includes(0);

/** The mode of each changed file at the base and now: "100644", "100755" for a file that runs, "120000" for a link. */
export function fileModes(folder: string, base: string, head?: string): Map<string, { before: string; now: string }> {
  const out = new Map<string, { before: string; now: string }>();
  // With "-z", an entry is ":<old mode> <new mode> <old id> <new id> <letter>", then the path; a rename has two paths.
  const words = git(folder, 'diff', '--raw', '-z', RENAMED, base, ...(head ? [head] : [])).split('\0');
  for (let at = 0; at < words.length; at++) {
    if (!words[at].startsWith(':')) continue;
    const [before, now, , , letter] = words[at].slice(1).split(' ');
    at += /^[RC]/.test(letter) ? 2 : 1;
    out.set(words[at], { before, now });
  }
  return out;
}

/** What stands at a path of the folder: a file, a link or a folder. Undefined when nothing is there. A link is never followed. */
function kindAt(folder: string, path: string): 'file' | 'link' | 'folder' | undefined {
  try {
    const stat = lstatSync(join(folder, path));
    return stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'folder' : 'file';
  } catch {
    return undefined;
  }
}

/**
 * The bytes of a file in the folder, or at a commit. Undefined when it does not exist there, or is a folder.
 * A link gives the path that it points at, as Git keeps a link: its text is not read through the link.
 */
export function fileBytes(folder: string, path: string, commit?: string): Buffer | undefined {
  if (!commit) {
    const kind = kindAt(folder, path);
    return kind === 'link' ? Buffer.from(readlinkSync(join(folder, path))) : kind === 'file' ? readFileSync(join(folder, path)) : undefined;
  }
  try {
    return execFileSync('git', ['show', `${commit}:${path}`], { cwd: folder, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return undefined;
  }
}

/** Where a link points, in the folder or at a commit; undefined for a file that is not a link. */
export function linkTarget(folder: string, path: string, commit?: string): string | undefined {
  if (commit) return tryGit(folder, 'show', `${commit}:${path}`);
  return kindAt(folder, path) === 'link' ? readlinkSync(join(folder, path)) : undefined;
}

/** The text of a file in the folder as it is now, or at a commit, byte for byte. Undefined when the file does not exist there. A link gives the path that it points at. */
export function rawFileText(folder: string, path: string, commit?: string): string | undefined {
  if (commit) return tryGit(folder, 'show', `${commit}:${path}`);
  return fileBytes(folder, path)?.toString('utf8');
}

/**
 * The text of a file in the folder as it is now, or at a commit. Undefined when the file does not exist there.
 * A notebook that reads as one gives the text of its cells (shared/notebook.ts), so that its lines are the lines of its cells.
 */
export function fileText(folder: string, path: string, commit?: string): string | undefined {
  const text = rawFileText(folder, path, commit);
  if (text === undefined || !isNotebookPath(path)) return text;
  const cells = readNotebook(text);
  return cells ? notebookText(cells) : text;
}

/**
 * The diff of one file against the base, as text; with `head`, up to that commit. For a renamed file, give its old path as `renamedFrom`.
 * A notebook that reads as one on both sides gives the diff of the texts of its cells.
 */
export function fileDiff(folder: string, base: string, path: string, head?: string, renamedFrom?: string): string {
  const sides = isNotebookPath(path) ? notebookSides(folder, base, path, head, renamedFrom) : undefined;
  if (sides) return notebookDiff(sides, path);
  return git(folder, 'diff', RENAMED, base, ...(head ? [head] : []), '--', ...(renamedFrom ? [renamedFrom] : []), path);
}

export const lineCount = (text: string): number => (text.length === 0 ? 0 : text.replace(/\n$/, '').split('\n').length);
