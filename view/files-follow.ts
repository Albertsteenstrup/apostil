// What the tree "Files" shows and marks when the map or the tab in front says so: the choice, with no call of VS Code. No `vscode` import.

import { relative, sep } from 'node:path';

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
