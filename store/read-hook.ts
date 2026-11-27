// "apostil read-hook": what a PreToolUse hook of Claude Code (matcher Bash) prints before a command runs: for a command that only reads files, the JSON that
// allows it, so that a map run does not wait for a person; else nothing, and Claude Code decides as it always did.
// It reads only its standard input, never the network or the store, never waits, and its caller ends with code 0 whatever the input is.

import { readsOnly } from '../shared/read-only-command';

/** What the hook says about a command: that it is allowed because it only reads. */
export const READ_HOOK_ALLOW = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'Apostil: the command only reads files' } };

/** What `apostil read-hook` prints for the JSON that the hook got on its standard input: the JSON that PreToolUse reads, or undefined for nothing. */
export function readHookCommand(stdin: string): string | undefined {
  try {
    const { tool_name: tool, tool_input: given } = (JSON.parse(stdin) ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const command = given?.command;
    return tool === 'Bash' && typeof command === 'string' && readsOnly(command) ? JSON.stringify(READ_HOOK_ALLOW) : undefined;
  } catch {
    return undefined;
  }
}
