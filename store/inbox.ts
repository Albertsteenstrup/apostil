// The inbox: finds the remarks that the owner sent to a session and waits for them. A hook runs it for a live session.

import { aboutInChange, aboutMapTarget, changeOfFolder, earlierInThread } from '../shared/context';
import type { Remark, Store } from '../shared/store';

export const POLL_SECONDS = 2;

/** The sent remarks of a session. When no stored change has that session, the sent remarks of the change of the folder. */
export function sentRemarks(store: Store, session: string | undefined, folder: string): Remark[] {
  const changes = store.allChanges().filter((change) => session && change.agent?.session === session);
  const wanted = changes.length > 0 ? changes : [ownChange(store, folder)].filter((change) => change !== undefined);
  return wanted.flatMap((change) => store.remarks(change.id)).filter((remark) => remark.state === 'sent' && (!remark.to || remark.to.kind === 'current')); // another session gets its own run
}

/** The change of the branch in a folder, or undefined when the folder is not a Git repo. */
function ownChange(store: Store, folder: string) {
  try {
    return changeOfFolder(store, folder);
  } catch {
    return undefined;
  }
}

const placeOf = ({ target }: Remark): string =>
  [target.part && `part ${target.part}`, target.file && `${target.file}${target.lines ? ` lines ${target.lines[0]}-${target.lines[1]}` : ''}`]
    .filter(Boolean).join(', ') || target.label || target.kind;

/** The earlier comments and answers of a remark's thread, as indented lines. */
const earlierLines = (store: Store, remark: Remark): string[] => {
  const earlier = earlierInThread(store, remark);
  return earlier.length ? ['  earlier in this thread:', ...earlier.map((line) => `  ${line.from}: ${line.text}`)] : [];
};

/** What the owner pointed at, as indented lines: the same `about` as in the review context. A remark on the map has the lines of the stored map. */
const aboutLines = (store: Store, remark: Remark): string[] => {
  const change = remark.changeId === undefined ? undefined : store.getChange(remark.changeId);
  const about = change ? aboutInChange(store, change, remark.target) : remark.repoId ? aboutMapTarget(store.getMap(remark.repoId)?.map, remark.target) : [];
  return about.length ? ['  about what he pointed at:', ...about.map((line) => `    ${line}`)] : [];
};

/** The text that wakes the agent. With the store, a reply carries the earlier lines of its thread, and each remark what it is about. */
export function inboxText(remarks: Remark[], store?: Store, readOnly = false): string {
  const count = remarks.length === 1 ? '1 remark' : `${remarks.length} remarks`;
  return [
    `The owner sent ${count} in Apostil. You may read the repo. A question gets an answer and no change of code. A remark that asks for a change gets that change and no more. `
      + 'When a remark shows that a note, a title or a diagram of Apostil is wrong, correct it with the apostil commands of the skill, and say so. '
      + 'Touch nothing that no remark points at. Then store your answer with: apostil answer <id> "<one to three sentences>". The answer names each file that you changed. '
      + 'In the answer, name code as path:line or path:from-to, and a diagram, a node or a step by its title in double quotes: Apostil turns them into links. '
      + 'Follow the skill apostil-review-remarks if you have it; do not search for it.'
      + (readOnly ? ' In this run you may not change any file: say what the change would be.' : ''),
    ...remarks.flatMap((remark) => [`- remark ${remark.id} (${placeOf(remark)}): ${remark.text}`, ...(store ? [...earlierLines(store, remark), ...aboutLines(store, remark)] : [])]),
  ].join('\n');
}

/**
 * True in a run with no person, where a wait would hold the run up for ever. Seen on 13 November 2026 with Claude Code 2.1.319:
 * `claude -p` with this hook gave no answer in 9 minutes, and 5 seconds without it. Such a run sets CLAUDE_CODE_SESSION_ATTENDED=0 and
 * CLAUDE_CODE_ENTRYPOINT=sdk-cli. A run that Apostil starts sets APOSTIL_NO_WAIT, for every agent app.
 */
export const runHasNoPerson = (env: Record<string, string | undefined>): boolean =>
  !!env.APOSTIL_NO_WAIT || env.CLAUDE_CODE_SESSION_ATTENDED === '0' || env.CLAUDE_CODE_ENTRYPOINT === 'sdk-cli';

export interface WaitOptions {
  session: string;
  folder: string;
  pid: number;
  timeoutSeconds: number;
  now: () => number; // milliseconds
  sleep: (milliseconds: number) => Promise<void>;
}

/** Waits for sent remarks. Code 2 wakes the agent with the text; code 0 means nothing to do or another waiter took over. */
export async function waitForRemarks(store: Store, options: WaitOptions): Promise<{ code: 0 | 2; text?: string }> {
  const { session, pid } = options;
  const end = options.now() + options.timeoutSeconds * 1000;
  store.setWaiter(session, pid);
  try {
    while (true) {
      if (store.waiterOf(session) !== pid) return { code: 0 };
      const remarks = sentRemarks(store, session, options.folder);
      if (remarks.length > 0) {
        for (const remark of remarks) store.startRemarkRun(remark.id, { session, startedAt: new Date(options.now()).toISOString() });
        return { code: 2, text: inboxText(remarks, store) };
      }
      if (options.now() >= end) return { code: 0 };
      await options.sleep(POLL_SECONDS * 1000);
    }
  } finally {
    store.removeWaiter(session, pid);
  }
}
