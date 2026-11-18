// What the owner set in VS Code for the agent runs that Apostil starts, and how the problem of a run is shown.

import * as vscode from 'vscode';
import { APP_NAMES, findOnPath, runProblem, type RunModels } from '../shared/agents';
import { tryGit } from '../shared/git';
import { addAllowRules, keepOutOfGit, settingsFile } from '../store/connect-claude-code';

const CLAUDE_MODEL = 'apostil.claudeModel';
const CODEX_MODEL = 'apostil.codexModel';
const COMMENT_RUNS = 'apostil.commentRuns';

/** A model setting: its value ("haiku" and "gpt-6-luna" by default, the small models of SMALL_MODELS), or undefined when the owner emptied it: the app then takes the model of its own settings. */
const modelSetting = (name: string): string | undefined => vscode.workspace.getConfiguration().get<string>(name)?.trim() || undefined;

/** The models of every run that Apostil starts, for Claude Code and for Codex; OpenCode takes the small model of its own config (opencodeSmallModel). */
export const runModels = (): RunModels => ({ claude: modelSetting(CLAUDE_MODEL), codex: modelSetting(CODEX_MODEL) });

/** What a run that a comment starts may do in the repo: "read and edit" (the default) or "read only". */
export const commentRuns = (): string => (vscode.workspace.getConfiguration().get<string>(COMMENT_RUNS) === 'read only' ? 'read only' : 'read and edit');

/** The name of an app as a person reads it: "Claude Code" for claude-code. */
export const appName = (app: string): string => APP_NAMES[app] ?? app;

/** True when the command apostil is on the path of VS Code: a run that writes the map saves it with that command. */
export const apostilOnPath = (): boolean => !!findOnPath('apostil', process.env.PATH ?? '');

/** Opens a terminal with a command, typed and started, as a person would. */
function runInTerminal(name: string, command: string): void {
  const terminal = vscode.window.createTerminal(name);
  terminal.show();
  terminal.sendText(command, true);
}

let runOutput: vscode.OutputChannel | undefined;

/**
 * Shows why a run gave no answer, with its buttons: the words, the buttons and what each one does are data (`runProblem` in shared/agents.ts);
 * this carries out the one that he presses. With `again`, "Try again" starts the same run once more.
 */
export function showRunProblem(problem: string, options: { app?: string; again?: () => void; denied?: string[]; folder?: string; output?: string; errors?: string; noCommand?: boolean; instead?: { app: string; start: () => void } } = {}): void {
  const app = options.app ?? '';
  const said = (options.errors ?? '').trim() || (options.output ?? '').trim();
  const { say, buttons } = runProblem(problem, { app, again: !!options.again, denied: options.denied, noCommand: options.noCommand, instead: options.instead?.app, said });
  void vscode.window.showWarningMessage(say, ...buttons.map((button) => button.label)).then(async (choice) => {
    const deed = buttons.find((button) => button.label === choice)?.deed;
    if (deed?.do === 'again') options.again?.();
    if (deed?.do === 'model') void vscode.commands.executeCommand('workbench.action.openSettings', CODEX_MODEL);
    if (deed?.do === 'page') void vscode.env.openExternal(vscode.Uri.parse(deed.address));
    if (deed?.do === 'instead') options.instead?.start();
    if (deed?.do === 'terminal') {
      runInTerminal(deed.name, deed.command);
      // The sign-in happens in the terminal and the browser; when it is done, one click starts the same run again.
      if (deed.thenAgain && (await vscode.window.showInformationMessage(`${deed.name} in the terminal, then press Try again.`, 'Try again')) === 'Try again') options.again?.();
    }
    if (deed?.do === 'allow') {
      const root = options.folder && tryGit(options.folder, 'rev-parse', '--show-toplevel');
      if (!root) return;
      const done = addAllowRules(settingsFile(root), options.denied ?? []);
      if (done.problem) return void vscode.window.showWarningMessage(done.problem);
      keepOutOfGit(root);
      options.again?.();
    }
    if (deed?.do === 'set-up') {
      await vscode.commands.executeCommand('apostil.setUp', options.folder);
      if (apostilOnPath()) options.again?.();
    }
    if (deed?.do === 'output') {
      runOutput ??= vscode.window.createOutputChannel('Apostil: the last run');
      runOutput.clear();
      runOutput.appendLine(`What ${appName(app) || 'the program'} said at the end of its run:`);
      runOutput.appendLine(deed.text);
      runOutput.show();
    }
  });
}
