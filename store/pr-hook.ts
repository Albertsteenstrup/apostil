// "apostil pr-hook": what a PostToolUse hook of Claude Code (matcher Bash) prints after a command ran: when the agent opened a pull request with `gh pr create`,
// the JSON that tells it to describe the pull request now, with the skill apostil-describe-change; else nothing.
// It reads only its standard input, never the network or the store, never waits, and its caller ends with code 0 whatever the input is.
// With the links and nudges off it says nothing.

import { linksOn } from '../shared/apostil-link';
import { storeFolder } from '../shared/store';

/** The number of a pull request in a line that gh printed: ".../<owner>/<repo>/pull/<n>". */
const PULL_URL = /github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/;

/** What the agent is told after it opened pull request `number`. */
export const prHookText = (number: string): string =>
  `You opened pull request #${number}. Describe it now with the skill apostil-describe-change, as that skill says, before you end the turn. Its writer and checker subagents run on Haiku at xhigh effort.`;

/** The number of the pull request that a `gh pr create` opened, or undefined: another command, or one that printed no pull request address. */
export function openedPull(input: unknown): string | undefined {
  const { tool_name: tool, tool_input: given, tool_response: response } = (input ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (tool !== 'Bash' || !/\bgh\s+pr\s+create\b/.test(String(given?.command ?? ''))) return undefined;
  // gh prints the address on its standard output; a failed command prints its error on the other, which may name an older pull request.
  const printed = typeof response === 'string' ? response : response?.stdout;
  return PULL_URL.exec(String(printed ?? ''))?.[1];
}

/** What `apostil pr-hook` prints for the JSON that the hook got on its standard input: the JSON that PostToolUse reads, or undefined for nothing. */
export function prHookCommand(stdin: string, env: NodeJS.ProcessEnv = process.env, store = storeFolder()): string | undefined {
  try {
    const number = linksOn(env, store) ? openedPull(JSON.parse(stdin)) : undefined;
    return number && JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: prHookText(number) } });
  } catch {
    return undefined;
  }
}
