// The tree "Files" in Apostil's side bar: the folders and files of the repo, from Git, as VS Code's own tree.
// A row that is a part of a diagram has an icon at its right that opens the graphs of that folder or file.
// The look of the repo changes only what a row of a tree has (files-follow.ts): folders left out or ordered, the icon of a file, quiet words after its name, its click.

import { join } from 'node:path';
import * as vscode from 'vscode';
import type { Store } from '../shared/store';
import { diagramPaths, inDiagrams, repoFiles } from './home-data';
import type { Target } from '../shared/look';
import { fileRow, graphsIconClick, treeChildren } from './files-follow';
import { idOf } from './home-data';
import { savedLook, type LookData } from './look-data';

/** A row is its repo path; a folder ends with "/". */
export class FilesTree implements vscode.TreeDataProvider<string> {
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private children = new Map<string, string[]>(); // the rows under each folder, "" for the root
  private inDiagram: string[] = []; // the paths that some diagram stands for
  private look?: LookData; // the look of the repo when one is saved, with the marks that stand
  private lookFolder = ''; // where the files of the look are kept
  private counts = new Map<string, number>(); // the number of files under each folder, for the look

  constructor(private store: Store, private openFolder: () => string) {}

  /** Reads the files and the diagrams again. */
  refresh(): void {
    this.children.clear();
    this.changed.fire();
  }

  private load(): void {
    const folder = this.openFolder();
    this.inDiagram = folder ? diagramPaths(this.store, folder) : [];
    this.loadLook(folder);
    const sets = new Map<string, Set<string>>();
    const add = (parent: string, row: string): void => {
      if (!sets.has(parent)) sets.set(parent, new Set());
      sets.get(parent)!.add(row);
    };
    for (const file of folder ? repoFiles(folder) : []) {
      const parts = file.split('/');
      parts.forEach((part, index) => add(parts.slice(0, index).map((name) => `${name}/`).join(''), parts.slice(0, index + 1).join('/') + (index < parts.length - 1 ? '/' : '')));
    }
    // Folders first, then files, each by name, as the Explorer does.
    const order = (a: string, b: string): number => Number(!a.endsWith('/')) - Number(!b.endsWith('/')) || a.localeCompare(b);
    for (const [parent, rows] of sets) this.children.set(parent, [...rows].sort(order));
  }

  getChildren(path = ''): string[] {
    if (!this.children.size) this.load();
    return treeChildren(this.children.get(path) ?? [], path, this.look, this.counts); // as they are, with no look
  }

  getParent(path: string): string | undefined {
    const parent = path.replace(/[^/]+\/?$/, '');
    return parent || undefined;
  }

  getTreeItem(path: string): vscode.TreeItem {
    const isFolder = path.endsWith('/');
    const uri = vscode.Uri.file(join(this.openFolder(), path));
    const item = new vscode.TreeItem(uri, isFolder ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    item.id = path;
    item.contextValue = inDiagrams(this.inDiagram, path) ? 'apostil.inDiagram' : 'apostil.file';
    if (!isFolder) item.command = { command: 'apostil.openFile', title: 'Open', arguments: [uri] }; // a file with notes opens in the file tab at once, with no moment in the editor first
    if (!isFolder) this.lookOn(item, path);
    return item;
  }

  // ----- the look of the repo -----

  /** Reads the look of the repo, when one is saved, and counts the files under each folder for it. */
  private loadLook(folder: string): void {
    const id = folder ? idOf(folder) : undefined;
    this.look = id ? savedLook(this.store, id, folder, true) : undefined;
    this.lookFolder = id ? this.store.lookFolder(id) : '';
    this.counts.clear();
    for (const file of this.look ? repoFiles(folder) : []) {
      const parts = file.split('/');
      for (let at = 1; at < parts.length; at++) { const under = `${parts.slice(0, at).join('/')}/`; this.counts.set(under, (this.counts.get(under) ?? 0) + 1); }
    }
  }

  /** What the look gives a file row: an icon of the look, quiet words after the name, and a click to a target of the look (`apostil.lookTarget` in extension.ts). */
  private lookOn(item: vscode.TreeItem, path: string): void {
    const look = fileRow(this.look, path);
    if (look.icon) item.iconPath = vscode.Uri.file(join(this.lookFolder, look.icon));
    if (look.words) item.description = look.words;
    if (look.click) item.command = { command: 'apostil.lookTarget', title: 'Open', arguments: [look.click] };
  }

  /** The target that the look gives a click on the graphs icon of a row, or undefined. */
  graphsIconClick(path: string): Target | undefined {
    if (!this.children.size) this.load();
    return graphsIconClick(this.look, path);
  }
}
