// Reads what VS Code gives a page of Apostil in each theme: its --vscode-… variables, the class of the body and the theme attributes of the body.
// It writes them to view/theme-colors.json, which the browser check gives its pages, so that most checks of the colours need no VS Code window.
// Run it again after a new VS Code changes its default themes. Playwright is not a dependency of Apostil (see view/README.md), after `npm run build`:
//   APOSTIL_PLAYWRIGHT=<folder> node <this folder>/view/read-theme-colors.mjs
// The window has its own settings, extensions and store, and closes at the end.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChromium } from './find-playwright.mjs';

const THEMES = { apostil: 'Apostil Light', light: 'Light 2026', dark: 'Dark 2026', hcDark: 'Default High Contrast', hcLight: 'Default High Contrast Light' };
const apostil = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('./theme-colors.json', import.meta.url));
const chromium = findChromium();
const CODE = process.env.APOSTIL_VSCODE ?? '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
const PORT = 9351;
const temp = mkdtempSync('/tmp/ap-tc-');
const settingsFile = path.join(temp, 'u', 'User', 'settings.json');
const settings = (theme) => writeFileSync(settingsFile, JSON.stringify({ 'workbench.colorTheme': theme, 'window.autoDetectColorScheme': false, 'chat.disableAIFeatures': true }));
mkdirSync(path.dirname(settingsFile), { recursive: true });
settings(THEMES.dark);
const child = spawn(CODE, [
  `--extensionDevelopmentPath=${apostil}`, `--user-data-dir=${temp}/u`, `--extensions-dir=${temp}/e`, `--remote-debugging-port=${PORT}`,
  '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--new-window', temp,
], { env: { ...process.env, APOSTIL_HOME: path.join(temp, 'store'), VSCODE_CLI: '1' }, stdio: 'ignore' });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { /* not up yet */ }
    await sleep(500);
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  let page;
  for (let i = 0; i < 40 && !page; i++) {
    page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().includes('workbench'));
    if (!page) await sleep(500);
  }
  await page.waitForSelector('.monaco-workbench', { timeout: 30000 });
  // The first start asks for the look; closing the question keeps the theme of the settings.
  if (await page.locator('.quick-input-widget').waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false)) await page.keyboard.press('Escape');
  await sleep(1000);
  await page.keyboard.press('F1');
  await page.keyboard.type('View: Show Apostil', { delay: 10 });
  await page.keyboard.press('Enter');
  const list = async () => {
    for (let i = 0; i < 40; i++) {
      for (const frame of page.frames()) {
        try { if (await frame.locator('body.list').count()) return frame; } catch { /* a frame that went away */ }
      }
      await sleep(500);
    }
    throw new Error('no page of Apostil');
  };
  // Only the colours that look.css names: the file stays small, and a check never depends on a variable that no page uses.
  const named = new Set(readFileSync(fileURLToPath(new URL('./media/look.css', import.meta.url)), 'utf8').match(/--vscode-[\w.-]+/g).filter((name) => !/font/.test(name)));
  const read = (frame) => frame.evaluate((names) => {
    const style = document.documentElement.style;
    const vars = {};
    for (const name of names) if (style.getPropertyValue(name)) vars[name] = style.getPropertyValue(name).trim();
    return { bodyClass: document.body.className.replace(/\blist\b/, '').trim(), bodyData: { ...document.body.dataset }, vars };
  }, [...named]);
  const colors = {};
  for (const [key, theme] of Object.entries(THEMES)) {
    settings(theme);
    let one;
    for (let i = 0; i < 20; i++) { // the page hears the new theme a moment after the settings file changed
      await sleep(700);
      one = await read(await list());
      if (one.bodyData.vscodeThemeId === theme || one.bodyData.vscodeThemeName === theme) break;
    }
    colors[key] = { theme, ...one };
    console.log(`${key}: ${theme}, ${one.bodyClass}, ${Object.keys(one.vars).length} variables, ${JSON.stringify(one.bodyData)}`);
  }
  writeFileSync(out, `${JSON.stringify(colors, null, 1)}\n`);
  console.log(`Wrote ${out}`);
} finally {
  try { await browser?.close(); } catch { /* already closed */ }
  child.kill('SIGTERM');
  await sleep(1500);
  child.kill('SIGKILL');
  rmSync(temp, { recursive: true, force: true });
}
