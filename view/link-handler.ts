// Opens Apostil from a link (vscode://apostil.apostil/pull or /change) and from the icon in the title of Source Control.
// A link only opens views: it never runs a command, a check or an agent. The switch of the links hides the icon.

import { unwatchFile, watchFile } from 'node:fs';
import * as vscode from 'vscode';
import { linksOffFile, linksOn, readLink, setLinks } from '../shared/apostil-link';
import { repoId, tryGit } from '../shared/git';
import { githubRemotesOf } from '../shared/read-pull-request';
import type { Store } from '../shared/store';
import { pullRequestsLater } from './change-list';

/** The views that a link opens, from extension.ts. */
export interface LinkViews {
  store: Store;
  openFolder: () => string;
  openPullRequest: (text: string) => Promise<void>; // a number, "owner/name#12" or a link of a pull request
  openChange: (id: number) => void;
  openHome: () => void;
}

export function registerLinks(context: vscode.ExtensionContext, views: LinkViews): void {
  /** The change of a branch in the list; with none, Home and one line. */
  const openBranchChange = (folder: string, branch: string): void => {
    let id: number | undefined;
    try { id = views.store.findChange(repoId(folder), branch)?.id; } catch { /* not a Git repo */ }
    if (id !== undefined) return views.openChange(id);
    views.openHome();
    void vscode.window.showInformationMessage(`The change of ${branch} has no description yet.`);
  };

  const openLink = async (uri: vscode.Uri): Promise<void> => {
    const target = readLink(uri.path, uri.query);
    if (!target) return void vscode.window.showWarningMessage('Apostil cannot open this link: a field is missing or wrong.');
    // The open folder whose remote on GitHub is the repo of the link, also a remote other than origin (a fork).
    const repo = target.repo.toLowerCase();
    const folder = vscode.workspace.workspaceFolders?.map((one) => one.uri.fsPath)
      .find((path) => githubRemotesOf(path).some((remote) => remote.slug.toLowerCase() === repo));
    if (!folder) {
      const open = await vscode.window.showInformationMessage(`No open folder is the repo ${target.repo}.`, 'Open Folder…');
      if (open) void vscode.commands.executeCommand('vscode.openFolder');
      return;
    }
    if (target.open === 'change') return openBranchChange(folder, target.branch!);
    if (target.number !== undefined) return views.openPullRequest(`${target.repo}#${target.number}`);
    // A branch: its pull request in the repo of the link, asked of GitHub as the list asks (kept for 60 seconds). An open one first.
    const pulls = await pullRequestsLater(folder, target.branch!, target.repo);
    const pull = pulls.find((one) => one.state !== 'merged' && one.state !== 'closed') ?? pulls[0];
    if (pull) return views.openPullRequest(pull.url);
    void vscode.window.showInformationMessage(`The branch ${target.branch} has no pull request on GitHub.`);
  };

  /** The icon in the title of Source Control: the change of the branch of the open folder. */
  const openThisBranch = (): void => {
    const folder = views.openFolder();
    const branch = folder ? tryGit(folder, 'branch', '--show-current') : undefined;
    if (branch) openBranchChange(folder, branch);
    else void vscode.window.showInformationMessage('No branch is checked out here.');
  };

  // The switch: the icon shows while the links are on. "apostil links off" in a terminal turns it too, so its file is watched.
  const showSwitch = (): void => { void vscode.commands.executeCommand('setContext', 'apostil.linksOff', !linksOn()); };
  const turn = (on: boolean): void => { setLinks(on); showSwitch(); };
  showSwitch();
  watchFile(linksOffFile(), { interval: 2000 }, showSwitch);

  context.subscriptions.push(
    vscode.window.registerUriHandler({ handleUri: (uri) => openLink(uri) }),
    vscode.commands.registerCommand('apostil.openBranchChange', () => openThisBranch()),
    vscode.commands.registerCommand('apostil.linksOff', () => turn(false)),
    vscode.commands.registerCommand('apostil.linksOn', () => turn(true)),
    { dispose: () => unwatchFile(linksOffFile(), showSwitch) },
  );
}
