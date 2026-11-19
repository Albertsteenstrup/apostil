// Starts the extension: registers the list of changes, the page, the commands, and keeps the store current.

import { statSync, unwatchFile, watchFile } from 'node:fs';
import { join, relative, sep } from 'node:path';
import * as vscode from 'vscode';
import { changeOfFolder } from '../shared/context';
import { Store, storeFolder, type AppState } from '../shared/store';
import { cleanup } from '../store/cleanup';
import { registerLookChoice } from '../theme/choose-look';
import { agentsNeedSetup, ChangeList, repoPullsLater } from './change-list';
import { pullBadge } from '../shared/pull-requests';
import type { RepoPulls } from '../shared/repo-pulls';
import { installedApps } from '../shared/agents';
import { BaseText, ChangePage, mentionIn, type NewRemark, type RemarkAction } from './change-page';
import { registerFirstStart } from './first-start';
import { registerReportIssue } from './report-issue';
import { rowOfFileInFront, treeSteps } from './files-follow';
import { FilesTree } from './files-tree';
import { idOf } from './home-data';
import { HomePages } from './home-page';
import { fileIcons } from './icon-theme';
import { lookPages } from './look-blocks';
import { answerTarget, type TargetPlaces } from './look-targets';
import { LookInVsCode } from './look-in-vscode';
import { askOnceInNewRepo } from './new-repo-question';
import { registerLinks } from './link-handler';
import { fileOfTab, NotesBesideCode } from './notes-beside-code';
import { registerHomeWhenEmpty } from './home-when-empty';
import { githubRepoOf, parsePullRef, pullLink } from '../shared/read-pull-request';
import { SortAndFilter } from './sort-filter-pick';
import { TrailRules, WindowTrail, type Step } from './trail';
import { registerUninstall } from './uninstall-in-vscode';
import type { Target } from '../shared/look';

let store: Store | undefined;
const TREE_SHOWS_MS = 300; // how long the tree "Files" shows before it marks the file in front
// The store files that the watcher looks at. SQLite writes to the "-wal" file first; a folder watch on macOS misses those writes.
const storeFiles = (): string[] => ['apostil.sqlite', 'apostil.sqlite-wal'].map((name) => join(storeFolder(), name));

export function activate(context: vscode.ExtensionContext) {
  const media = vscode.Uri.joinPath(context.extensionUri, 'view', 'media');
  const openFolder = (): string => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const theStore = (store = new Store(storeFolder()));
  cleanup(theStore, new Date()); // changes whose folder and commits are gone leave the store after 7 days
  registerLookChoice(context);
  registerUninstall(context);
  const firstStart = registerFirstStart(context);
  context.subscriptions.push(registerReportIssue(context));

  // What the agent can ask for: the open change, the view and what is selected, kept in the store.
  let state: AppState = {};
  const setState = (change: Partial<AppState>): void => {
    state = { ...state, ...change, folder: openFolder() };
    theStore.setAppState(state);
  };
  const inFolder = (uri: vscode.Uri): string | undefined => {
    const path = relative(openFolder(), uri.fsPath);
    return uri.scheme === 'file' && openFolder() && !path.startsWith('..') ? path : undefined;
  };
  const openFiles = (): string[] => vscode.window.tabGroups.all.flatMap((group) => group.tabs)
    .map((tab) => (tab.input instanceof vscode.TabInputText ? inFolder(tab.input.uri) : undefined)).filter((path): path is string => !!path);

  const folderChange = (): number | undefined => {
    try { return changeOfFolder(theStore, openFolder())?.id; } catch { return undefined; }
  };
  const apps = installedApps(); // the apps are looked for once, at the start
  // The path that he followed: one for the window. A step opens in its own tab; each change of the path goes to every tab.
  const openStep = (step: Step): void => {
    if (step.tab === 'home') home.openHome({ diagram: step.diagram, lit: step.lit ?? [] });
    else if (step.tab === 'graphs') home.openGraphs(step.path);
    else if (step.tab === 'pull') page.openPull(step.link, Number(step.link.split('/').pop()));
    else if (step.tab === 'page') home.openPage(step.page);
    else page.openAt(step.change, step.go);
  };
  const trail = new WindowTrail(openStep, (steps) => { home.postTrail(steps); page.postTrail(steps); });
  const page = new ChangePage(media, theStore, openFolder, setState, apps, folderChange);
  page.trail = trail;
  const home = new HomePages(media, theStore, openFolder, apps, trail);
  // How every diagram shows: the overview with its cards, or the diagram alone. One choice for every page and window, in the global state of VS Code.
  const LAYOUT_KEY = 'apostil.diagramFull';
  home.layout = page.layout = {
    full: () => context.globalState.get<boolean>(LAYOUT_KEY, false),
    set: (full) => void context.globalState.update(LAYOUT_KEY, full).then(() => { home.postLayout(); page.postLayout(); }),
  };
  // The icons of files and folders in the rows of the cards and the windows: from the file icon theme that he uses, again when he changes it.
  fileIcons.start(context);
  context.subscriptions.push(fileIcons.onChange(() => { home.iconsChanged(); page.iconsChanged(); }));
  // From outside a page (the side bar, the Files tree, the Explorer, a title bar, a command) a view starts a new path.
  const openHome = (quiet = false): void => { trail.start(TrailRules.HOME); home.openHome(undefined, quiet); };
  const openChange = (id: number): void => {
    trail.start({ tab: 'change', change: id, go: { level: 'change' }, name: theStore.getChange(id)?.file.title ?? '' });
    page.open(id);
  };
  /** A pull request of a branch with a stored change: the page of that change at "Conversation". */
  const openChangePull = (id: number, number: number): void => {
    const go = { view: 'conversation' as const, pull: number };
    trail.start({ tab: 'change', change: id, go, name: `Pull request #${number}` });
    page.openAt(id, go);
  };
  /** "Apostil: Open pull request…": a number or a link. A pull request of a branch with a stored change opens that page, else a page of its own. */
  const openPullRequest = async (text?: string): Promise<void> => {
    const asked = text ?? await vscode.window.showInputBox({ title: 'Open pull request', prompt: 'The number of a pull request of this repo, or a link to one on GitHub' });
    if (!asked?.trim()) return;
    const folderRepo = githubRepoOf(openFolder())?.slug;
    const ref = parsePullRef(asked, folderRepo);
    if (!ref) {
      const bare = /^#?\d+$/.test(asked.trim());
      return void vscode.window.showWarningMessage(bare ? 'This folder has no remote on GitHub, so a number alone names no pull request. Give a link.' : 'That is not a number or a link of a pull request.');
    }
    const link = pullLink(ref);
    const row = list.rows().find((one) => one.id !== undefined && list.pulls[one.branch]?.some((pull) => pull.url === link));
    if (row?.id !== undefined) return openChangePull(row.id, ref.number);
    trail.start({ tab: 'pull', link, name: `Pull request #${ref.number}` });
    page.openPull(link, ref.number);
  };
  const list = new ChangeList(media, theStore, openFolder, openChange, openHome, openChangePull, (link) => void openPullRequest(link), context.workspaceState);
  registerLinks(context, { store: theStore, openFolder, openPullRequest, openChange, openHome: () => openHome() }); // links from outside, the icon of Source Control
  // "Sort and filter" of the list: VS Code's quick pick, over the whole window. A pick sets the search of the list.
  const sortAndFilter = new SortAndFilter(media, context.globalStorageUri, (search) => list.setSearch(search));
  list.onMenu = (menu) => void sortAndFilter.show(menu);
  // The notes of every saved change beside the code of a file that opens the normal way.
  const notes = new NotesBesideCode(theStore, (uri, lines) => page.openFileAt(uri, lines), (uri, lines) => void page.showLines(uri, lines));
  notes.register(context);
  const files = new FilesTree(theStore, openFolder);

  /** The graphs of a folder or file: a row of the Files tree, a file or folder of the Explorer, or the file of the editor. */
  const graphsOf = (target?: unknown): void => {
    const own = typeof target === 'string' ? files.graphsIconClick(target) : undefined; // the graphs icon of a row of "Files": a click of the look goes to its target
    if (own) return void answerTarget(own, places);
    const uri = target instanceof vscode.Uri ? target : typeof target === 'string' ? undefined : vscode.window.activeTextEditor?.document.uri;
    const path = typeof target === 'string' ? target : uri && inFolder(uri)?.split(sep).join('/');
    if (!path) return;
    const isFolder = path.endsWith('/') || (() => { try { return statSync(join(openFolder(), path)).isDirectory(); } catch { return false; } })();
    const asked = isFolder && !path.endsWith('/') ? `${path}/` : path;
    trail.start({ tab: 'graphs', path: asked, name: asked });
    home.openGraphs(asked);
  };

  // The change that a remark from an editor belongs to: the one on the page, else the one of the branch of the open folder.
  const currentChange = (): number | undefined => page.openChange ?? folderChange();
  const updateHasChange = (): void => { void vscode.commands.executeCommand('setContext', 'apostil.hasChange', currentChange() !== undefined); };

  /** Cmd+Shift+.: on the page, a file tab or Home, the comment box at the pointer; else a comment on the lines selected in an editor, in VS Code's input box. */
  const remark = async (): Promise<void> => {
    if (page.wantsKey()) return page.askForRemark();
    if (home.wantsKey()) return home.askForRemark();
    const editor = vscode.window.activeTextEditor;
    const file = editor && !editor.selection.isEmpty ? inFolder(editor.document.uri) : undefined;
    const changeId = currentChange();
    if (!editor || !file || changeId === undefined) return;
    const end = editor.selection.end.character === 0 && editor.selection.end.line > editor.selection.start.line ? editor.selection.end.line : editor.selection.end.line + 1;
    const lines: [number, number] = [editor.selection.start.line + 1, end];
    const label = `${file}, ${lines[0] === lines[1] ? `line ${lines[0]}` : `lines ${lines[0]}–${lines[1]}`}`;
    const text = await vscode.window.showInputBox({ title: label, prompt: 'Comment, or @claude-current to send it to the agent' });
    if (text?.trim()) page.saveRemark({ type: 'remark', target: { kind: 'lines', file, lines, label }, text: text.trim(), to: mentionIn(text) }, changeId);
  };

  const filesView = vscode.window.createTreeView('apostil.files', { treeDataProvider: files });
  // The badge of the Apostil icon in the activity bar: the open pull requests of the repo, with their lines in its tip. The tree "Files" carries it,
  // since it exists from the start; the list asks gh again when it draws, at most once a minute (repoPullsLater).
  const showPullBadge = (answer: RepoPulls): void => { filesView.badge = pullBadge(answer.pulls); };
  list.onRepoPulls = showPullBadge;
  if (openFolder()) void repoPullsLater(openFolder()).then(showPullBadge);
  // The tree "Files" follows the map: the folders and files of an area open and come into view, the first one marked (the choice: treeSteps).
  home.showInTree = (paths, open) => {
    void (async () => {
      for (const { path, select, expand } of treeSteps(paths, filesView.visible, open)) {
        if (!open && !filesView.visible) return; // he hid the side bar meanwhile: a reveal shows a hidden view, so it would open again
        await filesView.reveal(path, { select, focus: false, expand }).then(undefined, () => {}); // a path that the tree does not hold is passed
      }
    })();
  };

  // A click, a key or a menu entry of the look, from any page: one function does what its target says.
  const places: TargetPlaces = {
    openFile: (path, line) => void vscode.commands.executeCommand('apostil.openFile', vscode.Uri.file(join(openFolder(), path)), line),
    openStep: (step) => { trail.start(step); openStep(step); },
    showInTree: (paths) => home.showInTree(paths, true),
    changeOfBranch: (branch) => {
      const repo = idOf(openFolder());
      const change = repo ? theStore.listChanges(repo).find((one) => one.branch === branch) : undefined;
      return change && { id: change.id, title: change.file.title, parts: change.file.parts.map(({ id, name }) => ({ id, name })) };
    },
    openPull: (number) => void openPullRequest(String(number)),
    openPage: (id) => openLookPage(id),
    app: apps[0],
    sendPrompt: (text, diagram) => home.sendPrompt(text, diagram),
  };
  home.onTarget = page.onTarget = (target, diagram) => void answerTarget(target, places, diagram);
  // The same for a click of the look in the list "Repo" and on a row of the tree "Files" (its item runs this command, which is not in the palette).
  list.onTarget = (target) => void answerTarget(target, places);
  context.subscriptions.push(vscode.commands.registerCommand('apostil.lookTarget', (target: Target) => answerTarget(target, places)));
  // The look of the repo in VS Code itself: the margin, the search with #, the right-click entries and keys, and the list "Look".
  const lookInVsCode = new LookInVsCode(theStore, openFolder, places, (uri) => notes.notesOf(uri)?.result.notes);
  lookInVsCode.register(context);

  /** A page of the look as a new path, "Home › <title>"; a page that the look no longer has says so. */
  function openLookPage(id: string): void {
    const title = home.pageTitle(id);
    if (!title) return void vscode.window.showInformationMessage(`The look of this repo has no page "${id}".`);
    trail.start({ tab: 'page', page: id, name: title });
    home.openPage(id);
  }
  /** "Apostil: Open a Page of the Look…": the pages of the look of the open repo, in a list; the command shows only when the look has pages. */
  const pickLookPage = async (): Promise<void> => {
    const pages = lookPages(theStore, openFolder());
    const picked = pages.length === 1 ? { id: pages[0].id } : await vscode.window.showQuickPick(pages.map((one) => ({ label: one.title, description: one.id, id: one.id })), { title: 'Open a page of the look' });
    if (picked) openLookPage(picked.id);
  };
  const updateLookPages = (): void => { void vscode.commands.executeCommand('setContext', 'apostil.lookHasPages', lookPages(theStore, openFolder()).length > 0); };
  updateLookPages();
  context.subscriptions.push(home.onNew(() => { files.refresh(); updateLookPages(); }));

  // The tree "Files" marks the file of the tab in front, as the Explorer of VS Code does: the file of an editor, a notebook or a file tab of Apostil
  // (the choice: rowOfFileInFront).
  const rowInFront = rowOfFileInFront();
  const markFileInFront = (again = false): void => {
    const uri = fileOfTab(vscode.window.tabGroups.activeTabGroup.activeTab);
    const path = rowInFront(uri?.scheme === 'file' ? uri.fsPath : undefined, openFolder(), filesView.visible, again);
    if (path) void filesView.reveal(path, { select: true, focus: false }).then(undefined, () => {}); // a file that the tree does not hold is passed
  };
  markFileInFront(true);
  // When the tree shows again it marks the file in front: after a moment, and only when it still shows. VS Code's reveal() shows a hidden view,
  // so a mark asked for as the side bar shows would open it again when he hides it at once (Cmd+B twice).
  let shownTimer: NodeJS.Timeout | undefined;
  const treeShows = (visible: boolean): void => {
    clearTimeout(shownTimer);
    if (visible) shownTimer = setTimeout(() => markFileInFront(true), TREE_SHOWS_MS);
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('apostil.changes', list),
    filesView,
    vscode.window.tabGroups.onDidChangeTabs(() => markFileInFront()),
    vscode.window.tabGroups.onDidChangeTabGroups(() => markFileInFront()),
    filesView.onDidChangeVisibility((event) => treeShows(event.visible)),
    vscode.commands.registerCommand('apostil.home', () => openHome()),
    vscode.commands.registerCommand('apostil.graphsOf', (target?: unknown) => graphsOf(target)),
    vscode.commands.registerCommand('apostil.openLookPage', () => pickLookPage()),
    vscode.workspace.registerTextDocumentContentProvider(BaseText.scheme, new BaseText()),
    vscode.window.registerCustomEditorProvider(ChangePage.fileEditor, page, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.workspace.onDidChangeConfiguration((event) => { if (event.affectsConfiguration('editor.minimap.enabled')) page.minimapChanged(); }),
    vscode.commands.registerCommand('apostil.openChange', (id?: number) => {
      const target = id ?? list.rows().find((row) => row.id !== undefined)?.id;
      if (target !== undefined) openChange(target);
    }),
    vscode.commands.registerCommand('apostil.remark', () => remark()),
    vscode.commands.registerCommand('apostil.sortAndFilter', () => list.askMenu()),
    vscode.commands.registerCommand('apostil.openPullRequest', (text?: string) => openPullRequest(text)),
    vscode.commands.registerCommand('apostil.refresh', () => { list.refresh(); page.reload(); home.reload(); files.refresh(); }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.kind === vscode.TextEditorSelectionChangeKind.Mouse || event.kind === vscode.TextEditorSelectionChangeKind.Keyboard) page.pointerLeft();
      const file = inFolder(event.textEditor.document.uri);
      if (!file) return;
      const selection = event.selections[0];
      const text = selection.isEmpty ? undefined : event.textEditor.document.getText(selection).slice(0, 4000);
      setState({ file, lines: [selection.start.line + 1, selection.end.line + 1], selectedText: text });
    }),
    vscode.window.tabGroups.onDidChangeTabs(() => setState({ openFiles: openFiles() })),
  );
  setState({ openFiles: openFiles() });
  updateHasChange();
  // What opens by itself: Home in place of the empty editor area, or the first page of the look of the repo; neither takes the keyboard.
  const quietPlaces = (beside: boolean): TargetPlaces => ({
    ...places,
    openStep: (step) => {
      trail.start(step);
      if (step.tab === 'home') home.openHome({ diagram: step.diagram, lit: step.lit ?? [] }, true, beside);
      else if (step.tab === 'graphs') home.openGraphs(step.path, true, beside);
      else openStep(step);
    },
    openPage: (id) => {
      const title = home.pageTitle(id);
      if (!title) return;
      trail.start({ tab: 'page', page: id, name: title });
      home.openPage(id, true, beside);
    },
  });
  registerHomeWhenEmpty(context, openFolder, (what) => ('home' in what ? openHome(true) : void answerTarget(what.first, quietPlaces(what.beside))), () => lookInVsCode.firstPage());
  // In a repo with no map: one question, after the first-start questions. A check window answers its own questions.
  if (context.extensionMode !== vscode.ExtensionMode.Test) {
    void firstStart.then((setUpAskedNow) => askOnceInNewRepo(context, theStore, openFolder(), apps, setUpAskedNow, (app, describe) => home.writeMap(app, describe))).catch(() => {});
  }

  // Keep it fresh: when the store file changes, the list and the open page load again.
  let timer: NodeJS.Timeout | undefined;
  const changed = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      list.refreshIfChanged(); page.reloadIfChanged(); updateHasChange(); notes.storeChanged(); lookInVsCode.storeChanged();
      home.changed(); // a new map or change can put new rows into a diagram, and a new look new pages: home.onNew
    }, 300);
  };
  for (const file of storeFiles()) watchFile(file, { interval: 1000 }, changed);

  // For the check inside VS Code: what the list and the page hold.
  return {
    listRows: () => list.rows(), listShown: () => list.shown, needsSetup: () => agentsNeedSetup(openFolder()), listPulls: () => list.pulls, page: () => page.page, rendered: () => page.rendered, renderedFile: () => page.renderedFile,
    remarkAction: (id: number, action: RemarkAction) => page.act(id, action),
    saveRemark: (message: NewRemark) => page.saveRemark(message),
    home: () => home.homeShown, graphs: (path: string) => home.graphsShown[path], homeRendered: () => home.rendered, lookPage: (id: string) => home.pagesShown[id],
    writeMap: (app: string) => home.writeMap(app), openHome: () => openHome(), graphsOf: (target?: unknown) => graphsOf(target), trail: () => trail.steps,
    notesShown: (path: string) => notes.shown.get(path), notesStatus: () => notes.statusText,
  };
}

export function deactivate(): void {
  for (const file of storeFiles()) unwatchFile(file);
  store?.close();
}
