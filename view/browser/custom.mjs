// The browser check of the shared kinds of every component of a look (build 57): what shows, the words with fields, where a click, a key, a double
// click and a right-click entry go, the sections of a window, and the fields of a note card. A group of view/browser-check.mjs; alone:
//   node view/browser/custom.mjs [--pictures] [<folder for pictures>]
// It runs in the look "Apostil", on the made-up look "?look=shared" (view/check-example/look/look-shared.json). The later briefs add their checks here:
// build 58 the blocks of a page of the look and of a window, on "?look=blocks" (look-blocks.json), also in the dark default theme.

import { fileURLToPath } from 'node:url';
import { lookOfPage, THEMES, wearTheme } from '../theme-look.mjs';
import { check, errors, finish, openPage, pageFile, takePicture } from './tools.mjs';

const homeFile = fileURLToPath(new URL('../media/home.html', import.meta.url));
const node = (key) => `#view :is(g.node, g.image-shape)[id*="flowchart-${key}-"]`;
const drawn = (page, count = 1) => page.waitForFunction((at) => (window.apostilRendered ?? 0) >= at, count, { timeout: 15000 });
/** What the page sent for a target of the look since `from` (an index into apostilSent). */
const targets = (page, from = 0) => page.evaluate((at) => window.apostilSent.slice(at).filter((one) => one.type === 'target').map((one) => one.target), from);
const sentNow = (page) => page.evaluate(() => window.apostilSent.length);
/** The pointer to the middle of an element, and its box. */
const pointAt = async (page, selector) => { const box = await page.locator(selector).first().boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 }); return box; };
const away = (page) => page.mouse.move(5, 5, { steps: 2 }).then(() => page.waitForFunction(() => !document.querySelector('.win'), null, { timeout: 3000 }).catch(() => {}));

try {
  const one = await openPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  one.on('pageerror', (error) => errors.push(error.message));
  await one.goto(`file://${homeFile}?look=shared`);
  await drawn(one);

  // What shows: the node that a rule leaves out is gone with its arrow; the words of a node and of an arrow come from their fields; the arrow words take their colour.
  const shown = await one.evaluate(() => ({
    nodes: [...document.querySelectorAll('#view :is(g.node, g.image-shape)')].map((g) => nodeKey(g)),
    arrows: [...document.querySelectorAll('#view .edgePaths > path:not(.hit)')].map((path) => path.id.replace(/_\d+$/, '')),
    jobs: document.querySelector('#view g.node[id*="flowchart-jobs-"]').textContent.trim(),
    words: [...document.querySelectorAll('#view .edgeLabel.lk-words')].map((label) => label.textContent.trim()),
    small: document.querySelector('#view g.node[id*="flowchart-jobs-"]').classList.contains('lkSmall'),
    icon: getComputedStyle(document.querySelector('#view g.node[id*="flowchart-desk-"]')).getPropertyValue('--lk-icon').startsWith('url('),
  }));
  await takePicture(one, '570-custom-home-shared-look.png');
  check('a node that a rule does not show leaves the drawing with its arrow, the rest is drawn; the words of a node and of an arrow are made from their fields, with their size, colour and icon',
    !shown.nodes.includes('checks') && shown.nodes.includes('lending') && !shown.arrows.some((id) => id.includes('checks')) && shown.arrows.includes('L_jobs_lending')
      && shown.jobs === 'Night jobs · 3 files' && shown.words.join() === 'wakes each night · from jobs' && shown.small && shown.icon, JSON.stringify(shown));

  // A window: its sections in the order of the rule, at its width, without the marks of the services, which stand in no corner of this node now.
  await pointAt(one, node('jobs'));
  await one.waitForSelector('.win .lk-does', { timeout: 3000 });
  const win = await one.evaluate(() => ({
    width: document.querySelector('.win').style.width, groups: [...document.querySelectorAll('.win .rows .gp')].map((gp) => gp.textContent),
    does: [...document.querySelectorAll('.win .lk-does p')].map((line) => line.textContent), corner: !!document.querySelector('#view g.node[id*="flowchart-jobs-"] .mk-stack.right'),
  }));
  await takePicture(one, '571-custom-window-sections.png');
  await away(one);
  await one.goto(`file://${homeFile}?look=shared&diagram=${encodeURIComponent('process:answer-request')}`);
  await drawn(one);
  await pointAt(one, '#view g.node[id*="flowchart-s0-"]');
  await one.waitForSelector('.win .mk-note .mk-lines', { state: 'attached', timeout: 3000 }).catch(() => {});
  const stepOrder = await one.evaluate(() => [...(document.querySelector('.win .mk-note')?.children ?? [])].map((el) => el.className.split(' ')[0]).filter((name) => name !== 'mk-stack'));
  check('a window shows its sections in the order of the rule, at its width, without the section that the rule leaves out; the pointer says what a click and each other input do',
    win.width === '440px' && win.groups.join() === 'Changes,Folders and files' && !win.corner && stepOrder.join() === 'mk-lines,stepnote'
      && win.does.join(' | ') === 'Click: Opens the graphs of src/library/night_jobs.py. | Alt+click: Opens src/library/night_jobs.py at line 516. | Double click: Shows src/library/jobs/ in the tree "Files". | Key G: Opens the change of the branch book-holds at its part hold-service. | Right click: 2 entries',
    JSON.stringify({ win, stepOrder }));

  // A click target takes the place of the click of today: the node opens the graphs of its file, which a click on a node never opens by itself
  // (as a file in a browser that page opens; in VS Code its tab). The click of the words of an arrow opens its place on Home.
  await one.goto(`file://${homeFile}?look=shared`);
  await drawn(one);
  await one.click(node('jobs'));
  const graphs = await one.waitForURL(/path=src%2Flibrary%2Fnight_jobs\.py/, { timeout: 5000 }).then(() => drawn(one)).then(() => one.evaluate(() => `${Home.data.kind}:${Home.data.path}`), () => one.url());
  await one.goto(`file://${homeFile}?look=shared`);
  await drawn(one);
  await pointAt(one, '#view .edgeLabel.lk-words');
  const arrowSays = await one.waitForSelector('.win .stepnote', { timeout: 3000 }).then((el) => el.textContent(), () => '');
  await one.click('#view .edgeLabel.lk-words');
  await drawn(one, 2);
  const crumb = await one.evaluate(() => document.getElementById('crumb').textContent);
  check('a click target takes the place of the click of today: the node opens the graphs of its file; the words of an arrow say what their click does, and open its place on Home',
    graphs === 'graphs:src/library/night_jobs.py' && arrowSays === 'Click: Opens process:answer-request on Home.' && /›Answer a book request$/.test(crumb), JSON.stringify({ graphs, arrowSays, crumb }));
  let from;

  // Alt+click, a key and a double click go to their targets; the double click is not also a single click; a thing with no double click does not wait.
  await one.goto(`file://${homeFile}?look=shared`);
  await drawn(one);
  from = await sentNow(one);
  await one.click(node('jobs'), { modifiers: ['Alt'] });
  await pointAt(one, node('jobs'));
  await one.keyboard.press('g');
  const box = await one.locator(node('jobs')).boundingBox();
  await one.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await one.waitForFunction((at) => window.apostilSent.slice(at).filter((sent) => sent.type === 'target').length >= 3, from, { timeout: 3000 }).catch(() => {});
  await one.evaluate(() => new Promise((done) => setTimeout(done, 400))); // a single click that the double click wrongly left would come by now
  const inputs = await targets(one, from);
  const noWait = await one.evaluate(() => {
    const before = window.apostilSent.length;
    document.querySelector('#view g.node[id*="flowchart-lending-"]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    return window.apostilSent.length - before; // sent in the same moment as the click
  });
  check('Alt+click, a key while the pointer is on the node and a double click each go to their target, and the double click does no single click; a node with no double click does its click at once',
    JSON.stringify(inputs) === JSON.stringify([{ file: 'src/library/night_jobs.py', line: 516 }, { change: 'book-holds', part: 'hold-service' }, { folder: 'src/library/jobs/' }]) && noWait > 0,
    JSON.stringify({ inputs, noWait }));

  // A right click lists the entries of the look in a small window, and an entry goes to its target.
  await one.goto(`file://${homeFile}?look=shared`);
  await drawn(one);
  const at = await pointAt(one, node('jobs'));
  await one.mouse.click(at.x + at.width / 2, at.y + at.height / 2, { button: 'right' });
  const rows = await one.waitForSelector('.win .lk-menu', { timeout: 3000 }).then(() => one.$$eval('.win .lk-menu a', (all) => all.map((row) => row.textContent)), () => []);
  await takePicture(one, '572-custom-right-click-menu.png');
  from = await sentNow(one);
  await one.click('.win .lk-menu a[data-entry="1"]');
  const entry = await targets(one, from);
  check('a right click lists the entries of the look in a small window, and a click on an entry goes to its target',
    rows.join() === 'Show the folder in Files,Open the night run' && JSON.stringify(entry) === '[{"file":"src/library/night_jobs.py","line":516}]', JSON.stringify({ rows, entry }));

  // A note card shows its fields in the order of the rule: its title with its tests, then its text; no function line and no service line.
  await one.goto(`file://${pageFile}?file=src/library/lending/requests.py&look=shared`);
  await one.waitForSelector('.mc .nt', { timeout: 15000 });
  const card = await one.evaluate(() => {
    const el = [...document.querySelectorAll('.mc')].find((mc) => mc.querySelector('.nt')?.textContent === 'Answer the request');
    return { parts: [...el.children].filter((part) => !part.classList.contains('mk-stack')).map((part) => part.className), shownBefore: !!el };
  });
  // For the picture: the comments window folded, and the card in view.
  await one.click('#side [data-fold]', { timeout: 3000 }).catch(() => {});
  await one.evaluate(() => App.showCode('src/library/lending/requests.py', [43, 43]));
  await one.waitForFunction(() => { const top = [...document.querySelectorAll('.mc')].find((mc) => mc.querySelector('.nt')?.textContent === 'Answer the request')?.getBoundingClientRect().top; return top > 0 && top < innerHeight - 100; }, null, { timeout: 5000 }).catch(() => {});
  await takePicture(one, '573-custom-note-card-fields.png');
  check('a note card shows its fields in the order of the rule: the title, then the text; the function line and the service line that the rule leaves out are not shown',
    card.parts.join() === 't,d', JSON.stringify(card));
  await one.close();

  // ----- build 58: blocks, on the made-up look "?look=blocks" (view/check-example/look/look-blocks.json) -----
  const pageAt = () => `file://${homeFile}?look=blocks&page=opening-hours`;
  const kinds = ['text', 'fields', 'table', 'bars', 'code', 'state', 'links', 'button', 'picture', 'diagram', 'row'];
  /** What a page of blocks shows: each kind of block, the rows of its table, a drawn diagram, a loaded picture, the line at the top, and how it reads. */
  const pageState = async (page, dark) => {
    const state = await page.evaluate(async (all) => {
      await Promise.all([...document.querySelectorAll('.bk-image')].map((img) => (img.complete ? null : new Promise((done) => { img.onload = img.onerror = done; }))));
      return {
        kinds: all.filter((kind) => document.querySelector(`.bk-page .block-${kind}`)), rows: document.querySelectorAll('.block-table tbody tr').length, bars: document.querySelectorAll('.bk-bar').length,
        diagram: !!document.querySelector('.bk-panel .bk-drawing svg g.node'), picture: document.querySelector('.bk-image')?.naturalWidth > 0, crumb: document.getElementById('crumb').textContent,
      };
    }, kinds);
    const read = await page.evaluate(lookOfPage, dark);
    return { ...state, bright: read.bright, low: read.normal.low };
  };

  // A page of the look with every kind of block, in the look "Apostil" and in the dark default theme: each block drawn, its text reads, no box lighter than the page.
  const seen = {};
  for (const [key, theme] of [['apostil', null], ['dark', THEMES.dark]]) {
    const page = await openPage({ viewport: { width: 1280, height: 1500 }, deviceScaleFactor: 2 });
    page.on('pageerror', (error) => errors.push(error.message));
    if (theme) await page.addInitScript(wearTheme, theme);
    await page.goto(pageAt());
    await drawn(page);
    seen[key] = await pageState(page, !!theme);
    await takePicture(page, `58${key === 'dark' ? 1 : 0}-custom-page-${key}.png`, true);
    await page.close();
  }
  const pageHolds = (state) => state.kinds.join() === kinds.join() && state.rows === 4 && state.diagram && state.picture && state.bars === 4 && state.crumb === 'Home›Opening hours' && !state.bright.length && !state.low.length;
  check('a page of the look draws every kind of block (text, fields, a table and bars from a file, code, a state, links, a button, a picture, a diagram, a row) under "Home › <title>", in the look "Apostil" and in the dark theme: its text reads at 4.5 to 1 and no box is lighter than the page',
    pageHolds(seen.apostil) && pageHolds(seen.dark), JSON.stringify(seen));

  // A row: two blocks side by side on a wide page, one under the other on a narrow one; nothing is cut off or wider than the page.
  const rowAt = async (width) => {
    const page = await openPage({ viewport: { width, height: 1400 }, deviceScaleFactor: 2 });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(pageAt());
    await drawn(page);
    const state = await page.evaluate(() => {
      const [left, right] = [...document.querySelector('.block-row .bk-cols').children].map((el) => el.getBoundingClientRect());
      const cut = [...document.querySelectorAll('.bk, .bk *')].filter((el) => !el.closest('.bk-scroll, .bk-drawing') && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible').map((el) => el.className);
      return { side: Math.abs(left.top - right.top) < 2 && right.left >= left.right, under: right.top >= left.bottom, wide: document.documentElement.scrollWidth > innerWidth, cut };
    });
    if (width < 700) await takePicture(page, '582-custom-page-narrow.png', true);
    await page.close();
    return state;
  };
  const [wide, narrow] = [await rowAt(1280), await rowAt(520)];
  check('a row puts its blocks side by side on a wide page and one under the other on a narrow page, with nothing cut off and nothing wider than the page',
    wide.side && !wide.wide && !wide.cut.length && narrow.under && !narrow.wide && !narrow.cut.length, JSON.stringify({ wide, narrow }));

  // A section of its own in the window of a node, at its place among the sections of today; Home carries no blocks, and asks for them only when the window opens.
  const home = await openPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  home.on('pageerror', (error) => errors.push(error.message));
  await home.goto(`file://${homeFile}?look=blocks`);
  await drawn(home);
  const before = await home.evaluate(() => {
    window.blocksAsked = [];
    const asked = window.ask;
    window.ask = (question) => { if (question.startsWith('blocks:')) window.blocksAsked.push(question); return asked(question); };
    return { carries: JSON.stringify(Home.data).includes('"blocks"'), asked: window.blocksAsked.length };
  });
  await pointAt(home, node('jobs'));
  await home.waitForSelector('.win .bk-sec .block-table', { timeout: 4000 }).catch(() => {});
  const section = await home.evaluate(() => ({
    order: [...document.querySelectorAll('.win .wc .gp, .win .wc .bk-sectitle')].map((el) => el.textContent), rows: document.querySelectorAll('.win .block-table tbody tr').length, asked: window.blocksAsked.length,
  }));
  await takePicture(home, '583-custom-window-own-section.png');
  check('a section of its own stands at its place among the sections of today in the window of a node; Home carries no blocks and asks for them only when the window opens',
    !before.carries && before.asked === 0 && section.order.join() === 'Folders and files,Opening hours,Changes' && section.rows === 4 && section.asked === 1, JSON.stringify({ before, section }));

  // A window as a target: a click opens it beside the node, with its blocks, and Escape closes it.
  await away(home);
  const lending = await home.locator(node('lending')).boundingBox();
  await home.click(node('lending'));
  const opened = await home.waitForSelector('.win .block-text', { timeout: 4000 }).then(() => home.evaluate(() => {
    const win = document.querySelector('.win').getBoundingClientRect();
    return { title: document.querySelector('.win .tb b').textContent, width: Math.round(win.width), x: win.left, y: win.top, right: win.right, bottom: win.bottom, links: document.querySelectorAll('.win .bk-links a').length };
  }), () => null);
  await takePicture(home, '584-custom-window-target.png');
  await home.keyboard.press('Escape');
  const closed = await home.waitForFunction(() => !document.querySelector('.win'), null, { timeout: 2000 }).then(() => true, () => false);
  const beside = opened && (opened.x >= lending.x + lending.width || opened.right <= lending.x || opened.y >= lending.y + lending.height || opened.bottom <= lending.y)
    && Math.min(Math.abs(opened.x - (lending.x + lending.width)), Math.abs(opened.right - lending.x), Math.abs(opened.y - (lending.y + lending.height)), Math.abs(opened.bottom - lending.y)) < 40;
  check('a window as a target opens beside the node with its title, width and blocks, and closes with Escape',
    opened?.title === 'Lending, in short' && opened.width === 400 && opened.links === 1 && beside && closed, JSON.stringify({ opened, lending, closed }));
  await home.close();

  // A link of a block opens its file at its line, a button goes to its target, and text with "<" shows as text.
  const links = await openPage({ viewport: { width: 1280, height: 1500 } });
  links.on('pageerror', (error) => errors.push(error.message));
  await links.goto(pageAt());
  await drawn(links);
  from = await sentNow(links);
  await links.click('.bk-links a >> text=The night run');
  await links.click('.bk-press');
  const went = await targets(links, from);
  const words = await links.evaluate(() => ({ text: document.querySelector('.block-text').textContent, tags: document.querySelectorAll('.block-text *:not(div, p, br)').length }));
  check('a link of a block opens its file at its line and a button goes to its target',
    JSON.stringify(went) === JSON.stringify([{ file: 'src/library/night_jobs.py', line: 516 }, { folder: 'data/' }]), JSON.stringify(went));
  check('text of a block with "<" in it shows as text', words.text.includes('<branch>, <opens>, <closes>, <hours>') && words.tags === 0, JSON.stringify(words));
  await links.close();
} catch (error) {
  check('the checks ran to the end', false, error.message.split('\n').slice(0, 14).join(' / '));
}
await finish();
