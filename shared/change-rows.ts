// The rows of the list of changes: one row for each stored change of a repo, with its size from Git.
// The sidebar of the view and the "apostil list" command both show these rows.

import { existsSync } from 'node:fs';
import { changedFiles, commitsOf, repoId, tryGit } from './git';
import type { Store, StoredChange } from './store';

export interface ChangeRow {
  id: number;
  branch: string;
  title: string;
  folder: string;
  savedAt: string;
  firstSavedAt?: string; // missing in a change saved before the store kept it
  firstCommitAt?: string; // when the first commit of the branch since its base was written
  commits: number; // commits on the branch since its base
  files: number;
  added: number; // total added lines
  removed: number; // total removed lines
  outOfDate: boolean; // the branch moved after the change file was saved
  filesInNoPart: number;
  openPoints: number;
}

/** The stored changes of the repo of a folder, the newest first. */
export function changeRows(store: Store, folder: string): ChangeRow[] {
  return store.listChanges(repoId(folder)).map((change) => rowOf(store, change, folder));
}

function rowOf(store: Store, change: StoredChange, openFolder: string): ChangeRow {
  // Read Git in the folder of the change when it still exists, else in the folder that is open.
  const here = existsSync(change.folder) ? change.folder : openFolder;
  const inOwnFolder = here === change.folder;
  const files = inOwnFolder ? changedFiles(here, change.base) : [];
  const head = tryGit(here, 'rev-parse', change.branch);
  const commits = commitsOf(here, `${change.base}..${head ?? change.head}`);
  return {
    id: change.id, branch: change.branch, title: change.file.title, folder: change.folder, savedAt: change.savedAt,
    ...(change.firstSavedAt ? { firstSavedAt: change.firstSavedAt } : {}), ...(commits.first ? { firstCommitAt: commits.first } : {}),
    commits: commits.count,
    files: files.length,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
    outOfDate: head !== undefined && head !== change.head,
    filesInNoPart: change.checks.filesInNoPart.length,
    openPoints: store.openPoints(change.id).length,
  };
}
