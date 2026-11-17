// The notes of Apostil beside the code in the editor of VS Code: the title of each note as quiet text at the end of its first line, the whole note under the pointer,
// a thin teal line at the left of the lines of the note under the pointer, and a count in the status bar. Nothing here takes the keyboard.
// A file can have 40 notes and more, a step inside its function: one title on a line (the narrowest note's), and one marked note at a time, keep the editor calm.
// The stable interface of VS Code has no view beside the lines of its own editor; these marks are what it gives.
// A notebook in the notebook editor of VS Code gets the same marks in the editors of its cells: each cell is a text editor of its own.
// Nothing here starts a kernel, runs a cell or changes a notebook: it reads the text of the cells only.

import { dirname, relative, sep } from 'node:path';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { findTests } from '../shared/find-tests';
import { tryGit } from '../shared/git';
import { cellsOfText, isNotebookPath, notebookText, readNotebook, type Cell } from '../shared/notebook';
import { codeFromGit, fromWords, notesInRepo, type NoteHere, type NotesOfFile, type OldCode } from '../shared/notes-beside-code';
import type { Store } from '../shared/store';
import { notesAtLine, titledNotes } from './note-lines';

/** The setting "apostil.notesBesideCode": in the editor of VS Code, in the file tab of Apostil, or off. */
export type NotesWay = 'editor' | 'tab' | 'off';
export const notesWay = (): NotesWay => vscode.workspace.getConfiguration('apostil').get<NotesWay>('notesBesideCode', 'tab');

/** The way for one file. A notebook has the way "editor" also when the setting is "tab": the file tab of Apostil cannot run a cell, so it does not take the place of the notebook editor. */
const wayOf = (uri: vscode.Uri): NotesWay => (notesWay() === 'tab' && isNotebookPath(uri.fsPath) ? 'editor' : notesWay());

/** What the editor shows of the notes of one file: for the checks only. */
export interface NotesShown {
  notes: { title: string; lines: [number, number]; titleLine?: number; change: string }[]; // titleLine: none when a narrower note has its title on that line
  hidden: boolean;
  marked?: [number, number]; // the lines with the mark of the note under the pointer
  cells?: Record<number, { title: string; lines: [number, number]; titleLine?: number }[]>; // a notebook: what the editor of each cell shows, by cell number, its lines counted inside the cell
}

const CELL_SCHEME = 'vscode-notebook-cell';

/** The notebook and the number of the cell (from 1) of the editor of a cell of the notebook editor, or undefined for any other document. */
function cellOf(document: vscode.TextDocument): { notebook: vscode.NotebookDocument; number: number } | undefined {
  if (document.uri.scheme !== CELL_SCHEME) return undefined;
  for (const notebook of vscode.workspace.notebookDocuments) {
    const index = notebook.getCells().findIndex((cell) => cell.document === document);
    if (index >= 0) return { notebook, number: index + 1 };
  }
  return undefined;
}

/** The text of the cells of a notebook that is open, as Apostil reads a notebook file (shared/notebook.ts), with the lines that are not saved yet. */
function openNotebookText(notebook: vscode.NotebookDocument): string {
  const cells: Cell[] = notebook.getCells().map((cell) => {
    const text = cell.document.getText().replace(/\r\n/g, '\n');
    const id = (cell.metadata as { id?: unknown }).id;
    return { kind: cell.kind === vscode.NotebookCellKind.Markup ? 'text' : 'code', ...(typeof id === 'string' && id ? { id } : {}), lines: text === '' ? [] : text.replace(/\n$/, '').split('\n') };
  });
  return notebookText(cells);
}

interface Repo { root: string; id: string; oldCode: OldCode }
interface Found { version: number; generation: number; path: string; root: string; result: NotesOfFile; text?: string } // text: of a notebook, whose version does not always move (a revert)

const FILE_TAB = 'apostil.file';
const TITLE_MAX = 60; // a longer title is cut; the pointer shows the whole note
/** Text as Markdown that shows it as it is. VS Code's own appendText also escapes "_", and its hover then shows the backslash. */
const plain = (text: string): string => text.replace(/[\\`*[\]<>#|]/g, (sign) => `\\${sign}`);
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;
const short = (title: string): string => (title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1).trimEnd()}…` : title);

/** The uri of the file of a tab: a text editor, or the file tab of Apostil. */
/** The file of a tab: of an editor, a notebook, or a file tab of Apostil. Undefined for any other tab. */
export function fileOfTab(tab: vscode.Tab | undefined): vscode.Uri | undefined {
  if (tab?.input instanceof vscode.TabInputText) return tab.input.uri;
  if (tab?.input instanceof vscode.TabInputNotebook) return tab.input.uri;
  if (tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === FILE_TAB) return tab.input.uri;
  return undefined;
}

/** Closes the tab that a file left, when VS Code did not put the new one in its place already. */
async function closeTab(tab: vscode.Tab): Promise<void> {
  try { await vscode.window.tabGroups.close(tab, true); } catch { /* the tab is gone already */ }
}

export class NotesBesideCode {
  private repos = new Map<string, Repo | undefined>(); // by folder of a file
  private found = new Map<string, Found>(); // by uri
  private generation = 0; // goes up when the store changes, so that the notes are found again
  private hidden = new Set<string>(); // the tabs whose notes are hidden, by uri
  private plain = new Set<string>(); // with the way "tab": the files that he switched to the editor, by uri
  private following = new Map<string, number>(); // the editors that change to the file tab now, by uri, with the line that the file tab got
  private pointed?: { document: string; lines: [number, number] }; // the note under the pointer: the uri of its document, and its lines there (counted from 1)
  private timer?: NodeJS.Timeout;
  private status = vscode.window.createStatusBarItem('apostil.notes', vscode.StatusBarAlignment.Right, 100);
  // The mark of the note under the pointer only: with a note on every few lines, a mark on all of them would mark the whole file.
  private lineMark = vscode.window.createTextEditorDecorationType({
    isWholeLine: true, borderStyle: 'solid', borderWidth: '0 0 0 2px', borderColor: new vscode.ThemeColor('apostil.noteLine'),
  });
  // A quiet title: text in a quiet colour, with no box, so that 40 titles in a file do not stand out from the code.
  private titleMark = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor('apostil.noteTitle'), margin: '0 0 0 3ch' },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  shown = new Map<string, NotesShown>(); // what each editor shows, by repo path: for the checks
  statusText = ''; // what the status bar says now: for the checks

  constructor(private store: Store, private openFileTab: (uri: vscode.Uri, lines?: [number, number]) => Promise<void>, private showLines: (uri: vscode.Uri, lines: [number, number]) => void) {
    this.status.name = 'Apostil notes';
    this.status.command = 'apostil.toggleNotes';
  }

  /** Registers the events, the hover and the commands. */
  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      this.status, this.lineMark, this.titleMark,
      vscode.commands.registerCommand('apostil.toggleNotes', (uri?: string, line?: number) => this.toggle(uri, line)),
      vscode.commands.registerCommand('apostil.openFile', (uri: vscode.Uri, line?: number) => this.open(uri, line)),
      vscode.commands.registerCommand('apostil.openNoteInTab', (uri: string, lines: [number, number]) => this.openFileTab(vscode.Uri.parse(uri), lines)),
      vscode.languages.registerHoverProvider([{ scheme: 'file' }, { scheme: CELL_SCHEME }], { provideHover: (document, position) => this.hover(document, position) }),
      vscode.workspace.onDidChangeNotebookDocument((event) => {
        if (vscode.window.visibleNotebookEditors.some((editor) => editor.notebook === event.notebook)) this.later();
      }),
      vscode.window.onDidChangeVisibleNotebookEditors(() => this.refresh()),
      vscode.window.onDidChangeActiveNotebookEditor(() => this.refresh()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refresh()),
      vscode.window.onDidChangeActiveTextEditor((editor) => { if (editor) void this.openInTab(editor); this.refresh(); }),
      vscode.window.onDidChangeTextEditorSelection((event) => this.follow(event.textEditor)),
      vscode.window.tabGroups.onDidChangeTabs((event) => { this.forgetClosed(event.closed); this.showStatus(); }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (this.pointed?.document === event.document.uri.toString()) this.pointed = undefined; // its lines may have moved
        if (vscode.window.visibleTextEditors.some((editor) => editor.document === event.document)) this.later();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => { if (event.affectsConfiguration('apostil.notesBesideCode')) this.refresh(); }),
    );
    const first = vscode.window.activeTextEditor;
    if (first) void this.openInTab(first);
    this.refresh();
  }

  /** The store changed: the notes are found again. */
  storeChanged(): void {
    this.generation++;
    this.refresh();
  }

  /** Draws the notes in every visible editor, and the count in the status bar. */
  refresh(): void {
    clearTimeout(this.timer);
    for (const shown of this.shown.values()) delete shown.cells; // the cells of a notebook are drawn again below; a cell that is gone keeps nothing
    for (const editor of vscode.window.visibleTextEditors) this.draw(editor);
    this.showStatus();
  }

  /** After typing: draws again when he stops for a moment. */
  private later(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), 250);
  }

  /** The Git repo of a file, read once for each folder. */
  private repoOf(uri: vscode.Uri): Repo | undefined {
    const folder = dirname(uri.fsPath);
    if (!this.repos.has(folder)) {
      const root = tryGit(folder, 'rev-parse', '--show-toplevel');
      const id = root && tryGit(root, 'rev-list', '--max-parents=0', 'HEAD')?.split('\n').pop();
      this.repos.set(folder, root && id ? { root, id, oldCode: codeFromGit(root) } : undefined);
    }
    return this.repos.get(folder);
  }

  /** The notes of a file: from its text in the editor (also lines that are not saved), else from the file. Undefined for a file outside a Git repo. */
  notesOf(uri: vscode.Uri): (Found & { uri: string }) | undefined {
    if (uri.scheme !== 'file') return undefined;
    const repo = this.repoOf(uri);
    if (!repo) return undefined;
    const notebook = isNotebookPath(uri.fsPath) ? vscode.workspace.notebookDocuments.find((one) => one.uri.toString() === uri.toString()) : undefined;
    const document = notebook ? undefined : vscode.workspace.textDocuments.find((one) => one.uri.toString() === uri.toString());
    const version = notebook?.version ?? document?.version ?? -1;
    const key = uri.toString();
    const known = this.found.get(key);
    const notebookNow = notebook && openNotebookText(notebook);
    if (known && known.version === version && known.generation === this.generation && version !== -1 && known.text === notebookNow) return { ...known, uri: key };
    const path = relative(repo.root, uri.fsPath).split(sep).join('/');
    let text: string;
    try {
      // A notebook is read as the text of its cells, from the notebook editor when it is open there, else from the file.
      text = notebookNow ? notebookNow : notebook ? '' : document?.getText() ?? readFileSync(uri.fsPath, 'utf8');
      const cells = !notebook && !document && isNotebookPath(uri.fsPath) ? readNotebook(text) : undefined;
      if (cells) text = notebookText(cells);
    } catch { return undefined; }
    let result: NotesOfFile;
    try { result = notesInRepo(this.store, repo.root, path, text, repo.id, repo.oldCode); } catch { return undefined; }
    const found: Found = { version, generation: this.generation, path, root: repo.root, result, ...(notebookNow !== undefined ? { text: notebookNow } : {}) };
    this.found.set(key, found);
    return { ...found, uri: key };
  }

  /** True when the notes of this editor's file are drawn: the way "editor", and not hidden in this tab. */
  private drawn(uri: vscode.Uri): boolean {
    return wayOf(uri) === 'editor' && !this.hidden.has(uri.toString());
  }

  /** Draws the notes of one editor, or takes them away. */
  private draw(editor: vscode.TextEditor): void {
    const cell = cellOf(editor.document);
    if (cell) return this.drawCell(editor, cell.notebook, cell.number);
    const found = this.notesOf(editor.document.uri);
    const notes = found && this.drawn(editor.document.uri) ? found.result.notes : [];
    const document = editor.document;
    const titled = titledNotes(notes);
    const marked = this.markOf(editor, notes.length > 0);
    editor.setDecorations(this.titleMark, notes.filter((note) => titled.has(note) && note.lines[0] <= document.lineCount).map((note) => {
      const end = document.lineAt(note.lines[0] - 1).range.end;
      return { range: new vscode.Range(end, end), renderOptions: { after: { contentText: short(note.note.title) } } };
    }));
    if (found) {
      this.shown.set(found.path, {
        notes: notes.map((note) => ({ title: note.note.title, lines: note.lines, ...(titled.has(note) ? { titleLine: note.lines[0] } : {}), change: note.change.title })),
        hidden: this.hidden.has(found.uri), ...(marked ? { marked } : {}),
      });
    }
  }

  /** Draws the mark of the note under the pointer in one editor, when it is there and its notes are drawn; returns its lines there. */
  private markOf(editor: vscode.TextEditor, drawn: boolean): [number, number] | undefined {
    const lines = drawn && this.pointed?.document === editor.document.uri.toString() ? this.pointed.lines : undefined;
    editor.setDecorations(this.lineMark, lines ? [new vscode.Range(lines[0] - 1, 0, lines[1] - 1, 0)] : []);
    return lines;
  }

  /**
   * Draws the notes of a notebook in the editor of one of its cells: the same marks as in a code file, on the lines of the notes inside this cell.
   * The notes are found in the text of all the cells, so a note of one cell stands in that cell; the title of a note stands on a line of its cell.
   */
  private drawCell(editor: vscode.TextEditor, notebook: vscode.NotebookDocument, number: number): void {
    const found = this.notesOf(notebook.uri);
    const all = found && this.drawn(notebook.uri) ? found.result.notes : [];
    const text = all.length ? openNotebookText(notebook).split('\n') : [];
    const place = cellsOfText(text)[number - 1];
    const titledAll = titledNotes(all);
    const here = place ? all.map((note) => ({ note, first: Math.max(note.lines[0], place.at + 1) - place.at, last: Math.min(note.lines[1], place.at + place.length) - place.at }))
      .filter((one) => one.first <= one.last) : [];
    const document = editor.document;
    this.markOf(editor, here.length > 0);
    // A title stands on the first line of its note, so in the cell where the note starts.
    const titled = here.filter((one) => titledAll.has(one.note) && one.note.lines[0] - place!.at === one.first && one.first <= document.lineCount);
    editor.setDecorations(this.titleMark, titled.map((one) => {
      const end = document.lineAt(one.first - 1).range.end;
      return { range: new vscode.Range(end, end), renderOptions: { after: { contentText: short(one.note.note.title) } } };
    }));
    if (!found) return;
    const shown = this.shown.get(found.path);
    const cells = { ...(shown?.cells ?? {}), [number]: here.map((one) => ({ title: one.note.note.title, lines: [one.first, one.last] as [number, number], ...(titled.includes(one) ? { titleLine: one.first } : {}) })) };
    this.shown.set(found.path, {
      notes: all.map((note) => ({ title: note.note.title, lines: note.lines, ...(titledAll.has(note) ? { titleLine: note.lines[0] } : {}), change: note.change.title })), hidden: this.hidden.has(found.uri), cells,
    });
  }

  /** The count of the file in front, in the status bar: "4 notes", "4 notes hidden", and "1 older than the code". Nothing for a file with no notes. */
  private showStatus(): void {
    const uri = fileOfTab(vscode.window.tabGroups.activeTabGroup.activeTab);
    const found = uri && notesWay() !== 'off' ? this.notesOf(uri) : undefined;
    const count = found?.result.notes.length ?? 0;
    const older = found?.result.older ?? 0;
    const inTab = vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputCustom;
    const hidden = !!uri && !inTab && (wayOf(uri) === 'tab' || this.hidden.has(uri.toString()));
    const words = [
      ...(count ? [`${plural(count, 'note')}${hidden ? ' hidden' : ''}`] : []),
      ...(older ? [count ? `${older} older than the code` : `${plural(older, 'note')} older than the code`] : []),
    ];
    this.statusText = words.join(' · ');
    this.status.text = this.statusText;
    this.status.tooltip = count ? `${hidden ? 'Show' : 'Hide'} the notes of this tab (${process.platform === 'darwin' ? 'Cmd' : 'Ctrl'}+Shift+,)` : 'The code under these notes changed after they were written.';
    if (words.length) this.status.show(); else this.status.hide();
    void vscode.commands.executeCommand('setContext', 'apostil.notesHere', count > 0);
  }

  /**
   * The key and the click on the count. In the editor: hides the notes of this tab or shows them again. With the way "tab": the editor goes back to the file tab of Apostil.
   * In the file tab of Apostil: the file opens in the editor, with no notes, and the keyboard in it. "Edit" in the file tab names its file (`uri`) and the line to open at.
   */
  private async toggle(fileUri?: string, line?: number): Promise<void> {
    const named = fileUri ? vscode.window.tabGroups.all.flatMap((group) => group.tabs).find((one) => one.input instanceof vscode.TabInputCustom && one.input.uri.toString() === fileUri) : undefined;
    const tab = named ?? vscode.window.tabGroups.activeTabGroup.activeTab;
    const uri = fileOfTab(tab);
    const way = uri ? wayOf(uri) : notesWay();
    if (!tab || !uri || way === 'off') return;
    const key = uri.toString();
    if (tab.input instanceof vscode.TabInputCustom) {
      (way === 'tab' ? this.plain : this.hidden).add(key);
      const at = line ? new vscode.Range(line - 1, 0, line - 1, 0) : undefined;
      await vscode.commands.executeCommand('vscode.openWith', uri, 'default', { viewColumn: tab.group.viewColumn, preview: tab.isPreview, selection: at });
      await closeTab(tab);
      const editor = vscode.window.activeTextEditor;
      if (at && editor?.document.uri.toString() === key) {
        editor.selection = new vscode.Selection(at.start, at.start);
        editor.revealRange(at, vscode.TextEditorRevealType.AtTop);
      }
    } else if (way === 'tab') {
      this.plain.delete(key);
      const line = vscode.window.activeTextEditor?.document.uri.toString() === key ? vscode.window.activeTextEditor.selection.active.line + 1 : undefined;
      await this.switchToTab(tab, uri, line ? [line, line] : undefined); // the file tab shows the line that he was on
    } else {
      if (!this.hidden.delete(key)) this.hidden.add(key);
    }
    this.refresh();
  }

  /**
   * Opens a file from a place of Apostil (the tree "Files", the map on Home), with `line` at that line (a step of a process). With the way "tab", a file that has notes opens in the file tab at once:
   * the editor does not show for a moment first. Any other file, one that he switched to the editor, and one with edits that are not saved open the normal way.
   */
  async open(uri: vscode.Uri, line?: number): Promise<void> {
    const key = uri.toString();
    const dirty = vscode.workspace.textDocuments.some((one) => one.uri.toString() === key && one.isDirty);
    const inTab = wayOf(uri) === 'tab' && !this.plain.has(key) && !dirty && !!this.notesOf(uri)?.result.notes.length;
    if (inTab && line) await this.openFileTab(uri, [line, line]);
    else if (inTab) await vscode.commands.executeCommand('vscode.openWith', uri, FILE_TAB, { preview: true });
    else await vscode.commands.executeCommand('vscode.open', uri, line ? { selection: new vscode.Range(line - 1, 0, line - 1, 0) } : undefined);
  }

  /** With the way "tab": a file that has notes and opens the normal way (the Explorer, Go to File, a search result) changes to the file tab of Apostil by itself, unless he switched it to the editor or has edits that are not saved. */
  private async openInTab(editor: vscode.TextEditor): Promise<void> {
    const uri = editor.document.uri;
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (wayOf(uri) !== 'tab' || this.plain.has(uri.toString()) || editor.document.isDirty) return;
    if (!(tab?.input instanceof vscode.TabInputText) || tab.input.uri.toString() !== uri.toString()) return;
    if (!this.notesOf(uri)?.result.notes.length) return;
    // The file tab opens at the line that the editor was opened at: a search result, "Go to Definition", a line after the name in Quick Open.
    // VS Code can tell the place of the cursor a moment after it tells the new editor. No wait for it: the file tab opens at the line known now,
    // and a place that comes while the editor still stands goes on to the file tab (follow).
    const line = editor.selection.active.line + 1;
    this.following.set(uri.toString(), line);
    await this.switchToTab(tab, uri, line > 1 ? [line, line] : undefined);
    this.following.delete(uri.toString()); // the editor is closed: what VS Code told of its cursor before that has arrived
  }

  /** The cursor of an editor that changes to the file tab now moved: the file tab shows that line. */
  private follow(editor: vscode.TextEditor): void {
    const key = editor.document.uri.toString();
    const line = editor.selection.active.line + 1;
    if (!this.following.has(key) || this.following.get(key) === line) return;
    this.following.set(key, line);
    this.showLines(editor.document.uri, [line, line]);
  }

  private async switchToTab(tab: vscode.Tab, uri: vscode.Uri, lines?: [number, number]): Promise<void> {
    if (lines) await this.openFileTab(uri, lines);
    else await vscode.commands.executeCommand('vscode.openWith', uri, FILE_TAB, { viewColumn: tab.group.viewColumn, preview: tab.isPreview });
    await closeTab(tab);
  }

  /** A closed tab forgets that its notes were hidden: the next time the file opens, it opens with its notes. */
  private forgetClosed(closed: readonly vscode.Tab[]): void {
    const open = new Set(vscode.window.tabGroups.all.flatMap((group) => group.tabs).map((tab) => fileOfTab(tab)?.toString()));
    for (const tab of closed) {
      const key = fileOfTab(tab)?.toString();
      if (key && !open.has(key)) {
        this.hidden.delete(key);
        this.plain.delete(key);
      }
    }
  }

  /**
   * The pointer on a line of a note, or on its title: the whole note, with the function and its tests, the change it came from, and a link to the file tab.
   * In a step inside its function that is the step, and on the first line of a function also the function. Its lines get the mark at the left.
   */
  private hover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    // In a cell of a notebook the line counts in the text of all its cells.
    const cell = cellOf(document);
    const uri = cell?.notebook.uri ?? document.uri;
    if (!this.drawn(uri)) return undefined;
    const found = this.notesOf(uri);
    const place = cell && cellsOfText(openNotebookText(cell.notebook))[cell.number - 1];
    if (cell && !place) return undefined;
    const line = position.line + 1 + (place?.at ?? 0);
    const here = found ? notesAtLine(found.result.notes, line) : [];
    this.point(document, here[0] && place ? [Math.max(here[0].lines[0] - place.at, 1), Math.min(here[0].lines[1] - place.at, place.length)] : here[0]?.lines);
    if (!found || !here.length) return undefined;
    return new vscode.Hover(here.map((note) => this.noteText(note, found.root, found.uri, place && cell ? `cell ${cell.number}, ` : '', place?.at ?? 0)));
  }

  /** The note under the pointer is the one with the mark at the left of its lines (`lines` in this document), or none. */
  private point(document: vscode.TextDocument, lines: [number, number] | undefined): void {
    const pointed = lines && { document: document.uri.toString(), lines };
    if (JSON.stringify(pointed) === JSON.stringify(this.pointed)) return;
    this.pointed = pointed;
    for (const editor of vscode.window.visibleTextEditors) if (editor.document === document) this.draw(editor);
  }

  /** The whole note in words. In a cell of a notebook, `cell` names the cell and `at` is its head line, so that the lines count inside the cell. */
  private noteText(here: NoteHere, root: string, uri: string, cell = '', at = 0): vscode.MarkdownString {
    const { note, change } = here;
    const lines = [here.lines[0] - at, here.lines[1] - at];
    const text = new vscode.MarkdownString();
    text.isTrusted = { enabledCommands: ['apostil.openNoteInTab'] };
    const tests = note.symbol ? findTests(root, note.symbol).length : 0;
    text.appendMarkdown([
      `**${plain(note.title)}**`,
      ...(note.text ? [plain(note.text)] : []),
      ...(note.symbol ? [`${plain(note.symbol)} · ${tests ? plural(tests, 'test') : 'no tests found'}`] : []),
      ...(note.tests?.length ? [`Linked tests: ${plain(note.tests.join(', '))}`] : []),
      plain(`${fromWords(change)}, ${cell}${lines[0] === lines[1] ? `line ${lines[0]}` : `lines ${lines[0]}–${lines[1]}`}.`),
    ].join('\n\n'));
    const args = encodeURIComponent(JSON.stringify([uri, here.lines]));
    text.appendMarkdown(`\n\n[Open in the file tab of Apostil](command:apostil.openNoteInTab?${args})`);
    return text;
  }
}
