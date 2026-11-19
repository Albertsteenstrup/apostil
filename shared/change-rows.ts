// The rows of the list of changes: one row for each stored change of a repo, with its size from Git.
// The sidebar of the view and the "apostil list" command both show these rows.

import { existsSync } from 'node:fs';
import { changedFiles, commitExists, commitsOf, repoId, tryGit } from './git';
import type { Store, StoredChange } from './store';

export interface ChangeRow {
  id: number;
  branch: string;
  title: string;
  folder: string;
  savedAt: string;
  firstSavedAt?: string; // missing in a change of an older version
  firstCommitAt?: string; // when the first commit of the branch since its base was written
  commits: number; // commits on the branch since its base
  files: number;
  added: number; // total added lines
  removed: number; // total removed lines
  outOfDate: boolean; // the branch moved after the change file was saved
  filesInNoPart: number;
  openPoints: number;
  saved?: SavedAt; // the folder is not on the branch of the change: counts are those of the saved commit
}

/** The commit that a change was saved at, shown when the folder that Git is read in is on another branch, or the commit is not in this clone. */
export interface SavedAt {
  commit: string;
  on: string; // the branch that the folder is on
  missing: boolean; // the clone has no such commit (or no base): there are no counts
}

/** Where Git is read for a change: its own folder while it exists, else the open folder. `saved` is set when that folder is not on the branch of the change. */
export function changeWhere(change: StoredChange, openFolder: string): { folder: string; saved?: SavedAt } {
  const folder = existsSync(change.folder) && tryGit(change.folder, 'rev-parse', '--git-dir') ? change.folder : openFolder;
  const on = tryGit(folder, 'branch', '--show-current') || 'detached';
  if (on === change.branch) return { folder };
  return { folder, saved: { commit: change.head, on, missing: !commitExists(folder, change.head) || !commitExists(folder, change.base) } };
}

/** The quiet line of a change that is not checked out. */
export const savedWords = (saved: SavedAt): string => saved.missing
  ? `commit ${saved.commit.slice(0, 7)} is not in this clone, so there are no counts; this folder is on ${saved.on}`
  : `as saved at commit ${saved.commit.slice(0, 7)}; this folder is on ${saved.on}`;

/** The stored changes of the repo of a folder, the newest first. */
export function changeRows(store: Store, folder: string): ChangeRow[] {
  return store.listChanges(repoId(folder)).map((change) => rowOf(store, change, folder));
}

function rowOf(store: Store, change: StoredChange, openFolder: string): ChangeRow {
  const { folder: here, saved } = changeWhere(change, openFolder);
  const head = saved ? change.head : tryGit(here, 'rev-parse', change.branch);
  const files = saved?.missing ? [] : changedFiles(here, change.base, saved && change.head);
  const commits: { count: number; first?: string } = saved?.missing ? { count: 0 } : commitsOf(here, `${change.base}..${head ?? change.head}`);
  return {
    id: change.id, branch: change.branch, title: change.file.title, folder: change.folder, savedAt: change.savedAt,
    ...(change.firstSavedAt ? { firstSavedAt: change.firstSavedAt } : {}), ...(commits.first ? { firstCommitAt: commits.first } : {}),
    commits: commits.count,
    files: files.length,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
    outOfDate: !saved && head !== undefined && head !== change.head,
    filesInNoPart: change.checks.filesInNoPart.length,
    openPoints: store.openPoints(change.id).length,
    ...(saved ? { saved } : {}),
  };
}
