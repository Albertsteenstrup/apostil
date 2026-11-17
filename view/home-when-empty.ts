// Home in place of the empty editor area, where VS Code shows its own logo: in a window on a Git repo with no tab,
// and again when the last tab closes. Home that the person closed stays closed. The setting apostil.homeWhenEmpty turns this off.

import * as vscode from 'vscode';
import { tryGit } from '../shared/git';

const START_MS = 1500; // VS Code puts back the tabs of the last time a moment after the extension starts: Home waits until no tab came for this long
const CLOSE_MS = 300; // the tabs that close together (Close All, a moved tab) are one closing

const tabCount = (): number => vscode.window.tabGroups.all.reduce((count, group) => count + group.tabs.length, 0);
const isHome = (tab: vscode.Tab): boolean => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith('apostil.home');

/** Watches the tabs of the window. `openHome` opens Home without taking the keyboard. */
export function registerHomeWhenEmpty(context: vscode.ExtensionContext, openFolder: () => string, openHome: () => void): void {
  const wanted = (): boolean => vscode.workspace.getConfiguration('apostil').get('homeWhenEmpty', true)
    && !!openFolder() && !!tryGit(openFolder(), 'rev-parse', '--show-toplevel');
  let started = false;
  let closedHome = false; // in the closing that goes on now, the person closed Home
  let timer = setTimeout(() => start(), START_MS);
  const start = (): void => {
    started = true;
    if (tabCount() === 0 && wanted()) openHome();
  };
  context.subscriptions.push(
    { dispose: () => clearTimeout(timer) },
    vscode.window.tabGroups.onDidChangeTabs((event) => {
      if (!started) {
        clearTimeout(timer);
        return void (timer = setTimeout(() => start(), START_MS));
      }
      if (!event.closed.length) return;
      closedHome ||= event.closed.some(isHome);
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (tabCount() === 0 && !closedHome && wanted()) openHome();
        closedHome = false;
      }, CLOSE_MS);
    }),
  );
}
