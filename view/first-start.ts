// The first start after the look: one question that puts the apostil command on the path and sets up the agent apps.
// The commands "Install the apostil command" and "Connect Claude Code" stay for one of the two alone.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { tryGit } from '../shared/git';
import { connectClaudeCode } from '../store/connect-claude-code';
import { hasOlderCopy, setup, thisInstall } from '../store/setup';
import { askForLookOnce } from '../theme/choose-look';
import { commandFolders, installCommand, needsRefresh } from './install-command';

const COMMAND_KEY = 'apostil.askedForCommand'; // the question of earlier versions: a person who answered it is not asked again
const SETUP_KEY = 'apostil.askedForSetup';

const cliOf = (context: vscode.ExtensionContext): string => join(context.extensionUri.fsPath, 'out', 'store', 'cli.js');
/** An installed extension gets a launcher that runs on the program of the editor; a checkout (development mode) gets a link and needs Node 24. */
const programOf = (context: vscode.ExtensionContext): string | undefined => (context.extensionMode === vscode.ExtensionMode.Production ? process.execPath : undefined);
const machine = () => ({ home: homedir(), path: process.env.PATH ?? '' });
const repoOf = (folder?: string): string | undefined => (folder ? tryGit(folder, 'rev-parse', '--show-toplevel') : undefined);

let output: vscode.OutputChannel | undefined;
const outputChannel = (): vscode.OutputChannel => (output ??= vscode.window.createOutputChannel('Apostil'));

/** Installs the command and says where the link was made, or why not. */
function install(context: vscode.ExtensionContext): void {
  const result = installCommand(cliOf(context), undefined, undefined, programOf(context));
  if (result.link) void vscode.window.showInformationMessage(`Linked the apostil command at ${result.link}. "apostil ." opens a folder from a terminal.`);
  else void vscode.window.showWarningMessage(`The apostil command was not installed. ${result.problem}`);
}

/** Adds the hook to the settings of Claude Code after one question: for this repo, or for every repo. The folder is the repo of the open change. */
async function connect(context: vscode.ExtensionContext, folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath): Promise<void> {
  const choices = [...(folder ? ['This repo'] : []), 'All repos', 'Show what it adds'];
  const picked = await vscode.window.showInformationMessage('Add the Apostil hook to Claude Code? A session then gets the comments that you send to it, also when it is idle. The hook was not yet seen working in a session with a person.', ...choices);
  if (!picked) return;
  if (picked === 'Show what it adds') {
    await vscode.commands.executeCommand('markdown.showPreviewToSide', vscode.Uri.joinPath(context.extensionUri, 'skills', 'connect-claude-code.md'));
    return;
  }
  const result = connectClaudeCode(picked === 'This repo' ? folder : undefined);
  if (result.problem) void vscode.window.showWarningMessage(result.problem);
  else void vscode.window.showInformationMessage(`${result.added ? 'Added the hook to' : 'The hook is already in'} ${result.file}. A session of Claude Code that starts after this uses it.`);
}

/**
 * "Set up for agents": the command on the path, and the skills for this repo or for all repos.
 * "Show what it does" opens the page about it and asks again. The lines of setup go to the output "Apostil".
 * A given answer skips the question, for a check.
 */
async function setUp(context: vscode.ExtensionContext, folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, answer?: 'This repo' | 'All repos'): Promise<void> {
  const repo = repoOf(folder);
  const choices = [...(repo ? ['This repo'] : []), 'All repos'];
  const question = 'Set up Apostil for your agents? It puts the apostil command on the path and gives Claude Code and Codex the skills. The hook of Claude Code is a step of its own.';
  let picked = answer ?? await vscode.window.showInformationMessage(question, ...choices, 'Show what it does', 'Not now');
  if (picked === 'Show what it does') {
    const page = join(context.extensionUri.fsPath, 'skills', 'README.md'); // in the .vsix file this page is the readme.md of the extension
    await vscode.commands.executeCommand('markdown.showPreviewToSide', vscode.Uri.file(existsSync(page) ? page : join(context.extensionUri.fsPath, 'readme.md')));
    picked = await vscode.window.showInformationMessage(question, ...choices, 'Not now');
  }
  if (picked !== 'This repo' && picked !== 'All repos') return;
  const command = installCommand(cliOf(context), undefined, undefined, programOf(context));
  const done = setup({ install: thisInstall(context.extensionUri.fsPath), machine: machine(), repo: picked === 'This repo' ? repo : undefined });
  const channel = outputChannel();
  channel.appendLine(command.link ? `${'added'.padEnd(8)} the apostil command at ${command.link}` : `${'problem'.padEnd(8)} ${command.problem}`);
  for (const line of done.lines) channel.appendLine(line);
  const good = done.ok && !!command.link;
  // What comes next is a press, not words to type: Home of a repo with no map shows "Map this repo with …", and a new repo is asked once.
  const text = good ? `Apostil is set up for ${picked === 'This repo' ? 'this repo' : 'all repos'}.` : 'Apostil is not fully set up. The output "Apostil" says what is missing.';
  void (good ? vscode.window.showInformationMessage(text, 'Show details') : vscode.window.showWarningMessage(text, 'Show details')).then((show) => show && channel.show());
  void vscode.commands.executeCommand('apostil.refresh');
}

/** After an update the folder of the extension has a new name: the command is written again, and copies of the skills of the old version are made new. */
function refreshAfterUpdate(context: vscode.ExtensionContext): void {
  const install = thisInstall(context.extensionUri.fsPath);
  const repo = repoOf(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
  for (const scope of [...(repo ? [repo] : []), undefined]) {
    if (hasOlderCopy(install, machine(), scope)) setup({ install, machine: machine(), repo: scope });
  }
  const stale = commandFolders().some((folder) => needsRefresh(join(folder, 'apostil'), cliOf(context), programOf(context))); // a link to the old folder, or a script of the old install or editor
  if (stale) installCommand(cliOf(context), undefined, undefined, programOf(context));
}

/**
 * Registers the commands and asks the first-start questions in order: the look, then the set-up. The promise ends when no first-start question is open
 * any more, with true when the set-up question was asked now.
 */
export function registerFirstStart(context: vscode.ExtensionContext): Promise<boolean> {
  context.subscriptions.push(
    vscode.commands.registerCommand('apostil.installCommand', () => install(context)),
    vscode.commands.registerCommand('apostil.connectClaudeCode', (folder?: string) => connect(context, folder)),
    vscode.commands.registerCommand('apostil.setUp', (folder?: string, answer?: 'This repo' | 'All repos') => setUp(context, folder, answer)),
  );
  if (context.extensionMode === vscode.ExtensionMode.Test) return Promise.resolve(false); // a check answers its own questions, and must not set up the real home folder
  // Only an installed extension gets a new folder with an update; a checkout keeps its folder.
  if (context.extensionMode === vscode.ExtensionMode.Production) {
    try {
      refreshAfterUpdate(context);
    } catch {
      // a refresh that fails leaves things as they were; "apostil doctor" says what is missing
    }
  }
  return (async () => {
    await askForLookOnce(context);
    if (context.globalState.get(COMMAND_KEY) || context.globalState.get(SETUP_KEY)) return false;
    await context.globalState.update(SETUP_KEY, true);
    await setUp(context);
    return true;
  })();
}
