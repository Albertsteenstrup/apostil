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

  // 1b. Build 84: each card takes the size of its content, from half of the card of build 83 to half again each way, and the cards are packed with no
  // hole: the card of the first node at the top left, and each point of the block inside a card or in a gap of 12 px; again after the tab gets narrower.
  // No card is narrower than its content (no file row is cut), no card of files is more than one unit (100 px and a gap) taller than its rows need, and
  // each drawing fills its card: the tall drawing of "Database" gets a card higher than wide, and every drawing fills at least 60% of its card in its
  // looser direction (a drawing card takes another size only at 70%; its own size may fill a little less).
  const packing = () => home.evaluate(() => {
    const cards = [...document.querySelectorAll('#cards .ovc')].map((card) => { const box = card.getBoundingClientRect(); return { card, title: card.querySelector('.ovn').textContent, units: card.dataset.units, left: box.left, top: box.top, right: box.right, bottom: box.bottom }; });
    const [left, top, right, bottom] = [Math.min(...cards.map((one) => one.left)), Math.min(...cards.map((one) => one.top)), Math.max(...cards.map((one) => one.right)), Math.max(...cards.map((one) => one.bottom))];
    const near = (x, y) => Math.min(...cards.map((one) => Math.hypot(Math.max(one.left - x, 0, x - one.right), Math.max(one.top - y, 0, y - one.bottom)))); // 0 inside a card
    const holes = [];
    for (let y = top + 1; y < bottom; y += 3) for (let x = left + 1; x < right; x += 3) if (near(x, y) > 12.5) holes.push([Math.round(x), Math.round(y)]);
    const cut = cards.flatMap(({ card, title }) => [...card.querySelectorAll('.ovf .dir, .ovf .nm')].filter((part) => part.scrollWidth > part.clientWidth + 1).map((part) => `${title}: ${part.textContent}`));
    const tall = cards.filter(({ card }) => card.querySelector('.ovf a')).map(({ card, title, bottom: to }) => ({ title, empty: Math.round(to - card.querySelector('.ovf a:last-child').getBoundingClientRect().bottom) })).filter((one) => one.empty > 100 + 12 + 12);
    const fills = Object.fromEntries(cards.filter(({ card }) => card.querySelector('.ovb svg')).map(({ card, title }) => {
      const svg = card.querySelector('.ovb svg');
      const drawn = svg.viewBox.baseVal.width / svg.viewBox.baseVal.height;
      const box = svg.getBoundingClientRect();
      const room = box.width / box.height;
      return [title, +Math.min(drawn / room, room / drawn).toFixed(2)];
    }));
    const database = cards.find((one) => one.title === 'Database');
    return { sizes: [...new Set(cards.map((one) => one.units))].sort(), first: cards[0].title, firstAt: cards[0].left === left && cards[0].top === top, holes: holes.length, hole: holes[0], columns: document.getElementById('cards').style.gridTemplateColumns,
      cut, tall, fills, databaseTall: database.bottom - database.top > database.right - database.left };
  });
  /** Waits until the cards were placed again after their drawings came out (drawnShape). */
  const placed = () => home.waitForFunction(() => !Overview.again, null, { timeout: 5000 }).catch(() => {});
  await placed();
  const packed = await packing();
  await home.setViewportSize({ width: 1000, height: 900 });
  await home.waitForFunction((before) => document.getElementById('cards').style.gridTemplateColumns !== before, packed.columns, { timeout: 5000 }).catch(() => {});
  await cardsFilled();
  await placed();
  const narrower = await packing();
  await home.setViewportSize({ width: 1400, height: 900 });
  const sized = (one) => one.cut.length === 0 && one.tall.length === 0 && Object.values(one.fills).length === 4 && Object.values(one.fills).every((fill) => fill >= 0.6) && one.databaseTall;
  check('each card of the overview takes the size of its content, so cards of different sizes stand under the map; they are packed with no hole: the card of the first node at the top left, and each point of the block inside a card or in a gap of 12 px; when the tab gets narrower they are placed again, still with no hole',
    packed.sizes.length >= 3 && packed.first === 'Web pages' && packed.firstAt && packed.holes === 0
      && narrower.columns !== packed.columns && narrower.first === 'Web pages' && narrower.firstAt && narrower.holes === 0, JSON.stringify({ packed, narrower }));
  check('no card of the overview is narrower than its content (no folder or file name of a row is cut), no card of files is more than one unit taller than its rows need, and each drawing fills its card: the tall drawing of "Database" gets a card higher than wide, and each drawing fills at least 60% of its card both ways; also when the tab gets narrower',
    sized(packed) && sized(narrower), JSON.stringify({ packed, narrower }));

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
