// The browser check of the overview of a diagram (build 83): Home and "Diagram" of a change open with the diagram of a level on top and, under it, a
// card for each node that leads somewhere; the icon at the top right of the frame shows the diagram alone, and that choice holds. A group of
// view/browser-check.mjs, which runs every group at the same time; alone:
//   node view/browser/overview.mjs [--pictures] [<folder for pictures>]

import { fileURLToPath } from 'node:url';
import { check, errors, finish, newPage, openPage, pageFile, takePicture } from './tools.mjs';

try {
  const homeFile = fileURLToPath(new URL('../media/home.html', import.meta.url));
  const home = await newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  home.on('pageerror', (error) => errors.push(error.message));
  home.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const loaded = () => home.waitForFunction(() => (window.apostilRendered ?? 0) >= 1, null, { timeout: 15000 });
  const homeAt = async (query = '') => { await home.goto(`file://${homeFile}${query}`); await loaded(); };
  const settled = () => home.evaluate(() => (typeof Home === 'object' ? Home.drawing : App.drawing));
  /** Waits until every card of the page is filled (all of them are in view at 1400 by 900, or near it). */
  const cardsFilled = () => home.waitForFunction(() => [...document.querySelectorAll('.ovc')].every((card) => card.hasAttribute('data-drawn')), null, { timeout: 10000 }).catch(() => {});
  /** What the page shows: its line, the frame of the diagram and its icon, and the cards under it. */
  const shown = () => home.evaluate(() => {
    const frame = (document.querySelector('.sec[data-section="change"] .sb') ?? document.getElementById('view')).getBoundingClientRect();
    const holder = document.getElementById('cards');
    const cards = [...holder.querySelectorAll('.ovc')];
    const svg = document.querySelector('#view svg');
    return {
      crumb: document.getElementById('crumb').textContent, icon: document.querySelector('.surface > .ovt')?.title ?? '',
      frame: { top: Math.round(frame.top), bottom: Math.round(frame.bottom), height: Math.round(frame.height) },
      scale: +(svg.getBoundingClientRect().width / svg.viewBox.baseVal.width).toFixed(2), wide: Math.round(svg.getBoundingClientRect().width),
      titles: cards.map((card) => card.querySelector('.ovh').textContent), drawings: cards.filter((card) => card.querySelector('.ovb svg')).map((card) => card.querySelector('.ovh').textContent),
      files: Object.fromEntries(cards.filter((card) => card.querySelector('.ovf')).map((card) => [card.querySelector('.ovh').textContent, [...card.querySelectorAll('.ovf a')].map((row) => row.textContent)])),
      shows: !holder.hidden && cards.length > 0, under: holder.getBoundingClientRect().top - frame.bottom,
      well: getComputedStyle(holder).backgroundColor, paper: getComputedStyle(document.body).backgroundColor,
    };
  });

  // 1. Home opens in the overview: the top map large in the upper part of the tab, and a card for each of its 8 areas in the reading order of the map,
  // an area with a diagram under it drawn small, an area with folders and files as their list; the cards in a quiet well of their own under the frame.
  await homeAt();
  await cardsFilled();
  const top = await shown();
  await takePicture(home, 'overview-1-home.png');
  check('Home opens in the overview: the top map in the upper part of the tab as large as its width allows, the icon "Full screen" at its top right, and under it one card for each of the 8 areas in the reading order of the map: an area with a diagram under it drawn small, an area that leads to folders and files with their list; the cards stand a little apart from the frame, on a surface of their own',
    top.crumb === 'Home' && top.icon === 'Full screen' && top.frame.height < 900 * 0.62 && top.scale > 1 && top.wide > 1200
      && top.titles.join() === 'Web pages,Web routes,Guides and notes,Night jobs,Lending,Database,Front desk,Tests' && top.drawings.join() === 'Web pages,Web routes,Lending,Database'
      && top.files['Guides and notes']?.join() === 'docs/4 files,README.md' && top.files.Tests?.join() === 'tests/4 files' && Object.keys(top.files).length === 4
      && top.shows && top.under >= 16 && top.well !== top.paper, JSON.stringify(top));

  // 2. A click on a card goes one level down in the same layout; a click on a file of a card asks VS Code to open that file.
  const card = (title) => home.locator('.ovc', { has: home.locator('.ovh', { hasText: new RegExp(`^${title}$`) }) });
  await card('Lending').click({ timeout: 3000 }).catch(() => {});
  await settled();
  await cardsFilled();
  const down = await shown();
  await takePicture(home, 'overview-2-a-level-with-files.png');
  const sentBefore = await home.evaluate(() => window.apostilSent.length);
  await home.click('.ovc .ovf a[data-open="src/library/lending/queue.py"]', { timeout: 3000 }).catch(() => {});
  const opened = await home.evaluate((from) => window.apostilSent.slice(from).filter((one) => /^(openFile|walk)$/.test(one.type)), sentBefore);
  const stayed = await home.evaluate(() => Home.at);
  check('a click on a card goes one level down, in the same layout: the diagram of Lending on top and a card for each of its 7 nodes, files for those with files and the process of book requests drawn small; a click on a file of a card asks VS Code to open that file and Home stays',
    down.crumb === 'Home›Lending: holds, requests and mails' && down.icon === 'Full screen' && down.shows && down.titles.length === 7 && down.drawings.join() === 'Book requests'
      && down.files['Queue and notices']?.join() === 'src/library/lending/notices.py,src/library/lending/queue.py'
      && opened.length === 1 && opened[0].type === 'openFile' && opened[0].path === 'src/library/lending/queue.py' && stayed === 'lib-lending', JSON.stringify({ down, opened, stayed }));

  // 3. The icon shows the diagram alone, filling the tab; the choice holds after a reload and on the page of a change; the icon in the same place brings the overview back.
  await homeAt();
  await home.click('#view > .ovt', { timeout: 3000 }).catch(() => {});
  await settled();
  const full = await shown();
  const told = await home.evaluate(() => window.apostilSent.filter((one) => one.type === 'layout').map((one) => one.full).join());
  await takePicture(home, 'overview-3-full-screen.png');
  await homeAt();
  const fullAgain = await shown();
  await home.goto(`file://${pageFile}`);
  await loaded();
  const changeFull = await shown();
  await homeAt();
  await home.click('#view > .ovt', { timeout: 3000 }).catch(() => {});
  await settled();
  const back = await shown();
  await homeAt();
  const backAgain = await shown();
  const fills = (one) => !one.shows && one.frame.bottom > 900 - 40 && one.icon === 'Overview';
  check('the icon "Full screen" shows the map alone, filling the tab, with no card and the icon "Overview" in its place; the choice holds after a reload and on the page of a change; "Overview" brings the cards back, and that holds after a reload too',
    fills(full) && told === 'true' && fills(fullAgain) && fills(changeFull) && back.shows && back.icon === 'Full screen' && back.titles.length === 8 && backAgain.shows && backAgain.titles.length === 8,
    JSON.stringify({ full, told, fullAgain, changeFull, back, backAgain }));

  // 4. At 370 px the cards stand in one column, and only those near the view are drawn; the others are drawn when they come into view.
  await home.setViewportSize({ width: 370, height: 800 });
  await homeAt();
  const lazy = await home.evaluate(async () => {
    const until = (ok) => new Promise((done, fail) => { const end = performance.now() + 10000; const poll = () => (ok() ? done() : performance.now() > end ? fail(new Error('the cards in view were not drawn')) : requestAnimationFrame(poll)); poll(); });
    const cards = [...document.querySelectorAll('.ovc')];
    const near = () => cards.filter((card) => card.getBoundingClientRect().top < innerHeight + 150 && card.getBoundingClientRect().bottom > -150).every((card) => card.hasAttribute('data-drawn'));
    await until(near);
    const first = cards.filter((card) => card.hasAttribute('data-drawn')).length;
    const lefts = new Set(cards.map((card) => Math.round(card.getBoundingClientRect().left))).size;
    const sideways = document.documentElement.scrollWidth > innerWidth;
    while (scrollY + innerHeight < document.documentElement.scrollHeight - 1) { scrollBy(0, innerHeight); await until(near); }
    return { cards: cards.length, first, lefts, sideways, all: cards.filter((card) => card.hasAttribute('data-drawn')).length };
  });
  await home.evaluate(() => scrollTo(0, 0));
  await takePicture(home, 'overview-4-at-370.png');
  await home.setViewportSize({ width: 1400, height: 900 });
  check('at 370 px the cards stand in one column with nothing sideways; only the cards near the view are drawn at first, the others when they come into view',
    lazy.cards === 8 && lazy.first < 8 && lazy.first > 0 && lazy.lefts === 1 && !lazy.sideways && lazy.all === 8, JSON.stringify(lazy));

  // 5. "Diagram" of a change shows the same overview: a card for each part and for the files in no part; beside the code, in the half of the diagram.
  await home.goto(`file://${pageFile}`);
  await loaded();
  await cardsFilled();
  const change = await shown();
  await takePicture(home, 'overview-5-diagram-of-a-change.png');
  await card('Hold service').click({ timeout: 3000 }).catch(() => {});
  await settled();
  const part = await home.evaluate(() => ({ level: App.state.level, part: App.state.part, crumb: document.getElementById('crumb').textContent }));
  await home.goto(`file://${pageFile}`);
  await loaded();
  await home.click('.ovc .ovf a[data-open-file="web/src/member/HoldDialog.tsx"]', { timeout: 3000 }).catch(() => {});
  await settled();
  const file = await home.evaluate(() => ({ view: App.state.view, file: App.state.file }));
  const wide = await openPage({ viewport: { width: 1400, height: 900 } }); // the code beside the diagram
  await wide.goto(`file://${pageFile}`);
  await wide.waitForFunction(() => (window.apostilRendered ?? 0) >= 1, null, { timeout: 15000 });
  const beside = await wide.evaluate(() => ({ cards: document.querySelectorAll('#view > .half.left .ovcards .ovc').length, under: !!document.querySelector('#view > .half.left .sec + .ovcards'), list: document.querySelectorAll('#view > .half.right .dfile').length > 0 }));
  await wide.close();
  check('"Diagram" of a change shows the same overview: the diagram of the change on top with "Full screen", and a card for each of its 6 parts and the files in no part in the reading order of the drawing, a part with a diagram drawn small, a part with no diagram as its files with their counts; a click on a card opens the diagram of its part, a click on a file opens the file; beside the code the cards stand under the diagram in its half',
    change.icon === 'Full screen' && change.shows && change.titles.join() === 'Holds tab,In no part,Routes,Night job,Desk screen,Hold service,Tables' && change.drawings.join() === 'Hold service,Tables'
      && change.files.Routes?.join() === 'src/library/web/holds_router.py+112' && change.files['Holds tab']?.[0] === 'web/src/member/HoldDialog.tsx+160'
      && part.level === 'part' && part.part === 'hold-service' && /›Hold service$/.test(part.crumb) && file.view === 'code' && file.file === 'web/src/member/HoldDialog.tsx'
      && beside.cards === 7 && beside.under && beside.list, JSON.stringify({ change, part, file, beside }));

  // Pictures for a person: the dark theme of VS Code.
  await homeAt();
  await home.evaluate(() => { document.body.classList.add('vscode-dark'); });
  await cardsFilled();
  await takePicture(home, 'overview-6-dark.png');
  await home.close();
} catch (error) {
  check('the checks ran to the end', false, error.message.split('\n').slice(0, 14).join(' / '));
}
await finish();
