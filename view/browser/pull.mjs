// The browser check of the view "Conversation" of a pull request, comments on its code, and a stack. A group of view/browser-check.mjs, which runs every group at the same time; alone:
//   node view/browser/pull.mjs [--pictures] [<folder for pictures>]

import { check, errors, finish, newPage, pageFile, takePicture } from './tools.mjs';

/** Waits for `count` frames of the page: the page sets some places again for a few frames (the line "New since you last looked", a field after a send). */
const frames = (page, count = 2) => page.evaluate((n) => new Promise((done) => { const step = (left) => (left ? requestAnimationFrame(() => step(left - 1)) : done()); step(n); }), count);
/** Waits until a drawing that a resize or a click started is done. */
const settle = async (page) => { await frames(page); await page.evaluate(() => App.drawing); };
const resize = async (page, width, height = 900) => {
  await page.setViewportSize({ width, height });
  await page.waitForFunction((w) => innerWidth === w, width);
  await settle(page);
};

try {
  // ----- the view "Conversation" of the made-up pull request #12 (a block of its own, for its names) -----
  {
  const conv = await newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  conv.on('pageerror', (error) => errors.push(error.message));
  conv.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const convShot = (name, fullPage = false) => takePicture(conv, `${name}.png`, fullPage);
  /** Does `act` and waits until the page has drawn the conversation again and its place holds. */
  const conversationAfter = async (act) => {
    const before = await conv.evaluate(() => window.apostilConversations ?? 0);
    await act();
    await conv.waitForFunction((n) => (window.apostilConversations ?? 0) > n, before, { timeout: 8000 });
    await frames(conv, 8);
  };
  await conv.goto(`file://${pageFile}`);
  await conv.waitForFunction(() => (window.apostilRendered ?? 0) >= 1 && !!document.querySelector('#status .msent[title]'), null, { timeout: 15000 });
  const strip = await conv.evaluate(() => {
    const el = document.querySelector('#status .status');
    const icon = el?.querySelector('.pri');
    const faces = [...(el?.querySelectorAll('.rv:not(.rest)') ?? [])].map((one) => one.getBoundingClientRect());
    return { text: el?.textContent, reviewers: [...(el?.querySelectorAll('.rv:not(.rest)') ?? [])].map((one) => one.title), avatars: el?.querySelectorAll('.rv:not(.rest) .av').length, all: el?.querySelector('.msent')?.title,
      stacked: faces.slice(1).every((face, at) => face.left < faces[at].right - 4 && face.right > faces[at].right + 8), dots: [...(el?.querySelectorAll('.rv .rb') ?? [])].map((dot) => dot.className.replace('rb ', '')).join(),
      icon: icon?.className, masked: icon && getComputedStyle(icon).maskImage.startsWith('url("data:image/svg+xml'), switchText: [...document.querySelectorAll('.bar .switch a:not([hidden])')].map((a) => a.textContent).join(' · ') };
  });
  // Many reviewers, with bots and a team: three avatars show, a verdict first and a bot last; the others are a count that names each one.
  const manyReviewers = await conv.evaluate(() => {
    const pull = structuredClone(Object.values(App.read)[0].pull);
    const person = (login, more = {}) => ({ login, avatar: '', bot: false, ...more });
    pull.reviewers = [
      { person: person('Copilot', { bot: true }), state: 'reviewed' }, { person: person('ana'), state: 'approved' }, { person: person('review-bot', { bot: true }), state: 'approved' },
      { person: person('ben'), state: 'asked' }, { person: person('cy'), state: 'changes requested' }, { person: person('made-up/team', { team: true }), state: 'asked' }, { person: person('dee'), state: 'approved' },
    ];
    const el = document.createElement('div');
    el.innerHTML = Conversation.stripHtml(pull, pull, 0);
    const count = el.querySelector('.rvs > .rv.rest');
    pull.reviewers = [];
    el.innerHTML += Conversation.stripHtml(pull, pull, 0);
    drawStrip(); // the strip of the page again, so that a later click draws the real one
    return { shown: [...el.querySelectorAll('.rv:not(.rest)')].map((one) => one.title), count: count?.textContent, rest: count?.title, none: el.querySelectorAll('.status')[1]?.textContent };
  });
  // The strip says each fact once: after the state, the review and the checks, only the rest of the merge sentence (in the title of .msent).
  check('the page of a change with a pull request has "Conversation" in the switch, and the status strip in one short line: the icon, the reviewers as avatars that lie over each other with a dot for the state, the checks, and the first thing before a merge with a count of the others, each fact once; with seven reviewers three avatars show, who asked for changes first and people before bots, and "+4" names the others; with no reviewer it says so in words',
    strip.switchText === 'Conversation · Diagram · Diffs' && strip.icon === 'pri git-pull-request red' && strip.masked
    && /2 of 12 checks failed▸Waits for #9 below it in the stack▸2 moreReview1 more pull request$/.test(strip.text) && !/approved|jonas/.test(strip.text)
    && strip.reviewers.join() === 'jonas-b: approved,lena-s: waiting,made-up/lending-team: waiting' && strip.avatars === 3 && strip.stacked && strip.dots === 'ok,wait,wait'
    && strip.all === 'Waits for #9 below it in the stack · 1 check is still running · 3 commits behind made-up/hold-store'
    && manyReviewers.shown.join() === 'cy: asked for changes,ana: approved,dee: approved' && manyReviewers.count === '+4'
    && manyReviewers.rest === 'review-bot: approved, ben: waiting, made-up/team: waiting, Copilot: commented' && /^#12(no review yet|review required)/.test(manyReviewers.none), JSON.stringify({ strip, manyReviewers }));
  // The number of the pull request stands right after the state icon, before the avatars, as a quiet link to GitHub; "+4" opens a small window with each hidden reviewer.
  const bar = await conv.evaluate(() => {
    const pull = structuredClone(Object.values(App.read)[0].pull);
    const person = (login, more = {}) => ({ login, avatar: '', bot: false, ...more });
    pull.reviewers = ['ana', 'ben', 'cy', 'dee', 'eli'].map((login, at) => ({ person: person(login), state: ['approved', 'changes requested', 'asked', 'reviewed', 'approved'][at] }));
    const el = document.getElementById('status');
    el.innerHTML = Conversation.stripHtml(pull, pull, 0);
    Conversation.bindStrip(el);
    const link = el.querySelector('.pnum');
    const order = [...el.querySelectorAll('.status > *')];
    return { text: link?.textContent, url: link?.dataset.link, want: pull.url, title: link?.title, number: pull.number, afterIcon: order.indexOf(link) === 1 && order[2]?.classList.contains('rvs'), restTitle: el.querySelector('.rv.rest')?.getAttribute('title') };
  });
  await conv.hover('#status .rv.rest');
  await conv.waitForSelector('.win', { timeout: 3000 });
  const hiddenWindow = await conv.evaluate(() => ({ rows: [...document.querySelectorAll('.win .pp')].map((row) => `${row.querySelector('.pn')?.textContent}: ${row.querySelector('.pw')?.textContent}`), faces: document.querySelectorAll('.win .pp .av').length }));
  await conv.mouse.move(2, 2);
  await conv.waitForSelector('.win', { state: 'detached', timeout: 3000 });
  await conv.keyboard.press('Tab'); // so that the focus is from the keyboard, as :focus-visible wants
  await conv.evaluate(() => document.querySelector('#status .rv.rest').focus());
  const focused = await conv.waitForSelector('.win', { timeout: 3000 }).then(() => true, () => false);
  await conv.evaluate(() => document.activeElement.blur());
  await conv.waitForSelector('.win', { state: 'detached', timeout: 3000 }).catch(() => {});
  await conv.evaluate(() => drawStrip());
  check('the bar of the pull request has "#12" right after the state icon and before the avatars, a quiet link to the pull request on GitHub with the title "Open #12 on GitHub"; the "+2" has no plain title, and the pointer or the keyboard focus on it opens a small window with the avatar, the name and the state word of each hidden reviewer',
    bar.text === `#${bar.number}` && bar.url === bar.want && bar.title === `Open #${bar.number} on GitHub` && bar.afterIcon && bar.restTitle === null
    && hiddenWindow.rows.join() === 'cy: waiting,dee: commented' && hiddenWindow.faces === 2 && focused, JSON.stringify({ bar, hiddenWindow, focused }));
  // The tooltip of the icon: "#12 · Checks failing", dark, above the icon, after a short moment; gone when the pointer leaves; also on keyboard focus.
  const tipOf = () => conv.evaluate(() => {
    const tip = document.querySelector('.tip');
    if (!tip) return null;
    const box = tip.getBoundingClientRect();
    const icon = document.activeElement?.dataset?.tip ? document.activeElement : document.querySelector('#status .pri');
    const at = icon.getBoundingClientRect();
    return { text: tip.textContent, background: getComputedStyle(tip).backgroundColor, color: getComputedStyle(tip).color, above: box.bottom <= at.top + 1,
      centred: Math.abs(box.left + box.width / 2 - (at.left + at.width / 2)) < 2 || box.left <= 7, inside: box.left >= 0 && box.right <= innerWidth && box.top >= 0 };
  });
  await conv.hover('#status .pri');
  const tipEarly = await tipOf();
  await conv.waitForSelector('.tip', { timeout: 3000 });
  const tip = await tipOf();
  await convShot('59-tooltip-of-the-state-icon');
  await conv.mouse.move(2, 2); // off the icon, and off the diagram, where a node would open its hover window
  await conv.waitForSelector('.tip', { state: 'detached', timeout: 3000 });
  const tipGone = await tipOf();
  // Tab from the start of the page reaches the icon first; later clicks and fields would move the place where Tab starts, so this runs before them.
  await resize(conv, 370);
  await conv.focus('body');
  await conv.keyboard.press('Tab');
  for (let i = 0; i < 12 && !(await conv.evaluate(() => document.activeElement?.matches('#status .pri'))); i++) await conv.keyboard.press('Tab');
  const tipFocus = await tipOf();
  await conv.evaluate(() => document.activeElement.blur());
  await resize(conv, 1400);
  check('the state icon has a small dark tooltip "#12 · Checks failing · 2 of 3 in a stack" after a short moment, above the icon, gone when the pointer leaves; it also shows on keyboard focus, and at 370 px it stays inside the page',
    !tipEarly && tip?.text === '#12 · Checks failing · 2 of 3 in a stack' && tip.color === 'rgb(255, 255, 255)' && tip.background === 'rgb(36, 41, 47)' && tip.above && tip.centred && tip.inside && !tipGone
    && tipFocus?.text === '#12 · Checks failing · 2 of 3 in a stack' && tipFocus.inside, JSON.stringify({ tipEarly, tip, tipGone, tipFocus }));
  // A click on the checks of the strip opens their list as a section of the page, ordered: failed, running, passed folded, skipped quiet.
  await conv.click('#status [data-checks]');
  const panel = await conv.evaluate(() => {
    const el = document.querySelector('#status .checks-panel');
    if (!el) return null;
    const groups = [...el.querySelectorAll('.cg')].map((group) => ({
      title: group.querySelector('.cgh').textContent,
      rows: [...group.children].filter((child) => child.matches('.ck, .cpass')).map((row) => row.matches('.cpass') ? `[${row.querySelector('.cn').textContent}]` : `${row.querySelector('.cn').textContent}:${[...row.classList].find((name) => ['ok', 'bad', 'wait', 'quiet'].includes(name))}`),
    }));
    const note = el.querySelector('.ann .at');
    return { groups, note: note && { text: note.textContent, file: note.dataset.threadFile, lines: note.dataset.lines }, deps: el.querySelector('.deps')?.textContent,
      links: [...el.querySelectorAll('.ck.bad .cl a')].map((a) => a.textContent), window: !!document.querySelector('.win') };
  });
  await conv.click('#status .checks-panel .ann .at');
  const noteTold = await conv.evaluate(() => window.apostilSent.filter((message) => message.type === 'openFileTab').at(-1));
  check('a click on the checks opens their list under the strip: under their workflow, other products under "Other checks"; failed first, then running, passed folded, skipped quiet; no hover window; a failed check shows its note with file:line, and a click opens the file tab at that line; the deployments stand with the checks',
    !!panel && !panel.window && panel.groups.map((group) => group.title).join() === 'CI · GitHub Actions,Other checks'
    && panel.groups[0].rows.join() === 'integration / lending:bad,docs:wait,[7 passed],deploy the preview:quiet' && panel.groups[1].rows.join() === 'coverage/patch:bad,[1 passed]'
    && panel.links.join() === 'View the log,Run again,Details'
    && panel.note?.text === 'src/library/lending/hold_service.py:246' && noteTold?.path === 'src/library/lending/hold_service.py' && noteTold.lines?.join() === '246,246'
    && /preview: ready.*View deployment.*staging: failed/.test(panel.deps), JSON.stringify({ panel, noteTold }));
  await conv.click('#status [data-checks]');
  await conv.mouse.move(2, 2);
  await conversationAfter(() => conv.click('.switch a[data-view="conversation"]'));
  // The page always opens at its top; only a conversation that he opened before marks unseen messages, inside its own window.
  // He looked 26 hours ago, so messages are unseen: the page is at its top, and the window of the conversation, under the description, is at the line.
  const opened = await conv.evaluate(() => {
    const room = document.getElementById('cscroll');
    const line = document.getElementById('new-line');
    const card = document.getElementById('pcard').getBoundingClientRect();
    return { line: line?.textContent, edge: line && room ? Math.round(line.getBoundingClientRect().top - room.getBoundingClientRect().top) : null, inWindow: !!line && !!room?.contains(line), page: Math.round(scrollY),
      card: card.top > 0 && card.bottom < innerHeight, short: document.getElementById('short')?.classList.contains('on'),
      crumb: document.getElementById('crumb').textContent, looked: window.apostilSent.filter((message) => message.type === 'looked') };
  });
  await convShot('60-page-opened-again-at-its-top');
  // The window comes into view, as a scroll of the page brings it: under the slim bar, which carries the switch of views.
  await conv.evaluate(() => document.getElementById('cwin')?.scrollIntoView({ block: 'end' }));
  await frames(conv);
  await convShot('60a-window-at-the-new-line');
  const newest = await conv.evaluate(async () => {
    const button = document.getElementById('newest');
    const room = document.getElementById('cscroll');
    const win = document.getElementById('cwin')?.getBoundingClientRect();
    const field = document.querySelector('.cfoot .ghend')?.getBoundingClientRect();
    if (!room || !win || !field) return { window: false };
    const on = button.classList.contains('on');
    const box = button.getBoundingClientRect();
    // "↓ Newest" belongs to the window: in the middle of its lower edge, just above the box to write; at the right it lay over "Resolve" and the ends of rows.
    const middle = Math.abs((box.left + box.right) / 2 - (win.left + win.right) / 2) < 4 && box.bottom <= field.top && box.top > win.top;
    const page = scrollY;
    button.click();
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); // the scroll event marks the button
    return { on, middle, atEnd: room.scrollTop + room.clientHeight >= room.scrollHeight - 2, off: !button.classList.contains('on'), pageStays: scrollY === page };
  });
  await convShot('60b-window-at-its-newest-message');
  const slimSwitch = await conv.evaluate(() => {
    const short = document.querySelector('#short');
    return { on: short?.classList.contains('on'), views: [...(short?.querySelectorAll('.switch a:not([hidden])') ?? [])].map((a) => a.textContent), marked: short?.querySelector('.switch a.on')?.textContent };
  });
  // The slim bar carries the switch of views, so that "Diagram" and "Diffs" are never scrolled away.
  check('a pull request opened before, with unseen messages: the page opens at its top with the state card in view, and its window of the conversation is scrolled so that "New since you last looked" stands at its top edge; "↓ Newest" shows in the middle of the lower edge of the window and takes the window to its newest message, the page stays; the slim bar carries the switch of views; the page tells VS Code once that he looked now, and the line at the top ends with the pull request',
    /^New since you last looked · \d+$/.test(opened.line) && opened.inWindow && opened.edge >= 0 && opened.edge <= 12 && opened.page === 0 && opened.card && !opened.short
    && newest.on && newest.middle && newest.atEnd && newest.off && newest.pageStays
    && slimSwitch.on && slimSwitch.views.includes('Diagram') && slimSwitch.views.includes('Diffs') && slimSwitch.marked === 'Conversation'
    && opened.looked.length === 1 && opened.looked[0].repo === 'made-up/example' && opened.looked[0].number === 12 && /›Pull request #12$/.test(opened.crumb), JSON.stringify({ opened, newest, slimSwitch }));

  // The window scrolls on its own: the wheel with the pointer in it moves what it shows, its head and its box stay where they are, and the page stays.
  // At its top end the wheel scrolls the page on, so nothing traps the pointer. A short conversation gives a short window.
  const windowNow = () => conv.evaluate(() => {
    const rect = (el) => { const box = el.getBoundingClientRect(); return [Math.round(box.top), Math.round(box.bottom)]; };
    const room = document.getElementById('cscroll');
    return { page: Math.round(scrollY), shows: Math.round(room.scrollTop), head: rect(document.querySelector('#cwin > .head')), box: rect(document.querySelector('.cfoot .ghend')), view: innerHeight };
  });
  const pointer = await conv.evaluate(() => { const box = document.getElementById('cscroll').getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; });
  await conv.mouse.move(pointer.x, pointer.y);
  const wheelStart = await windowNow();
  await conv.mouse.wheel(0, -600);
  await conv.waitForFunction((was) => Math.round(document.getElementById('cscroll').scrollTop) < was, wheelStart.shows, { timeout: 3000 }).catch(() => {});
  await frames(conv);
  const wheeled = await windowNow();
  await conv.evaluate(() => { document.getElementById('cscroll').scrollTop = 0; });
  await frames(conv);
  await conv.mouse.wheel(0, -200);
  await conv.waitForFunction((was) => scrollY < was, wheeled.page, { timeout: 3000 }).catch(() => {});
  const pageOn = await windowNow();
  const shortWindow = await conv.evaluate(async () => {
    const link = App.pullLink();
    window.keptPull = App.read[link];
    const pull = window.keptPull.pull;
    App.read[link] = { ...window.keptPull, pull: { ...pull, items: pull.items.filter((item) => item.kind === 'comment').slice(0, 2) } };
    await App.render();
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const room = document.getElementById('cscroll');
    const win = document.getElementById('cwin').getBoundingClientRect();
    const result = { height: Math.round(win.height), view: innerHeight, scrolls: room.scrollHeight > room.clientHeight + 1, messages: room.querySelectorAll('.msg').length };
    App.read[link] = window.keptPull;
    return result;
  });
  await conversationAfter(() => conv.evaluate(() => App.render()));
  check('the window of the conversation scrolls on its own: the wheel with the pointer in it moves what it shows while its head and its box to write stay in place and in view, and the page stays; at its top end the wheel scrolls the page on; a conversation of two messages gives a short window with nothing to scroll',
    wheeled.shows < wheelStart.shows - 100 && wheeled.page === wheelStart.page && JSON.stringify([wheeled.head, wheeled.box]) === JSON.stringify([wheelStart.head, wheelStart.box])
    && wheeled.head[0] >= 0 && wheeled.box[1] <= wheeled.view && pageOn.shows === 0 && pageOn.page < wheeled.page
    && shortWindow.messages === 2 && !shortWindow.scrolls && shortWindow.height < shortWindow.view / 2, JSON.stringify({ wheelStart, wheeled, pageOn, shortWindow }));
  await conv.evaluate(() => scrollTo(0, 0));
  const about = await conv.evaluate(() => {
    const md = document.querySelector('.about .md');
    const lines = md.clientHeight / parseFloat(getComputedStyle(md).lineHeight);
    document.querySelector('.about .more').click();
    return { lines: Math.round(lines * 10) / 10, more: document.querySelector('.about .more .show').textContent, openHeight: md.clientHeight, closedHeight: Math.round(lines * parseFloat(getComputedStyle(md).lineHeight)) };
  });
  const feed = await conv.evaluate(() => {
    const earlier = document.querySelector('[data-earlier]').textContent;
    const messagesBefore = document.querySelectorAll('.feed .msg').length;
    document.querySelector('[data-earlier]').click();
    const messagesAfter = document.querySelectorAll('.feed .msg').length;
    const resolved = document.querySelector('.thread.folded');
    const inner = resolved.querySelector('.inner');
    const before = { text: resolved.querySelector('.resolved').textContent, shown: inner.offsetHeight > 0, faded: Number(getComputedStyle(resolved.querySelector('.resolved')).opacity) };
    resolved.querySelector('[data-toggle]').click();
    const unfolded = inner.offsetHeight > 0 && /lock ends with the transaction/.test(inner.textContent);
    resolved.querySelector('[data-toggle]').click();
    const commits = [...document.querySelectorAll('.commits')].at(-1);
    const commitText = commits.querySelector('.lrow').textContent;
    commits.querySelector('[data-toggle]').click();
    const commitRows = [...commits.querySelectorAll('.inner .row code')].map((code) => code.textContent);
    const same = document.querySelectorAll('.feed .msg.same').length;
    const long = [...document.querySelectorAll('.long')].find((one) => one.offsetHeight > 0);
    const longBefore = long.querySelector('.tx').clientHeight;
    long.querySelector('[data-toggle]').click();
    const longAfter = long.querySelector('.tx').clientHeight;
    const hidden = document.querySelector('.hidbox');
    const hiddenText = hidden.querySelector('.hid').textContent;
    const hiddenShown = hidden.querySelector('.inner').offsetHeight > 0;
    hidden.querySelector('[data-toggle]').click();
    const outdated = document.querySelector('.thread.outdated .lab')?.textContent;
    const bot = [...document.querySelectorAll('.feed .bot')].length;
    const notShown = document.querySelector('.cutline')?.textContent;
    return { before, unfolded, commitText, commitRows, earlier, messagesBefore, messagesAfter, same, longBefore, longAfter, hiddenText, hiddenShown, hiddenOpen: /Lunch/.test(hidden.querySelector('.inner').textContent) && hidden.querySelector('.inner').offsetHeight > 0, outdated, bot, notShown };
  });
  const modern = await conv.evaluate(() => {
    const text = (selector) => [...document.querySelectorAll(selector)].map((el) => el.textContent.replace(/\s+/g, ' ').trim());
    const commits = [...document.querySelectorAll('.commits')].at(-1);
    return {
      days: text('.conv .dayline'), products: text('.conv .prods > .lrow'), productInner: document.querySelector('.conv .prods .inner')?.offsetHeight ?? -1,
      repeat: text('.conv .rep'), runs: text('.conv .evrun > .lrow'), title: text('.conv .mtitle'), deploy: text('.conv .row.ev').filter((row) => /deployed/.test(row)),
      whole: text('.conv .thread .fh').filter((head) => /old_reservations/.test(head)), verified: commits.querySelectorAll('.vf').length,
      people: [...commits.querySelectorAll('.inner .row .t')].map((el) => el.textContent), chips: document.querySelectorAll('.conv .react .chip').length,
      verdict: text('.conv .verdict'),
    };
  });
  const factsLine = await conv.evaluate(() => {
    const title = document.querySelector('.conv .ptitle')?.getBoundingClientRect();
    const first = document.querySelector('.conv .meta .fact');
    return title && first ? { indent: Math.round(first.getBoundingClientRect().left - title.left), padding: getComputedStyle(first).paddingLeft } : null;
  });
  // "Messages" is a timeline: commits, events and the comments of a product are rows on a line down the avatar
  // column, each its icon on the line and a short faint word, with no time and no box; a click opens its details in place.
  /** The line of "Messages" and what stands on it: how it lies, where it starts and ends against the first and the last row, the avatars and icons on it. */
  const lineOf = () => conv.evaluate(() => {
    const feed = document.querySelector('.conv.messages .feed');
    if (!feed) return null;
    const box = feed.getBoundingClientRect();
    const line = getComputedStyle(feed, '::before');
    const x = box.left + parseFloat(line.left) + parseFloat(line.width) / 2;
    const off = (el) => { const at = el.getBoundingClientRect(); return Math.round((at.left + at.width / 2 - x) * 10) / 10; };
    const rows = [...feed.children].filter((el) => el.offsetHeight > 0);
    const probe = feed.appendChild(document.createElement('i'));
    probe.style.color = 'var(--line)';
    const lineColor = getComputedStyle(probe).color;
    probe.remove();
    const paper = getComputedStyle(document.getElementById('cwin')).backgroundColor;
    const avatars = [...feed.querySelectorAll(':scope > .msg > .av:not(.gap)')].filter((el) => el.offsetHeight > 0);
    return { width: line.width, colour: line.backgroundColor === lineColor, under: getComputedStyle(feed).zIndex === '0' && line.zIndex === '-1',
      top: Math.round(box.top + parseFloat(line.top) - rows[0].getBoundingClientRect().top), bottom: Math.round(box.bottom - parseFloat(line.bottom) - rows.at(-1).getBoundingClientRect().bottom),
      avatars: avatars.map(off), ringed: avatars.every((el) => getComputedStyle(el).boxShadow.startsWith(paper)), icons: [...feed.querySelectorAll(':scope > .online > .lrow > .lic')].map(off) };
  });
  const lineWide = await lineOf();
  const onLine = await conv.evaluate(() => {
    const probe = document.querySelector('.conv .feed').appendChild(document.createElement('i'));
    probe.style.color = 'var(--faint)';
    const faint = getComputedStyle(probe).color;
    probe.remove();
    return [...document.querySelectorAll('.conv .feed > .online')].filter((one) => one.offsetHeight > 0).map((one) => {
      const row = one.querySelector(':scope > .lrow');
      const style = getComputedStyle(row);
      const words = row.querySelector('.what');
      return { words: words?.textContent, only: row.textContent === words?.textContent, icon: !!row.querySelector(':scope > .lic > :is(.ico, .av, img)'), faint: getComputedStyle(words).color === faint,
        times: row.querySelectorAll('.time').length, box: ['Top', 'Right', 'Bottom', 'Left'].some((side) => style[`border${side}Width`] !== '0px') || style.backgroundColor !== 'rgba(0, 0, 0, 0)',
        open: one.querySelector(':scope > .inner').offsetHeight > 0 };
    });
  });
  await conv.locator('.conv .feed > .evrun > .lrow', { hasText: '3 force pushes' }).click();
  await conv.locator('.conv .feed > .prods > .lrow').click();
  const openedOnLine = await conv.evaluate(() => {
    const pushes = [...document.querySelectorAll('.conv .feed > .evrun')].find((one) => one.querySelector('.lrow').textContent === '3 force pushes');
    const bot = document.querySelector('.conv .feed > .prods > .inner');
    return { pushes: [...pushes.querySelectorAll(':scope > .inner > .row')].filter((row) => row.offsetHeight > 0).map((row) => row.textContent),
      bot: bot.offsetHeight > 0 && [...bot.querySelectorAll('.mtitle')].map((title) => title.textContent).join() };
  });
  const wordsOnLine = onLine.map((one) => one.words);
  check('"Messages" is a timeline: commits, events and the comments of a product are rows on the line, each its icon on the line and a short faint word ("4 commits", "3 force pushes", "GitHub Actions · 2 comments", "review asked from Copilot"), with no time and no box; a click opens its details in place',
    ['4 commits', '3 force pushes', 'GitHub Actions · 2 comments', '2 deployments', 'review asked from Copilot', 'milestone Version 0.5', 'assigned mira-k'].every((one) => wordsOnLine.includes(one))
    && wordsOnLine.some((one) => one.startsWith('labels backend, ')) && onLine.every((one) => one.icon && one.only && one.faint && !one.times && !one.box)
    && onLine.every((one) => !one.open || one.words === '4 commits') // the check of "Messages" above opened the 4 commits
    && lineWide?.icons.length === onLine.length && lineWide.icons.every((off) => Math.abs(off) <= 1)
    && openedOnLine.pushes.length === 3 && openedOnLine.pushes.every((row) => /^mira-k force-pushed from \w+ to \w+$/.test(row)) && openedOnLine.bot === 'Test report,Test report', JSON.stringify({ onLine, icons: lineWide?.icons, openedOnLine }));

  // The time has one place in each look. "Messages": one relative time for a group of messages, in the name line of its first message after a middle dot,
  // with the exact time as its tooltip; a later message of the group has none, its exact time is its tooltip; no clock anywhere. "Classic": right after the words.
  const timesIn = () => conv.evaluate(() => {
    const shown = (el) => el.offsetHeight > 0;
    const exactly = /^\d{1,2} \w{3,4} \d{4}, \d{2}:\d{2}$/; // "18 Nov 2026, 17:41"
    const visible = [...document.querySelectorAll('.conv .feed .time')].filter(shown);
    const clocks = [...document.querySelectorAll('.conv .feed *')].filter((el) => shown(el) && !el.children.length && /^\d{1,2}:\d{2}$/.test(el.textContent.trim())).length;
    // no time at the right edge of its row (his own messages stand at the right, their time with them)
    const rights = visible.filter((el) => !el.closest('.mine')).map((el) => { const row = el.closest('.top, .ev, .gh'); return row ? Math.round(row.getBoundingClientRect().right - el.getBoundingClientRect().right) : 999; });
    const firsts = [...document.querySelectorAll('.conv .feed > .msg:not(.same)')].filter(shown).map((msg) => {
      const times = [...msg.querySelectorAll(':scope > .body > .top > .time')];
      return { count: times.length, words: times[0]?.textContent, tip: exactly.test(times[0]?.title ?? ''), dot: msg.matches('.mine') || getComputedStyle(times[0] ?? msg, '::before').content === '"· "' };
    });
    const laters = [...document.querySelectorAll('.conv .feed > .msg.same, .conv .feed .sc.same')].filter(shown).map((said) => ({ times: said.querySelectorAll('.time').length, tip: exactly.test(said.title) }));
    return { count: visible.length, clocks, rights, firsts, laters };
  });
  await conv.evaluate(() => document.querySelectorAll('.conv .evrun, .conv .commits, .conv .thread.folded').forEach((box) => box.classList.add('open')));
  const messageTimes = await timesIn();
  await conv.waitForSelector('.conv .about .mmd svg', { timeout: 8000 }); // Mermaid draws after the page
  await conv.waitForSelector('.conv .about .nopic', { timeout: 8000 }); // a picture that does not load becomes a link when its load fails
  const extras = await conv.evaluate(async () => {
    const md = document.querySelector('.conv .about .md');
    const big = document.createElement('img');
    big.src = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="2400"><rect width="2400" height="2400" fill="teal"/></svg>')}`;
    md.append(big);
    await big.decode();
    const box = big.getBoundingClientRect();
    big.click();
    const large = !!document.querySelector('.win img.big');
    document.querySelector('.win [data-close]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    big.remove();
    const early = [...document.querySelectorAll('.conv .tcode .early')].map((el) => el.childElementCount);
    const rest = document.querySelector('.conv .tcode .rest');
    rest?.click();
    const drawn = rest?.closest('.tcode').querySelector('.early').childElementCount ?? 0;
    return {
      picture: { height: Math.round(box.height), width: Math.round(box.width), text: md.clientWidth, large },
      mermaid: !!document.querySelector('.conv .about .mmd svg'), loading: /Loading/.test(document.querySelector('.conv .about').textContent),
      broken: document.querySelector('.conv .about .nopic')?.textContent, early, drawn,
    };
  });
  const facts = await conv.evaluate(() => {
    const line = document.querySelector('.conv .facts .fline');
    const labels = [...line.querySelectorAll('.lbl')].map((el) => ({ fits: el.getBoundingClientRect().right <= line.getBoundingClientRect().right + 1, lines: Math.round(el.getBoundingClientRect().height / 18) }));
    document.querySelector('.conv .facts .fmore').click();
    return { text: line.textContent, labels, sections: [...document.querySelectorAll('.conv .facts .fsec h4')].map((el) => el.textContent), team: /made-up\/lending-team/.test(document.querySelector('.conv .facts .fsec').textContent) };
  });
  // Each fact of the line answers a click as on GitHub: a label lists the pull requests with it, a person and a milestone and an issue open their pages,
  // and the tasks bring the description open at its first task.
  const factLinks = await conv.evaluate(() => {
    const line = document.querySelector('.conv .facts .fline');
    const links = [...line.querySelectorAll('[data-link]')].map((el) => el.dataset.link);
    line.querySelector('[data-tasks]')?.click();
    return { links, openAbout: document.querySelector('.conv .about').classList.contains('open') };
  });
  check('each fact of the line of a pull request answers a click: a label lists the pull requests with that label on GitHub, a person, the milestone and a closed issue open their pages, and the tasks open the description',
    factLinks.links.some((link) => /\/pulls\?q=is%3Apr%20label%3A%22backend%22$/.test(link)) && factLinks.links.some((link) => /^https:\/\/github\.com\/mira-k$/.test(link))
    && factLinks.links.some((link) => /milestone/.test(link)) && factLinks.links.some((link) => /issues\/24$/.test(link)) && factLinks.openAbout, JSON.stringify(factLinks));
  await conv.click('[data-thread-file][data-lines="245,247"]');
  const fileTold = await conv.evaluate(() => window.apostilSent.filter((message) => message.type === 'openFileTab').at(-1));
  check('the description is folded to about five lines with "Show more" and opens on a click; a large picture is at most 360 px high and never wider than the text, and a click shows it large; a picture that does not load is its text and a link; a Mermaid block is drawn, with no stray word "Loading"',
    about.lines >= 4 && about.lines <= 5.5 && about.more === 'Show more' && about.openHeight > about.closedHeight
    && extras.picture.height <= 361 && extras.picture.width <= extras.picture.text && extras.picture.large && extras.broken === 'Picture: the old panel' && extras.mermaid && !extras.loading, JSON.stringify({ about, extras }));
  check('a resolved thread is one folded, faded row with who resolved it, and a click unfolds it; a hidden comment is one quiet row with the reason, and a click shows it; an outdated thread says "Outdated"; the folded code lines of a thread are drawn only when he opens them; a click on the file of a thread asks for the file tab at its lines',
    /resolved by mira-k.*hold_service\.py 230.*2 messages/.test(feed.before.text) && !feed.before.shown && feed.before.faded < 1 && feed.unfolded
    && /Hidden by GitHub as off topic/.test(feed.hiddenText) && !feed.hiddenShown && feed.hiddenOpen && feed.outdated === 'Outdated'
    && extras.early.length >= 2 && extras.early.every((count) => count === 0) && extras.drawn > 0
    && fileTold?.path === 'src/library/lending/hold_service.py' && fileTold.lines?.join() === '245,247', JSON.stringify({ feed, early: extras.early, drawn: extras.drawn, fileTold }));
  check('"Messages": earlier messages are one row, drawn when he opens it; messages of one author within minutes share one avatar; commits in a row are one row "4 commits" that unfolds to the short hashes; a long message shows its first lines and "Show all"; day lines, review cards with their verdict, chips for reactions, a heading as the title line; comments of one product are one row with a count; equal messages are one row with a count; a run of force pushes is one row',
    /^2 earlier messages · 2 commits · 1 event/.test(feed.earlier) && feed.messagesAfter === feed.messagesBefore + 2 && feed.same >= 1
    && feed.commitText === '4 commits' && feed.commitRows.join() === '9e2d4b7,5d0a3e1,8a1d2e3,2c3d4e5' && feed.longAfter > feed.longBefore + 50
    && modern.days.length >= 2 && modern.days.includes('Yesterday') && modern.verdict.includes('asked for changes') && modern.verdict.includes('approved') && modern.chips >= 2 && modern.title.includes('Pre-merge review')
    && modern.products.length === 1 && modern.products[0] === 'GitHub Actions · 2 comments' && modern.productInner === 0 && modern.repeat.some((one) => /^posted 2 times/.test(one))
    && modern.runs.includes('3 force pushes'), JSON.stringify({ feed, modern }));
  check('a deployment is a quiet row with its state and "View deployment"; a comment on a removed file says "file removed"; commits say "Verified", a bot and an author with no account; a bot has a quiet mark; only events of an unknown kind are counted',
    modern.deploy.some((row) => /deployed to preview ready View deployment/.test(row)) && modern.deploy.some((row) => /deployed to staging failed/.test(row))
    && modern.whole.some((head) => /file removed/.test(head)) && modern.verified === 1 && modern.people.includes('Dependabot (bot)') && modern.people.includes('Ana Pereira')
    && feed.bot >= 1 && feed.notShown === '1 event of an unknown kind is not shown. See them on GitHub.', JSON.stringify({ modern, bot: feed.bot, notShown: feed.notShown }));

  // Classic and back; the choice is kept for the window.
  await conv.click('[data-mode="classic"]');
  await frames(conv, 8);
  // The window of "Classic" opens at the first row that he has not seen, as "Messages" does, with an empty mark in place of the line (GitHub's look has none).
  // In the example that is an answer of others in an earlier review thread, which stands above the newer rows, as on GitHub.
  const classicOpen = await conv.evaluate(() => {
    const at = document.querySelector('.conv [data-first-unseen]');
    const room = document.getElementById('cscroll');
    return { at: at?.dataset.said ? 'answer' : at?.id === 'new-line' ? 'mark' : at ? at.className : null, line: !!document.querySelector('.conv .new'),
      edge: Math.round((at?.getBoundingClientRect().top ?? -99) - room.getBoundingClientRect().top), shows: Math.round(room.scrollTop), inWindow: !!at && room.contains(at) };
  });
  await conv.evaluate(() => scrollTo(0, 0));
  await convShot('62-conversation-classic');
  const classic = await conv.evaluate(() => ({ boxes: document.querySelectorAll('.conv .gbox').length, events: document.querySelectorAll('.conv .ev').length, gfold: document.querySelectorAll('.conv .thread.gfold').length,
    hidden: document.querySelectorAll('.conv .hidbox').length, newLine: !!document.getElementById('new-line'), on: document.querySelector('[data-mode].on').textContent,
    days: document.querySelectorAll('.conv .dayline').length, products: document.querySelectorAll('.conv .prod, .conv .prods').length, runs: document.querySelectorAll('.conv .evrun').length,
    reports: [...document.querySelectorAll('.conv .gbox')].filter((box) => /Test report/.test(box.textContent)).length,
    shownResolved: document.querySelector('.conv .gfold .gbtn .show')?.textContent, card: document.querySelector('.conv > .pcard')?.textContent, box: !!document.querySelector('.conv .tl .merge, .conv .tl .pcard'),
    verified: document.querySelectorAll('.conv .ev .vf').length, marks: [...document.querySelectorAll('.conv .gh .lab')].map((el) => el.textContent),
    side: (() => { const side = document.querySelector('.conv .cside').getBoundingClientRect(); const main = document.querySelector('.conv .cmain').getBoundingClientRect(); return side.left >= main.right - 1; })() }));
  await resize(conv, 760);
  const narrowSide = await conv.evaluate(() => { const side = document.querySelector('.conv .cside').getBoundingClientRect(); const main = document.querySelector('.conv .cmain').getBoundingClientRect(); return { under: side.bottom <= main.top + 1, title: side.top > document.querySelector('.conv .ptitle').getBoundingClientRect().bottom }; });
  await resize(conv, 1400);
  const classicTimes = await timesIn();
  await conv.click('.switch a[data-view="diagram"]');
  await settle(conv);
  await conversationAfter(() => conv.click('.switch a[data-view="conversation"]'));
  const keptMode = await conv.evaluate(() => document.querySelector('[data-mode].on')?.textContent);
  await conv.click('[data-mode="messages"]');
  await frames(conv, 8);
  const backMode = await conv.evaluate(() => ({ on: document.querySelector('[data-mode].on').textContent, line: !!document.getElementById('new-line') }));
  // The facts start at the left edge of the title, with no padding from a style rule of the code views; a long label does not break the row.
  check('the line of facts under the title starts at the left edge of the title; the side facts are one quiet line with labels, reviewers, assignee, milestone, the issue it closes and tasks, "Details" opens them, a long label does not break the row; "Classic" has them as a column at the right at 1400 px and under the title at 760 px',
    !!factsLine && Math.abs(factsLine.indent) <= 1 && factsLine.padding === '0px'
    && /backend.*4 reviewers.*mira-k.*Version 0\.5, due .*closes #24.*1 of 2 tasks/.test(facts.text) && facts.labels.every((one) => one.fits && one.lines <= 1)
    && facts.sections.join() === 'Reviewers,Assignees,Labels,Milestone,Closes,Tasks' && facts.team && classic.side && narrowSide.under && narrowSide.title, JSON.stringify({ factsLine, facts, side: classic.side, narrowSide }));

  // The window opens as a chat app opens a conversation; the page always opens at its top. The window opens at the same first unseen message also after
  // a later read that knows the newer time he looked (a write reads the pull request again); at its newest message when nothing is unseen; at its first
  // message when he never opened it. The tasks in "Details" go to their list in the description.
  const placeOf = () => conv.evaluate(async () => {
    await App.render();
    await new Promise((done) => setTimeout(done, 400)); // the place is set again for a few frames until it holds
    const room = document.getElementById('cscroll');
    const line = document.getElementById('new-line');
    return { page: Math.round(scrollY), line: line ? Math.round(line.getBoundingClientRect().top - room.getBoundingClientRect().top) : null,
      top: Math.round(room.scrollTop), toEnd: Math.round(room.scrollHeight - room.clientHeight - room.scrollTop) };
  });
  const pullLink = await conv.evaluate(() => App.pullLink());
  const keptLook = await conv.evaluate((link) => ({ since: App.since.get(link), read: App.read[link].lastLooked }), pullLink);
  await conv.evaluate((link) => { App.read[link] = { ...App.read[link], lastLooked: new Date().toISOString() }; }, pullLink);
  const afterRead = await placeOf();
  await conv.evaluate((link) => App.since.set(link, new Date().toISOString()), pullLink);
  await resize(conv, 1400, 520); // the last messages fill a lower window, so that it has something to scroll
  const allSeen = await placeOf();
  await resize(conv, 1400);
  await conv.evaluate((link) => App.since.set(link, undefined), pullLink);
  const neverOpened = await placeOf();
  await conv.evaluate(({ link, kept }) => { App.since.set(link, kept.since); App.read[link] = { ...App.read[link], lastLooked: kept.read }; }, { link: pullLink, kept: keptLook });
  await placeOf();
  await conv.evaluate(() => scrollTo(0, 0));
  await conv.click('.conv .facts .fmore');
  const tasksLink = await conv.evaluate(() => document.querySelector('.conv .fsec [data-tasks]')?.textContent ?? '');
  await conv.click('.conv .fsec [data-tasks]', { timeout: 3000 }).catch(() => {});
  await frames(conv, 4);
  const tasksShown = await conv.evaluate(() => {
    const task = document.querySelector('.conv .about input[type="checkbox"]')?.closest('li')?.getBoundingClientRect();
    return { open: !!document.querySelector('.conv .about.open'), inView: !!task && task.top >= 0 && task.bottom <= innerHeight };
  });
  check('the page of a pull request always opens at its top; its window of the conversation opens at the first message that he has not seen also when a later read knows the look of now, at its newest message when he has seen all, and at its first message when he never opened it; "Tasks" in "Details" is a link that opens the description at its tasks',
    afterRead.line !== null && afterRead.line >= 0 && afterRead.line <= 12 && afterRead.top > 0 && afterRead.page === 0
      && allSeen.line === null && allSeen.top > 0 && allSeen.toEnd <= 2 && allSeen.page === 0 && neverOpened.line === null && neverOpened.top === 0 && neverOpened.toEnd > 0 && neverOpened.page === 0
      && tasksLink === '1 of 2 tasks' && tasksShown.open && tasksShown.inView,
    JSON.stringify({ afterRead, allSeen, neverOpened, tasksLink, tasksShown }));
  check('the time has one place in each look: in "Messages" no clock and no time at the right of a row; the first message of a group has one relative time in its name line after a middle dot, with the exact time in its tooltip, and a later message of the group has none, its exact time in its tooltip; in "Classic" every time follows its words',
    messageTimes.count > 5 && messageTimes.clocks === 0 && messageTimes.rights.every((gap) => gap > 20)
    && messageTimes.firsts.length > 5 && messageTimes.firsts.every((one) => one.count === 1 && one.tip && one.dot && /^(\d+ (min|h) ago|yesterday|just now|\d+ days ago)$/.test(one.words))
    && messageTimes.laters.length >= 1 && messageTimes.laters.every((one) => one.times === 0 && one.tip)
    && classicTimes.count > 10 && classicTimes.rights.every((gap) => gap > 20), JSON.stringify({ messageTimes, classicTimes }));
  check('"Classic" shows every comment in a box in the order of GitHub, folds only resolved, outdated and hidden, and its window opens at the first row that he has not seen with no line; its state is the card at the top, with no merge box at the end; the choice stays for the window; "Messages" comes back',
    classic.boxes >= 10 && classic.events >= 15 && classic.gfold === 3 && classic.hidden === 1 && classicOpen.at === 'answer' && !classicOpen.line && classicOpen.inWindow && classicOpen.edge >= 0 && classicOpen.edge <= 12 && classicOpen.shows > 0 && classic.on === 'Classic' && keptMode === 'Classic' && backMode.on === 'Messages' && backMode.line
    && classic.days === 0 && classic.products === 0 && classic.reports === 2 && classic.runs === 0 && classic.shownResolved === 'Show resolved' && /^Blocked.*Waits for #9 below it in the stack · 2 checks failed · An approving review is needed/.test(classic.card) && !classic.box
    && classic.verified === 1 && classic.marks.includes('Author') && classic.marks.includes('bot'), JSON.stringify({ classicOpen }) + JSON.stringify({ classic, keptMode, backMode }));

  // "Messages" as a chat: three messages of one person a minute apart are one group, with one avatar
  // and one name; his own message stands at the right in a tinted bubble, with no avatar. Made-up messages are added at the end of the example for this.
  // (The time of a group and the rows on the line have checks of their own above.)
  await conversationAfter(() => conv.evaluate(() => {
    const link = App.pullLink();
    window.keptPull = App.read[link];
    const pull = window.keptPull.pull;
    const at = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
    const said = (id, author, minutes, text, more = {}) => ({ kind: 'comment', id, author, at: at(minutes), edited: false, html: `<p>${text}</p>`, reactions: [], url: link, ...more });
    const ada = { login: 'ada-made-up', avatar: '', bot: false };
    const items = [...pull.items, said('group-1', ada, 9, 'I ran the night job on a copy of the data.'), said('group-2', ada, 8, 'Two holds were offered twice.'),
      said('group-3', ada, 7, 'Both had a pause that ended on that day.'), said('own-1', pull.viewer, 4, 'Thanks, I will look at the pauses.', { mine: true })];
    App.read[link] = { ...window.keptPull, pull: { ...pull, items } };
    App.render();
  }));
  const chat = await conv.evaluate(() => {
    const room = document.getElementById('cscroll');
    room.scrollTop = room.scrollHeight;
    const rows = [...room.querySelectorAll('.feed > .msg')].slice(-4);
    const group = rows.slice(0, 3);
    const own = rows[3];
    const feed = room.querySelector('.feed').getBoundingClientRect();
    const bubble = own?.querySelector('.bub');
    const box = bubble?.getBoundingClientRect();
    return {
      texts: rows.map((row) => row.querySelector('.tx')?.textContent),
      avatars: group.map((row) => row.querySelectorAll('.av:not(.gap)').length), names: group.map((row) => [...row.querySelectorAll('.top b:not(.sr)')].map((b) => b.textContent).join()),
      same: group.map((row) => row.classList.contains('same')),
      own: own && box && { avatar: own.querySelectorAll('.av').length, right: Math.round(feed.right - box.right), left: Math.round(box.left - feed.left), width: Math.round(feed.width),
        tint: getComputedStyle(bubble).backgroundColor !== getComputedStyle(document.getElementById('cwin')).backgroundColor, name: own.querySelector('.sr')?.textContent },
    };
  });
  await conv.evaluate(() => document.getElementById('cwin').scrollIntoView({ block: 'end' }));
  await frames(conv);
  await takePicture(conv.locator('#cwin'), '78-a-group-and-his-own-message.png');
  await conversationAfter(() => conv.evaluate(() => { App.read[App.pullLink()] = window.keptPull; App.render(); }));
  check('"Messages" reads like a chat: three messages of one person a minute apart are one group with one avatar and one name; his own message stands at the right in a tinted bubble with no avatar (his name only for a screen reader)',
    chat.texts.join('|') === 'I ran the night job on a copy of the data.|Two holds were offered twice.|Both had a pause that ended on that day.|Thanks, I will look at the pauses.'
    && chat.avatars.join() === '1,0,0' && chat.names.join('|') === 'ada-made-up||' && chat.same.join() === 'false,true,true'
    && chat.own?.avatar === 0 && chat.own.right <= 2 && chat.own.left > chat.own.width / 3 && chat.own.tint && chat.own.name === 'you', JSON.stringify({ chat }));

  // The other pull request of the branch, from the small choice in the strip. A merged one: the strip says who merged it; "closed" right after "merged" is left out.
  await conv.click('#status [data-pulls]');
  const choice = await conv.$$eval('.win.pulls [data-pick]', (all) => all.map((row) => [row.querySelector('.pri').className, row.textContent]));
  await conversationAfter(() => conv.click('.win.pulls [data-pick="11"]'));
  const merged = await conv.evaluate(() => ({ icon: document.querySelector('#status .pri')?.className, title: document.querySelector('.conv .ptitle')?.textContent, none: document.querySelector('.conv .about-none')?.textContent,
    strip: document.querySelector('#status .status')?.textContent, events: [...document.querySelectorAll('.conv .row.ev .what')].map((el) => el.textContent) }));
  check('the choice lists the pull requests of the branch with their icons, and a pick shows that one; a merged pull request: the strip says who merged it and when, and no more, and "closed" right after "merged" is left out',
    choice.length === 2 && choice[0][0] === 'pri git-pull-request red' && choice[1][0] === 'pri git-merge purple'
    && merged.icon === 'pri git-merge purple' && merged.title === 'First half of the holds #11' && merged.none === 'No description'
    && /^merged ?#11Merged by jonas-b on .+ with a squash(1 more pull request)?$/.test(merged.strip) && !/review|checks/.test(merged.strip) && !merged.events.some((one) => /closed it/.test(one)), JSON.stringify({ choice, merged }));
  await conversationAfter(() => conv.evaluate(() => { App.state.pull = 12; App.render(); }));

  // ----- writing to GitHub from the conversation. As a file in a browser a send goes to the example, which answers as GitHub does: nothing reaches GitHub. -----
  // A write shows its result at once and the answer comes in the background: the page is never drawn anew for it. `window.apostilExampleHold` holds the
  // answer of the example until `window.apostilExampleRelease()`, so that a check sees the page while it waits.
  const LINK12 = 'https://example.com/made-up/pull/12';
  const writes = () => conv.evaluate(() => window.apostilSent.filter((message) => message.type === 'write').map((message) => message.write));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const nothingYet = (await writes()).length === 0; // the page has loaded, drawn both looks and changed its view: no write so far
  const reply = '[data-gh="reply:thread-3"]';
  const fieldState = (selector) => conv.evaluate((sel) => {
    const box = document.querySelector(sel);
    const field = box?.querySelector('textarea');
    return box && { placeholder: field?.placeholder, height: field?.offsetHeight, button: box.querySelector('.gha')?.offsetHeight ?? 0, buttonText: box.querySelector('[data-gh-send]')?.textContent,
      flip: box.querySelector('[data-gh-resolve]')?.textContent, value: field?.value, focus: !!field && document.activeElement === field, error: box.querySelector('.gherr')?.textContent ?? '' };
  }, selector);
  /** What the conversation shows around a write: the place, the draws, the other threads, the end of the feed and the line of new messages. */
  const around = () => conv.evaluate(() => ({
    scrollY: Math.round(scrollY), draws: window.apostilConversations, folds: [...document.querySelectorAll('.conv [data-thread]')].map((one) => `${one.dataset.thread}:${one.classList.contains('open') ? 'open' : one.classList.contains('folded') ? 'folded' : 'shown'}`).join(),
    earlier: !document.querySelector('.conv [data-earlier]'), messages: document.querySelectorAll('.conv .feed .msg').length, last: [...document.querySelectorAll('.conv .feed > .msg')].at(-1)?.textContent ?? '',
    line: document.querySelector('.conv #new-line')?.textContent ?? '',
  }));
  const release = () => conv.evaluate(() => { window.apostilExampleHold = false; window.apostilExampleRelease?.(); });
  const noSending = (selector) => conv.waitForFunction((sel) => !document.querySelector(sel)?.querySelector('.t.ex, .lab')?.textContent.includes('sending'), selector, { timeout: 3000 });

  // He opened the earlier messages and the resolved thread there: an answer elsewhere keeps both open.
  await conv.click('.conv [data-earlier]');
  await conv.click('.conv [data-thread="thread-1"] .resolved');
  await conv.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), reply);
  const quiet = await fieldState(reply);
  await conv.click(`${reply} textarea`);
  const openField = await fieldState(reply);
  await conv.keyboard.type('Moved it, and a test covers it.');
  const placeBefore = await conv.evaluate((sel) => Math.round(document.querySelector(sel).getBoundingClientRect().top), reply);
  const aroundBefore = await around();
  await conv.evaluate(() => { window.apostilExampleHold = true; });
  await conv.keyboard.press('Meta+Enter');
  await conv.waitForFunction(() => /Moved it/.test([...document.querySelectorAll('[data-thread="thread-3"] .sc')].at(-1)?.textContent ?? ''), null, { timeout: 3000 });
  const whileSending = await conv.evaluate(() => [...document.querySelectorAll('[data-thread="thread-3"] .sc')].at(-1).textContent);
  const answeredNow = await fieldState(reply);
  // The field stands where it stood, lower by the new message above it, in the view.
  const placeNow = await conv.evaluate((sel) => {
    const box = document.querySelector(sel).getBoundingClientRect();
    return { top: Math.round(box.top), added: Math.round([...document.querySelectorAll('[data-thread="thread-3"] .sc')].at(-1).getBoundingClientRect().height), inView: box.bottom <= innerHeight };
  }, reply);
  const aroundNow = await around();
  await convShot('68-an-answer-in-a-thread-sending');
  await release();
  await noSending('[data-thread="thread-3"]');
  const answeredText = await conv.evaluate(() => [...document.querySelectorAll('[data-thread="thread-3"] .sc')].at(-1)?.textContent);
  const aroundAfter = await around();
  await convShot('68a-an-answer-in-a-thread');
  // GitHub's next read lists his answer as a later answer too: drawn anew, it stands in its thread only, and is not new to him.
  await conversationAfter(() => conv.evaluate(() => App.render()));
  const drawnAgain = await around();
  const inThread = await conv.evaluate(() => [...document.querySelectorAll('[data-thread="thread-3"] .sc')].filter((one) => /Moved it/.test(one.textContent)).length);
  check('an answer in a thread stands at once as the last message of that thread, marked "sending" until GitHub answers; it is no new message at the end and not "new since you last looked", also when drawn anew; the field is empty, keeps the focus and stands under the new message, in view; the scroll place, the opened earlier messages and the other threads stay, and the conversation is not drawn anew',
    nothingYet && quiet.placeholder === 'Answer…' && quiet.button === 0 && quiet.flip === 'Resolve' && openField.height > quiet.height && openField.buttonText === 'Answer'
    && same(await writes(), [{ kind: 'reply', threadId: 'thread-3', body: 'Moved it, and a test covers it.' }])
    && /you.*sending.*Moved it, and a test covers it\./.test(whileSending) && /you.*example.*Moved it, and a test covers it\./.test(answeredText)
    && answeredNow.value === '' && answeredNow.focus && Math.abs(placeNow.top - placeNow.added - placeBefore) <= 2 && placeNow.inView
    && [aroundNow, aroundAfter].every((one) => one.draws === aroundBefore.draws && one.scrollY === aroundBefore.scrollY && one.folds === aroundBefore.folds && one.earlier
      && one.messages === aroundBefore.messages && one.last === aroundBefore.last && one.line === aroundBefore.line)
    && /thread-1:open/.test(aroundBefore.folds) && !/Moved it/.test(drawnAgain.last) && drawnAgain.line === aroundBefore.line && inThread === 1,
    JSON.stringify({ nothingYet, quiet, openField, whileSending, answeredText, answeredNow, placeBefore, placeNow, aroundBefore, aroundNow, aroundAfter, drawnAgain, inThread }));

  // Resolve folds only that thread, at once; Unresolve opens it again.
  await conv.click('.conv [data-earlier]');
  await conv.click('.conv [data-thread="thread-1"] .resolved');
  await conv.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), reply);
  const resolveBefore = await around();
  await conv.evaluate(() => { window.apostilExampleHold = true; });
  await conv.click(`${reply} [data-gh-resolve]`);
  const folding = await conv.evaluate(() => {
    const thread = document.querySelector('[data-thread="thread-3"]');
    return { folded: thread.classList.contains('folded'), open: thread.classList.contains('open'), row: thread.querySelector('.resolved')?.textContent, shown: thread.querySelector('.resolved')?.getBoundingClientRect().top >= 0 };
  });
  const resolveNow = await around();
  await conv.evaluate(() => scrollBy(0, -320)); // the picture shows the open threads above it too
  await convShot('69-a-resolved-thread-among-open-ones');
  await release();
  await noSending('[data-thread="thread-3"] .resolved');
  const resolvedRow = await conv.evaluate(() => document.querySelector('[data-thread="thread-3"] .resolved')?.textContent);
  await conv.click('.conv [data-thread="thread-3"] .resolved');
  await conv.focus(`${reply} [data-gh-resolve]`);
  await conv.keyboard.press('Enter'); // Unresolve, from the keyboard
  await conv.waitForFunction((sel) => document.querySelector(sel)?.querySelector('[data-gh-resolve]')?.textContent === 'Resolve', reply, { timeout: 3000 }).catch(() => {}); // the check says what it saw
  const unresolved = await conv.evaluate(() => { const thread = document.querySelector('[data-thread="thread-3"]'); return { folded: thread.classList.contains('folded'), field: !!thread.querySelector('textarea')?.offsetParent }; });
  const others = (folds) => folds.split(',').filter((one) => !one.startsWith('thread-3')).join();
  check('"Resolve" folds that thread at once into one row "resolved by you", marked "sending" until GitHub answers; the other threads keep their state and the scroll place stays; Enter on "Unresolve" opens it again with its field',
    same((await writes()).slice(1), [{ kind: 'resolve', threadId: 'thread-3' }, { kind: 'unresolve', threadId: 'thread-3' }])
    && folding.folded && !folding.open && /resolved by you.*sending/.test(folding.row) && folding.shown && /resolved by you/.test(resolvedRow) && !/sending/.test(resolvedRow)
    && others(resolveNow.folds) === others(resolveBefore.folds) && /thread-1:open/.test(resolveNow.folds) && resolveNow.scrollY === resolveBefore.scrollY && resolveNow.draws === resolveBefore.draws
    && !unresolved.folded && unresolved.field,
    JSON.stringify({ folding, resolvedRow, resolveBefore, resolveNow, unresolved }));

  // A write that fails puts the thing back as it was, says why in the thread, and keeps his words.
  await conv.evaluate(() => { window.apostilExampleFailure = 'GitHub says: Resource not accessible by integration (HTTP 403)'; });
  await conv.click(`${reply} textarea`);
  await conv.keyboard.type('This answer fails.');
  await conv.keyboard.press('Meta+Enter');
  await conv.waitForFunction((sel) => document.querySelector(`${sel} .gherr`)?.textContent, reply, { timeout: 3000 });
  const failedAnswer = { ...await fieldState(reply), shown: await conv.evaluate(() => [...document.querySelectorAll('[data-thread="thread-3"] .sc')].filter((one) => /fails/.test(one.textContent)).length) };
  await conv.evaluate(() => { window.apostilExampleFailure = 'GitHub says: Could not resolve to a node with the global id.'; });
  await conv.click(`${reply} [data-gh-resolve]`);
  await conv.waitForFunction((sel) => /global id/.test(document.querySelector(`${sel} .gherr`)?.textContent ?? ''), reply, { timeout: 3000 });
  const failedResolve = await conv.evaluate(() => { const thread = document.querySelector('[data-thread="thread-3"]'); return { folded: thread.classList.contains('folded'), flip: thread.querySelector('[data-gh-resolve]')?.textContent, value: thread.querySelector('textarea')?.value }; });
  await convShot('69a-a-failed-answer-and-resolve');
  check('a write that fails puts the thing back as it was and says why in one line of that thread: a failed answer leaves the thread and its words are back in the field; a failed resolve opens the thread again with "Resolve"; nothing is sent again by itself',
    failedAnswer.value === 'This answer fails.' && failedAnswer.error === 'GitHub says: Resource not accessible by integration (HTTP 403)' && failedAnswer.shown === 0
    && !failedResolve.folded && failedResolve.flip === 'Resolve' && failedResolve.value === 'This answer fails.' && (await writes()).length === 5,
    JSON.stringify({ failedAnswer, failedResolve, writes: (await writes()).length }));
  await conv.evaluate(() => { const field = document.querySelector('[data-gh="reply:thread-3"] textarea'); field.value = ''; field.dispatchEvent(new Event('input', { bubbles: true })); document.activeElement?.blur(); });

  // A suggested change: the change of its lines with "Commit suggestion", which commits it to the branch with GitHub's message and resolves the thread.
  const suggestion = '[data-thread="thread-5"]';
  await conv.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), suggestion);
  const suggestionBox = () => conv.evaluate((sel) => {
    const box = document.querySelector(`${sel} .sugg`);
    return box && { head: box.querySelector('.sgh')?.textContent, rows: [...box.querySelectorAll('.l')].map((row) => `${row.className.trim()}|${row.querySelector('.x').textContent}`), buttons: [...box.querySelectorAll('[data-suggest]')].map((one) => one.textContent) };
  }, suggestion);
  const offered = await suggestionBox();
  await convShot('70-a-suggestion-with-its-button');
  await conv.click(`${suggestion} [data-suggest="batch"]`);
  const inBatch = await suggestionBox();
  await conv.click(`${suggestion} [data-suggest="unbatch"]`);
  await conv.evaluate(() => { window.apostilExampleHold = true; });
  await conv.click(`${suggestion} [data-suggest="commit"]`);
  const committing = await conv.evaluate((sel) => { const thread = document.querySelector(sel); return { folded: thread.classList.contains('folded') && !thread.classList.contains('open'), row: thread.querySelector('.resolved')?.textContent }; }, suggestion);
  await release();
  await noSending(`${suggestion} .resolved`);
  await conv.click(`${suggestion} .resolved`);
  const committed = { ...await suggestionBox(), head12: await conv.evaluate((link) => App.read[link].pull.headOid, LINK12) };
  check('a comment with a suggested change shows it as a change of its line, with "Commit suggestion" and "Add suggestion to batch" (in the batch: "Commit suggestions (1)" and "Remove from batch"); "Commit suggestion" sends one commit of that line to the branch with GitHub\'s message and its author as co-author, and the thread folds at once as applied; then it says the commit',
    same(offered?.rows, ['l del|        log.info("offered %s copies", counts.offered)', 'l add|        log.info("offered %d copies", counts.offered)']) && same(offered.buttons, ['Commit suggestion', 'Add suggestion to batch'])
    && same(inBatch?.buttons, ['Commit suggestions (1)', 'Remove from batch'])
    && same((await writes()).at(-1), { kind: 'suggestions', repo: 'made-up/example', branch: 'made-up/holds', headOid: '7c41b9e', threadIds: ['thread-5'],
      changes: [{ path: 'src/library/lending/hold_service.py', start: 242, end: 242, old: ['        log.info("offered %s copies", counts.offered)'], lines: ['        log.info("offered %d copies", counts.offered)'] }],
      message: { headline: 'Update hold_service.py', body: 'Co-authored-by: jonas-b <4242+jonas-b@users.noreply.github.com>' } })
    && committing.folded && /suggestion applied by you.*sending/.test(committing.row) && committed.head === 'Suggested changeCommitted as 5e6f7a8. Pull to have it here.' && committed.buttons.length === 0
    && /^5e6f7a8/.test(committed.head12) && (await writes()).length === 6,
    JSON.stringify({ offered, inBatch, committing, committed, last: (await writes()).at(-1) }));

  // The comment key in "Conversation" turns the pointer into the comment icon, as on every view; a click on a message opens the card there,
  // and "The pull request on GitHub" answers that message on GitHub: a comment that quotes it.
  const end = '.ghend [data-gh]';
  await conv.evaluate(() => { document.activeElement?.blur(); const field = document.querySelector('.ghend textarea'); field.value = 'Thanks'; field.dispatchEvent(new Event('input', { bubbles: true })); scrollTo(0, 0); });
  await conv.mouse.move(700, 400);
  await conv.keyboard.press('Meta+Shift+Period');
  const keyed = await conv.evaluate(() => ({ icon: /^url\("data:image\/svg\+xml/.test(getComputedStyle(document.querySelector('#view')).cursor), inField: document.activeElement?.tagName === 'TEXTAREA', link: !!document.querySelector('.conv .answer') }));
  const said = await conv.evaluate(() => {
    // The newest message of another person that is not in a thread on code, in the middle of the window of the conversation.
    const el = [...document.querySelectorAll('.conv .feed .msg[data-msg][data-remark]')].filter((one) => !one.classList.contains('mine') && !JSON.parse(one.dataset.remark).message.thread).at(-1);
    el.scrollIntoView({ block: 'center' });
    const { left, top, width } = el.getBoundingClientRect();
    return { id: el.dataset.msg, ...JSON.parse(el.dataset.remark).message, x: left + width / 2, y: top + 12 };
  });
  await conv.mouse.click(said.x, said.y);
  await conv.waitForSelector('.cbox.card [data-field="new"]:focus', { timeout: 3000 }).catch(() => {});
  keyed.head = await conv.textContent('.cbox.card .ch .where').catch(() => '');
  await conv.click('.cbox.card [data-pick="app"]');
  keyed.choices = await conv.$$eval('.cbox.card .pmenu .pi', (rows) => rows.map((row) => row.querySelector('span').firstChild.textContent));
  await convShot('71-the-picker-on-a-message');
  await conv.click('.cbox.card .pi[data-choice="github"]', { timeout: 3000 }).catch(() => {}); // a missing choice fails the check below, not the run
  await conv.keyboard.type('Looks right to me.');
  await conv.keyboard.press('Enter');
  await conv.waitForSelector('.cbox.card', { state: 'detached', timeout: 3000 }).catch(() => {});
  keyed.sent = (await writes()).at(-1);
  await conv.evaluate(() => { const field = document.querySelector('.ghend textarea'); field.focus(); field.setSelectionRange(field.value.length, field.value.length); });
  await conv.keyboard.type(' for the fix.');
  const endOpen = await fieldState(end);
  await conv.click(`${end} [data-gh-send]`);
  await conv.waitForFunction(() => /Thanks for the fix\./.test([...document.querySelectorAll('.conv .feed .msg')].at(-1)?.textContent ?? '') && !/sending/.test([...document.querySelectorAll('.conv .feed .msg')].at(-1)?.textContent), null, { timeout: 3000 });
  const commented = await fieldState(end);
  const lastItem = await conv.evaluate(() => [...document.querySelectorAll('.conv .feed .msg')].at(-1)?.textContent);
  check('the comment key in "Conversation" turns the pointer into the comment icon; a click on a message opens the card there, whose picker has "The pull request on GitHub", which posts a comment that quotes the message; the end of the conversation is still a field "Write a comment…" with "Comment"; the button sends it once and it stands last at once, marked as an example when the example answers',
    keyed.icon && !keyed.inField && !keyed.link && keyed.head === `${said.author} · message` && keyed.choices.includes('The pull request on GitHub') && keyed.choices.at(-1) === 'No agent: keep it as a note'
    && same(keyed.sent, { kind: 'comment', pullId: 'made-up-pull-12', body: `> @${said.author}: ${said.words}\n\nLooks right to me.` })
    && endOpen.placeholder === 'Write a comment…' && endOpen.buttonText === 'Comment'
    && same((await writes()).at(-1), { kind: 'comment', pullId: 'made-up-pull-12', body: 'Thanks for the fix.' }) && (await writes()).length === 8
    && /you.*example.*Thanks for the fix\./.test(lastItem) && commented.value === '' && commented.focus, JSON.stringify({ keyed, said, endOpen, commented, lastItem }));

  // A send that fails keeps its text and shows GitHub's sentence; nothing is sent again by itself. The text survives a redraw and a change of the view; he sends it again himself.
  await conv.evaluate(() => { window.apostilExampleFailure = 'GitHub says: Resource not accessible by integration (HTTP 403)'; });
  await conv.keyboard.type('This one fails.');
  await conv.keyboard.press('Meta+Enter');
  await conv.waitForFunction((sel) => document.querySelector(`${sel} .gherr`)?.textContent, end, { timeout: 3000 });
  const failedSend = { ...await fieldState(end), last: await conv.evaluate(() => [...document.querySelectorAll('.conv .feed .msg')].at(-1)?.textContent) };
  await conv.click('.switch a[data-view="diffs"]');
  await settle(conv);
  await conversationAfter(() => conv.click('.switch a[data-view="conversation"]'));
  await conversationAfter(() => conv.evaluate(() => App.render()));
  const survived = await fieldState(end);
  const failedCount = (await writes()).length; // after the change of the view and the redraw: still the one failed send
  await conv.click(`${end} textarea`);
  await conv.keyboard.press('Meta+Enter');
  await conv.waitForFunction(() => /This one fails\./.test([...document.querySelectorAll('.conv .feed .msg')].at(-1)?.textContent ?? ''), null, { timeout: 3000 });
  const resent = await fieldState(end);
  check('a failed send keeps its text and shows GitHub\'s own sentence under the field, and the comment that showed goes; nothing is sent again by itself; the text survives a change of the view and a redraw; he sends it again himself with Cmd+Enter, and it goes once',
    failedSend.value === 'This one fails.' && failedSend.error === 'GitHub says: Resource not accessible by integration (HTTP 403)' && !/This one fails/.test(failedSend.last) && failedCount === 9
    && survived.value === 'This one fails.' && resent.value === '' && resent.error === '' && (await writes()).length === 10, JSON.stringify({ failedSend, failedCount, survived, resent }));

  // The review: a quiet button in the strip opens a panel with the text, three verdicts and "Send review".
  await conv.evaluate(() => scrollTo(0, 0));
  await conv.click('#status [data-review]');
  const panelOf = () => conv.evaluate(() => {
    const panel = document.querySelector('#status .review-panel');
    return panel && { verdicts: [...panel.querySelectorAll('.ghv')].map((label) => `${label.querySelector('b').textContent}${label.querySelector('input').disabled ? ' (off)' : ''}`), lines: [...panel.querySelectorAll('.ghvl')].map((one) => one.textContent), titles: [...panel.querySelectorAll('.ghv.off')].map((one) => one.title),
      chosen: panel.querySelector('input:checked')?.value, button: panel.querySelector('[data-gh-send]')?.textContent, focus: document.activeElement === panel.querySelector('textarea'),
      strip: document.querySelector('#status .status').textContent };
  });
  const reviewPanel = await panelOf();
  // His own pull request: "Approve" and "Request changes" are greyed with GitHub's reason, and "Comment" is picked.
  await conversationAfter(() => conv.evaluate((link) => { App.read[link].pull.mine = true; App.render(); }, LINK12));
  const ownPanel = await panelOf();
  await conv.click('#status .review-panel textarea');
  await conv.keyboard.type('A note on my own work.');
  await conv.evaluate(() => scrollTo(0, 0));
  await convShot('71-the-review-on-his-own-pull-request');
  await conv.click('#status .review-panel [data-gh-send]');
  await conv.waitForFunction(() => /A note on my own work\./.test([...document.querySelectorAll('.conv .feed .card.review')].at(-1)?.textContent ?? ''), null, { timeout: 3000 }).catch(() => {});
  const ownSent = { write: (await writes()).at(-1), panel: !!(await conv.$('#status .review-panel')), last: await conv.evaluate(() => [...document.querySelectorAll('.conv .feed .card.review')].at(-1)?.textContent ?? '') };
  check('"Review" in the strip opens a panel with the text, "Comment", "Approve" and "Request changes", and "Send review"; the cursor is in its text; each verdict has its short line as on GitHub; on his own pull request "Approve" and "Request changes" are greyed and not pickable, the reason of GitHub stands in place of their line and is their title, "Comment" is picked, and "Send review" sends a comment review once',
    !!reviewPanel && reviewPanel.verdicts.join() === 'Comment,Approve,Request changes' && reviewPanel.chosen === 'COMMENT' && reviewPanel.button === 'Send review' && reviewPanel.focus
    && reviewPanel.lines[1] === 'Submit feedback and approve merging these changes.'
    && ownPanel?.verdicts.join() === 'Comment,Approve (off),Request changes (off)' && ownPanel.chosen === 'COMMENT'
    && ownPanel.lines.slice(1).join() === ownPanel.titles.join() && ownPanel.titles[0] === "Pull request authors can't approve their own pull request" && /^Pull request authors can't request changes/.test(ownPanel.titles[1]) && ownPanel.button === 'Send review'
    && same(ownSent.write, { kind: 'review', pullId: 'made-up-pull-12', verdict: 'COMMENT', body: 'A note on my own work.' }) && (await writes()).length === 11 && !ownSent.panel && /reviewed.*A note on my own work\./.test(ownSent.last),
    JSON.stringify({ reviewPanel, ownPanel, ownSent }));
  // The hint of the answer field: with a review that is not sent yet, an answer goes into it.
  const answerHint = () => conv.evaluate(() => document.querySelector('[data-gh^="reply:"] .ghh')?.textContent ?? '');
  const hintBefore = await answerHint();
  await conversationAfter(() => conv.evaluate((link) => { Object.assign(App.read[link].pull, { mine: false, pending: { id: 'made-up-review-1', comments: 2 } }); App.render(); }, LINK12));
  const hintWithReview = await answerHint();
  if (!(await conv.$('#status .review-panel'))) await conv.click('#status [data-review]');
  const pendingPanel = await panelOf();
  await conv.click('#status .review-panel .ghv:has(input[value="REQUEST_CHANGES"])'); // someone else's pull request: every verdict can be picked
  const pickedOther = await conv.evaluate(() => document.querySelector('#status .review-panel input:checked')?.value);
  await conv.click('#status .review-panel .ghv:has(input[value="APPROVE"])');
  await conv.click('#status .review-panel textarea');
  await conv.keyboard.type('Good to go.');
  await conv.keyboard.press('Meta+Enter');
  await conv.waitForFunction(() => /Good to go\./.test([...document.querySelectorAll('.conv .feed .card.review')].at(-1)?.textContent ?? '') && !/sending/.test([...document.querySelectorAll('.conv .feed > .msg')].at(-1)?.textContent), null, { timeout: 3000 });
  const reviewed = await conv.evaluate(() => ({ panel: !!document.querySelector('#status .review-panel'), strip: document.querySelector('#status .status').textContent, focus: document.activeElement?.matches('[data-review]'),
    last: [...document.querySelectorAll('.conv .feed .card.review')].at(-1)?.textContent }));
  check('his review that is not sent yet: the answer field of a thread says that the answer goes into it (with none it says nothing); the strip says "Your review is not sent: 2 comments"; Cmd+Enter sends that review with the verdict once, the panel closes and the review shows',
    pendingPanel.verdicts.join() === 'Comment,Approve,Request changes' && pickedOther === 'REQUEST_CHANGES' && hintBefore === '' && hintWithReview === 'This goes into your review that is not sent yet.'
    && /Your review is not sent: 2 comments/.test(pendingPanel?.strip) && same((await writes()).at(-1), { kind: 'review', pullId: 'made-up-pull-12', verdict: 'APPROVE', body: 'Good to go.', pendingId: 'made-up-review-1' })
    && (await writes()).length === 12 && !reviewed.panel && !/not sent/.test(reviewed.strip) && reviewed.focus && /approved.*Good to go\./.test(reviewed.last), JSON.stringify({ hintBefore, hintWithReview, pendingPanel, reviewed }));

  // A merged pull request has no "Review"; a locked conversation has no field and one line; an answer stored before these fields draws with no field.
  const fieldsNow = () => conv.evaluate(() => ({ fields: document.querySelectorAll('.conv textarea').length, review: !!document.querySelector('#status [data-review]'), lock: document.querySelector('.conv .ghlock')?.textContent ?? '' }));
  await conversationAfter(() => conv.evaluate(() => { App.state.pull = 11; App.render(); }));
  const mergedFields = await fieldsNow();
  await conversationAfter(() => conv.evaluate(() => { App.state.pull = 12; App.render(); }));
  await conversationAfter(() => conv.evaluate((link) => { App.read[link].pull.locked = true; App.render(); }, LINK12));
  const lockedFields = await fieldsNow();
  await conversationAfter(() => conv.evaluate((link) => {
    const read = App.read[link];
    const strip = (thread) => { const { canReply, canResolve, canUnresolve, ...rest } = thread; return rest; };
    const { id, locked, mine, pending, ...rest } = read.pull;
    const items = rest.items.map((item) => (item.kind === 'review' ? { ...item, threads: item.threads.map(strip) } : item.kind === 'thread' ? { ...item, thread: strip(item.thread) } : item));
    window.keptRead = read;
    App.read[link] = { pull: { ...rest, items }, lastLooked: read.lastLooked };
    App.render();
  }, LINK12));
  const oldFields = await fieldsNow();
  await conversationAfter(() => conv.evaluate((link) => { App.read[link] = window.keptRead; App.read[link].pull.locked = false; App.render(); }, LINK12));
  check('a merged pull request has no "Review" button, and its conversation still takes a comment; a locked conversation has no field and no "Review", and one line says that it is locked; an answer stored before the fields for writing were read still draws, with no field and no "Review"',
    !mergedFields.review && mergedFields.fields === 1 && !lockedFields.review && lockedFields.fields === 0 && lockedFields.lock === 'This conversation is locked. Nothing can be written here.'
    && oldFields.fields === 0 && !oldFields.review && !oldFields.lock, JSON.stringify({ mergedFields, lockedFields, oldFields }));

  // At 520 px and at 1400 px no field or button is cut off or overlaps another thing: the answer, the comment and the review panel, open. Nothing of this sends.
  const fits = [];
  for (const width of [520, 1400]) {
    await resize(conv, width);
    await conversationAfter(() => conv.evaluate(() => {
      for (const [selector, text] of [['[data-gh="reply:thread-3"] textarea', 'An answer that is not sent.'], ['.ghend textarea', 'A comment that is not sent.']]) {
        const field = document.querySelector(selector);
        field.value = text;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      App.render();
    }));
    if (!(await conv.$('#status .review-panel'))) await conv.click('#status [data-review]');
    const fit = await conv.evaluate(() => {
      const boxes = [...document.querySelectorAll('.conv .ghw, #status .review-panel')].filter((el) => el.offsetHeight > 0);
      // A part that the window of the conversation scrolls out of what it shows is not seen, so it overlaps nothing.
      const room = document.getElementById('cscroll').getBoundingClientRect();
      const seen = (el) => !el.closest('#cscroll') || (el.getBoundingClientRect().bottom > room.top && el.getBoundingClientRect().top < room.bottom);
      const parts = boxes.flatMap((box) => [...box.querySelectorAll('textarea, button, .ghk, .ghr, .ghv, .gherr')]).filter((el) => el.offsetHeight > 0 && seen(el));
      const over = parts.filter((el) => el.getBoundingClientRect().right > innerWidth + 1 || el.getBoundingClientRect().left < -1).map((el) => el.className || el.tagName);
      const hit = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
      const overlaps = [];
      for (const [index, a] of parts.entries()) for (const b of parts.slice(index + 1)) if (!a.contains(b) && !b.contains(a) && hit(a.getBoundingClientRect(), b.getBoundingClientRect())) overlaps.push(`${a.className || a.tagName} × ${b.className || b.tagName}`);
      return { boxes: boxes.length, parts: parts.length, over, overlaps: overlaps.slice(0, 5), sideways: document.documentElement.scrollWidth > innerWidth };
    });
    fits.push({ width, ...fit });
  }
  await conv.evaluate(() => {
    for (const selector of ['[data-gh="reply:thread-3"] textarea', '.ghend textarea']) { const field = document.querySelector(selector); field.value = ''; field.dispatchEvent(new Event('input', { bubbles: true })); }
    document.querySelector('#status [data-review]').click();
  });
  check('at 520 and 1400 px no field or button of writing to GitHub is cut off or overlaps another thing; nothing was written by the page without a send: one write for each send, twelve in all',
    fits.every((fit) => fit.boxes >= 3 && fit.parts >= 8 && !fit.over.length && !fit.overlaps.length && !fit.sideways) && (await writes()).length === 12, JSON.stringify({ fits, writes: (await writes()).length }));

  // A failure says why in one line and offers "Try again", which reads again.
  await conv.evaluate(() => { App.read['https://example.com/made-up/pull/12'] = { problem: 'GitHub cannot be reached. Check the network.' }; return App.render(); });
  const problem = await conv.evaluate(() => document.querySelector('.conv-problem')?.textContent);
  await conversationAfter(() => conv.click('[data-retry]'));
  const retried = await conv.evaluate(() => !!document.querySelector('.conv .ptitle') && !document.querySelector('.conv-problem'));
  check('a failure is one plain line with "Try again", and "Try again" reads the pull request again', problem === 'GitHub cannot be reached. Check the network.Try again' && retried, `${problem}; ${retried}`);

  // ----- the state card: the state, three meters and the actions, under the facts line and above the description -----
  /** What the card and the strip show, and every filled button of the page in the colour of "Merge" ("Merge" is the only one, and only while it can merge). */
  const cardOf = () => conv.evaluate(() => {
    const card = document.getElementById('pcard');
    const probe = document.body.appendChild(Object.assign(document.createElement('i'), { style: 'background:var(--button)' }));
    const teal = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const target = (el) => el.dataset.cardGo ?? el.dataset.cardAct ?? (el.dataset.stackPull ? `pull ${el.dataset.number}` : el.dataset.link ? 'github' : '');
    return card && { kind: card.dataset.kind, headline: card.querySelector('.pct')?.textContent, say: card.querySelector('.pcs')?.textContent ?? '',
      blockers: [...card.querySelectorAll('.pcs .pcgo')].map((el) => `${el.textContent} → ${target(el)}`), meters: [...card.querySelectorAll('.pcmeter')].map((el) => `${el.querySelector('.pcml').textContent}: ${el.querySelector('.pcmv').textContent}`),
      links: [...card.querySelectorAll('.pcl a')].map((el) => el.textContent), error: card.querySelector('.gherr')?.textContent ?? '', after: card.previousElementSibling?.className, before: card.nextElementSibling?.className,
      filled: [...document.querySelectorAll('button, a')].filter((el) => el.getClientRects().length && getComputedStyle(el).backgroundColor === teal).map((el) => el.textContent.trim()),
      strip: document.querySelector('#status .status')?.textContent, stripIcon: document.querySelector('#status .pri')?.className, press: !!document.querySelector('#status [data-merge-go]'), review: !!document.querySelector('#status [data-review]') };
  });
  // The made-up #12 is blocked: each blocker names what blocks and leads to its fix. One of its four open threads was resolved above, so three are open.
  await conv.evaluate(() => scrollTo(0, 0));
  const blocked = await cardOf();
  await conv.evaluate(() => document.getElementById('pcard').scrollIntoView({ block: 'center' }));
  await takePicture(conv.locator('#pcard'), '76b-card-blocked.png');
  await conv.click('#pcard .pcgo[data-card-go="checks"]');
  const checksGo = await conv.evaluate(() => !!document.querySelector('#status .checks-panel'));
  await conv.click('#status [data-checks]');
  await conv.click('#pcard .pcgo[data-card-go="review"]');
  const reviewGo = await conv.evaluate(() => !!document.querySelector('#status .review-panel') && document.activeElement === document.querySelector('#status .review-panel textarea'));
  await conv.click('#status [data-review]');
  await conv.click('#pcard .pcgo[data-card-go="comments"]');
  const threadGo = await conv.evaluate(() => { const thread = document.querySelector('.conv [data-thread="thread-2"]'); const box = thread?.getBoundingClientRect(); return !!box && thread.offsetHeight > 0 && box.top >= 0 && box.top < innerHeight; });
  check('a blocked pull request: the card under the facts line and above the description says "Blocked" and names what blocks it, each a link to its fix (the pull request below, the list of checks, the review panel, the first open thread, which folds open); its meters count the checks, the threads and the approvals; no filled button and no "Merge" in the strip',
    blocked?.kind === 'blocked' && blocked.headline === 'Blocked' && /^facts/.test(blocked.after) && /^about/.test(blocked.before)
    && same(blocked.blockers, ['Waits for #9 below it in the stack → pull 9', '2 checks failed → checks', 'An approving review is needed → review', '1 check is still running → checks', '3 threads are not resolved → comments'])
    && same(blocked.meters, ['Checks: 2 failed · 1 running · 1 skipped · 8 passed', 'Comments: 3 of 5 unresolved', 'Approvals: 1 of 3 approved']) && same(blocked.links, ['Update branch', 'Convert to draft', 'Close pull request'])
    && blocked.filled.length === 0 && !blocked.press && checksGo && reviewGo && threadGo, JSON.stringify({ blocked, checksGo, reviewGo, threadGo }));

  // A pull request that can merge, as the read gives it: "Merge" is the one filled button; the press "Merge" of the strip opens the merge step in "Conversation";
  // "Confirm merge" sends the method, the title, the message and the head, the card says "Merging…", then the merged state in place.
  const asRead = (pull) => conv.evaluate(({ link, ready }) => {
    window.keptRead = window.keptRead ?? App.read[link];
    const read = ready ? { ...App.read[link], pull: structuredClone(APOSTIL_EXAMPLE.readyPull) } : window.keptRead;
    App.read[link] = read;
    APOSTIL_EXAMPLE.answers[`pull:${link}`] = read; // a read again after the merge gives the same pull request, as GitHub would
    return App.render();
  }, { link: LINK12, ready: pull });
  await conversationAfter(() => asRead(true));
  await conv.mouse.move(1, 1); // no hover from the clicks above in the pictures
  await conv.evaluate(() => scrollTo(0, 0));
  const ready = await cardOf();
  await takePicture(conv.locator('#status'), '76f-strip-with-merge.png');
  await conv.evaluate(() => document.getElementById('pcard').scrollIntoView({ block: 'center' }));
  await takePicture(conv.locator('#pcard'), '76a-card-ready.png');
  await conv.click('.switch a[data-view="diffs"]');
  await settle(conv);
  const pressElsewhere = await conv.evaluate(() => !!document.querySelector('#status [data-merge-go]'));
  await conversationAfter(() => conv.click('#status [data-merge-go]'));
  const stepOf = () => conv.evaluate(() => {
    const card = document.getElementById('pcard');
    const box = card.getBoundingClientRect();
    return { view: App.state.view, methods: [...card.querySelectorAll('.pcway input')].map((one) => `${one.value}${one.checked ? ' (chosen)' : ''}`), title: card.querySelector('[data-merge-field="title"]')?.value,
      body: card.querySelector('[data-merge-field="body"]')?.value, inView: box.top >= 0 && box.bottom <= innerHeight, focus: document.activeElement?.dataset.mergeField ?? '', merge: !!card.querySelector('[data-card-act="merge"]') };
  });
  const mergeStep = await stepOf();
  await takePicture(conv.locator('#pcard'), '76c-merge-step.png');
  await conv.click('#pcard .pcway input[value="MERGE"]');
  const mergeCommit = await stepOf();
  await conv.click('#pcard .pcway input[value="SQUASH"]');
  await conv.click('#pcard [data-merge-field="title"]');
  await conv.keyboard.press('End');
  await conv.keyboard.type(' and the shelf');
  const filledInStep = (await cardOf()).filled;
  await conv.evaluate(() => { window.apostilExampleHold = true; });
  await conv.click('#pcard [data-card-act="confirm"]');
  const merging = await cardOf();
  await release();
  await conv.waitForFunction(() => document.getElementById('pcard')?.dataset.kind === 'merged', null, { timeout: 3000 }).catch(() => {});
  const mergedCard = await cardOf();
  await conv.evaluate(() => document.getElementById('pcard').scrollIntoView({ block: 'center' }));
  await takePicture(conv.locator('#pcard'), '76d-card-merged.png');
  check('a pull request that can merge: "Ready to merge" with one sentence, and "Merge" is the only filled button of the page; the strip, also in "Diffs", has the press "Merge", which opens "Conversation" at the card with its merge step: the methods of the repo with GitHub\'s method for him chosen, and the commit title and message that GitHub fills (a merge commit has its own); "Confirm merge" sends the method, his title, the message and the head once, the card says "Merging…", then "Merged" by him as its commit with "Delete branch", and the strip says it',
    ready?.kind === 'ready' && ready.headline === 'Ready to merge' && ready.say === 'Approved by jonas-b and lena-s, and all 11 checks passed (1 skipped).' && same(ready.filled, ['Merge']) && ready.press && pressElsewhere
    && mergeStep.view === 'conversation' && same(mergeStep.methods, ['MERGE', 'SQUASH (chosen)', 'REBASE']) && mergeStep.title === 'Holds for books that are out (#12)' && /^\* Add the hold tables/.test(mergeStep.body) && mergeStep.inView && mergeStep.focus === 'title' && !mergeStep.merge
    && mergeCommit.title === 'Merge pull request #12 from made-up/holds' && mergeCommit.body === 'Holds for books that are out' && same(filledInStep, ['Confirm merge'])
    && merging?.kind === 'merging' && merging.headline === 'Merging…' && merging.say === 'Squash into made-up/hold-store' && merging.filled.length === 0 && merging.links.length === 0
    && same((await writes()).at(-1), { kind: 'merge', pullId: 'made-up-pull-12', method: 'SQUASH', title: 'Holds for books that are out (#12) and the shelf', body: mergeStep.body, headOid: '7c41b9e' })
    && mergedCard?.headline === 'Merged' && mergedCard.say === 'By you just now, as 9c4e2a1' && same(mergedCard.links, ['Delete branch']) && mergedCard.filled.length === 0
    && /git-merge purple/.test(mergedCard.stripIcon) && /Merged by you with a squash/.test(mergedCard.strip) && !mergedCard.press && !mergedCard.review,
    JSON.stringify({ ready, pressElsewhere, mergeStep, mergeCommit, filledInStep, merging, mergedCard, write: (await writes()).at(-1) }));
  await conversationAfter(() => asRead(false));

  // Close: it shows at once, sends its write once, and GitHub answers in the background; a close that fails puts the pull request back and says why in the card.
  await conv.evaluate(() => scrollTo(0, 0));
  const keptFacts = await conv.evaluate((link) => JSON.stringify(App.read[link].pull), LINK12);
  const putBack = () => conv.evaluate(({ link, facts }) => { const pull = App.read[link].pull; const before = JSON.parse(facts); for (const key of Object.keys(pull)) if (!(key in before)) delete pull[key]; Object.assign(pull, before); return App.render(); }, { link: LINK12, facts: keptFacts });
  const writesBeforeClose = (await writes()).length;
  await conv.evaluate(() => { window.apostilExampleHold = true; });
  await conv.click('#pcard [data-card-act="close"]');
  const closing = await cardOf();
  await release();
  await conv.waitForFunction(() => !document.querySelector('#pcard .t.ex'), null, { timeout: 3000 }).catch(() => {});
  const closed = { ...await cardOf(), write: (await writes()).at(-1) };
  await conversationAfter(putBack);
  await conv.evaluate(() => { window.apostilExampleFailure = 'GitHub says: Resource not accessible by integration (HTTP 403)'; });
  await conv.click('#pcard [data-card-act="close"]');
  await conv.waitForFunction(() => document.querySelector('#pcard .gherr'), null, { timeout: 3000 }).catch(() => {});
  const failedClose = await cardOf();
  check('"Close pull request" shows the closed state at once in the card and the strip, marked "sending", with no "Review", and sends its write once; a close that fails puts the pull request back and says GitHub\'s reason in one line of the card',
    closing?.kind === 'closed' && /^Closed\s*sending$/.test(closing.headline) && closing.say === 'By you just now, not merged' && /git-pull-request-closed red/.test(closing.stripIcon) && !closing.review
    && closed.kind === 'closed' && closed.headline === 'Closed' && same(closed.write, { kind: 'close', pullId: 'made-up-pull-12' })
    && failedClose?.kind === 'blocked' && failedClose.error === 'GitHub says: Resource not accessible by integration (HTTP 403)' && failedClose.links.includes('Close pull request') && failedClose.review
    && (await writes()).length === writesBeforeClose + 2, JSON.stringify({ closing, closed, failedClose }));
  await conversationAfter(putBack);

  // Widths, in both looks, narrow (under 640 px) and wide: nothing cut off, no sideways scroll of the page; code lines of a thread wrap; the rows of the stack, open, stay inside.
  // "Classic" has a third layout between 640 and 1000 px, with its side facts under the title.
  const widthFits = [];
  let lineNarrow = null;
  for (const look of ['messages', 'classic']) {
    await conv.evaluate((name) => document.querySelector(`[data-mode="${name}"]`)?.click(), look);
    await frames(conv, 8);
    for (const width of look === 'classic' ? [370, 760, 1400] : [370, 1400]) {
      await resize(conv, width);
      if (look === 'messages' && width === 370) { // as he sees it, before the check opens every fold
        lineNarrow = await lineOf();
        await conv.evaluate(() => scrollTo(0, 0));
        await convShot('65-messages-at-370');
        await conv.evaluate(() => document.getElementById('cwin').scrollIntoView({ block: 'end' }));
        await frames(conv);
        await convShot('65a-the-window-at-370');
      }
      const fit = await conv.evaluate(() => {
        document.querySelectorAll('.conv [data-box]').forEach((box) => box.classList.add('open'));
        document.querySelector('[data-classic-more]')?.click();
        document.querySelector('.conv .stack:not(.open) .sline')?.click();
        scrollTo(0, 0);
        // A box that scrolls sideways, or a row that ends in dots. The window of the conversation scrolls only up and down: what is past its right edge is cut off.
        const scrolls = (el) => { for (let at = el.parentElement; at; at = at.parentElement) if (at.id !== 'cscroll' && ['auto', 'scroll', 'hidden'].includes(getComputedStyle(at).overflowX)) return true; return false; };
        const over = [...document.querySelectorAll('.conv *, #status *')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1 && !scrolls(el) && el.getBoundingClientRect().width > 0).map((el) => el.className || el.tagName).slice(0, 5);
        const rows = [...document.querySelectorAll('.conv .tcode .x')].filter((x) => x.offsetHeight > 0);
        const cut = rows.filter((x) => x.scrollWidth > x.clientWidth + 1).length;
        const long = rows.find((x) => /a long line that does not fit/.test(x.textContent));
        const rowHeight = parseFloat(getComputedStyle(document.querySelector('.conv .tcode')).lineHeight);
        const stackRows = [...document.querySelectorAll('.conv .srow')].filter((row) => row.offsetParent);
        return { sideways: document.documentElement.scrollWidth > innerWidth, over, cut, wraps: long ? long.offsetHeight > 1.5 * rowHeight : null,
          stackInside: stackRows.length === 3 && stackRows.every((row) => row.getBoundingClientRect().right <= innerWidth + 0.5) };
      });
      widthFits.push({ look, width, ...fit });
    }
  }
  check('both looks at 370 and 1400 px, and "Classic" at 760 px: no sideways scroll, nothing past the right edge, no code line of a thread cut off (at 760 px and less a long one wraps), and the open rows of the stack stay inside',
    widthFits.every((fit) => !fit.sideways && !fit.over.length && !fit.cut && fit.stackInside && (fit.width > 760 || fit.wraps === true)), JSON.stringify(widthFits));
  check('the line of "Messages" is a hairline in the colour of the lines, under everything: it runs behind the avatars, through their middle, from the first to the last row of the feed, at 1400 and at 370 px',
    [lineWide, lineNarrow].every((line) => line && line.width === '1px' && line.colour && line.under && line.top <= 0 && line.bottom >= 0
      && line.avatars.length >= 6 && line.avatars.every((off) => Math.abs(off) <= 1) && line.ringed), JSON.stringify({ lineWide, lineNarrow }));
  // The dark theme of VS Code: every text of "Classic" is readable on its background. The group "looks" checks "Messages" in the dark theme.
  await conv.evaluate(() => { document.body.classList.add('vscode-dark'); document.documentElement.style.setProperty('--vscode-editor-background', '#1e1e1e'); });
  const readable = await conv.evaluate(() => {
    const rgb = (text) => { const parts = (text.match(/[\d.]+/g) ?? []).map(Number); return text.startsWith('color(srgb') ? [...parts.slice(0, 3).map((part) => part * 255), parts[3] ?? 1] : parts; }; // color-mix() gives color(srgb …)
    const lum = ([r, g, b]) => { const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    // The colour behind an element: the first background that is not see-through, laid over the ones under it.
    const behind = (el) => { for (let at = el; at; at = at.parentElement) { const [r, g, b, a = 1] = rgb(getComputedStyle(at).backgroundColor); if (a > 0.5) return [r, g, b]; } return rgb(getComputedStyle(document.body).backgroundColor); };
    const texts = [...document.querySelectorAll('.conv .tx p, .conv .t, .conv .row .what, .conv .gh, .conv .lbl, .conv .ck .cn, .conv .mtitle, .conv .ptitle, #status .status > span, .conv .fline, .conv .cside h4, .conv .verdict')]
      .filter((el) => el.offsetHeight > 0 && el.textContent.trim());
    const low = texts.map((el) => {
      const [fg, bg] = [rgb(getComputedStyle(el).color), behind(el)];
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      return { el: el.className || el.tagName, ratio: Math.round(((a + 0.05) / (b + 0.05)) * 10) / 10 };
    }).filter((one) => one.ratio < 3);
    return { mode: document.querySelector('[data-mode].on')?.textContent, count: texts.length, low: low.slice(0, 6), body: getComputedStyle(document.body).backgroundColor };
  });
  check('"Classic" on a dark theme: every text is readable (contrast at least 3 to 1)', readable.mode === 'Classic' && readable.count > 20 && !readable.low.length, JSON.stringify(readable));
  await conv.evaluate(() => document.querySelector('[data-mode="messages"]')?.click());
  await frames(conv, 8);
  await conv.evaluate(() => { document.getElementById('cwin').scrollIntoView({ block: 'end' }); const room = document.getElementById('cscroll'); room.scrollTop = room.scrollHeight; });
  await frames(conv);
  await convShot('78b-messages-in-the-dark-theme'); // at the newest messages: his comments and reviews sent above, at the right
  await conv.evaluate(() => { document.body.classList.remove('vscode-dark'); document.documentElement.style.removeProperty('--vscode-editor-background'); });
  await frames(conv, 8);

  // A conversation of 500 made-up items opens fast and scrolls well.
  const big = await conv.evaluate(async () => {
    const link = 'https://example.com/made-up/pull/12';
    const base = App.read[link].pull;
    const people = ['ada-made-up', 'bo-made-up', 'cy-made-up', 'di-made-up'].map((login) => ({ login, avatar: '', bot: false }));
    const start = Date.parse(base.openedAt);
    const items = Array.from({ length: 500 }, (_, index) => {
      const at = new Date(start + index * 600_000).toISOString();
      const author = people[index % 4];
      if (index % 7 === 3) return { kind: 'commit', at, hash: `c${String(index).padStart(6, '0')}`, subject: `Step ${index}`, author };
      if (index % 11 === 5) return { kind: 'event', at, actor: author, text: 'force-pushed' };
      if (index % 13 === 6) return { kind: 'review', at, id: `r${index}`, author, edited: false, html: '<p>A review.</p>', reactions: [], url: link, state: 'reviewed', threads: base.items.find((item) => item.kind === 'review' && item.threads.length).threads };
      return { kind: 'comment', at, id: `m${index}`, author, edited: index % 5 === 0, html: `<p>Message ${index}: ${'some words '.repeat(index % 30)}</p>${index % 9 === 0 ? '<pre><code>a = 1\nb = 2</code></pre>' : ''}`, reactions: [], url: link };
    });
    App.read[link] = { pull: { ...base, items }, lastLooked: items[420].at };
    const drawn = window.apostilConversations;
    const t0 = performance.now();
    App.render();
    while (window.apostilConversations === drawn) await new Promise((done) => setTimeout(done, 5));
    const drawMs = performance.now() - t0;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const paintMs = performance.now() - t0;
    // Scroll through the whole window of the conversation in 40 steps, one frame each, and take the longest frame. The other parts of npm run check
    // run at the same time and can hold the computer for one frame (close to a second): over the limit, the pass is made once more, and the second counts.
    // A slow page is slow in both passes.
    const room = document.getElementById('cscroll');
    const height = room.scrollHeight;
    const scrollPass = async () => {
      let longest = 0;
      room.scrollTop = 0;
      await new Promise((done) => requestAnimationFrame(done));
      for (let step = 1; step <= 40; step++) {
        const before = performance.now();
        room.scrollTop = (height * step) / 40;
        await new Promise((done) => requestAnimationFrame(done));
        longest = Math.max(longest, performance.now() - before);
      }
      return longest;
    };
    const first = await scrollPass();
    const longest = first < 250 ? first : await scrollPass();
    document.querySelector('[data-earlier]')?.click();
    const t1 = performance.now();
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    return { drawMs: Math.round(drawMs), paintMs: Math.round(paintMs), longestFrameMs: Math.round(longest), firstPassMs: Math.round(first), unfoldMs: Math.round(performance.now() - t1), entries: document.querySelectorAll('.conv .feed > *').length, line: document.getElementById('new-line')?.textContent };
  });
  console.log(`      500 items: ${JSON.stringify(big)}`);
  // The longest frame is 40 to 60 ms alone; npm run check runs every group at the same time with a real VS Code window, where it can reach 155 ms (and
  // close to a second in a first pass, scrollPass).
  check('a conversation of 500 items opens in under a second and scrolls with no frame over 250 ms', big.paintMs < 1000 && big.longestFrameMs < 250 && /New since you last looked/.test(big.line), JSON.stringify(big));
  await conv.close();

  // A real pull request read by view/pull-request-data.ts opens as "?pull=<file>"; here a made-up one, written the same way, of another repo.
  const pullOnly = await newPage({ viewport: { width: 1000, height: 800 } });
  pullOnly.on('pageerror', (error) => errors.push(error.message));
  await pullOnly.goto(`file://${pageFile}`);
  await pullOnly.waitForFunction(() => window.APOSTIL_EXAMPLE, null, { timeout: 15000 });
  const other = await pullOnly.evaluate(async () => {
    const read = APOSTIL_EXAMPLE.answers['pull:https://example.com/made-up/pull/12'];
    App.page = { ...App.page, pullOnly: { link: read.pull.url, number: 12, local: false, otherRepo: true }, files: read.pull.files, parts: [] };
    App.read[read.pull.url] = read;
    App.state.view = 'conversation';
    await App.render();
    const conversation = !!document.querySelector('.conv .ptitle');
    const shown = [...document.querySelectorAll('.bar .switch a:not([hidden])')].map((a) => a.textContent).join(' · ');
    App.showDiffs();
    await App.drawing;
    return { conversation, shown, files: [...document.querySelectorAll('.pfiles .pf')].map((row) => row.textContent), line: document.querySelector('.pline')?.textContent, crumb: document.getElementById('crumb').textContent };
  });
  check('a pull request of another repo has only "Conversation" and "Files", the list of its changed files with their counts, and is a step of the path',
    other.conversation && other.shown === 'Conversation · Files' && other.files.length === 3 && /pickup_days\.py\+640 −32/.test(other.files[1]) && /another repo/.test(other.line) && /Pull request #12$/.test(other.crumb), JSON.stringify(other));
  // A Mermaid block may bring its own CSS in its config ("themeCSS"). The drawing stays in its box: it cannot cover the title or the rest of the page.
  const covered = await pullOnly.evaluate(async () => {
    const read = structuredClone(APOSTIL_EXAMPLE.answers['pull:https://example.com/made-up/pull/12']);
    read.pull.html = '<pre data-mermaid>%%{init: {"themeCSS": "position:fixed;left:0;top:0;width:100vw;height:100vh"}}%%\nflowchart LR\n  a --&gt; b</pre>';
    App.read[read.pull.url] = read;
    App.state.view = 'conversation';
    await App.render();
    for (let wait = 0; wait < 100 && !document.querySelector('.conv .mmd svg'); wait++) await new Promise((done) => setTimeout(done, 50));
    scrollTo(0, 0);
    const title = document.querySelector('.conv .ptitle').getBoundingClientRect();
    const hit = document.elementFromPoint(title.left + 4, title.top + title.height / 2);
    return { drawn: !!document.querySelector('.conv .mmd svg'), hit: hit?.closest('.mmd') ? 'the drawing' : hit?.className };
  });
  check('a Mermaid block of a pull request that brings its own CSS stays in its box and does not cover the page', covered.drawn && covered.hit === 'ptitle', JSON.stringify(covered));
  // A pull request of this repo with no stored change (its line of words for an agent is checked in the group "ask").
  await pullOnly.evaluate(() => {
    const read = APOSTIL_EXAMPLE.answers['pull:https://example.com/made-up/pull/12'];
    App.page = { ...App.page, pullOnly: { link: read.pull.url, number: 35, local: false, otherRepo: false, fetch: 'git fetch origin pull/35/head' }, files: read.pull.files, parts: [] };
  });
  // Its commits are not in the folder: Apostil gets them itself, and "Diffs" says so meanwhile; when that fails it says why, with the command.
  const fetchLines = await pullOnly.evaluate(async () => {
    const lineOf = async (more) => {
      App.page = { ...App.page, pullOnly: { ...App.page.pullOnly, ...more } };
      App.state.view = 'diffs';
      await App.render();
      return document.querySelector('#view .pline')?.textContent ?? '';
    };
    return { getting: await lineOf({ fetching: true }), failed: await lineOf({ fetching: false, fetchProblem: 'fatal: could not read from the remote.' }) };
  });
  check('the "Diffs" of a pull request whose commits are not in the folder says that Apostil gets them, and when that fails, why, with the command',
    fetchLines.getting === 'Getting the commits of this pull request from GitHub…'
    && /^Apostil could not get the commits of this pull request: fatal: could not read from the remote\. Get them with git fetch origin pull\/35\/head, then open it again\.$/.test(fetchLines.failed), JSON.stringify(fetchLines));
  await pullOnly.close();

  // ----- "@github" in the comment box on code: in the open diffs of the list of "Diagram" ("Diffs" opens no diff), on an added line,
  // a removed line and a range; in a file tab; and where it is not offered -----
  const code = await newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  code.on('pageerror', (error) => errors.push(error.message));
  const codeWrites = () => code.evaluate(() => window.apostilSent.filter((message) => message.type === 'write').map((message) => message.write));
  const LINK = 'https://example.com/made-up/pull/12';
  const SERVICE = 'src/library/lending/hold_service.py';
  await code.goto(`file://${pageFile}`);
  await code.waitForFunction((link) => !!App.read[link]?.pull, LINK, { timeout: 15000 });
  await code.evaluate(async () => { Split.setHidden('code', false); await App.drawing; App.diffs.list.setAll(true); });
  /** Scrolls a row of a diff into the middle of the list, and waits until it is drawn there. */
  const showRow = async (selector) => {
    await code.evaluate(async ({ sel, file }) => {
      const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const section = () => document.querySelector(`.dfile[data-file="${file}"]`);
      // Its rows load when it comes into view; the diffs above it fill too, and it can move: it is scrolled to until it has rows and stays where it is.
      for (let at = 0, top = null; at < 40; at++) {
        section().scrollIntoView({ block: 'start' });
        await frame();
        const now = Math.round(section().getBoundingClientRect().top);
        if (section().querySelector('.cn .l') && now === top) break;
        top = now;
      }
      // The list scrolls by itself, under the line of tabs, and draws only the rows in view: it goes down half a view at a time until the row is drawn.
      const list = document.querySelector('#view > .alone, #view > .half.right');
      for (let at = 0; at < 24 && !document.querySelector(sel); at++) {
        list.scrollTop += list.clientHeight / 2;
        await frame();
      }
      document.querySelector(sel)?.scrollIntoView({ block: 'center' });
      await frame(); // the rows in view are drawn again after a scroll
    }, { sel: selector, file: /data-file="([^"]+)"/.exec(selector)[1] });
    await code.waitForSelector(selector, { timeout: 5000 });
  };
  /** Presses the comment key with the pointer on a row and clicks it: the box opens on that line. */
  const boxOn = async (selector) => {
    await showRow(selector);
    const box = await code.$eval(selector, (el) => { const rect = el.getBoundingClientRect(); return { x: rect.left + 160, y: rect.top + rect.height / 2 }; });
    await code.mouse.move(box.x, box.y);
    await code.keyboard.press('Meta+Shift+Period');
    await code.mouse.click(box.x, box.y);
    await code.waitForSelector('.cbox [data-field="new"]', { timeout: 3000 });
  };
  const boxState = () => code.evaluate(() => {
    const box = document.querySelector('.cbox:not(.ask)');
    return box ? { where: box.querySelector('.where')?.textContent, line: box.querySelector('.cbline')?.hidden ? '' : box.querySelector('.cbline')?.textContent, error: box.querySelector('.cbline')?.classList.contains('err'), text: box.querySelector('[data-field]').innerText.trim() } : null;
  });
  const choicesNow = () => code.$$eval('.mentions .opt', (rows) => rows.map((row) => `${row.querySelector('.nm').textContent} | ${row.querySelector('.does').textContent}`));
  /** Types "@gi", picks "@github" with Enter, types the text and sends with Enter; waits until the box closed, or says that GitHub refused it. */
  const sendWithGitHub = async (text) => {
    await code.keyboard.type('@gi');
    await code.waitForSelector('.mentions .opt', { timeout: 3000 });
    const offered = await choicesNow();
    const before = (await codeWrites()).length;
    await code.keyboard.press('Enter');
    await code.keyboard.type(text);
    await code.keyboard.press('Enter');
    await code.waitForFunction((n) => window.apostilSent.filter((message) => message.type === 'write').length > n && (!document.querySelector('.cbox') || !!document.querySelector('.cbox .cbline.err')), before, { timeout: 3000 });
    return offered;
  };

  await boxOn(`.dfile[data-file="${SERVICE}"] .cn .l.add[data-line="12"]`);
  const addedBox = await boxState();
  await takePicture(code, '75-github-in-the-comment-box.png');
  const addedOffered = await sendWithGitHub('Check the lock here.');
  const addedSent = (await codeWrites()).at(-1);
  const addedClosed = !(await code.$('.cbox'));
  check('the comment box on an added line says that "@github" exists; "@" offers it as "a comment on pull request #12"; Enter posts it on that line, on the side of the file as it is now, at the head commit',
    addedBox?.line === 'Type @github to post it on pull request #12.' && addedOffered.at(-1) === 'github | a comment on pull request #12' && addedClosed
    && JSON.stringify(addedSent) === JSON.stringify({ kind: 'lines', pullId: 'made-up-pull-12', commit: '7c41b9e', lines: { path: SERVICE, line: 12, side: 'RIGHT' }, body: 'Check the lock here.' }),
    JSON.stringify({ addedBox, addedOffered, addedSent, addedClosed }));

  // A removed line: its number in the file as it was, on the old side.
  const removedAt = await code.evaluate(async () => {
    for (const section of document.querySelectorAll('.diffs .dfile:not(.quiet)')) {
      const file = App.page.files.find((one) => one.path === section.dataset.file);
      if (!file?.removed || file.what || file.status !== 'changed') continue;
      section.scrollIntoView({ block: 'start' });
      for (let i = 0; i < 40 && !section.querySelector('.cn .l'); i++) await new Promise((done) => setTimeout(done, 50));
      const row = section.querySelector('.cn .l.del[data-old]');
      if (row) return { file: file.path, old: row.dataset.old };
    }
    return null;
  });
  await boxOn(`.dfile[data-file="${removedAt.file}"] .cn .l.del[data-old="${removedAt.old}"]`);
  const removedBox = await boxState();
  await sendWithGitHub('Why is this gone?');
  const removedSent = (await codeWrites()).at(-1);
  // A range: the lines that he selected. The selection is made after the rows in view are drawn again.
  await showRow(`.dfile[data-file="${SERVICE}"] .cn .l[data-line="20"]`);
  const range = await code.evaluate((file) => {
    const rows = [20, 23].map((line) => document.querySelector(`.dfile[data-file="${file}"] .cn .l[data-line="${line}"] .x`));
    const selection = getSelection();
    selection.removeAllRanges();
    const span = document.createRange();
    span.setStart(rows[0].firstChild ?? rows[0], 0);
    span.setEnd(rows[1].firstChild ?? rows[1], 1);
    selection.addRange(span);
    const box = rows[1].getBoundingClientRect();
    return { x: box.left + 100, y: box.top + box.height / 2 };
  }, SERVICE);
  await code.mouse.move(range.x, range.y);
  await code.keyboard.press('Meta+Shift+Period');
  await code.mouse.click(range.x, range.y);
  await code.waitForSelector('.cbox [data-field="new"]', { timeout: 3000 });
  const rangeBox = await boxState();
  await sendWithGitHub('These four lines belong in one function.');
  const rangeSent = (await codeWrites()).at(-1);
  check('on a removed line the box offers "@github" too, and the comment goes on the old side, at the line of the file as it was; on a range of selected lines it goes on that range: the start line and the line, on one side',
    /removed line/.test(removedBox?.where) && removedBox.line === 'Type @github to post it on pull request #12.'
    && JSON.stringify(removedSent?.lines) === JSON.stringify({ path: removedAt.file, line: Number(removedAt.old), side: 'LEFT' })
    && /lines 20–23/.test(rangeBox?.where) && JSON.stringify(rangeSent?.lines) === JSON.stringify({ path: SERVICE, line: 23, side: 'RIGHT', startLine: 20, startSide: 'RIGHT' }), JSON.stringify({ removedAt, removedBox, removedSent, rangeBox, rangeSent }));

  // His review that is not sent yet takes the comment, and the box says so before he sends. A failed post keeps the text in the box with GitHub's sentence, and sends nothing again.
  await code.evaluate((link) => { App.read[link].pull.pending = { id: 'made-up-review-2', comments: 1 }; }, LINK);
  await boxOn(`.dfile[data-file="${SERVICE}"] .cn .l.add[data-line="30"]`);
  const pendingBox = await boxState();
  await sendWithGitHub('Into the review.');
  const pendingSent = (await codeWrites()).at(-1);
  await code.evaluate((link) => { delete App.read[link].pull.pending; }, LINK);
  await code.evaluate(() => { window.apostilExampleFailure = 'GitHub says: Line could not be resolved'; });
  await boxOn(`.dfile[data-file="${SERVICE}"] .cn .l.add[data-line="40"]`);
  await sendWithGitHub('This one fails.');
  const failedBox = await boxState();
  await code.keyboard.press('Escape');
  const failedWrites = (await codeWrites()).length;
  check('with his review that is not sent yet the box says "This goes into your review that is not sent yet." and the comment goes into that review; a comment on code that GitHub refuses stays in the box with GitHub\'s sentence, and is not sent again',
    pendingBox?.line === 'Type @github to post it on pull request #12. This goes into your review that is not sent yet.' && pendingSent?.pendingId === 'made-up-review-2'
    && failedBox?.error && failedBox.line === 'GitHub says: Line could not be resolved' && /This one fails\./.test(failedBox.text) && failedWrites === 5, JSON.stringify({ pendingBox, pendingSent, failedBox, failedWrites }));

  // Where it is not offered: a line outside the diff, and a branch that is not at the commit of the pull request.
  await code.evaluate(({ link, file }) => { window.keptLines = App.read[link].lines; App.read[link].lines = { ...window.keptLines, files: { ...window.keptLines.files, [file]: { right: [[1, 5]], left: [] } } }; }, { link: LINK, file: SERVICE });
  await boxOn(`.dfile[data-file="${SERVICE}"] .cn .l.add[data-line="12"]`);
  const outsideBox = await boxState();
  await code.keyboard.type('@');
  await code.waitForSelector('.mentions .opt', { timeout: 3000 });
  const outsideChoices = await choicesNow();
  await code.keyboard.press('Escape');
  await code.keyboard.press('Escape');
  await code.evaluate((link) => { App.read[link].lines = { ...window.keptLines, atHead: false }; }, LINK);
  await boxOn(`.dfile[data-file="${SERVICE}"] .cn .l.add[data-line="12"]`);
  const behindBox = await boxState();
  await code.keyboard.press('Escape');
  await code.evaluate((link) => { App.read[link].lines = window.keptLines; }, LINK);
  check('on a line outside the diff "@github" is not offered, and one quiet line says why; when the branch here is not at the commit of the pull request, one quiet line says so',
    outsideBox?.line === 'GitHub takes a comment only on lines of its diff. This line is not in the diff of pull request #12.' && outsideChoices.length > 0 && !outsideChoices.some((one) => one.startsWith('github'))
    && behindBox?.line === 'The branch here is not at the commit of the pull request. Pull or push first.', JSON.stringify({ outsideBox, outsideChoices, behindBox }));
  await code.close();

  // In a file tab: the same box and the same choice.
  const tab = await newPage({ viewport: { width: 1400, height: 900 } });
  tab.on('pageerror', (error) => errors.push(error.message));
  await tab.goto(`file://${pageFile}?file=${encodeURIComponent(SERVICE)}`);
  await tab.waitForFunction((link) => !!App.read[link]?.pull && !!document.querySelector('.cv .l[data-line="15"]'), LINK, { timeout: 15000 });
  const row = await tab.$eval('.cv .l[data-line="15"]', (el) => { el.scrollIntoView({ block: 'center' }); const rect = el.getBoundingClientRect(); return { x: rect.left + 160, y: rect.top + rect.height / 2 }; });
  await tab.mouse.move(row.x, row.y);
  await tab.keyboard.press('Meta+Shift+Period');
  await tab.mouse.click(row.x, row.y);
  await tab.waitForSelector('.cbox [data-field="new"]', { timeout: 3000 });
  await tab.keyboard.type('@gi');
  await tab.waitForSelector('.mentions .opt', { timeout: 3000 });
  await tab.keyboard.press('Enter');
  await tab.keyboard.type('From the file tab.');
  await tab.keyboard.press('Enter');
  await tab.waitForFunction(() => window.apostilSent.some((message) => message.type === 'write'), null, { timeout: 3000 });
  const tabSent = await tab.evaluate(() => window.apostilSent.filter((message) => message.type === 'write').at(-1)?.write);
  check('in a file tab "@github" posts the comment on that line too', JSON.stringify(tabSent?.lines) === JSON.stringify({ path: SERVICE, line: 15, side: 'RIGHT' }) && tabSent.body === 'From the file tab.', JSON.stringify(tabSent));
  await tab.close();
  }

  // ----- a stack of pull requests: the made-up #12 is the middle of a stack of three, #9 below it and #13 on top -----
  // The strip that says each fact once, and the rows of the stack inside at 370 px, are checked with the conversation above.
  {
  const stack = await newPage({ viewport: { width: 1400, height: 900 } });
  stack.on('pageerror', (error) => errors.push(error.message));
  await stack.goto(`file://${pageFile}`);
  await stack.waitForFunction(() => (window.apostilRendered ?? 0) >= 1, null, { timeout: 15000 });
  await stack.click('.switch a[data-view="conversation"]');
  await stack.waitForFunction(() => (window.apostilConversations ?? 0) >= 1, null, { timeout: 8000 });
  await stack.click('.conv [data-mode="messages"]');
  const rowsOf = () => [...document.querySelectorAll('.conv .srow')].filter((row) => row.offsetParent).map((row) => ({
    text: row.textContent, icon: row.querySelector('.pri').className, tip: row.querySelector('.pri').dataset.tip, link: row.dataset.stackPull ?? null,
    oneLine: getComputedStyle(row.querySelector('.st')).whiteSpace === 'nowrap' && getComputedStyle(row.querySelector('.st')).textOverflow === 'ellipsis',
  }));
  const messages = await stack.evaluate((rowsCode) => {
    const rows = new Function(`return (${rowsCode})()`);
    const line = document.querySelector('.conv .stack .sline');
    const folded = rows().length;
    line.click();
    return { line: line.textContent.replace(/[▸▾]/g, ''), folded, rows: rows(), below: document.querySelector('.conv .meta .onpr')?.textContent, belowLink: document.querySelector('.conv .meta .onpr')?.dataset.stackPull };
  }, rowsOf.toString());
  await frames(stack, 8);
  await stack.evaluate(() => scrollTo(0, 0));
  await takePicture(stack, '70-stack-in-messages.png');
  await stack.click('.conv [data-mode="classic"]');
  const classic = await stack.evaluate((rowsCode) => {
    const rows = new Function(`return (${rowsCode})()`);
    const box = document.querySelector('.conv .tl > .stackbox');
    return { first: box === document.querySelector('.conv .tl').firstElementChild, beforeComment: !!box?.nextElementSibling?.querySelector('.gbox .gh'),
      head: box?.querySelector('.gh')?.textContent, place: document.querySelector('.conv .splace')?.textContent, rows: rows().map((row) => row.text) };
  }, rowsOf.toString());
  check('"Messages": under the title the line "2 of 3 in a stack onto main" holds the list of the stack, folded; a click opens three rows, the top first, each with its state icon, number and title on one line, and "this one"; beside the branches "on #9", the pull request below. "Classic": the same line, and the stack as a box above the first comment with its three rows and "this one"',
    messages.line === '2 of 3 in a stack onto main' && messages.below === 'on #9' && messages.belowLink === 'https://example.com/made-up/pull/9'
    && messages.folded === 0 && messages.rows.map((row) => row.text).join('|') === '#13Show the pickup day on the ready shelf|#12Holds for books that are outthis one|#9Store the holds'
    && messages.rows[0].icon === 'pri git-pull-request-draft grey' && messages.rows[1].icon === 'pri git-pull-request red' && messages.rows[1].link === null
    && messages.rows.every((row) => row.oneLine) && messages.rows[2].tip === '#9 · Review needed · 1 of 3 in a stack'
    && classic.first && classic.beforeComment && classic.place === '2 of 3 in a stack onto main' && classic.head === 'Stack of 3 pull requests onto main' && classic.rows.length === 3 && classic.rows[1].endsWith('this one'),
    JSON.stringify({ messages, classic }));
  // The line "Waits for #9 below it in the stack" in the bar: "#9" is the link of the row of #9 in the stack (the same handler), and "▸" opens the list of the stack under the bar.
  const wait = await stack.evaluate(() => {
    const status = document.getElementById('status');
    const link = status.querySelector('.msent .stkpull');
    const row = document.querySelector('.conv .srow[data-number="9"]');
    const before = status.querySelectorAll('.srow').length;
    status.querySelector('[data-stack-open]').click();
    const opened = [...status.querySelectorAll('.srow')].map((one) => one.textContent);
    status.querySelector('[data-stack-open]').click();
    return { text: link?.textContent, same: !!link && link.dataset.stackPull === row.dataset.stackPull && link.dataset.number === '9', before, opened, after: status.querySelectorAll('.srow').length, arrow: status.querySelector('[data-stack-open]').textContent };
  });
  check('"#9" in "Waits for #9 below it in the stack" opens that pull request as a row of the stack does, and the small arrow after the line opens the same list of the stack under the bar and closes it again',
    wait.text === '#9' && wait.same && wait.before === 0 && wait.opened.length === 3 && wait.opened.some((text) => /^#9Store the holds/.test(text)) && wait.after === 0 && wait.arrow === '▸', JSON.stringify(wait));
  // A click on another row asks for that pull request, as a step of the path: the line at the top keeps the way back.
  const asked = await stack.evaluate(() => {
    document.querySelector('.conv .srow[data-number="9"]').click();
    return window.apostilSent.find((message) => message.type === 'walk' && message.to?.tab === 'pull');
  });
  await stack.waitForURL(/pull=pull-data-9\.js/, { timeout: 5000 }).catch(() => {});
  const after = await stack.evaluate(() => ({ address: location.search, trail: (JSON.parse(sessionStorage.getItem('apostil-trail') ?? '{}').steps ?? []).map((step) => step.name) }));
  check('a click on another row asks for that pull request in the same tab, and the path keeps the way back',
    asked?.open === true && asked.to.link === 'https://example.com/made-up/pull/9' && asked.to.name === 'Pull request #9' && /pull=pull-data-9\.js/.test(after.address)
    && after.trail.slice(-2).join(' › ') === 'Pull request #12 › Pull request #9', JSON.stringify({ asked, after }));
  // The switch says "Code" for a change of one part with no diagram; the summary names the branch that a stacked change is compared with.
  await stack.goto(`file://${pageFile}`);
  await stack.waitForFunction(() => (window.apostilRendered ?? 0) >= 1, null, { timeout: 15000 });
  const onePart = await stack.evaluate(async () => {
    const page = App.page;
    App.page = { ...page, parts: [{ ...page.parts[0], diagrams: [] }], checks: { ...page.checks, filesInNoPart: [] }, baseBranch: 'made-up/hold-store' };
    await App.go({ level: 'change' });
    const result = { shown: [...document.querySelectorAll('.bar .switch a:not([hidden])')].map((a) => a.textContent).join(' · '), on: document.querySelector('.switch a.on')?.textContent,
      view: App.state.view, summary: document.getElementById('summary').textContent };
    App.page = page;
    await App.go({ level: 'change' });
    result.back = document.querySelector('.switch a[data-view="diagram"]').textContent;
    return result;
  });
  check('a change of one part with no diagram opens on its code, and the switch calls that view "Code"; with a diagram it says "Diagram" again; the summary line of a change on top of another branch says which branch it is compared with',
    onePart.view === 'code' && onePart.on === 'Code' && /^Conversation · Code · Diffs/.test(onePart.shown) && onePart.back === 'Diagram' && /^compared with made-up\/hold-store/.test(onePart.summary), JSON.stringify(onePart));
  await stack.close();
  }

  // ----- a change whose branch has a pull request opens at "Conversation" -----
  {
    const first = await newPage({ viewport: { width: 1280, height: 900 } });
    await first.goto(`file://${pageFile}?pulls=kept`);
    await first.waitForFunction(() => (window.apostilConversations ?? 0) >= 1, null, { timeout: 15000 });
    const kept = await first.evaluate(() => ({ view: App.state.view, on: document.querySelector('.switch a.on')?.textContent, switchText: [...document.querySelectorAll('.bar .switch a:not([hidden])')].map((a) => a.textContent).join(' · ') }));
    check('a change whose branch has a pull request, known when the page opens, opens at "Conversation" and its switch reads "Conversation · Diagram · Diffs"',
      kept.view === 'conversation' && kept.on === 'Conversation' && kept.switchText === 'Conversation · Diagram · Diffs', JSON.stringify(kept));
    // As VS Code sends it: a change with no pull request opens at "Diagram"; one whose pull requests are not known waits for them, then opens at "Conversation";
    // when they come after the wait, the page stays where it is.
    const sent = (message) => first.evaluate((m) => { window.postMessage(m, '*'); return new Promise((done) => setTimeout(done, 50)); }, message);
    const read = () => first.evaluate(() => ({ view: App.state.view, text: document.getElementById('view').textContent.slice(0, 60), switchText: [...document.querySelectorAll('.bar .switch a:not([hidden])')].map((a) => a.textContent).join(' · ') }));
    const own = await first.evaluate(() => ({ page: App.page, pulls: App.pulls }));
    await sent({ type: 'data', page: { ...own.page, changeId: 901 }, pulls: [] });
    const none = await read();
    await sent({ type: 'data', page: { ...own.page, changeId: 902 } });
    const waiting = await read();
    await sent({ type: 'pulls', pulls: own.pulls });
    await first.waitForFunction(() => App.state.view === 'conversation' && !App.awaitingPulls, null, { timeout: 5000 });
    await sent({ type: 'data', page: { ...own.page, changeId: 903 } });
    await first.waitForFunction(() => !App.awaitingPulls && App.state.view === 'diagram', null, { timeout: 5000 }); // the time is over: opens at what it knows
    await sent({ type: 'pulls', pulls: own.pulls });
    const late = await read();
    check('a change with no pull request opens at "Diagram" with "Diagram · Diffs"; while its pull requests are not known it says "Looking for the pull request of this branch…" and opens at "Conversation" when they come, and when they come after 1.5 seconds the page stays at "Diagram"',
      none.view === 'diagram' && none.switchText === 'Diagram · Diffs' && /^Looking for the pull request/.test(waiting.text) && late.view === 'diagram' && late.switchText === 'Conversation · Diagram · Diffs', JSON.stringify({ none, waiting, late }));
    await first.close();
  }

} catch (error) {
  check('the checks ran to the end', false, error.message.split('\n').slice(0, 14).join(' / '));
}
await finish();
