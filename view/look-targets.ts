// Where a click, a key or a menu entry of a look goes, in the extension: one function for the messages of every page (Home, the graphs page, the
// change page and the file tab), which send { type: 'target', target } from Marks.act in view/media/marks.js. A look runs nothing by itself:
// a web address opens and a prompt is sent only after VS Code asks, and a command runs only when it is one of LOOK_COMMANDS.

import * as vscode from 'vscode';
import { LOOK_COMMANDS, type Target } from '../shared/look';
import { askAndOpen } from './change-page';
import { appName } from './run-settings';
import type { Step } from './trail';

/** What the extension can open for a target: wired in extension.ts, which owns the tabs, the path of the window and the tree "Files". */
export interface TargetPlaces {
  openFile(path: string, line?: number): void; // as a file opens from Home: in the file tab when it has notes
  openStep(step: Step): void; // a view of Apostil, as a new path from outside a page
  showInTree(paths: string[]): void;
  changeOfBranch(branch: string): { id: number; title: string; parts: { id: string; name: string }[] } | undefined;
  openPull(number: number): void; // as "Apostil: Open pull request…" opens it
  app?: string; // the agent app that a prompt goes to: the first that is on the path
  sendPrompt(text: string, diagram?: string): void; // a new session of that app, as a comment on the map is sent
}

/** The question before a prompt goes to the agent: the whole words, and "Send". Nothing is sent without "Send". */
export const PROMPT_SEND = 'Send';

/** Does what a target of the look says. `diagram` is the diagram that the page showed, for a prompt. */
export async function answerTarget(target: Target, places: TargetPlaces, diagram?: string): Promise<void> {
  if (target.file) return places.openFile(target.file, target.line);
  if (target.url) return askAndOpen(target.url);
  if (target.command) {
    // A command that changes the computer is refused by the save; one saved by an older build does nothing.
    if (LOOK_COMMANDS.includes(target.command)) await vscode.commands.executeCommand(target.command);
    return;
  }
  if (target.prompt) {
    const app = places.app;
    if (!app) return void vscode.window.showInformationMessage('No agent app is on the path to send this to.');
    const answer = await vscode.window.showInformationMessage(`Send this to a new session of ${appName(app)}?`, { modal: true, detail: target.prompt }, PROMPT_SEND);
    if (answer === PROMPT_SEND) places.sendPrompt(target.prompt, diagram);
    return;
  }
  if (target.place) return places.openStep({ tab: 'home', diagram: target.place.diagram, lit: target.place.node ? [target.place.node] : [], name: target.place.diagram });
  if (target.graphs) return places.openStep({ tab: 'graphs', path: target.graphs, name: target.graphs });
  if (target.folder) return places.showInTree([target.folder]);
  if (target.change) {
    const change = places.changeOfBranch(target.change);
    if (!change) return void vscode.window.showInformationMessage(`The branch ${target.change} has no saved change.`);
    const part = change.parts.find((one) => one.id === target.part);
    return places.openStep({ tab: 'change', change: change.id, go: part ? { level: 'part', part: part.id } : { level: 'change' }, name: part?.name ?? change.title });
  }
  if (target.pull) places.openPull(target.pull);
}
