// The file icon theme that he uses now (build 85): `workbench.iconTheme`, read from the extension that contributes it, and the languages that VS Code
// gives files. Home and the page of a change get the icons of their rows from it (file-icons.ts), and show the new ones when he changes the theme.

import { join } from 'node:path';
import * as vscode from 'vscode';
import { iconsFor, languagesOf, readIconTheme, type FileIcons, type IconTheme, type Languages, type ThemeKind } from './file-icons';

/** The kind of the colour theme of now, for the parts of an icon theme. */
function kindNow(): ThemeKind {
  const kind = vscode.window.activeColorTheme.kind;
  if (kind === vscode.ColorThemeKind.Light) return 'light';
  return kind === vscode.ColorThemeKind.HighContrast || kind === vscode.ColorThemeKind.HighContrastLight ? 'contrast' : 'dark';
}

type Read = { id: string | null; theme?: IconTheme; root?: vscode.Uri };

class FileIconTheme {
  private read?: Read;
  private languages?: Languages;
  private readonly changed = new vscode.EventEmitter<void>();
  /** He changed the icon theme or the colour theme, or the extensions changed: open pages take their icons again. */
  readonly onChange = this.changed.event;

  /** Starts to follow the settings and the extensions. */
  start(context: vscode.ExtensionContext): void {
    const again = (forget: boolean): void => { if (forget) { this.read = undefined; this.languages = undefined; } this.changed.fire(); };
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => { if (event.affectsConfiguration('workbench.iconTheme')) again(true); }),
      vscode.window.onDidChangeActiveColorTheme(() => again(false)),
      vscode.extensions.onDidChange(() => again(true)),
      this.changed,
    );
  }

  /** The theme of the setting; none for null, for a theme that no extension contributes, or for one that cannot be read. */
  private now(): Read {
    const id = vscode.workspace.getConfiguration('workbench').get<string | null>('iconTheme') ?? null;
    if (this.read?.id === id) return this.read;
    this.read = { id };
    for (const extension of id ? vscode.extensions.all : []) {
      const themes: unknown = extension.packageJSON?.contributes?.iconThemes;
      const found = Array.isArray(themes) ? themes.find((one) => one?.id === id && typeof one.path === 'string') : undefined;
      if (!found) continue;
      const theme = readIconTheme(join(extension.extensionPath, found.path));
      if (theme) this.read = { id, theme, root: extension.extensionUri };
      break;
    }
    return this.read;
  }

  /** The folder of the extension of the theme: a page needs it among its local resource roots to load the icons. */
  root(): vscode.Uri | undefined {
    return this.now().root;
  }

  /** The icons of these paths for a page (only these), by the addresses of that page; undefined with no theme. */
  iconsFor(paths: string[], webview: vscode.Webview): FileIcons | undefined {
    const { theme } = this.now();
    if (!theme || !paths.length) return undefined;
    this.languages ??= languagesOf(vscode.extensions.all.map((extension) => extension.packageJSON));
    return iconsFor(theme, paths, kindNow(), this.languages, (file) => webview.asWebviewUri(vscode.Uri.file(file)).toString());
  }
}

export const fileIcons = new FileIconTheme();

/**
 * The options of a page of Apostil: its own files and the kept files of the looks, and the folder of the icon theme. New options make VS Code load the
 * page again, so they are set only when they differ: true then.
 */
export function pageOptions(webview: vscode.Webview, roots: vscode.Uri[]): boolean {
  const root = fileIcons.root();
  const wanted = [...roots, ...(root ? [root] : [])];
  const now = webview.options.localResourceRoots ?? [];
  if (now.length === wanted.length && now.every((one, at) => one.toString() === wanted[at].toString()) && webview.options.enableScripts) return false;
  webview.options = { enableScripts: true, localResourceRoots: wanted };
  return true;
}
