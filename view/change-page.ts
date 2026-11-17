// The tab with one change, the tabs of its files, and the messages between them and VS Code.
// The same tab shows a pull request with no stored change: its conversation and its diffs.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import * as vscode from 'vscode';
import { openSessionCommand, sessionLink, resumeCommand } from '../shared/agents';
import { rawFileText } from '../shared/git';
import { ghPictures, inlinePictures } from '../shared/pull-pictures';
import { pullRequestFrom, readPullRequest, runGh, type PullRequestView } from '../shared/read-pull-request';
import { writePullRequest, type Write } from '../shared/write-pull-request';
import type { AppState, RemarkTarget, RemarkTo, Store } from '../shared/store';
import { startRun } from './agent-run';
import { codexModel, showRunProblem } from './run-settings';
import { iconCss } from './state-icons';
import { pullRequestsLater } from './change-list';
import { reopenStaleRuns } from './list-rows';
import { answer, filePage, isListening, lookOfPage, marksBeside, notesBeside, pageData, pullLines, pullOnlyPage, takeStart, type PageData, type PullLines } from './page-data';
import type { ChangeGo, Step, WindowTrail } from './trail';

/**
 * Opens the session that worked on a remark: in its app when it has a link of its own, else in a terminal of VS Code
 * that continues the session, in the folder of the change (a remark on the map: the open folder).
 */
export function openRemarkSession(store: Store, id: number, openFolder: string): void {
  const remark = store.getRemark(id);
  const change = remark?.changeId === undefined ? undefined : store.getChange(remark.changeId);
  if (!remark) return;
  const fresh = remark.to?.kind === 'new';
  const app = remark.to?.app ?? change?.agent?.app;
  const session = remark.run?.session ?? (fresh ? undefined : change?.agent?.session);
  const link = fresh ? app && session && sessionLink({ app, session }) : change?.agent && sessionLink(change.agent);
  if (link) return openLink(link);
  const command = app && session && openSessionCommand(app, session);
  if (!command) return void vscode.window.showWarningMessage('This session cannot be opened from here.');
  const terminal = vscode.window.createTerminal({ name: `${app} ${session}`, cwd: change?.folder ?? openFolder });
  terminal.sendText(command.map((word) => (/^[\w./-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`)).join(' '));
  terminal.show();
}

/** Opens a link from a page in its app: a pull request in the browser, a session in the Claude or Codex app. */
export function openLink(url: string): void {
  if (/^(https|claude|codex):/.test(url)) void vscode.env.openExternal(vscode.Uri.parse(url));
}

/** Opens the web address of a button of the look after a yes: a page never leaves for the web by itself. */
export async function askAndOpen(url: string): Promise<void> {
  const open = 'Open';
  if (await vscode.window.showInformationMessage(`Open ${url} in the browser?`, { modal: true }, open) === open) openLink(url);
}

/** True when VS Code shows its small code map beside the code: the file tab of Apostil then shows its own. */
const minimapOn = (): boolean => vscode.workspace.getConfiguration('editor').get<boolean>('minimap.enabled', true);

/** The HTML of a page in view/media, with a new nonce, the webview's own source and a base address for the files beside it. */
export function webviewHtml(webview: vscode.Webview, media: vscode.Uri, file: string): string {
  const nonce = randomBytes(16).toString('base64');
  return readFileSync(join(media.fsPath, file), 'utf8')
    .replace(/'self'/g, webview.cspSource)
    .replace(/nonce-apostil/g, `nonce-${nonce}`)
    .replace(/nonce="apostil"/g, `nonce="${nonce}"`)
    .replace('<!--base-->', `<base href="${webview.asWebviewUri(media)}/">`)
    .replace('<!--icons-->', `<style>${iconCss(media.fsPath)}</style>`);
}

/** Shows the text of a file at the base of a change, for the left side of a diff. */
export class BaseText implements vscode.TextDocumentContentProvider {
  static scheme = 'apostil-base';
  static uri = (folder: string, commit: string, path: string): vscode.Uri =>
    vscode.Uri.from({ scheme: BaseText.scheme, path: `/${path}`, query: JSON.stringify({ folder, commit }) });
  provideTextDocumentContent(uri: vscode.Uri): string {
    const { folder, commit } = JSON.parse(uri.query);
    return rawFileText(folder, uri.path.slice(1), commit) ?? ''; // byte for byte: VS Code shows a notebook in its own way
  }
}

type Message =
  | { type: 'ready' }
  | { type: 'ask'; id: number; question: string }
  | { type: 'openFile'; path: string; lines?: [number, number] }
  | { type: 'openFileTab'; path: string; lines?: [number, number]; at?: ChangeAt; replace?: boolean }
  | { type: 'showChange'; go: ChangeGo; place?: RemarkTarget }
  | { type: 'revealFolder'; path: string }
  | NewRemark
  | { type: 'remarkAction'; id: number; action: RemarkAction }
  | { type: 'openLink'; url: string }
  | { type: 'runCommand'; command: string }
  | { type: 'openUrl'; url: string }
  | { type: 'openSession'; id: number }
  | { type: 'connect' }
  | { type: 'walk'; from: Step; to: Step; open: boolean }
  | { type: 'back'; to: Step }
  | { type: 'state'; view: 'diagram' | 'code'; part?: string; file?: string; lines?: [number, number] }
  | { type: 'rendered'; view: string; nodes: number; notes: number; lines?: [number, number]; map?: boolean }
  | { type: 'pointer'; on: boolean }
  | { type: 'edit'; line?: number }
  | { type: 'looked'; repo: string; number: number }
  | { type: 'write'; id: number; write: Write };

/**
 * The answer to "pull:<link>": the pull request as read, when he last looked, where GitHub takes a comment on the code here,
 * and for a page with no stored change its page data.
 */
export type PullAnswer = { pull: PullRequestView; lastLooked?: string; lines?: PullLines; page?: PageData } | { problem: string };

/** A comment or reply from the page. With `to` it is sent: to the session of the change, or to a new session of an app. */
export interface NewRemark {
  type: 'remark';
  target: RemarkTarget;
  point?: number;
  text: string;
  thread?: number;
  to?: RemarkTo;
}

// Resolve and Reopen act on the thread of a remark; Start a run on one sent remark.
export type RemarkAction = 'resolve' | 'reopen' | 'start';

// The change of a file that a tab starts at: its first or its last.
type ChangeAt = 'first' | 'last';

// A message to a page.
type Posted = { type: string; [field: string]: unknown };

/** One webview that shows the change: the page, or the tab of one file. Messages wait until its scripts are loaded. */
interface View {
  panel: vscode.WebviewPanel;
  file?: string; // the repo path of a file tab
  uri?: string; // the uri of the file of a file tab
  lines?: [number, number]; // the lines that a file tab shows first
  at?: ChangeAt; // the change that a file tab starts at
  ready: boolean;
  waiting: Posted[];
}

// The app of each word in a mention.
const MENTION_APPS: Record<string, string> = { claude: 'claude-code', codex: 'codex', antigravity: 'antigravity', opencode: 'opencode' };

/** Whom a comment typed into VS Code's input box goes to, from its first mention. */
export function mentionIn(text: string): RemarkTo | undefined {
  const match = /(?:^|\s)@(claude|codex|antigravity|opencode)-(current|new)\b/.exec(text);
  return match ? { app: MENTION_APPS[match[1]], kind: match[2] as RemarkTo['kind'] } : undefined;
}

/** The tab with one change and the tabs of its files. Opening another change reuses the page and closes the file tabs. */
export class ChangePage implements vscode.CustomReadonlyEditorProvider {
  static fileEditor = 'apostil.file';
  private panel?: vscode.WebviewPanel;
  private views = new Set<View>();
  private changeId?: number;
  private pullOnly?: string; // the link of a pull request with no stored change that the page shows
  private sentPulls = ''; // the pull requests of the branch that the page got last
  private pullRead?: { link: string; read: PullAnswer }; // the pull request that the page read last: the file tabs comment on its code
  private signature = '';
  private visibleSince = 0;
  private pointerOn?: View; // the view that the pointer is on
  private wanted = new Map<string, { lines?: [number, number]; at?: ChangeAt }>(); // where a file tab that VS Code is opening starts
  page?: PageData; // what the page shows now
  rendered?: Message & { type: 'rendered' }; // what the page last drew, for the check inside VS Code
  renderedFile?: Message & { type: 'rendered'; file?: string }; // what a file tab last drew, for the check inside VS Code
  trail?: WindowTrail; // the path that he followed in this window

  constructor(
    private media: vscode.Uri,
    private store: Store,
    private openFolder: () => string,
    private setState: (state: Partial<AppState>) => void,
    private apps: string[] = [], // the agent apps whose program is on the path
    private changeOfFolder: () => number | undefined = () => undefined, // for a file tab that VS Code opens by itself
  ) {}

  /** Puts the page into a webview and keeps it in the views. */
  private addView(panel: vscode.WebviewPanel, file?: string, start: { lines?: [number, number]; at?: ChangeAt } = {}, uri?: string): View {
    const view: View = { panel, file, uri, ...start, ready: false, waiting: [] };
    panel.webview.options = { enableScripts: true, localResourceRoots: [this.media] };
    panel.webview.html = webviewHtml(panel.webview, this.media, 'page.html');
    panel.webview.onDidReceiveMessage((message: Message) => this.receive(message, view));
    panel.onDidChangeViewState(() => {
      if (panel === this.panel) this.countTime();
      if (!panel.visible && this.pointerOn === view) this.setPointer(undefined);
      this.post(view, { type: 'away' }); // a hover window from before the tab was hidden or shown is closed
      if (panel === this.panel && panel.visible && this.trail) this.post(view, { type: 'trail', steps: this.trail.steps });
    });
    panel.onDidDispose(() => {
      this.views.delete(view);
      if (this.pointerOn === view) this.setPointer(undefined);
      if (panel === this.panel) {
        this.countTime(true);
        this.panel = undefined;
      }
      if (this.views.size) return;
      this.changeId = undefined;
      this.setState({ changeId: undefined, view: undefined, part: undefined });
    });
    this.views.add(view);
    return view;
  }

  open(changeId: number): void {
    if ((this.changeId !== undefined && this.changeId !== changeId) || this.pullOnly) {
      if (this.panel) this.countTime(); // the time so far belongs to the change before
      for (const view of [...this.views]) if (view.file) view.panel.dispose(); // its file tabs belong to the change before
    }
    this.showPanel();
    this.pullOnly = undefined;
    this.changeId = changeId;
    this.sentPulls = '';
    this.reload();
  }

  private showPanel(): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('apostil.change', 'Apostil', vscode.ViewColumn.Active, { retainContextWhenHidden: true });
      this.panel.iconPath = vscode.Uri.joinPath(this.media, 'apostil-icon.svg');
      this.addView(this.panel);
      this.visibleSince = Date.now();
    }
    this.panel.reveal();
  }

  /**
   * Opens a pull request with no stored change, by its link: the page has "Conversation" and "Diffs".
   * The page asks for it ("pull:<link>"), and gets its page data with the answer.
   */
  openPull(link: string, number: number): void {
    if (this.panel) this.countTime();
    for (const view of [...this.views]) if (view.file) view.panel.dispose();
    this.showPanel();
    this.changeId = undefined;
    this.pullOnly = link;
    this.page = pullOnlyPage(this.openFolder(), placeholderPull(link, number), this.apps);
    this.panel!.title = `#${number}`;
    for (const view of this.views) this.post(view, this.dataFor(view));
  }

  /** Opens the page of a change at a place: a level, a part, a diagram, and the nodes to light. The path of the window has it already. */
  openAt(changeId: number, go?: ChangeGo): void {
    this.open(changeId);
    const page = [...this.views].find((view) => view.panel === this.panel);
    if (page && go) this.post(page, { type: 'go', go });
  }

  // ----- the tab of a file: a read-only custom editor for the real file, so VS Code gives it the file's name and icon -----

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
    if (this.changeId === undefined && !this.pullOnly) {
      this.changeId = this.changeOfFolder();
      // With no change on the branch, the tab shows the code as it is, with the notes of the other changes of the repo beside it.
      this.page = this.changeId !== undefined ? pageData(this.store, this.changeId, this.openFolder(), this.apps) : filePage(this.openFolder());
      if (this.page) this.page.look = lookOfPage(this.store, this.page);
    }
    const folder = this.page?.folder ?? this.openFolder();
    const key = document.uri.toString();
    this.addView(panel, relative(folder, document.uri.fsPath).split(sep).join('/'), this.wanted.get(key), key);
    this.wanted.delete(key);
  }

  /** Opens the file tab of a file at its lines, from a note beside the code in the editor of VS Code; a tab that is open already shows the lines. */
  async openFileAt(uri: vscode.Uri, lines?: [number, number]): Promise<void> {
    await vscode.commands.executeCommand('vscode.openWith', uri, ChangePage.fileEditor, { viewColumn: this.showLines(uri, lines) ?? vscode.ViewColumn.Active });
  }

  /** Tells the file tab of a file where to be: a tab that is open shows the lines, and one that VS Code is opening starts there. Returns the column of the open tab. */
  showLines(uri: vscode.Uri, lines?: [number, number]): vscode.ViewColumn | undefined {
    const open = [...this.views].find((view) => view.uri === uri.toString());
    if (open) this.post(open, { type: 'lines', lines });
    else this.wanted.set(uri.toString(), { lines });
    return open?.panel.viewColumn;
  }

  /**
   * Opens the tab of a file in the editor group of the view that asks; a tab that is open already shows the lines.
   * With `replace`, the file takes the place of the asking file tab, as VS Code's preview tab does.
   */
  private async openFileTab(message: Message & { type: 'openFileTab' }, from: View): Promise<void> {
    if (!this.page) return;
    const { path, lines, at, replace } = message;
    const uri = vscode.Uri.file(join(this.page.folder, path));
    if (!existsSync(uri.fsPath)) return void vscode.window.showInformationMessage(`${path} is not in this folder.`);
    const open = [...this.views].find((view) => view.file === path);
    if (open && (lines || at)) this.post(open, { type: 'lines', lines, at });
    if (!open) this.wanted.set(uri.toString(), { lines, at });
    await vscode.commands.executeCommand('vscode.openWith', uri, ChangePage.fileEditor, { viewColumn: from.panel.viewColumn, preview: !!replace });
    if (replace && from.file !== path && this.views.has(from)) from.panel.dispose();
  }

  /** From a file tab: the change page, at the place that the tab names; it is a step of the path. With `place`, the page lights that thing there. */
  private showChange(go: ChangeGo, place?: RemarkTarget): void {
    if (this.changeId === undefined) return;
    this.open(this.changeId);
    const page = [...this.views].find((view) => view.panel === this.panel);
    if (page) this.post(page, { type: 'go', go, walk: true, place });
  }

  /** The path of the window changed: the page draws its line again when it shows; hidden, it gets the path when it shows (see `HomePages.postTrail`). */
  postTrail(steps: Step[]): void {
    const page = [...this.views].find((view) => view.panel === this.panel);
    if (page?.panel.visible) this.post(page, { type: 'trail', steps });
  }

  /** Posts a message to a view now, or when its scripts are loaded. */
  private post(view: View, message: Posted): void {
    if (view.ready) void view.panel.webview.postMessage(message);
    else view.waiting.push(message);
  }

  /** The data message of a view. A file tab gets its first lines or change once; later loads keep where the owner is. */
  private dataFor(view: View): Posted {
    const { lines, at } = takeStart(view);
    return { type: 'data', page: this.page, file: view.file, lines, at, trail: this.trail?.steps, minimap: minimapOn(), ...(view.file && this.pullRead ? { pullRead: this.pullRead } : {}) };
  }

  /** The setting "editor.minimap.enabled" changed: each view shows or hides the small code map beside a whole file, in place. */
  minimapChanged(): void {
    for (const view of this.views) this.post(view, { type: 'minimap', on: minimapOn() });
  }

  /** True when the key belongs to the page or a file tab: the pointer is on it, or it has the focus. */
  wantsKey(): boolean {
    return !!this.pointerOn || [...this.views].some((view) => view.panel.active);
  }

  /** The change that the page or its file tabs show. */
  get openChange(): number | undefined {
    return this.views.size ? this.changeId : undefined;
  }

  /** Cmd+Shift+.: the view under the pointer, or the active one, opens the comment box at the pointer. */
  askForRemark(): void {
    const view = this.pointerOn ?? [...this.views].find((candidate) => candidate.panel.active);
    if (!view) return;
    view.panel.reveal(undefined, false);
    this.post(view, { type: 'remark' });
  }

  /** The owner works in an editor now: the key no longer belongs to the page until the pointer moves on it again. */
  pointerLeft(): void {
    const view = this.pointerOn;
    if (!view) return;
    this.setPointer(undefined);
    this.post(view, { type: 'away' }); // the page closes a hover window that the pointer left behind
  }

  private setPointer(view: View | undefined): void {
    this.pointerOn = view;
    void vscode.commands.executeCommand('setContext', 'apostil.pointerOnPage', !!view);
  }

  /** Reads a pull request for the page. For a page with no stored change, its page data comes with it, and the file tabs read it. */
  private async readPull(link: string, view?: View): Promise<PullAnswer> {
    // A large pull request: the page shows the head and what is read so far, at most twice a second.
    let told = 0;
    const progress = (raw: Parameters<typeof pullRequestFrom>[0], read: number, total: number): void => {
      if (!view || Date.now() - told < 500) return;
      told = Date.now();
      try { this.post(view, { type: 'pullProgress', link, pull: pullRequestFrom(raw), read, total }); } catch { /* a part that is not read yet */ }
    };
    const result = await readPullRequest(this.page?.folder ?? this.openFolder(), link, runGh, progress);
    if ('problem' in result) {
      if (this.pullOnly === link && this.panel) this.panel.title = result.problem === 'no-such-pull' ? `Pull request ${link.split('/').pop()} not found` : `Pull request ${link.split('/').pop()}`;
      return { problem: result.text };
    }
    const { pull } = result;
    await inlinePictures(pull, ghPictures());
    const lastLooked = this.store.lastLooked(pull.repo, pull.number);
    const pullOnly = this.pullOnly === link;
    if (pullOnly) this.page = pullOnlyPage(this.openFolder(), pull, this.apps);
    const read: PullAnswer = { pull, lastLooked, lines: this.page && pullLines(this.page, pull), ...(pullOnly ? { page: this.page } : {}) };
    if (view?.panel === this.panel) this.tellFileTabs(link, read);
    return read;
  }

  /** The file tabs learn the pull request that the page read, so that a comment on code can go to it. */
  private tellFileTabs(link: string, read: PullAnswer): void {
    this.pullRead = { link, read };
    for (const view of this.views) if (view.file) this.post(view, { type: 'pullRead', link, read });
  }

  /**
   * One write to GitHub that the owner sent from a page: its answer goes back to that page. Nothing here sends it again.
   * After it went through, the page of the change reads the pull request again and shows the new item.
   */
  private async write(id: number, write: Write, from: View): Promise<void> {
    const result = await writePullRequest(write);
    this.post(from, { type: 'written', id, result });
    const page = [...this.views].find((view) => view.panel === this.panel);
    if ('ok' in result && page) this.post(page, { type: 'reread' });
  }

  /** The pull requests of the branch of the change, sent to the page when they come and when they differ from the last time. */
  private sendPulls(): void {
    const page = this.page;
    if (!page || page.pullOnly) return;
    void pullRequestsLater(page.folder, page.branch).then((pulls) => {
      const sent = JSON.stringify(pulls);
      if (this.page !== page || sent === this.sentPulls) return;
      this.sentPulls = sent;
      const view = [...this.views].find((one) => one.panel === this.panel);
      if (view) this.post(view, { type: 'pulls', pulls });
    });
  }

  /** Loads the page data again and sends it to the page and the file tabs. */
  reload(): void {
    if (!this.views.size || this.changeId === undefined) return;
    reopenStaleRuns(this.store, this.changeId);
    // The signature is taken first: reading the page takes a moment, and an answer that lands in that moment must still cause the next load.
    this.signature = this.signatureNow();
    this.page = pageData(this.store, this.changeId, this.openFolder(), this.apps);
    if (!this.page) return;
    this.page.look = lookOfPage(this.store, this.page);
    if (this.panel) this.panel.title = this.page.branch;
    for (const view of this.views) this.post(view, this.dataFor(view));
    this.setState({ changeId: this.changeId });
    this.sendPulls();
  }

  /** Loads again when the store holds something new for this change. Our own writes of the app state change nothing here. */
  reloadIfChanged(): void {
    if (this.views.size && this.changeId !== undefined && this.signatureNow() !== this.signature) this.reload();
  }

  private signatureNow(): string {
    if (this.changeId === undefined) return '';
    const change = this.store.getChange(this.changeId);
    const remarks = this.store.remarks(this.changeId).map((remark) => [remark.id, remark.sentAt, remark.state, remark.answeredAt, remark.run?.startedAt]);
    const points = this.store.openPoints(this.changeId).map((point) => `${point.id}${point.used}`);
    return JSON.stringify([change?.savedAt, change?.head, change?.agent, remarks, points, isListening(this.store, change?.agent)]);
  }

  /** Adds the seconds that the page was visible to the view log, when it hides or closes. */
  private countTime(closing = false): void {
    if (this.visibleSince && this.changeId !== undefined) {
      const seconds = (Date.now() - this.visibleSince) / 1000;
      if (seconds >= 1) this.store.logView(this.changeId, seconds);
    }
    this.visibleSince = !closing && this.panel?.visible ? Date.now() : 0;
  }

  /** What the owner did with a thread: resolve it or open it again; or start a run for one sent remark. */
  act(id: number, action: RemarkAction): void {
    if (this.changeId === undefined) return;
    if (action === 'resolve') this.store.closeThread(id);
    if (action === 'reopen') this.store.reopenThread(id);
    if (action === 'start') this.run(id);
    this.reload();
  }

  /** Starts a run for a sent remark: it continues the session of the change, or starts a new session of an app. */
  private run(id: number, newApp?: string): void {
    startRun(this.store, id, (problem) => {
      if (problem) showRunProblem(problem, { app: newApp });
      this.reloadIfChanged();
    }, newApp, undefined, codexModel());
  }

  /**
   * Saves a comment or a reply. Sent to a new session, it starts that run. Sent to the session of the change, it starts a run that continues
   * that session at once; a session that listens takes the comment by itself, and one that cannot be continued waits for the owner.
   */
  saveRemark(message: NewRemark, changeId = this.changeId): void {
    if (changeId === undefined) return;
    const id = this.store.addRemark(changeId, message.target, message.text, message.thread);
    if (message.to) this.store.sendRemark(id, message.to);
    const agent = this.store.getChange(changeId)?.agent;
    if (message.to?.kind === 'new') this.run(id, message.to.app);
    else if (message.to && agent && !isListening(this.store, agent) && resumeCommand(agent, '')) this.run(id);
    if (message.point) this.store.markOpenPointUsed(message.point);
    this.reload();
  }

  private async receive(message: Message, view: View): Promise<void> {
    const page = this.page;
    switch (message.type) {
      case 'ready': {
        view.ready = true;
        const waiting = view.waiting.splice(0).filter((one) => one.type !== 'data');
        if (page) this.post(view, this.dataFor(view));
        for (const one of waiting) this.post(view, one);
        break;
      }
      case 'ask':
        if (message.question.startsWith('pull:')) this.post(view, { type: 'answer', id: message.id, value: await this.readPull(message.question.slice(5), view) });
        else this.post(view, { type: 'answer', id: message.id, value: this.page ? answer(this.page, message.question, (path, lines) => notesBeside(this.store, this.page!, path, lines), (path) => marksBeside(this.store, this.page!, path)) : undefined });
        break;
      case 'looked':
        this.store.setLooked(message.repo, message.number);
        break;
      case 'write':
        await this.write(message.id, message.write, view);
        break;
      case 'openFile':
        if (page) await openDiff(page, message.path, message.lines);
        break;
      case 'openFileTab':
        await this.openFileTab(message, view);
        break;
      case 'showChange':
        this.showChange(message.go, message.place);
        break;
      case 'revealFolder':
        await revealFolder(join(this.openFolder(), message.path));
        break;
      case 'remark':
        this.saveRemark(message);
        break;
      case 'remarkAction':
        this.act(message.id, message.action);
        break;
      case 'openSession':
        openRemarkSession(this.store, message.id, this.openFolder());
        break;
      case 'runCommand': // a button of the look on a note card runs a command of Apostil, and no other command
        if (message.command.startsWith('apostil.')) void vscode.commands.executeCommand(message.command);
        break;
      case 'openUrl': // a button of the look: VS Code asks before it leaves for a web address
        void askAndOpen(message.url);
        break;
      case 'openLink':
        openLink(message.url);
        break;
      case 'connect':
        await vscode.commands.executeCommand('apostil.connectClaudeCode', this.page?.folder);
        break;
      case 'walk':
        this.trail?.walk(message.from, message.to, message.open);
        break;
      case 'back':
        this.trail?.back(message.to);
        break;
      case 'state':
        this.setState({ changeId: this.changeId, view: message.view, part: message.part, file: message.file, lines: message.lines });
        break;
      case 'pointer':
        if (message.on) this.setPointer(view);
        else if (this.pointerOn === view) this.setPointer(undefined);
        break;
      case 'edit': // "Edit" in a file tab: the same change as the key, to the editor of VS Code at the line
        if (view.uri) void vscode.commands.executeCommand('apostil.toggleNotes', view.uri, message.line);
        break;
      case 'rendered':
        if (view.file) this.renderedFile = { ...message, file: view.file };
        else this.rendered = message;
        break;
    }
  }
}

/** The pull request in short while it is read: its link and number. */
function placeholderPull(link: string, number: number): PullRequestView {
  const empty = { totalCount: 0, nodes: [] };
  return pullRequestFrom({ pr: {
    number, title: `#${number}`, url: link, state: 'OPEN', repository: { nameWithOwner: /github\.com\/([^/]+\/[^/]+)\//.exec(link)?.[1] ?? '' },
    timelineItems: empty, reviewThreads: empty, files: empty,
  } });
}

/** Opens a file beside the page: its diff against the base, or the plain file when it is new. With lines, the editor shows them. */
async function openDiff(page: PageData, path: string, lines?: [number, number]): Promise<void> {
  const file = page.files.find((candidate) => candidate.path === path);
  const now = vscode.Uri.file(join(page.folder, path));
  const before = BaseText.uri(page.folder, page.base, path);
  const options: vscode.TextDocumentShowOptions = {
    viewColumn: vscode.ViewColumn.Beside, preview: true,
    selection: lines ? new vscode.Range(lines[0] - 1, 0, lines[1] - 1, 0) : undefined,
  };
  if (!file || file.status === 'added') await vscode.window.showTextDocument(now, options);
  else if (file.status === 'removed') await vscode.window.showTextDocument(before, options);
  else await vscode.commands.executeCommand('vscode.diff', before, now, `${basename(path)} (base ↔ now)`, options);
}

/** Reveals a folder in the Explorer, expanded, with its subfolders collapsed. */
async function revealFolder(folder: string): Promise<void> {
  await vscode.commands.executeCommand('workbench.files.action.collapseExplorerFolders');
  await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(folder));
  await vscode.commands.executeCommand('list.expand');
  await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(folder)); // the folder keeps the selection when the expand moved it to a child
}
