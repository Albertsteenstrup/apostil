// The browser check of the comments on the change page: the marks at their places, the card that a mark opens, the picker of where a comment goes,
// "@" and the agents, the states of a thread, the list from the count in the top bar, a comment on any component of a diagram, a file and "Diffs",
// and a click on a row of the list that goes to its thing and opens its card there.
// A group of view/browser-check.mjs, which runs every group at the same time; alone:
//   node view/browser/comments.mjs [--pictures] [<folder for pictures>]

import { check, errors, finish, newPage, pageFile, takePicture } from './tools.mjs';

const page = await newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

const shot = (name) => takePicture(page, `${name}.png`);
const changeSection = '.sec[data-section="change"]';
const service = `${changeSection} b[data-part="hold-service"]`;
const partTitle = (part) => `${changeSection} b[data-part="${part}"]`;
// Waits until the page is still: two frames, the drawing that runs, and one frame more.
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

const theCard = '.cbox.card';
const sentRemarks = () => page.evaluate(() => window.apostilSent.filter((message) => message.type === 'remark'));
const box = (selector) => page.$eval(selector, (el) => { const { left, right, top, bottom, width } = el.getBoundingClientRect(); return { left, right, top, bottom, width }; });
const boxField = '.cbox [data-field="new"]';
const isIcon = () => page.evaluate(() => /url/.test(getComputedStyle(document.querySelector('#view')).cursor)); // the pointer is the comment icon
// The full name of the thing of the open card: its head shows it short, its tooltip in full.
const cardWhere = () => page.$eval(`${theCard} .ch .where`, (el) => el.title + (el.querySelector('.gone-place')?.textContent ?? '')).catch(() => '');
// The card is gone: closed or discarded.
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
// Opens the card of the mark of a thing.
const openMark = async (selector) => { await page.click(`${selector} .cb`); await page.waitForSelector(theCard, { timeout: 3000 }); };
const closeCard = async () => { await page.keyboard.press('Escape'); await noBox(); };
// True when two rectangles do not overlap.
const apart = (a, b) => a.right <= b.left + 1 || a.left >= b.right - 1 || a.bottom <= b.top + 1 || a.top >= b.bottom - 1;
// What the card shows: its messages (who and on which side), its state line and its picker.
const cardNow = () => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const own = el.getBoundingClientRect();
  return {
    messages: [...el.querySelectorAll('.cth .msg')].map((msg) => {
      const at = msg.getBoundingClientRect();
      return `${msg.classList.contains('mine') ? 'mine' : 'agent'}:${msg.classList.contains('mine') ? (own.right - at.right < 20 ? 'right' : 'left') : (at.left - own.left < 20 ? 'left' : 'right')}:${msg.querySelector('.who')?.textContent ?? ''}:${msg.querySelector('.av img')?.getAttribute('src') ?? ''}:${msg.title ? 'tip' : ''}`;
    }),
    state: el.querySelector('.st')?.textContent.trim() ?? '', picker: el.querySelector('.pick')?.textContent.trim() ?? '', run: el.querySelector('.prun')?.textContent.trim() ?? '',
    tools: [...el.querySelectorAll('.ch .tl')].map((tool) => tool.title).join(), animations: el.getAnimations().length,
  };
}, theCard);

try {
  await page.goto(`file://${pageFile}`);
  await loaded();

  // ----- the marks: each thing with an open thread has a chat bubble with the icon of its agent, in the state of its thread -----
  const pointCount = await page.evaluate(() => App.page.openPoints.length);
  const marks = await page.evaluate((section) => {
    const markOf = (part) => document.querySelector(`${section} b[data-part="${part}"] .cb`);
    const partOf = (id) => App.page.remarks.find((remark) => remark.id === id).target.part;
    const stateOf = (id) => {
      const el = markOf(partOf(id));
      return el ? `${[...el.classList].filter((name) => name !== 'cb').join(' ')}${el.querySelector('img') ? ` ${el.querySelector('img').getAttribute('src')}` : ''}` : 'none';
    };
    const view = document.getElementById('view').getBoundingClientRect();
    const working = markOf(partOf(3));
    return {
      viewRight: Math.round(view.right), width: innerWidth,
      circles: document.querySelectorAll('.rk').length,
      // 1 a note to no agent, 2 sent and waiting, 3 working, 4 answered, 5 resolved
      states: [1, 2, 3, 4, 5].map(stateOf), still: working && getComputedStyle(working, '::after').animationName,
      answeredFill: getComputedStyle(markOf(partOf(4)).querySelector('path')).fill, tealsoft: getComputedStyle(document.body).getPropertyValue('--tealsoft').trim(),
    };
  }, changeSection);
  // Two open threads on one thing share one bubble with a count.
  await drawn(() => page.evaluate(() => {
    App.page.remarks.push({ id: 90, changeId: 0, target: App.page.remarks.find((remark) => remark.id === 2).target, text: 'A second thread here.', createdAt: new Date().toISOString(), state: 'open' });
    App.render();
  }));
  const shared = await page.evaluate((section) => {
    const target = App.page.remarks.find((remark) => remark.id === 2).target.part;
    const all = document.querySelectorAll(`${section} b[data-part="${target}"] .cb`);
    return { bubbles: all.length, count: all[0]?.querySelector('.n')?.textContent, threads: all[0]?.dataset.threads };
  }, changeSection);
  await drawn(() => page.evaluate(() => { App.page.remarks = App.page.remarks.filter((remark) => remark.id !== 90); App.render(); }));
  check('the page takes the full width; each part with an open thread has a chat bubble with the icon of its agent in place of the circle: empty for a note, the icon faint while it waits, a still teal dot while it works, tinted when answered; a resolved thread has no mark, and two threads on one thing share one bubble with a count',
    marks.viewRight > marks.width - 40 && marks.circles === 0
      && JSON.stringify(marks.states) === JSON.stringify(['note', 'waiting agents/claude-code.svg', 'working agents/claude-code.svg', 'answered agents/claude-code.svg', 'none'])
      && marks.still === 'none' && marks.answeredFill !== 'rgb(255, 255, 255)' && !!marks.tealsoft && shared.bubbles === 1 && shared.count === '2' && shared.threads === '2 90',
    JSON.stringify({ marks, shared }));

  // The marks in the dark theme, for a person to look at.
  if (process.argv.includes('--pictures')) {
    await page.evaluate(() => { document.body.classList.add('vscode-dark'); document.documentElement.style.setProperty('--vscode-editor-background', '#1e1e1e'); });
    await shot('16-marks-in-the-dark-theme');
    await page.evaluate(() => { document.body.classList.remove('vscode-dark'); document.documentElement.style.removeProperty('--vscode-editor-background'); });
  }

  // ----- the card: a click on a mark opens it beside its thing, with the thread as a small chat, the state line and the picker -----
  const answered = partTitle('desk-screen');
  await openMark(answered);
  const opened = await cardNow();
  const beside = apart(await box(theCard), await page.$eval(answered, (el) => el.closest('g.node, g.cluster').getBoundingClientRect().toJSON()));
  const seen = await page.$eval(`${answered} .cb`, (el) => el.className);
  await shot('10-card-on-a-diagram');
  await page.keyboard.press('Escape');
  const afterEsc = await page.$$eval(theCard, (all) => all.length);
  await openMark(answered);
  await page.mouse.click(30, 860);
  const afterOutside = await page.$$eval(theCard, (all) => all.length);
  // A reply in the box belongs to the thread, and the card stays open on it.
  await openMark(answered);
  await page.click(`${theCard} .cbx [data-field]`);
  await page.keyboard.type('Good, thanks.');
  await drawn(() => page.keyboard.press('Enter'));
  const reply = (await sentRemarks()).pop();
  const replied = { open: await page.$$eval(theCard, (all) => all.length), last: await page.$$eval(`${theCard} .cth .msg .tx`, (all) => all.at(-1)?.textContent) };
  await closeCard();
  check('a click on the bubble opens the card beside its part, not over it: ✓ ✕ in its head; his own words at the right, the agent at the left with its icon and name, the exact time as a tooltip; the state line and the picker, with the model and the effort that the session last used on their own line; it marks the answer read; Escape and a click outside close it; a reply belongs to its thread and the card stays open',
    beside && opened.tools === 'Resolve,Close' && opened.state === 'answered · session' && opened.picker === 'Send to Claude Code · this session' && opened.run === 'Opus 5.5 · Extra'
      && JSON.stringify(opened.messages) === JSON.stringify(['mine:right:::tip', 'agent:left:Claude Code:agents/claude-code.svg:tip', 'mine:right:::tip', 'agent:left:Claude Code:agents/claude-code.svg:tip'])
      && /\bseen\b/.test(seen) && afterEsc === 0 && afterOutside === 0 && reply?.thread === 4 && reply.text === 'Good, thanks.' && replied.open === 1 && replied.last === 'Good, thanks.',
    JSON.stringify({ beside, opened, seen, afterEsc, afterOutside, reply, replied }));

  // ----- the comment key and a new card -----
  // With no comment and no open point there is no count in the top bar; the first comment, written in the card, brings it.
  let kept;
  await drawn(async () => { kept = await page.evaluate(() => { const before = { remarks: App.page.remarks, openPoints: App.page.openPoints }; Object.assign(App.page, { remarks: [], openPoints: [] }); App.render(); return before; }); });
  const noCountEmpty = await page.$$eval('[data-comments]', (all) => all.length) === 0;
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

  // The click after the key opens the same card, empty, beside the thing, with the cursor in its box. The picker under it says where the comment goes.
  await keyOn(service);
  const fresh = { where: await cardWhere(), threads: await page.$$eval(`${theCard} .cth`, (all) => all.length), cursor: await page.evaluate(() => getComputedStyle(document.querySelector('#view')).cursor) };
  fresh.beside = apart(await box(theCard), await page.$eval(service, (el) => el.closest('g.node, g.cluster').getBoundingClientRect().toJSON()));
  await page.click(`${theCard} .pick`);
  const menu = await page.$$eval(`${theCard} .pmenu > *`, (rows) => rows.map((row) => row.innerText.replace(/\s+/g, ' ').replace(/used \d+ min ago/, 'used n min ago').trim()).filter(Boolean)); // the example data is written a few minutes before
  await shot('11-picker-of-a-new-comment');
  // A click elsewhere closes the menu and does nothing else: the card stays; the menu opens again for the choice below.
  await page.mouse.click(5, 300);
  const menuGone = { menus: await page.$$eval(`${theCard} .pmenu`, (all) => all.length), cards: await page.$$eval(theCard, (all) => all.length) };
  await page.click(`${theCard} .pick`);
  await page.click(`${theCard} .pi[data-choice="claude-code:session:made-up-session-0002"]`, { timeout: 3000 }).catch(() => {}); // a missing choice fails the check below, not the run
  const pickedWords = await page.textContent(`${theCard} .pick`);
  await page.keyboard.type('Why is the pickup day set before the mail is sent?');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.cbox.card .cth .msg.mine'), null, { timeout: 3000 }).catch(() => {});
  const toSession = (await sentRemarks()).pop();
  const afterSend = { ...(await cardNow()), mark: await page.$eval(`${service} .cb`, (el) => el.className).catch(() => ''), count: await page.textContent('[data-comments] .n').catch(() => '') };
  await closeCard();
  check('a click outside the open menu of the picker closes it and does nothing else: the card stays open',
    menuGone.menus === 0 && menuGone.cards === 1, JSON.stringify(menuGone));
  check('a new comment opens the same card, empty, beside its thing, with the cursor in its box; the picker lists the connected apps side by side, the models and efforts of the chosen app, its sessions (this session, a new session, the newest 5 known sessions of the folder and "Show 2 more"), then "No agent"; the choice sends it there with the effort and no model, and the card stays open on its thread with no flight while the mark and the count show',
    fresh.where === 'Part "Hold service"' && fresh.threads === 0 && !/url/.test(fresh.cursor) && fresh.beside
      && JSON.stringify(menu) === JSON.stringify(['Claude Code Codex OpenCode', 'Model Haiku 5.5 Sonnet 5.5 Opus 5.5 Fable 5.2 Effort Low Medium High Extra Max', 'Session', 'This session made this change', 'New session', 'Tests for holds used n min ago',
        'Move the pickup day after the mail is sent and check the notices of the ready shelf used n min ago', 'Review the member page used 2 hours ago', 'Split the hold service used 4 hours ago', 'Night jobs at the right hour used 5 hours ago', 'Show 2 more', 'No agent: keep it as a note'])
      && pickedWords.trim() === 'Send to Claude Code · "Tests for holds"' && JSON.stringify(toSession?.to) === JSON.stringify({ app: 'claude-code', kind: 'session', session: 'made-up-session-0002', name: 'Tests for holds', effort: 'medium' })
      && toSession.target.part === 'hold-service' && JSON.stringify(afterSend.messages) === JSON.stringify(['mine:right:::tip']) && afterSend.state === 'waiting for Claude Code · "Tests for holds" · Start a run · Sonnet 5.5 · Medium' && afterSend.animations === 0
      && /\bwaiting\b/.test(afterSend.mark) && afterSend.count === '1' && noCountEmpty,
    JSON.stringify({ fresh, menu, pickedWords, to: toSession?.to, afterSend, noCountEmpty }));
  await page.evaluate(() => { App.page.remarks = []; App.render(); });
  await settle();

  // ----- the picker menu: an app, then its model and effort, then its sessions -----
  const runLine = () => page.textContent(`${theCard} .prun .rp`).then((text) => text.trim()).catch(() => '');
  const runMenu = () => page.$$eval(`${theCard} .rmenu :is(.ph, .pi, .chip)`, (rows) => rows.map((row) => `${row.textContent.trim()}${row.classList.contains('on') ? ' ✓' : ''}`).filter(Boolean)).catch(() => []);
  const choose = async (selector) => { await page.click(`${theCard} ${selector}`, { timeout: 3000 }).catch(() => {}); };
  await keyOn(service);
  await choose('.pick');
  const tabs = { chosen: await page.$$eval(`${theCard} .ptab.on`, (all) => all.map((tab) => tab.textContent.trim())) };
  const longRow = `${theCard} .pi[data-choice="claude-code:session:made-up-session-0100"]`;
  tabs.cut = await page.$eval(`${longRow} span`, (el) => el.scrollWidth > el.clientWidth).catch(() => false);
  await page.hover(longRow).catch(() => {});
  await page.waitForSelector('body > .win', { timeout: 3000 }).catch(() => {});
  tabs.hover = await page.$eval('body > .win', (win) => win.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
  await page.mouse.move(5, 5);
  await choose('[data-more-sessions]');
  tabs.all = await page.$$eval(`${theCard} .pmenu .pi[data-choice*=":session:"]`, (all) => all.length);
  await choose('[data-menu-app="codex"]');
  tabs.codex = { open: await page.$$eval(`${theCard} .pmenu:not(.rmenu)`, (all) => all.length), on: await page.textContent(`${theCard} .ptab.on`).then((text) => text.trim()), models: await page.$$eval(`${theCard} [data-rpick-in] [data-rp-model]`, (all) => all.map((chip) => chip.textContent)), picker: (await page.textContent(`${theCard} .pick`)).trim() };
  await choose('[data-rpick-in] [data-rp-model="gpt-6.1-sol"]');
  await choose('[data-rpick-in] [data-rp-effort="ultra"]');
  tabs.run = await runLine();
  tabs.stillOpen = await page.$$eval(`${theCard} .pmenu:not(.rmenu)`, (all) => all.length);
  await choose('[data-menu-app="claude-code"]'); // the next card starts at Claude Code again
  await page.mouse.click(5, 300); // closes the menu
  await closeCard();
  check('the menu of the picker: a click on an app picks it alone (a new session when it has no session of the change) and the menu stays open on its models; a click on a model or an effort there sets the run under the picker; a long session name is cut, and the pointer on it shows the whole name, its folder and when it was last active; "Show 2 more" shows all its sessions',
    tabs.chosen.join() === 'Claude Code' && tabs.cut && /^Move the pickup day after the mail is sent and check the notices of the ready shelf .+ Last active \d/.test(tabs.hover) && tabs.all === 7
      && tabs.codex.open === 1 && tabs.codex.on === 'Codex' && tabs.codex.models.includes('Sol 6.1') && tabs.codex.picker === 'Send to Codex · new session' && /^Sol 6\.1 · Ultra/.test(tabs.run) && tabs.stillOpen === 1,
    JSON.stringify(tabs));

  // ----- the model and the effort of a run: one quiet line under the picker, and its small menu -----
  await keyOn(service);
  await choose('.pick');
  await choose('.pi[data-choice="claude-code:new"]');
  const model = { fresh: await runLine() };
  await choose('.prun [data-rp-open]');
  model.menu = await runMenu();
  await shot('81-the-menu-of-the-model-of-claude-code');
  await choose('[data-rp-model="opus"]');
  await choose('[data-rp-effort="max"]');
  model.open = await page.$$eval(`${theCard} .rmenu`, (all) => all.length); // one click sets it, and the menu stays open
  model.chosen = await runLine();
  await page.keyboard.press('Escape'); // Escape closes the menu, and the card stays
  model.afterEscape = { menu: await page.$$eval(`${theCard} .rmenu`, (all) => all.length), card: await page.$$eval(theCard, (all) => all.length) };
  await page.click(boxField);
  await page.keyboard.type('Check the late fee.');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.cbox.card .cth .msg.mine'), null, { timeout: 3000 }).catch(() => {});
  model.sent = (await sentRemarks()).pop()?.to;
  await closeCard();
  // Codex: Luna takes no Ultra, Sol takes it; a model with no Ultra takes the nearest lower effort.
  await keyOn(service);
  await choose('.pick');
  await choose('[data-menu-app="codex"]');
  await choose('.pi[data-choice="codex:new"]');
  await choose('.prun [data-rp-open]');
  model.luna = (await runMenu()).filter((row) => /^(Low|Medium|High|Extra high|Max|Ultra)/.test(row));
  await shot('81-the-menu-of-the-model-of-codex');
  await choose('[data-rp-model="gpt-6.1-sol"]');
  model.sol = (await runMenu()).filter((row) => /^(Low|Medium|High|Extra high|Max|Ultra)/.test(row));
  await choose('[data-rp-effort="ultra"]');
  await choose('[data-rp-model="gpt-6-luna"]');
  model.back = await runLine();
  if (process.argv.includes('--pictures')) {
    await page.setViewportSize({ width: 370, height: 800 });
    await choose('[data-rp-model="gpt-6.1-sol"]');
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await shot('81-the-menu-at-370-px');
    await page.evaluate(() => { document.body.classList.add('vscode-dark'); document.documentElement.style.setProperty('--vscode-editor-background', '#1e1e1e'); });
    await shot('81-the-menu-in-the-dark-theme');
    await page.evaluate(() => { document.body.classList.remove('vscode-dark'); document.documentElement.style.removeProperty('--vscode-editor-background'); });
    await page.setViewportSize({ width: 1400, height: 900 });
  }
  await page.keyboard.press('Escape');
  await closeCard();
  await page.evaluate(() => { App.page.remarks = []; App.render(); });
  await settle();
  const EFFORTS = ['Low', 'Medium', 'High', 'Extra high', 'Max'];
  check('under the picker one quiet line says the model and the effort of the run, "Sonnet 5.5 · Medium" for a new Claude Code session with no setting (the lead of a map run); its menu lists the newest model of each family, the one in use ticked, then the efforts of that model; one click sets each and the menu stays open until Escape, which leaves the card; a choice of Opus 5.5 and Max sends both; a Codex session on Luna offers no Ultra, Sol offers it, and Luna again takes Max',
    model.fresh === 'Sonnet 5.5 · Medium'
      && JSON.stringify(model.menu) === JSON.stringify(['Model', 'Haiku 5.5', 'Sonnet 5.5 ✓', 'Opus 5.5', 'Fable 5.2', 'Effort', 'Low', 'Medium ✓', 'High', 'Extra', 'Max'])
      && model.open === 1 && model.chosen === 'Opus 5.5 · Max' && model.afterEscape.menu === 0 && model.afterEscape.card === 1
      && JSON.stringify(model.sent) === JSON.stringify({ app: 'claude-code', kind: 'new', model: 'opus', effort: 'max' })
      && JSON.stringify(model.luna) === JSON.stringify(['Low', 'Medium', 'High ✓', ...EFFORTS.slice(3)]) && JSON.stringify(model.sol) === JSON.stringify(['Low', 'Medium', 'High ✓', ...EFFORTS.slice(3), 'Ultra'])
      && model.back === 'Luna 6 · Max',
    JSON.stringify(model));

  // VS Code passes the key press on late, after the click and the first words; it shows the page first, which takes the keyboard out of the field for
  // a moment. Every word typed after it must still go into the field.
  await keyOn(service);
  await page.keyboard.type('Who ');
  await page.evaluate(() => { document.activeElement.blur(); Remarks.openFromVsCode(); });
  await page.keyboard.type('reads this?');
  const lateCopy = await page.evaluate(() => ({ typed: document.querySelector('.cbox [data-field="new"]').innerText.trim(), inField: document.activeElement?.matches('.cbox [data-field="new"]') }));
  check('a late copy of the comment key from VS Code, after the box opened and the keyboard left it, puts the keyboard back in the field, so no typed word is lost',
    lateCopy.typed === 'Who reads this?' && lateCopy.inField, JSON.stringify(lateCopy));
  await page.evaluate(() => { const field = document.querySelector('.cbox [data-field="new"]'); field.textContent = ''; field.focus(); });
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
  await drawn(() => page.evaluate((before) => { Object.assign(App.page, before); App.render(); }, kept));

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
      && mention.movedLit === 'claude-new' && mention.movedGhost === 'aude-new' && mention.written.text === '@claude-current' && mention.written.color === 'rgb(11, 95, 88)' && mention.written.after === ' ' && !mention.written.list,
    JSON.stringify(mention));
  await page.keyboard.type('please');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Thanks.');
  const twoLines = await page.$eval(boxField, (field) => field.innerText.includes('\n'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.cbox.card .cth'), null, { timeout: 3000 }).catch(() => {});
  const sent = (await sentRemarks()).pop();
  const sentState = (await cardNow())?.state ?? '';
  await closeCard();
  check('Shift+Enter makes a new line; the comment with @claude-current is sent to that session; as a file in a browser nothing can run, so it waits, with "Start a run"',
    twoLines && sent?.to?.app === 'claude-code' && sent.to.kind === 'current' && /^Log the opening hours that the run used\. @claude-current please\s+Thanks\.$/.test(sent.text)
      && /^waiting for Claude Code · this session · Start a run · Opus 5\.5 · Extra$/.test(sentState.trim()), `${JSON.stringify(sent?.text)}; ${sentState}`);

  // ----- the states of a thread -----
  await openMark(partTitle('night-job'));
  const states = {
    pulse: await page.locator(`${theCard} .st .dot.pulse`).evaluate((dot) => getComputedStyle(dot).animationName).catch(() => ''),
    running: (await page.textContent(`${theCard} .st`).catch(() => '')).trim(), links: await page.locator(`${theCard} .st [data-session]`).count(),
    exact: await page.getAttribute(`${theCard} .st .ago`, 'title').catch(() => ''),
  };
  // The working line starts at the left edge of the card's text (only under an agent's answer does it stand in, under the answer); the head is the handle that moves the card.
  const handle = await page.evaluate(() => {
    const el = document.querySelector('.cbox.card');
    const head = el.querySelector('.ch').getBoundingClientRect();
    return { indent: Math.round(el.querySelector('.st').getBoundingClientRect().left - head.left), cursor: getComputedStyle(el.querySelector('.ch')).cursor, x: head.left + 20, y: head.top + head.height / 2, left: el.getBoundingClientRect().left, top: el.getBoundingClientRect().top };
  });
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x - 60, handle.y + 40, { steps: 4 });
  await page.mouse.up();
  const dragged = await page.evaluate(() => document.querySelector('.cbox.card').getBoundingClientRect());
  check('the working line of a comment starts at the left edge of the card\'s text; the head of the card has the grab pointer and no icon for it, and a drag there moves the card with the pointer',
    Math.abs(handle.indent) <= 3 && handle.cursor === 'grab' && Math.round(dragged.left - handle.left) === -60 && Math.round(dragged.top - handle.top) === 40, JSON.stringify({ handle, moved: [dragged.left - handle.left, dragged.top - handle.top] }));
  await page.click(`${theCard} .st [data-session]`);
  states.opened = await page.evaluate(() => window.apostilSent.filter((message) => message.type === 'openSession').pop()?.id);
  await closeCard();
  states.answered = opened.state; // before the reply above went to the agent again
  check('a running thread shows the pulsing dot, "Claude Code · this session is working" in the words of the picker, how long as a relative time with the exact time in its tooltip, and the session link; a click on "session" asks VS Code to open the session of that comment, and an answered thread keeps its session link',
    states.pulse === 'pulse' && /^Claude Code · this session is working · \d+ min · session$/.test(states.running) && /\d:\d\d/.test(states.exact) && states.links === 1 && states.opened === 3 && states.answered === 'answered · session', JSON.stringify(states));

  // A comment to a new session that works: the words "new session" are the link to its session, in place of "· session".
  await drawn(() => page.evaluate(() => {
    App.page.remarks.push({ id: 97, changeId: 0, target: { kind: 'part', part: 'night-job', label: 'Part "Night job"' }, text: 'Add a test', createdAt: new Date().toISOString(), state: 'running', to: { app: 'claude-code', kind: 'new' }, run: { session: 'made-up-new-0001', startedAt: new Date().toISOString() } });
    App.render();
  }));
  await openMark(partTitle('night-job'));
  const newLine = page.locator(`${theCard} .st`, { hasText: 'new session' });
  const newSession = { text: (await newLine.textContent().catch(() => '')).trim(), link: await newLine.locator('a[data-session]').textContent().catch(() => '') };
  await newLine.locator('a[data-session]').click({ timeout: 3000 }).catch(() => {});
  newSession.opened = await page.evaluate(() => window.apostilSent.filter((message) => message.type === 'openSession').pop()?.id);
  await closeCard();
  await drawn(() => page.evaluate(() => { App.page.remarks = App.page.remarks.filter((remark) => remark.id !== 97); App.render(); }));
  check('a comment to a new session that works has "new session" as the link to its session, with no "· session" after it; a click asks VS Code to open that session',
    /^Claude Code · new session is working · [^·]+$/.test(newSession.text) && newSession.link === 'new session' && newSession.opened === 97, JSON.stringify(newSession));

  // A comment to a new session in a card that stays open: once the session has its id and its answer, the picker of the reply follows from "new session"
  // to that session by its name, the answered line names it with the name as its link, and the reply goes on in that session.
  const answeredBy = 'a0ce2976-1b2c-4d5e-8f90-123456789abc';
  await drawn(() => page.evaluate(() => {
    App.page.remarks.push({ id: 98, changeId: 0, target: { kind: 'part', part: 'night-job', label: 'Part "Night job"' }, text: 'Make gemini the same', createdAt: new Date().toISOString(), state: 'sent', to: { app: 'claude-code', kind: 'new' } });
    App.render();
  }));
  await openMark(partTitle('night-job'));
  const thread = { before: (await cardNow())?.picker };
  await drawn(() => page.evaluate((session) => {
    Object.assign(App.page.remarks.find((remark) => remark.id === 98), { state: 'done', answer: 'Done.', answeredAt: new Date().toISOString(), run: { session, startedAt: new Date().toISOString(), name: 'Fix the team' } });
    App.render();
  }, answeredBy));
  const line = page.locator(`${theCard} .cth[data-thread="98"] .st`);
  Object.assign(thread, { picker: (await cardNow())?.picker, line: (await line.textContent().catch(() => '')).trim(), link: await line.locator('a[data-session]').textContent().catch(() => '') });
  await page.click(`${theCard} [data-field="98"]`);
  await page.keyboard.type('And codex too.');
  await page.keyboard.press('Enter');
  thread.to = (await sentRemarks()).pop()?.to;
  await closeCard();
  await drawn(() => page.evaluate(() => { App.page.remarks = App.page.remarks.filter((remark) => remark.id !== 98 && remark.thread !== 98); App.render(); }));
  check('a reply in a thread whose comment a new session answered goes on in that session: the picker of the open card follows from "new session" to its name, the answered line names the session with the name as its link, and the reply is sent there',
    thread.before === 'Send to Claude Code · new session' && thread.picker === 'Send to Claude Code · "Fix the team"' && thread.line === 'answered by Claude Code · "Fix the team"' && thread.link === '"Fix the team"'
      && thread.to?.kind === 'session' && thread.to.session === answeredBy && thread.to.name === 'Fix the team', JSON.stringify(thread));

  // ----- the changed files of a run: a quiet block under the answer, at most three rows, then "n more"; a row opens the change of its file -----
  await drawn(() => page.evaluate(() => {
    App.page.remarks.push({ id: 96, changeId: 0, target: { kind: 'part', part: 'night-job', label: 'Part "Night job"' }, text: 'Rename the helper', createdAt: new Date().toISOString(), state: 'done', answer: 'I renamed it.', answeredAt: new Date().toISOString(),
      changed: ['src/library/lending/hold_service.py', 'tests/test_holds.py', 'src/library/night_jobs.py', 'src/library/tables.py', 'docs/holds.md'] });
    App.render();
  }));
  await openMark(answered);
  const two = await page.$$eval(`${theCard} .changed`, (all) => all.map((block) => [...block.children].filter((el) => !el.hidden).map((el) => el.textContent).join(' | ')));
  const mono = await page.$eval(`${theCard} .changed .cf`, (el) => getComputedStyle(el).fontFamily).catch(() => '');
  await closeCard();
  await openMark(partTitle('night-job'));
  const five = { before: await page.$eval(`${theCard} .changed`, (block) => [...block.children].filter((el) => !el.hidden).map((el) => el.textContent).join(' | ')) };
  await page.click(`${theCard} .changed [data-more-files]`, { timeout: 3000 }).catch(() => {});
  five.after = await page.$$eval(`${theCard} .changed .cf`, (all) => all.filter((el) => el.offsetParent).length);
  await drawn(() => page.click(`${theCard} .changed .cf[data-changed-file="tests/test_holds.py"]`));
  five.shown = await page.evaluate(() => ({ view: App.state.view, file: App.state.file, card: !!document.querySelector('.cbox.card') }));
  check('under an answer whose run changed files a quiet block says "Changed 2 files", one row in the mono font for each file, at most three, then "2 more"; a click on a row opens the change of that file',
    JSON.stringify(two) === JSON.stringify(['Changed 2 files | ReadyShelf.tsx | ReadyShelf.test.tsx']) && /mono|Menlo|monospace/i.test(mono)
      && five.before === 'Changed 5 files | hold_service.py | test_holds.py | night_jobs.py | 2 more' && five.after === 5
      && five.shown.view === 'code' && five.shown.file === 'tests/test_holds.py' && !five.shown.card,
    JSON.stringify({ two, mono, five }));
  await drawn(() => page.evaluate(() => { App.page.remarks = App.page.remarks.filter((remark) => remark.id !== 96); App.go({ level: 'change' }); }));

  // ----- the list from the count in the top bar: in the order of the page; "Open points n" and "n resolved"; Resolve, Reopen, and a reply on an open point -----
  const openList = async () => { await page.click('[data-comments]'); await page.waitForSelector('.cml', { timeout: 3000 }); };
  // The agent answers the reply of the card above; the newest thread stands on the first part of the page, so the list is not in the order of writing.
  await drawn(() => page.evaluate(() => {
    Object.assign(App.page.remarks.find((remark) => remark.text === 'Good, thanks.'), { state: 'done', answer: 'Glad it helps.', answeredAt: new Date().toISOString() });
    const first = App.page.parts[0];
    App.page.remarks.push({ id: 91, changeId: 0, target: { kind: 'part', part: first.id, label: `Part "${first.name}"` }, text: 'The newest thread, on the first part.', createdAt: new Date().toISOString(), state: 'open' });
    App.render();
  }));
  await openList();
  const listed1 = await page.evaluate(() => {
    const count = document.querySelector('[data-comments]');
    const switchBox = document.querySelector('.bar .switch').getBoundingClientRect();
    const rows = [...document.querySelectorAll('.cml .cmr[data-row]')];
    const partIndex = (row) => App.page.parts.findIndex((part) => part.id === App.page.remarks.find((remark) => remark.id === Number(row.dataset.row)).target.part);
    return {
      count: count.querySelector('.n').textContent, open: Marks.threadsOf(App.page.remarks).filter((thread) => thread.some((remark) => remark.state !== 'closed')).length, besideSwitch: Math.abs(count.getBoundingClientRect().left - switchBox.right) < 40,
      rows: rows.map((row) => `${row.querySelector('.cb') ? 'mark' : ''} | ${row.querySelector('b').innerText} | ${row.querySelector('.rx').textContent}`),
      inOrder: rows.map(partIndex).every((index, at, all) => !at || all[at - 1] <= index), bold: getComputedStyle(rows[0].querySelector('b')).fontWeight,
      foot: document.querySelector('.cml .foot')?.innerText.replace(/\s+/g, ' ').trim(),
    };
  });
  await shot('15-list-from-the-top-bar');
  await page.keyboard.press('Escape');
  const listEsc = await page.$$eval('.cml', (all) => all.length);
  await openList();
  await page.mouse.click(30, 860);
  const listOutside = await page.$$eval('.cml', (all) => all.length);
  // ✓ resolves a thread: its mark goes, and "n resolved" in the list shows it with Reopen.
  await openMark(answered);
  await drawn(() => page.click(`${theCard} [data-resolve]`));
  const resolved = { card: await page.$$eval(theCard, (all) => all.length), mark: await page.$$eval(`${answered} .cb`, (all) => all.length) };
  await openList();
  resolved.foot = await page.$eval('.cml .foot', (el) => el.innerText.replace(/\s+/g, ' ').trim());
  await page.click('.cml [data-show-resolved]');
  resolved.byAgent = await page.locator('.cml .cmr.gone', { hasText: 'Rename the column' }).locator('.state').textContent().catch(() => '');
  await drawn(() => page.locator('.cml .cmr.gone', { hasText: 'Is the shelf tested' }).locator('[data-reopen]').click());
  resolved.back = await page.$$eval(`${answered} .cb`, (all) => all.length);
  // "Open points n" shows the open points in the same list; a click on one shows its lines and opens a card on it, and a reply on it is tied to it.
  await page.click('.cml [data-show-points]');
  const pointRows = await page.$$eval('.cml .cmr.point', (all) => all.length);
  await page.locator('.cml .cmr.point', { hasText: 'The selected copies are locked.' }).click();
  await page.waitForSelector(`${boxField}:focus`, { timeout: 5000 }).catch(() => {});
  await settle();
  const onPointCard = { where: await cardWhere(), point: await page.textContent(`${theCard} .msg.point .tx`).catch(() => ''), lines: await page.$$eval('.cv .code .l.near', (all) => all.map((row) => row.dataset.line).join()) };
  await page.keyboard.type('How long is the lock?');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.cbox.card .cth'), null, { timeout: 3000 }).catch(() => {});
  const onPoint = (await sentRemarks()).pop();
  await closeCard();
  await drawn(() => page.evaluate(() => { App.page.remarks = App.page.remarks.filter((remark) => remark.id !== 91); App.render(); }));
  check('the count of open threads stands beside the switch of views and opens the list: a row for each thread in the order of the page, with its mark, its place in bold and its newest words (the answer of an agent after its name); Escape and a click outside close it; ✓ takes a thread and its mark away, "2 resolved" shows it with "Reopen", which brings it back; "Open points n" shows the points, and a click on one opens a card on its lines whose reply is tied to it',
    listed1.count === String(listed1.open) && listed1.open === 6 && listed1.besideSwitch && listed1.inOrder && Number(listed1.bold) >= 600 && listed1.rows.length === 6 && listed1.rows.every((row) => row.startsWith('mark | '))
      && listed1.rows.includes('mark | Desk screen | Claude Code: Glad it helps.') && listed1.foot === `Open points ${pointCount} 1 resolved` && listEsc === 0 && listOutside === 0
      && resolved.card === 0 && resolved.mark === 0 && resolved.foot === `Open points ${pointCount} 2 resolved` && resolved.byAgent === 'resolved by Claude Code' && resolved.back === 1
      && pointRows === pointCount && onPointCard.where === 'hold_service.py, line 230' && onPointCard.point.startsWith('The selected copies are locked.') && onPointCard.lines === '230'
      && onPoint?.target.kind === 'open-point' && typeof onPoint.point === 'number',
    JSON.stringify({ listed1, listEsc, listOutside, resolved, pointRows, onPointCard, onPoint: onPoint?.target }));

  // ----- code lines with a thread: the mark at the end of the text of their first line; a click opens the card beside the code, and the lines are tinted while it is open -----
  const first = 5;
  await showCode('src/library/night_jobs.py', [first, first]); // at these lines: a file with no lines asked for opens at its first change
  await drawn(() => page.evaluate((line) => {
    App.page.remarks.push({ id: 99, changeId: 0, target: { kind: 'lines', file: 'src/library/night_jobs.py', lines: [line, line + 1], label: `night_jobs.py, lines ${line}–${line + 1}` }, text: 'Is this loop covered?', createdAt: new Date().toISOString(), state: 'open' });
    App.render();
  }, first));
  const lineMark = await page.evaluate((line) => {
    const row = (n) => document.querySelector(`.cv .code .l[data-line="${n}"]`);
    const mark = row(line)?.querySelector('.x .cb');
    const text = row(line)?.querySelector('.x');
    const range = document.createRange();
    range.selectNodeContents(text);
    if (mark) range.setEndBefore(mark); // the text of the line, without its mark; a long line wraps, and its text ends on its last row
    const end = [...range.getClientRects()].filter((one) => one.width).at(-1)?.right ?? 0;
    return { onFirst: !!mark, onSecond: !!row(line + 1)?.querySelector('.cb'), afterText: !!mark && mark.querySelector('svg').getBoundingClientRect().left >= end - 1, rowHeight: row(line).offsetHeight, nextHeight: row(line + 2).offsetHeight };
  }, first);
  await page.click(`.cv .code [data-line="${first + 1}"] .x`);
  await page.waitForSelector(theCard, { timeout: 3000 }).catch(() => {});
  const codeCard = { text: await page.$$eval(`${theCard} .cth .msg .tx`, (all) => all.map((tx) => tx.textContent).join()).catch(() => ''), near: await page.$$eval('.cv .code .l.near', (all) => all.map((row) => row.dataset.line).join()) };
  // Beside the code when there is room, else over the code next to the lines: never over the lines.
  codeCard.beside = apart(await box(theCard), await page.evaluate((line) => {
    const [a, b] = [line, line + 1].map((n) => document.querySelector(`.cv .code .l[data-line="${n}"]`).getBoundingClientRect());
    return { left: a.left, right: a.right, top: a.top, bottom: b.bottom };
  }, first));
  await shot('14-card-in-code');
  await closeCard();
  codeCard.nearAfter = await page.$$eval('.cv .code .l.near', (all) => all.length);
  check('code lines with a thread have the bubble at the end of the text of their first line only, and the row keeps its height; a click on the lines opens their card beside them, not over them, and the lines are tinted while it is open',
    lineMark.onFirst && !lineMark.onSecond && lineMark.afterText && lineMark.rowHeight === lineMark.nextHeight && codeCard.text === 'Is this loop covered?' && codeCard.near === `${first},${first + 1}` && codeCard.beside && codeCard.nearAfter === 0,
    JSON.stringify({ lineMark, codeCard }));
  await drawn(() => page.click('#crumb a[data-trail="1"]'));

  // With no session and no connected app the list says so and offers nothing; Esc closes the box.
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
  check('with no session and no connected app the @ list says so in one line and offers nothing, and Esc closes the box',
    noSession === 'No agent to send to: this change has no known session, and no agent app is connected.' && options === 0 && dropped === 0, noSession);

  // At 370 px the card fits the tab: a picture for a person to look at.
  if (process.argv.includes('--pictures')) {
    await page.setViewportSize({ width: 370, height: 900 });
    await settle();
    await openMark(partTitle('night-job'));
    await shot('17-card-at-370');
    await closeCard();
  }

  // ----- a comment on any component: the outline under the comment pointer, the words in the card, and a click on its row in the list that opens its card there -----
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
  // Presses the key, moves the pointer to a spot, reads the outline, clicks and reads the words of the card.
  const stickAt = async (spot) => {
    await settle();
    await page.keyboard.press('Meta+Shift+Period');
    await page.mouse.move(spot.x - 3, spot.y - 3);
    await page.mouse.move(spot.x, spot.y, { steps: 2 });
    const outline = await aimed();
    await page.mouse.click(spot.x, spot.y);
    const opened = await page.waitForSelector(`${boxField}:focus`, { timeout: 3000 }).then(() => true, () => false);
    return { outline, where: opened ? await cardWhere() : '' };
  };
  // Sends the comment as a note, so that nothing waits on an agent, and closes its card.
  const saveBox = async (text) => {
    await page.click(`${theCard} .pick`);
    await page.click(`${theCard} .pi[data-choice="none"]`);
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.cbox.card .cth'), null, { timeout: 3000 }).catch(() => {});
    await closeCard();
    await settle();
    return (await sentRemarks()).pop()?.target;
  };
  const stuckOn = {}; // the key and the target of each saved comment, by its text
  // Under the comment pointer the thing of a key has the outline, and the click opens the card on it with its words; with a text the comment is saved.
  const tryOne = async (key, words, text, stuck) => {
    stuck ??= await stickAt(await spotOf(key));
    if (text) stuckOn[text] = { key, target: await saveBox(text) };
    else await closeCard();
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
  // The mark of an arrow with no words stands beside the middle of its line.
  const arrow = { edge: stuckOn['Why do the routes call the service directly?'].target?.edge, mark: await page.evaluate((key) => {
    const line = [...document.querySelectorAll('.paper path[data-rk]')].find((el) => el.dataset.rk === key && !el.classList.contains('hit'));
    const mark = line?.nextElementSibling?.matches('g.cb') ? line.nextElementSibling.getBoundingClientRect() : null;
    const at = line && line.getPointAtLength(line.getTotalLength() / 2);
    const m = line?.getScreenCTM();
    return !!mark && Math.hypot(mark.left + mark.width / 2 - (m.a * at.x + m.c * at.y + m.e), mark.top + mark.height / 2 - (m.b * at.x + m.d * at.y + m.f)) < 50;
  }, arrowKey) };
  check('under the comment pointer a file name inside a part (not its part), a part, an empty place and the title row (both the diagram as a whole), an arrow, "5 more files" and "In no part" of the change diagram each have the outline, and the click opens the card on it with its words; the target of an arrow holds the ids of its two parts, and an arrow with a thread shows its mark beside the middle of its line',
    onChange.every((one) => one.ok) && JSON.stringify(arrow.edge) === '["routes","hold-service"]' && arrow.mark, `${failed(onChange)}; ${JSON.stringify(arrow)}`);

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
  const messageMark = await page.evaluate(() => !!document.querySelector('#view g.cb.svg path'));
  await diagramView({ level: 'part', part: 'tables', diagram: 'hold-states' });
  onOthers.push(await tryOne('node:hold-states:paused', 'State "paused", diagram "The states of one hold"'));
  onOthers.push(await tryOne('edge:hold-states:waiting>paused:pause', 'Transition "pause" from "waiting" to "paused"', 'Who can pause it?'));
  check('a participant and a message of a sequence diagram, and a state and a transition of a state diagram, each have the outline and hold the comment; a message with an open thread shows the small bubble beside it',
    onOthers.every((one) => one.ok) && messageMark, `${failed(onOthers)}; mark ${messageMark}`);

  await diagramView({ level: 'broad', diagram: 'member-areas' });
  const onWider = [
    await tryOne('node:member-areas:renew', 'Node "Renew a loan", diagram "The areas of the member page"', 'Who may renew?'),
    await tryOne('diagram:member-areas', 'Diagram "The areas of the member page"'),
  ];
  check('a node and the title of a wider diagram each have the outline and hold the comment', onWider.every((one) => one.ok), failed(onWider));

  // "Diffs": the row of a file in the list, a changed line and a note in the file beside it.
  const night = 'src/library/night_jobs.py';
  await drawn(() => page.click('.switch a[data-view="diffs"]'));
  await page.evaluate((file) => App.diffs.toPath(file), night);
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
  const noteKey = `note:${night}:removed:243`;
  await page.evaluate((file) => App.diffs.toPath(file), night);
  const diffNote = await page.evaluate(async (key) => {
    const el = [...document.querySelectorAll('#view > .file-left .mc')].find((one) => one.dataset.rk === key);
    el.scrollIntoView({ block: 'center' });
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const box = el.querySelector('.t').getBoundingClientRect();
    return { x: box.left + 30, y: box.top + box.height / 2 };
  }, noteKey);
  onDiffs.push(await tryOne(noteKey, `Note "The reservation run is gone", ${night}, removed lines 243–252`, '', await stickAt(diffNote)));
  check('on "Diffs" the row of a file has the outline and holds a comment on the file that remembers "Diffs"; a changed line of the file and a note on removed lines have the outline, and the card names that line and the removed lines',
    onDiffs.every((one) => one.ok), failed(onDiffs));

  // The code view: a test in the window of the tests (the window stays while the key is pressed in it), and a note.
  await showCode('src/library/lending/hold_service.py', [245, 245]);
  await page.hover('.cv .mc [data-tests]');
  const testsWin = await hoverWindow();
  const testRow = testsWin ? await page.$eval('.win .trw', (el) => { const box = el.querySelector('.nm').getBoundingClientRect(); return { x: box.left + 40, y: box.top + box.height / 2, key: el.dataset.rk }; }) : null;
  if (testRow) await page.mouse.move(testRow.x, testRow.y, { steps: 4 }); // into the window, as a person does before the key
  const testStuck = testRow ? await stickAt(testRow) : { outline: [], where: '' };
  await closeCard();
  await away();
  await page.$eval('.cv .mc', (el) => el.scrollIntoView({ block: 'center' })); // away from the control of the files at the top
  await settle();
  const noteStuck = await stickAt(await page.$eval('.cv .mc', (el) => { const box = el.querySelector('.t').getBoundingClientRect(); return { x: box.left + 30, y: box.top + box.height / 2 }; }));
  await closeCard();
  check('the window of the tests stays under the comment pointer, and a test in it has the outline and holds the comment; a note beside the code has the outline and holds the comment',
    !!testRow && testStuck.outline.join() === testRow.key && /^Test test_\w+, \w+\.py$/.test(testStuck.where) && noteStuck.outline.length === 1 && /^note:/.test(noteStuck.outline[0]) && /^Note "/.test(noteStuck.where),
    JSON.stringify({ testStuck, noteStuck }));

  // The quick comment: Enter after the key, with no click, opens the card on the whole of what the page shows.
  const quickBox = async () => {
    await settle();
    await page.keyboard.press('Meta+Shift+Period');
    await page.keyboard.press('Enter');
    const opened = await page.waitForSelector(`${boxField}:focus`, { timeout: 3000 }).then(() => true, () => false);
    const where = opened ? await cardWhere() : '';
    await closeCard();
    return where;
  };
  const quick = {};
  await diagramView({ level: 'change' });
  quick.change = await quickBox();
  await diagramView({ level: 'part', part: 'hold-service', diagram: 'offer-flow' });
  quick.part = await quickBox();
  await showCode('src/library/lending/hold_service.py', [245, 245]);
  quick.file = await quickBox();
  check('Enter after the comment key, with no click, opens the card on the whole view: the diagram of the change, the diagram of a part, and the file of the code view',
    quick.change === 'Diagram "Adds holds for books that are out"' && quick.part === 'Diagram "How one night run offers returned copies"' && /^File hold_service\.py \(.+\), part "Hold service"$/.test(quick.file), JSON.stringify(quick));

  // A click on a row of the list, with another view shown in between, goes to the view of its thing, lights exactly that thing and opens its card there.
  // A thing that is gone says so, keeps the title that it had, and its row lights the part.
  await drawn(() => page.evaluate(() => {
    App.page.remarks.push({ id: 98, changeId: 0, target: { kind: 'node', diagram: 'offer-flow', node: 'removed-step', part: 'hold-service', label: 'Node "A removed step", diagram "How one night run offers returned copies"' }, text: 'Is this step still needed?', createdAt: new Date().toISOString(), state: 'open' });
    const title = { title: 'Check the hold', diagram: 'How one night run offers returned copies' };
    App.page.remarks.push({ id: 97, changeId: 0, target: { kind: 'node', diagram: 'offer-flow', node: 's21', part: 'hold-service', label: 'Node "s21"', kept: title }, text: 'Why only after a retry?', createdAt: new Date().toISOString(), state: 'open' });
    return App.render();
  }));
  const fromRow = async (text, between) => {
    await between();
    await page.click('[data-comments]');
    await page.locator('.cml .cmr[data-row]', { hasText: text }).click();
    await page.waitForFunction(() => document.querySelector('.paper .flash') && document.querySelector('.cbox.card'), null, { timeout: 3000 }).catch(() => {});
    const one = { text, flashed: (await flashed()).join(), crumb: await page.textContent('#crumb'), view: await page.evaluate(() => App.state.view), list: await page.$$eval('.cml', (all) => all.length),
      card: await page.$$eval(`${theCard} .cth .msg.mine .tx`, (all) => all.map((tx) => tx.textContent).join()), where: await cardWhere() };
    await closeCard();
    return one;
  };
  const toDiffs = () => drawn(() => page.click('.switch a[data-view="diffs"]'));
  const toTheChange = () => diagramView({ level: 'change' });
  const lights = [];
  for (const [text, between] of [['Why do the routes call the service directly?', toDiffs], ['Which five files are these?', toDiffs], ['What does open mean here?', toDiffs],
    ['Are the rows locked?', toTheChange], ['Who can pause it?', toTheChange], ['Why does the night job change?', toTheChange], ['Who may renew?', toTheChange]]) {
    const one = await fromRow(text, between);
    lights.push({ ...one, ok: one.flashed === (stuckOn[text]?.key ?? 'node:member-areas:renew') && one.card === text && one.list === 0 });
  }
  const broad = lights.at(-1);
  const gone = await fromRow('Is this step still needed?', toDiffs);
  const titleKept = (await fromRow('Why only after a retry?', toDiffs)).where;
  check('a click on a row of the list after another view goes to the view of its thing, lights exactly that thing (an arrow, "5 more files", a node, a message, a transition, a file on "Diffs"), a node of a wider diagram in that diagram large, and opens its card there; a thing that is gone says "no longer in the diagram", keeps its title, and its row lights its part',
    lights.every((one) => one.ok) && /The areas of the member page$/.test(broad.crumb) && /· no longer in the diagram$/.test(gone.where) && gone.flashed === 'part:hold-service'
      && /^Node "Check the hold" · no longer in the diagram$/.test(titleKept),
    `${JSON.stringify(lights.map(({ text, ok, flashed: lit, view: shown, card: said, list: listed }) => (ok ? text : { text, lit, shown, said, listed })))}; ${JSON.stringify(gone)}; ${titleKept}`);
  await shot('42-card-from-the-list-in-a-large-diagram');

} catch (error) {
  check('the checks ran to the end', false, error.message.split('\n').slice(0, 14).join(' / '));
}
await finish();
