// The rows of the list of changes and their heads: which agent session made each change. No `vscode` import.

import { changeRows, savedWords } from '../shared/change-rows';
import { baseOf, changedFiles, commitsOf, currentBranch, repoId, tryGit } from '../shared/git';
import type { Store } from '../shared/store';
import { agentOf, type PageAgent } from './page-data';

export interface ListRow {
  id?: number; // missing for the branch of the open folder when it has no change file
  branch: string;
  folder: string; // where Git is read for the row, which is also where the pull requests of the branch are asked for (the change's folder may be gone)
  age: string;
  savedAt: string; // ISO: the last save of the change; for the branch with no change file its last commit
  firstSavedAt?: string; // ISO: the first save of the change, missing in a change saved before the store kept it
  firstCommitAt?: string; // ISO: when the first commit of the branch was written
  commits: number;
  files: number;
  added: number;
  removed: number;
  phrase: string; // what the row says when no remark has a state to show
  open: boolean; // the branch that the open folder has checked out
  agent?: PageAgent;
  remarks: { sent: number; running: number; done: number };
  uncounted?: string; // the saved commit is not in this clone: one quiet line in place of the counts
}

/** Rows of one agent session under one head. A group with no agent has no head. */
export interface RowGroup {
  key: string;
  agent?: PageAgent;
  rows: ListRow[];
}

/** "4 days ago" */
export function ageOf(moment: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(moment)) / 60000));
  const [count, unit] = minutes < 1 ? [0, ''] : minutes < 60 ? [minutes, 'minute'] : minutes < 1440 ? [Math.round(minutes / 60), 'hour'] : [Math.round(minutes / 1440), 'day'];
  return count === 0 ? 'just now' : `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

/** Puts the remarks of a run that ended with no answer back to open. */
export function reopenStaleRuns(store: Store, changeId: number): void {
  for (const remark of store.staleRuns(changeId)) store.reopenRemark(remark.id);
}

const NO_REMARKS = { sent: 0, running: 0, done: 0 };

/** The rows of the list for a folder. The branch of the folder comes first when it has no change file. */
export function listRows(store: Store, folder: string): ListRow[] {
  if (!tryGit(folder, 'rev-parse', '--git-dir')) return [];
  const branch = currentBranch(folder);
  const rows: ListRow[] = changeRows(store, folder).map((row) => {
    const change = store.getChange(row.id);
    const remarks = { ...NO_REMARKS };
    for (const remark of store.remarks(row.id)) if (remark.state in remarks) remarks[remark.state as keyof typeof remarks]++;
    return {
      id: row.id, branch: row.branch, folder: row.readIn, age: ageOf(row.savedAt), savedAt: row.savedAt, firstSavedAt: row.firstSavedAt, firstCommitAt: row.firstCommitAt,
      commits: row.commits, files: row.files, added: row.added, removed: row.removed,
      open: row.branch === branch, agent: change?.agent && agentOf(change.agent), remarks, ...(row.saved?.missing ? { uncounted: savedWords(row.saved) } : {}),
      phrase: row.outOfDate ? 'out of date' : row.filesInNoPart ? `${row.filesInNoPart} file${row.filesInNoPart === 1 ? '' : 's'} in no part` : row.branch === branch ? 'open folder' : '',
    };
  });
  if (!store.findChange(repoId(folder), branch)) {
    const base = baseOf(folder, branch);
    const files = changedFiles(folder, base);
    const savedAt = tryGit(folder, 'log', '-1', '--format=%cI') ?? new Date().toISOString();
    const commits = commitsOf(folder, `${base}..HEAD`);
    rows.unshift({
      branch, folder, age: ageOf(savedAt), savedAt, firstCommitAt: commits.first, commits: commits.count, files: files.length,
      added: files.reduce((sum, file) => sum + file.added, 0), removed: files.reduce((sum, file) => sum + file.removed, 0),
      phrase: 'no change file', open: true, remarks: { ...NO_REMARKS },
    });
  }
  return rows;
}

/** Groups the rows by agent session, in the order of their newest row. Rows come newest first, and stay so in a group. */
export function sessionGroups(rows: ListRow[]): RowGroup[] {
  const groups = new Map<string, RowGroup>();
  rows.forEach((row, index) => {
    const session = row.agent && (row.agent.session ?? row.agent.hostSession);
    const key = row.agent && session ? `${row.agent.app}/${session}` : `row/${row.id ?? 'open'}/${index}`;
    if (!groups.has(key)) groups.set(key, { key, agent: row.agent, rows: [] });
    groups.get(key)!.rows.push(row);
  });
  return [...groups.values()];
}
