// The record of the repos where "apostil setup" or "apostil connect" wrote: a small list of folders in the store.
// "apostil uninstall" undoes each of them, and "apostil doctor" shows them.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The file of the record in the store. */
export const RECORD_FILE = 'repos-set-up.json';
const recordFile = (store: string): string => join(store, RECORD_FILE);

/** The folders in the record of a store; none when there is no record. */
export function setUpRepos(store: string): string[] {
  try {
    const list = JSON.parse(readFileSync(recordFile(store), 'utf8'));
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** Adds a folder to the record, or with `added` false takes it out. A record that becomes empty is removed. */
export function recordRepo(store: string, folder: string, added = true): void {
  const before = setUpRepos(store);
  const after = added ? [...new Set([...before, folder])].sort() : before.filter((item) => item !== folder);
  if (after.join('\n') === before.join('\n')) return;
  if (!after.length) {
    if (existsSync(recordFile(store))) rmSync(recordFile(store));
    return;
  }
  mkdirSync(store, { recursive: true });
  writeFileSync(recordFile(store), `${JSON.stringify(after, null, 1)}\n`);
}
