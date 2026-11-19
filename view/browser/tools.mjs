// What every group of the browser check shares: the data of the made-up example, the browser, a new page, the record of each check, the pictures and the end.
// A group alone writes the example data first; view/browser-check.mjs writes it once for all groups and says so with APOSTIL_DATA_WRITTEN.

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium } from '../find-playwright.mjs';

const args = process.argv.slice(2);
const group = path.basename(process.argv[1], '.mjs');
/** With --pictures the pictures that a person looks at are taken, at double size; a failed check always takes one. */
export const PICTURES = args.includes('--pictures');
export const shots = args.find((arg) => !arg.startsWith('--')) ?? path.join(tmpdir(), 'apostil-shots');
mkdirSync(shots, { recursive: true });
export const pageFile = fileURLToPath(new URL('../media/page.html', import.meta.url));
export const listFile = fileURLToPath(new URL('../media/list.html', import.meta.url));
/** require() from the folder view/, for the built code in out/. */
export const own = createRequire(new URL('../browser-check.mjs', import.meta.url));
// A wide diagram page has the code beside the diagram. The checks of the page with the diagram alone start with the code hidden ("Hide code"),
// which draws the diagram alone; the checks of the two halves show the code. "Diffs" shows its list of files beside the file.
export const HIDDEN_KEY = 'apostil.codeHidden';
export const FILES_HIDDEN_KEY = 'apostil.filesHidden';

if (!process.env.APOSTIL_DATA_WRITTEN) execFileSync(process.execPath, [fileURLToPath(new URL('../../out/view/example-data.js', import.meta.url))], { stdio: ['ignore', 'ignore', 'inherit'] });

export const results = [];
export const errors = [];
const pages = []; // every page, the newest last: a failed check takes a picture of the newest one that is open
const failedPictures = [];
export const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  const open = pages.filter((one) => !one.isClosed()).at(-1);
  if (!ok && open) failedPictures.push(open.screenshot({ path: path.join(shots, `failed-${group}-${results.length}.png`) }).catch(() => {}));
};
/** A picture for a person, taken only with --pictures. `target` is a page or a locator. */
export const takePicture = (target, file, fullPage = false) => (PICTURES ? target.screenshot({ path: path.join(shots, file), fullPage }) : Promise.resolve());

const browser = await findChromium().launch();
/** A new page; at double size only when the pictures are asked for. */
export const openPage = async (options = {}) => {
  const one = await browser.newPage({ ...options, deviceScaleFactor: PICTURES ? options.deviceScaleFactor ?? 1 : 1 });
  pages.push(one);
  return one;
};
/** A new page that starts with the code beside a diagram hidden, unless a check set it before. */
export const newPage = async (options) => {
  const one = await openPage(options);
  await one.addInitScript((keys) => { try { for (const key of keys) if (localStorage.getItem(key) === null) localStorage.setItem(key, '1'); } catch { /* no storage */ } }, [HIDDEN_KEY]);
  return one;
};

/** The last check (no page error), then the end, with exit code 1 when a check failed. */
export async function finish() {
  check('no page error', errors.length === 0, errors.slice(0, 3).join(' | '));
  await Promise.all(failedPictures);
  await browser.close();
  process.exit(results.every(Boolean) ? 0 : 1);
}
