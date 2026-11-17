// The material for the map writer: the folders of the repo, the diagrams that exist, and the stored map.

import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { diagramTitles } from '../shared/context';
import { fileText, lineCount, repoFiles, repoId } from '../shared/git';
import type { StoredMap, Store } from '../shared/store';

const DEPTH = 2; // folders this many levels down
const LARGEST = 3; // files listed for each folder
const ROOT_FILES = 40;

export interface FolderFacts {
  path: string; // ends with "/"
  files: number; // all files below it
  largest: { path: string; lines: number }[];
}

const sizeOf = (folder: string, path: string): number => {
  try {
    return lstatSync(join(folder, path)).size; // a link counts as itself, never as the folder that it points at
  } catch {
    return 0; // listed by Git but deleted
  }
};

/** The folders two levels deep, each with its count of files and its largest files. Git lists the files, so ignored files stay out. */
export function folderFacts(folder: string): { rootFiles: string[]; folders: FolderFacts[] } {
  const files = (repoFiles(folder) ?? []).filter((path) => sizeOf(folder, path) > 0);
  const inFolder = new Map<string, string[]>();
  for (const path of files) {
    const parts = path.split('/').slice(0, -1);
    for (let depth = 1; depth <= Math.min(DEPTH, parts.length); depth++) {
      const key = `${parts.slice(0, depth).join('/')}/`;
      inFolder.set(key, [...(inFolder.get(key) ?? []), path]);
    }
  }
  const folders = [...inFolder].sort(([a], [b]) => a.localeCompare(b)).map(([path, paths]) => ({
    path, files: paths.length,
    largest: paths.sort((a, b) => sizeOf(folder, b) - sizeOf(folder, a)).slice(0, LARGEST)
      .map((largest) => ({ path: largest, lines: lineCount(fileText(folder, largest) ?? '') })),
  }));
  return { rootFiles: files.filter((path) => !path.includes('/')).slice(0, ROOT_FILES), folders };
}

/** The stored map as a writer reads it: the kept text of the lines of the notes is for Apostil, and the notes of files and the processes are for their own writers, so they stay out. */
export const mapForWriters = (stored: StoredMap) => ({ ...stored, map: { ...stored.map, noteCode: undefined, fileNotes: undefined, noNotes: undefined, processes: undefined, handoffs: undefined, notInProcess: undefined } });

/** What a map writer needs: the folders, the diagrams that exist already with their titles, and the stored map. */
export function mapMaterial(store: Store, folder: string) {
  const stored = store.getMap(repoId(folder));
  return { ...folderFacts(folder), diagrams: diagramTitles(store, folder), map: stored ? mapForWriters(stored) : null };
}
