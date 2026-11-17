// Reads the JSON that a command is given: a file, or "-" for standard input.

import { readFileSync, rmSync } from 'node:fs';
import { untrackedInRepo } from '../shared/git';

/** The JSON in a file, or on standard input when the path is "-". A bad file and bad input give the same plain problem. */
export function readJson(path: string): unknown {
  if (!path) throw new Error('Give a JSON file, or "-" to send the JSON on standard input.');
  if (path === '-' && process.stdin.isTTY) throw new Error('Nothing is sent on standard input. Send the JSON with a here-document.');
  const where = path === '-' ? 'Standard input' : `The file ${path}`;
  const text = readFileSync(path === '-' ? 0 : path, 'utf8');
  if (!text.trim()) throw new Error(`${where} is empty. It must hold the JSON.`);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${where} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Removes the draft file after a save worked, but only a file in the repo that Git does not track. Never a tracked file, a file outside the repo, or "-". */
function removeDraft(folder: string, file: string): boolean {
  if (untrackedInRepo(folder, file) === undefined) return false;
  rmSync(file);
  return true;
}

/** The output of a command that saved: with `draftRemoved: true` when the draft file was removed. */
export const afterSave = <T extends object>(result: T, folder: string, file: string): T | (T & { draftRemoved: true }) =>
  removeDraft(folder, file) ? { ...result, draftRemoved: true } : result;
