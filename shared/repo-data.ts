// Reads a file of the repo for a block of a look (shared/look.ts): only a file that Git lists, inside the repo, and no link that leads out of it.
// A data file is CSV, TSV or JSON: rows (a CSV or TSV file, or a JSON list of objects) or keys (a JSON object). The check of a look and the data of
// a block when its window or page opens (view/look-blocks.ts) both read through it, so they agree.

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { repoFiles } from './git';

/** Rows of a data file: the names of its columns in their order, and each row by column. */
export interface Rows {
  columns: string[];
  rows: Record<string, unknown>[];
}
/** What a data file holds: rows, or the keys of one object. */
export type RepoData = { rows: Rows; keys?: undefined } | { keys: Record<string, unknown>; rows?: undefined };

/** Why a file cannot be read: Git does not list it, it lies outside the repo, it is too large, it is no CSV, TSV or JSON file, or it does not read as its kind. */
export type ReadFault = 'unlisted' | 'outside' | 'large' | 'kind' | 'unread';

/** The files that Git lists in a folder, once for a whole look or page. */
export const listedFiles = (folder: string): Set<string> => new Set(repoFiles(folder) ?? []);

/** The text of a file of the repo, or why it cannot be read. `most` is the most bytes. */
export function readRepoText(folder: string, path: string, most: number, listed = listedFiles(folder)): { text: string } | { fault: ReadFault } {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) return { fault: 'outside' };
  if (!listed.has(path)) return { fault: 'unlisted' };
  try {
    const root = realpathSync(folder);
    const real = realpathSync(join(root, path)); // a link is followed: it must still end inside the repo
    if (!real.startsWith(root + sep)) return { fault: 'outside' };
    if (statSync(real).size > most) return { fault: 'large' };
    return { text: readFileSync(real, 'utf8') };
  } catch {
    return { fault: 'unlisted' }; // listed, but gone from the disk
  }
}

/** The fields of one line of CSV: a field in quotes may hold commas, line breaks and "" for a quote. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let at = 0; at < text.length; at++) {
    const c = text[at];
    if (quoted) {
      if (c === '"' && text[at + 1] === '"') { field += '"'; at++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"' && !field) quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[at + 1] === '\n') at++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((one) => one.some((cell) => cell.trim()));
}

/** Rows from lines of cells, the first line being the names of the columns. */
function fromCells(lines: string[][]): Rows {
  const [head = [], ...rest] = lines;
  const columns = head.map((name) => name.trim());
  return { columns, rows: rest.map((cells) => Object.fromEntries(columns.map((name, at) => [name, cells[at]?.trim() ?? '']))) };
}

/** Reads a data file of the repo by its ending, or says why it cannot. */
export function readRepoData(folder: string, path: string, most: number, listed?: Set<string>): { data: RepoData } | { fault: ReadFault } {
  const ending = /\.([a-z]+)$/i.exec(path ?? '')?.[1]?.toLowerCase();
  if (!ending || !['csv', 'tsv', 'json'].includes(ending)) return { fault: 'kind' };
  const read = readRepoText(folder, path, most, listed);
  if ('fault' in read) return read;
  if (ending === 'csv') return { data: { rows: fromCells(csvRows(read.text)) } };
  if (ending === 'tsv') return { data: { rows: fromCells(read.text.split(/\r?\n/).filter((line) => line.trim()).map((line) => line.split('\t'))) } };
  try {
    const value = JSON.parse(read.text);
    if (Array.isArray(value) && value.every((one) => one && typeof one === 'object' && !Array.isArray(one))) {
      return { data: { rows: { columns: [...new Set(value.flatMap((one) => Object.keys(one)))], rows: value } } };
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) return { data: { keys: value } };
    return { fault: 'unread' };
  } catch {
    return { fault: 'unread' };
  }
}
