// Tests for the links that open Apostil from outside: building and reading them, the line of a pull request description, "apostil link" and the switch.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { appLink, markdownLine, readLink, webLink, type LinkTarget } from '../shared/apostil-link';
import { git } from '../shared/git';
import { makeTestRepo, tempFolder } from '../shared/test-repo';
import { linkCommand, linksCommand } from './link-command';

/** What VS Code hands the handler: the path, and the query decoded once. */
const asVsCodeHandsIt = (link: string): [string, string] => {
  const url = new URL(link);
  return [url.pathname, decodeURIComponent(url.search.slice(1))];
};

test('a link holds owner/name and a number or a branch, encoded, and reads back as VS Code hands it over; no field is named url, and the url that vscode.dev adds is passed over', () => {
  const targets: LinkTarget[] = [
    { open: 'pull', repo: 'made-up/example', number: 12 },
    { open: 'pull', repo: 'made-up/example', branch: 'feature/holds+1-%41#x=y' },
    { open: 'change', repo: 'Made-Up/ex.ample_2', branch: 'book-holds' },
    { open: 'change', repo: 'made-up/example', branch: 'fix-(holds' }, // one parenthesis alone must not end the markdown link
  ];
  for (const target of targets) {
    const link = appLink(target);
    const [path, query] = asVsCodeHandsIt(link);
    assert.deepEqual(readLink(path, query), target, link);
    assert.ok(!/[?&]url=/.test(link), link);
    // The https form: vscode.dev redirects to the vscode:// link and adds "url" with the whole link again.
    const web = webLink(target);
    assert.equal(decodeURIComponent(web.replace('https://vscode.dev/redirect?url=', '')), link);
    assert.deepEqual(readLink(path, `${query}&url=${link}`), target);
    assert.ok(!/[()]/.test(link) && !/[()]/.test(web), web);
  }
  assert.equal(appLink(targets[0]), 'vscode://apostil.apostil/pull?repo=made-up/example&number=12');
  assert.ok(!webLink(targets[1]).includes('/Users/'), 'a link holds no path of the computer');
});

test('a link with a missing or wrong field opens nothing, and a field it does not know is passed over', () => {
  const wrong = [
    ['/pull', 'number=12'], ['/pull', 'repo=made-up&number=12'], ['/pull', 'repo=a/b/c&number=12'], ['/pull', 'repo=a/..&number=12'],
    ['/pull', 'repo=a/b&number=0'], ['/pull', 'repo=a/b&number=12a'], ['/pull', 'repo=a/b'], ['/change', 'repo=a/b&number=3'],
    ['/change', 'repo=a/b&branch=a..b'], ['/change', 'repo=a/b&branch=-x'], ['/change', 'repo=a/b&branch=x.lock'], ['/change', 'repo=a/b&branch=a b'],
    ['/change', 'repo=a/b&branch=.x'], ['/change', 'repo=a/b&branch=x/'], ['/run', 'repo=a/b&number=12'],
  ];
  for (const [path, query] of wrong) assert.equal(readLink(path, query), undefined, `${path}?${query}`);
  assert.deepEqual(readLink('/pull', 'repo=a/b&number=3&command=rm&run'), { open: 'pull', repo: 'a/b', number: 3 });
});

test('the first line of a pull request description: the icon only when ICON_URL is set, the link in bold, then what Apostil shows', () => {
  const link = webLink({ open: 'pull', repo: 'a/b', number: 3 });
  assert.equal(markdownLine(link, 4, ''), `[**Read this change in Apostil**](${link}) · diagrams of its 4 parts`);
  assert.equal(markdownLine(link, undefined, 'https://raw.githubusercontent.com/a/b/main/icon.png'),
    `<img src="https://raw.githubusercontent.com/a/b/main/icon.png" width="16" height="16" alt=""> [**Read this change in Apostil**](${link}) · its conversation and checks`);
});

test('apostil link prints the link of this repo and branch, and nothing while the switch or APOSTIL_NO_LINKS turns the links off', () => {
  const home = tempFolder('apostil-home-');
  const env = { APOSTIL_HOME: home };
  process.env.APOSTIL_HOME = home;
  const repo = makeTestRepo();
  assert.match(linkCommand(['--pr'], repo.folder, env).problem ?? '', /no remote on GitHub/);
  git(repo.folder, 'remote', 'add', 'origin', 'git@github.com:made-up/example.git');
  const parts = () => 4;
  assert.deepEqual(linkCommand(['--pr'], repo.folder, env, parts), { line: webLink({ open: 'pull', repo: 'made-up/example', branch: 'feature' }) });
  assert.deepEqual(linkCommand(['--change', '--markdown'], repo.folder, env, parts), { line: markdownLine(webLink({ open: 'change', repo: 'made-up/example', branch: 'feature' }), 4) });
  // A pull request of another repo: the words do not speak of the change of this branch.
  assert.deepEqual(linkCommand(['--pr', 'https://github.com/other/repo/pull/5', '--markdown'], repo.folder, env, parts), { line: markdownLine(webLink({ open: 'pull', repo: 'other/repo', number: 5 }), undefined) });
  // The real command: one line on standard output.
  const cli = (...args: string[]) => spawnSync(process.execPath, [join(__dirname, 'cli.js'), ...args], { cwd: repo.folder, encoding: 'utf8', env: { ...process.env, ...env } });
  const printed = cli('link', '--pr', '12');
  assert.equal(printed.stdout, `${webLink({ open: 'pull', repo: 'made-up/example', number: 12 })}\n`);
  assert.equal(printed.status, 0);

  assert.match(linksCommand('off', env).line ?? '', /are off/);
  assert.deepEqual(linkCommand(['--pr', '12'], repo.folder, env), {});
  assert.equal(cli('link', '--pr', '12').stdout, '');
  assert.match(linksCommand('on', env).line ?? '', /are on/);
  assert.deepEqual(linkCommand(['--pr', '12'], repo.folder, { ...env, APOSTIL_NO_LINKS: '1' }), {});
  assert.match(linksCommand('status', { ...env, APOSTIL_NO_LINKS: '1' }).line ?? '', /off\. APOSTIL_NO_LINKS=1/);
  repo.remove();
});
