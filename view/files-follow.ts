// What the tree "Files" shows and marks when the map or the tab in front says so, and what the look of the repo gives its rows: the choice, with no
// call of VS Code. No `vscode` import.

import { relative, sep } from 'node:path';
import type { Target } from '../shared/look';
import type { LookData } from './look-data';

// The pick logic of the pages (the first part of media/marks.js), read in Node as store/look-changes.ts does.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Marks = require('../../view/media/marks.js');

/** One row that the tree brings into view: marked (`select`), and opened when it is a folder (`expand`). */
export interface TreeStep { path: string; select: boolean; expand: boolean }

/**
 * The tree follows the map: the folders and files of an area come into view, the first one marked, each folder open. The steps are in the order
 * in which the tree takes them: the last path first, so that the first one ends in view. Nothing while the tree is hidden, unless the click asks
 * to show it (`open`: an area with no diagram, a folder in its window). At most six paths, so that a wide area does not open the whole tree.
 */
export function treeSteps(paths: string[], visible: boolean, open: boolean): TreeStep[] {
  if (!visible && !open) return [];
  const shown = paths.slice(0, 6);
  return [...shown].reverse().map((path) => ({ path, select: path === shown[0], expand: path.endsWith('/') }));
}

/**
 * The tree marks the file of the tab in front, as the Explorer of VS Code does. The function that this gives takes the file of the tab in front
 * (none for a tab with no file) and gives back the row to mark, or undefined to leave the tree as it is: only when another file comes to the front
 * (or `again`: the tree shows again), so that a folder that he marked by hand or from the map stays marked while a tab with no file is in front;
 * only while the tree shows; and only a file of the open folder.
 */
export function rowOfFileInFront(): (file: string | undefined, folder: string, visible: boolean, again?: boolean) => string | undefined {
  let inFront = '';
  return (file, folder, visible, again = false) => {
    if (!again && (file ?? '') === inFront) return undefined;
    inFront = file ?? '';
    if (!visible || !file || !folder) return undefined;
    const path = relative(folder, file).split(sep).join('/');
    return path && !path.startsWith('..') ? path : undefined;
  };
}

// ----- the look of the repo on the rows of the tree (build 61): VS Code draws them, so a rule changes only what a row of a tree has -----

type Slots = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const nameOf = (path: string): string => path.replace(/\/$/, '').split('/').pop() ?? path;

/** The slots that the look gives a row: a folder row by its path and the count of files under it, a file row by its path and the marks at its lines. */
function rowSlots(look: LookData | undefined, path: string, files = 0): Slots {
  if (!look) return {};
  if (path.endsWith('/')) return Marks.resolve(look.rules, { kind: 'tree-folder', paths: [path], fields: { name: nameOf(path), path, files } }, look.one);
  const marks = look.marks.filter((mark) => mark.file === path);
  return Marks.resolve(look.rules, { kind: 'tree-file', paths: [path], marks, fields: { name: nameOf(path), path, marks: marks.length } }, look.one);
}

/**
 * The rows under a folder in the look: without the folders that a rule leaves out (with all under them), the folders in the order that a rule of the
 * folder itself gives ("order.by" a field, "down"; a rule of the kind alone also orders the top of the tree), then the files as before. `counts`: the
 * number of files under each folder.
 */
export function treeChildren(rows: string[], parent: string, look: LookData | undefined, counts: Map<string, number>): string[] {
  if (!look) return rows;
  const folders = rows.filter((row) => row.endsWith('/') && rowSlots(look, row, counts.get(row))['show.shown'] !== false);
  const order = parent ? rowSlots(look, parent, counts.get(parent)) : Marks.resolve(look.rules, { kind: 'tree-folder', paths: [], fields: {} }, look.one);
  const by = order['order.by'];
  const sorted = by
    ? Marks.orderRows(folders.map((row) => ({ id: row, fields: { name: nameOf(row), path: row, files: counts.get(row) ?? 0 } })), { by, down: order['order.down'] })[0].rows.map((one: { id: string }) => one.id)
    : folders;
  return [...sorted, ...rows.filter((row) => !row.endsWith('/'))];
}

/** What the look gives a file row: an icon of the look (its kept name) in place of the file icon, quiet words after its name, and a click. */
export function fileRow(look: LookData | undefined, path: string): { icon?: string; words?: string; click?: Target } {
  const own = rowSlots(look, path);
  const marks = look ? look.marks.filter((mark) => mark.file === path).length : 0;
  const words = own.content?.words;
  return { icon: own['text.icon'], words: words === undefined ? undefined : Marks.fillText(words, { name: nameOf(path), path, marks }), click: own.click };
}

/** The target of a click on the graphs icon of a row in the look, or undefined: then it opens the graphs as before. */
export const graphsIconClick = (look: LookData | undefined, path: string): Target | undefined =>
  (look ? Marks.resolve(look.rules, { kind: 'graphs-icon', paths: [path], fields: { path } }, look.one).click : undefined);
