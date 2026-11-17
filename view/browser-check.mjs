// The browser check: drives the pages of view/media in a headless browser like a person. Its groups (view/browser/<group>.mjs) run at the same time,
// each with its own browser and pages; this prints one line for each group, and the checks that failed. Build first (npm run build).
// Playwright is not a dependency of Apostil: set APOSTIL_PLAYWRIGHT to a folder that has node_modules/playwright.
//   node view/browser-check.mjs [--pictures] [--group <name>] [<folder for pictures>]
// --pictures takes the pictures that a person looks at (a failed check always takes one); --group runs one group.

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runPart, summary } from './run-parts.mjs';

// Every file of view/browser/ is a group, except the helpers that the groups share. A new group is a new file there.
const HELPERS = ['tools.mjs', 'made-up.mjs'];
export const GROUPS = readdirSync(new URL('./browser/', import.meta.url)).filter((name) => name.endsWith('.mjs') && !HELPERS.includes(name)).map((name) => name.slice(0, -4)).sort();

/** Writes the data of the made-up example once (view/media/example-data.js), which every group then only reads. */
export function writeExampleData() {
  execFileSync(process.execPath, [fileURLToPath(new URL('../out/view/example-data.js', import.meta.url))], { stdio: 'ignore' });
}

/** Starts every group (or the groups named) at the same time; the arguments go on to each group, and `before` is put in front of node (as "nice"). */
export function browserParts(args = [], groups = GROUPS, before = []) {
  const [command, ...first] = [...before, process.execPath]; // `before` puts a program in front, as "nice"
  return groups.map((group) => runPart(`browser ${group}`, command, [...first, fileURLToPath(new URL(`./browser/${group}.mjs`, import.meta.url)), ...args], { APOSTIL_DATA_WRITTEN: '1' }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--group');
  const groups = at >= 0 ? [args[at + 1]] : GROUPS;
  if (at >= 0) args.splice(at, 2);
  const start = Date.now();
  writeExampleData();
  const parts = await Promise.all(browserParts(args, groups));
  console.log(summary(parts));
  console.log(`${parts.reduce((sum, part) => sum + part.passed + part.failed, 0)} browser checks in ${((Date.now() - start) / 1000).toFixed(1)} s`);
  process.exit(parts.every((part) => part.ok) ? 0 : 1);
}
