// The browser check of the shared kinds of every component of a look (build 57): what shows, the words with fields, where a click, a key, a double
// click and a right-click entry go, the sections of a window, and the fields of a note card. A group of view/browser-check.mjs; alone:
//   node view/browser/custom.mjs [--pictures] [<folder for pictures>]
// It runs in the look "Apostil", on the made-up look "?look=shared" (view/check-example/look/look-shared.json). The later briefs add their checks here.

import { fileURLToPath } from 'node:url';
import { check, errors, finish, listFile, openPage, pageFile, takePicture } from './tools.mjs';

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

  // ----- Build 61: the list "Repo" and the page of a pull request in the made-up look "?look=side-bar" (view/check-example/look/look-side-bar.json) -----
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
  check('"Classic" opens first, with the side column in the order of the rule (labels, reviewers, then the others as before)',
    classic.mode === 'conv classic' && classic.side.join() === 'Labels,Reviewers,Assignees,Milestone,Closes,Tasks', JSON.stringify(classic));
  check('the status strip shows its bits in the order of the rule (checks, blocker, reviewers), "Review" at its place; the list of checks has no passed or skipped one, and the strip still counts every check',
    stripBefore.bits.join() === 'span,chk,msent,rvs,rvb,others' && checks.length === 3 && checks.every((one) => one === 'bad' || one === 'wait')
      && stripAfter.checks.replace('▾', '') === plainStrip.replace('▸', ''), JSON.stringify({ stripBefore, checks, stripAfter, plainStrip }));
  // "Messages": the comments of a bot in the colour of the rule, no commit, and the day lines in the words of the rule.
  await lookOfConversation(pull, 'messages');
  const messages = await pull.evaluate(() => ({
    bots: [...document.querySelectorAll('.feed .prod > .prow, .feed .prods > .prow')].map((row) => row.classList.contains('lk-box') && getComputedStyle(row).backgroundColor),
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

  // With no look, the list and the page are drawn as before: a look with no rule for their parts gives the same HTML.
  const listHtml = async (look) => { const page = await openList(look); const html = await page.evaluate(() => document.getElementById('list').innerHTML); await page.close(); return html; };
  const pullHtml = async (look) => {
    const page = await openPull(look);
    const html = await page.evaluate(() => `${document.getElementById('status').innerHTML}${document.querySelector('.conv').innerHTML}`.replace(/<span class="t[^"]*"[^>]*>[^<]*<\/span>/g, ''));
    await page.close();
    return html;
  };
  const [listPlain, listOther, pullPlain, pullOther] = [await listHtml(), await listHtml('1'), await pullHtml(), await pullHtml('1')];
  check('with no rule for their parts (no look, or the look of build 51), the list and the page of a pull request are drawn as before, to the same HTML',
    listPlain.length > 1000 && listPlain === listOther && pullPlain.length > 1000 && pullPlain === pullOther, `list ${listPlain.length}/${listOther.length}, page ${pullPlain.length}/${pullOther.length}`);
  }
} catch (error) {
  check('the checks ran to the end', false, error.message.split('\n').slice(0, 14).join(' / '));
}
await finish();
