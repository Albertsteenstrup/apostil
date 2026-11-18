// The check in a real VS Code window: one start of VS Code, one part after the other, only what needs VS Code itself (what a page alone can show
// is in the browser check). It drives the window like a person over the Chrome DevTools protocol and prints PASS or FAIL for each check.
// The window has its own settings, store and stand-ins for gh, claude and codex: nothing calls GitHub or starts a real agent. It closes at the end.
// Playwright is not a dependency of Apostil: set APOSTIL_PLAYWRIGHT to a folder that has node_modules/playwright. Build first (npm run build).
//   node view/window-check.mjs [--pictures] [<folder for pictures>]
// Only one check window at a time: npm run check takes the window lock before it starts this.

import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium } from './find-playwright.mjs';
import { lookOfPage } from './theme-look.mjs';

const args = process.argv.slice(2);
const PICTURES = args.includes('--pictures');
const shots = args.find((arg) => !arg.startsWith('--')) ?? path.join(tmpdir(), 'apostil-window');
mkdirSync(shots, { recursive: true });
const apostil = fileURLToPath(new URL('..', import.meta.url));
const own = createRequire(path.join(apostil, 'package.json'));
const { Store } = own('./out/shared/store.js');
const { checkChangeFile } = own('./out/shared/checks.js');
const { baseOf, currentBranch, headCommit, repoId } = own('./out/shared/git.js');
const { examplePullRequest } = own('./out/view/example-pull-request.js');
const { CHECK_SETTINGS, CODE } = own('./out/shared/run-in-vscode.js');
const { makeCheckExample } = own('./out/view/check-example.js');
const { putLookFiles } = own('./out/view/check-example.js');
const { noteCodeOf } = own('./out/shared/notes-beside-code.js');
const { makeNotebookRepo, notebookChangeFile } = own('./out/shared/test-repo.js');
const { saveDraft } = own('./out/store/save.js');
const { setLook } = own('./out/store/marks-save.js');
const { markLineNow } = own('./out/shared/marks.js');
const { appLink } = own('./out/shared/apostil-link.js');
const chromium = findChromium();

const PORT = 9334;
const temp = realpathSync(mkdtempSync('/tmp/ap-win-')); // short: VS Code fails when its socket path is longer than 103 characters; the real path, so that VS Code sees the settings file change
const storeFolder = path.join(temp, 'store');
const example = makeCheckExample();
const repo = example.folder;
const notebookRepo = makeNotebookRepo();

// The skills of Apostil for Claude Code and Codex in the repo, as "apostil setup" for this repo gives them, out of Git's list: both apps are connected.
for (const skills of ['.claude/skills', '.agents/skills']) {
  for (const entry of readdirSync(path.join(apostil, 'skills'), { withFileTypes: true })) {
    if (entry.isDirectory()) cpSync(path.join(apostil, 'skills', entry.name), path.join(repo, skills, entry.name), { recursive: true });
  }
}
appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '\n.claude/\n.agents/\n');

// The store: the change of the example with the text of its noted lines and a made-up agent session with a name, its open points, a second made-up change
// with no part and no pull request (for the search), and the change of the notebook repo. No map yet: the first run of the map saves it.
const store = new Store(storeFolder);
const file = JSON.parse(readFileSync(example.changeFile, 'utf8'));
const branch = currentBranch(repo);
const base = baseOf(repo, branch);
const SESSION_NAME = 'VS Code repo understanding tool';
const agent = { app: 'claude-code', account: 'reader@example.com', session: 'made-up-session-0001', hostSession: 'made-up-host-0001', name: SESSION_NAME };
const SECOND = 'made-up/second-change';
const noChecks = { filesInNoPart: [], filesInTwoParts: [], filesNotChanged: [], generated: [], badNotes: [] };
store.saveChange({ repoId: repoId(repo), folder: repo, branch: SECOND, base, head: headCommit(repo), file: { format: 1, title: 'A made-up second change', reason: 'For the search.', parts: [], links: [] }, checks: noChecks });
await new Promise((done) => setTimeout(done, 20)); // the change of the example is the newest one, which "Open the newest change" opens
const changeId = store.saveChange({ repoId: repoId(repo), folder: repo, branch, base, head: headCommit(repo), file, checks: checkChangeFile(repo, base, file), agent, noteCode: noteCodeOf(repo, file) });
store.setOpenPoints(changeId, JSON.parse(readFileSync(path.join(apostil, 'view/example-open-points.json'), 'utf8')));
const notebookSaved = saveDraft(store, notebookRepo.folder, notebookChangeFile());
if (!notebookSaved.saved) throw new Error(`The notebook change was not saved: ${notebookSaved.problems.join(' ')}`);

// Stand-ins first on the path of the window. gh prints three made-up pull requests (none for the second change), and for "gh api graphql" the made-up
// conversation; a write ("gh api graphql --input -") is kept in gh-writes as the JSON of its standard input and answered as GitHub answers it.
const bin = path.join(temp, 'bin');
const ghCalls = path.join(temp, 'gh-calls');
const ghWrites = path.join(temp, 'gh-writes');
const runs = path.join(temp, 'runs.txt');
mkdirSync(bin);
const face = (login, color) => ({ login, avatarUrl: `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${color}"/></svg>`).toString('base64')}` });
const MIRA = face('mira-k', '#8250df'), JONAS = face('jonas-b', '#1a7f37');
const pr = (number, state, reviewDecision, failed, more = {}) => ({
  number, title: `Made-up pull request ${number}`, url: `https://github.com/made-up/example/pull/${number}`, state, isDraft: false, reviewDecision, mergeable: 'MERGEABLE',
  statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: failed ? 'FAILURE' : 'SUCCESS' }], ...more,
});
writeFileSync(path.join(temp, 'pulls.json'), JSON.stringify([
  pr(12, 'OPEN', 'REVIEW_REQUIRED', false, { author: MIRA, reviewRequests: [JONAS], labels: [{ name: 'needs review', color: 'fbca04' }, { name: 'bug', color: 'd73a4a' }] }),
  pr(11, 'MERGED', '', false, { author: JONAS, labels: [{ name: 'bug', color: 'd73a4a' }] }),
  pr(14, 'OPEN', '', true, { author: MIRA }),
]));
// The open pull requests of the repo (gh pr list --state open): one with no stored change, whose branch has no row.
writeFileSync(path.join(temp, 'open-pulls.json'), JSON.stringify([pr(35, 'OPEN', 'REVIEW_REQUIRED', false, { author: JONAS, headRefName: 'made-up/reminders' })]));
writeFileSync(path.join(temp, 'conversation.json'), JSON.stringify({ data: { repository: { pullRequest: examplePullRequest().raw.pr } } }));
// The read of #35 answers as #35: with the conversation of #12 the page of #35 said "#12" as soon as the answer came.
writeFileSync(path.join(temp, 'conversation-35.json'), JSON.stringify({ data: { repository: { pullRequest: { ...examplePullRequest().raw.pr, number: 35, title: 'Made-up pull request 35', url: 'https://github.com/made-up/example/pull/35' } } } }));
writeFileSync(path.join(bin, 'write.mjs'), [
  "import { appendFileSync, readFileSync } from 'node:fs';",
  "const input = readFileSync(0, 'utf8');",
  `appendFileSync(${JSON.stringify(ghWrites)}, input.replace(/\\n/g, ' ') + '\\n');`,
  'const name = /\\{\\s*(\\w+)\\(/.exec(JSON.parse(input).query)?.[1];',
  "process.stdout.write(JSON.stringify({ data: { [name]: { commentEdge: { node: { id: 'stand-in-comment' } } } } }));", '',
].join('\n'));
writeFileSync(path.join(bin, 'gh'), [
  '#!/bin/sh', `echo "$@" >> '${ghCalls}'`,
  `if [ "$1" = api ] && [ "$3" = --input ]; then exec '${process.execPath}' '${path.join(bin, 'write.mjs')}'; fi`,
  `if [ "$1" = pr ] && [ "$3" = --state ]; then cat '${path.join(temp, 'open-pulls.json')}'; exit 0; fi`,
  `if [ "$4" = '${SECOND}' ]; then echo '[]'; exit 0; fi`,
  `case "$*" in *number=35*) cat '${path.join(temp, 'conversation-35.json')}'; exit 0;; esac`,
  `if [ "$1" = api ]; then cat '${path.join(temp, 'conversation.json')}'; else cat '${path.join(temp, 'pulls.json')}'; fi`, '',
].join('\n'));
// The map of the example as a writer saves it, with the made-up services at lines of its code: the second run of the map calls this.
writeFileSync(path.join(bin, 'save-map.mjs'), [
  "import { readFileSync } from 'node:fs';", "import { createRequire } from 'node:module';",
  `const own = createRequire(${JSON.stringify(path.join(apostil, 'package.json'))});`,
  "const { Store } = own('./out/shared/store.js'); const { headCommit, repoId } = own('./out/shared/git.js');",
  "const { addMarksToMap } = own('./out/store/marks-save.js'); const { EXAMPLE_LOOK, putLookFiles } = own('./out/view/check-example.js');",
  `const repo = ${JSON.stringify(repo)}; const store = new Store(process.env.APOSTIL_HOME);`,
  `store.saveMap(repoId(repo), headCommit(repo), JSON.parse(readFileSync(${JSON.stringify(path.join(apostil, 'view/example-map.json'))}, 'utf8')));`,
  "const put = putLookFiles(repo);",
  "for (const draft of JSON.parse(readFileSync(EXAMPLE_LOOK + '/marks.json', 'utf8')).filter((one) => one.set === 'services')) addMarksToMap(store, repo, draft);",
  'put.clean(); store.close();', '',
].join('\n'));
// claude: writes each run to runs.txt. A run of the map is refused a command the first time; the second time it reports its session, waits until the
// check has read the line of the map run on Home (the file map-go, 10 seconds at most), and saves the map. A run for a comment answers it and
// prints a session id as Claude Code does; the prompt that it got goes to prompt.txt.
const RUN = '=== a run of the stand-in claude ===';
const MAP_SESSION = 'stand-in-map-0001';
const mapGo = path.join(temp, 'map-go');
writeFileSync(path.join(bin, 'claude'), [
  '#!/bin/sh', `printf '%s\\n' '${RUN}' "$@" >> '${runs}'`,
  'case "$*" in *apostil-map-repo*)',
  `  if [ ! -f '${temp}/denied' ]; then touch '${temp}/denied'; echo '{"type":"result","is_error":false,"result":"Done","permission_denials":[{"tool_name":"Bash","tool_input":{"command":"git ls-files src/"}}]}'; exit 0; fi`,
  `  echo '{"type":"system","subtype":"init","session_id":"${MAP_SESSION}"}'`,
  `  n=0; while [ ! -f '${mapGo}' ] && [ $n -lt 100 ]; do sleep 0.1; n=$((n+1)); done`,
  `  exec '${process.execPath}' '${path.join(bin, 'save-map.mjs')}';;`, 'esac',
  'for arg in "$@"; do case "$arg" in *"- remark "*) prompt="$arg";; esac; done',
  `printf '%s\\n' "$prompt" > '${path.join(temp, 'prompt.txt')}'`,
  `id=$(printf '%s\\n' "$prompt" | sed -n 's/^- remark \\([0-9]*\\).*/\\1/p' | head -n 1)`,
  `'${process.execPath}' '${path.join(apostil, 'out/store/cli.js')}' answer "$id" "Answered by the stand-in." > /dev/null`, 'echo \'{"type":"result","session_id":"stand-in-run-0001"}\'', '',
].join('\n'));
writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nexit 0\n');
for (const program of ['gh', 'claude', 'codex']) chmodSync(path.join(bin, program), 0o755);

// The window's own settings: Home in place of the empty editor area (the first part checks it), a terminal that only echoes what it gets, drawn as text,
// no chat panel at the right, and the answer that a person gives before a link opens the first time.
const settingsFile = path.join(temp, 'u', 'User', 'settings.json');
mkdirSync(path.dirname(settingsFile), { recursive: true });
writeFileSync(settingsFile, JSON.stringify({
  ...CHECK_SETTINGS, 'apostil.homeWhenEmpty': true,
  'terminal.integrated.profiles.osx': { echo: { path: '/bin/cat' } }, 'terminal.integrated.defaultProfile.osx': 'echo', 'terminal.integrated.gpuAcceleration': 'off',
  'workbench.secondarySideBar.defaultVisibility': 'hidden', 'chat.disableAIFeatures': true, 'files.hotExit': 'off',
  'extensions.confirmedUriHandlerExtensionIds': ['apostil.apostil'],
  'window.dialogStyle': 'custom', // VS Code's own questions are drawn in the window, where the check reads them, not by macOS
}, null, 2));
// A key of this window's own for the start step of what opens by itself (a command that is not in the palette), so that the check runs it again.
const START_KEY = 'Control+Alt+Shift+Digit0';
writeFileSync(path.join(path.dirname(settingsFile), 'keybindings.json'), JSON.stringify([{ key: 'ctrl+alt+shift+0', command: 'apostil.runStartStep' }]));
const settingsNow = () => JSON.parse(readFileSync(settingsFile, 'utf8'));

// The places where "Install" would link the command: read before and after, never written by this check.
const commandPlaces = ['/opt/homebrew/bin/apostil', '/usr/local/bin/apostil', path.join(process.env.HOME, '.local/bin/apostil')];
const placesNow = () => commandPlaces.map((place) => { try { return lstatSync(place).isSymbolicLink() ? `${place} -> ${readlinkSync(place)}` : `${place} file`; } catch { return `${place} none`; } }).join('\n');
const placesBefore = placesNow();

if (await fetch(`http://127.0.0.1:${PORT}/json/version`).then(() => true, () => false)) {
  console.log(`FAIL  port ${PORT} is taken, by a window of an earlier run; close it first`);
  process.exit(1);
}
const child = spawn(CODE, [
  `--extensionDevelopmentPath=${apostil}`, `--user-data-dir=${temp}/u`, `--extensions-dir=${temp}/e`, `--remote-debugging-port=${PORT}`,
  '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', repo,
  // VSCODE_CLI keeps this environment: without it VS Code takes PATH from the login shell and would miss the stand-ins.
], { env: { ...process.env, APOSTIL_HOME: storeFolder, PATH: `${bin}:${process.env.PATH}`, VSCODE_CLI: '1' }, stdio: 'ignore' });

const results = [];
let page;
const failed = [];
const begun = Date.now();
const check = (name, ok, detail = '') => {
  results.push(ok);
  const at = process.env.APOSTIL_TIMES ? `[${((Date.now() - begun) / 1000).toFixed(1)} s] ` : ''; // APOSTIL_TIMES=1 shows when each check ended
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${at}${name}${detail ? `  (${detail})` : ''}`);
  if (!ok && page) failed.push(page.screenshot({ path: path.join(shots, `failed-window-${results.length}.png`) }).catch(() => {}));
};
const shot = (name) => (PICTURES ? page.screenshot({ path: path.join(shots, `${name}.png`) }) : Promise.resolve());
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
/** Waits until `test` gives something true, or the time is over; gives back its last value. */
const until = async (test, ms = 8000) => {
  const end = Date.now() + ms;
  let value = await test();
  while (!value && Date.now() < end) { await sleep(150); value = await test(); }
  return value;
};
let browser;

try {
  await until(() => fetch(`http://127.0.0.1:${PORT}/json/version`).then((answer) => answer.ok, () => false), 30000);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  page = await until(() => browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('workbench')), 20000);
  await page.waitForSelector('.monaco-workbench', { timeout: 30000 });

  const quickInput = page.locator('.quick-input-widget');
  const quickOpen = (ms = 4000) => quickInput.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);
  /** Opens the palette with F1. A key in the first moment after a tab opens can stay in that tab: then a click on the title bar, which takes the keyboard out of the page, and F1 again. */
  const palette = async () => {
    await page.evaluate(() => { if (document.activeElement?.tagName === 'IFRAME') document.activeElement.blur(); }); // a key in a page stays in that page
    await page.keyboard.press('F1');
    if (await quickOpen(700)) return;
    console.log(`NOTE  the key stayed in ${await page.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`.slice(0, 80))}; a click on the title bar, and F1 again`);
    await page.locator('.part.titlebar').first().click({ position: { x: 150, y: 12 } });
    await page.keyboard.press('F1');
    await quickInput.waitFor({ state: 'visible' });
  };
  /** Writes into the open quick input (all of it, also its ">" or ":") and presses Enter when its first row holds what was written. */
  const pick = async (text) => {
    await page.locator('.quick-input-widget .quick-input-box input').fill(text); // a key typed in the first moment can go nowhere; this puts the words in at once
    const wanted = text.replace(/^[>:]/, '').replace(/:\d+$/, '').toLowerCase(); // a line after a file name is no part of its row
    const first = () => page.evaluate(() => { const row = [...document.querySelectorAll('.quick-input-list .monaco-list-row')].find((one) => one.getBoundingClientRect().height > 0); return (row?.getAttribute('aria-label') ?? row?.textContent ?? '').toLowerCase(); });
    if (!(await until(async () => (await first()).includes(wanted), 4000))) console.log(`NOTE  the first row did not hold "${text}": "${await first()}"`);
    await page.keyboard.press('Enter');
  };
  const command = async (text) => { await palette(); await pick(`>${text}`); };
  /** Opens a file with Go to File, or ":<line>" goes to a line of the editor in front and waits until its cursor is there. */
  const goTo = async (text) => {
    await palette();
    if (!text.startsWith(':')) return pick(text);
    await page.locator('.quick-input-widget .quick-input-box input').fill(text);
    await page.keyboard.press('Enter');
    const there = await until(() => page.locator('[id="status.editor.selection"]').textContent({ timeout: 500 }).then((line) => line?.startsWith(`Ln ${text.slice(1)},`), () => false), 4000);
    if (!there) console.log(`NOTE  the cursor did not go to ${text}: status "${await page.locator('[id="status.editor.selection"]').textContent({ timeout: 500 }).catch(() => 'none')}", tab ${await activeTab()}, quick input ${await quickInput.isVisible()}, message "${await page.locator('.quick-input-widget').textContent().catch(() => '')}"`);
  };
  const tabs = () => page.$$eval('.tabs-container .tab .label-name', (all) => all.map((el) => el.textContent.trim()));
  const waitTabs = (names, ms = 8000) => until(async () => { const now = await tabs(); return now.join() === names.join() && now; }, ms).then(async (got) => got || tabs());
  const activeTab = () => page.locator('.editor-group-container.active .tab.active').first().getAttribute('aria-label').catch(() => '');
  /** Closes a tab with a middle click, as a person can. */
  /** Closes a tab with a middle click and waits until it is gone. A click that only closed an open menu of VS Code is made once more. */
  const closeTab = async (name) => {
    const place = () => page.$$eval('.tabs-container .tab', (all, wanted) => {
      const box = all.find((one) => one.querySelector('.label-name')?.textContent.trim() === wanted)?.getBoundingClientRect();
      return box?.width > 0 && { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }, name);
    let at = await until(place, 4000);
    if (!at) throw new Error(`No tab "${name}" to close; the tabs: ${(await tabs()).join(', ')}`);
    for (let turn = 0; at && turn < 3; turn += 1) {
      // A quick input that a step before left open keeps the tab from closing: Escape closes it first.
      if (await quickInput.isVisible()) {
        console.log(`NOTE  a quick input was open before the tab "${name}" closed: "${await page.locator('.quick-input-box input').getAttribute('aria-label').catch(() => '')}"; Escape first`);
        await page.keyboard.press('Escape');
        await quickInput.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
      }
      await page.mouse.click(at.x, at.y, { button: 'middle' });
      if (await until(async () => !(await place()), 1500)) return;
      console.log(`NOTE  the tab "${name}" still stands after a middle click; once more (tabs ${(await tabs()).join(', ')}; menu ${await page.locator('.monaco-menu').count()}; quick input ${await quickInput.isVisible()}; block ${await page.locator('.context-view-block, .monaco-dialog-modal-block').count()}; focus ${await page.evaluate(() => `${document.activeElement?.tagName}.${String(document.activeElement?.className).slice(0, 50)}`)})`);
      at = await place();
    }
  };
  const focus = () => page.evaluate(() => {
    const el = document.activeElement;
    return el?.closest('.quick-input-widget') ? 'quick input' : el?.closest('.part.sidebar') ? 'side bar' : el?.closest('.part.panel') ? 'panel' : el?.closest('.part.editor') ? 'editor' : el?.tagName ?? 'none';
  });
  const toast = (text) => page.locator('.notification-toast', { hasText: text }).first();
  const shown = (locator, ms = 8000) => locator.waitFor({ timeout: ms }).then(() => true, () => false);
  /** The frame of a page of Apostil for which `test` (run in the frame) is true. */
  const frameWhere = (test, arg, ms = 15000) => until(async () => {
    for (const frame of page.frames()) {
      try { if (await frame.evaluate(test, arg)) return frame; } catch { /* a frame that went away, or not ours */ }
    }
    return undefined;
  }, ms);
  const frameWith = (selector, ms) => frameWhere((wanted) => !!document.querySelector(wanted), selector, ms);
  const runsNow = () => (existsSync(runs) ? readFileSync(runs, 'utf8').split(`${RUN}\n`).slice(1) : []);
  const remarks = () => store.remarks(changeId);
  /** Sets one setting in the settings file of the window; VS Code reads the file again when it changes. */
  const setSetting = async (name, value) => {
    const now = settingsNow();
    if (value === undefined) delete now[name]; else now[name] = value;
    writeFileSync(settingsFile, JSON.stringify(now, null, 2));
  };

  // ---- 1. The first start, Home in place of the empty editor area, and the questions of a new repo ----
  const asked = await shown(quickInput, 25000);
  const firstTabs = await waitTabs(['Home'], 10000);
  const homeWithMark = await frameWith('.nomap .wordmark', 5000);
  check('a window on a repo with no tab opens Home with the mark, and the look question of the first start keeps the keyboard',
    asked && firstTabs.join() === 'Home' && !!homeWithMark && await focus() === 'quick input', `tabs ${firstTabs.join()}; focus ${await focus()}`);
  await shot('1-first-start-and-home');
  await page.keyboard.press('Enter'); // the look "Apostil"
  const offer = toast('Set up Apostil for your agents?');
  const offered = await shown(offer);
  const offerButtons = offered ? await offer.locator('.monaco-button').allTextContents() : [];
  if (offered) await offer.locator('.monaco-button', { hasText: 'Not now' }).click();
  check('after the look the first start asks to set up the agents: "This repo", "All repos", "Show what it does", "Not now"; "Not now" writes nothing',
    offerButtons.join() === 'This repo,All repos,Show what it does,Not now' && placesNow() === placesBefore && execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }) === '', offerButtons.join());

  const question = toast('This repo has no map and no notes yet');
  const questionShown = await shown(question);
  const questionButtons = questionShown ? await question.locator('.monaco-button').allTextContents() : [];
  await shot('1b-the-question-of-a-new-repo');
  if (questionShown) await question.locator('.monaco-button', { hasText: 'New Claude Code session' }).click();
  await until(() => runsNow().length === 1);
  const [mapRun = ''] = runsNow();
  check('in a repo with no map whose apps are connected, one question follows, Claude Code first; its action starts one run of the map, which also describes the change of the branch',
    questionButtons.join() === 'New Claude Code session,New Codex session,Not now' && mapRun.startsWith('-p\nWrite the map of this repo for Apostil Home') && mapRun.includes('Then describe the change of this branch'),
    `${questionButtons.join()}; ${mapRun.slice(0, 120).replace(/\n/g, ' | ')}`);

  // The first run was refused a command and saved no map: "Allow and try again" puts the rule into the settings of Claude Code for the repo and starts the run again,
  // which saves the map; Home, open with the mark, draws it.
  const refused = toast('did not write the map');
  const refusedShown = await shown(refused, 15000);
  const refusedText = refusedShown ? (await refused.locator('.notification-list-item-message').textContent()) ?? '' : '';
  await shot('1c-a-run-that-was-not-allowed-a-command');
  if (refusedShown) await refused.locator('.monaco-button', { hasText: 'Allow and try again' }).click();
  await until(() => runsNow().length === 2);
  const localSettings = path.join(repo, '.claude', 'settings.local.json');
  const allowed = existsSync(localSettings) ? JSON.parse(readFileSync(localSettings, 'utf8')).permissions?.allow ?? [] : [];
  // While the stand-in writes, Home says which session writes the map: the id that the run reports. Then the stand-in goes on and saves the map.
  const writingFrame = await frameWhere((session) => document.querySelector('.nomap .maprun[data-run="writing"]')?.textContent.includes(session), MAP_SESSION, 8000);
  const writingLine = writingFrame ? await writingFrame.evaluate(() => document.querySelector('.maprun').textContent) : '';
  await shot('1c2-home-while-the-map-is-written');
  writeFileSync(mapGo, '');
  const homeFrame = () => frameWhere(() => typeof Home === 'object' && Home.data?.kind === 'home' && document.querySelectorAll('#view g.node.go').length === 8);
  const mapped = await homeFrame();
  const lineGone = !!mapped && await until(() => mapped.evaluate(() => !document.querySelector('.maprun')).catch(() => false), 6000);
  check('while the stand-in writes the map, Home shows the line of the map run with the session id that the run reports; when the run ends, the map shows and the line is gone',
    writingLine === `Writing the map · Claude Code session ${MAP_SESSION} (a session with no window) · nothing saved yet` && lineGone && store.mapRun(repoId(repo))?.agent?.session === MAP_SESSION && !!store.mapRun(repoId(repo))?.endedAt,
    `"${writingLine}"; gone ${lineGone}; ${JSON.stringify(store.mapRun(repoId(repo)) ?? null)}`);
  check('a run that was not allowed a command says so; "Allow and try again" adds the rule to the settings of Claude Code for the repo and starts the run again, and Home draws the map that it saved',
    /not allowed to run Bash\(git ls-files \*\)/.test(refusedText) && allowed.includes('Bash(git ls-files *)') && runsNow().length === 2 && !!mapped, `${refusedText.trim()} | ${JSON.stringify(allowed)} | ${runsNow().length} runs`);
  await shot('1d-home-with-the-map');

  // Home that he closed while a file tab was open stays closed; when the last file tab closes, Home opens; Home closed itself leaves the area empty.
  await goTo('README.md');
  await closeTab('Home');
  const fileOnly = await waitTabs(['README.md']);
  await sleep(1000); // tabs that close within 0.3 s are one closing for the extension (CLOSE_MS): a person closes the last file tab later, and so does the check
  await closeTab('README.md');
  const afterLast = await waitTabs(['Home']);
  await closeTab('Home');
  await sleep(1500); // calm: Home must not come back by itself
  const afterHome = await tabs();
  check('Home that he closed while a file tab was open stays closed; when the last file tab closes, Home opens; when he closes Home itself, the area stays empty',
    fileOnly.join() === 'README.md' && afterLast.join() === 'Home' && afterHome.length === 0, `${fileOnly.join()} | ${afterLast.join()} | ${afterHome.join()}`);
  // Home that opens by itself leaves the keyboard in the terminal where he types.
  await goTo('README.md');
  await command('Terminal: Create New Terminal');
  await page.locator('.part.panel .xterm').first().waitFor({ timeout: 8000 });
  await command('View: Close All Editors');
  const terminalTabs = await waitTabs(['Home']);
  const terminalFocus = await until(async () => (await focus()) === 'panel' && 'panel', 3000) || await focus();
  await page.keyboard.type('typed after Home opened', { delay: 5 });
  await page.keyboard.press('Enter');
  const terminalText = await until(() => page.locator('.part.panel .xterm-rows').first().textContent().then((text) => text.includes('typed after Home opened') && text, () => ''), 4000);
  check('Home that opens after the last tab closes leaves the keyboard in the terminal: the words reach the terminal', terminalTabs.join() === 'Home' && terminalFocus === 'panel' && !!terminalText,
    `tabs ${terminalTabs.join()}; focus ${terminalFocus}`);
  await command('View: Toggle Panel Visibility');
  // With the setting off nothing opens. The rest of the run keeps it off, as every other check window does.
  await setSetting('apostil.homeWhenEmpty', false);
  await sleep(800); // VS Code reads the settings file again
  await goTo('README.md');
  await command('View: Close All Editors');
  await sleep(1500); // calm: nothing must open by itself
  const settingOff = await tabs();
  check('with the setting apostil.homeWhenEmpty off, nothing opens when the last tab closes', settingOff.length === 0, settingOff.join());

  // ---- 2. The notes beside the code in the editor of VS Code, first, before Apostil opens their file in a tab of its own ----
  await setSetting('apostil.notesBesideCode', 'editor');
  await sleep(1000); // VS Code reads the settings file again: nothing on the screen says when
  const FILE_TITLE = 'Hold back on a closed day'; // a note of the example in hold_service.py, with a text and a function
  /** The titles of notes after their lines in the editor in front, with the text of each line, the lines marked at their left, and the count in the status bar. */
  const editorState = () => page.evaluate(() => {
    const editor = document.querySelector('.editor-group-container.active .monaco-editor');
    const textOf = (span) => { const content = getComputedStyle(span, '::after').content; return content && content !== 'none' ? JSON.parse(content).replace(/[  ]/g, ' ').trim() : ''; };
    const titled = editor ? [...editor.querySelectorAll('.view-line span[class*="TextEditorDecorationType"]')].map((span) => ({ title: textOf(span), line: span.closest('.view-line').textContent.replace(/ /g, ' ') })).filter((one) => one.title) : [];
    return {
      titles: titled.map((one) => one.title), lineOf: Object.fromEntries(titled.map((one) => [one.title, one.line.trim()])),
      status: [...document.querySelectorAll('.statusbar-item')].map((item) => item.textContent.trim()).find((text) => /\d+ notes?\b/.test(text)) ?? '',
      tabs: [...document.querySelectorAll('.tabs-container .tab .label-name')].map((el) => el.textContent.trim()),
      marks: editor ? [...editor.querySelectorAll('.view-overlays div[class*="TextEditorDecorationType"]')].filter((el) => getComputedStyle(el).borderLeftWidth === '2px').length : 0,
      webview: !editor && !!document.querySelector('.webview.ready'),
    };
  });
  const stateWhere = (test, ms) => until(async () => { const now = await editorState(); return test(now) && now; }, ms).then(async (got) => got || editorState());
  await goTo('hold_service.py');
  await goTo(':218');
  const inEditor = await stateWhere((now) => now.titles.includes(FILE_TITLE) && !!now.status);
  check('with "editor" a code file that opens the normal way is the editor of VS Code, with the quiet titles of its notes after their first lines, no line at the left of a note not under the pointer, and a count in the status bar',
    !inEditor.webview && inEditor.tabs.join() === 'hold_service.py' && inEditor.marks === 0 && /^\d+ notes$/.test(inEditor.status), JSON.stringify({ ...inEditor, lineOf: undefined }));
  await shot('6-notes-beside-the-code');
  const titleAt = await page.evaluate((text) => {
    const textOf = (one) => { const content = getComputedStyle(one, '::after').content; return content && content !== 'none' ? JSON.parse(content).replace(/[  ]/g, ' ').trim() : ''; };
    const box = [...document.querySelectorAll('.editor-group-container.active .view-line span[class*="TextEditorDecorationType"]')].find((one) => textOf(one) === text)?.getBoundingClientRect();
    return box && { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }, FILE_TITLE);
  if (titleAt) { await page.mouse.move(titleAt.x - 30, titleAt.y); await page.mouse.move(titleAt.x, titleAt.y, { steps: 5 }); }
  const hover = await shown(page.locator('.monaco-hover:visible', { hasText: 'From the change' }).first(), 6000);
  const hoverText = hover ? (await page.locator('.monaco-hover:visible').first().textContent()).replace(/ /g, ' ') : '';
  const pointed = await stateWhere((now) => now.marks > 0, 2000);
  check('the pointer on the title of a note shows the whole note: its text, its function, the change and the link to the file tab; the lines of that note get the line at their left',
    hover && pointed.marks > 0 && hoverText.includes('The run stops when the library is closed, unless a test date is set.') && hoverText.includes('offer_returned_copies · 3 tests') && hoverText.includes('Open in the file tab of Apostil') && !hoverText.includes('\\'),
    hoverText.slice(0, 160));
  await page.mouse.move(5, 300);
  await page.keyboard.press('Escape');

  // The editor keeps the keyboard (find opens, typing types); the real key hides the notes of this tab and shows them again; lines typed above move a note, and an edit of its line takes it away.
  await command('View: Focus Active Editor Group');
  await page.keyboard.press('Meta+F');
  const find = await shown(page.locator('.editor-group-container.active .find-widget.visible').first(), 3000);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+Shift+Comma');
  const hidden = await stateWhere((now) => now.titles.length === 0 && /hidden$/.test(now.status), 3000);
  await page.keyboard.press('Meta+Shift+Comma');
  const again = await stateWhere((now) => now.titles.includes(FILE_TITLE), 3000);
  const noteLine = again.lineOf[FILE_TITLE];
  await page.keyboard.press('Meta+Home');
  await page.keyboard.type('# zq\n# zq\n', { delay: 5 });
  const moved = await stateWhere((now) => now.lineOf[FILE_TITLE] === noteLine && now.status === inEditor.status, 3000); // the title stands on the same code, two lines lower
  const typedHere = await page.evaluate(() => document.querySelector('.editor-group-container.active .view-lines').textContent.replace(/\u00a0/g, ' ').includes('# zq'));
  await goTo(':216'); // the first line of the note, two lines lower now
  await page.keyboard.press('End');
  await page.keyboard.type(' # edited', { delay: 5 });
  const older = await stateWhere((now) => /older than the code/.test(now.status), 4000);
  check('the editor keeps the keyboard: find opens and typing types; Cmd+Shift+, hides the notes of this tab and shows them again; two lines typed above move the note with its code, and an edit of a noted line takes a note away, "older than the code"',
    find && typedHere && hidden.titles.length === 0 && again.titles.includes(FILE_TITLE) && !!moved?.lineOf && /older than the code/.test(older.status), JSON.stringify({ find, typedHere, hidden: hidden.status, moved: moved.lineOf?.[FILE_TITLE], older: older.status }));
  await command('File: Revert File');

  // "off": no notes at all. "tab": a file that has notes opens in the file tab of Apostil, at the line that it was opened at (a line after its name in
  // Quick Open, as a search result has one); the key changes the tab to the editor and back, at the line of the cursor.
  await setSetting('apostil.notesBesideCode', 'off');
  const off = await stateWhere((now) => now.titles.length === 0 && now.status === '', 4000);
  await setSetting('apostil.notesBesideCode', 'tab');
  await sleep(1000); // VS Code reads the settings file again: nothing on the screen says when
  await command('View: Close All Editors');
  const tabAt = (line) => frameWhere((lines) => typeof App === 'object' && App.tab?.endsWith('hold_service.py') && App.state?.lines?.join() === lines, `${line},${line}`, 6000);
  await goTo('hold_service.py:245');
  const inTab = await stateWhere((now) => now.webview && now.tabs.join() === 'hold_service.py');
  const openedAtLine = await tabAt(245);
  await page.locator('.editor-group-container.active .tab.active').first().click(); // the keyboard into the tab, as a person clicks
  await page.keyboard.press('Meta+Shift+Comma');
  const plainEditor = await stateWhere((now) => !now.webview && /hidden$/.test(now.status));
  await goTo(':208');
  await page.keyboard.press('Meta+Shift+Comma');
  const backInTab = await stateWhere((now) => now.webview && now.tabs.join() === 'hold_service.py');
  const atLine = await tabAt(208);
  check('with "off" no note and no count shows; with "tab" a file that opens at a line opens in the file tab of Apostil at that line; the key changes the tab to the editor with no notes, and back to the file tab at the line of the cursor',
    off.titles.length === 0 && off.status === '' && inTab.webview && !!openedAtLine && !plainEditor.webview && plainEditor.titles.length === 0 && backInTab.webview && !!atLine,
    JSON.stringify({ off: off.status, inTab: inTab.webview, openedAtLine: !!openedAtLine, plain: plainEditor.status, back: backInTab.webview, atLine: !!atLine }));
  await shot('6b-the-setting-tab');
  await setSetting('apostil.notesBesideCode', 'tab'); // the default again, for the rest of the run
  await command('View: Close All Editors');

  // ---- 3. The list of the side bar, a pull request, Home, the tree "Files" and the line at the top across real tabs ----
  await command('View: Show Apostil');
  const list = await frameWith('.cl .row');
  const head = list ? await until(() => list.locator('.grp .head').evaluate((el) => {
    const read = { icon: el.querySelector('img.icon')?.naturalWidth > 0, text: el.textContent, oneLine: el.getBoundingClientRect().height < 2.4 * parseFloat(getComputedStyle(el).fontSize) };
    return read.oneLine && read; // the side bar can be narrow in the first moment after it opens
  }).catch(() => false), 4000) : {};
  const pullLines = list ? await list.locator('.row:not(.prow) .pr').first().waitFor({ timeout: 8000 }).then(() => list.locator('.row:not(.prow) .pr').allTextContents(), () => []) : [];
  const fold = list ? await list.locator('.more').textContent().catch(() => '') : '';
  check('the list in the side bar: the head of a session with its icon and name on one line, then the pull requests from the stand-in gh, two lines and a fold',
    !!head?.icon && head.text === SESSION_NAME && pullLines.join() === '#14checks failing · 1 of 1 checks failed,#12review needed' && fold === '1 more pull request', `${JSON.stringify(head)}; ${pullLines.join(', ')}; ${fold}`);
  await shot('2-list-in-the-side-bar');

  // A click on a pull request opens the page of its change at "Conversation"; one comment sent there reaches the stand-in gh once, on standard input.
  await list?.locator('.row:not(.prow) .pr', { hasText: '#12' }).click();
  const conv = await frameWith('.conv .ptitle');
  const conversation = conv ? await conv.evaluate(() => ({
    title: document.querySelector('.conv .ptitle').textContent, on: document.querySelector('.switch a.on')?.textContent,
    icon: getComputedStyle(document.querySelector('#status .pri')).maskImage.startsWith('url("data:'), strip: document.querySelector('#status .status')?.textContent,
  })).catch(() => ({})) : {};
  const looked = (() => { const read = new Store(storeFolder); const at = read.lastLooked('made-up/example', 12); read.close(); return at; })();
  const writesNow = () => (existsSync(ghWrites) ? readFileSync(ghWrites, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
  const readsNow = () => readFileSync(ghCalls, 'utf8').split('\n').filter((line) => line.startsWith('api graphql -f')).length;
  const writesBefore = writesNow().length;
  const readsBefore = readsNow();
  const commentText = 'A comment from the window check: "quoted", $(not run) and -f not an option 🚀';
  await conv?.locator('.ghend textarea').click();
  await page.keyboard.type(commentText, { delay: 2 });
  await page.keyboard.press('Meta+Enter');
  const writes = await until(() => writesNow().length > 0 && writesNow());
  await until(() => readsNow() > readsBefore); // the page reads the pull request again
  const fieldAfter = await until(() => conv.evaluate(() => document.querySelector('.ghend textarea')?.value === '' && { error: document.querySelector('.ghend .gherr')?.textContent ?? '' }));
  check('a click on a pull request opens its change at "Conversation" with the icon of its state, and the time he looked is kept; one comment reaches the stand-in gh once, as addComment with the text unchanged on standard input, and the page reads the pull request again',
    conversation.title === 'Holds for books that are out #12' && conversation.on === 'Conversation' && conversation.icon && !!looked && writesBefore === 0 && writes?.length === 1 && /addComment/.test(writes[0].query)
      && writes[0].variables?.subject === examplePullRequest().raw.pr.id && writes[0].variables?.body === commentText && readsNow() > readsBefore && fieldAfter && !fieldAfter.error,
    JSON.stringify({ conversation, looked: !!looked, writes, fieldAfter }));
  await shot('2a-a-comment-sent-to-the-stand-in-gh');
  await conv?.locator('.switch a[data-view="diagram"]').first().click();

  // The Home row opens Home; the icon of a row of the tree "Files" and the icon in the title bar of a file open the graphs of that file.
  await list?.locator('.home').click();
  const home = await homeFrame();
  check('the Home row opens the Home tab with the top map of its 8 areas', !!home && /^Home/.test(await activeTab() ?? ''), await activeTab());
  const filesPane = page.locator('.pane', { has: page.locator('.pane-header .title', { hasText: /^Files$/ }) });
  const rowOf = (name) => filesPane.locator('.monaco-list-row', { has: page.locator('.label-name', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }) }).first();
  for (const name of ['src', 'library', 'lending']) { await rowOf(name).click(); await rowOf(name).waitFor(); }
  const servicePath = 'src/library/lending/hold_service.py';
  await rowOf('hold_service.py').hover();
  const rowIcon = rowOf('hold_service.py').locator('.actions .action-label');
  await rowIcon.first().click();
  const graphsOf = (wanted, panels = 0) => frameWhere(({ wanted, panels }) => typeof Home === 'object' && Home.data?.path === wanted && document.querySelectorAll('.pnl .pd svg').length > panels, { wanted, panels });
  const graphs = await graphsOf(servicePath);
  const panels = graphs ? await graphs.evaluate(() => document.querySelectorAll('.pnl').length) : 0;
  await rowOf('permissions.py').click();
  const editorTab = await until(async () => { const now = await activeTab(); return /^permissions\.py/.test(now ?? '') && now; });
  await page.locator('.editor-group-container.active .editor-actions .action-label[aria-label*="Graphs of this folder or file"]').first().click();
  const titleGraphs = await graphsOf('src/library/lending/permissions.py');
  check('the icon of a row in the tree "Files" opens the graphs of that file as panels in a tab of its own; a click on a file name opens the file, and the icon in its title bar opens its graphs',
    panels === 5 && !!editorTab && !!titleGraphs, `${panels} panels; editor ${editorTab}; graphs ${!!titleGraphs}`);
  await shot('2c-graphs-of-a-file');
  await command('View: Close All Editors');

  // The path he followed across real tabs: Home, an area, a node that is one file opens the file, its graphs, a panel to the change page; a click on a step shows its tab.
  const lineIn = (frame) => frame.evaluate(() => {
    const whole = document.getElementById('crumb').cloneNode(true);
    whole.querySelector('[data-unfold]')?.replaceWith(whole.querySelector('[data-unfold]').title.replaceAll(' › ', '›'));
    return whole.textContent;
  });
  await list?.locator('.home').click();
  const walkHome = await homeFrame();
  await walkHome?.locator('#view g.node[id*="flowchart-lending-"]').click();
  const walkLower = await until(() => lineIn(walkHome).then((line) => line.includes('›') && line, () => ''));
  // The tree "Files" follows the map: the folder of the area is marked and open. Then it marks the file of the tab in front, and keeps it while a tab with no file is in front.
  const marked = () => filesPane.locator('.monaco-list-row.selected').first().evaluate((row) => `${row.querySelector('.label-name')?.textContent ?? row.textContent.trim()}${row.getAttribute('aria-expanded') === 'true' ? ' (open)' : ''}`).catch(() => '');
  const markedIs = (wanted) => until(async () => (await marked()) === wanted && wanted, 5000).then(async (got) => got || marked());
  const treeAtArea = await markedIs('lending (open)');
  // A node that is one file opens the file, not its graphs; a file with notes opens in the file tab of Apostil at once: the editor of VS Code never shows it first.
  await page.evaluate(() => {
    window.apostilTextEditorSeen = false;
    const look = () => { if (/^hold_service\.py/.test(document.querySelector('.editor-group-container.active .tab.active')?.getAttribute('aria-label') ?? '') && document.querySelector('.editor-group-container.active .editor-instance .monaco-editor .view-lines')) window.apostilTextEditorSeen = true; };
    window.apostilWatch = new MutationObserver(look);
    window.apostilWatch.observe(document.querySelector('.part.editor'), { subtree: true, childList: true, attributes: true });
  });
  await walkHome?.locator('#view g.node[id*="flowchart-service-"]').click();
  const fileTabShown = await until(async () => { const now = await activeTab(); return /^hold_service\.py/.test(now ?? '') && await frameWhere(() => typeof App === 'object' && !!App.tab?.endsWith('hold_service.py'), undefined, 300) && now; });
  const textEditorSeen = await page.evaluate(() => { window.apostilWatch.disconnect(); return window.apostilTextEditorSeen; });
  const treeAtFile = await markedIs('hold_service.py');
  await page.locator('.editor-group-container.active .editor-actions .action-label[aria-label*="Graphs of this folder or file"]').first().click();
  const walkGraphs = await graphsOf(servicePath, 2);
  await walkGraphs?.locator('.pnl[data-panel="2"]').click();
  const walkPage = await frameWhere(() => typeof Home !== 'object' && typeof App === 'object' && !App.tab && !!App.page && !!document.querySelector('#view svg') && document.getElementById('crumb').textContent.startsWith('Home'));
  const walkLine = walkPage ? await until(() => lineIn(walkPage).then((line) => line.split('›').length === 3 && line)) : '';
  const walkTitle = walkPage ? await walkPage.evaluate(() => App.page.title) : '';
  await walkPage?.locator('#crumb [data-trail="1"]').click({ timeout: 4000 }).catch(async () => {
    await walkPage.locator('#crumb [data-unfold]').click({ timeout: 4000 }); // folded in a narrow tab: "…" shows the steps first
    await walkPage.locator('#crumb [data-trail="1"]').click({ timeout: 4000 });
  }).catch(() => {});
  const graphsTabShown = await until(async () => { const now = await activeTab(); return /hold_service\.py/.test(now ?? '') && now; });
  await walkGraphs?.locator('#crumb [data-trail="0"]').click({ timeout: 4000 }).catch(() => {});
  const homeTabShown = await until(async () => { const now = await activeTab(); return /^Home/.test(now ?? '') && now; });
  const homeLine = walkHome ? await until(() => lineIn(walkHome).then((line) => line === 'Home' && line, () => '')) : '';
  const treeAtHome = await marked();
  check('across real tabs: a node that is one file opens the file, in the file tab of Apostil at once; from its graphs to the change page the line lists Home, the graphs and the change; a click on a step shows the tab of that step',
    walkLower === 'Home›Lending: holds, requests and mails' && !!fileTabShown && !textEditorSeen && walkLine === ['Home', servicePath, walkTitle].join('›') && !!graphsTabShown && homeLine === 'Home',
    `${walkLower} | ${fileTabShown}, text editor seen ${textEditorSeen} | ${walkLine} | ${graphsTabShown} | ${homeTabShown}: ${homeLine}`);
  check('the tree "Files" follows the map: a click on an area marks and opens its folder; the tree marks the file of the tab in front, and keeps it marked when a tab with no file comes to the front',
    treeAtArea === 'lending (open)' && treeAtFile === 'hold_service.py' && treeAtHome === 'hold_service.py', `${treeAtArea} | ${treeAtFile} | ${treeAtHome}`);

  // The icons of the services on a node of Home: the pointer on them opens their window, and a click on a service with one place opens its file at that line.
  await walkHome?.locator('#view g[id*="flowchart-jobs-"] .mk-stack.right .mk-more').hover({ timeout: 4000 }).catch(() => {});
  const stackRows = await walkHome?.waitForSelector('.win .mk-row', { timeout: 4000 }).then(() => walkHome.$$eval('.win .mk-row', (rows) => rows.length)).catch(() => 0);
  await walkHome?.locator('.win .mk-row[data-mk-value="services:night-bell"]').click().catch(() => {});
  const bellLine = await until(() => page.locator('[id="status.editor.selection"]').textContent({ timeout: 1000 }).then((text) => /^Ln 516\b/.test(text ?? '') && text, () => ''));
  check('Home: the icons of the services stand on a node, the pointer on them opens their window, and a click on a service with one place opens its file at that line',
    stackRows === 4 && !!bellLine && /night_jobs\.py/.test(await activeTab() ?? ''), `${stackRows} rows; ${bellLine}; tab ${await activeTab()}`);

  // From Home down to a process: a click on a step with no inner steps opens its file at its first line, in the file tab with its notes.
  await list?.locator('.home').click();
  const processHome = await homeFrame();
  for (const key of ['routes', 'q0', 's2', 's7']) await processHome?.locator(`#view g.node[id*="flowchart-${key}-"]`).click({ timeout: 8000 });
  const inStepTab = () => frameWhere(() => typeof App === 'object' && App.tab?.endsWith('lending/requests.py') && App.state?.lines?.join() === '62,62' && !!document.querySelector('.cv [data-line="62"]'), undefined, 8000);
  let stepTab = await inStepTab();
  if (!stepTab && /^Home/.test(await activeTab() ?? '')) { // under load the last click can land while Home draws the step again
    console.log('NOTE  the click on the step left Home in front; once more');
    await processHome?.locator('#view g.node[id*="flowchart-s7-"]').click({ timeout: 8000 }).catch(() => {});
    stepTab = await inStepTab();
  }
  check('from Home a click on a node goes down to its processes, and a click on a step opens its file at its first line, in the file tab with its notes', !!stepTab && /^requests\.py/.test(await activeTab() ?? ''), `tab ${await activeTab()}`);

  // A click whose target is a prompt (a look of the repo, build 57): VS Code asks with the whole words and "Send". With no "Send" the stand-in claude
  // gets no run; with "Send" it gets one, with the words. A browser cannot show VS Code's question.
  const PROMPT = 'Explain how the night jobs wake the lending code, in three short sentences.';
  const lookNow = (look) => { const write = new Store(storeFolder); const saved = setLook(write, repo, look); write.close(); return saved.saved; };
  const promptLook = lookNow({ rules: [{ pick: { kind: 'node', diagram: 'lib-top', nodes: ['jobs'] }, click: { prompt: PROMPT } }] });
  await command('View: Close All Editors'); // Home opens again at its top map, where the node is
  await list?.locator('.home').click();
  const promptHome = await frameWhere(() => typeof Home === 'object' && Home.data?.look?.rules.some((rule) => rule.click?.prompt) && !!document.querySelector('#view g.node[id*="flowchart-jobs-"]'));
  const dialog = page.locator('.monaco-dialog-box');
  const answerPrompt = async (button) => {
    // Under load Home can draw again right after a question closes: a click that brings no question is made once more.
    let shownAsk = false;
    for (let turn = 0; turn < 2 && !shownAsk; turn += 1) {
      if (turn) console.log('NOTE  the click on the node brought no question; once more');
      await promptHome?.locator('#view g.node[id*="flowchart-jobs-"]').click({ timeout: 4000 }).catch(() => {});
      shownAsk = await shown(dialog, 6000);
    }
    const words = shownAsk ? (await dialog.textContent()).replace(/\s+/g, ' ') : '';
    const buttons = shownAsk ? await dialog.locator('.dialog-buttons .monaco-button').allTextContents() : [];
    if (shownAsk) await dialog.locator('.dialog-buttons .monaco-button', { hasText: button }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
    return { words, buttons };
  };
  const runsBeforeAsk = runsNow().length;
  const notSent = await answerPrompt('Cancel');
  await shot('3d-the-question-before-a-prompt-of-the-look');
  const promptSent = await answerPrompt('Send');
  const runAfterSend = await until(() => runsNow().length > runsBeforeAsk && runsNow());
  check('a click whose target is a prompt: VS Code asks with the whole words and "Send"; with no "Send" the stand-in claude gets no run, with "Send" it gets one with the words',
    promptLook && !!promptHome && notSent.words.includes('Send this to a new session of Claude Code?') && notSent.words.includes(PROMPT) && notSent.buttons.includes('Send')
      && promptSent.words.includes(PROMPT) && runAfterSend?.length === runsBeforeAsk + 1 && runAfterSend.at(-1).includes(PROMPT),
    JSON.stringify({ promptLook, home: !!promptHome, notSent, sent: promptSent.buttons, runs: `${runsBeforeAsk} -> ${runsNow().length}` }));

  // The tree "Files" in a look of the repo (build 61): a folder that a rule leaves out is not there; a file that a rule picks has the icon of the look and
  // quiet words after its name, and a click on it goes to the target of the rule. A browser cannot show VS Code's own tree.
  const fileRowOf = (name) => filesPane.locator('.monaco-list-row', { has: page.locator('.label-name', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }) });
  const jobsBefore = await fileRowOf('jobs').count();
  const lookFiles = putLookFiles(repo);
  const treeLook = lookNow({ rules: [
    { pick: { kind: 'tree-folder', paths: ['src/library/jobs/'] }, show: { shown: false } },
    { pick: { kind: 'tree-file', paths: ['src/library/lending/hold_service.py'] }, text: { icon: 'apostil-look-open.svg' }, content: { words: 'in the look' }, click: { file: 'src/library/night_jobs.py', line: 516 } },
  ] });
  lookFiles.clean();
  const treeRow = await until(() => fileRowOf('hold_service.py').first().evaluate((row) => {
    const icon = row.querySelector('.custom-view-tree-node-item-icon');
    const read = { words: row.querySelector('.label-description')?.textContent ?? '', icon: icon ? getComputedStyle(icon).backgroundImage : '', label: row.querySelector('.monaco-icon-label')?.className ?? '' };
    return read.words === 'in the look' && read;
  }).catch(() => false), 10000);
  const jobsAfter = await fileRowOf('jobs').count();
  await shot('3f-the-tree-files-in-a-look');
  await fileRowOf('hold_service.py').first().click().catch(() => {});
  const treeTarget = await until(() => page.locator('[id="status.editor.selection"]').textContent({ timeout: 1000 }).then((text) => /^Ln 516\b/.test(text ?? '') && text, () => ''));
  check('the tree "Files" in a look: the folder that a rule leaves out is gone; the file that a rule picks has the icon of the look and its quiet words after the name, and a click on it goes to the target of the rule',
    treeLook && jobsBefore === 1 && jobsAfter === 0 && !!treeRow && /^url\(/.test(treeRow.icon) && !!treeTarget && /night_jobs\.py/.test(await activeTab() ?? ''),
    JSON.stringify({ treeLook, jobsBefore, jobsAfter, treeRow, treeTarget, tab: await activeTab() }));

  // A click whose target is a page of the look (build 58) opens the page as a tab named by its title; its table has the rows of the file, and after the
  // file changes on disk the table shows the new row. A browser cannot show a tab of VS Code or a file that changes.
  const branches = path.join(repo, 'data/branches.csv');
  const branchesText = readFileSync(branches, 'utf8');
  const pageLook = lookNow({
    pages: [{ id: 'opening-hours', title: 'Opening hours', blocks: [{ title: 'Branches', table: { file: 'data/branches.csv', columns: ['branch', 'opens', 'closes'] } }] }],
    rules: [{ pick: { kind: 'node', diagram: 'lib-top', nodes: ['jobs'] }, click: { page: 'opening-hours' } }],
  });
  await command('View: Close All Editors');
  await list?.locator('.home').click();
  const pageHome = await frameWhere(() => typeof Home === 'object' && Home.data?.look?.pages?.length === 1 && !!document.querySelector('#view g.node[id*="flowchart-jobs-"]'));
  await pageHome?.locator('#view g.node[id*="flowchart-jobs-"]').click({ timeout: 4000 }).catch(() => {});
  const pageTabs = await waitTabs(['Home', 'Opening hours']);
  /** The names of the rows of the table of the page of the look, as its tab shows them. */
  const pageRows = async () => {
    const frame = await frameWhere(() => typeof Home === 'object' && Home.data?.kind === 'page', undefined, 3000);
    return frame ? frame.evaluate(() => [...document.querySelectorAll('.block-table tbody tr')].map((row) => row.cells[0].textContent)) : [];
  };
  const firstRows = await until(async () => { const rows = await pageRows(); return rows.length > 0 && rows; }) || [];
  await shot('3e-a-page-of-the-look');
  writeFileSync(branches, `${branchesText}Riverside,09:00,15:00,6\n`);
  const newRows = await until(async () => { const rows = await pageRows(); return rows.length === firstRows.length + 1 && rows; }) || await pageRows();
  check('a click whose target is a page of the look opens it as a tab named by its title; its table has the rows of the file, and after the file changes on disk it shows the new row',
    pageLook && pageTabs.join() === 'Home,Opening hours' && firstRows.join() === 'North,Harbour,Old Town,Station' && newRows.at(-1) === 'Riverside', JSON.stringify({ pageLook, pageTabs, firstRows, newRows }));
  writeFileSync(branches, branchesText);
  lookNow({ rules: [] }); // the default look again for the parts after this one
  await command('View: Close All Editors');

  // ---- 4. The change page and its file tabs ----
  await command('Apostil: Open the newest change');
  // Its branch has a pull request (the stand-in gh), so it opens at "Conversation"; the diagram is one click away.
  const atConversation = await frameWith('.switch a.on[data-view="conversation"]');
  if (!atConversation) throw new Error('The change with a pull request did not open at "Conversation".');
  await atConversation.locator('.bar .switch a[data-view="diagram"]').click();
  const stage = await frameWith('#view .nodeLabel');
  if (!stage) throw new Error('No page of the change to drive.');
  const font = await stage.evaluate(() => ({
    family: getComputedStyle(document.body).fontFamily, size: getComputedStyle(document.body).fontSize, vscode: getComputedStyle(document.documentElement).getPropertyValue('--vscode-font-family').trim(),
    code: getComputedStyle(document.querySelector('.nodeLabel .f')).fontFamily, editor: getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-font-family').trim(),
    left: document.querySelector('.paper').getBoundingClientRect().left,
  }));
  const workbenchFont = await page.evaluate(() => ({ family: getComputedStyle(document.querySelector('.monaco-workbench')).fontFamily, size: getComputedStyle(document.querySelector('.monaco-workbench')).fontSize }));
  const plain = (text) => text.replace(/["'\s]/g, '');
  const appState = await until(() => { const read = new Store(storeFolder); const state = read.appState(); read.close(); return state.changeId === changeId && state.view === 'diagram' && state; }, 4000);
  check('the page draws the diagram of the change, fills its tab, and its font is the font of VS Code, its code the font of the editor; the state that agents read names the open change and its view',
    appState?.view === 'diagram' && font.left === 0 && !!font.vscode && plain(font.family) === plain(workbenchFont.family) && font.size === workbenchFont.size && !!font.editor && plain(font.code) === plain(font.editor), JSON.stringify(font));
  await shot('3-change-as-diagram');

  // Opening a file from the page opens the file as a tab of its own, in the group of the page, with its file icon, in Apostil's view.
  const tabOf = (name) => page.locator('.editor-group-container .tab', { has: page.locator('.label-name', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }) });
  const fileTab = (name) => frameWhere((wanted) => typeof App === 'object' && !!App.tab?.endsWith(wanted) && !!document.querySelector('.cv [data-line]'), `/${name}`);
  const groupOf = (tab) => tab.evaluate((el) => [...document.querySelectorAll('.editor-group-container')].indexOf(el.closest('.editor-group-container')));
  const changeTab = page.locator('.tab', { hasText: 'book-holds' }).first();
  await stage.evaluate(() => App.showCode('web/src/member/HoldsPanel.tsx', null)); // what the name of a file in the list does; a click on a file in a node opens its diff in the list now
  const newTab = await fileTab('HoldsPanel.tsx');
  const newFile = newTab ? await newTab.evaluate(() => ({ added: document.querySelectorAll('.cv .code .l.add').length, rows: document.querySelectorAll('.cv .code [data-line]').length })) : {};
  const tabLook = await tabOf('HoldsPanel.tsx').first().evaluate((el) => ({ icon: el.querySelector('.monaco-icon-label')?.className ?? '', active: el.classList.contains('active') })).catch(() => ({}));
  check('a click on a new file opens a tab named after it, with its file icon, in the group of the page, every line added, and no diff editor',
    !!newTab && newFile.added > 0 && newFile.added === newFile.rows && /tsx-ext-file-icon/.test(tabLook.icon) && tabLook.active && await groupOf(tabOf('HoldsPanel.tsx').first()) === await groupOf(changeTab)
      && (await page.locator('.monaco-diff-editor').count()) === 0, `${JSON.stringify(newFile)}; ${JSON.stringify(tabLook)}`);

  // New data reaches the change page while it is hidden behind the file tab; back on its tab, the diagram shows with its parts.
  store.addRemark(changeId, { kind: 'part', part: 'tables', label: 'Part "Tables"' }, 'Is the index on pickup_by needed?');
  const gotWhileHidden = await until(() => stage.evaluate(() => App.page.remarks.some((remark) => remark.text.startsWith('Is the index'))), 6000);
  await changeTab.click();
  const back = await until(() => stage.evaluate(() => {
    const nodes = [...document.querySelectorAll('#view g.node')];
    return document.visibilityState === 'visible' && nodes.length >= 7 && nodes.every((node) => node.getBoundingClientRect().width > 40) && { parts: document.querySelectorAll('#view b[data-part]').length, nodes: nodes.length };
  }));
  check('the change page gets new data while another tab shows, and shows the diagram with its parts when he comes back', gotWhileHidden && back?.parts === 6, JSON.stringify({ gotWhileHidden, back }));

  // A second click on a changed file shows its open tab, and no second one; J in a file tab opens the next changed file in the same tab; the control lists every file.
  const pointerToTop = async () => { const crumb = await stage.locator('#crumb').boundingBox(); await page.mouse.move(crumb.x + 4, crumb.y + crumb.height / 2); await stage.waitForSelector('.win', { state: 'detached', timeout: 3000 }).catch(() => {}); };
  const clickNightJobs = async () => { await pointerToTop(); await stage.locator('.f[data-file="src/library/night_jobs.py"]').click({ timeout: 8000 }); };
  await clickNightJobs();
  const nightJobs = await fileTab('night_jobs.py');
  await nightJobs?.evaluate(() => Code.shown.steps.enter(-1)); // at its last change, which removes and adds lines
  const changedRows = nightJobs ? await nightJobs.waitForFunction(() => {
    const removed = document.querySelectorAll('.cv .code .l.del').length, added = document.querySelectorAll('.cv .code .l.add').length;
    return removed > 0 && added > 0 && { removed, added };
  }, null, { timeout: 4000 })
    .then((handle) => handle.jsonValue()).then((rows) => rows, () => ({})) : {};
  await changeTab.click();
  await clickNightJobs();
  await until(async () => /night_jobs\.py/.test(await activeTab() ?? ''));
  const oneTab = (await tabOf('night_jobs.py').count()) === 1 && (await page.locator('.monaco-diff-editor').count()) === 0;
  await nightJobs?.locator('.cv .code').click({ position: { x: 200, y: 100 } });
  await page.keyboard.press('j');
  const nextTab = await fileTab('ready_shelf.py');
  if (nextTab) { await nextTab.locator('.nav [data-files]').click(); await nextTab.locator('.win.files [data-show="src/library/night_jobs.py"]').click(); }
  const pickedTab = await fileTab('night_jobs.py');
  check('a second click on a changed file shows its tab and opens no second one and no diff editor; J in the file tab opens the next changed file in the same tab, and the list of the control opens night_jobs.py in it',
    changedRows.removed > 0 && oneTab && !!nextTab && !!pickedTab && (await tabOf('ready_shelf.py').count()) === 0, `${JSON.stringify(changedRows)}; one tab ${oneTab}; next ${!!nextTab}; picked ${!!pickedTab}`);

  // Cmd+B (build 64): with the views of Apostil in the side bar and a page of Apostil in front that has the keyboard, the key hides the side bar, it stays
  // hidden for a second, and the key shows it again. Shown and hidden at once (one press that ran twice did this), it stays hidden too: the tree "Files"
  // marks the file in front only when it still shows.
  const sideBarShows = () => page.evaluate(() => { const part = document.querySelector('.part.sidebar'); return !!part && part.getBoundingClientRect().width > 0 && getComputedStyle(part).display !== 'none'; });
  const apostilShows = () => filesPane.first().isVisible().catch(() => false);
  if (!(await apostilShows())) await command('View: Show Apostil');
  await pickedTab?.locator('.cv .code').click({ position: { x: 200, y: 100 } }); // the keyboard is in the page
  const sideBefore = { shows: await sideBarShows(), apostil: await apostilShows(), front: await activeTab(), focus: await page.evaluate(() => document.activeElement?.tagName) };
  await page.keyboard.press('Meta+B');
  const sideHidden = await until(async () => !(await sideBarShows()), 3000);
  await sleep(1000); // calm: the side bar must not come back by itself
  const sideStays = !(await sideBarShows());
  await page.keyboard.press('Meta+B');
  await page.keyboard.press('Meta+B');
  await sleep(700); // a mark of the tree that was asked for as it showed would have opened it by now
  const sideTwice = !(await sideBarShows());
  await page.keyboard.press('Meta+B');
  const sideAgain = await until(() => sideBarShows(), 3000);
  check('Cmd+B with the views of Apostil in the side bar and a page of Apostil in front hides the side bar, and it stays hidden for a second; shown and hidden at once it stays hidden; Cmd+B again shows it',
    sideBefore.shows && sideBefore.apostil && /night_jobs\.py/.test(sideBefore.front ?? '') && sideBefore.focus === 'IFRAME' && sideHidden && sideStays && sideTwice && sideAgain,
    JSON.stringify({ sideBefore, sideHidden, sideStays, sideTwice, sideAgain }));

  // "Diagram" in a wide tab: Alt+Down and Alt+Up as real keys step through the diffs of night_jobs.py and open its diff, and the graph at the left follows.
  // The side bar closes first, so that the page has the width of the two halves.
  await command('View: Close Primary Side Bar');
  await changeTab.click();
  const sideOpen = await stage.locator('#side [data-fold]').isVisible().catch(() => false);
  if (sideOpen) { await stage.locator('#side [data-fold]').click(); await stage.waitForFunction(() => document.querySelector('#side')?.classList.contains('folded')); }
  const wide = await stage.evaluate(() => Split.wide() && !!document.querySelector('#view > .half.right'));
  if (wide) {
    await stage.locator('#view .dp').first().click();
    await stage.evaluate(() => App.diffs.toPath('src/library/night_jobs.py'));
    await stage.waitForFunction(() => App.diffs.here()?.path === 'src/library/night_jobs.py');
    await page.keyboard.press('Alt+ArrowDown');
    await stage.waitForFunction(() => App.diffs.here()?.run >= 1, null, { timeout: 4000 }).catch(() => {});
    await page.keyboard.press('Alt+ArrowUp');
    const follows = await until(() => stage.evaluate(() => {
      const here = App.diffs?.here();
      const cards = [...document.querySelectorAll('#view > .half.left > *')].map((el) => el.querySelector('.gt')?.textContent ?? 'change');
      return here?.run === 0 && cards.join() === 'The night run, message by message' && document.querySelectorAll('#view > .half.left .joined').length > 0
        && { path: here.path, open: document.querySelectorAll('#view > .half.right .dfile.open').length, cards };
    }));
    check('on "Diagram" in a wide tab Alt+Down and Alt+Up as real keys step through the diffs of night_jobs.py and open its diff, and the graph at the left follows with its things lit',
      follows?.path === 'src/library/night_jobs.py' && follows.open >= 1, JSON.stringify(follows));
    await shot('3b-diagram-the-graph-follows-alt-down');
    await stage.locator('[data-all="close"]').click();
    await stage.locator('.codeswitch[data-half="code"]').click(); // "Hide code": the hover windows below belong to the diagram alone
    await stage.waitForFunction(() => !document.querySelector('#view > .half.right'));
  } else check('the window is wide enough for the two halves of the diagram page', false, 'no two halves');
  if (sideOpen) { await stage.locator('#side .rail').click(); await stage.waitForFunction(() => !document.querySelector('#side')?.classList.contains('folded')); }

  // The real editor only on request: "Open" in the hover window of a file opens its diff editor; a folder name reveals the folder in the Explorer.
  await pointerToTop();
  await stage.locator('.f[data-file="src/library/night_jobs.py"]').hover();
  await stage.locator('.win [data-open]').click({ timeout: 4000 });
  const diffEditor = await shown(page.locator('.monaco-diff-editor').first(), 6000);
  await pointerToTop();
  await stage.locator('.f[data-file="src/library/night_jobs.py"]').hover();
  await stage.locator('.win [data-folder]').click({ timeout: 4000 });
  const folderRow = page.locator('.explorer-folders-view .monaco-list-row[aria-expanded="true"]', { hasText: /library\s*$/ }); // with compact folders the row reads "src / library"
  const revealed = await shown(folderRow.first(), 6000);
  const subfolders = await page.locator('.explorer-folders-view .monaco-list-row[aria-expanded="true"]', { hasText: /^(lending|web)$/ }).count();
  check('"Open" in the hover window of a changed file opens its diff editor beside the page; a folder name reveals that folder in the Explorer, open, with its subfolders closed',
    diffEditor && revealed && subfolders === 0, `diff editor ${diffEditor}; folder ${revealed}; open subfolders ${subfolders}`);
  await shot('3c-diff-editor-and-folder');

  // ---- 5. Comments: the key, a run of the session, the input box of VS Code, a file tab, a new session and its terminal, a node ----
  const boxField = '.cbox [data-field="new"]';
  const fieldFocused = (frame = stage) => frame.waitForFunction((selector) => document.activeElement?.matches(selector), boxField, { timeout: 8000 }).then(() => true, () => false);
  const isFolded = (frame = stage) => frame.$eval('#side', (el) => el.classList.contains('folded'));
  const foldPanel = async (frame = stage) => { if (!(await isFolded(frame))) { await frame.locator('#side [data-fold]').click(); await frame.waitForFunction(() => document.querySelector('#side').classList.contains('folded')); } };
  const cursorKnown = () => { const read = new Store(storeFolder); const state = read.appState(); read.close(); return JSON.stringify([state.file, state.lines]); };
  /** A click on a line of the diff editor. With `first`, the first click there: it waits until the extension has the place of the cursor, as a click in an editor also tells it that the pointer left the page. */
  const clickInEditor = async (first = false) => {
    const before = cursorKnown();
    const box = await page.locator('.monaco-diff-editor .editor.modified').first().boundingBox();
    await page.mouse.click(box.x + box.width * 0.6, box.y + 120);
    if (first) await until(() => cursorKnown() !== before, 3000);
  };
  /**
   * The pointer on a thing of a page. It waits for one answer of the extension to the page: the page told the extension before that the pointer is on it,
   * so the key of a comment, which works with the pointer on the page, is ready in VS Code.
   */
  const pointAt = async (frame, selector) => {
    const target = frame.locator(selector).first();
    await target.hover();
    await frame.evaluate(() => ask('code:README.md')).catch(() => {});
    return target.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  };
  const lineInView = (frame) => frame.evaluate(() => { // a code line in the middle of a file tab: rows drawn above the view lie under the tabs of VS Code
    const box = document.querySelector('.cv').getBoundingClientRect();
    for (let y = box.top + box.height / 2; y < box.bottom; y += 6) {
      const row = document.elementFromPoint(box.left + 120, y)?.closest('[data-line]');
      if (row) return `.cv .code [data-line="${row.dataset.line}"] .n`;
    }
    throw new Error('No line of the file in view.');
  });
  await clickInEditor(true);
  const pointer = await pointAt(stage, 'b[data-part="hold-service"]');
  await page.keyboard.press('Meta+Shift+Period');
  const icon = await stage.waitForFunction(() => /^url\("data:image\/svg\+xml/.test(getComputedStyle(document.querySelector('#view')).cursor), null, { timeout: 4000 }).then(() => true, () => false);
  const noBoxYet = (await stage.locator('.cbox').count()) === 0;
  await stage.locator('b[data-part="hold-service"]').first().click();
  const newCard = await fieldFocused();
  const placed = newCard ? await stage.$eval('.cbox', (el) => ({ ...el.getBoundingClientRect().toJSON(), room: innerWidth })) : {};
  // The key once more with the box open: VS Code passes each press on to the extension a moment later, and that copy must not take the keyboard out of the field.
  if (newCard) { await page.keyboard.press('Meta+Shift+Period'); await page.keyboard.type('Why is the pickup day set before the mail is sent?', { delay: 8 }); await page.keyboard.press('Enter'); }
  const onPart = await until(() => remarks().find((remark) => remark.target.kind === 'part' && remark.target.part === 'hold-service'));
  const inWindow = await until(() => stage.locator('#side .thread[data-thread]', { hasText: 'Why is the pickup day set before the mail is sent?' }).count());
  check('Cmd+Shift+. with the pointer on a part and the keyboard in a text editor turns the pointer into a comment icon with no box; a click sticks the box at the pointer with the keyboard in its field; the key once more leaves the keyboard there, so all the typed words are saved; Enter saves it as open and it shows in the comments window',
    icon && noBoxYet && newCard && Math.abs(placed.left - Math.max(8, Math.min(pointer.x, placed.room - placed.width - 8))) <= 4 && Math.abs(placed.top - pointer.y) <= 4 && onPart?.state === 'open' && inWindow === 1,
    `icon ${icon}; box ${Math.round(placed.left)},${Math.round(placed.top)} at ${Math.round(pointer.x)},${Math.round(pointer.y)}; stored ${onPart?.state}`);

  // A comment with "@cl" lights claude-current, named after its session; the saved comment starts a run in that session at once, and its answer shows as a reply.
  await foldPanel();
  await pointAt(stage, 'b[data-part="routes"]');
  await page.keyboard.press('Meta+Shift+Period');
  await stage.locator('b[data-part="routes"]').first().click();
  let option = '', does = '';
  if (await fieldFocused()) {
    await page.keyboard.type('Log the opening hours that the run used. @cl', { delay: 2 });
    option = await stage.locator('.mentions .opt.lit .nm').textContent({ timeout: 3000 }).catch(() => '');
    if (!option) { // where the keys went, when the list of mentions did not come
      const typed = await stage.locator(boxField).innerText().catch(() => 'no field');
      const inPage = await stage.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`.slice(0, 80)).catch(() => 'no page');
      const inWindow = await page.evaluate(() => { const el = document.activeElement; return `${el?.tagName}.${String(el?.className).slice(0, 60)} in ${el?.closest('.part, .editor-group-container, .quick-input-widget')?.className?.slice(0, 60) ?? 'no part'}`; });
      console.log(`NOTE  "@cl" gave no list of mentions: the field holds "${typed}"; the keyboard is in ${inPage} of the page and in ${inWindow} of the window`);
    }
    does = await stage.locator('.mentions .opt.lit .does').textContent().catch(() => '');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
  }
  if (await isFolded()) await stage.locator('#side [data-unfold]').click();
  const card = stage.locator('#side .thread[data-thread]', { hasText: 'Log the opening hours that the run used.' });
  const answered = await shown(card.locator('.msg', { hasText: 'Answered by the stand-in.' }), 10000);
  const sent = remarks().find((remark) => remark.text.startsWith('Log the opening hours that the run used.'));
  const who = answered ? await card.locator('.msg .who').last().textContent() : '';
  check('"@cl" lights claude-current, named after its session; Tab writes it, the saved comment starts a run in that session at once, and its answer shows as a reply of Claude Code without a click',
    option === 'claude-current' && does === `the session ${SESSION_NAME}` && sent?.to?.kind === 'current' && sent.text.endsWith('@claude-current') && answered && /^Claude Code/.test(who), `"${option}" (${does}); ${sent?.state}; ${who}`);
  await shot('4-answer-as-a-reply');

  // The key on lines selected in a text editor asks in the input box of VS Code.
  await foldPanel();
  await clickInEditor();
  await page.keyboard.press('Home');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Meta+Shift+Period');
  const inputBox = await quickOpen();
  if (inputBox) { await page.keyboard.type('Is this loop covered by a test?', { delay: 2 }); await page.keyboard.press('Enter'); }
  const onLines = await until(() => remarks().find((remark) => remark.target.kind === 'lines' && remark.target.file === 'src/library/night_jobs.py'));
  const linesShown = await until(() => stage.evaluate(() => App.page.remarks.some((remark) => remark.text === 'Is this loop covered by a test?')));
  check('the key on lines selected in a text editor asks in the input box of VS Code; Enter stores the comment for those lines and the page has it', inputBox && !!onLines && linesShown, onLines?.target.label ?? 'not stored');

  // The file tab has the key too; a click on a card there shows the change page and lights the part of the comment.
  await tabOf('night_jobs.py').first().click();
  const tabFrame = await fileTab('night_jobs.py');
  let tabBox = false, cardLit = false;
  if (tabFrame) {
    const line = await lineInView(tabFrame);
    await pointAt(tabFrame, line);
    await page.keyboard.press('Meta+Shift+Period');
    await tabFrame.locator(line).click();
    tabBox = await fieldFocused(tabFrame);
    await page.keyboard.press('Escape');
    if (await isFolded(tabFrame)) await tabFrame.locator('#side [data-unfold]').click();
    await tabFrame.locator('#side .thread[data-thread]', { hasText: 'Why is the pickup day set before the mail is sent?' }).locator('.tx').first().click();
    cardLit = await stage.waitForFunction(() => !!document.querySelector('.paper .flash[data-rk="part:hold-service"]'), null, { timeout: 4000 }).then(() => true, () => false);
  }
  check('in a file tab the key and a click on a code line stick the comment box there; a click on a comment card there shows the change page and lights its part',
    tabBox && cardLit && /^book-holds/.test(await activeTab() ?? ''), `box ${tabBox}; lit ${cardLit}; tab ${await activeTab()}`);

  // A comment to "@claude-new" in a file tab runs the stand-in claude, which answers; the session link then opens a terminal with "claude --resume <session>".
  await foldPanel();
  await pointerToTop();
  await stage.locator('.f[data-file="src/library/lending/hold_service.py"]').click();
  const big = await fileTab('hold_service.py');
  if (!big) throw new Error('No file tab of hold_service.py.');
  await big.locator('.cv .code').click({ position: { x: 200, y: 100 } }); // the keyboard into the new tab, as a person clicks
  await foldPanel(big);
  const bigLine = await lineInView(big);
  await pointAt(big, bigLine);
  await page.keyboard.press('Meta+Shift+Period');
  await big.locator(bigLine).click();
  if (await fieldFocused(big)) { await page.keyboard.type('Check the index. @claude-n', { delay: 2 }); await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); }
  if (await isFolded(big)) await big.locator('#side [data-unfold]').click();
  const runCard = big.locator('#side .thread[data-thread]', { hasText: 'Check the index.' });
  const answeredRun = await shown(runCard.locator('.msg', { hasText: 'Answered by the stand-in.' }), 15000);
  const stored = await until(() => { const one = remarks().find((remark) => remark.text.startsWith('Check the index.')); return one?.run?.session && one; });
  await runCard.locator('[data-session]').click({ timeout: 5000 }).catch(() => {});
  const terminal = await page.locator('.xterm-rows', { hasText: 'stand-in-run-0001' }).first().waitFor({ timeout: 8000 }).then(() => page.locator('.xterm-rows', { hasText: 'stand-in-run-0001' }).first().textContent(), () => '');
  check('a comment to @claude-new runs the stand-in claude, which answers; the run keeps its session, and the session link opens a terminal with "claude --resume <session>"',
    answeredRun && stored?.run?.session === 'stand-in-run-0001' && /claude --resume stand-in-run-0001/.test(terminal), `answered ${answeredRun}; session ${stored?.run?.session}; terminal "${terminal.trim().slice(0, 100)}"`);
  await shot('4b-session-link-opens-a-terminal');
  await command('View: Toggle Panel Visibility');

  // A comment on a node of a part's diagram reaches the agent with the lines that say what the node is: the prompt is a contract that the agent reads.
  await changeTab.click();
  await foldPanel();
  await stage.evaluate(() => App.go({ level: 'part', part: 'hold-service', diagram: 'offer-flow' }));
  const nodeSelector = 'g.node[data-rk="node:offer-flow:open"]';
  await stage.waitForSelector(nodeSelector);
  await pointAt(stage, nodeSelector);
  await page.keyboard.press('Meta+Shift+Period');
  await stage.locator(nodeSelector).click();
  let nodeWords = '';
  if (await fieldFocused()) {
    nodeWords = await stage.locator('.cbox .where').textContent();
    await page.keyboard.type('Explain this. @claude-n', { delay: 2 });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
  }
  const nodeRemark = await until(() => { const one = remarks().find((remark) => remark.text.startsWith('Explain this.')); return one?.state === 'done' && one; }, 15000);
  const prompt = existsSync(path.join(temp, 'prompt.txt')) ? readFileSync(path.join(temp, 'prompt.txt'), 'utf8') : '';
  // The run of that comment was started with the tools to read and edit, and its prompt holds the diagram as text.
  const lastRun = readFileSync(runs, 'utf8').split(RUN).at(-1).split('\n');
  const tools = lastRun.slice(lastRun.indexOf('--allowedTools') + 1, lastRun.indexOf('--allowedTools') + 8);
  check('a comment on a node of a part\'s diagram reaches the stand-in claude with the lines that say what the node is and the diagram as text, started with Edit among its allowed tools; in the whole run the stand-in gh got one write, the one send',
    nodeWords === 'Node "Library open today?", diagram "How one night run offers returned copies"' && nodeRemark?.target.node === 'open'
      && /about what he pointed at:\n {4}In the flow chart "How one night run offers returned copies"\n {4}Node "Library open today\?"\n {4}Arrows come from: "Read the date and the opening hours"\n {4}Arrows go to: "Return: closed today", "Select the returned copies"/.test(prompt)
      && /The diagram as text:\n {4}- [^\n]*\n[\s\S]*- Library open today\?/.test(prompt) && tools.includes('Edit') && tools.includes('Write') && tools.includes('Bash(apostil *)')
      && writesNow().length === 1, `box "${nodeWords}"; tools ${tools}; prompt "${prompt.slice(0, 300)}"; ${writesNow().length} writes`);

  // ---- 6. The quick pick "Sort and filter", the look "VS Code default", the search that stays, a link from outside ----
  for (const name of ['View: Close Editors in Other Groups', 'View: Show Apostil']) await command(name);
  await changeTab.click();
  const listFrame = await frameWith('.cl .find .q');
  const rowsOf = () => listFrame.evaluate(() => ({ field: document.querySelector('.cl .find .q').value, line: document.querySelector('.cl .eyebrow')?.textContent ?? '', rows: document.querySelectorAll('.cl .row').length }));
  await listFrame.locator('.cl .row:not(.prow) .pr').first().waitFor({ timeout: 8000 }); // the pull requests come after the rows
  const openSearchField = async (frame) => { if (await frame.evaluate(() => document.querySelector('.find').hidden)) await frame.locator('.cl .seek').click(); }; // the field stands behind its icon
  await openSearchField(listFrame);
  await listFrame.locator('.find .sf').click();
  await quickInput.waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('.quick-input-list .monaco-list-row', { hasText: 'mira-k' }).first().waitFor({ timeout: 8000 });
  const quick = () => page.evaluate(() => {
    const rows = [...document.querySelectorAll('.quick-input-list .monaco-list-row')].filter((row) => row.getBoundingClientRect().height > 0);
    return {
      title: document.querySelector('.quick-input-title')?.textContent ?? '',
      heads: rows.map((row) => row.querySelector('.quick-input-list-separator')).filter((head) => head && head.getBoundingClientRect().height > 0).map((head) => head.textContent),
      checks: rows.filter((row) => row.getAttribute('aria-checked') === 'true').map((row) => row.querySelector('.label-name')?.textContent),
      icons: rows.filter((row) => row.querySelector('.quick-input-list-icon')).map((row) => row.querySelector('.label-name')?.textContent),
      modified: rows.find((one) => /^Modified/.test(one.getAttribute('aria-label') ?? ''))?.getAttribute('aria-label') ?? '',
    };
  });
  const open = await quick();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  const turned = await until(async () => { const now = await quick(); return /oldest first/.test(now.modified) && now; }, 3000);
  await page.keyboard.press('Space');
  await until(async () => /newest first/.test((await quick()).modified), 3000);
  await page.locator('.quick-input-list .monaco-list-row', { hasText: 'mira-k' }).first().click();
  const picked = await until(async () => { const now = await rowsOf(); return now.rows === 1 && now; }, 4000);
  const still = await quick();
  await page.keyboard.press('Escape');
  await quickInput.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  const closed = await rowsOf();
  check('the icon of the search opens the quick pick "Sort and filter" with its groups, the sort that is on checked and icons for people, labels, states and agents; Space turns the order of "Modified" and back; a pick of an author leaves fewer rows at once with the quick pick open; Escape closes it and the search stays',
    open.title === 'Sort and filter' && open.heads.join() === 'Sort,Author,Reviewer,Label,State,Agent' && open.checks.join() === 'Modified' && ['mira-k', 'bug', 'merged', 'Claude Code'].every((name) => open.icons.includes(name))
      && !!turned && picked?.field === 'author:mira-k' && picked.line === '1 of 3 changes' && still.checks.join() === 'Modified,mira-k' && closed.field === 'author:mira-k' && closed.rows === 1,
    JSON.stringify({ open, turned: turned?.modified, picked, still: still.checks, closed }));
  await shot('5-sort-and-filter');
  await listFrame.locator('.find .clear').click();

  // The look "VS Code default", chosen while a diagram of a part shows: the page is dark at once and keeps that drawing; the settings of the look are written; the page reads.
  await stage.evaluate(() => App.go({ level: 'part', part: 'hold-service', diagram: 'offer-flow' }));
  await stage.waitForSelector('#view svg');
  await stage.evaluate(() => { document.querySelector('#view svg').dataset.before = '1'; }); // a drawing made again would not have it
  await command('Apostil: Choose a look');
  await quickInput.waitFor({ state: 'visible', timeout: 5000 });
  await pick('VS Code default');
  const turnedDark = await stage.waitForFunction(() => document.body.classList.contains('vscode-dark'), null, { timeout: 15000 }).then(() => true, () => false);
  const kept = await stage.evaluate(() => ({ level: App.state.level, diagram: App.state.diagram, same: !!document.querySelector('#view svg[data-before]') }));
  const darkSettings = settingsNow();
  await stage.evaluate(async () => { await App.go({ level: 'change' }); await App.drawing; });
  await shot('5b-vscode-default-change');
  const seen = await stage.evaluate(lookOfPage, true).catch((error) => ({ error: String(error) }));
  check('the look "VS Code default" chosen while a diagram of a part shows: the page is dark at once and keeps that drawing, the dark theme is in the settings, and the page of the change reads: no box lighter than the page, no text in a box on an arrow, text at least 4.5 to 1',
    turnedDark && kept.level === 'part' && kept.same && /Dark/.test(darkSettings['workbench.colorTheme'] ?? '') && darkSettings['window.autoDetectColorScheme'] === false
      && !seen.error && !seen.bright.length && !seen.boxed.length && !seen.dim.length && !seen.normal.low.length && !seen.quiet.low.length, JSON.stringify({ turnedDark, kept, theme: darkSettings['workbench.colorTheme'], seen }));

  // The search stays when the view is hidden and shown: VS Code makes the view again, and the search kept for the repo comes back with its rows.
  await openSearchField(listFrame);
  await listFrame.locator('.find .q').click();
  await page.keyboard.type('second', { delay: 5 });
  await until(async () => (await rowsOf()).rows === 1, 3000);
  await command('View: Show Explorer');
  await page.locator('.explorer-folders-view').first().waitFor();
  await command('View: Show Apostil');
  const shownAgain = await frameWhere(() => document.querySelector('.cl .find .q')?.value === 'second' && document.querySelectorAll('.cl .row').length === 1);
  check('the search stays after the view is hidden and shown: the field holds "second", with its one row', !!shownAgain);
  await shownAgain?.locator('.find .clear').click();

  // A link from outside (build prompt 54): "code --open-url" with the link of the pull request 12 brings up its page at "Conversation".
  // The repo gets its remote on GitHub only now. The link holds the field "url" that vscode.dev adds.
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/made-up/example.git'], { cwd: repo });
  const onBefore = await stage.evaluate(() => document.querySelector('.switch a.on')?.textContent ?? '').catch(() => '');
  const link = appLink({ open: 'pull', repo: 'made-up/example', number: 12 });
  execFileSync(CODE, [`--user-data-dir=${temp}/u`, '--open-url', '--', `${link}&url=${encodeURIComponent(link)}`], { stdio: 'ignore', timeout: 20000 });
  const opened = await frameWhere(() => document.querySelector('.switch a.on')?.textContent === 'Conversation' && document.querySelector('.conv .ptitle')?.textContent === 'Holds for books that are out #12');
  check('a link opened with "code --open-url" brings up the pull request 12 of the example at "Conversation", from another view of its page', onBefore !== 'Conversation' && !!opened, JSON.stringify({ onBefore, opened: !!opened }));

  // ---- 6b. A look in VS Code itself (build 62): the margin, the search with #, the right-click menu and keys, the first page, the list "Look" ----
  // The look of the example for this build, saved as a writer saves it, and taken away at the end. Its files open in VS Code's editor ("editor").
  await setSetting('apostil.notesBesideCode', 'editor');
  await setSetting('window.menuStyle', 'custom'); // VS Code draws its menus in the window, where the check reads them, not macOS
  const vscodeLook = lookNow(JSON.parse(readFileSync(path.join(apostil, 'view/check-example/look/look-vscode.json'), 'utf8')));
  const marksOf = (file) => { const read = new Store(storeFolder); const marks = read.getMap(repoId(repo)).map.marks.filter((mark) => mark.file === file); read.close(); return marks; };
  /** The lines that have an icon in the margin of each editor in front (each side of a diff), read from the editor itself, with the lines in view. */
  const margins = () => page.evaluate(() => [...document.querySelectorAll('.editor-group-container.active .monaco-editor')].filter((editor) => editor.getBoundingClientRect().width > 0).map((editor) => {
    const lineAt = new Map([...editor.querySelectorAll('.margin-view-overlays > div')].map((row) => [row.style.top, Number(row.querySelector('.line-numbers')?.textContent)]));
    return { side: editor.closest('.editor.original') ? 'base' : 'now', shown: [...lineAt.values()].filter(Boolean), marked: [...editor.querySelectorAll('.cgmr')].map((glyph) => lineAt.get(glyph.style.top)).sort((a, b) => a - b) };
  }).filter((editor) => editor.shown.length)); // an editor of code, with its line numbers
  /** The lines of a text where the marks of a file stand, by the text of their lines, within the lines in view. */
  const expected = (marks, text, shown) => marks.map((mark) => markLineNow(mark, text.split('\n'))).filter((line) => line && shown.includes(line)).sort((a, b) => a - b);
  /** Waits until the editor in front is a text editor of this tab, with the place of its cursor in the status bar. */
  const editorOf = (name) => until(async () => (await activeTab() ?? '').startsWith(name) && await page.locator('.editor-group-container.active .monaco-editor .view-lines').count() > 0
    && /^Ln \d+/.test(await page.locator('[id="status.editor.selection"]').textContent({ timeout: 500 }).catch(() => '')), 6000);
  // Apostil's diff editor of night_jobs.py, alone in the window so that its sides stand side by side: the marks below line 266 stand one line lower
  // in the base, and each side has the marks of its own lines.
  await changeTab.click();
  await stage.locator('.switch a[data-view="diagram"]').first().click();
  await pointerToTop();
  await stage.locator('.f[data-file="src/library/night_jobs.py"]').hover();
  await stage.locator('.win [data-open]').click({ timeout: 4000 });
  await editorOf('night_jobs.py (base');
  await command('View: Close Editors in Other Groups');
  await goTo(':516');
  const night = marksOf('src/library/night_jobs.py');
  const nightNow = readFileSync(path.join(repo, 'src/library/night_jobs.py'), 'utf8');
  const nightBase = execFileSync('git', ['show', `${base}:src/library/night_jobs.py`], { cwd: repo }).toString();
  const diffSides = await until(async () => { const sides = await margins(); return sides.length === 2 && sides.every((side) => side.marked.length) && sides; }) || await margins();
  const sideOf = (name) => diffSides.find((side) => side.side === name) ?? { shown: [], marked: [] };
  await shot('7b-marks-in-the-diff-editor');
  await command('View: Close All Editors');

  // The search with #: a note by words of its title, with its file; Enter opens the file at its lines. A process by its title.
  const searchRows = () => page.evaluate(() => [...document.querySelectorAll('.quick-input-list .monaco-list-row')].filter((row) => row.getBoundingClientRect().height > 0)
    .map((row) => `${row.querySelector('.label-name')?.textContent ?? ''} | ${row.querySelector('.label-description')?.textContent ?? ''}`));
  const quickCount = () => page.evaluate(() => Number(document.querySelector('.quick-input-list .monaco-list-row')?.getAttribute('aria-setsize') ?? 0)); // all rows, also those not drawn
  const searchFor = async (words, wanted) => {
    await palette();
    await page.locator('.quick-input-widget .quick-input-box input').fill(`#${words}`);
    return await until(async () => { const rows = await searchRows(); return (wanted ? rows.some((row) => row.startsWith(wanted)) : rows.length) && rows; }, 5000) || searchRows();
  };
  const noteRows = await searchFor('lock requests', 'Lock the requests for the book');
  await page.keyboard.press('Enter');
  const noteOpened = await until(async () => /^requests\.py/.test(await activeTab() ?? '') && /^Ln 46,/.test(await page.locator('[id="status.editor.selection"]').textContent().catch(() => '')) && 'yes', 4000);
  const processRows = await searchFor('answer a book', 'Answer a book request');
  await shot('7c-search-with-hash');
  await page.keyboard.press('Escape');
  check('the search with # and words of a title lists a note with its file, and Enter opens the file at its lines; a process is found by its title',
    noteRows.some((row) => row.startsWith('Lock the requests for the book | lines 46–49 • src/library/lending/requests.py')) && !!noteOpened
      && processRows.some((row) => row.startsWith('Answer a book request | process of 14 steps • src/library/web/requests_router.py')),
    JSON.stringify({ noteRows: noteRows.slice(0, 3), noteOpened, processRows: processRows.slice(0, 3) }));

  // VS Code's editor, with the setting "editor": requests.py around its marks of the table store.
  await goTo(':62'); // requests.py, which the search opened in VS Code's editor (Go to File would show the file tab that the change page opened)
  const markedEditor = await until(async () => { const [now] = await margins(); return now?.marked.length >= 3 && now; }) || (await margins())[0] || { shown: [], marked: [] };
  const requestsText = readFileSync(path.join(repo, 'src/library/lending/requests.py'), 'utf8');
  await shot('7a-marks-in-the-margin');
  check('with a rule of the look the icon of a mark stands in the margin of VS Code\'s editor at each marked line in view; in Apostil\'s diff editor each side has the marks of its own lines',
    !!vscodeLook && markedEditor.marked.join() === expected(marksOf('src/library/lending/requests.py'), requestsText, markedEditor.shown).join() && markedEditor.marked.length >= 3
      && sideOf('now').marked.includes(516) && sideOf('base').marked.includes(517)
      && sideOf('now').marked.join() === expected(night, nightNow, sideOf('now').shown).join() && sideOf('base').marked.join() === expected(night, nightBase, sideOf('base').shown).join(),
    JSON.stringify({ look: vscodeLook, editor: markedEditor.marked, sides: diffSides.map((side) => `${side.side}: ${side.marked.join(' ')}`) }));

  // The right-click menu of the editor (the window draws its menus, window.menuStyle custom): the entry of a mark in a file with marks, on any line
  // (on a line with no mark it says so), and not in a file with none; its list opens a place. "Actions of the Look…" lists the actions, and the key
  // of the first action carries it out.
  const menuAt = async (line) => {
    await goTo(`:${line}`);
    const y = await page.evaluate((wanted) => {
      const row = [...document.querySelectorAll('.editor-group-container.active .margin-view-overlays .line-numbers')].find((one) => one.textContent.trim() === String(wanted))?.parentElement.getBoundingClientRect();
      return row && row.y + row.height / 2;
    }, line);
    const box = await page.locator('.editor-group-container.active .view-lines').first().boundingBox({ timeout: 3000 }).catch(() => null);
    if (!box || !y) return []; // no text editor in front: no menu to read
    await page.mouse.click(box.x + 150, y, { button: 'right' });
    await page.locator('.monaco-menu .action-label').first().waitFor({ timeout: 3000 }).catch(() => {});
    return (await page.locator('.monaco-menu .action-label').allTextContents()).map((words) => words.trim()).filter(Boolean);
  };
  const OTHER_PLACES = 'Show the Other Places of This Mark';
  const onMarked = await menuAt(46);
  await page.keyboard.press('Escape');
  const onPlain = await menuAt(47);
  await page.locator('.monaco-menu .action-label', { hasText: OTHER_PLACES }).click({ timeout: 3000 }).catch(() => {});
  const noMarkSaid = await shown(toast('This line has no mark.'), 4000);
  await goTo('README.md');
  const inPlainFile = await menuAt(1);
  await page.keyboard.press('Escape');
  await closeTab('README.md');
  await menuAt(46);
  await shot('7d-the-right-click-menu-of-a-marked-line');
  // Under load the menu of VS Code can be gone before the click: the right click is made once more. Without the entry no quick pick opens, and the run would wait on a hidden field.
  const entry = page.locator('.monaco-menu .action-label', { hasText: OTHER_PLACES });
  if (!(await entry.click({ timeout: 3000 }).then(() => true, () => false))) {
    console.log('NOTE  the menu entry was not there for the click; the right click once more');
    await page.keyboard.press('Escape');
    await menuAt(46);
    await entry.click({ timeout: 3000 }).catch(() => {});
  }
  const placeCount = await until(async () => { const count = await quickCount(); return count >= 20 && count; }, 4000) || await quickCount();
  await page.locator('.quick-input-widget .quick-input-box input').fill('435'); // a line number that one place only has: two files have a mark at their line 139
  await until(async () => (await searchRows()).join() === 'src/library/night_jobs.py | line 435', 3000);
  await page.keyboard.press('Enter');
  const placeOpened = await until(async () => /^night_jobs\.py/.test(await activeTab() ?? '') && /^Ln 435,/.test(await page.locator('[id="status.editor.selection"]').textContent().catch(() => '')) && 'yes', 4000);
  await page.keyboard.press('Control+Alt+KeyL');
  const actionList = await until(async () => { const rows = await searchRows(); return rows.length === 3 && rows; }, 4000) || await searchRows();
  await page.keyboard.press('Escape');
  await goTo(':10');
  await page.keyboard.press('Control+Alt+Digit1');
  const firstAction = await until(async () => /^Ln 516,/.test(await page.locator('[id="status.editor.selection"]').textContent().catch(() => '')) && 'yes', 4000);
  // The same entries on a code line of the file tab of Apostil (webview/context), which VS Code draws too: hold_service.py is a file tab since part 3.
  await goTo('hold_service.py');
  const servicesTab = await fileTab('hold_service.py');
  let inFileTab = [];
  if (servicesTab) {
    await servicesTab.locator(await lineInView(servicesTab)).click({ button: 'right' });
    await page.locator('.monaco-menu .action-label').first().waitFor({ timeout: 3000 }).catch(() => {});
    inFileTab = (await page.locator('.monaco-menu .action-label').allTextContents()).map((words) => words.trim()).filter(Boolean);
    await page.keyboard.press('Escape');
    await closeTab('hold_service.py');
  }
  check('the right-click menu of the editor has "Show the Other Places of This Mark" in a file with marks, says so on a line with none, and has it not in a file with none; its list opens a place; "Actions of the Look…" lists the actions, and the key of the first action carries it out; the menu of a line of the file tab has the entries too',
    onMarked.includes(OTHER_PLACES) && onMarked.includes('Actions of the Look…') && onPlain.includes(OTHER_PLACES) && noMarkSaid && inPlainFile.includes('Actions of the Look…') && !inPlainFile.includes(OTHER_PLACES)
      && placeCount >= 20 && !!placeOpened && actionList.join() === 'Open the night run | ⌃⌥1,Show how a request is answered | ,Open the opening hours | ' && !!firstAction
      && inFileTab.includes(OTHER_PLACES) && inFileTab.includes('Actions of the Look…'),
    JSON.stringify({ onMarked, onPlain, noMarkSaid, inPlainFile, placeCount, placeOpened, actionList, firstAction, inFileTab }));

  // The first page: the start step again (its command, by a key of this window's own keybindings.json) opens it beside the tab in front and leaves
  // the keyboard in the editor; with the setting off nothing opens.
  await setSetting('apostil.homeWhenEmpty', true);
  await command('View: Focus Active Editor Group');
  const keyboardInEditor = () => page.evaluate(() => !!document.activeElement?.closest('.editor-group-container.active .monaco-editor'));
  await sleep(1000); // VS Code reads the settings file again: nothing on the screen says when
  await page.keyboard.press(START_KEY);
  const firstPage = await frameWhere(() => typeof Home === 'object' && Home.data?.kind === 'page' && document.body.textContent.includes('The hours of each branch.'), undefined, 6000);
  const besideTabs = await page.$$eval('.editor-group-container', (groups) => groups.map((group) => [...group.querySelectorAll('.tab .label-name')].map((el) => el.textContent.trim()).join('+')));
  const keptKeyboard = await keyboardInEditor() && /^night_jobs\.py/.test(await activeTab() ?? '');
  await shot('7e-the-first-page-beside-the-tab');
  await setSetting('apostil.homeWhenEmpty', false);
  await sleep(1000); // VS Code reads the settings file again
  await command('View: Close Editors in Other Groups');
  await page.keyboard.press(START_KEY);
  await sleep(1500); // calm: nothing must open
  const offTabs = await tabs();
  check('the start step with a first page opens that page beside the tab in front and leaves the keyboard where it was; with the setting off nothing opens',
    !!firstPage && besideTabs.length === 2 && besideTabs[1] === 'Opening hours' && keptKeyboard && offTabs.join('+') === besideTabs[0], JSON.stringify({ firstPage: !!firstPage, besideTabs, keptKeyboard, offTabs }));

  // The list "Look" in Apostil's side bar: a set with its values and their counts, and the page; a click on a value lists its places.
  await command('View: Show Apostil');
  const lookPane = page.locator('.pane', { has: page.locator('.pane-header .title', { hasText: /^Look$/ }) });
  const lookRows = () => lookPane.locator('.monaco-list-row').allTextContents().catch(() => []);
  const listed = await until(async () => { const rows = await lookRows(); return rows.some((row) => /^PostgreSQL\d+ lines · \d+ files$/.test(row)) && rows; }, 5000) || await lookRows();
  await lookPane.locator('.monaco-list-row', { hasText: 'PostgreSQL' }).click({ timeout: 3000 }).catch(() => {});
  const valuePlaces = await until(async () => { const count = await quickCount(); return count >= 20 && count; }, 4000) || await quickCount();
  await shot('7f-the-list-look-and-the-places-of-a-value');
  await page.keyboard.press('Escape');
  // With the rules gone: no icon in the margin, nothing of Apostil in the search, no entry in the menu, no list.
  lookNow({ rules: [] });
  const marginGone = await until(async () => { const sides = await margins(); return sides.length && sides.every((side) => !side.marked.length) && sides; }, 5000);
  const searchGone = await searchFor('answer a book');
  await page.keyboard.press('Escape');
  const menuGone = await menuAt(46);
  await page.keyboard.press('Escape');
  const listGone = await until(async () => !(await lookPane.count()), 3000);
  check('the view "Look" is in Apostil\'s side bar only with the rule: a set with a value and its counts, and the page; a click on the value lists its places; with the rules gone no icon, answer, entry or list of the look is left',
    listed.includes('Services') && listed.includes('Opening hoursfirst page') && valuePlaces >= 20 && !!marginGone && !searchGone.some((row) => row.startsWith('Answer a book request'))
      && !menuGone.includes(OTHER_PLACES) && !menuGone.includes('Actions of the Look…') && listGone,
    JSON.stringify({ listed, valuePlaces, marginGone: !!marginGone, searchGone: searchGone.slice(0, 2), menuGone, listGone }));
  await setSetting('apostil.notesBesideCode', 'tab');
  await setSetting('window.menuStyle', undefined);
  await command('View: Close All Editors');

  // ---- An open pull request with no stored change (the stand-in gh lists #35, whose branch has no row): the list shows its row under "Pull requests", and a click opens its page ----
  await command('View: Show Apostil');
  const bareList = await frameWith('.cl .prow');
  const bareRow = await bareList?.locator('.prow').first().textContent();
  await bareList?.locator('.prow .nm').first().click();
  const barePage = await frameWhere(() => /no description of Apostil yet/.test(document.getElementById('summary')?.textContent ?? '') && /Made-up pull request 35/.test(document.body.textContent)); // after the read of the pull request
  const bareLine = await barePage?.evaluate(() => document.getElementById('summary').textContent);
  check('the open pull request of the stand-in gh with no stored change stands in the list under "Pull requests" with its title, number and state, and a click opens its page, which says that it has no description of Apostil yet and gives the words to give an agent',
    /^Made-up pull request 35#35review needed$/.test(bareRow ?? '') && /Describe pull request #35 for Apostil/.test(bareLine ?? ''), JSON.stringify({ bareRow, bareLine }));
  await shot('2b-an-open-pull-request-with-no-change');
  // Its press (build 75) names the session that gets the words; a click starts a run of the stand-in claude with the words and the small model, and the line
  // then says where the words went, with the link that opens that session.
  const runsBeforePress = runsNow().length;
  const pressLabel = await barePage?.evaluate(() => document.querySelector('#summary [data-ask]')?.textContent);
  await barePage?.locator('#summary [data-ask]').click({ timeout: 4000 }).catch(() => {});
  const pressRun = await until(() => runsNow().length > runsBeforePress && runsNow().at(-1));
  const wentLine = await until(() => barePage?.evaluate(() => (document.querySelector('#summary [data-ask-open]') ? document.getElementById('summary').textContent : '')), 8000);
  await shot('2c-the-words-went-to-a-session');
  check('the press of the words names the Claude Code session that gets them; a click starts one run of the stand-in claude with the words, the small model and the rights of a description, and the line says where they went, with "Open the session"',
    /^Ask (a new Claude Code session|Claude Code session .+)$/.test(pressLabel ?? '') && !!pressRun && pressRun.includes('Describe pull request #35 for Apostil\n') && pressRun.includes('--model\nhaiku\n')
      && pressRun.includes('Bash(git show *)\n') && /^Describe pull request #35 for Apostil went to (a new )?Claude Code session \S.* · (working|done) · Open the session$/.test(wentLine ?? ''),
    JSON.stringify({ pressLabel, run: (pressRun || '').replace(/\n/g, ' ').slice(0, 300), wentLine }));

  // ---- 7. A notebook ----
  // A notebook of another repo opens the normal way in the notebook editor, with the note of its change in its cell; the key hides it; no cell runs.
  const notebookFile = path.join(notebookRepo.folder, 'notebooks/fees.ipynb');
  const notebookBytes = readFileSync(notebookFile, 'utf8');
  execFileSync(CODE, [`--user-data-dir=${temp}/u`, '--reuse-window', notebookFile], { stdio: 'ignore', timeout: 20000 });
  const cellState = () => page.evaluate(() => {
    const textOf = (span) => { const content = getComputedStyle(span, '::after').content; return content && content !== 'none' ? JSON.parse(content).replace(/[  ]/g, ' ').trim() : ''; };
    const cells = {};
    for (const row of document.querySelectorAll('.notebookOverlay .monaco-list-row[data-index]')) {
      const titles = [...row.querySelectorAll('.view-line span[class*="TextEditorDecorationType"]')].map(textOf).filter(Boolean);
      if (titles.length) cells[Number(row.dataset.index) + 1] = titles;
    }
    return { cells, status: [...document.querySelectorAll('.statusbar-item')].map((item) => item.textContent.trim()).find((text) => /\d+ notes?\b/.test(text)) ?? '' };
  });
  const inCells = await until(async () => { const now = await cellState(); return now.cells[5]?.includes('No fee before the due day') && now.status === '2 notes' && now; }, 10000) || await cellState();
  await page.locator('.notebookOverlay .monaco-list-row[data-index="4"] .view-lines').first().click().catch(() => {});
  await page.keyboard.press('Meta+Shift+Comma');
  const cellsHidden = await until(async () => { const now = await cellState(); return !now.cells[5] && now.status === '2 notes hidden' && now; }, 4000) || await cellState();
  check('a notebook opens in the notebook editor of VS Code with the note of its change in its cell 5 and "2 notes" in the status bar; the key hides them; the notebook on disk is as it was',
    inCells.cells[5]?.includes('No fee before the due day') && Object.keys(inCells.cells).join() === '5' && inCells.status === '2 notes' && cellsHidden.status === '2 notes hidden' && readFileSync(notebookFile, 'utf8') === notebookBytes,
    JSON.stringify({ inCells, cellsHidden }));
  await shot('6c-a-notebook-with-its-note');

  // The look "Same as the computer" follows the system: Apostil when it is light, the dark default when it is dark.
  await command('Apostil: Choose a look');
  await quickInput.waitFor({ state: 'visible', timeout: 5000 });
  await pick('Same as the computer');
  const computer = await until(() => { const now = settingsNow(); return now['window.autoDetectColorScheme'] === true && now['workbench.preferredDarkColorTheme'] && now; }, 5000) || settingsNow();
  check('the look "Same as the computer" follows the system: Apostil when it is light, the dark default when it is dark',
    computer['workbench.preferredLightColorTheme'] === 'Apostil Light' && /Dark/.test(computer['workbench.preferredDarkColorTheme'] ?? ''), JSON.stringify(computer));
} catch (error) {
  const lines = String(error).split('\n');
  check('the run went to the end', false, lines.slice(0, 12).join(' / ').slice(0, 1200));
} finally {
  await Promise.all(failed);
  // The whole window, also when VS Code left the process that was started: the answer may never come, as the window closes.
  try { await Promise.race([browser.newBrowserCDPSession().then((session) => session.send('Browser.close')), sleep(3000)]); } catch { /* closed */ }
  try { await browser?.close(); } catch { /* closed */ }
  child.kill('SIGTERM');
  await sleep(500);
  child.kill('SIGKILL');
  store.close();
  rmSync(temp, { recursive: true, force: true });
  example.remove();
  notebookRepo.remove();
}
process.exit(results.length && results.every(Boolean) ? 0 : 1);
