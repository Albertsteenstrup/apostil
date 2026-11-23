// Reads one real pull request with gh (read only) and writes a data file that page.html shows as a file in a browser.
// Usage: node out/view/pull-request-data.js <link of a pull request> [<when he last looked>] [<file name>]
//   <when he last looked>: a time such as 2026-11-10T09:00:00Z, hours back such as 26h, or never (the same as leaving it out).
//   <file name>: the file next to page.html, pull-data-<number>.js when left out, the name that a click on another pull request of a stack opens. Not in Git.
// Then open view/media/page.html?pull=<file name> in a browser.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ghPictures, inlinePictures } from '../shared/pull-pictures';
import { readPullRequest } from '../shared/read-pull-request';
import { pullOnlyPage } from '../shared/page-data';
import { iconScript } from './state-icons';

const [link, lookedArg, nameArg = `pull-data-${/\/pull\/(\d+)/.exec(link ?? '')?.[1] ?? ''}.js`] = process.argv.slice(2);

/** "26h" is 26 hours back from now; any other text is a time. */
function lastLooked(text?: string): string | undefined {
  if (!text || text === 'never') return undefined;
  const hours = /^(\d+(?:\.\d+)?)h$/.exec(text);
  const time = hours ? new Date(Date.now() - Number(hours[1]) * 3_600_000) : new Date(text);
  if (Number.isNaN(time.getTime())) throw new Error(`Not a time: ${text}`);
  return time.toISOString();
}

async function main(): Promise<void> {
  if (!link || !/^[\w./-]+$/.test(nameArg)) {
    console.error('Usage: node out/view/pull-request-data.js <link of a pull request> [<when he last looked>] [<file name>]');
    process.exit(2);
  }
  const looked = lastLooked(lookedArg);
  const started = Date.now();
  const result = await readPullRequest(process.cwd(), link);
  if ('problem' in result) {
    console.error(result.text);
    process.exit(1);
  }
  await inlinePictures(result.pull, ghPictures()); // pictures of a private repo, fetched with the login of gh
  // A folder with no Git: the page is a pull request of another repo, with "Conversation" and its files.
  const empty = mkdtempSync(join(tmpdir(), 'apostil-pull-'));
  const page = pullOnlyPage(empty, result.pull);
  rmSync(empty, { recursive: true, force: true });
  const target = join(__dirname, '../../view/media', nameArg);
  writeFileSync(target, `// Written by view/pull-request-data.ts from ${link}. Not in Git.\n${iconScript(join(__dirname, '../../view/media'))}window.APOSTIL_PULL = ${JSON.stringify({ page, read: { pull: result.pull, lastLooked: looked } })};\n`);
  const { pull } = result;
  console.log(`Wrote ${target} in ${Date.now() - started} ms: #${pull.number}, ${pull.items.length} items, ${pull.files.length} files, ${pull.notShown} not shown, cut ${JSON.stringify(pull.cut)}.`);
  console.log(`Open: file://${join(__dirname, '../../view/media/page.html')}?pull=${nameArg}`);
}

void main();
