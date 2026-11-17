// The tree "Files" in Apostil's side bar: the folders and files of the repo, from Git, as VS Code's own tree.
// A row that is a part of a diagram has an icon at its right that opens the graphs of that folder or file.

import { join } from 'node:path';
import * as vscode from 'vscode';
import type { Store } from '../shared/store';
import { diagramPaths, inDiagrams, repoFiles } from './home-data';

/** A row is its repo path; a folder ends with "/". */
export class FilesTree implements vscode.TreeDataProvider<string> {
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private children = new Map<string, string[]>(); // the rows under each folder, "" for the root
  private inDiagram: string[] = []; // the paths that some diagram stands for

  constructor(private store: Store, private openFolder: () => string) {}

  /** Reads the files and the diagrams again. */
  refresh(): void {
    this.children.clear();
    this.changed.fire();
  }

  private load(): void {
    const folder = this.openFolder();
    this.inDiagram = folder ? diagramPaths(this.store, folder) : [];
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
    return this.children.get(path) ?? [];
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
    return item;
  }
}
