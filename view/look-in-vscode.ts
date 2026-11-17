// The look of a repo in VS Code's own editor and frame (build 62): the icon of a mark in the margin of an editor and of each side of a diff, notes,
// steps and processes in the search with #, the right-click entries and keys with the actions of the look, and the list "Look" in the side bar.
// Each part is off until a rule of the look turns it on; with no look VS Code is as it was. The rules are in look-of-vscode.ts. Nothing here adds
// words to code, a tint, a hover, the status bar, the scroll bar or symbols of a file. An entry, a key and a row only carry out a target of the one
// list, through answerTarget(), which asks before a web address or a prompt.

import { join, relative, sep } from 'node:path';
import * as vscode from 'vscode';
import type { LookAction, Target } from '../shared/look';
import type { NoteHere } from '../shared/notes-beside-code';
import type { Store } from '../shared/store';
import { idOf } from './home-data';
import { lookData, standingMarks, type ValueLook } from './look-data';
import {
  actionRows, answersFor, ENTRIES, firstPageOf, keyOf, letterIcon, fileKeys, lineFacts, lookKeys, lookRows, marginMarks, marksIn, noteOnHome, notedFiles, placesOf, processOfStep,
  searchAnswers, stepsByKey, vscodeLook, type Answer, type LineFacts, type LookRow, type MarkAt, type StepRef, type VsCodeLook,
} from './look-of-vscode';
import { answerTarget, type TargetPlaces } from './look-targets';
import { fileOfTab } from './notes-beside-code';

const SIDES = ['file', 'apostil-base', 'git']; // a plain editor and the sides of a diff: the file, Apostil's text of the base, and Git's
const KINDS: Record<Answer['of'], vscode.SymbolKind> = { note: vscode.SymbolKind.String, step: vscode.SymbolKind.Event, process: vscode.SymbolKind.Module };

export class LookInVsCode implements vscode.TreeDataProvider<LookRow> {
  private look: VsCodeLook = { rules: [], actions: [], pages: [] };
  private signature = '';
  private values: Record<string, ValueLook> = {};
  private sets: { id: string; name: string }[] = [];
  private steps = new Map<string, StepRef>();
  private keys: Record<string, boolean> = {};
  private answers?: Answer[]; // every answer of the search with #, kept until the store changes
  private icons = new Map<string, vscode.TextEditorDecorationType>(); // the margin: one kind of decoration for each icon
  private placed = new Map<string, { version: number; marks: MarkAt[] }>(); // the marks of a document placed on its text, by uri
  private timer?: NodeJS.Timeout;
  private open = new Set<string>(); // the groups of the list whose rest is open
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private store: Store, private openFolder: () => string, private places: TargetPlaces, private notesOf: (uri: vscode.Uri) => NoteHere[] | undefined) {}

  register(context: vscode.ExtensionContext): void {
    const command = (name: string, run: (arg?: unknown) => unknown) => vscode.commands.registerCommand(name, run);
    context.subscriptions.push(
      { dispose: () => { for (const type of this.icons.values()) type.dispose(); } },
      vscode.window.createTreeView('apostil.look', { treeDataProvider: this }),
      vscode.languages.registerWorkspaceSymbolProvider({ provideWorkspaceSymbols: (query) => this.symbols(query) }),
      command('apostil.openNoteOnHome', (arg) => this.openNoteOnHome(arg)),
      command('apostil.showProcessOfLine', (arg) => this.showProcessOfLine(arg)),
      command('apostil.showPlacesOfMark', (arg) => this.showPlacesOfMark(arg)),
      command('apostil.lookActions', () => this.showActions()),
      ...Array.from({ length: 9 }, (_, at) => command(`apostil.lookAction${at + 1}`, () => this.runAction(at))),
      command('apostil.lookPlaces', (key) => this.showPlaces([String(key)])), // a row of a value in the list "Look"
      command('apostil.lookMore', (group) => { this.open.add(String(group)); this.changed.fire(); }),
      vscode.window.onDidChangeVisibleTextEditors(() => this.drawMargins()),
      vscode.window.onDidChangeActiveTextEditor(() => this.fileChanged()),
      vscode.workspace.onDidChangeTextDocument((event) => { if (vscode.window.visibleTextEditors.some((editor) => editor.document === event.document)) this.later(); }),
    );
    this.storeChanged();
  }

  /** The store changed: the look and the map are read again when they are new, and the search reads the notes again. */
  storeChanged(): void {
    this.answers = undefined;
    const repo = idOf(this.openFolder());
    const signature = JSON.stringify([repo, repo && this.store.getLook(repo)?.savedAt, repo && this.store.getMap(repo)?.savedAt]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.look = vscodeLook(this.store, repo);
      const data = repo ? lookData(this.store, repo, this.openFolder(), (file) => file, false) : undefined;
      this.values = data?.values ?? {};
      this.sets = data?.sets.map(({ id, name }) => ({ id, name })) ?? [];
      this.steps = stepsByKey(this.look.map?.processes ?? []);
      for (const type of this.icons.values()) type.dispose();
      this.icons.clear();
      this.placed.clear();
      this.setKeys(lookKeys(this.look.rules, this.look.actions.length, this.look.pages.length > 0));
    }
    this.drawMargins();
    this.fileChanged();
    this.changed.fire();
  }

  /** The first page of the look and its pages, for the start step (home-when-empty.ts). */
  firstPage(): { first?: Target; pages: { id: string; title: string }[] } {
    const first = firstPageOf(this.look.rules);
    return { ...(first ? { first } : {}), pages: this.look.pages };
  }

  // ----- A. the margin -----

  /** After typing: the marks follow when he stops for a moment, as the notes do. */
  private later(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.drawMargins(); this.fileChanged(); }, 250);
  }

  private marginOn(): boolean {
    return this.look.rules.some((rule) => rule.pick.kind === 'margin');
  }

  /** The repo path of the file of an editor, or of one side of a diff; undefined for a file outside the open folder. */
  private pathOf(uri: vscode.Uri): string | undefined {
    const root = this.openFolder();
    const inRoot = (path: string): string | undefined => { const rel = relative(root, path); return root && !rel.startsWith('..') && rel ? rel.split(sep).join('/') : undefined; };
    try {
      if (uri.scheme === 'file') return inRoot(uri.fsPath);
      if (uri.scheme === 'apostil-base') return JSON.parse(uri.query).folder === root ? uri.path.slice(1) : undefined;
      if (uri.scheme === 'git') return inRoot(JSON.parse(uri.query).path);
    } catch { /* a query that is not ours */ }
    return undefined;
  }

  /** The kind of decoration of the icon of a value: its kept icon, or a round chip with its first letter. */
  private iconOf(key: string): vscode.TextEditorDecorationType {
    let type = this.icons.get(key);
    if (!type) {
      const value = this.values[key];
      const icon = value?.icon ?? letterIcon(value?.name ?? key.split(':')[1] ?? '?');
      type = vscode.window.createTextEditorDecorationType({ gutterIconPath: vscode.Uri.parse(icon), gutterIconSize: 'contain' });
      this.icons.set(key, type);
    }
    return type;
  }

  private drawMargins(): void {
    for (const editor of vscode.window.visibleTextEditors) this.drawMargin(editor);
  }

  /** The icons of the marks in the margin of one editor, each at the line of its text there; nothing in a notebook cell or with no rule. */
  private drawMargin(editor: vscode.TextEditor): void {
    const { uri } = editor.document;
    if (!SIDES.includes(uri.scheme)) return;
    const path = this.marginOn() ? this.pathOf(uri) : undefined;
    const shown = path ? marginMarks(this.look.rules, this.look.map?.marks ?? [], path, editor.document.getText().split('\n'), this.sets.map((set) => set.id)) : [];
    const byKey = new Map<string, vscode.Range[]>();
    for (const { line, key } of shown) byKey.set(key, [...(byKey.get(key) ?? []), new vscode.Range(line - 1, 0, line - 1, 0)]);
    for (const key of byKey.keys()) this.iconOf(key);
    for (const [key, type] of this.icons) editor.setDecorations(type, byKey.get(key) ?? []);
  }

  // ----- the line under the cursor: what the entries need -----

  /** The marks of the file of a document that stand at the text of their lines there, for the entries; kept for each version of the text. */
  private marksOf(document: vscode.TextDocument): MarkAt[] {
    const key = document.uri.toString();
    const known = this.placed.get(key);
    if (known?.version === document.version) return known.marks;
    const path = this.pathOf(document.uri);
    const marks = path ? marksIn(this.look.map?.marks ?? [], path, document.getText().split('\n')) : [];
    this.placed.set(key, { version: document.version, marks });
    return marks;
  }

  /** What a line of a file has: its note, its steps and its marks. A file tab reads its file from disk. */
  private factsAt(uri: vscode.Uri, line: number): LineFacts {
    const document = vscode.workspace.textDocuments.find((one) => one.uri.toString() === uri.toString());
    const path = this.pathOf(uri);
    const marks = document ? this.marksOf(document) : path ? standingMarks(this.openFolder(), (this.look.map?.marks ?? []).filter((mark) => mark.file === path)) : [];
    return lineFacts(line, this.notesOf(uri) ?? [], this.steps, marks);
  }

  /** The file in front changed: the context keys of what it has (a note, a step, a mark), only while the look turns on an entry or a key that needs one. */
  private fileChanged(): void {
    const needed = ENTRIES.some((entry) => entry !== 'actions' && this.keys[`apostil.lookEntry.${entry}`]);
    const document = needed ? vscode.window.activeTextEditor?.document : undefined;
    const file = document?.uri.scheme === 'file' ? document : undefined;
    this.setKeys(fileKeys(file && this.notesOf(file.uri), this.steps, file && this.marksOf(file)));
  }

  private setKeys(keys: Record<string, boolean>): void {
    for (const [key, value] of Object.entries(keys)) {
      if ((this.keys[key] ?? false) === value) continue; // a key that was never set is off already
      this.keys[key] = value;
      void vscode.commands.executeCommand('setContext', key, value);
    }
  }

  /**
   * The file and the line that an entry or a key acts on: the line of a right-click in the file tab of Apostil (its menu sends it), else the line of
   * the cursor of the editor in front.
   */
  private lineHere(arg: unknown): { uri: vscode.Uri; line: number } | undefined {
    const line = (arg as { line?: unknown } | undefined)?.line;
    const tab = fileOfTab(vscode.window.tabGroups.activeTabGroup.activeTab);
    if (typeof line === 'number' && tab) return { uri: tab, line };
    const editor = vscode.window.activeTextEditor;
    return editor && editor.document.uri.scheme === 'file' ? { uri: editor.document.uri, line: editor.selection.active.line + 1 } : undefined;
  }

  /** Says in one short line that the line has nothing for this entry; nothing else happens. */
  private nothing(words: string): void {
    void vscode.window.showInformationMessage(words);
  }

  // ----- C. the four entries and the actions -----

  private openNoteOnHome(arg?: unknown): void {
    const here = this.lineHere(arg);
    const note = here && this.factsAt(here.uri, here.line).note;
    if (!note) return this.nothing('This line has no note.');
    const target = noteOnHome(note, this.steps, this.look.map);
    if (!target) return this.nothing('No diagram of the map holds this note.');
    void answerTarget(target, this.places);
  }

  private async showProcessOfLine(arg?: unknown): Promise<void> {
    const here = this.lineHere(arg);
    const steps = here ? this.factsAt(here.uri, here.line).steps : [];
    if (!steps.length) return this.nothing('No process has a step at this line.');
    const step = steps.length === 1 ? steps[0] : (await vscode.window.showQuickPick(
      steps.map((one) => ({ label: one.process.title, description: `step ${one.index + 1} of ${one.process.steps.length}`, step: one })), { title: 'The processes of this line' }))?.step;
    if (step) void answerTarget(processOfStep(step), this.places);
  }

  private showPlacesOfMark(arg?: unknown): void {
    const here = this.lineHere(arg);
    const marks = here ? this.factsAt(here.uri, here.line).marks : [];
    if (!marks.length) return this.nothing('This line has no mark.');
    void this.showPlaces([...new Set(marks.map(keyOf))]);
  }

  /** The places of the values of a mark: the file, the line and the text of the line; a pick opens the place. One list for an entry and a row. */
  private async showPlaces(keys: string[]): Promise<void> {
    type Item = vscode.QuickPickItem & { place?: Target };
    const items: Item[] = keys.flatMap((key) => {
      const rows: Item[] = placesOf(this.openFolder(), this.look.map?.marks ?? [], key).map((place) => ({ label: place.file, description: `line ${place.line}`, detail: place.text, place: { file: place.file, line: place.line } }));
      return keys.length > 1 ? [{ label: this.values[key]?.name ?? key, kind: vscode.QuickPickItemKind.Separator }, ...rows] : rows;
    });
    const name = keys.length === 1 ? this.values[keys[0]]?.name ?? keys[0] : 'the marks of this line';
    const picked = await vscode.window.showQuickPick(items, { title: `The places of ${name}`, matchOnDescription: true, matchOnDetail: true });
    if (picked?.place) void answerTarget(picked.place, this.places);
  }

  /** "Actions of the Look…": the actions of the look, each with what it does and its key; a pick carries out its target. */
  private async showActions(): Promise<void> {
    if (!this.look.actions.length) return this.nothing('The look of this repo has no actions.');
    const rows = actionRows(this.look.actions, this.keys, process.platform === 'darwin');
    const picked = await vscode.window.showQuickPick(rows, { title: 'Actions of the look of the repo', matchOnDetail: true });
    if (picked) this.carryOut(picked.action);
  }

  private runAction(at: number): void {
    const action = this.look.actions[at];
    if (!action) return this.nothing(`The look of this repo has no action ${at + 1}.`);
    this.carryOut(action);
  }

  private carryOut(action: LookAction): void {
    void answerTarget(action.target, this.places);
  }

  // ----- B. the search with # -----

  /** The answers of the search with # for the words that he typed: none with no rule. The list of all is made once until the store changes. */
  private symbols(query: string): vscode.SymbolInformation[] {
    if (!this.look.rules.some((rule) => rule.pick.kind === 'symbol-search')) return [];
    const root = this.openFolder();
    if (!this.answers) {
      const repo = idOf(root);
      const notes = repo ? notedFiles(this.store, repo).map((path) => ({ path, notes: this.notesOf(vscode.Uri.file(join(root, path))) ?? [] })) : [];
      this.answers = searchAnswers(this.look.rules, notes, this.look.map?.processes ?? []);
    }
    return answersFor(this.answers, query).map((answer) => new vscode.SymbolInformation(answer.title, KINDS[answer.of], answer.where,
      new vscode.Location(vscode.Uri.file(join(root, answer.file)), new vscode.Position(answer.line - 1, 0))));
  }

  // ----- F. the list "Look" -----

  getChildren(row?: LookRow): LookRow[] {
    if (row) return row.rows ?? [];
    const root = this.openFolder();
    const marks = standingMarks(root, this.look.map?.marks ?? []);
    return lookRows({ rules: this.look.rules, sets: this.sets, values: this.values, marks, pages: this.look.pages, open: this.open });
  }

  getTreeItem(row: LookRow): vscode.TreeItem {
    const item = new vscode.TreeItem(row.label, row.rows ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    item.id = row.id;
    if (row.quiet) item.description = row.quiet;
    if (row.icon) item.iconPath = vscode.Uri.parse(this.values[row.icon]?.icon ?? letterIcon(this.values[row.icon]?.name ?? row.label));
    if (row.places) item.command = { command: 'apostil.lookPlaces', title: 'Show its places', arguments: [row.places] };
    if (row.target) item.command = { command: 'apostil.lookTarget', title: 'Open', arguments: [row.target] };
    if (row.more) item.command = { command: 'apostil.lookMore', title: 'Show the rest', arguments: [row.more] };
    return item;
  }
}
