// The tab with one change, the tabs of its files, and the messages between them and VS Code.
// The same tab shows a pull request with no stored change: its conversation and its diffs.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import * as vscode from 'vscode';
import { openSessionCommand, sessionLink, resumeCommand, type AgentSession } from '../shared/agents';
import { pickFrom, type RunPick } from '../shared/models';
import { describeWords, type AskView } from '../shared/ask';
import { keptInChange, withKept } from '../shared/comment-lines';
import { fetchPullCommits, rawFileText } from '../shared/git';
import type { Target } from '../shared/look';
import { ghPictures, inlinePictures } from '../shared/pull-pictures';
import { githubRepoOf, pullRequestFrom, readPullRequest, runGh, type PullRequestView } from '../shared/read-pull-request';
import { writePullRequest, type Write } from '../shared/write-pull-request';
import type { AppState, RemarkTarget, RemarkTo, Store } from '../shared/store';
import { startRun } from './agent-run';
import { askRunOf, askView, startAsk } from './ask-run';
import { connectedApps } from './new-repo-steps';
import type { PullHead } from './pull-folder';
import { appName, commentRuns, runModels, showRunProblem } from './run-settings';
import { iconCss } from './state-icons';
import { blocksAnswer } from './look-blocks';
import { changePaths } from './file-icons';
import { fileIcons, pageOptions } from './icon-theme';
import type { DiagramLayout } from './home-page';
import { keptPullRequests, pullRequestsLater } from './change-list';
import { reopenStaleRuns } from './list-rows';
import { answer, filePage, isListening, lookOfPage, marksBeside, notesBeside, pageData, pullLines, pullOnlyPage, takeStart, type PageData, type PullLines } from './page-data';
import type { ChangeGo, Step, WindowTrail } from './trail';

/**
 * Opens a session where he works with it, the one way for every link of a session (sessionOpens): in its app when it has a link of its own
 * (the Claude desktop app, Codex), else in a terminal of VS Code in `folder` that continues it. Never a page in the browser.
 */
export function openAgentSession(agent: AgentSession | undefined, folder: string): void {
  const link = agent && sessionLink(agent);
  if (link) return openLink(link);
  const command = agent?.session && openSessionCommand(agent.app, agent.session);
  if (!agent || !command) return void vscode.window.showWarningMessage('This session cannot be opened from here.');
  const terminal = vscode.window.createTerminal({ name: `${agent.app} ${agent.session}`, cwd: folder });
  terminal.sendText(command.map((word) => (/^[\w./-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`)).join(' '));
  terminal.show();
}

/** Opens the session that worked on a remark (openAgentSession), in the folder of the change (a remark on the map: the open folder). */
export function openRemarkSession(store: Store, id: number, openFolder: string): void {
  const remark = store.getRemark(id);
  const change = remark?.changeId === undefined ? undefined : store.getChange(remark.changeId);
  if (!remark) return;
  const app = remark.to?.app ?? change?.agent?.app;
  // A new session has only the id that its run reported, another known session its own id; the session of the change keeps what the change knows of it (the id in the desktop app).
  const agent = remark.to?.kind === 'new' ? app && { app, session: remark.run?.session }
    : remark.to?.kind === 'session' ? { app: remark.to.app, session: remark.run?.session ?? remark.to.session }
      : change?.agent && { ...change.agent, session: remark.run?.session ?? change.agent.session };
  openAgentSession(agent || undefined, change?.folder ?? openFolder);
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

/** The address of a kept file of a look in a page of Apostil (a picture in place of a step); every webview of the extension reads it by the same address. */
const lookAddress = (webview: vscode.Webview | undefined) => (file: string): string => (webview ? webview.asWebviewUri(vscode.Uri.file(file)).toString() : file);

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
  | { type: 'remarkAction'; id: number; action: RemarkAction; run?: unknown } // "Start a run" sends the model and the effort of its control
  | { type: 'openLink'; url: string }
  | { type: 'target'; target: Target; diagram?: string }
  | { type: 'openSession'; id: number }
  | { type: 'connect' }
  | { type: 'setUp' }
  | { type: 'walk'; from: Step; to: Step; open: boolean }
  | { type: 'back'; to: Step }
  | { type: 'move'; way: -1 | 1; from?: Step } // Cmd+Left and Cmd+Right: one step back or forward
  | { type: 'state'; view: 'diagram' | 'code'; part?: string; file?: string; lines?: [number, number] }
  | { type: 'rendered'; view: string; nodes: number; notes: number; lines?: [number, number]; map?: boolean }
  | { type: 'pointer'; on: boolean }
  | { type: 'edit'; line?: number }
  | { type: 'looked'; repo: string; number: number }
  | { type: 'askAgent'; words: string; team?: unknown } // the press of words for an agent: they go to the session that it names, with the lead and the effort of its control
  | { type: 'openAskSession'; words: string } // "Open the session" on the line of their run
  | { type: 'write'; id: number; write: Write }
  | { type: 'layout'; full: boolean }; // the icon of a diagram: the diagram alone, or the overview with its cards (build 83)

/**
 * The answer to "pull:<link>": the pull request as read, when he last looked, where GitHub takes a comment on the code here,
 * and for a page with no stored change its page data.
 */
export type PullAnswer = { pull: PullRequestView; lastLooked?: string; lines?: PullLines; page?: PageData } | { problem: string };

/** A comment or reply from the page. With `to` it is sent: to the session of the change, to a new session of an app, or to another known session. */
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
  return match ? { app: MENTION_APPS[match[1]], kind: match[2] as 'current' | 'new' } : undefined;
}

/** The tab with one change and the tabs of its files. Opening another change reuses the page and closes the file tabs. */
export class ChangePage implements vscode.CustomReadonlyEditorProvider {
  static fileEditor = 'apostil.file';
  private panel?: vscode.WebviewPanel;
  private views = new Set<View>();
  private changeId?: number;
  private pullOnly?: string; // the link of a pull request with no stored change that the page shows
  private sentPulls = ''; // the pull requests of the branch that the page got last
  private fetched = new Set<string>(); // the pull requests whose commits Apostil tried to get, while VS Code runs
  private pullRead?: { link: string; read: PullAnswer }; // the pull request that the page read last: the file tabs comment on its code
  private asking = false; // a press gets the branch of its pull request ready: a second click starts nothing
  private askProblem?: { words: string; problem: string }; // why the last press of these words started no run
  private signature = '';
  private visibleSince = 0;
  private pointerOn?: View; // the view that the pointer is on
  private wanted = new Map<string, { lines?: [number, number]; at?: ChangeAt }>(); // where a file tab that VS Code is opening starts
  page?: PageData; // what the page shows now
  rendered?: Message & { type: 'rendered' }; // what the page last drew, for the check inside VS Code
  renderedFile?: Message & { type: 'rendered'; file?: string }; // what a file tab last drew, for the check inside VS Code
  trail?: WindowTrail; // the path that he followed in this window
  onTarget: (target: Target, diagram?: string) => void = () => {}; // does what a target of the look says (look-targets.ts); set by the extension
  layout: DiagramLayout = { full: () => false, set: () => {} }; // how every diagram shows (build 83); set by the extension, which keeps it

  constructor(
    private media: vscode.Uri,
    private store: Store,
    private openFolder: () => string,
    private setState: (state: Partial<AppState>) => void,
    private apps: string[] = [], // the agent apps whose program is on the path
    private changeOfFolder: () => number | undefined = () => undefined, // for a file tab that VS Code opens by itself
  ) {}

  /** The agent apps that are connected in the open folder: the picker of a card and "@" offer only these. */
  private connected(): string[] {
    return connectedApps(this.apps, this.openFolder());
  }

  /** Puts the page into a webview and keeps it in the views. */
  private addView(panel: vscode.WebviewPanel, file?: string, start: { lines?: [number, number]; at?: ChangeAt } = {}, uri?: string): View {
    const view: View = { panel, file, uri, ...start, ready: false, waiting: [] };
    pageOptions(panel.webview, this.roots()); // the kept files of a look, and the icons of the file icon theme
    panel.webview.html = webviewHtml(panel.webview, this.media, 'page.html');
    panel.webview.onDidReceiveMessage((message: Message) => this.receive(message, view));
    panel.onDidChangeViewState(() => {
      if (panel === this.panel) this.countTime();
      if (!panel.visible && this.pointerOn === view) this.setPointer(undefined);
      this.post(view, { type: 'away' }); // a hover window from before the tab was hidden or shown is closed
      if (panel === this.panel && panel.visible && this.trail) this.post(view, { type: 'trail', steps: this.trail.steps });
      if (panel === this.panel && panel.visible) this.post(view, { type: 'layout', full: this.layout.full() }); // he may have chosen on another page
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
    this.page = pullOnlyPage(this.openFolder(), placeholderPull(link, number), this.connected());
    this.page.look = lookOfPage(this.store, this.page); // the look of the repo for the parts of the pull request (build 61)
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
      this.page = this.changeId !== undefined ? pageData(this.store, this.changeId, this.openFolder(), this.connected(), runModels()) : filePage(this.openFolder());
      if (this.page) this.page.look = lookOfPage(this.store, this.page, lookAddress(panel.webview));
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

  /** He chose how every diagram shows on another page: the page draws it again when it shows; hidden, it gets the choice when it shows. */
  postLayout(): void {
    const page = [...this.views].find((view) => view.panel === this.panel);
    if (page?.panel.visible) this.post(page, { type: 'layout', full: this.layout.full() });
  }

  /** Posts a message to a view now, or when its scripts are loaded. */
  private post(view: View, message: Posted): void {
    if (view.ready) void view.panel.webview.postMessage(message);
    else view.waiting.push(message);
  }

  /** The data message of a view. A file tab gets its first lines or change once; later loads keep where the owner is. */
  private dataFor(view: View): Posted {
    const { lines, at } = takeStart(view);
    const pulls = this.page && !this.page.pullOnly ? keptPullRequests(this.page.folder, this.page.branch) : undefined; // known now: the page opens at the right view at once
    if (pulls) this.sentPulls = JSON.stringify(pulls);
    return { type: 'data', page: this.page, pulls, file: view.file, lines, at, trail: this.trail?.steps, full: this.layout.full(), minimap: minimapOn(), ask: this.askNow(), icons: this.iconsOf(view), ...(view.file && this.pullRead ? { pullRead: this.pullRead } : {}) };
  }

  /** The icons of the changed files, which the cards of the parts show (build 85); a file tab has no cards. */
  private iconsOf(view: View): unknown {
    const page = this.page;
    if (view.file || !page) return undefined;
    return fileIcons.iconsFor(changePaths(page), view.panel.webview);
  }

  /** He changed the icon theme or the colour theme (build 85): the page shows the new icons; new roots load it again, and it asks for its data. */
  iconsChanged(): void {
    for (const view of this.views) {
      if (pageOptions(view.panel.webview, this.roots())) { view.ready = false; view.waiting = []; }
      else if (!view.file) this.post(view, { type: 'icons', icons: this.iconsOf(view) });
    }
  }

  /** The folders that a page may load files from: its own, and the kept files of the looks (and the folder of the icon theme, pageOptions). */
  private roots(): vscode.Uri[] {
    return [this.media, vscode.Uri.file(join(this.store.folder, 'looks'))];
  }

  /**
   * The words for an agent of the page, with the press that sends them and the line of their run: a pull request of this repo with no stored change has them.
   * After a press that started no run (the branch of the pull request could not be checked out), the press comes with why.
   */
  private askNow(): AskView | undefined {
    const bare = this.page?.pullOnly;
    if (!bare || bare.otherRepo) return undefined;
    const words = describeWords(bare.number);
    const view = askView(this.store, this.openFolder(), words, this.apps, { pull: this.pullHead() });
    return view.press && this.askProblem?.words === words ? { ...view, problem: this.askProblem.problem } : view;
  }

  /** The pull request of the page, as the run that describes it needs it: Apostil checks its head branch out for the run (view/pull-folder.ts). */
  private pullHead(): PullHead | undefined {
    const page = this.page;
    if (!page?.pullOnly) return undefined;
    return { number: page.pullOnly.number, branch: page.branch, head: page.head ?? '', base: page.base, remote: githubRepoOf(this.openFolder())?.remote };
  }

  /**
   * The press: the words go to the session that it named (view/ask-run.ts), in a folder with the head branch of the pull request checked out, and the page
   * shows the line of their run as it changes. When that branch cannot be checked out, no run starts, and the line says why, with the press again.
   */
  private async askAgent(words: string, team?: unknown): Promise<void> {
    const now = this.askNow();
    // A second click while the branch is checked out or the run works starts nothing; nor do words of a pull request that the page no longer shows ("try again").
    if (this.asking || now?.words !== words || now.press === undefined) return;
    const folder = this.openFolder();
    const tell = (): void => {
      const ask = this.askNow();
      const page = [...this.views].find((one) => one.panel === this.panel);
      if (page && ask?.words === words) this.post(page, { type: 'asked', ask });
    };
    const again = (): void => void this.askAgent(words, team);
    this.asking = true;
    this.askProblem = undefined;
    const started = await startAsk(this.store, folder, words, this.apps, runModels(), tell, (problem, facts) => {
      const app = askRunOf(this.store, folder, words)?.agent.app ?? '';
      // "codex" stays in small letters at the start: the problem of its model is told by that word (runProblem).
      if (problem) showRunProblem(`${app === 'codex' ? 'codex' : appName(app)} did not finish "${words}". It said: ${problem}`, { app, again, folder, ...facts });
    }, { pull: this.pullHead() }, team).finally(() => { this.asking = false; });
    if (started === false) return void vscode.window.showWarningMessage('No agent app can be started from here.');
    if (typeof started === 'string') this.askProblem = { words, problem: started };
    tell();
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
    if (!view.panel.active) view.panel.reveal(undefined, false); // a page that has the keyboard keeps it: a reveal would take it out of an open comment box
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

  /**
   * A pull request with no stored change whose commits are not in the folder: Apostil gets them in the background, once for each pull request while
   * VS Code runs, and then draws its diffs. While it gets them, and when that fails, the page says so in one quiet line.
   */
  private fetchCommits(link: string, pull: PullRequestView): void {
    const page = this.page;
    if (!page?.pullOnly?.remote) return;
    this.fetched.add(link);
    page.pullOnly.fetching = true;
    void fetchPullCommits(this.openFolder(), page.pullOnly.remote, pull.number).then((problem) => {
      if (this.pullOnly !== link || !this.page?.pullOnly) return;
      if (problem) this.page.pullOnly = { ...this.page.pullOnly, fetching: false, fetchProblem: problem };
      else {
        this.page = pullOnlyPage(this.openFolder(), pull, this.connected());
        this.page.look = lookOfPage(this.store, this.page);
      }
      for (const view of this.views) this.post(view, this.dataFor(view));
    });
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
    if (pullOnly) this.page = pullOnlyPage(this.openFolder(), pull, this.connected());
    if (pullOnly && this.page) this.page.look = lookOfPage(this.store, this.page);
    if (pullOnly && this.page?.pullOnly?.remote && !this.fetched.has(link)) this.fetchCommits(link, pull);
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
   * One write to GitHub that the owner sent from a page: its answer, with what GitHub made, goes back to that page, which shows it in place.
   * Nothing here sends it again. After it went through, the page of the change reads the pull request again in the background and changes only what differs.
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
    this.page = pageData(this.store, this.changeId, this.openFolder(), this.connected(), runModels());
    if (!this.page) return;
    this.page.look = lookOfPage(this.store, this.page, lookAddress(this.panel?.webview ?? [...this.views][0]?.panel.webview));
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
    return JSON.stringify([change?.savedAt, change?.head, change?.agent, remarks, points, isListening(this.store, change?.agent), change && this.store.getLook(change.repoId)?.savedAt]); // a new look draws the page again
  }

  /** Adds the seconds that the page was visible to the view log, when it hides or closes. */
  private countTime(closing = false): void {
    if (this.visibleSince && this.changeId !== undefined) {
      const seconds = (Date.now() - this.visibleSince) / 1000;
      if (seconds >= 1) this.store.logView(this.changeId, seconds);
    }
    this.visibleSince = !closing && this.panel?.visible ? Date.now() : 0;
  }

  /** What the owner did with a thread: resolve it or open it again; or start a run for one sent remark, with the model and the effort of its control. */
  act(id: number, action: RemarkAction, run?: unknown): void {
    if (this.changeId === undefined) return;
    if (action === 'resolve') this.store.closeThread(id);
    if (action === 'reopen') this.store.reopenThread(id);
    if (action === 'start') this.run(id, undefined, pickFrom(run));
    this.reload();
  }

  /** Starts a run for a sent remark: it continues the session of the change, or starts a new session of an app; `pick` is a model and an effort that he chose. */
  private run(id: number, newApp?: string, pick?: RunPick): void {
    startRun(this.store, id, (problem) => {
      if (problem) showRunProblem(problem, { app: newApp });
      this.reloadIfChanged();
    }, newApp, undefined, runModels(), commentRuns(), pick);
  }

  /**
   * Saves a comment or a reply. Sent to a new session, it starts that run. Sent to the session of the change, it starts a run that continues
   * that session at once; a session that listens takes the comment by itself, and one that cannot be continued waits for the owner.
   */
  saveRemark(message: NewRemark, changeId = this.changeId): void {
    if (changeId === undefined) return;
    const stored = this.store.getChange(changeId);
    const id = this.store.addRemark(changeId, stored ? withKept(message.target, keptInChange(stored, message.target)) : message.target, message.text, message.thread); // it keeps what its thing is now
    if (message.to) this.store.sendRemark(id, message.to);
    const agent = this.store.getChange(changeId)?.agent;
    if (message.to?.kind === 'new') this.run(id, message.to.app);
    else if (message.to?.kind === 'session') this.run(id); // another session that Apostil knows: a run continues it in the folder of the change
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
        // The blocks of the window of a target of the look, read when it opens (look-blocks.ts).
        else if (message.question.startsWith('blocks:')) this.post(view, { type: 'answer', id: message.id, value: blocksAnswer(this.store, page?.folder ?? this.openFolder(), message.question.slice('blocks:'.length), (file) => view.panel.webview.asWebviewUri(vscode.Uri.file(file)).toString()) });
        else this.post(view, { type: 'answer', id: message.id, value: this.page ? answer(this.page, message.question, (path, lines) => notesBeside(this.store, this.page!, path, lines), (path) => marksBeside(this.store, this.page!, path)) : undefined });
        break;
      case 'askAgent':
        await this.askAgent(message.words, message.team);
        break;
      case 'openAskSession': {
        // The worktree of a run for a pull request is gone when the run ended: the terminal then opens in the open folder.
        const run = askRunOf(this.store, this.openFolder(), message.words);
        openAgentSession(run?.agent, run?.folder && existsSync(run.folder) ? run.folder : this.openFolder());
        break;
      }
      case 'looked':
        this.store.setLooked(message.repo, message.number);
        break;
      case 'layout':
        this.layout.set(message.full);
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
        this.act(message.id, message.action, message.run);
        break;
      case 'openSession':
        openRemarkSession(this.store, message.id, this.openFolder());
        break;
      case 'target': // a click, a key or a menu entry of the look, on a note card: the same place as on Home (look-targets.ts)
        this.onTarget(message.target, message.diagram);
        break;
      case 'openLink':
        openLink(message.url);
        break;
      case 'connect':
        await vscode.commands.executeCommand('apostil.connectClaudeCode', this.page?.folder);
        break;
      case 'setUp': // the line of the picker when no agent app is connected
        await vscode.commands.executeCommand('apostil.setUp', this.page?.folder);
        break;
      case 'walk':
        this.trail?.walk(message.from, message.to, message.open);
        break;
      case 'back':
        this.trail?.back(message.to);
        break;
      case 'move':
        this.trail?.move(message.way, message.from);
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
