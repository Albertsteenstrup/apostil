// npm run check: every check of Apostil at the same time where it can, in under 2 minutes. It builds once, then runs together the unit tests,
// the groups of the browser check (headless, so they take no keyboard from VS Code) and the real-window parts, which run one after the other:
// the one window run (view/window-check.mjs), then the check of the .vsix file. It prints the count and the time of each part and the total,
// and fails when a check fails or when the total passes 2 minutes.
// Playwright is not a dependency of Apostil: set APOSTIL_PLAYWRIGHT to a folder that has node_modules/playwright.
//   npm run check [-- --pictures [<folder for pictures>]]
// One check window at a time on a Mac: the run first takes the window lock (a folder; APOSTIL_WINDOW_LOCK names another one), and the 2 minutes count from then.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserParts, writeExampleData } from './browser-check.mjs';
import { runPart, summary } from './run-parts.mjs';

const LIMIT_S = 120;
const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
process.chdir(root);
const LOCK = process.env.APOSTIL_WINDOW_LOCK ?? path.join(tmpdir(), 'apostil-vscode-window.lock');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const windowRuns = () => spawnSync('pgrep', ['-f', 'extension[D]evelopmentPath']).status === 0;

// The window lock. A lock older than 30 minutes with no check window is left over from a run that stopped: it is taken away, and the run says so.
for (let said = false; ; said = true) {
  try { mkdirSync(LOCK); break; } catch { /* another run holds it */ }
  if (Date.now() - statSync(LOCK, { throwIfNoEntry: false })?.mtimeMs > 30 * 60_000 && !windowRuns()) {
    console.log(`NOTE  took away the window lock ${LOCK}: older than 30 minutes, and no check window runs`);
    rmSync(LOCK, { recursive: true, force: true });
    continue;
  }
  if (!said) console.log(`NOTE  waiting for the window lock ${LOCK}`);
  await sleep(2000);
}
writeFileSync(path.join(LOCK, 'owner'), `npm run check ${process.pid}\n`);
process.on('exit', () => rmSync(LOCK, { recursive: true, force: true }));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(1));

const load = loadavg().map((one) => one.toFixed(1)).join(' '); // how busy the Mac was when the run started
const start = Date.now();
const seconds = (from) => (Date.now() - from) / 1000;
rmSync('out', { recursive: true, force: true }); // no built file of a removed source stays, such as an old test
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', '.'], { stdio: 'inherit' });
writeExampleData();
const built = { name: 'build', passed: 0, failed: 0, seconds: seconds(start), ok: true, output: '' };

const node = process.execPath;
// The .vsix file of this build, for its check; made while the window run goes on.
// vsce is a dev dependency with an exact version, so its packages are in the lockfile and get audited.
const vsix = runPart('package', 'node_modules/.bin/vsce', ['package', '--no-dependencies', '--allow-missing-repository', '--skip-license', '--readme-path', 'skills/README.md'], {});
const windowParts = (async () => {
  const window = await runPart('window', node, ['view/window-check.mjs', ...args]);
  const made = await vsix;
  const packageCheck = made.code === 0 ? await runPart('package check', node, ['out/view/package-check.js']) : { ...made, name: 'package check', ok: false };
  return [window, packageCheck];
})();
// The window run is the longest part, and a busy Mac slows a real window most: the other parts run with a lower priority (nice).
const unit = runPart('unit tests', 'nice', [node, '--test', 'out/**/*.test.js']);
const browser = browserParts(args, undefined, ['nice']);
const parts = [built, await unit, ...(await Promise.all(browser)), ...(await windowParts)];
const total = seconds(start);
const logs = path.join(tmpdir(), 'apostil-check');
mkdirSync(logs, { recursive: true });
for (const part of parts) writeFileSync(path.join(logs, `${part.name.replace(/ /g, '-')}.log`), part.output);
console.log(summary(parts));
console.log(`All that each part printed: ${logs}`);
const overLimit = total > LIMIT_S;
console.log(`${parts.reduce((sum, part) => sum + part.passed + part.failed, 0)} checks in ${total.toFixed(1)} s${overLimit ? `: over the limit of ${LIMIT_S} s` : ` (the limit is ${LIMIT_S} s)`}; load at the start ${load}`);
process.exit(parts.every((part) => part.ok) && !overLimit ? 0 : 1);
