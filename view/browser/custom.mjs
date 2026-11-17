// The browser check of the shared kinds of every component of a look (build 57): what shows, the words with fields, where a click, a key, a double
// click and a right-click entry go, the sections of a window, and the fields of a note card. A group of view/browser-check.mjs; alone:
//   node view/browser/custom.mjs [--pictures] [<folder for pictures>]
// It runs in the look "Apostil", on the made-up look "?look=shared" (view/check-example/look/look-shared.json). The later briefs add their checks here.

import { fileURLToPath } from 'node:url';
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

  // ----- the page of a change and the file tab in a look (build 60, "?look=change": view/check-example/look/look-change.json) -----
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
  const opened = await two.evaluate(() => ({ view: App.state.view, order: [...document.querySelectorAll('.switch a:not([hidden])')].map((link) => `${link.textContent}${link.classList.contains('on') ? '*' : ''}`) }));
  check('"Diffs" opens first when a rule puts it first, and the switch shows it first', opened.view === 'diffs' && opened.order.join() === 'Diffs*,Diagram,Conversation', JSON.stringify(opened));

  // The comments window at the width of the rule, an answered thread in the colour of its state, and the open points in groups by file.
  await two.evaluate(() => document.querySelector('#side .sh.shut [data-group="points"]')?.click());
  await two.evaluate(`window.contrastOf = (${contrastIn})()`);
  const side = await two.evaluate(() => {
    const contrast = window.contrastOf;
    const cards = [...document.querySelectorAll('#side .thread[data-thread]')];
    const answered = cards.find((card) => card.querySelector('.state')?.textContent.includes('answered'));
    const other = cards.find((card) => card !== answered);
    return {
      width: document.getElementById('side').offsetWidth, answered: getComputedStyle(answered).backgroundColor, other: getComputedStyle(other).backgroundColor,
      reads: contrast(getComputedStyle(answered).backgroundColor, getComputedStyle(answered.querySelector('.tx')).color),
      groups: [...document.querySelectorAll('#side .pgroup')].map((group) => group.textContent), points: document.querySelector('#side [data-group="points"] .n')?.textContent,
    };
  });
  await two.evaluate(() => document.querySelector('#side .pgroup')?.scrollIntoView({ block: 'center' })); // for the picture: the open points in groups
  await takePicture(two, '601-custom-comments-window.png');
  check('the comments window has the width of the rule, an answered thread the colour of the rule with words that read, and the open points stand in groups by file, still counted',
    side.width === 380 && side.answered !== side.other && side.reads >= 4.5 && side.groups.join() === 'none,src/library/lending/hold_service.py' && side.points === '5', JSON.stringify(side));

  // The file tab: a note with a check in the colour of the rule, the lines to the code dashed, the first line of a function from the words of the rule.
  await two.goto(`file://${pageFile}?file=src/library/lending/hold_service.py&look=change`);
  await two.waitForSelector('.mc .nt', { timeout: 15000 });
  await two.click('#side [data-fold]', { timeout: 3000 }).catch(() => {});
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
  check('in the file tab a note with a check has the colour of the rule, the lines to the code are dashed, and the first line of a function is made from the words of the rule',
    notes.checked !== notes.plain && notes.joins.length > 3 && notes.joins.every(Boolean) && notes.head === 'offer_returned_copies · 3 tests in all', JSON.stringify(notes));

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

  // With no look (the default look of the example), the page of the change and the file tab are drawn as before.
  await two.goto(`file://${pageFile}?go=${diagramView}`);
  await drawn(two);
  const plain = await two.evaluate(() => ({
    looked: document.querySelectorAll('#view [class*="lk-"], #side [class*="lk-"], .mg, .lk-icon, .pgroup').length,
    row: document.querySelector('.sec[data-section="change"] .sh').textContent, order: [...document.querySelectorAll('.switch a')].map((link) => link.dataset.view).join(),
    side: document.getElementById('side').offsetWidth, words: [...document.querySelectorAll('#view g.edgeLabel')].map((label) => label.textContent.trim()).filter(Boolean).length,
    rows: document.querySelectorAll('.half.right .dfile').length,
  }));
  await two.goto(`file://${pageFile}?file=src/library/lending/hold_service.py`);
  await two.waitForSelector('.mc .nt', { timeout: 15000 });
  const plainFile = await two.evaluate(() => ({ looked: document.querySelectorAll('#view [class*="lk-"], .mg').length, map: !!document.querySelector('.cmap'), head: document.querySelector('.mc .fn')?.textContent }));
  check('with no look the page of a change and the file tab are drawn as before: no colour, icon or group of a look, every file in the list, the views in their order, the counts and the map',
    plain.looked === 0 && /^Adds holds for books that are out48 files \+[\d,]+ −[\d,]+(checked|not checked yet)$/.test(plain.row) && plain.order === 'diagram,diffs,conversation' && plain.side === 320 && plain.words === 0
      && plain.rows >= 30 && plainFile.looked === 0 && plainFile.map && plainFile.head === 'offer_returned_copies · 3 tests', JSON.stringify({ plain, plainFile }));
  await two.close();
} catch (error) {
  check('the checks ran to the end', false, error.message.split('\n').slice(0, 14).join(' / '));
}
await finish();
