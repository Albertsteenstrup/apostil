// What opens by itself: Home in place of the empty editor area, where VS Code shows its own logo, in a window on a Git repo with no tab, and again
// when the last tab closes. Home that the person closed stays closed. With a first page in the look of the repo (build 62), that view opens once when
// the window starts, beside the tabs that VS Code brought back, and in an empty editor area in place of Home. The setting apostil.homeWhenEmpty turns
// all of it off. The rule of what opens is whatOpens() in look-of-vscode.ts.

import * as vscode from 'vscode';
import { tryGit } from '../shared/git';
import type { Target } from '../shared/look';
import { viewOf, whatOpens, type Opens, type TabNow } from './look-of-vscode';

const START_MS = 1500; // VS Code puts back the tabs of the last time a moment after the extension starts: Home waits until no tab came for this long
const CLOSE_MS = 300; // the tabs that close together (Close All, a moved tab) are one closing

/** A tab as the rule reads it: Home, the graphs of a path, a page of the look (another webview of Apostil, by its title), or another tab. */
function tabNow(tab: vscode.Tab): TabNow {
  const type = tab.input instanceof vscode.TabInputWebview ? tab.input.viewType : '';
  const kind = type.endsWith('apostil.home') ? 'home' : type.endsWith('apostil.graphs') ? 'graphs' : /apostil\./.test(type) ? 'page' : 'other';
  return { kind, name: tab.label };
}
const tabsNow = (): TabNow[] => vscode.window.tabGroups.all.flatMap((group) => group.tabs).map(tabNow);

/**
 * Watches the tabs of the window. `open` opens what the rule says without taking the keyboard; `firstPage` gives the first page of the look of the
 * repo and its pages. The command apostil.runStartStep (not in the palette) runs the start step again, for the window check.
 */
export function registerHomeWhenEmpty(context: vscode.ExtensionContext, openFolder: () => string, open: (what: NonNullable<Opens>) => void,
  firstPage: () => { first?: Target; pages: { id: string; title: string }[] }): void {
  const wanted = (): boolean => vscode.workspace.getConfiguration('apostil').get('homeWhenEmpty', true)
    && !!openFolder() && !!tryGit(openFolder(), 'rev-parse', '--show-toplevel');
  let started = false;
  let closedOwn = false; // in the closing that goes on now, the person closed the view that would open (Home, or the first page)
  let timer = setTimeout(() => start(), START_MS);
  const start = (): void => {
    started = true;
    const what = whatOpens({ tabs: tabsNow(), ...firstPage(), on: wanted(), start: true });
    if (what) open(what);
  };
  context.subscriptions.push(
    { dispose: () => clearTimeout(timer) },
    vscode.commands.registerCommand('apostil.runStartStep', () => start()),
    vscode.window.tabGroups.onDidChangeTabs((event) => {
      if (!started) {
        clearTimeout(timer);
        return void (timer = setTimeout(() => start(), START_MS));
      }
      if (!event.closed.length) return;
      const { first, pages } = firstPage();
      const own: TabNow = first ? viewOf(first, pages) : { kind: 'home', name: 'Home' };
      closedOwn ||= event.closed.map(tabNow).some((tab) => tab.kind === own.kind && (own.kind === 'home' || tab.name === own.name));
      clearTimeout(timer);
      timer = setTimeout(() => {
        const what = whatOpens({ tabs: tabsNow(), first, pages, on: wanted() && !closedOwn, start: false });
        if (what) open(what);
        closedOwn = false;
      }, CLOSE_MS);
    }),
  );
}
