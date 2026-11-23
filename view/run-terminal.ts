// Runs Claude Code in a terminal of VS Code, which a person can watch and answer: the map run of Home, and a comment sent to a new session.

import * as vscode from 'vscode';
import { findOnPath } from '../shared/agents';
import { runEnvironment } from './agent-run';

const live = new Map<string, vscode.Terminal>(); // by session, while its terminal is open

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
  const closing = vscode.window.onDidCloseTerminal((one) => {
    if (one !== terminal) return;
    closing.dispose();
    live.delete(session);
    closed(one.exitStatus?.code);
  });
  return terminal;
}

/** Shows the open terminal of a session in this window; false when it has none. */
export function showLiveSession(session: string | undefined): boolean {
  const terminal = session && live.get(session);
  if (terminal) terminal.show();
  return !!terminal;
}
