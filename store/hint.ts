// "apostil hint": what a SessionStart hook of Claude Code tells the agent at the start of each session in a repo with a map (a person adds the hook;
// apostil setup does not, see skills/README.md):
// which command of Apostil to use for what. Each word is paid in every call of the session, so it stays short. No `vscode` import.
// It reads the store and never writes it, never waits, and always ends with code 0. With the links and nudges off it says nothing.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { linksOn } from '../shared/apostil-link';
import { repoId } from '../shared/git';
import { count } from '../shared/map-read';
import { notedFileCount, type RepoMap } from '../shared/repo-map';
import { Store, storeFolder } from '../shared/store';

/** The text for a map, with its counts. A count of 0 is left out with its words. */
export function hintText(map: RepoMap): string {
  const files = notedFileCount(map);
  const processes = (map.processes ?? []).length;
  const counts = [
    files ? `notes on the code of ${count(files, 'file')}` : '',
    processes ? count(processes, 'process', 'processes') : '',
    map.diagrams.length ? count(map.diagrams.length, 'diagram') : '',
  ].filter(Boolean);
  const holds = counts.length > 1 ? `${counts.slice(0, -1).join(', ')} and ${counts.at(-1)}` : counts[0];
  return [
    `This repo has an Apostil map${holds ? `: ${holds}` : ''}. Use it before Grep, Glob or reading files:`,
    '- To understand how the repo is set up (its parts, where each lives, how they connect), run `apostil overview`.',
    '- To find the code for a task, run `apostil find "<words of the task>"`. It names files and lines, best first. Then read only those lines.',
    '- For more: `apostil notes <path> --text` (one file), `apostil process <id> --text` (one job of the code, step by step).',
    'If the map has no answer, search as usual. A note says what the code does; read the code before you change it.',
  ].join('\n');
}

/** The text for the repo of a folder, or undefined: no Git repo with a commit, no map of it in the store, or the links and nudges are off. */
export function hintFor(folder: string, store = storeFolder(), env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!linksOn(env, store) || !existsSync(join(store, 'apostil.sqlite'))) return undefined;
  try {
    const repo = repoId(folder);
    const read = new Store(store, true); // read only: it makes no file, and a store that is locked fails at once
    try {
      const stored = read.getMap(repo);
      return stored && hintText(stored.map);
    } finally {
      read.close();
    }
  } catch {
    return undefined;
  }
}

/** What `apostil hint` prints: the JSON that the SessionStart hook of Claude Code reads, or with --text the text alone; undefined for nothing. */
export function hintCommand(words: string[], folder: string): string | undefined {
  const text = hintFor(folder);
  if (!text) return undefined;
  return words.includes('--text') ? text : JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } });
}
