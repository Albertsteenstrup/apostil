// The browser check of the overview of a diagram: Home and "Diagram" of a change open with the diagram of a level on top and, under it, a
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

  /** The frame of the diagram, the drawing in it, and the head of the first card under it. */
  const frameNow = () => home.evaluate(() => {
    const view = document.getElementById('view').getBoundingClientRect();
    const drawn = (document.querySelector('#view svg g.root') ?? document.querySelector('#view svg > g'))?.getBoundingClientRect();
    const head = document.querySelector('#cards .ovc .ovh')?.getBoundingClientRect();
    const svg = document.querySelector('#view svg');
    return {
      top: Math.round(view.top), bottom: Math.round(view.bottom), drawn: drawn && [Math.round(drawn.top), Math.round(drawn.bottom)], cut: !drawn || drawn.top < view.top - 1 || drawn.bottom > view.bottom + 1,
      scale: +(svg.getBoundingClientRect().width / svg.viewBox.baseVal.width).toFixed(2), head: head && Math.round(head.bottom), tab: innerHeight, scrolled: scrollY,
    };
  });
  // 1. Home opens in the overview: the top map large in the upper part of the tab, and a card for each of its 8 areas in the reading order of the map,
  // an area with a diagram under it drawn small, an area with folders and files as their list; the cards in a quiet well of their own under the frame.
  await homeAt();
  await cardsFilled();
  const top = await shown();
  const smallTop = await frameNow();
  await takePicture(home, 'overview-1-home.png');
  check('Home opens in the overview: the top map in the upper part of the tab as large as its width allows, the icon "Full screen" at its top right, and under it one card for each of the 8 areas in the reading order of the map: an area with a diagram under it drawn small, an area that leads to folders and files with their list; the cards stand a little apart from the frame, on a surface of their own',
    top.crumb === 'Home' && top.icon === 'Full screen' && top.frame.height < 900 * 0.5 && top.scale > 1 && top.wide > 1200
      && top.titles.join() === 'Web pages,Web routes,Guides and notes,Night jobs,Lending,Database,Front desk,Tests' && top.drawings.join() === 'Web pages,Web routes,Lending,Database'
      && top.files['Guides and notes']?.join() === 'docs/+26 −9 · 4 files,README.md' && top.files.Tests?.join() === 'tests/+105 −67 · 4 files' && Object.keys(top.files).length === 4
      && top.shows && top.under >= 16 && top.well !== top.paper, JSON.stringify(top));

  // 1b. Each card takes the size of its content, from one unit to three units each way, and the cards are packed with no
  // hole: the card of the first node at the top left, and each point of the block inside a card or in a gap of 12 px; again after the tab gets narrower.
  // No card is narrower than its content (no file row is cut), no card of files is more than one unit (100 px and a gap) taller than its rows need, and
  // each drawing fills its card: the tall drawing of "Database" gets a card higher than wide, and every drawing fills at least 60% of its card in its
  // looser direction (a drawing card takes another size only at 70%; its own size may fill a little less).
  const packing = () => home.evaluate(() => {
    const cards = [...document.querySelectorAll('#cards .ovc')].map((card) => { const box = card.getBoundingClientRect(); return { card, title: card.querySelector('.ovn').textContent, units: card.dataset.units, left: box.left, top: box.top, right: box.right, bottom: box.bottom }; });
    const [left, top, right, bottom] = [Math.min(...cards.map((one) => one.left)), Math.min(...cards.map((one) => one.top)), Math.max(...cards.map((one) => one.right)), Math.max(...cards.map((one) => one.bottom))];
    const near = (x, y) => Math.min(...cards.map((one) => Math.hypot(Math.max(one.left - x, 0, x - one.right), Math.max(one.top - y, 0, y - one.bottom)))); // 0 inside a card
    // A hole has a card under it in its column: the room under the bottom edge of a column is none (with the rows of the changes no placing
    // of the top map ends flush, and the last row gives way first, as placeCards says).
    const over = (x, y) => cards.some((one) => one.left <= x && x <= one.right && one.top > y);
    const holes = [];
    for (let y = top + 1; y < bottom; y += 3) for (let x = left + 1; x < right; x += 3) if (near(x, y) > 12.5 && over(x, y)) holes.push([Math.round(x), Math.round(y)]);
    const cut = cards.flatMap(({ card, title }) => [...card.querySelectorAll('.ovf .dir, .ovf .nm, .ovx .nm')].filter((part) => part.scrollWidth > part.clientWidth + 1).map((part) => `${title}: ${part.textContent}`));
    // The room under the last file row, down to the rows of the changes or the bottom of the card.
    const tall = cards.filter(({ card }) => card.querySelector('.ovf a')).map(({ card, title, bottom: to }) => ({ title, empty: Math.round((card.querySelector('.ovx')?.getBoundingClientRect().top ?? to) - card.querySelector('.ovf a:last-child').getBoundingClientRect().bottom) })).filter((one) => one.empty > 100 + 12 + 12);
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
  check('each card of the overview takes the size of its content, so cards of different sizes stand under the map; they are packed with no hole: the card of the first node at the top left, and each point of the block above the bottom edge of its column inside a card or in a gap of 12 px; when the tab gets narrower they are placed again, still with no hole',
    packed.sizes.length >= 3 && packed.first === 'Web pages' && packed.firstAt && packed.holes === 0
      && narrower.columns !== packed.columns && narrower.first === 'Web pages' && narrower.firstAt && narrower.holes === 0, JSON.stringify({ packed, narrower }));
  check('no card of the overview is narrower than its content (no folder, file name or branch of a row is cut), no card of files is more than one unit taller than its rows need, and each drawing fills its card: the tall drawing of "Database" gets a card higher than wide, and each drawing fills at least 60% of its card both ways; also when the tab gets narrower',
    sized(packed) && sized(narrower), JSON.stringify({ packed, narrower }));

  // 1c. The frame takes the height of the drawing at the scale that the surface draws it at, and a tall drawing fills the tab down to the peek
  // of the cards: the head of their first row and a little of their content. A wide map that opens readable (900 px) is not cut.
  const tallAt = async (width, height) => { await home.setViewportSize({ width, height }); await homeAt('?diagram=process:answer-request/2'); return frameNow(); };
  const tall1400 = await tallAt(1400, 900);
  const tall900 = await tallAt(900, 700);
  await home.setViewportSize({ width: 900, height: 700 });
  await homeAt();
  const readable900 = await frameNow();
  await home.setViewportSize({ width: 1400, height: 900 });
  // The peek: the bottom of the frame, the room above the well and in it, the head of a card (about 25 px) and 36 px of content.
  const peeked = (one) => !one.cut && one.bottom >= one.tab - 100 && one.bottom <= one.tab - 90 && one.head <= one.tab - 30;
  check('the frame of the diagram takes the height of the drawing at the scale that it is drawn at: the small top map keeps a small frame and is whole; a tall drawing fills the tab down to the peek of the cards, the head of their first row and a little of their content, at 1400 by 900 and at 900 by 700; at 900 px the wide top map opens readable and is not cut',
    !smallTop.cut && smallTop.drawn[0] - smallTop.top <= 40 && smallTop.bottom - smallTop.drawn[1] <= 40 && peeked(tall1400) && peeked(tall900)
      && !readable900.cut && readable900.scale === 0.85 && readable900.head < 700, JSON.stringify({ smallTop, tall1400, tall900, readable900 }));

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
      && down.files['Queue and notices']?.join() === 'src/library/lending/notices.py+9 −3,src/library/lending/queue.py+6'
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

  // 6. Each file row and folder row of a card, and of the window of a node, starts with the icon that the Explorer shows for it in his file
  // icon theme (here the made-up theme of the example): before the name, at the size of the text, centred on the line. With no theme, no row has an
  // icon or its room; a new theme gives the rows that show their new icons in place.
  /** The icons of the rows of `selector`: the picture of each, its size against the size of the text, and its place against the name. */
  const iconRows = (selector) => home.evaluate((selector) => Object.fromEntries([...document.querySelectorAll(selector)].map((row) => {
    const icon = row.querySelector('.fi');
    const box = icon.getBoundingClientRect();
    const name = (row.querySelector('.nm') ?? row.querySelector('span')).getBoundingClientRect();
    const font = parseFloat(getComputedStyle(row).fontSize);
    const picture = /example-icons\/(\w+)\.svg/.exec(getComputedStyle(icon).backgroundImage)?.[1] ?? 'none';
    const sized = box.width >= font && box.width <= font * 1.5 && Math.abs(box.height - box.width) < 1;
    const placed = box.right <= (row.querySelector('.dir') ?? row.querySelector('span')).getBoundingClientRect().left && Math.abs(box.top + box.height / 2 - (name.top + name.height / 2)) <= 1.5;
    return [icon.dataset.fi, box.width ? `${picture}${sized ? '' : ' (not the size of the text)'}${placed ? '' : ' (not before the name, centred)'}` : 'no icon'];
  })), selector);
  await homeAt();
  await cardsFilled();
  const homeIcons = await iconRows('#cards .ovf a');
  await takePicture(home, 'overview-7-icons.png');
  // The window of a node, alone: where its card shows it has none.
  await home.click('#view > .ovt', { timeout: 3000 }).catch(() => {});
  await settled();
  await home.locator('#view g.node[id*="flowchart-lending-"]').hover();
  await home.waitForSelector('.win .rows a[data-tree] .fi', { timeout: 5000 }).catch(() => {});
  const windowIcons = await iconRows('.win .rows a[data-tree], .win .rows a[data-open]');
  await home.mouse.move(2, 2);
  await home.click('#view > .ovt', { timeout: 3000 }).catch(() => {});
  await settled();
  await cardsFilled();
  // A new theme while Home shows (the message of VS Code): one where every file and folder has the fallback icon, then no theme, then the made-up
  // theme again; the rows keep their place and take their new icons.
  const swapped = await home.evaluate(async () => {
    const pictures = () => [...document.querySelectorAll('#cards .ovf a .fi')].map((icon) => (icon.offsetWidth ? /(\w+)\.svg/.exec(getComputedStyle(icon).backgroundImage)?.[1] ?? 'none' : 'no icon')).join();
    const next = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const rows = document.querySelectorAll('#cards .ovf a');
    const { home: icons } = window.APOSTIL_EXAMPLE.icons;
    postMessage({ type: 'icons', icons: { css: icons.css, paths: Object.fromEntries(Object.keys(icons.paths).map((path) => [path, icons.paths['README.md']])) } });
    await next();
    const plain = pictures();
    postMessage({ type: 'icons' });
    await next();
    const none = pictures();
    postMessage({ type: 'icons', icons });
    await next();
    const same = [...document.querySelectorAll('#cards .ovf a')].every((row, at) => row === rows[at]);
    return { plain, none, back: pictures(), same };
  });
  await homeAt('?icons=none');
  await cardsFilled();
  const noTheme = await iconRows('#cards .ovf a');
  const noRoom = await home.evaluate(() => [...document.querySelectorAll('#cards .ovf a')].every((row) => Math.abs(row.querySelector('.dir').getBoundingClientRect().left - row.getBoundingClientRect().left) < 1));
  // The width of a card counts the icon: at 1200 px three rows of "Holds tab" would be cut without it.
  await home.setViewportSize({ width: 1200, height: 900 });
  await home.goto(`file://${pageFile}`);
  await loaded();
  await cardsFilled();
  await placed();
  const changeIcons = await iconRows('.ovcards .ovf a');
  const changeCut = await home.evaluate(() => [...document.querySelectorAll('.ovcards .ovf .dir, .ovcards .ovf .nm')].filter((part) => part.scrollWidth > part.clientWidth + 1).map((part) => part.closest('a').title));
  await home.setViewportSize({ width: 1400, height: 900 });
  check('each file row and folder row of a card and of the window of a node starts with the icon of the Explorer in the file icon theme (the made-up theme: code by extension and by language, the folder icon, the fallback of other files), before the name, at the size of the text and centred on the line, and the width of a card counts it (no row is cut); a new theme changes the icons of the rows in place; with no theme no row has an icon or its room',
    homeIcons['docs/'] === 'folder' && homeIcons['README.md'] === 'file' && homeIcons['src/library/night_jobs.py'] === 'code' && homeIcons['tests/'] === 'folder'
      && Object.values(homeIcons).every((one) => /^(code|folder|file)$/.test(one)) && windowIcons['src/library/lending/'] === 'folder'
      && changeIcons['web/src/member/HoldDialog.tsx'] === 'code' && changeIcons['web/src/member/member.css'] === 'file' && Object.values(changeIcons).every((one) => /^(code|folder|file)$/.test(one)) && changeCut.length === 0
      && /^file(,file)+$/.test(swapped.plain) && /^no icon(,no icon)+$/.test(swapped.none) && swapped.back === Object.values(homeIcons).join() && swapped.same
      && Object.keys(noTheme).length > 0 && Object.values(noTheme).every((one) => one === 'no icon') && noRoom,
    JSON.stringify({ homeIcons, windowIcons, changeIcons, changeCut, swapped, noTheme, noRoom }));

  // 7. The cards show the diff of the changes that touch their node: a file row its counts, a folder row the sum of its changed files before
  // its count of files, and one row for each change at the bottom of the card, of a card of files and of a card with a drawing. A click on that row
  // opens the change and does not go into the card.
  await homeAt();
  await cardsFilled();
  await placed();
  const diffCards = await home.evaluate(() => Object.fromEntries([...document.querySelectorAll('#cards .ovc')].map((card) => [card.querySelector('.ovn').textContent, {
    rows: [...card.querySelectorAll('.ovf a')].map((row) => row.textContent), colours: [...card.querySelectorAll('.ovf .c i')].map((one) => one.className).join(),
    changes: [...card.querySelectorAll('.ovx a')].map((row) => `${row.querySelector('.nm').textContent}|${row.querySelector('.c').textContent}`),
  }])));
  await takePicture(home, 'overview-8-cards-diff.png');
  const changeRow = '#cards .ovc[data-node="lending"] .ovx a[data-change-id]';
  const changeTitle = await home.$eval(changeRow, (row) => row.dataset.title).catch(() => '');
  await home.click(changeRow, { timeout: 3000 }).catch(() => {});
  await home.waitForURL(/page\.html/, { timeout: 5000 }).catch(() => {});
  await loaded();
  const fromRow = await home.evaluate(() => document.getElementById('crumb').textContent);
  const jobsCard = diffCards['Night jobs'] ?? {};
  check('the cards show the diff of the changes that touch their node: a changed file its counts in the colours of the change page, a folder the sum of its changed files before its count of files, and at the bottom of a card of files and of a card with a drawing one row for each change with its branch and "n files changed"; a click on that row opens the change and does not go into the card',
    jobsCard.rows?.join() === 'src/library/night_jobs.py+14 −18,src/library/dev_clock.py+11,src/library/jobs/1 file' && jobsCard.colours === 'p,m,p' && jobsCard.changes?.join() === 'book-holds|2 files changed'
      && diffCards.Tests?.rows.join() === 'tests/+105 −67 · 4 files' && diffCards.Lending?.changes.join() === 'book-holds|9 files changed' && diffCards.Lending?.rows.length === 0
      && !!changeTitle && fromRow === `Home›${changeTitle}`, JSON.stringify({ diffCards, changeTitle, fromRow }));

  // Where cards show, a node with a card has no window of the pointer, unless the look gives it the rule "window" or its window has marks
  // in no corner; a part of "Diagram" of a change with a card has none either. Alone, the window of a node shows the rows and counts of its card.
  /** The groups of the window that the pointer on `selector` opens ("none" when none opens), else its title. */
  const windowOn = async (selector) => {
    await home.mouse.move(2, 2);
    await home.waitForSelector('.win', { state: 'detached', timeout: 3000 }).catch(() => {});
    await home.hover(selector, { timeout: 3000 }).catch(() => {});
    return home.waitForSelector('.win', { timeout: 1500 }).then(() => home.evaluate(() => [...document.querySelectorAll('.win .gp')].map((one) => one.textContent).join('|') || document.querySelector('.win .tb b').textContent), () => 'none');
  };
  const jobs = '#view g.node[id*="flowchart-jobs-"]';
  const holdPart = '#view b[data-part="hold-service"]';
  await homeAt();
  const plain = await windowOn(jobs);
  await homeAt('?look=blocks');
  const ruled = await windowOn(jobs);
  await homeAt('?look=home&diagram=lib-tables');
  const marked = { groups: await windowOn('#view g.node[id*="flowchart-book_hold-"]'), cards: await home.$$eval('#cards .ovc', (all) => all.length) };
  await home.goto(`file://${pageFile}`);
  await loaded();
  const partWin = await windowOn(holdPart);
  check('where cards show, a node with a card opens no window of the pointer: "Night jobs" has none; with the rule "window" of a look it has its window, and so has a node whose window has marks in no corner; a part of "Diagram" of a change with a card has none',
    plain === 'none' && ruled === 'Folders and files|Changes' && marked.groups === 'Folders and files|Changes|Services' && marked.cards > 1 && partWin === 'none', JSON.stringify({ plain, ruled, marked, partWin }));

  await homeAt();
  await home.click('#view > .ovt', { timeout: 3000 }).catch(() => {});
  await settled();
  const aloneGroups = await windowOn(jobs);
  const alone = await home.evaluate(() => ({
    rows: [...document.querySelectorAll('.win .rows a[data-tree], .win .rows a[data-open]')].map((row) => row.textContent),
    changes: [...document.querySelectorAll('.win .rows a[data-change-id]')].map((row) => `${row.querySelector('.nm').textContent}|${row.querySelector('.c').textContent}`),
    colours: [...document.querySelectorAll('.win .rows a[data-tree] .c i, .win .rows a[data-open] .c i')].map((one) => one.className).join(),
  }));
  await takePicture(home, 'overview-9-alone-window.png');
  await home.goto(`file://${pageFile}`);
  await loaded();
  const alonePart = await windowOn(holdPart);
  await home.evaluate(() => localStorage.removeItem('apostil.diagramFull')); // the overview again
  check('alone, the window of "Night jobs" shows the same rows and counts as its card, and its change with "n files changed"; a part of a change has its window',
    aloneGroups === 'Folders and files|Changes' && alone.rows.join() === jobsCard.rows?.join() && alone.colours === jobsCard.colours && alone.changes.join() === jobsCard.changes?.join() && alonePart === 'Hold service',
    JSON.stringify({ aloneGroups, alone, jobsCard, alonePart }));

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
