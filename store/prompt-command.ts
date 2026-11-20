// "apostil prompt <kind>" prints what a writer of that kind follows, from the skills of this install: its prompt, the text rules, and for some kinds an example.
// The lead gives a writer one line that runs it, in place of these texts, so that the brief of a writer stays short. It prints text, not JSON.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Printed } from './link-command';

/** The skills folder of this install: two folders above out/store (and out/view). */
export const SKILLS = join(__dirname, '..', '..', 'skills');

const MAP = 'apostil-map-repo';
const DESCRIBE = 'apostil-describe-change';
const RULES = `${DESCRIBE}/text-rules.md`;

/** The files of the skills that a writer of each kind follows, in the order that they print. */
export const WRITER_FILES: Record<string, string[]> = {
  overview: [`${MAP}/overview-writer-prompt.md`, RULES, `${MAP}/example-map.json`],
  area: [`${MAP}/area-writer-prompt.md`, RULES, `${MAP}/example-area-diagram.json`],
  notes: [`${MAP}/notes-writer-prompt.md`, RULES],
  process: [`${MAP}/process-writer-prompt.md`, RULES],
  service: [`${MAP}/service-writer-prompt.md`, RULES],
  mark: [`${MAP}/mark-writer-prompt.md`, RULES],
  describe: [`${DESCRIBE}/writer-prompt.md`, RULES],
  'fresh-check': [`${DESCRIBE}/fresh-check-prompt.md`],
};

export const PROMPT_USAGE = {
  prompt: `apostil prompt ${Object.keys(WRITER_FILES).join('|')} (prints what a writer of that kind follows: text, not JSON)`,
};

/** Files of the skills as one text, each after a line with its path. */
export const skillTexts = (paths: string[], skills = SKILLS): string =>
  paths.map((path) => `----- ${path} -----\n${readFileSync(join(skills, path), 'utf8')}`).join('\n\n');

/** "apostil prompt <kind>": the files of that kind of writer; the usage with the kinds when the kind is missing or unknown. */
export function promptCommand(kind: string | undefined, skills = SKILLS): Printed {
  if (kind && Object.hasOwn(WRITER_FILES, kind)) return { line: skillTexts(WRITER_FILES[kind], skills) };
  return { problem: `${kind ? `No writer of the kind "${kind}". ` : ''}Usage: ${PROMPT_USAGE.prompt}` };
}
