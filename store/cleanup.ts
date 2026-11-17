// The cleanup: marks changes whose folder and commits are gone, and removes them after 7 days. Their notes stay, to stand beside the code while it is the same.

import { existsSync } from 'node:fs';
import { branchHolds } from '../shared/git';
import type { Store, StoredChange } from '../shared/store';

const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export interface CleanupResult {
  marked: number[];
  cleared: number[];
  removed: number[];
}

/** True when the folder of a change is gone and no branch holds its head commit. */
function isMissing(store: Store, change: StoredChange): boolean {
  if (existsSync(change.folder)) return false;
  // Ask Git in the folder of another change of the same repo.
  const other = store.allChanges().find((candidate) => candidate.repoId === change.repoId && candidate.id !== change.id && existsSync(candidate.folder));
  return !other || !branchHolds(other.folder, change.head);
}

/** Marks, clears and removes missing changes. Returns the ids it touched. */
export function cleanup(store: Store, now: Date): CleanupResult {
  const result: CleanupResult = { marked: [], cleared: [], removed: [] };
  for (const change of store.allChanges()) {
    if (!isMissing(store, change)) {
      if (change.missingSince) {
        store.markMissing(change.id, undefined);
        result.cleared.push(change.id);
      }
    } else if (!change.missingSince) {
      store.markMissing(change.id, now.toISOString());
      result.marked.push(change.id);
    } else if (now.getTime() - new Date(change.missingSince).getTime() >= KEEP_MS) {
      store.keepNotes(change);
      store.removeChange(change.id);
      result.removed.push(change.id);
    }
  }
  return result;
}
