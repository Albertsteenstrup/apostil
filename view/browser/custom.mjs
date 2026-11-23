// The browser check of the shared kinds of every component of a look: what shows, the words with fields, where a click, a key, a double
// click and a right-click entry go, the sections of a window, and the fields of a note card. A group of view/browser-check.mjs; alone:
//   node view/browser/custom.mjs [--pictures] [<folder for pictures>]
// It runs in the look "Apostil", on the made-up look "?look=shared" (view/check-example/look/look-shared.json). It also checks the rest of Home on
// "?look=home" (look-home.json); the blocks of a page of the look and of a window on "?look=blocks" (look-blocks.json), also in the dark default theme;
// the page of a change and the file tab on "?look=change" (look-change.json); the list "Repo" and the page of a pull request on "?look=side-bar"
// (look-side-bar.json); and the icons of the services on the diagrams of a change, in the default look.

import { fileURLToPath } from 'node:url';
import { lookOfPage, THEMES, wearTheme } from '../theme-look.mjs';
import { check, errors, finish, listFile, newPage, openPage, pageFile, takePicture } from './tools.mjs';

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

  // A click target takes the place of the default click: the node opens the graphs of its file, which a click on a node never opens by itself
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
  check('a click target takes the place of the default click: the node opens the graphs of its file; the words of an arrow say what their click does, and open its place on Home',
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
  // A node with no double click of the look does its click at once: one click focuses it.
  const noWait = await one.evaluate(() => {
    const g = document.querySelector('#view g.node[id*="flowchart-lending-"]');
    g.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    return g.classList.contains('focused'); // in the same moment as the click
  });
  check('Alt+click, a key while the pointer is on the node and a double click each go to their target, and the double click does no single click; a node with no double click does its click at once',
    JSON.stringify(inputs) === JSON.stringify([{ file: 'src/library/night_jobs.py', line: 516 }, { change: 'book-holds', part: 'hold-service' }, { folder: 'src/library/jobs/' }]) && noWait,
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
  // For the picture: the card in view.
  await one.evaluate(() => App.showCode('src/library/lending/requests.py', [43, 43]));
  await one.waitForFunction(() => { const top = [...document.querySelectorAll('.mc')].find((mc) => mc.querySelector('.nt')?.textContent === 'Answer the request')?.getBoundingClientRect().top; return top > 0 && top < innerHeight - 100; }, null, { timeout: 5000 }).catch(() => {});
  await takePicture(one, '573-custom-note-card-fields.png');
  check('a note card shows its fields in the order of the rule: the title, then the text; the function line and the service line that the rule leaves out are not shown',
    card.parts.join() === 't,d', JSON.stringify(card));

  // ----- the rest of Home, the drawn processes and the graphs page, on the made-up look "?look=home" (look-home.json) -----
  const blue = await one.evaluate(() => Marks.lineColors('#2b6cb0')); // the line colour of the rules, in the light theme of the page
  const crumbWords = () => one.evaluate(() => { const el = document.querySelector('#crumb b .lk-words'); return el ? `${el.textContent}:${getComputedStyle(el).color}` : ''; });
  const rgb = (hex) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;
  await one.goto(`file://${homeFile}?look=home`);
  await drawn(one);
  const top = await one.evaluate(() => ({
    summary: document.getElementById('summary').textContent, frame: getComputedStyle(document.getElementById('view')).borderTopColor,
    heads: [...document.querySelectorAll('#view .edgePaths > path:not(.hit)')].map((path) => path.getAttribute('marker-end')), crumb: document.getElementById('crumb').innerHTML,
  }));
  await one.evaluate(() => Marks.act({ comment: true }, document.querySelector('#view g.node[id*="flowchart-desk-"]')));
  const startWords = await one.evaluate(() => document.querySelector('.cbox [data-field="new"]')?.innerText.trim());
  await takePicture(one, '590-custom-home-header-frame-arrows.png');
  check('Home in a look: the header line has the words of the rule with the fields of the repo, the frame its line colour, the arrows of the map no head, and the comment box starts with the words of the rule',
    top.summary === 'library-app · 8 areas · written at this commit' && top.frame === rgb(blue.light) && top.heads.length === 7 && top.heads.every((head) => head === null)
      && top.crumb === '<b>Home</b>' && startWords === 'Question:', JSON.stringify({ top, startWords }));

  // An area box folded to one node with its colour, the arrows of its nodes at it; the key of the frame, with the pointer on an empty place, opens its target.
  await one.goto(`file://${homeFile}?look=home&diagram=lib-lending`);
  await drawn(one);
  const folded = await one.evaluate(() => ({
    nodes: [...document.querySelectorAll('#view g.node')].map((g) => `${nodeKey(g)}${g.classList.contains('lk-fill') ? '*' : ''}`).sort(),
    arrows: [...document.querySelectorAll('#view .edgePaths > path:not(.hit)')].map((path) => path.id.replace(/_\d+$/, '')).sort(), boxes: document.querySelectorAll('#view g.cluster').length,
  }));
  await takePicture(one, '591-custom-area-box-folded.png');
  const frame = await one.locator('#view').boundingBox();
  await one.mouse.move(frame.x + 30, frame.y + 30, { steps: 2 });
  await one.keyboard.press('g');
  const keyed = await one.waitForURL(/path=src%2Flibrary%2Flending%2F/, { timeout: 5000 }).then(() => drawn(one)).then(() => one.evaluate(() => `${Home.data.kind}:${Home.data.path}`), () => one.url());
  check('an area box folded by a rule is one node with its title and its colour, and the arrows of its nodes go to it; the key of the frame opens its target',
    folded.nodes.join() === 'api,holding*,perms,queue,requests,shelf' && folded.boxes === 0 && folded.arrows.join() === 'L_holding_queue,L_queue_api,L_requests_queue,L_shelf_holding,L_shelf_perms'
      && keyed === 'graphs:src/library/lending/', JSON.stringify({ folded, keyed }));

  // A drawn process: the file boxes in the folder of the rule show the name of their file, the calls out of the repo are hidden, the step of the trail is blue;
  // an opened step runs from left to right, with its branch arrows hidden and its steps still in their order.
  await one.goto(`file://${homeFile}?look=home&diagram=${encodeURIComponent('process:answer-request')}`);
  await drawn(one);
  const drawnProcess = await one.evaluate(() => ({
    boxes: [...document.querySelectorAll('#view g.cluster')].map((g) => g.textContent.trim()).sort(), calls: document.querySelectorAll('#view g.node.elsewhere').length,
  }));
  const processCrumb = await crumbWords();
  await takePicture(one, '592-custom-process-file-boxes.png');
  await one.goto(`file://${homeFile}?look=home&diagram=${encodeURIComponent('process:answer-request/2')}`);
  await drawn(one);
  const step = await one.evaluate(() => {
    const at = (key) => document.querySelector(`#view g.node[id*="flowchart-${key}-"]`).getBoundingClientRect();
    return { dotted: document.querySelectorAll('#view path[class*="dotted"]:not(.hit)').length, order: !!document.querySelector('#view path[id^="L_s8_s9_"]'), across: at('s3').right < at('s11').left, calls: document.querySelectorAll('#view g.node[id*="flowchart-o0-"]').length };
  });
  check('a drawn process in a look: the file boxes of the folder of the rule show the name of their file, the calls out of the repo are hidden, the step of the trail takes its colour; an opened step runs from left to right with no branch arrow, its steps in their order',
    drawnProcess.boxes.join('|') === 'notices.py|requests.py|src/library/web/requests_router.py' && drawnProcess.calls === 0 && processCrumb === `Answer a book request:${rgb(blue.light)}`
      && step.dotted === 0 && step.order && step.across && step.calls === 0, JSON.stringify({ drawnProcess, processCrumb, step }));

  // The graphs page: the panels of the change left out, the tables first, then by level; only the lit nodes; the titles from the words of the rule;
  // a rule that picks the diagram of the tables takes its corner away there, and the map keeps its corner.
  const panelsDrawn = () => one.waitForFunction(() => document.querySelectorAll('.pnl').length && document.querySelectorAll('.pnl .pd[data-lit]').length === document.querySelectorAll('.pnl').length, null, { timeout: 15000 });
  await one.goto(`file://${homeFile}?look=home&path=${encodeURIComponent('db/migrations/0042_holds.sql')}`);
  await drawn(one);
  await panelsDrawn();
  const graphsPage = await one.evaluate(() => ({
    summary: document.getElementById('summary').textContent, titles: [...document.querySelectorAll('.pnl .pl .t')].map((el) => el.textContent),
    levels: [...document.querySelectorAll('.pnl')].map((el) => Home.data.panels[Number(el.dataset.panel)].level),
    map: (() => { const el = [...document.querySelectorAll('.pnl')].find((one) => one.querySelector('.t').textContent.startsWith('The library app')); return { nodes: el.querySelectorAll('.pd g.node').length, corners: el.querySelectorAll('.pd .mk-stack').length }; })(),
    tables: document.querySelector('.pnl').querySelectorAll('.pd .mk-stack').length,
  }));
  await takePicture(one, '593-custom-graphs-page.png', true);
  check('the graphs page in a look: the panels of the change are left out, the tables come first, then by level; a panel of the map shows only its lit node; the titles have the words of the rule; a rule of the diagram of the tables takes its corner away there only',
    graphsPage.summary === '5 diagrams' && graphsPage.levels.join() === 'map,function,function,function,map' && !graphsPage.levels.includes('change') && graphsPage.titles[0] === 'The tables of holds (map)'
      && graphsPage.titles.at(-1) === 'The library app and its parts (map)' && graphsPage.map.nodes === 1 && graphsPage.map.corners === 1 && graphsPage.tables === 0, JSON.stringify(graphsPage));

  // With no look, Home, a process and the graphs page are drawn plain: Mermaid gets the written texts, and the lines of the page carry nothing of a look.
  const drawnWithNoLook = async (query) => {
    await one.goto(`file://${homeFile}${query}`);
    await drawn(one);
    return one.evaluate(async () => {
      const texts = [];
      const render = mermaid.render;
      mermaid.render = (id, text) => { texts.push(text); return render.call(mermaid, id, text); };
      await Home.render();
      if (Home.data.kind === 'graphs') await new Promise((done) => { const wait = () => (document.querySelectorAll('.pnl .pd[data-lit]').length === Home.data.panels.length ? done() : setTimeout(wait, 50)); wait(); });
      const written = Home.data.kind === 'graphs' ? Home.data.panels.filter((panel) => !panel.schema).map((panel) => panel.mermaid) : [Home.data.map.diagrams.find((one) => one.id === Home.at).mermaid];
      return {
        same: JSON.stringify(texts.sort()) === JSON.stringify(written.sort()), summary: document.getElementById('summary').innerHTML,
        look: document.querySelectorAll('#crumb .lk-words, #summary span, .pnl .pl span span, #view.lk-line, #view.lk-fill, .pgp').length,
        heads: [...document.querySelectorAll('#view .edgePaths > path:not(.hit)')].every((path) => path.hasAttribute('marker-end')),
      };
    });
  };
  const noLook = { top: await drawnWithNoLook(''), lending: await drawnWithNoLook('?diagram=lib-lending'), step: await drawnWithNoLook(`?diagram=${encodeURIComponent('process:answer-request/2')}`), graphs: await drawnWithNoLook(`?path=${encodeURIComponent('db/migrations/0042_holds.sql')}`) };
  check('with no look, Home, an area with its box, an opened step and the graphs page are drawn plain: Mermaid gets the written texts, the header and the count line are the default ones, and no part carries a look',
    Object.values(noLook).every((one) => one.same && one.look === 0 && one.heads) && noLook.top.summary === '' && noLook.graphs.summary === '6 diagrams, the widest first', JSON.stringify(noLook));
  await one.close();

  // ----- blocks, on the made-up look "?look=blocks" (view/check-example/look/look-blocks.json) -----
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

  // A section of its own in the window of a node, at its place among the default sections; Home carries no blocks, and asks for them only when the window opens.
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
  check('a section of its own stands at its place among the default sections in the window of a node; Home carries no blocks and asks for them only when the window opens',
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

  // ----- the page of a change and the file tab in a look ("?look=change": view/check-example/look/look-change.json) -----
  const two = await openPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  two.on('pageerror', (error) => errors.push(error.message));
  const diagramView = encodeURIComponent(JSON.stringify({ view: 'diagram', level: 'change' }));
  /** The contrast of two computed colours, put into the page as window.contrastOf. */
  const contrastIn = () => {
    const rgb = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = (color) => rgb(color).map((part) => { const c = part / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, at) => sum + c * [0.2126, 0.7152, 0.0722][at], 0);
    return (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  };

  // The card with the fields of the rule, a part in its colour with words that read, the files in no part folded, the links dashed with their words.
  await two.goto(`file://${pageFile}?look=change&go=${diagramView}`);
  await drawn(two);
  await two.evaluate(`window.contrastOf = (${contrastIn})()`);
  const change = await two.evaluate(() => {
    const contrast = window.contrastOf;
    const node = (id) => document.querySelector(`#view b[data-part="${id}"]`).closest('g.node');
    const fill = (g) => getComputedStyle(g.querySelector('.label-container')).fill;
    return {
      row: document.querySelector('.sec[data-section="change"] .sh').textContent, wider: !!document.querySelector('.sec[data-section="change"] .alters'),
      night: fill(node('night-job')), routes: fill(node('routes')), reads: contrast(fill(node('night-job')), getComputedStyle(node('night-job').querySelector('.nodeLabel b')).color),
      noPart: document.querySelector('#view b[data-nopart]').closest('g.node').querySelectorAll('.f').length,
      dashed: [...document.querySelectorAll('#view .edgePaths > path:not(.hit)')].map((path) => getComputedStyle(path).strokeDasharray !== 'none'),
      words: [...document.querySelectorAll('#view g.edgeLabel')].map((label) => label.textContent.trim()).filter(Boolean),
    };
  });
  await takePicture(two, '600-custom-change-card-parts-links.png');
  check('the card of the change shows the fields of the rule; a part has the colour of the rule with words that read; the files in no part are folded; each link is dashed with words from its fields',
    change.row === 'Adds holds for books that are out48 files' && change.wider && change.night !== change.routes && change.reads >= 4.5 && change.noPart === 0
      && change.dashed.length === 5 && change.dashed.every(Boolean) && change.words.length === 5 && change.words.every((words) => /^\(\+\d+\)$/.test(words)), JSON.stringify(change));

  // The list of diffs in the order of the rule, without the files that it leaves out; the count of the change stays the count of all its files.
  const list = await two.evaluate(() => {
    const added = (path) => App.page.files.find((file) => file.path === path).added;
    const groups = [...document.querySelectorAll('.half.right .dgroup')].map((group) => [...group.querySelectorAll('.dfile')].map((row) => row.dataset.file));
    return { groups, sorted: groups.every((paths) => paths.every((path, at) => !at || added(paths[at - 1]) >= added(path))), all: App.page.files.length, tests: App.page.files.filter((file) => file.path.startsWith('tests/')).length };
  });
  check('the list of diffs shows the files of each part in the order of the rule and leaves out the files of the rule; the card still counts every file of the change',
    list.groups.length > 2 && list.sorted && list.tests === 2 && !list.groups.flat().some((path) => path.startsWith('tests/')) && change.row.endsWith(`${list.all} files`), JSON.stringify(list));

  // "Diffs" opens first when the rule says so, and the switch has it first.
  await two.goto(`file://${pageFile}?look=change`);
  await drawn(two);
  const firstView = await two.evaluate(() => ({ view: App.state.view, order: [...document.querySelectorAll('.switch a:not([hidden])')].map((link) => `${link.textContent}${link.classList.contains('on') ? '*' : ''}`) }));
  check('"Diffs" opens first when a rule puts it first, and the switch shows it first', firstView.view === 'diffs' && firstView.order.join() === 'Diffs*,Conversation,Diagram', JSON.stringify(firstView));

  // The list of the comments from the count in the top bar (the rule "comments-window" applies to it) at the width of the rule, an answered thread
  // in the colour of its state, and the open points in groups by file, still counted.
  await two.click('[data-comments]');
  await two.waitForSelector('.cml', { timeout: 3000 });
  await two.click('.cml [data-show-points]');
  await two.evaluate(`window.contrastOf = (${contrastIn})()`);
  const side = await two.evaluate(() => {
    const contrast = window.contrastOf;
    const rows = [...document.querySelectorAll('.cml .cmr[data-row]')];
    const answered = rows.find((row) => row.querySelector('.state')?.textContent.includes('answered'));
    const other = rows.find((row) => row !== answered);
    return {
      width: document.querySelector('.cml').offsetWidth, answered: getComputedStyle(answered).backgroundColor, other: getComputedStyle(other).backgroundColor,
      reads: contrast(getComputedStyle(answered).backgroundColor, getComputedStyle(answered.querySelector('.rx')).color),
      groups: [...document.querySelectorAll('.cml .pgroup')].map((group) => group.textContent), points: document.querySelector('.cml [data-show-points]')?.textContent,
    };
  });
  await takePicture(two, '601-custom-comments-list.png');
  check('the list of the comments has the width of the rule "comments-window", an answered thread the colour of the rule with words that read, and the open points stand in groups by file, still counted',
    side.width === 380 && side.answered !== side.other && side.reads >= 4.5 && side.groups.join() === 'none,src/library/lending/hold_service.py' && side.points === 'Open points 5', JSON.stringify(side));

  // The file tab: a note with a check in the colour of the rule, the lines to the code dashed, the first line of a function from the words of the rule.
  await two.goto(`file://${pageFile}?file=src/library/lending/hold_service.py&look=change`);
  await two.waitForSelector('.mc .nt', { timeout: 15000 });
  await two.evaluate(() => App.showCode('src/library/lending/hold_service.py', [205, 205]));
  await two.waitForSelector('.mc.chk', { timeout: 5000 });
  const notes = await two.evaluate(() => {
    const checked = document.querySelector('.mc.chk');
    const plain = [...document.querySelectorAll('.mc')].find((card) => !card.classList.contains('chk'));
    return {
      checked: getComputedStyle(checked).borderLeftColor, plain: getComputedStyle(plain).borderLeftColor,
      joins: [...document.querySelectorAll('.notes svg.links [data-join]')].map((path) => getComputedStyle(path).strokeDasharray !== 'none'),
      head: document.querySelector('.mc .fn')?.textContent, map: !!document.querySelector('.cmap'),
    };
  });
  await takePicture(two, '602-custom-file-tab-notes.png');
  // Its window of the pointer: what the check found, then a section of the look's own, through the same windowOf().
  await two.hover('.mc.chk');
  const pointed = await two.waitForSelector('.win .bk-sec .block-text', { timeout: 4000 }).then(() => two.evaluate(() => ({
    check: document.querySelector('.win .stepnote')?.textContent.startsWith('Check: '), own: document.querySelector('.win .bk-sectitle')?.textContent, words: document.querySelector('.win .block-text').textContent.trim(),
  })), () => ({}));
  check('in the file tab a note with a check has the colour of the rule, the lines to the code are dashed, the first line of a function is made from the words of the rule, and its window shows what the check found and a section of the look\'s own',
    notes.checked !== notes.plain && notes.joins.length > 3 && notes.joins.every(Boolean) && notes.head === 'offer_returned_copies · 3 tests in all'
      && pointed.check && pointed.own === 'Before a merge' && pointed.words === 'Read what the check found, then the lines of the note.', JSON.stringify({ notes, pointed }));

  // The code map is not shown, and the icon of a mark stands in the margin at its line; a click opens the places of its value. With no rule, no icon.
  const marginOf = async (query) => {
    await two.goto(`file://${pageFile}?file=src/library/lending/requests.py&${query}`);
    await two.waitForSelector('.cn .code .l', { timeout: 15000 });
    await two.evaluate(() => App.showCode('src/library/lending/requests.py', [46, 46]));
    await two.waitForSelector('.cn .code .l[data-line="48"]', { timeout: 5000 });
    return two.evaluate(() => ({ icons: [...document.querySelectorAll('.cn .code .mg')].map((icon) => `${icon.closest('.l').dataset.line}:${icon.dataset.tip}`), map: !!document.querySelector('.cmap') }));
  };
  const margin = await marginOf('look=change');
  await two.click('.cn .code .l[data-line="48"] .mg', { timeout: 3000 }).catch(() => {});
  const places = await two.waitForSelector('.win .mk-rows', { timeout: 3000 }).then(() => two.evaluate(() => `${document.querySelector('.win .tt, .win .title, .win b')?.textContent ?? ''}|${document.querySelectorAll('.win .mk-rows a[data-mk-open]').length}`), () => '');
  await takePicture(two, '603-custom-margin-marks.png');
  const without = await marginOf('look=shared');
  check('the code map is not shown and the icon of a mark stands in the margin of the code at its line, whose click lists the places of its value; with no rule of the margin there is no icon and the map shows',
    !margin.map && margin.icons.includes('48:A wrong state') && margin.icons.includes('58:A wrong field') && /\|5$/.test(places) && !without.icons.length && without.map, JSON.stringify({ margin, places, without }));

  // With no look (the default look of the example), the page of the change and the file tab are drawn plain.
  await two.goto(`file://${pageFile}?go=${diagramView}`);
  await drawn(two);
  const plain = await two.evaluate(() => ({
    looked: document.querySelectorAll('#view [class*="lk-"], .mg, .lk-icon, .pgroup').length,
    row: document.querySelector('.sec[data-section="change"] .sh').textContent, order: [...document.querySelectorAll('.switch a')].map((link) => link.dataset.view).join(),
    // The words on the arrows of the diagram of the change; a small drawing of a card under it has the words of its own diagram.
    words: [...document.querySelectorAll('#view g.edgeLabel')].filter((label) => !label.closest('.ovcards')).map((label) => label.textContent.trim()).filter(Boolean).length,
    rows: document.querySelectorAll('.half.right .dfile').length,
  }));
  await two.goto(`file://${pageFile}?file=src/library/lending/hold_service.py`);
  await two.waitForSelector('.mc .nt', { timeout: 15000 });
  const plainFile = await two.evaluate(() => ({ looked: document.querySelectorAll('#view [class*="lk-"], .mg').length, map: !!document.querySelector('.cmap'), head: document.querySelector('.mc .fn')?.textContent }));
  check('with no look the page of a change and the file tab are drawn plain: no colour, icon or group of a look, every file in the list, the views in their order, the counts and the map',
    plain.looked === 0 && /^Adds holds for books that are out48 files \+[\d,]+ −[\d,]+(checked|not checked yet)$/.test(plain.row) && plain.order === 'conversation,diagram,diffs' && plain.words === 0
      && plain.rows >= 30 && plainFile.looked === 0 && plainFile.map && plainFile.head === 'offer_returned_copies · 3 tests', JSON.stringify({ plain, plainFile }));
  await two.close();

  // ----- the list "Repo" and the page of a pull request in the made-up look "?look=side-bar" (view/check-example/look/look-side-bar.json) -----
  {
  const openList = async (look) => {
    const page = await openPage({ viewport: { width: 400, height: 760 }, deviceScaleFactor: 2 });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`file://${listFile}${look ? `?look=${look}` : ''}`);
    await page.waitForFunction(() => window.apostilListDone, null, { timeout: 5000 });
    return page;
  };
  const conversation = `go=${encodeURIComponent(JSON.stringify({ view: 'conversation' }))}`;
  const openPull = async (look) => {
    const page = await openPage({ viewport: { width: 1300, height: 1000 }, deviceScaleFactor: 2 });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`file://${pageFile}?${look ? `look=${look}&` : ''}${conversation}`);
    await page.waitForFunction(() => (window.apostilConversations ?? 0) >= 1 && !!document.querySelector('#status .status'), null, { timeout: 15000 });
    return page;
  };
  /** Does `act` in the page of a pull request and waits until the page has drawn the conversation again. */
  const redrawn = async (page, act) => { const before = await page.evaluate(() => window.apostilConversations); await act(); await page.waitForFunction((at) => window.apostilConversations > at, before, { timeout: 8000 }); };
  /** Shows "Messages" or "Classic" in the page of a pull request. */
  const lookOfConversation = (page, mode) => page.click(`[data-mode="${mode}"]`).then(() => page.waitForSelector(`.conv.${mode}`, { timeout: 5000 }));

  // The search at the start: the words of the rule while VS Code keeps no search; then his own search (the field emptied) wins, and the rows stand in the order of the rule.
  const side = await openList('side-bar');
  const start = await side.evaluate(() => ({ field: document.querySelector('.find .q').value, line: document.querySelector('.eyebrow').textContent, rows: [...document.querySelectorAll('.row .nm')].map((nm) => nm.textContent) }));
  await takePicture(side, '610-custom-list-search-at-start.png');
  await side.click('.find .clear', { timeout: 3000 }).catch(() => {}); // with no words in the field there is nothing to clear
  const rows = await side.evaluate(() => [...document.querySelectorAll('.row')].map((row) => ({
    branch: row.querySelector('.nm')?.textContent, facts: row.querySelector('.mt')?.textContent, pulls: [...row.querySelectorAll('.pr .pn')].map((pn) => `${pn.textContent} ${getComputedStyle(pn).color}`),
    avatars: row.querySelectorAll('.av').length, more: !!row.querySelector('.more'),
  })));
  await takePicture(side, '611-custom-list-in-the-order-of-the-rule.png');
  check('the list starts with the search of the rule while VS Code keeps none, and the line counts what matches; emptied, his own search wins and the rows stand in the order of the rule, the branch of the rule first',
    start.field === 'state:"checks failing"' && start.line === '2 of 3 changes' && start.rows.join() === 'book-holds,made-up/follow-up'
      && rows.map((one) => one.branch).join() === 'book-holds,made-up/without-agent,made-up/follow-up', JSON.stringify({ start, rows: rows.map((one) => one.branch) }));
  const [holds] = rows;
  check('a row shows the facts of the rule in their order, a pull request line in the colour of its state, no avatars, and its older pull requests open with no fold',
    holds.facts === '2 hours ago · 48 files' && holds.pulls[0] === '#12 rgb(180, 83, 9)' && holds.pulls.slice(1).every((one) => /^#1[01] /.test(one) && !one.endsWith('rgb(180, 83, 9)')) && rows.every((one) => !one.avatars && !one.more), JSON.stringify(holds));
  await side.close();

  // The page of a pull request: "Classic" first with the side column in the order of the rule; the strip with its bits in the order of the rule, and the
  // list of checks without the passed and skipped ones while the strip still counts every check.
  const plain = await openPull();
  const plainStrip = await plain.evaluate(() => document.querySelector('#status .chk').textContent);
  const pull = await openPull('side-bar');
  const classic = await pull.evaluate(() => ({ mode: document.querySelector('.conv').className, side: [...document.querySelectorAll('.cside h4')].map((h4) => h4.textContent) }));
  const strip = () => pull.evaluate(() => ({ bits: [...document.querySelector('#status .status').children].map((el) => el.className || el.tagName.toLowerCase()), checks: document.querySelector('#status .chk').textContent }));
  const stripBefore = await strip();
  await pull.click('#status [data-checks]');
  const checks = await pull.evaluate(() => [...document.querySelectorAll('.checks-panel .ck')].map((ck) => ck.className.replace('ck ', '')));
  const stripAfter = await strip();
  await takePicture(pull, '612-custom-strip-checks-and-side-column.png');
  check('"Classic" opens first, with the side column in the order of the rule (labels, reviewers, then the others in their default order)',
    classic.mode === 'conv classic' && classic.side.join() === 'Labels,Reviewers,Assignees,Milestone,Closes,Tasks', JSON.stringify(classic));
  check('the status strip shows its bits in the order of the rule (checks, blocker, reviewers) after the icon and the number, "Review" at its place; the list of checks has no passed or skipped one, and the strip still counts every check',
    stripBefore.bits.join() === 'span,pnum,chk,msent,rvs,rvb,others' && checks.length === 3 && checks.every((one) => one === 'bad' || one === 'wait')
      && stripAfter.checks.replace('▾', '') === plainStrip.replace('▸', ''), JSON.stringify({ stripBefore, checks, stripAfter, plainStrip }));
  // "Messages": the comments of a bot in the colour of the rule, no commit, and the day lines in the words of the rule.
  await lookOfConversation(pull, 'messages');
  const messages = await pull.evaluate(() => ({
    bots: [...document.querySelectorAll('.feed .prods > .lrow')].map((row) => row.classList.contains('lk-box') && getComputedStyle(row).backgroundColor),
    commits: document.querySelectorAll('.feed .ico.git-commit').length, days: [...document.querySelectorAll('.feed .dayline')].map((line) => line.textContent),
    open: !document.querySelector('.about .more') && !document.querySelector('.about .md.folded'),
  }));
  const plainCommits = await lookOfConversation(plain, 'messages').then(() => plain.evaluate(() => document.querySelectorAll('.feed .ico.git-commit').length), () => -1);
  await pull.evaluate(() => document.querySelector('.feed .prods, .feed .prod')?.scrollIntoView({ block: 'center' }));
  await takePicture(pull, '613-custom-messages-in-the-look.png');
  check('"Messages": a comment of a bot in the colour of the rule, no commit row, the day lines in the words of the rule, and the description open at the start',
    messages.bots.length > 0 && messages.bots.every((color) => color && color !== 'rgba(0, 0, 0, 0)') && messages.commits === 0 && plainCommits > 0
      && messages.days.length > 0 && messages.days.every((day) => /^.+ · \d{1,2} \w+ \d{4}$/.test(day)) && messages.open, JSON.stringify({ messages, plainCommits }));
  await pull.close();

  // Safety: under a look that tries to hide all that it can, every control that writes to GitHub is there, in both looks of the conversation.
  const writes = (page) => page.evaluate(() => ({
    fields: document.querySelectorAll('.conv [data-gh] textarea').length, resolve: document.querySelectorAll('.conv [data-gh-resolve]').length,
    comment: document.querySelectorAll('.conv .ghend textarea').length, review: document.querySelectorAll('#status [data-review]').length,
  }));
  const before = { messages: await writes(plain) };
  await lookOfConversation(plain, 'classic');
  before.classic = await writes(plain);
  const hideAll = ['description', 'event', 'reaction', 'check', 'side-section', 'label', 'day-line'].map((kind) => ({ pick: { kind }, show: { shown: false } }))
    .concat([{ pick: { kind: 'status-strip' }, content: { fields: ['checks'] } }, { pick: { kind: 'message' }, content: { fields: ['name'] } }, { pick: { kind: 'pull-facts' }, content: { fields: ['github'] } }]);
  await redrawn(plain, () => plain.evaluate((rules) => { App.page = { ...App.page, look: { custom: true, rules, one: ['content', 'click'], sets: [], values: {}, marks: [], files: {} } }; App.render(); }, hideAll));
  const after = { classic: await writes(plain) };
  await lookOfConversation(plain, 'messages');
  after.messages = await writes(plain);
  check('under a look that tries to hide all that it can, every control that writes to GitHub is there: each "Answer", "Resolve", "Comment" and "Review", in "Classic" and in "Messages"',
    before.classic.fields > 0 && before.classic.resolve > 0 && before.classic.review === 1 && JSON.stringify(after) === JSON.stringify({ classic: before.classic, messages: before.messages }), JSON.stringify({ before, after }));
  await plain.close();

  // With no look, the list and the page are drawn plain: a look with no rule for their parts gives the same HTML.
  const listHtml = async (look) => { const page = await openList(look); const html = await page.evaluate(() => document.getElementById('list').innerHTML); await page.close(); return html; };
  const pullHtml = async (look) => {
    const page = await openPull(look);
    const html = await page.evaluate(() => `${document.getElementById('status').innerHTML}${document.querySelector('.conv').innerHTML}`.replace(/<span class="t[^"]*"[^>]*>[^<]*<\/span>/g, ''));
    await page.close();
    return html;
  };
  const [listPlain, listOther, pullPlain, pullOther] = [await listHtml(), await listHtml('1'), await pullHtml(), await pullHtml('1')];
  check('with no rule for their parts (no look, or the example look look.json), the list and the page of a pull request are drawn plain, to the same HTML',
    listPlain.length > 1000 && listPlain === listOther && pullPlain.length > 1000 && pullPlain === pullOther, `list ${listPlain.length}/${listOther.length}, page ${pullPlain.length}/${pullOther.length}`);
  }

  // ----- the icons of the services on the diagrams of a change, in the default look of the example -----
  {
  const three = await newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  three.on('pageerror', (error) => errors.push(error.message));
  const goTo = async (go) => { await three.goto(`file://${pageFile}?go=${encodeURIComponent(JSON.stringify({ view: 'diagram', ...go }))}`); await drawn(three); };
  /** The chips of each thing of the drawing that has some, by its node id (a part by its id): the value of each chip, or "+n". */
  const chips = () => three.evaluate(() => Object.fromEntries([...document.querySelectorAll('#view g.node')].filter((g) => g.querySelector('.mk-stack')).map((g) => [
    g.querySelector('b[data-part]')?.dataset.part ?? (g.querySelector('b[data-nopart]') ? 'no-part' : nodeKey(g)), [...g.querySelectorAll('.mk-chip, .mk-more')].map((chip) => chip.dataset.mk ?? chip.textContent).join(' '),
  ])));
  const flowAt = { level: 'part', part: 'hold-service', diagram: 'offer-flow' };
  /** Does something that draws the page again, and waits until it is drawn. */
  const redrawn = async (act) => {
    const before = await three.evaluate(() => window.apostilRendered ?? 0);
    await act();
    await three.waitForFunction((count) => (window.apostilRendered ?? 0) > count, before, { timeout: 15000 });
  };

  // A step of a flow chart: the icon of the service of its lines, its window, and its click.
  await goTo(flowAt);
  const onSteps = await chips();
  await takePicture(three, '630-custom-flow-service-icon.png');
  const chip = '#view g.node[id*="flowchart-pick-"] .mk-chip';
  let [row, clicked] = ['', ''];
  if (await three.locator(chip).count()) {
    await pointAt(three, chip);
    row = await three.waitForSelector('.win .mk-row', { timeout: 3000 }).then((el) => el.innerText(), () => '');
    await takePicture(three, '632-custom-flow-service-window.png');
    await redrawn(() => three.click(chip));
    clicked = await three.evaluate(() => `${App.state.view}:${App.state.file}:${App.state.lines}`);
  }
  await goTo({ ...flowAt, diagram: 'offer-sequence' });
  const onSequence = await three.evaluate(() => document.querySelectorAll('#view .mk-stack').length);
  check('a step of the flow chart of a part shows the icons of the services of its lines, as on Home: PostgreSQL on "Select the returned copies", whose window lists it with its count and its table and whose click opens its line; a sequence diagram shows no icon',
    JSON.stringify(onSteps) === '{"pick":"services:postgresql"}' && row.replace(/\s+/g, ' ') === 'PostgreSQL 1 place keeps data in it · book_copy'
      && clicked === 'code:src/library/lending/hold_service.py:219,219' && onSequence === 0, JSON.stringify({ onSteps, row, clicked, onSequence }));

  // A part of the overview: the icons of the services of its files; a click on one goes down into the flow chart of the part, with the steps that hold it lit.
  await away(three);
  await goTo({ level: 'change' });
  const onParts = await chips();
  await takePicture(three, '631-custom-overview-service-icons.png');
  const partChip = '#view g.node:has(b[data-part="hold-service"]) .mk-chip';
  if (await three.locator(partChip).count()) await redrawn(() => three.click(partChip));
  const down = await three.evaluate(() => ({ at: `${App.state.level}:${App.state.part}:${App.state.diagram}`, lit: [...document.querySelectorAll('#view g.node.lit')].map((g) => nodeKey(g)) }));
  check('a part of the overview shows the icons of the services of its files, as on Home: PostgreSQL on "Hold service" and "Tables", three and "+1" on "Night job", none on the box in no part; a click on an icon goes down into the flow chart of the part with the step that holds it lit',
    JSON.stringify(onParts) === '{"night-job":"services:book-feed services:hours-desk services:night-bell +1","hold-service":"services:postgresql","tables":"services:postgresql"}'
      && down.at === 'part:hold-service:offer-flow' && down.lit.join() === 'pick', JSON.stringify({ onParts, down }));

  // With no marks the overview and the flow chart are the same pictures as with no look at all, which draws no icon.
  const picture = async (look) => {
    await three.evaluate(async (which) => {
      const { look: given } = window.APOSTIL_EXAMPLE.page;
      App.page = { ...App.page, look: which === 'none' ? undefined : which === 'no marks' ? { ...given, marks: [] } : given };
      await App.render();
    }, look);
    await three.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    return three.locator('#view').screenshot({ animations: 'disabled' }); // the mark of a working thread pulses
  };
  const same = {};
  for (const [name, go] of [['overview', { level: 'change' }], ['flow', flowAt]]) {
    await goTo(go);
    await away(three);
    const [marked, noMarks, none] = [await picture('marks'), await picture('no marks'), await picture('none')];
    same[name] = { noMarks: noMarks.equals(none), marked: marked.equals(none) };
  }
  check('with no marks the overview and the flow chart of a part are the same pictures as the page with no look, which draws no icon; with the marks they differ',
    Object.values(same).every((one) => one.noMarks && !one.marked), JSON.stringify(same));
  await three.close();
  }
} catch (error) {
  check('the checks ran to the end', false, error.message.split('\n').slice(0, 14).join(' / '));
}
await finish();
