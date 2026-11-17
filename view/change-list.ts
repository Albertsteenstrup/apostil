// The list of changes in the sidebar: one row for each stored change of the repo that is open, under the head of its agent session.

import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { tryGit } from '../shared/git';
import type { Target } from '../shared/look';
import { ghArguments, pullRequestsFromJson, stackArguments, stackPlacesFromJson, withStacks, type PullRequest, type StackPlace } from '../shared/pull-requests';
import type { Store } from '../shared/store';
import { someAppSeesSkills, thisInstall } from '../store/setup';
import { openLink, webviewHtml } from './change-page';
import { homeRowState, idOf } from './home-data';
import { listRows, reopenStaleRuns, sessionGroups, type ListRow } from './list-rows';
import { savedLook } from './look-data';
import type { MenuMessage } from './sort-filter';

const KEEP_MS = 60_000;
const pullCache = new Map<string, { at: number; pulls: PullRequest[] }>();
const stackCache = new Map<string, { at: number; places: Promise<Map<number, StackPlace>> }>();

/** The output of gh in a folder, or '' when it fails. It does not block VS Code. */
const ghOut = (folder: string, args: string[]): Promise<string> => new Promise((done) => {
  execFile('gh', args, { cwd: folder, encoding: 'utf8', timeout: 5000 }, (error, out) => done(error ? '' : out));
});

/** The places of the pull requests of the repo in their stacks, asked once for a folder (and repo) and kept for 60 seconds. */
function stackPlacesLater(folder: string, repo?: string): Promise<Map<number, StackPlace>> {
  const key = `${folder}\n${repo ?? ''}`;
  const kept = stackCache.get(key);
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.places;
  const places = ghOut(folder, stackArguments(repo)).then(stackPlacesFromJson);
  stackCache.set(key, { at: Date.now(), places });
  return places;
}

/**
 * The pull requests of a branch with their places in a stack, kept for 60 seconds. It asks gh as pullRequestsOf() does, but without blocking VS Code.
 * With a repo ("owner/name"), of that repo: in a clone of a fork, origin is the fork and the pull request is in another remote.
 */
export function pullRequestsLater(folder: string, branch: string, repo?: string): Promise<PullRequest[]> {
  const key = `${folder}\n${branch}\n${repo ?? ''}`;
  const kept = pullCache.get(key);
  if (kept && Date.now() - kept.at < KEEP_MS) return Promise.resolve(kept.pulls);
  return Promise.all([ghOut(folder, ghArguments(branch, repo)), stackPlacesLater(folder, repo)]).then(([out, places]) => {
    let pulls: PullRequest[] = [];
    try { pulls = withStacks(pullRequestsFromJson(out), places); } catch { /* not JSON: no pull requests */ }
    pullCache.set(key, { at: Date.now(), pulls });
    return pulls;
  });
}

/** True when no agent app on this machine sees the Apostil skills for the repo of the folder: Home with no map then shows "Set up for agents". */
export function agentsNeedSetup(folder: string): boolean {
  return !someAppSeesSkills(thisInstall(), { home: homedir(), path: process.env.PATH ?? '' }, folder ? tryGit(folder, 'rev-parse', '--show-toplevel') : undefined);
}

/** The link of the next step on Home with no map (nextStepsHtml in tools.js): runs its command, and says whether the message was it. */
export function runNextStep(type: string): boolean {
  const command = ({ setUp: 'apostil.setUp' } as Record<string, string>)[type];
  if (command) void vscode.commands.executeCommand(command);
  return !!command;
}

/** The search of the list: the text of the field and the sort. It is kept for each repo in the state of the workspace. */
export interface ListSearch {
  text: string;
  sort: string; // "modified", "created", "author" or "size" (media/search.js)
  reverse: boolean;
}

/** The sidebar view. Nothing opens by itself: a click on a row opens its page. */
export class ChangeList implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private signature = '';
  private sentRows: ListRow[] = [];
  private searchKey = ''; // where the search of the repo of the open folder is kept, set with each refresh
  onMenu: (menu: MenuMessage) => void = () => {}; // the icon of the field was pressed: VS Code shows its quick pick
  private askWhenDrawn = false; // "Sort and Filter" was asked before the view was there
  shown = 0; // how many rows the view drew last, for the check inside VS Code
  pulls: Record<string, PullRequest[]> = {}; // the pull requests that the view got, by branch, for the check inside VS Code
  onTarget: (target: Target) => void = () => {}; // a click of the look on a part of the list (look-targets.ts); set by the extension

  constructor(
    private media: vscode.Uri, private store: Store, private openFolder: () => string, private openChange: (id: number) => void, private openHome: () => void = () => {},
    private openPull: (id: number, number: number) => void = () => {}, // a pull request of a row: the page of its change at "Conversation"
    private memory?: vscode.Memento, // the state of the workspace, where the search of each repo is kept
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.media] };
    view.webview.html = webviewHtml(view.webview, this.media, 'list.html');
    view.webview.onDidReceiveMessage((message: { type: string; id?: number; rows?: number; url?: string; number?: number; search?: ListSearch; values?: MenuMessage['values']; target?: Target }) => {
      if (message.type === 'target' && message.target) this.onTarget(message.target);
      if (message.type === 'ready') this.refresh();
      if (message.type === 'open' && message.id !== undefined) this.openChange(message.id);
      if (message.type === 'openPull' && message.id !== undefined && message.number !== undefined) this.openPull(message.id, message.number);
      if (message.type === 'home') this.openHome();
      if (message.type === 'openLink' && message.url) openLink(message.url);
      if (message.type === 'search' && message.search) void this.memory?.update(this.searchKey, message.search);
      if (message.type === 'menu' && message.values && message.search) this.onMenu({ values: message.values, search: message.search });
      if (message.type === 'rendered') {
        this.shown = message.rows ?? 0;
        if (this.askWhenDrawn) { this.askWhenDrawn = false; this.askMenu(); }
        this.loadPulls();
      }
    });
    view.onDidChangeVisibility(() => { if (view.visible) this.refresh(); });
  }

  /** A new search from outside the view (a pick in the quick pick): kept for the repo, and the view draws it. */
  setSearch(search: ListSearch): void {
    void this.memory?.update(this.searchKey, search);
    void this.view?.webview.postMessage({ type: 'search', search });
  }

  /** The command "Apostil: Sort and Filter the Changes": the view sends its values and search, as when its icon is pressed. */
  async askMenu(): Promise<void> {
    const there = !!this.view;
    await vscode.commands.executeCommand('apostil.changes.focus');
    if (there) void this.view?.webview.postMessage({ type: 'askMenu' });
    else this.askWhenDrawn = true;
  }

  rows(): ListRow[] {
    const folder = this.openFolder();
    if (!folder) return [];
    const rows = listRows(this.store, folder);
    for (const row of rows) if (row.id !== undefined) reopenStaleRuns(this.store, row.id);
    return rows.some((row) => row.remarks.running) ? listRows(this.store, folder) : rows; // a reopened run changes the counts
  }

  /** Sends the rows to the view, grouped by agent session. */
  refresh(): void {
    if (!this.view?.visible) return;
    const folder = this.openFolder();
    const repo = folder ? (tryGit(folder, 'rev-parse', '--show-toplevel') ?? folder).split('/').pop() : '';
    this.signature = this.signatureNow();
    this.sentRows = this.rows();
    this.searchKey = `apostil.listSearch:${(folder && idOf(folder)) || folder}`;
    const id = folder ? idOf(folder) : undefined;
    const look = id ? savedLook(this.store, id, folder) : undefined; // the look of the repo for the rows, when one is saved
    // homeState: what the row "Home" says while a map run writes the map of the repo.
    this.view.webview.postMessage({ type: 'rows', repo, groups: sessionGroups(this.sentRows), search: this.memory?.get<ListSearch>(this.searchKey), look, homeState: homeRowState(this.store, id) });
  }

  /** After the list is drawn: the pull requests of each branch, one message for each branch that has some. */
  private loadPulls(): void {
    for (const row of this.sentRows) {
      void pullRequestsLater(row.folder, row.branch).then((pulls) => {
        if (!pulls.length) return;
        this.pulls[row.branch] = pulls;
        this.view?.webview.postMessage({ type: 'pulls', branch: row.branch, pulls });
      });
    }
  }

  /** Refreshes when the stored changes of the repo or the states of their remarks differ from the last time. */
  refreshIfChanged(): void {
    if (this.signatureNow() !== this.signature) this.refresh();
  }

  private signatureNow(): string {
    const folder = this.openFolder();
    const id = folder ? idOf(folder) : undefined;
    return JSON.stringify(id ? [this.store.getLook(id)?.savedAt, homeRowState(this.store, id), ...this.store.listChanges(id).map((change) => [
      change.id, change.savedAt, change.head, change.checks.filesInNoPart.length, change.agent,
      this.store.remarks(change.id).map((remark) => remark.state).join(),
    ])] : []);
  }
}
