// Runs Claude Code in a terminal of VS Code, which a person can watch and answer: the map run of Home, and a comment sent to a new or a known session.

import * as vscode from 'vscode';
import { findOnPath } from '../shared/agents';
import { runEnvironment, type RunTerminals } from './agent-run';

const live = new Map<string, vscode.Terminal>(); // by session, while its terminal is open
const PASTE = ['\x1b[200~', '\x1b[201~']; // the start and the end of a bracketed paste: the lines of a message stay one message

/**
 * Starts a command of a session in a terminal of VS Code that is not shown; `closed` gets its exit code when the terminal closes.
 * Undefined when its program is not on the path or the terminal cannot be made.
 */
export function runInTerminal(command: string[], folder: string, name: string, session: string, closed: (code?: number) => void, icon = 'comment'): vscode.Terminal | undefined {
  const program = findOnPath(command[0], process.env.PATH ?? '');
  if (!program) return undefined;
  let terminal: vscode.Terminal;
  try {
    terminal = vscode.window.createTerminal({ name, cwd: folder, shellPath: program, shellArgs: command.slice(1), env: runEnvironment(), iconPath: new vscode.ThemeIcon(icon) });
  } catch {
    return undefined;
  }
  live.set(session, terminal);
  whenClosed(terminal, (code) => {
    live.delete(session);
    closed(code);
  });
  return terminal;
}

/** Types a message into the open terminal of a session, with Enter; `closed` gets the exit code when that terminal closes. Undefined when this window has none. */
function typeInSession(session: string, text: string, closed: (code?: number) => void): vscode.Terminal | undefined {
  const terminal = live.get(session);
  if (!terminal) return undefined;
  terminal.sendText(`${PASTE[0]}${text}${PASTE[1]}`);
  whenClosed(terminal, closed);
  return terminal;
}

/** The terminals that a run for a comment uses (startRun in view/agent-run.ts). */
export const runTerminals: RunTerminals = { start: runInTerminal, type: typeInSession };

/** Calls `closed` with the exit code of a terminal when it closes. */
function whenClosed(terminal: vscode.Terminal, closed: (code?: number) => void): void {
  const closing = vscode.window.onDidCloseTerminal((one) => {
    if (one !== terminal) return;
    closing.dispose();
    closed(one.exitStatus?.code);
  });
}

/** Shows the open terminal of a session in this window; false when it has none. */
export function showLiveSession(session: string | undefined): boolean {
  const terminal = session && live.get(session);
  if (terminal) terminal.show();
  return !!terminal;
}
