// The Home tab with the map of the repo, one tab for the graphs of each folder or file, and one tab for each page of the look (build 58).

import { join } from 'node:path';
import * as vscode from 'vscode';
import { keptOnMap, withKept } from '../shared/comment-lines';
import type { Target } from '../shared/look';
import { shownTime, type ShownTime, type TimeLeft } from '../shared/map-estimate';
import { homeRun, QUIET_MS, runTimeLeft, withEnd, withSession } from '../shared/map-run';
import { homePlan } from '../store/map-run';
import { teamFrom } from '../shared/models';
import type { Store } from '../shared/store';
import { startMapRun, startRun } from './agent-run';
import { agentsNeedSetup, runNextStep } from './change-list';
import { apostilOnPath, appName, commentRuns, runModels, showRunProblem } from './run-settings';
import { openAgentSession, openLink, openRemarkSession, webviewHtml, type NewRemark } from './change-page';
import { menusOf } from './page-data';
import { graphsData, homeData, idOf, type GraphsData, type HomeData } from './home-data';
import { blocksAnswer, lookPages, pageData, type CustomPageData } from './look-blocks';
import { homePaths } from './file-icons';
import { fileIcons, pageOptions } from './icon-theme';
import type { Step, WindowTrail } from './trail';

type Message =
  | { type: 'ready' }
  | { type: 'walk'; from: Step; to: Step; open: boolean }
  | { type: 'back'; to: Step }
  | { type: 'move'; way: -1 | 1; from?: Step } // Cmd+Left and Cmd+Right: one step back or forward
  | { type: 'writeMap'; app: string; team?: unknown } // the press "Map this repo", with the lead and the effort of its control
  | { type: 'anotherApp' } // the link under the press: pick one of the other installed apps
  | NewRemark
  | { type: 'remarkAction'; id: number; action: 'resolve' | 'reopen' | 'start' }
  | { type: 'openSession'; id: number }
  | { type: 'openMapSession' } // "Open the session" on the line of the map run
  | { type: 'pointer'; on: boolean }
  | { type: 'openLink'; url: string }
  | { type: 'target'; target: Target; diagram?: string }
  | { type: 'openFile'; path: string; line?: number }
  | { type: 'showInTree'; paths: string[]; open?: boolean }
  | { type: 'setUp' }
  | { type: 'rendered'; kind: string; nodes: number; panels: number; drawn: number }
  | { type: 'ask'; id: number; question: string } // the blocks of a section of its own or of the window of a target, when it opens
  | { type: 'layout'; full: boolean }; // the icon of a diagram: the diagram alone, or the overview with its cards (build 83)

/**
 * How every diagram shows (build 83): the overview, with a card for each node under the diagram, or the diagram alone ("full"). One choice for every
 * page and window, kept by the extension; a page that shows gets it again when it changed.
 */
export interface DiagramLayout {
  full(): boolean;
  set(full: boolean): void;
}

/** One tab of home.html. Messages wait until its scripts are loaded. */
interface Tab {
  panel: vscode.WebviewPanel;
  path?: string; // the folder or file of a graphs tab; missing for Home
  page?: string; // the id of a page of the look in its tab
  ready: boolean;
  waiting: unknown[];
  follow?: vscode.Disposable[]; // a page of the look: the watchers of the files that its blocks read
}

export class HomePages {
  private home?: Tab;
  private graphs = new Map<string, Tab>();
  private pages = new Map<string, Tab>(); // a page of the look, by its id
  private writing?: string; // the app that writes the map now
  private quiet?: NodeJS.Timeout; // while the line of a map run says "writing": draws Home again when the run saved nothing for 30 minutes
  private ticker?: NodeJS.Timeout; // while a map run writes: the time left again every 30 seconds (build 84)
  private shown?: { run: string; time: ShownTime }; // the minutes that Home shows of the run that started then, with a rise that is held back
  private pointerOn?: Tab; // the tab that the pointer is on, so the comment key works there
  private signature = '';
  homeShown?: HomeData; // what Home shows now, for the check inside VS Code
  graphsShown: Record<string, GraphsData> = {}; // what each graphs tab shows now, for the check inside VS Code
  pagesShown: Record<string, CustomPageData> = {}; // what each page of the look shows now, for the check inside VS Code
  rendered: Record<string, Message & { type: 'rendered' }> = {}; // what each tab drew last, by "home" or its path
  layout: DiagramLayout = { full: () => false, set: () => {} }; // how every diagram shows; set by the extension, which keeps it

  /** Shows folders and files of the repo in the tree "Files" of the side bar; with `open` also when that tree does not show. Set by the extension, which owns the tree. */
  showInTree: (paths: string[], open: boolean) => void = () => {};

  /** Does what a target of the look says (answerTarget in look-targets.ts). Set by the extension, which owns the tabs and the path. */
  onTarget: (target: Target, diagram?: string) => void = () => {};

  /** Sends the words of a prompt of the look to a new session of the first agent app, as a comment on the map: after VS Code asked. */
  sendPrompt(text: string, diagram?: string): void {
    const app = this.apps[0];
    if (app) this.saveRemark({ type: 'remark', target: { kind: 'diagram', diagram, label: 'A click of the look' }, text, to: { kind: 'new', app } } as NewRemark);
  }

  constructor(private media: vscode.Uri, private store: Store, private openFolder: () => string, private apps: string[], private trail: WindowTrail) {}

  /**
   * Opens Home, or shows it; with `go`, at that diagram ('' for the top map) with those nodes lit. `quiet` leaves the keyboard where it is; `beside`
   * opens a new Home beside the tab in front (the first page of a look).
   */
  openHome(go?: { diagram: string; lit?: string[] }, quiet = false, beside = false): void {
    if (!this.home) {
      const show = { viewColumn: beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active, preserveFocus: quiet };
      this.home = this.addTab(vscode.window.createWebviewPanel('apostil.home', 'Home', show, { retainContextWhenHidden: true }));
      this.home.panel.onDidDispose(() => { this.home = undefined; });
    }
    this.home.panel.reveal(undefined, quiet);
    this.post(this.home, this.homeMessage());
    if (go) this.post(this.home, { type: 'go', go });
  }

  /** Opens the graphs of a folder (ending with "/") or a file, in a tab named after it. `quiet` and `beside` as for Home. */
  openGraphs(path: string, quiet = false, beside = false): void {
    let tab = this.graphs.get(path);
    if (!tab) {
      const name = path.replace(/\/$/, '').split('/').pop() || path;
      const show = { viewColumn: beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active, preserveFocus: quiet };
      const created = this.addTab(vscode.window.createWebviewPanel('apostil.graphs', path.endsWith('/') ? `${name}/` : name, show, { retainContextWhenHidden: true }), path);
      created.panel.onDidDispose(() => { this.graphs.delete(path); delete this.graphsShown[path]; });
      this.graphs.set(path, (tab = created));
    }
    tab.panel.reveal(undefined, quiet);
    this.post(tab, this.graphsMessage(path));
  }

  /**
   * Opens a page of the look of the repo in a tab named by its title, with Apostil's icon, as the graphs of a path open. Only the first page of a look
   * opens by itself (build 62), with `quiet` and `beside` as for Home.
   */
  openPage(id: string, quiet = false, beside = false): void {
    let tab = this.pages.get(id);
    if (!tab) {
      const title = this.pageTitle(id) ?? id;
      const show = { viewColumn: beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active, preserveFocus: quiet };
      const created = this.addTab(vscode.window.createWebviewPanel('apostil.page', title, show, { retainContextWhenHidden: true }), undefined, id);
      created.panel.onDidDispose(() => { this.pages.delete(id); delete this.pagesShown[id]; created.follow?.forEach((one) => one.dispose()); });
      this.pages.set(id, (tab = created));
    }
    tab.panel.reveal(undefined, quiet);
    this.post(tab, this.pageMessage(id, tab));
  }

  /** The title of a page of the look of the open repo; undefined when the look has no such page. */
  pageTitle(id: string): string | undefined {
    return lookPages(this.store, this.openFolder()).find((page) => page.id === id)?.title;
  }

  private readonly seenNew = new vscode.EventEmitter<void>();
  /**
   * The map, the look, a change or a comment of the repo is new, whoever saw it first: the watch of the store, a run that ended, or a message of a
   * tab. The tree "Files" and the pages of the look follow it (build 85: a run that ended just after a new look took the news from the watch).
   */
  readonly onNew = this.seenNew.event;

  /** Loads Home and the graphs tabs again when the map or the changes in the store are new. True when they were new. */
  changed(): boolean {
    if (this.signatureNow() === this.signature) return false;
    this.reload();
    return true;
  }

  reload(): void {
    const now = this.signatureNow();
    const seen = now !== this.signature;
    this.signature = now;
    if (this.home) this.post(this.home, this.homeMessage());
    for (const [path, tab] of this.graphs) this.post(tab, this.graphsMessage(path));
    for (const [id, tab] of this.pages) this.post(tab, this.pageMessage(id, tab));
    if (seen) this.seenNew.fire();
  }

  /**
   * The path of the window changed: each tab that shows draws its line again; a hidden tab gets the path when it shows.
   * A message to a hidden tab just before a new tab opens left the new tab without the keyboard focus.
   */
  postTrail(steps: Step[]): void {
    for (const tab of [this.home, ...this.graphs.values(), ...this.pages.values()]) if (tab?.panel.visible) this.post(tab, { type: 'trail', steps });
  }

  /** He chose how every diagram shows on another page: Home draws it again when it shows; hidden, it gets the choice when it shows. */
  postLayout(): void {
    if (this.home?.panel.visible) this.post(this.home, { type: 'layout', full: this.layout.full() });
  }

  /** True when the comment key belongs to Home: the pointer is on it, or it has the focus. */
  wantsKey(): boolean {
    return !!this.pointerOn || !!this.home?.panel.active;
  }

  /** Cmd+Shift+.: the comment pointer on Home. */
  askForRemark(): void {
    if (!this.home) return;
    if (!this.home.panel.active) this.home.panel.reveal(undefined, false); // a page that has the keyboard keeps it: a reveal would take it out of an open comment box
    this.post(this.home, { type: 'remark' });
  }

  /**
   * Saves a comment on the map of the repo, or a reply. It belongs to no change. Sent to a new session of an app, it starts that run in the open folder;
   * Home has no session of a change to send it to.
   */
  saveRemark(message: NewRemark): void {
    const repo = idOf(this.openFolder());
    if (!repo) return;
    const id = this.store.addRepoRemark(repo, withKept(message.target, keptOnMap(this.store.getMap(repo)?.map, message.target)), message.text, message.thread); // it keeps what its thing is now
    if (message.to?.kind === 'new') {
      this.store.sendRemark(id, message.to);
      const { app } = message.to;
      startRun(this.store, id, (problem) => {
        if (problem) showRunProblem(problem, { app });
        this.changed();
      }, app, this.openFolder(), runModels(), commentRuns());
    }
    this.reload();
  }

  private setPointer(tab: Tab | undefined): void {
    this.pointerOn = tab;
    void vscode.commands.executeCommand('setContext', 'apostil.pointerOnPage', !!tab);
  }

  /**
   * Starts a new session of an app that writes the map, and with `describe` then the change; Home shows that it works, and the map when it is saved.
   * The record of the map run starts at once, takes the session that the run reports, and ends with the run: as a stop when it failed or saved no map.
   * `chosen`: the lead and the effort that the control after the press sent; else, as for the question of a new repo, the default of teamOf().
   */
  writeMap(app: string, describe = false, chosen?: unknown): void {
    const folder = this.openFolder();
    if (!folder || this.writing) return;
    const team = teamFrom(app, chosen);
    const again = (): void => this.writeMap(app, describe, chosen);
    // The run saves the map with the command apostil: without it, the fix comes first, not a run that fails at its end.
    if (!apostilOnPath()) return showRunProblem(`${appName(app)} cannot write the map yet.`, { app, again, folder, noCommand: true });
    // The other connected agent app, which a toast offers when this one cannot run now.
    const other = this.apps.find((one) => one !== app && (one === 'claude-code' || one === 'codex'));
    const instead = other ? { app: other, start: () => this.writeMap(other, describe) } : undefined;
    const repo = idOf(folder);
    const record = (change: Parameters<Store['changeMapRun']>[1]): void => { if (repo) this.store.changeMapRun(repo, change); };
    const started = startMapRun(app, folder, (problem, facts) => {
      this.writing = undefined;
      const id = idOf(folder);
      // A run that ended well but saved no map says so, with the commands that it was not allowed to use.
      const why = problem ?? (id && !this.store.getMap(id) ? 'It ended and saved no map.' : undefined);
      record((run) => withEnd(run, new Date().toISOString(), !!why));
      // "codex" stays in small letters at the start: the problem of its model is told by that word.
      if (why) showRunProblem(`${app === 'codex' ? 'codex' : appName(app)} did not write the map. It said: ${why}`, { app, again, folder, instead, ...facts });
      this.reload();
    }, runModels(), describe, (session) => { record((run) => withSession(run, session)); this.reload(); }, team);
    if (!started) return void vscode.window.showWarningMessage(`A new session of ${app} cannot be started from here.`);
    this.writing = app;
    // The plan of the work is saved with the record at once (build 84): the code files and their lines, the notes groups, and the steps that are expected.
    record(() => homePlan(this.store, folder, homeRun(app, new Date().toISOString())));
    this.reload();
  }

  /** "Another app": VS Code's quick pick with the other installed apps; a pick starts the map with that app at once, so it is the app used last. */
  async pickApp(): Promise<void> {
    const items = this.apps.filter((app) => app !== this.homeShown?.mapApp).map((app) => ({ label: appName(app), app }));
    const picked = await vscode.window.showQuickPick(items, { title: 'Map this repo with another app' });
    if (picked) this.writeMap(picked.app);
  }

  private homeMessage(): unknown {
    // A picture or a film of the look is loaded from Apostil's store by its webview address.
    const webview = this.home?.panel.webview;
    const data = homeData(this.store, this.openFolder(), this.apps, (file) => (webview ? webview.asWebviewUri(vscode.Uri.file(file)).toString() : file), this.writing);
    // The picker of a comment on the map offers a new session of each app, with the model and the effort of its run.
    this.homeShown = { ...data, writing: this.writing, needsSetup: !data.map && agentsNeedSetup(this.openFolder()), sendTo: { sessions: [], models: menusOf(this.apps, runModels(), this.openFolder()) } };
    // A run that stops saves nothing, so the store does not change and nothing loads Home again: one timer does, after the quiet time, and the line then says that the run stopped.
    clearTimeout(this.quiet);
    if (data.mapRun?.state === 'writing') this.quiet = setTimeout(() => this.reload(), QUIET_MS + 1000);
    // The time left is computed again after each save (a save loads Home again) and every 30 seconds; Home gets only the new time then, and draws nothing again.
    const startedAt = this.runStart();
    if (data.mapRun?.time && startedAt) data.mapRun.time = this.held(startedAt, data.mapRun.time);
    clearInterval(this.ticker);
    if (data.mapRun?.time) this.ticker = setInterval(() => this.tick(), 30_000);
    return { type: 'data', data: this.homeShown, trail: this.trail.steps, full: this.layout.full(), icons: this.homeIcons() };
  }

  /** The icons of the folders and files of the map, which the cards and the windows of the nodes of Home show (build 85). */
  private homeIcons(): unknown {
    return this.home && fileIcons.iconsFor(homePaths(this.homeShown?.map), this.home.panel.webview);
  }

  /**
   * He changed the icon theme or the colour theme (build 85): Home shows the new icons. A theme of another extension needs another folder among the
   * roots of each tab, and new roots load a page again: it then asks for its data, with the icons.
   */
  iconsChanged(): void {
    for (const tab of [this.home, ...this.graphs.values(), ...this.pages.values()]) {
      if (!tab) continue;
      if (pageOptions(tab.panel.webview, this.roots())) { tab.ready = false; tab.waiting = []; }
      else if (tab === this.home) this.post(tab, { type: 'icons', icons: this.homeIcons() });
    }
  }

  /** The folders that a tab may load files from: its own, and the kept files of the looks (and the folder of the icon theme, pageOptions). */
  private roots(): vscode.Uri[] {
    return [this.media, vscode.Uri.file(join(this.store.folder, 'looks'))];
  }

  /** The start of the map run of the open repo: the key of the minutes that Home shows. */
  private runStart(): string | undefined {
    const repo = idOf(this.openFolder());
    return repo ? this.store.mapRun(repo)?.startedAt : undefined;
  }

  /** The time to show: a fall at once, a rise only when two computations in a row agree on it (shownTime). */
  private held(run: string, time: TimeLeft): TimeLeft {
    const next = shownTime(this.shown?.run === run ? this.shown.time : undefined, time.minutes);
    this.shown = { run, time: next };
    return { minutes: next.minutes, share: Math.round(time.share * 1000) / 1000 };
  }

  /** Every 30 seconds while a run writes: the time left, computed again, to Home; when the run has none any more, the timer stops. */
  private tick(): void {
    const repo = idOf(this.openFolder());
    const run = repo ? this.store.mapRun(repo) : undefined;
    const time = run && runTimeLeft(run);
    if (!run || !time || !this.home) return clearInterval(this.ticker);
    this.post(this.home, { type: 'time', time: this.held(run.startedAt, time) });
  }

  private graphsMessage(path: string): unknown {
    const webview = this.graphs.get(path)?.panel.webview;
    this.graphsShown[path] = graphsData(this.store, this.openFolder(), path, (file) => (webview ? webview.asWebviewUri(vscode.Uri.file(file)).toString() : file));
    return { type: 'data', data: this.graphsShown[path], trail: this.trail.steps };
  }

  /**
   * The data of a page of the look, read now, and its tab follows the files that its blocks read: when one changes on disk, the page gets its data
   * again. Only an open tab follows; it stops when it closes.
   */
  private pageMessage(id: string, tab: Tab): unknown {
    const folder = this.openFolder();
    const data = pageData(this.store, folder, id, (file) => tab.panel.webview.asWebviewUri(vscode.Uri.file(file)).toString());
    this.pagesShown[id] = data;
    if (data.title !== tab.panel.title && !data.gone) tab.panel.title = data.title;
    tab.follow?.forEach((one) => one.dispose());
    let timer: NodeJS.Timeout | undefined;
    const again = (): void => { clearTimeout(timer); timer = setTimeout(() => { if (this.pages.get(id) === tab) this.post(tab, this.pageMessage(id, tab)); }, 200); };
    tab.follow = data.files.map((file) => {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(folder), file));
      watcher.onDidChange(again);
      watcher.onDidCreate(again);
      watcher.onDidDelete(again);
      return watcher;
    });
    return { type: 'data', data, trail: this.trail.steps };
  }

  /** The answer to a question of a page: the blocks of a ref, read now, for a window that opens. */
  private answer(question: string, tab: Tab): unknown {
    if (!question.startsWith('blocks:')) return undefined;
    return blocksAnswer(this.store, this.openFolder(), question.slice('blocks:'.length), (file) => tab.panel.webview.asWebviewUri(vscode.Uri.file(file)).toString());
  }

  private signatureNow(): string {
    const id = idOf(this.openFolder());
    const changes = id ? this.store.listChanges(id).map((change) => [change.id, change.savedAt]) : [];
    const remarks = id ? this.store.repoRemarks(id).map((remark) => [remark.id, remark.state, remark.answeredAt, remark.run?.session]) : [];
    return JSON.stringify([id && this.store.getMap(id)?.savedAt, id && this.store.getLook(id)?.savedAt, changes, remarks, this.writing, id && this.store.mapRun(id)]);
  }

  private addTab(panel: vscode.WebviewPanel, path?: string, page?: string): Tab {
    const tab: Tab = { panel, path, page, ready: false, waiting: [] };
    panel.iconPath = vscode.Uri.joinPath(this.media, 'apostil-icon.svg');
    // The page may load its own files, the pictures and films of the looks that Apostil keeps, and the icons of the file icon theme.
    pageOptions(panel.webview, this.roots());
    panel.webview.html = webviewHtml(panel.webview, this.media, 'home.html');
    panel.webview.onDidReceiveMessage((message: Message) => this.receive(message, tab));
    panel.onDidChangeViewState(() => {
      if (!panel.visible && this.pointerOn === tab) this.setPointer(undefined);
      if (!panel.visible) return; // a hidden tab gets no message: see `postTrail`
      this.post(tab, { type: 'away' }); // a hover window from before the tab was hidden is closed
      this.post(tab, { type: 'trail', steps: this.trail.steps });
      if (tab === this.home) this.post(tab, { type: 'layout', full: this.layout.full() });
    });
    panel.onDidDispose(() => { if (this.pointerOn === tab) this.setPointer(undefined); });
    return tab;
  }

  /** Posts a message to a tab now, or when its scripts are loaded. A newer data message replaces one that waits. */
  private post(tab: Tab, message: unknown): void {
    if (tab.ready) void tab.panel.webview.postMessage(message);
    else tab.waiting.push(message);
  }

  private receive(message: Message, tab: Tab): void {
    if (runNextStep(message.type)) return; // "Set up for agents" on Home with no map
    switch (message.type) {
      case 'ready': {
        tab.ready = true;
        const waiting = tab.waiting.splice(0);
        const data = waiting.filter((one) => (one as { type: string }).type === 'data').pop();
        for (const one of waiting) if ((one as { type: string }).type !== 'data' || one === data) this.post(tab, one);
        if (!data) this.post(tab, tab.path ? this.graphsMessage(tab.path) : tab.page ? this.pageMessage(tab.page, tab) : this.homeMessage());
        break;
      }
      case 'walk':
        this.trail.walk(message.from, message.to, message.open);
        break;
      case 'back':
        this.trail.back(message.to);
        break;
      case 'move':
        this.trail.move(message.way, message.from);
        break;
      case 'writeMap':
        this.writeMap(message.app, false, message.team);
        break;
      case 'anotherApp':
        void this.pickApp();
        break;
      case 'remark':
        this.saveRemark(message);
        break;
      case 'remarkAction':
        if (message.action === 'resolve') this.store.closeThread(message.id);
        if (message.action === 'reopen') this.store.reopenThread(message.id);
        this.reload();
        break;
      case 'openSession':
        openRemarkSession(this.store, message.id, this.openFolder());
        break;
      case 'openMapSession': { // the session that writes the map, or wrote it until it stopped: in its app, or in a terminal that continues it
        const repo = idOf(this.openFolder());
        openAgentSession(repo ? this.store.mapRun(repo)?.agent : undefined, this.openFolder());
        break;
      }
      case 'pointer':
        if (message.on) this.setPointer(tab);
        else if (this.pointerOn === tab) this.setPointer(undefined);
        break;
      case 'openLink':
        openLink(message.url);
        break;
      case 'target': // a click, a key or a menu entry of the look: one place for every page (look-targets.ts)
        this.onTarget(message.target, message.diagram);
        break;
      case 'openFile': // a file in the window of a node, or a step of a process at its line: it opens as the setting of the notes says, a file with notes in the file tab at once
        void vscode.commands.executeCommand('apostil.openFile', vscode.Uri.file(join(this.openFolder(), message.path)), message.line);
        break;
      case 'showInTree': // he went into an area of the map: the tree "Files" follows
        this.showInTree(message.paths, !!message.open);
        break;
      case 'rendered':
        this.rendered[tab.path ?? (tab.page ? `page:${tab.page}` : 'home')] = message;
        break;
      case 'ask':
        void tab.panel.webview.postMessage({ type: 'answer', id: message.id, value: this.answer(message.question, tab) });
        break;
      case 'layout':
        this.layout.set(message.full);
        break;
    }
  }
}
