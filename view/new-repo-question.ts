// One question in a repo with no map, once for a repo, after the first-start questions: a new session of an agent app that says "Map this repo for Apostil."
// Only an app that is connected is offered, Claude Code first. With no app connected, the question that connects them comes first.
// An answer starts the run that "Map this repo with …" on Home starts. Home keeps that press, so "Not now" loses nothing.

import * as vscode from 'vscode';
import { APP_NAMES } from '../shared/agents';
import { baseOf, changedFiles, currentBranch, repoId, tryGit } from '../shared/git';
import type { Store } from '../shared/store';
import { connectedApps, newRepoStep } from './new-repo-steps';

export const NEW_REPO_QUESTION = 'This repo has no map and no notes yet. Start a new session with "Map this repo for Apostil."?';
const askedKey = (repo: string): string => `apostil.askedForMap.${repo}`; // by the first commit, so that every worktree of a repo counts as one

/** True when the branch has changed files that no saved change describes: the run then describes them after the map. */
function hasUndescribedChange(root: string): boolean {
  try {
    return changedFiles(root, baseOf(root, currentBranch(root))).length > 0;
  } catch {
    return false;
  }
}

/**
 * Asks once in a Git repo with a commit and no map, when an agent app is on the path. `setUpAskedNow` says that the set-up question of the first
 * start was open a moment ago. The repo counts as asked before a question shows, so that a question closed with no answer does not come back either.
 */
export async function askOnceInNewRepo(context: vscode.ExtensionContext, store: Store, folder: string, apps: string[], setUpAskedNow: boolean, start: (app: string, describe: boolean) => void): Promise<void> {
  const root = folder && tryGit(folder, 'rev-parse', '--show-toplevel');
  if (!root || !tryGit(root, 'rev-parse', '--verify', '--quiet', 'HEAD') || !apps.length) return; // no repo, or a repo with no commit
  const repo = repoId(root);
  const step = newRepoStep({ map: !!store.getMap(repo), asked: !!context.globalState.get(askedKey(repo)), connected: connectedApps(apps, root).length, setUpAskedNow });
  if (step === 'nothing' || step === 'wait') return;
  await context.globalState.update(askedKey(repo), true);
  if (step === 'connect') await vscode.commands.executeCommand('apostil.setUp', root); // the set-up question: the command on the path and the skills for Claude Code and Codex
  const connected = connectedApps(apps, root);
  if (!connected.length) return; // he did not connect an app: Home keeps its actions
  const actions = connected.map((app) => `New ${APP_NAMES[app] ?? app} session`);
  const picked = await vscode.window.showInformationMessage(NEW_REPO_QUESTION, ...actions, 'Not now');
  const app = connected[actions.indexOf(picked ?? '')];
  if (app) start(app, hasUndescribedChange(root));
}
