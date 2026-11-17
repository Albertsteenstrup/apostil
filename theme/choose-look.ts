import * as vscode from 'vscode';

export type Look = 'apostil' | 'default' | 'computer';

export const APOSTIL_THEME = 'Apostil Light';
const ASKED_KEY = 'apostil.askedForLook';

// The default dark theme of the VS Code that runs, read from its own setting default.
export function defaultDarkTheme(): string {
  const setting = vscode.workspace.getConfiguration().inspect<string>('workbench.preferredDarkColorTheme');
  return setting?.defaultValue ?? 'Default Dark Modern';
}

// Write the user settings that one look needs.
export async function applyLook(look: Look): Promise<void> {
  const settings = vscode.workspace.getConfiguration();
  const set = (name: string, value: unknown) => settings.update(name, value, vscode.ConfigurationTarget.Global);

  if (look === 'computer') {
    await set('window.autoDetectColorScheme', true);
    await set('workbench.preferredLightColorTheme', APOSTIL_THEME);
    await set('workbench.preferredDarkColorTheme', defaultDarkTheme());
    return;
  }
  await set('window.autoDetectColorScheme', false);
  await set('workbench.colorTheme', look === 'apostil' ? APOSTIL_THEME : defaultDarkTheme());
}

const LOOKS: { look: Look; label: string; detail: string }[] = [
  { look: 'apostil', label: 'Apostil', detail: 'Paper and stone colours with one teal accent.' },
  { look: 'default', label: 'VS Code default', detail: 'The dark theme that comes with VS Code.' },
  { look: 'computer', label: 'Same as the computer', detail: 'Apostil when the computer is light, VS Code dark when it is dark.' },
];

// Show the three looks and apply the one that is picked.
async function chooseLook(): Promise<void> {
  const picked = await vscode.window.showQuickPick(LOOKS, { title: 'Choose a look', placeHolder: 'How should VS Code look?' });
  if (picked) await applyLook(picked.look);
}

// Register the command that shows the three looks.
export function registerLookChoice(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('apostil.chooseLook', chooseLook));
}

// Ask for the look at the first start, once. It ends when the owner picked a look or closed the question.
export async function askForLookOnce(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get(ASKED_KEY)) return;
  await context.globalState.update(ASKED_KEY, true);
  await chooseLook();
}
