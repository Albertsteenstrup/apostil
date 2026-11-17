// The browser check of the comments on the change page: the comments window, the box at the pointer, "@" and the agents, threads and their states,
// a comment on any component of a diagram, a file and "Diffs", and a click on a card that lights its thing.
// A group of view/browser-check.mjs, which runs every group at the same time; alone:
//   node view/browser/comments.mjs [--pictures] [<folder for pictures>]

import { check, errors, finish, newPage, pageFile, takePicture } from './tools.mjs';

const page = await newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

const shot = (name) => takePicture(page, `${name}.png`);
const changeSection = '.sec[data-section="change"]';
const service = `${changeSection} b[data-part="hold-service"]`;
// Waits until the page is still: two frames, the drawing that runs, and one frame more. A diagram fits its card again in that time
// after the comments window shows or hides.
const settle = () => page.evaluate(async () => {
  const frame = () => new Promise((done) => requestAnimationFrame(done));
  await frame();
  await frame();
  await App.drawing;
  await frame();
});
// Does something that draws the page again, and waits until that drawing is done.
const drawn = async (act) => {
  const before = await page.evaluate(() => window.apostilRendered ?? 0);
  await act();
  await page.waitForFunction((count) => (window.apostilRendered ?? 0) > count, before, { timeout: 15000 });
  await settle();
};
const loaded = async () => { await page.waitForFunction(() => (window.apostilRendered ?? 0) >= 1, null, { timeout: 15000 }); await settle(); };
const hoverWindow = () => page.waitForSelector('.win', { timeout: 3000 }).catch(() => null);
const away = async () => { await page.mouse.move(2, 2); await page.waitForSelector('.win', { state: 'detached', timeout: 3000 }).catch(() => {}); };
const showCode = async (file, lines) => { await page.evaluate(([at, span]) => { App.showCode(at, span); return App.drawing; }, [file, lines]); await settle(); };
const diagramView = async (where) => { await page.evaluate((go) => App.go(go), where); await settle(); };

const card = (text) => page.locator('#side .thread[data-thread]', { hasText: text });
const sentRemarks = () => page.evaluate(() => window.apostilSent.filter((message) => message.type === 'remark'));
const box = (selector) => page.$eval(selector, (el) => { const { left, right, top, bottom, width } = el.getBoundingClientRect(); return { left, right, top, bottom, width }; });
const boxField = '.cbox [data-field="new"]';
const isIcon = () => page.evaluate(() => /url/.test(getComputedStyle(document.querySelector('#view')).cursor)); // the pointer is the comment icon
// The comment box is gone: saved (after its flight into the window, a quarter of a second), discarded or closed.
const noBox = () => page.waitForSelector('.cbox', { state: 'detached', timeout: 3000 }).catch(() => {});
// Presses the key, which turns the pointer into a comment icon, then clicks an element; returns where the click was.
const keyOn = async (selector) => {
  await settle();
  await page.keyboard.press('Meta+Shift+Period');
  const at = await page.locator(selector).boundingBox();
  const pointer = { x: Math.round(at.x + at.width / 2), y: Math.round(at.y + at.height / 2) };
  await page.mouse.click(pointer.x, pointer.y);
  await page.waitForSelector(`${boxField}:focus`, { timeout: 3000 });
  return pointer;
};

try {
  await page.goto(`file://${pageFile}`);
  await loaded();

  // ----- the comments window: a window of its own at the right edge, two categories with counts. The example holds a made-up agent and threads in each state -----
  const pointCount = await page.evaluate(() => App.page.openPoints.length);
  const side = await box('#side');
  const view = await box('#view');
  const windowNow = await page.evaluate(() => {
    const el = document.getElementById('side');
    return {
      radius: getComputedStyle(el).borderTopLeftRadius, border: getComputedStyle(el).borderTopWidth, inPage: !!el.closest('.paper'), width: innerWidth, height: innerHeight,
      heads: [...el.querySelectorAll('.sh .grp')].map((head) => head.textContent).join(), threads: el.querySelectorAll('.thread[data-thread]').length, points: el.querySelectorAll('.point').length,
      oldWords: /Prompt for the agent|[Rr]emark/.test(document.body.textContent) || !!document.querySelector('[data-copy]'),
    };
  });
  check('the comments window stands at the right edge of the tab over its full height, apart from the page, in the window frame, with "Comments" and "Open points" and their counts, and no "Prompt for the agent", "Copy" or word "remark"',
    side.left > view.right && side.right === windowNow.width - 8 && side.top === 8 && side.bottom === windowNow.height - 8 && windowNow.radius === '8px' && windowNow.border === '1px' && !windowNow.inPage
      && windowNow.heads === `Comments4,Open points${pointCount}` && windowNow.threads === 4 && windowNow.points === pointCount && !windowNow.oldWords,
    `window ${Math.round(side.left)}–${Math.round(side.right)} × ${side.top}–${side.bottom}, view ends at ${Math.round(view.right)}; ${JSON.stringify(windowNow)}`);
  await shot('10-comments-window-with-two-categories');
  await page.click('#side .sh .grp[data-group="points"]');
  const folds = { pointsShut: await page.$$eval('#side .point', (cards) => cards.length), commentsStay: await page.$$eval('#side .thread[data-thread]', (cards) => cards.length) };
  await page.click('#side .sh .grp[data-group="points"]');
  folds.pointsBack = await page.$$eval('#side .point', (cards) => cards.length);
  await page.click('#side [data-fold]');
  folds.rail = await page.textContent('#side .rail').catch(() => '');
  folds.viewWidth = (await box('#view')).width;
  await page.click('#side [data-unfold]');
  folds.reopened = await page.$$eval('#side .thread[data-thread]', (cards) => cards.length);
  check('each category folds by itself; the window folds to a rail with the number of open threads and points, the diagram takes the room, and a click on the rail opens it again',
    folds.pointsShut === 0 && folds.commentsStay === 4 && folds.pointsBack === pointCount && folds.rail === String(4 + pointCount) && folds.viewWidth > view.width + 200 && folds.reopened === 4, JSON.stringify(folds));

  await card('Return 404').hover();
  const near = await page.$$eval(`${changeSection} g.node.near b[data-part]`, (titles) => titles.map((title) => title.dataset.part).join());
  await card('Return 404').locator('.tx').click();
  const flash = await page.$$eval(`${changeSection} g.node.flash b[data-part]`, (titles) => titles.map((title) => title.dataset.part).join());
  await page.click(`${changeSection} b[data-part="night-job"] .rk`);
  const lit = await page.$$eval('#side .thread.cur', (cards) => cards.map((one) => one.querySelector('.where').textContent).join());
  const crumbAfterCircle = await page.textContent('#crumb');
  check('a hover on a card lights its part quietly, and a click lights it; a click on the circle of a part brings up its card, lit, and does not drill down',
    near === 'routes' && flash === 'routes' && lit === 'Part "Night job"' && !/Night job$/.test(crumbAfterCircle), JSON.stringify({ near, flash, lit, crumbAfterCircle }));

  // ----- the comment key and the box at the pointer -----
  // With no comment and no open point the window is not there; the first comment, written in the box at the pointer, brings it.
  let kept;
  await drawn(async () => { kept = await page.evaluate(() => { const before = { remarks: App.page.remarks, openPoints: App.page.openPoints }; Object.assign(App.page, { remarks: [], openPoints: [] }); App.render(); return before; }); });
  const hiddenEmpty = await page.$eval('#side', (el) => el.hidden && getComputedStyle(el).display === 'none');
  const fullWidth = await box('#view');
  const servicePlace = await page.locator(service).boundingBox();
  await page.mouse.move(servicePlace.x + 20, servicePlace.y + 8);
  // A key press that only VS Code saw (the page has no keyboard) switches the comment icon on, and the next one off.
  const keys = {};
  await page.evaluate(() => Remarks.openFromVsCode());
  keys.onFromVsCode = await isIcon();
  await page.waitForTimeout(320); // a second press of the key within 0.3 s counts for nothing
  await page.evaluate(() => Remarks.openFromVsCode());
  keys.offFromVsCode = !(await isIcon());
  // The key of the page opens no box: the pointer becomes a comment icon; Esc, or the key again, switches it back.
  await page.keyboard.press('Meta+Shift+Period');
  keys.icon = await page.evaluate(() => ({ boxes: document.querySelectorAll('.cbox').length, cursor: getComputedStyle(document.querySelector('#view')).cursor.slice(0, 40) }));
  await page.keyboard.press('Escape');
  keys.offByEsc = !(await isIcon());
  // Inside VS Code one key press reaches the page twice: the page takes it, and VS Code passes it on, late when the page is busy with a drawing.
  // The late copy must not switch the comment icon off again.
  await page.keyboard.press('Meta+Shift+Period');
  await page.waitForTimeout(320); // the late copy comes after the 0.3 s in which a second press counts for nothing
  await page.evaluate(() => Remarks.openFromVsCode());
  keys.keptAfterLateCopy = await isIcon();
  await page.keyboard.press('Meta+Shift+Period');
  keys.offByKey = !(await isIcon());
  check('the key opens no box: it turns the pointer into a comment icon, and Esc or the key again turns it back; a copy of the key press that VS Code passes on late does not switch it off, and a key press from VS Code alone switches it on and the next one off',
    keys.onFromVsCode && keys.offFromVsCode && keys.icon.boxes === 0 && /^url\("data:image\/svg\+xml/.test(keys.icon.cursor) && keys.offByEsc && keys.keptAfterLateCopy && keys.offByKey, JSON.stringify(keys));
  const pointer = await keyOn(service);
  const placed = await page.evaluate(() => ({ ...document.querySelector('.cbox').getBoundingClientRect().toJSON(), where: document.querySelector('.cbox .where').textContent, cursor: getComputedStyle(document.querySelector('#view')).cursor }));
  check('with no comment and no open point there is no comments window; the click after the key sticks a small box exactly there, with the name of the thing under it and the cursor in its field',
    hiddenEmpty && fullWidth.right > 1300 && Math.abs(placed.left - pointer.x) <= 3 && Math.abs(placed.top - pointer.y) <= 3 && placed.where === 'Part "Hold service"' && !/url/.test(placed.cursor),
    `click ${pointer.x},${pointer.y}; box ${Math.round(placed.left)},${Math.round(placed.top)}; ${placed.where}`);
  await shot('11-comment-box-at-the-pointer');
  // A click outside an empty box removes it; with text, a small window asks first.
  await page.mouse.click(30, 860);
  const emptyGone = await page.$$eval('.cbox', (all) => all.length);
  await keyOn(service);
  await page.keyboard.type('Half a thought');
  await page.mouse.click(30, 860);
  const asked = await page.evaluate(() => ({ text: document.querySelector('.cbox.ask')?.textContent, boxes: document.querySelectorAll('.cbox').length, level: App.state.level }));
  await page.click('.cbox.ask [data-keep]');
  const keptText = await page.evaluate(() => ({ ask: !!document.querySelector('.cbox.ask'), focused: document.activeElement.matches('.cbox [data-field="new"]'), text: document.activeElement.innerText }));
  await page.mouse.click(30, 860);
  await page.click('.cbox.ask [data-discard]');
  const discarded = await page.$$eval('.cbox', (all) => all.length);
  check('a click outside an empty box removes it; with text, "Discard this comment?" asks with "Discard" and "Keep writing", the click does nothing else, "Keep writing" goes back to the text and "Discard" removes it',
    emptyGone === 0 && asked.text === 'Discard this comment?DiscardKeep writing' && asked.boxes === 2 && asked.level === 'change' && !keptText.ask && keptText.focused && keptText.text === 'Half a thought' && discarded === 0,
    JSON.stringify({ emptyGone, asked, keptText, discarded }));
  // Enter saves it: the box flies into the window in a quarter of a second and becomes the card there; with reduced motion it does not move.
  await keyOn(service);
  await page.keyboard.type('Why is the pickup day set before the mail is sent?');
  await page.keyboard.press('Enter');
  const flight = await page.waitForFunction(() => {
    const one = document.querySelector('.cbox');
    if (!one) return { gone: true };
    return one.getAnimations().length ? { animations: one.getAnimations().length } : false;
  }, null, { timeout: 3000 }).then((handle) => handle.jsonValue(), () => ({}));
  await noBox();
  const landed = await page.evaluate(() => ({
    box: !!document.querySelector('.cbox'), shown: !document.getElementById('side').hidden,
    cards: [...document.querySelectorAll('#side .thread[data-thread]')].map((one) => one.querySelector('.tx').textContent).join(), visible: getComputedStyle(document.querySelector('#side .thread')).visibility,
  }));
  const plain = (await sentRemarks()).pop();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await keyOn(`${changeSection} b[data-part="routes"]`);
  await page.keyboard.type('One more.');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#side .thread[data-thread]').length === 2, null, { timeout: 3000 }).catch(() => {});
  const still = await page.evaluate(() => ({ box: !!document.querySelector('.cbox'), cards: document.querySelectorAll('#side .thread[data-thread]').length }));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  check('Enter saves it: the box moves into the window with a short animation and becomes the card there, and the window appears with it; with reduced motion the comment appears in the window with no movement',
    flight.animations === 1 && !landed.box && landed.shown && landed.cards === 'Why is the pickup day set before the mail is sent?' && landed.visible === 'visible' && !plain?.to && plain?.target.part === 'hold-service'
      && !still.box && still.cards === 2, JSON.stringify({ flight, ...landed, still }));
  await drawn(() => page.evaluate((before) => { Object.assign(App.page, before); App.render(); }, kept));
  await page.keyboard.press('Escape');

  // A new comment on a part, while other threads exist: its card stands at the place of its part.
  await keyOn(service);
  await page.keyboard.type('Why is the pickup day set before the mail is sent?');
  await page.keyboard.press('Enter');
  await noBox();
  await settle();
  const order = await page.$$eval('#side .thread .where', (all) => all.map((where) => where.textContent));
  const circle = await page.$eval(`${service} .rk`, (dot) => dot.textContent).catch(() => '');
  check('a comment without the mention stays open, its card stands at the place of its part, and its part shows a circle',
    order.indexOf('Part "Hold service"') === order.indexOf('Part "Desk screen"') + 1 && circle === '1', order.join(' | '));

  // ----- "@" and the agents -----
  // "@" lists whom a comment can go to; letters cut the list, the grey rest of the lit name follows the cursor, Tab writes it.
  const listed = () => page.$$eval('.mentions .opt', (rows) => rows.map((row) => row.querySelector('.nm').textContent).join());
  await keyOn(`${changeSection} b[data-part="tables"]`);
  await page.keyboard.type('Log the opening hours that the run used. @');
  const mention = {};
  mention.rows = await page.$$eval('.mentions .opt', (all) => all.map((row) => `${row.querySelector('.nm').textContent} | ${row.querySelector('.does').textContent} | ${row.querySelector('img.icon')?.getAttribute('src')}`).join('\n'));
  await page.keyboard.type('c');
  mention.cut = await listed();
  await page.keyboard.type('l');
  mention.ghost = await page.evaluate(() => {
    const rest = document.querySelector('.ghost');
    const caret = getSelection().getRangeAt(0).getBoundingClientRect();
    return { text: rest?.textContent, color: rest && getComputedStyle(rest).color, at: rest && Math.abs(rest.getBoundingClientRect().left - caret.right) < 2 };
  });
  await shot('11c-mention-list-in-the-box');
  await page.keyboard.press('ArrowDown');
  mention.movedGhost = await page.textContent('.ghost').catch(() => '');
  mention.movedLit = await page.textContent('.mentions .opt.lit .nm').catch(() => '');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Tab');
  mention.written = await page.$eval(boxField, (field) => {
    const one = field.querySelector('[data-mention]');
    return { text: one?.textContent, color: one && getComputedStyle(one).color, after: one?.nextSibling?.textContent, list: !!document.querySelector('.mentions') };
  });
  check('typing @ in the box lists claude-current first, named after its session, then a new session of each installed app, each with its icon; @c cuts the list to three names, after @cl the grey rest "aude-current" follows the cursor, Down and Up move it, and Tab writes @claude-current and a space as one unit in the teal ink',
    mention.rows === ['claude-current | the session Made-up session name | agents/claude-code.svg', 'claude-new | a new session | agents/claude-code.svg',
      'codex-new | a new session | agents/codex.svg', 'opencode-new | a new session | agents/opencode.svg'].join('\n')
      && mention.cut === 'claude-current,claude-new,codex-new' && mention.ghost.text === 'aude-current' && mention.ghost.color === 'rgb(154, 151, 143)' && mention.ghost.at
      && mention.movedLit === 'claude-new' && mention.movedGhost === 'aude-new' && mention.written.text === '@claude-current' && mention.written.color === 'rgb(11, 95, 88)' && mention.written.after === ' ' && !mention.written.list,
    JSON.stringify(mention));
  await page.keyboard.type('please');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Thanks.');
  const twoLines = await page.$eval(boxField, (field) => field.innerText.includes('\n'));
  await page.keyboard.press('Enter');
  await noBox();
  await settle();
  const sent = (await sentRemarks()).pop();
  const sentState = await card('Log the opening hours that the run used.').locator('.state').textContent().catch(() => '');
  check('Shift+Enter makes a new line; the comment with @claude-current is sent to that session; as a file in a browser nothing can run, so it waits, with "Start a run"',
    twoLines && sent?.to?.app === 'claude-code' && sent.to.kind === 'current' && /^Log the opening hours that the run used\. @claude-current please\s+Thanks\.$/.test(sent.text)
      && /^waiting for claude-current · Start a run$/.test(sentState.trim()), `${JSON.stringify(sent?.text)}; ${sentState}`);

  // ----- threads -----
  // A thread shows its messages with who wrote each; a reply belongs to its thread, Esc closes the list of names, and a reply with a mention sends the reply.
  const thread = card('Is the shelf tested with an empty list?');
  const replies = { who: (await thread.locator('.msg .who').allTextContents()).map((who) => who.replace(/\d.*$/, '').trim()).join() };
  await thread.scrollIntoViewIfNeeded();
  await shot('12-thread-with-reply-and-answer');
  await thread.locator('[data-field]').click();
  await page.keyboard.type('Good, thanks.');
  await drawn(() => page.keyboard.press('Enter'));
  replies.reply = (await sentRemarks()).pop();
  replies.last = (await card('Is the shelf tested with an empty list?').locator('.msg .tx').allTextContents()).at(-1);
  await card('Does the tab show the pickup day').locator('[data-field]').click();
  await page.keyboard.type('@co');
  await page.keyboard.press('Escape');
  replies.afterEsc = await page.evaluate(() => [!!document.querySelector('.mentions'), document.activeElement.innerText]);
  await page.keyboard.type('d');
  await page.keyboard.press('Enter');
  await page.keyboard.type('look at this one');
  await drawn(() => page.keyboard.press('Enter'));
  replies.sentReply = (await sentRemarks()).pop();
  replies.state = (await card('Does the tab show the pickup day').locator(':scope > .state').textContent().catch(() => '')).trim();
  check('a thread shows the comments and the answers of the agent in order, with who wrote each; a reply shows under its thread and belongs to it; Esc closes the list and leaves the text as typed, and a reply with @codex-new is sent to a new codex session',
    replies.who === 'You,Claude Code,You,Claude Code' && replies.reply.thread === 4 && !replies.reply.to && replies.last === 'Good, thanks.'
      && replies.afterEsc[0] === false && replies.afterEsc[1] === '@co' && replies.sentReply.thread === 1 && replies.sentReply.to?.app === 'codex' && replies.sentReply.to.kind === 'new' && replies.state === 'waiting for codex-new',
    JSON.stringify(replies));

  const running = card('Why is the pickup day set before the mail is sent?').filter({ hasText: 'Part "Night job"' });
  const states = {
    pulse: await running.locator('.dot.pulse').evaluate((dot) => getComputedStyle(dot).animationName).catch(() => ''),
    running: (await running.locator('.state').textContent().catch(() => '')).trim(), links: await running.locator('.state [data-session]').count(),
  };
  await running.locator('[data-session]').click();
  states.opened = await page.evaluate(() => window.apostilSent.filter((message) => message.type === 'openSession').pop()?.id);
  states.answered = (await card('Is the shelf tested with an empty list?').locator(':scope > .state').textContent().catch(() => '')).trim();
  check('a running thread shows the pulsing dot, "claude-current is working", since when, and the session link; a click on "session" asks VS Code to open the session of that comment, and an answered thread keeps its session link',
    states.pulse === 'pulse' && /^claude-current is working · since .+ · session$/.test(states.running) && states.links === 1 && states.opened === 3 && states.answered === 'answered · session', JSON.stringify(states));

  const circles = await page.$$eval(`${changeSection} b[data-part] .rk`, (all) => Object.fromEntries(all.map((rk) => [rk.parentElement.dataset.part, [rk.className, getComputedStyle(rk).backgroundColor]])));
  const cutCircles = await page.$$eval(`${changeSection} b[data-part]`, (titles) => titles.filter((title) => {
    const own = title.querySelector('.rk');
    if (!own) title.insertAdjacentHTML('beforeend', States.circleHtml(1, 'done'));
    const rk = title.querySelector('.rk');
    const room = parseFloat(getComputedStyle(title).paddingRight) >= rk.offsetWidth + parseFloat(getComputedStyle(rk).marginLeft);
    const cut = !room || rk.getBoundingClientRect().right > title.closest('foreignObject').getBoundingClientRect().right + 0.5;
    if (!own) title.querySelector('.rk').remove();
    return cut;
  }).map((title) => title.dataset.part));
  check('the circle on a part shows the state of its newest thread, open, pulsing or with a check mark, none is a filled badge, and the name of every part keeps room for a circle with a check mark',
    circles['holds-tab'][0] === 'rk open' && circles['night-job'][0] === 'rk running' && circles['desk-screen'][0] === 'rk done' && Object.values(circles).every(([, fill]) => fill === 'rgba(0, 0, 0, 0)') && cutCircles.length === 0,
    JSON.stringify({ circles, cutCircles }));

  // Resolve puts a thread away; "N resolved" shows them, with Reopen. The agent can resolve a thread too.
  await drawn(() => card('Is the shelf tested with an empty list?').locator('[data-resolve]').click());
  const resolved = { left: await card('Is the shelf tested with an empty list?').count(), line: await page.textContent('#side .resolved').catch(() => '') };
  await page.click('#side .resolved');
  resolved.byAgent = await page.locator('#side .thread.gone', { hasText: 'Rename the column' }).locator('.state').textContent().catch(() => '');
  await drawn(() => page.locator('#side .thread.gone', { hasText: 'Is the shelf tested' }).locator('[data-reopen]').click());
  resolved.back = await card('Is the shelf tested with an empty list?').count();
  check('"Resolve" takes the thread out of the window, "2 resolved" shows it with a thread that the agent resolved ("resolved by Claude Code"), and "Reopen" brings it back',
    resolved.left === 0 && resolved.line === '2 resolved' && resolved.byAgent === 'resolved by Claude Code' && resolved.back === 1, JSON.stringify(resolved));

  // An open point: a click shows its lines, and a reply on it starts a thread tied to that point.
  const firstPoint = page.locator('#side .point').filter({ hasText: 'The selected copies are locked.' });
  await drawn(() => firstPoint.locator('.tx').click());
  const pointLines = await page.$$eval('.cv .code .l.flash', (all) => all.map((row) => row.dataset.line).join());
  await firstPoint.locator('[data-field]').click();
  await page.keyboard.type('How long is the lock?');
  await drawn(() => page.keyboard.press('Enter'));
  const onPoint = (await sentRemarks()).pop();
  const pointThread = await card('How long is the lock?').locator('.where').textContent().catch(() => '');
  check('a click on an open point shows its lines, and a reply on it starts a thread tied to that point in "Comments"',
    pointLines === '230' && onPoint.target.kind === 'open-point' && typeof onPoint.point === 'number' && pointThread === 'hold_service.py, line 230', `${pointLines}; ${pointThread}`);

  // Code lines with a thread: a click on them brings up the card, and a click on the card lights them.
  const first = 5;
  await showCode('src/library/night_jobs.py', [first, first]); // at these lines: a file with no lines asked for opens at its first change
  await drawn(() => page.evaluate((line) => {
    App.page.remarks.push({ id: 99, changeId: 0, target: { kind: 'lines', file: 'src/library/night_jobs.py', lines: [line, line + 1], label: `night_jobs.py, lines ${line}–${line + 1}` }, text: 'Is this loop covered?', createdAt: new Date().toISOString(), state: 'open' });
    App.render();
  }, first));
  await page.click(`.cv .code [data-line="${first + 1}"] .x`);
  const linesCard = await page.$$eval('#side .thread.cur .tx', (all) => all.map((tx) => tx.textContent).join());
  await page.evaluate(() => { document.querySelector('.cv').scrollTop = 40000; });
  // The rows are lit for a moment only: a watcher keeps which rows were lit, so a busy Mac cannot miss them.
  await page.evaluate(() => {
    window.litSeen = new Set();
    document.querySelectorAll('.cv .code .l.flash').forEach((row) => row.classList.remove('flash')); // only what the click on the card lights counts
    const look = () => document.querySelectorAll('.cv .code .l.flash').forEach((row) => window.litSeen.add(row.dataset.line));
    new MutationObserver(look).observe(document.querySelector('.cv'), { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
  });
  await card('Is this loop covered?').locator('.tx').click();
  await page.waitForFunction(() => window.litSeen.size >= 2, null, { timeout: 5000 }).catch(() => {});
  const litRows = await page.evaluate(() => [...window.litSeen].sort((x, y) => x - y).join());
  check('a click on code lines with a thread brings up its card, and a click on the card lights those lines',
    linesCard === 'Is this loop covered?' && litRows === `${first},${first + 1}`, `card ${linesCard}; lit ${litRows}`);
  await drawn(() => page.click('#crumb a[data-trail="1"]'));

  // With no session and no installed app the list says so and offers nothing; Esc closes the box.
  const saved = await page.evaluate(() => { const before = { agent: App.page.agent, apps: App.page.apps }; Object.assign(App.page, { agent: undefined, apps: [] }); return before; });
  await keyOn(`${changeSection} b[data-part="routes"]`);
  await page.keyboard.type('@');
  const noSession = await page.textContent('.mentions').catch(() => '');
  const options = await page.$$eval('.mentions .opt', (all) => all.length);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await noBox();
  const dropped = await page.$$eval('.cbox', (all) => all.length);
  await page.evaluate((before) => Object.assign(App.page, before), saved);
  check('with no session and no installed app the @ list says so in one line and offers nothing, and Esc closes the box',
    noSession === 'No agent to send to: this change has no known session, and no agent app is installed.' && options === 0 && dropped === 0, noSession);

  // At 370 px the window starts folded and opens over the page, so the content under it keeps its width.
  await page.setViewportSize({ width: 370, height: 900 });
  await page.reload();
  await loaded();
  const foldedAtStart = await page.$eval('#side', (el) => el.classList.contains('folded'));
  const narrowView = await box('#view');
  await page.click('#side [data-unfold]');
  const over = await page.$eval('#side', (el) => ({ position: getComputedStyle(el).position, width: el.getBoundingClientRect().width }));
  const viewUnder = await box('#view');
  check('at 370 px the comments window starts folded, and opens over the page without squeezing the content',
    foldedAtStart && over.position === 'fixed' && over.width > 300 && viewUnder.width === narrowView.width, `${JSON.stringify(over)}, view ${Math.round(narrowView.width)} then ${Math.round(viewUnder.width)} px`);
  await shot('13-comments-window-at-370');
  await page.click('#side [data-fold]');

  // ----- a comment on any component: the outline under the comment pointer, the words in the box, and a click on its card that lights it -----
  // The middle of a drawn thing, by its key: the middle of an arrow's line, else the middle of its box.
  const spotOf = (key) => page.evaluate((wanted) => {
    const els = [...document.querySelectorAll('.paper [data-rk]')].filter((el) => el.dataset.rk === wanted);
    const line = els.find((el) => el.tagName === 'path' && !el.classList.contains('hit'));
    if (line) {
      const at = line.getPointAtLength(line.getTotalLength() / 2);
      const m = line.getScreenCTM();
      return { x: m.a * at.x + m.c * at.y + m.e, y: m.b * at.x + m.d * at.y + m.f };
    }
    const el = els.find((one) => one.tagName !== 'svg') ?? els[0];
    const box = (el.querySelector('b[data-part], b[data-nopart]') ?? el).getBoundingClientRect(); // a part by its title, not by a file name in it
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, key);
  const aimed = () => page.evaluate(() => [...new Set([...document.querySelectorAll('.aim')].map((el) => el.dataset.rk ?? `line ${el.dataset.line}`))]);
  const flashed = () => page.evaluate(() => [...new Set([...document.querySelectorAll('.paper .flash')].map((el) => el.dataset.rk))]);
  // Presses the key, moves the pointer to a spot, reads the outline, clicks and reads the words of the box.
  const stickAt = async (spot) => {
    await settle();
    await page.keyboard.press('Meta+Shift+Period');
    await page.mouse.move(spot.x - 3, spot.y - 3);
    await page.mouse.move(spot.x, spot.y, { steps: 2 });
    const outline = await aimed();
    await page.mouse.click(spot.x, spot.y);
    const opened = await page.waitForSelector(`${boxField}:focus`, { timeout: 3000 }).then(() => true, () => false);
    return { outline, where: opened ? await page.textContent('.cbox .where') : '' };
  };
  const saveBox = async (text) => {
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await noBox();
    await settle();
    return (await sentRemarks()).pop()?.target;
  };
  const closeBox = async () => { await page.keyboard.press('Escape'); await noBox(); };
  const stuckOn = {}; // the key and the target of each saved comment, by its text
  // Under the comment pointer the thing of a key has the outline, and the click sticks the box on it with its words; with a text the comment is saved.
  const tryOne = async (key, words, text, stuck) => {
    stuck ??= await stickAt(await spotOf(key));
    if (text) stuckOn[text] = { key, target: await saveBox(text) };
    else await closeBox();
    return { key, ok: stuck.outline.join() === key && stuck.where === words, ...stuck };
  };
  const failed = (tries) => JSON.stringify(tries.map(({ key, ok, outline, where }) => (ok ? key : { key, outline, where })));

  // The diagram of the change: a file name inside a part, a part, an empty place, the title row, an arrow, "5 more files", "In no part".
  await page.setViewportSize({ width: 1400, height: 1000 });
  await diagramView({ level: 'change' });
  const arrowKey = 'edge::routes>hold-service:';
  const emptySpot = await page.$eval(`${changeSection} .surface`, (el) => { const box = el.getBoundingClientRect(); return { x: box.left + 20, y: box.bottom - 20 }; });
  const onChange = [
    await tryOne('file:web/src/member/HoldsPanel.tsx', 'File HoldsPanel.tsx (+158), part "Holds tab"'),
    await tryOne('part:routes', 'Part "Routes"'),
    { ...(await tryOne('diagram:', 'Diagram "Adds holds for books that are out"', '', await stickAt(emptySpot))), key: 'diagram: (an empty place)' },
    await tryOne('diagram:', 'Diagram "Adds holds for books that are out"'),
  ];
  const onArrow = await stickAt(await spotOf(arrowKey));
  await shot('41-box-on-an-arrow');
  onChange.push(await tryOne(arrowKey, 'Arrow "Routes" to "Hold service"', 'Why do the routes call the service directly?', onArrow));
  onChange.push(await tryOne('more-files:holds-tab', '5 more files, part "Holds tab"', 'Which five files are these?'));
  onChange.push(await tryOne('no-part', 'The files in no part'));
  const arrow = { edge: stuckOn['Why do the routes call the service directly?'].target?.edge, circle: await page.evaluate((key) => !!document.querySelector(`.paper g.edgeLabel[data-rk="${key}"] .rk`), arrowKey) };
  check('under the comment pointer a file name inside a part (not its part), a part, an empty place and the title row (both the diagram as a whole), an arrow, "5 more files" and "In no part" of the change diagram each have the outline, and the click sticks the box on it with its words; the target of an arrow holds the ids of its two parts, and an arrow with a thread shows its circle',
    onChange.every((one) => one.ok) && JSON.stringify(arrow.edge) === '["routes","hold-service"]' && arrow.circle, `${failed(onChange)}; ${JSON.stringify(arrow)}`);

  // A part's diagram, large: a node with no code lines, a node with code lines, an arrow with its label, the title row.
  await diagramView({ level: 'part', part: 'hold-service', diagram: 'offer-flow' });
  const onPart = [
    await tryOne('node:offer-flow:open', 'Node "Library open today?", diagram "How one night run offers returned copies"', 'What does open mean here?'),
    await tryOne('node:offer-flow:pick', 'Node "Select the returned copies", diagram "How one night run offers returned copies"'),
    await tryOne('edge:offer-flow:open>closed:no', 'Arrow "Library open today?" to "Return: closed today", "no"'),
    await tryOne('diagram:offer-flow', 'Diagram "How one night run offers returned copies"'),
  ];
  const nodeTarget = stuckOn['What does open mean here?'].target;
  check('in a part\'s diagram a node with no code lines, a node with code lines, an arrow with its label and the title each have the outline and hold the comment; the target of a node holds the id of its diagram and of its node from the Mermaid text, and its part',
    onPart.every((one) => one.ok) && JSON.stringify(nodeTarget) === JSON.stringify({ kind: 'node', diagram: 'offer-flow', node: 'open', part: 'hold-service', label: 'Node "Library open today?", diagram "How one night run offers returned copies"' }),
    `${failed(onPart)}; ${JSON.stringify(nodeTarget)}`);

  // A sequence diagram and a state diagram.
  await drawn(() => page.click('#tabs [data-diagram="offer-sequence"]'));
  const onOthers = [
    await tryOne('node:offer-sequence:S', 'Participant "Hold service", diagram "The night run, message by message"'),
    await tryOne('edge:offer-sequence:T>S:rows', 'Message "rows" from "Tables" to "Hold service"', 'Are the rows locked?'),
  ];
  const messageCircle = await page.evaluate(() => !!document.querySelector('#view g.rk.svg circle'));
  await diagramView({ level: 'part', part: 'tables', diagram: 'hold-states' });
  onOthers.push(await tryOne('node:hold-states:paused', 'State "paused", diagram "The states of one hold"'));
  onOthers.push(await tryOne('edge:hold-states:waiting>paused:pause', 'Transition "pause" from "waiting" to "paused"', 'Who can pause it?'));
  check('a participant and a message of a sequence diagram, and a state and a transition of a state diagram, each have the outline and hold the comment; a message with an open thread shows the small circle beside it',
    onOthers.every((one) => one.ok) && messageCircle, `${failed(onOthers)}; circle ${messageCircle}`);

  await diagramView({ level: 'broad', diagram: 'member-areas' });
  const onWider = [
    await tryOne('node:member-areas:renew', 'Node "Renew a loan", diagram "The areas of the member page"', 'Who may renew?'),
    await tryOne('diagram:member-areas', 'Diagram "The areas of the member page"'),
  ];
  check('a node and the title of a wider diagram each have the outline and hold the comment', onWider.every((one) => one.ok), failed(onWider));

  // "Diffs": the row of a file in the list, a changed line and a note in the file beside it (build prompt 42). The comments window is folded,
  // so that the file has room for its cards.
  const foldSide = async () => { if (await page.isVisible('#side [data-fold]')) await page.click('#side [data-fold]'); };
  const night = 'src/library/night_jobs.py';
  await drawn(() => page.click('.switch a[data-view="diffs"]'));
  await foldSide();
  await page.evaluate((file) => App.diffs.toPath(file), night); // after the file is drawn again for the new width
  await settle();
  const headStuck = await stickAt(await page.$eval(`.diffs .dfile[data-file="${night}"] .dh`, (el) => { const box = el.getBoundingClientRect(); return { x: box.left + box.width * 0.5, y: box.top + box.height / 2 }; }));
  stuckOn['Why does the night job change?'] = { key: `file:${night}`, target: await saveBox('Why does the night job change?') };
  const onDiffs = [{ key: `file:${night}`, ok: headStuck.outline.join() === `file:${night}` && headStuck.where === 'File night_jobs.py (+14 −18), part "Night job"' && stuckOn['Why does the night job change?'].target?.view === 'diffs', ...headStuck }];
  // The saved comment drew the page again, with the same file.
  const addedRow = await page.waitForSelector('#view > .file-left .cn .l.add[data-line]', { timeout: 5000 }).then(() => page.evaluate(() => {
    const cv = document.querySelector('#view > .file-left .cv').getBoundingClientRect();
    const el = [...document.querySelectorAll('#view > .file-left .cn .l.add[data-line]')].find((row) => row.getBoundingClientRect().top > cv.top + 60 && row.getBoundingClientRect().bottom < cv.bottom - 20);
    const box = el.getBoundingClientRect();
    return { x: box.left + 200, y: box.top + box.height / 2, line: el.dataset.line };
  }));
  onDiffs.push(await tryOne(`line ${addedRow.line}`, `${night}, line ${addedRow.line}`, '', await stickAt(addedRow)));
  await foldSide(); // the saved comment opened the window again
  const noteKey = `note:${night}:removed:243`;
  await page.evaluate((file) => App.diffs.toPath(file), night); // after the file is drawn again for the new width
  const diffNote = await page.evaluate(async (key) => {
    const el = [...document.querySelectorAll('#view > .file-left .mc')].find((one) => one.dataset.rk === key);
    el.scrollIntoView({ block: 'center' });
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const box = el.querySelector('.t').getBoundingClientRect();
    return { x: box.left + 30, y: box.top + box.height / 2 };
  }, noteKey);
  onDiffs.push(await tryOne(noteKey, `Note "The reservation run is gone", ${night}, removed lines 243–252`, '', await stickAt(diffNote)));
  await page.click('#side [data-unfold]').catch(() => {});
  check('on "Diffs" the row of a file has the outline and holds a comment on the file that remembers "Diffs"; a changed line of the file and a note on removed lines have the outline, and the box names that line and the removed lines',
    onDiffs.every((one) => one.ok), failed(onDiffs));

  // The code view: a test in the window of the tests (the window stays while the key is pressed in it), and a note.
  await showCode('src/library/lending/hold_service.py', [245, 245]);
  await page.hover('.cv .mc [data-tests]');
  const testsWin = await hoverWindow();
  const testRow = testsWin ? await page.$eval('.win .trw', (el) => { const box = el.querySelector('.nm').getBoundingClientRect(); return { x: box.left + 40, y: box.top + box.height / 2, key: el.dataset.rk }; }) : null;
  if (testRow) await page.mouse.move(testRow.x, testRow.y, { steps: 4 }); // into the window, as a person does before the key
  const testStuck = testRow ? await stickAt(testRow) : { outline: [], where: '' };
  await closeBox();
  await away();
  // Beside code with notes the comments window lies over the notes column and takes no room of its own: the code keeps its width, and the control of the files stays free above the window.
  const overNotes = await page.evaluate(() => {
    const [side, notes, code, control] = ['#side', '.cv .notes', '.cv .code', '.cvw .nav'].map((selector) => document.querySelector(selector).getBoundingClientRect());
    const paper = getComputedStyle(document.querySelector('.paper'));
    return { margin: paper.marginRight, over: side.left < notes.right && side.right > notes.left && side.top < notes.bottom, codeFree: code.right <= side.left + 1, controlFree: control.bottom <= side.top, codeWidth: Math.round(code.width) };
  });
  check('beside code with notes the comments window lies over the notes column: it takes no room, covers no code, and leaves the control of the files free',
    overNotes.margin === '0px' && overNotes.over && overNotes.codeFree && overNotes.controlFree && overNotes.codeWidth > 600, JSON.stringify(overNotes));
  await page.click('#side [data-fold]'); // folded, the notes are under the pointer again
  await page.$eval('.cv .mc', (el) => el.scrollIntoView({ block: 'center' })); // away from the control of the files at the top
  await settle();
  const noteStuck = await stickAt(await page.$eval('.cv .mc', (el) => { const box = el.querySelector('.t').getBoundingClientRect(); return { x: box.left + 30, y: box.top + box.height / 2 }; }));
  await closeBox();
  await page.click('#side [data-unfold]');
  check('the window of the tests stays under the comment pointer, and a test in it has the outline and holds the comment; a note beside the code has the outline and holds the comment',
    !!testRow && testStuck.outline.join() === testRow.key && /^Test test_\w+, \w+\.py$/.test(testStuck.where) && noteStuck.outline.length === 1 && /^note:/.test(noteStuck.outline[0]) && /^Note "/.test(noteStuck.where),
    JSON.stringify({ testStuck, noteStuck }));

  // The quick comment: Enter after the key, with no click, sticks the box on the whole of what the page shows.
  const quickBox = async () => {
    await settle();
    await page.keyboard.press('Meta+Shift+Period');
    await page.keyboard.press('Enter');
    const opened = await page.waitForSelector(`${boxField}:focus`, { timeout: 3000 }).then(() => true, () => false);
    const where = opened ? await page.textContent('.cbox .where') : '';
    await closeBox();
    return where;
  };
  const quick = {};
  await diagramView({ level: 'change' });
  quick.change = await quickBox();
  await diagramView({ level: 'part', part: 'hold-service', diagram: 'offer-flow' });
  quick.part = await quickBox();
  await showCode('src/library/lending/hold_service.py', [245, 245]);
  quick.file = await quickBox();
  check('Enter after the comment key, with no click, sticks the box on the whole view: the diagram of the change, the diagram of a part, and the file of the code view',
    quick.change === 'Diagram "Adds holds for books that are out"' && quick.part === 'Diagram "How one night run offers returned copies"' && /^File hold_service\.py \(.+\), part "Hold service"$/.test(quick.file), JSON.stringify(quick));

  // A click on a card, with another view shown in between, goes to the view of its thing and lights exactly that thing; the pointer on a card lights it quietly.
  const lightsAfter = async (text, between) => {
    await between();
    await card(text).locator('.tx').first().click();
    await page.waitForFunction(() => document.querySelector('.paper .flash'), null, { timeout: 3000 }).catch(() => {});
    return { text, flashed: (await flashed()).join(), crumb: await page.textContent('#crumb'), view: await page.evaluate(() => App.state.view) };
  };
  const toDiffs = () => drawn(() => page.click('.switch a[data-view="diffs"]'));
  const toTheChange = () => diagramView({ level: 'change' });
  const lights = [];
  for (const [text, between] of [['Why do the routes call the service directly?', toDiffs], ['Which five files are these?', toDiffs], ['What does open mean here?', toDiffs],
    ['Are the rows locked?', toTheChange], ['Who can pause it?', toTheChange], ['Why does the night job change?', toTheChange], ['Who may renew?', toTheChange]]) {
    const one = await lightsAfter(text, between);
    lights.push({ ...one, ok: one.flashed === (stuckOn[text]?.key ?? 'node:member-areas:renew') });
  }
  const broad = lights.at(-1);
  await shot('42-card-lights-its-node-in-a-large-diagram');
  await card('Who may renew?').hover();
  const nearLit = await page.evaluate(() => [...new Set([...document.querySelectorAll('.paper .near')].map((el) => el.dataset.rk))].join());
  check('a click on a card after another view goes to the view of its thing and lights exactly that thing (an arrow, "5 more files", a node, a message, a transition, a file on "Diffs"), a node of a wider diagram in that diagram large; the pointer on a card lights its thing quietly',
    lights.every((one) => one.ok) && /The areas of the member page$/.test(broad.crumb) && nearLit === 'node:member-areas:renew',
    `${JSON.stringify(lights.map(({ text, ok, flashed: lit, view: shown }) => (ok ? text : { text, lit, shown })))}; near ${nearLit}`);
  // In a narrow page a click on a card folds the window away under the pointer: the quiet light must go out when the pointer moves on.
  await page.setViewportSize({ width: 700, height: 1000 });
  await settle();
  await page.click('#side [data-unfold]');
  await card('Who may renew?').hover();
  const litOnCard = await page.$$eval('.paper .near', (els) => els.length);
  await card('Who may renew?').locator('.tx').first().click();
  await page.mouse.move(200, 700, { steps: 4 });
  await page.waitForFunction(() => !document.querySelector('.paper .near'), null, { timeout: 2000 }).catch(() => {});
  const litAfter = await page.$$eval('.paper .near', (els) => els.length);
  check('the quiet light of a card goes out when the window folds away under the pointer and the pointer moves on', litOnCard > 0 && litAfter === 0, `${litOnCard} then ${litAfter}`);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await settle();

  // A thing that is gone: the card says so in quiet text, and its click points to the part.
  await drawn(() => page.evaluate(() => {
    App.page.remarks.push({ id: 98, changeId: 0, target: { kind: 'node', diagram: 'offer-flow', node: 'removed-step', part: 'hold-service', label: 'Node "A removed step", diagram "How one night run offers returned copies"' }, text: 'Is this step still needed?', createdAt: new Date().toISOString(), state: 'open' });
    return App.render();
  }));
  const goneText = await card('Is this step still needed?').locator('.where').textContent().catch(() => '');
  const goneLit = await lightsAfter('Is this step still needed?', toDiffs);
  check('a card whose thing is gone says "no longer in the diagram" in quiet text, and its click lights the part',
    /· no longer in the diagram$/.test(goneText) && goneLit.flashed === 'part:hold-service', `${goneText}; ${JSON.stringify(goneLit)}`);

  // The line from a card to its thing: the pointer on a card draws one that ends at the box of its node, and it goes when the pointer leaves;
  // a card whose thing is not on the page has none.
  await diagramView({ level: 'broad', diagram: 'member-areas' });
  await card('Who may renew?').hover();
  const line = await page.evaluate(() => {
    const dot = document.querySelector('.remark-line circle');
    const node = document.querySelector('.paper [data-rk="node:member-areas:renew"]')?.getBoundingClientRect();
    return dot && node ? { x: +dot.getAttribute('cx'), y: +dot.getAttribute('cy'), node: { left: node.left, right: node.right, top: node.top, bottom: node.bottom } } : null;
  });
  const inside = (v, from, to) => v >= from - 1 && v <= to + 1;
  await page.mouse.move(2, 2);
  const lineAway = await page.$$eval('.remark-line', (els) => els.length);
  await card('Is this step still needed?').hover();
  const lineOfGone = await page.$$eval('.remark-line', (els) => els.length);
  check('the pointer on a card draws a line that ends at the box of its node, it goes when the pointer leaves, and a card whose thing is not on the page has none',
    !!line && inside(line.x, line.node.left, line.node.right) && inside(line.y,line.node.top, line.node.bottom) && lineAway === 0 && lineOfGone === 0, `${JSON.stringify(line)}; ${lineAway}, ${lineOfGone}`);
  await card('Who may renew?').hover();
  await shot('43-line-from-a-card-to-its-node');
  await page.mouse.move(2, 2);

  // A comment keeps the title of its thing: a node whose id now names another thing, and one that is gone, show the title that they had.
  await drawn(() => page.evaluate(() => {
    const kept = { title: 'Check the hold', diagram: 'How one night run offers returned copies' };
    App.page.remarks.push({ id: 97, changeId: 0, target: { kind: 'node', diagram: 'offer-flow', node: 's21', part: 'hold-service', label: 'Node "s21"', kept }, text: 'Why only after a retry?', createdAt: new Date().toISOString(), state: 'open' });
    // The answer of a run names the files that it changed, from Git.
    App.page.remarks.push({ id: 96, changeId: 0, target: { kind: 'part', part: 'hold-service', label: 'Part "Hold service"' }, text: 'Rename the helper', createdAt: new Date().toISOString(), state: 'done', answer: 'I renamed it.', answeredAt: new Date().toISOString(), changed: ['src/library/lending/hold_service.py', 'tests/test_holds.py'] });
    return App.render();
  }));
  const titleKept = await card('Why only after a retry?').locator('.where').textContent();
  const changedLine = await card('Rename the helper').locator('.changed').textContent();
  await card('Rename the helper').locator('.changed a').first().click();
  const opened = (await page.evaluate(() => window.apostilSent.filter((message) => message.type === 'openFile'))).at(-1);
  check('a thread whose thing is gone shows the title that it kept, and under an answer one quiet line names the files that the run changed, each a link that opens the file',
    /^Node "Check the hold" · no longer in the diagram$/.test(titleKept) && changedLine === 'changed: hold_service.py, test_holds.py' && opened?.path === 'src/library/lending/hold_service.py', `${titleKept}; ${changedLine}; ${JSON.stringify(opened)}`);
  await shot('44-answer-with-its-changed-files');
} catch (error) {
  check('the checks ran to the end', false, error.message.split('\n').slice(0, 14).join(' / '));
}
await finish();
