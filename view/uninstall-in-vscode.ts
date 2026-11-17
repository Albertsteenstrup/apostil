// "Apostil: Uninstall…" for a person with no agent: the list of the dry run, one question about the store, then the uninstall.
// VS Code itself takes away Apostil's settings and the extension, so a settings file with comments is no problem.

import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { storeFolder } from '../shared/store';
import { line, thisInstall } from '../store/setup';
import { EXTENSION_ID, isApostilSetting, storeFacts, THEME_SETTINGS, uninstall } from '../store/uninstall';

let output: vscode.OutputChannel | undefined;

/** The user settings of this VS Code that Apostil wrote: its own, and a theme setting that names its theme. */
function apostilSettings(context: vscode.ExtensionContext): string[] {
  const own = Object.keys(context.extension.packageJSON?.contributes?.configuration?.properties ?? {});
  const settings = vscode.workspace.getConfiguration();
  return [...own, ...THEME_SETTINGS].filter((key) => {
    const value = settings.inspect(key)?.globalValue;
    return value !== undefined && isApostilSetting(key, value);
  });
}

async function uninstallApostil(context: vscode.ExtensionContext): Promise<void> {
  const home = homedir();
  const run = { machine: { home, path: process.env.PATH ?? '' }, install: thisInstall(context.extensionUri.fsPath), store: storeFolder(), folder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, inVsCode: true };
  const settings = apostilSettings(context);
  const settingsLine = settings.length ? line('removed', `The settings ${settings.join(', ')} in VS Code`) : line('nothing', 'Settings of Apostil in VS Code: none found.');
  const channel = (output ??= vscode.window.createOutputChannel('Apostil: Uninstall'));
  channel.clear();
  channel.appendLine('What "Apostil: Uninstall" takes away. Nothing has changed yet.');
  for (const one of [...uninstall({ ...run, dryRun: true }).lines, settingsLine, line('removed', 'The extension, through VS Code')]) channel.appendLine(one);
  channel.show(true);

  // One question, which the person started: keep the store, or delete it too.
  const facts = storeFacts(run.store, home);
  const keep = 'Uninstall, keep my data';
  const remove = 'Uninstall and delete my data';
  const detail = `The output "Apostil: Uninstall" lists what it takes away.${facts ? ` Your data stays unless you delete it too: ${facts}.` : ''}`;
  const picked = await vscode.window.showWarningMessage('Uninstall Apostil?', { modal: true, detail }, keep, ...(facts ? [remove] : []));
  if (!picked) return;

  const done = uninstall({ ...run, deleteData: picked === remove });
  for (const key of settings) await vscode.workspace.getConfiguration().update(key, undefined, vscode.ConfigurationTarget.Global);
  for (const key of context.globalState.keys()) await context.globalState.update(key, undefined); // a new install asks its first questions again
  channel.appendLine('');
  channel.appendLine('Done:');
  for (const one of [...done.lines, settingsLine]) channel.appendLine(one);
  let ok = done.ok;
  try {
    await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', EXTENSION_ID);
    channel.appendLine(line('removed', 'The extension, through VS Code'));
  } catch (error) {
    ok = false;
    channel.appendLine(line('left', `The extension: VS Code could not uninstall it (${error instanceof Error ? error.message : String(error)}). Open Extensions, find Apostil and press Uninstall.`));
  }
  const text = ok ? 'Apostil is uninstalled. Reload the window, and restart your agent apps.' : 'Apostil is uninstalled, but not all of it. The output "Apostil: Uninstall" says what is left.';
  if (await vscode.window.showInformationMessage(text, 'Reload Window')) void vscode.commands.executeCommand('workbench.action.reloadWindow');
}

/** Registers "Apostil: Uninstall…". */
export function registerUninstall(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('apostil.uninstall', () => uninstallApostil(context)));
}
