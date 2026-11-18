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
    const faces = [...(el?.querySelectorAll('.rv') ?? [])].map((one) => one.getBoundingClientRect());
    return { text: el?.textContent, reviewers: [...(el?.querySelectorAll('.rv') ?? [])].map((one) => one.title), avatars: el?.querySelectorAll('.rv .av').length, all: el?.querySelector('.msent')?.title,
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
    const count = el.querySelector('.rvs > i');
    pull.reviewers = [];
    el.innerHTML += Conversation.stripHtml(pull, pull, 0);
    drawStrip(); // the strip of the page again, so that a later click draws the real one
    return { shown: [...el.querySelectorAll('.rv')].map((one) => one.title), count: count?.textContent, rest: count?.title, none: el.querySelectorAll('.status')[1]?.textContent };
  });
  // The strip says each fact once: after the state, the review and the checks, only the rest of the merge sentence (in the title of .msent).
  check('the page of a change with a pull request has "Conversation" in the switch, and the status strip in one short line: the icon, the reviewers as avatars that lie over each other with a dot for the state, the checks, and the first thing before a merge with a count of the others, each fact once; with seven reviewers three avatars show, who asked for changes first and people before bots, and "+4" names the others; with no reviewer it says so in words',
    strip.switchText === 'Conversation · Diagram · Diffs' && strip.icon === 'pri git-pull-request red' && strip.masked
    && /2 of 12 checks failed▸Waits for #9 below it in the stack2 moreReview1 more pull request$/.test(strip.text) && !/approved|jonas/.test(strip.text)
    && strip.reviewers.join() === 'jonas-b: approved,lena-s: waiting,made-up/lending-team: waiting' && strip.avatars === 3 && strip.stacked && strip.dots === 'ok,wait,wait'
    && strip.all === 'Waits for #9 below it in the stack · 1 check is still running · 3 commits behind made-up/hold-store'
    && manyReviewers.shown.join() === 'cy: asked for changes,ana: approved,dee: approved' && manyReviewers.count === '+4'
    && manyReviewers.rest === 'review-bot: approved, ben: waiting, made-up/team: waiting, Copilot: commented' && /^(no review yet|review required)/.test(manyReviewers.none), JSON.stringify({ strip, manyReviewers }));
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
  const opened = await conv.evaluate(() => {
    const line = document.getElementById('new-line');
    return { line: line?.textContent, top: Math.round(line?.getBoundingClientRect().top ?? -1), scrolled: Math.round(scrollY), short: document.getElementById('short')?.classList.contains('on'),
      crumb: document.getElementById('crumb').textContent, looked: window.apostilSent.filter((message) => message.type === 'looked') };
  });
  await convShot('60-conversation-opened-at-new');
  const newest = await conv.evaluate(async () => {
    const on = document.getElementById('newest').classList.contains('on');
    const box = document.getElementById('newest').getBoundingClientRect();
    // The button stands in the middle of the lower edge, so it does not lie over "Resolve", the switch of looks or the end of a row at the right.
    const middle = Math.abs((box.left + box.right) / 2 - innerWidth / 2) < 4 && box.right < innerWidth - 200;
    document.getElementById('newest').click();
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); // the scroll event marks the button
    const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
    const off = !document.getElementById('newest').classList.contains('on');
    return { on, atEnd, off, middle };
  });
  const slimSwitch = await conv.evaluate(() => {
    const short = document.querySelector('#short');
    return { on: short?.classList.contains('on'), views: [...(short?.querySelectorAll('.switch a:not([hidden])') ?? [])].map((a) => a.textContent), marked: short?.querySelector('.switch a.on')?.textContent };
  });
  // The slim bar carries the switch of views, so that "Diagram" and "Diffs" are never scrolled away (a fault of a walk with fresh eyes); "Newest" stands in the middle (a fault of the trial with real sends).
  check('the conversation opens at the line "New since you last looked", under the slim bar that carries the switch of views; a "Newest" button shows in the middle of the lower edge when he is not at the end, and goes there; the page tells VS Code once that he looked now, and the line at the top ends with the pull request',
    /^New since you last looked · \d+$/.test(opened.line) && opened.top > 30 && opened.top < 120 && opened.scrolled > 0 && opened.short && newest.on && newest.middle && newest.atEnd && newest.off
    && slimSwitch.on && slimSwitch.views.includes('Diagram') && slimSwitch.views.includes('Diffs') && slimSwitch.marked === 'Conversation'
    && opened.looked.length === 1 && opened.looked[0].repo === 'made-up/example' && opened.looked[0].number === 12 && /›Pull request #12$/.test(opened.crumb), JSON.stringify({ opened, newest, slimSwitch }));
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
    const commitText = commits.querySelector('.row').textContent;
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
      days: text('.conv .dayline'), products: text('.conv .prods > .prow'), productInner: document.querySelector('.conv .prods .inner')?.offsetHeight ?? -1,
      repeat: text('.conv .rep'), runs: text('.conv .evrun > .row'), title: text('.conv .mtitle'), deploy: text('.conv .row.ev').filter((row) => /deployed/.test(row)),
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
  // The time has one place in each look: "Messages" at the right edge of each row; "Classic" right after the words.
  const timesIn = () => conv.evaluate(() => {
    const visible = [...document.querySelectorAll('.conv .feed .time')].filter((el) => el.offsetHeight > 0);
    const inBox = (el) => el.closest('.thread, .card, .prow');
    const feedRights = visible.filter((el) => !inBox(el)).map((el) => Math.round(el.getBoundingClientRect().right));
    // inside a thread card: at the right edge of its own row, within its padding
    const boxed = visible.filter(inBox).map((el) => { const row = el.closest('.sc, .prow, .top'); const style = getComputedStyle(row); return Math.round(row.getBoundingClientRect().right - parseFloat(style.paddingRight) - el.getBoundingClientRect().right); });
    // "Classic": no time at the right edge; each follows the words before it
    const followed = visible.map((el) => { const row = el.closest('.ev, .gh, .top'); return row ? Math.round(row.getBoundingClientRect().right - el.getBoundingClientRect().right) : 999; });
    return { count: visible.length, feedRights: [...new Set(feedRights)], boxed: [...new Set(boxed)], followed };
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
  // The row of a hidden comment was a corrected fault.
  check('a resolved thread is one folded, faded row with who resolved it, and a click unfolds it; a hidden comment is one quiet row with the reason, and a click shows it; an outdated thread says "Outdated"; the folded code lines of a thread are drawn only when he opens them; a click on the file of a thread asks for the file tab at its lines',
    /resolved by mira-k.*hold_service\.py 230.*2 messages/.test(feed.before.text) && !feed.before.shown && feed.before.faded < 1 && feed.unfolded
    && /Hidden by GitHub as off topic/.test(feed.hiddenText) && !feed.hiddenShown && feed.hiddenOpen && feed.outdated === 'Outdated'
    && extras.early.length >= 2 && extras.early.every((count) => count === 0) && extras.drawn > 0
    && fileTold?.path === 'src/library/lending/hold_service.py' && fileTold.lines?.join() === '245,247', JSON.stringify({ feed, early: extras.early, drawn: extras.drawn, fileTold }));
  // Messages of one author that share an avatar, the count of earlier commits and events, and a run of force pushes that repeated its day were corrected faults.
  check('"Messages": earlier messages are one row, drawn when he opens it; messages of one author within minutes share one avatar; commits in a row are one row "4 commits" that unfolds to the short hashes; a long message shows its first lines and "Show all"; day lines, review cards with their verdict, chips for reactions, a heading as the title line; comments of one product are one compact row with a count; equal messages are one row with a count; a run of force pushes is one row, with no day when the day line says it',
    /^2 earlier messages · 2 commits · 1 event/.test(feed.earlier) && feed.messagesAfter === feed.messagesBefore + 2 && feed.same >= 1
    && /4 commits/.test(feed.commitText) && feed.commitRows.join() === '9e2d4b7,5d0a3e1,8a1d2e3,2c3d4e5' && feed.longAfter > feed.longBefore + 50
    && modern.days.length >= 2 && modern.days.includes('Yesterday') && modern.verdict.includes('asked for changes') && modern.verdict.includes('approved') && modern.chips >= 2 && modern.title.includes('Pre-merge review')
    && modern.products.length === 1 && /GitHub Actions2 comments · Test report/.test(modern.products[0]) && modern.productInner === 0 && modern.repeat.some((one) => /^posted 2 times/.test(one))
    // On one day the day line above says the day, so the row does not repeat it. The example's times count back from now: at some hours the run lies on both sides of midnight and names its two days.
    && modern.runs.some((one) => /^3 force pushes(›| on [^›,]+, [^›]+›)/.test(one)), JSON.stringify({ feed, modern }));
  // Only events of an unknown kind are counted: a corrected fault of the survey of public pull requests.
  check('a deployment is a quiet row with its state and "View deployment"; a comment on a removed file says "file removed"; commits say "Verified", a bot and an author with no account; a bot has a quiet mark; only events of an unknown kind are counted',
    modern.deploy.some((row) => /deployed to preview ready View deployment/.test(row)) && modern.deploy.some((row) => /deployed to staging failed/.test(row))
    && modern.whole.some((head) => /file removed/.test(head)) && modern.verified === 1 && modern.people.includes('Dependabot (bot)') && modern.people.includes('Ana Pereira')
    && feed.bot >= 1 && feed.notShown === '1 event of an unknown kind is not shown. See them on GitHub.', JSON.stringify({ modern, bot: feed.bot, notShown: feed.notShown }));

  // Classic and back; the choice is kept for the window.
  await conv.click('[data-mode="classic"]');
  await frames(conv, 8);
  await conv.evaluate(() => scrollTo(0, 0));
  await convShot('62-conversation-classic');
  const classic = await conv.evaluate(() => ({ boxes: document.querySelectorAll('.conv .gbox').length, events: document.querySelectorAll('.conv .ev').length, gfold: document.querySelectorAll('.conv .thread.gfold').length,
    hidden: document.querySelectorAll('.conv .hidbox').length, newLine: !!document.getElementById('new-line'), on: document.querySelector('[data-mode].on').textContent,
    days: document.querySelectorAll('.conv .dayline').length, products: document.querySelectorAll('.conv .prod, .conv .prods').length, runs: document.querySelectorAll('.conv .evrun').length,
    reports: [...document.querySelectorAll('.conv .gbox')].filter((box) => /Test report/.test(box.textContent)).length,
    shownResolved: document.querySelector('.conv .gfold .gbtn .show')?.textContent, merge: document.querySelector('.conv .merge')?.textContent,
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
  // The facts at the left edge of the title: a style rule of the code views gave them its padding, a corrected fault; a long label once broke the row.
  check('the line of facts under the title starts at the left edge of the title; the side facts are one quiet line with labels, reviewers, assignee, milestone, the issue it closes and tasks, "Details" opens them, a long label does not break the row; "Classic" has them as a column at the right at 1400 px and under the title at 760 px',
    !!factsLine && Math.abs(factsLine.indent) <= 1 && factsLine.padding === '0px'
    && /backend.*4 reviewers.*mira-k.*Version 0\.5, due .*closes #24.*1 of 2 tasks/.test(facts.text) && facts.labels.every((one) => one.fits && one.lines <= 1)
    && facts.sections.join() === 'Reviewers,Assignees,Labels,Milestone,Closes,Tasks' && facts.team && classic.side && narrowSide.under && narrowSide.title, JSON.stringify({ factsLine, facts, side: classic.side, narrowSide }));
  check('the time has one place in each look: in "Messages" every time of the feed ends at the same right edge, and in a thread card at the right edge of its row; in "Classic" every time follows its words',
    messageTimes.count > 10 && messageTimes.feedRights.length === 1 && messageTimes.boxed.every((gap) => Math.abs(gap) <= 1)
    && classicTimes.count > 10 && classicTimes.followed.every((gap) => gap > 20), JSON.stringify({ messageTimes, classicTimes }));
  check('"Classic" shows every comment in a box in the order of GitHub, folds only resolved, outdated and hidden; the choice stays for the window; "Messages" comes back',
    classic.boxes >= 10 && classic.events >= 15 && classic.gfold === 3 && classic.hidden === 1 && !classic.newLine && classic.on === 'Classic' && keptMode === 'Classic' && backMode.on === 'Messages' && backMode.line
    && classic.days === 0 && classic.products === 0 && classic.reports === 2 && classic.runs === 0 && classic.shownResolved === 'Show resolved' && /Waits for #9 below it in the stack · 2 checks failed · An approving review is needed/.test(classic.merge)
    && classic.verified === 1 && classic.marks.includes('Author') && classic.marks.includes('bot'), JSON.stringify({ classic, keptMode, backMode }));

  // The other pull request of the branch, from the small choice in the strip. A merged one: the strip says who merged it; "closed" right after "merged" is left out.
  await conv.click('#status [data-pulls]');
  const choice = await conv.$$eval('.win.pulls [data-pick]', (all) => all.map((row) => [row.querySelector('.pri').className, row.textContent]));
  await conversationAfter(() => conv.click('.win.pulls [data-pick="11"]'));
  const merged = await conv.evaluate(() => ({ icon: document.querySelector('#status .pri')?.className, title: document.querySelector('.conv .ptitle')?.textContent, none: document.querySelector('.conv .about-none')?.textContent,
    strip: document.querySelector('#status .status')?.textContent, events: [...document.querySelectorAll('.conv .row.ev .what')].map((el) => el.textContent) }));
  check('the choice lists the pull requests of the branch with their icons, and a pick shows that one; a merged pull request: the strip says who merged it and when, and no more, and "closed" right after "merged" is left out',
    choice.length === 2 && choice[0][0] === 'pri git-pull-request red' && choice[1][0] === 'pri git-merge purple'
    && merged.icon === 'pri git-merge purple' && merged.title === 'First half of the holds #11' && merged.none === 'No description'
    && /^merged ?Merged by jonas-b on .+ with a squash(1 more pull request)?$/.test(merged.strip) && !/review|checks/.test(merged.strip) && !merged.events.some((one) => /closed it/.test(one)), JSON.stringify({ choice, merged }));
  await conversationAfter(() => conv.evaluate(() => { App.state.pull = 12; App.render(); }));

  // ----- writing to GitHub from the conversation. As a file in a browser a send goes to the example, which shows it at once: nothing reaches GitHub. -----
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
  await conv.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), reply);
  const quiet = await fieldState(reply);
  await conv.click(`${reply} textarea`);
  const openField = await fieldState(reply);
  await conv.keyboard.type('Moved it, and a test covers it.');
  const placeBefore = await conv.evaluate((sel) => Math.round(document.querySelector(sel).getBoundingClientRect().top), reply);
  await conversationAfter(() => conv.keyboard.press('Meta+Enter'));
  const answered = await fieldState(reply);
  const answeredText = await conv.evaluate((sel) => [...document.querySelector(sel).closest('.thread').querySelectorAll('.sc')].at(-1)?.textContent, reply);
  const placeAfter = await conv.evaluate((sel) => Math.round(document.querySelector(sel).getBoundingClientRect().top), reply);
  await convShot('68-an-answer-in-a-thread');
  check('an answer in a thread: a quiet field "Answer…" with "Resolve" beside it opens on a click; Cmd+Enter sends it once; it shows in its thread marked as an example, the field is empty, keeps the focus, and stands where it stood on the screen',
    nothingYet && quiet.placeholder === 'Answer…' && quiet.button === 0 && quiet.flip === 'Resolve' && openField.height > quiet.height && openField.button > 0 && openField.buttonText === 'Answer'
    && same(await writes(), [{ kind: 'reply', threadId: 'thread-3', body: 'Moved it, and a test covers it.' }])
    && /you.*example.*Moved it, and a test covers it\./.test(answeredText) && answered.value === '' && answered.focus && Math.abs(placeAfter - placeBefore) <= 2,
    JSON.stringify({ nothingYet, quiet, openField, answered, answeredText, placeBefore, placeAfter }));
  await conversationAfter(() => conv.click(`${reply} [data-gh-resolve]`));
  const resolvedNow = await conv.evaluate((sel) => {
    const box = document.querySelector(sel);
    const thread = box.closest('.thread');
    return { folded: thread.classList.contains('folded'), open: thread.classList.contains('open'), by: thread.querySelector('.resolved .by')?.textContent, flip: box.querySelector('[data-gh-resolve]')?.textContent, focus: document.activeElement === box.querySelector('[data-gh-resolve]') };
  }, reply);
  await conversationAfter(() => conv.keyboard.press('Enter')); // Unresolve, from the keyboard
  const unresolved = await fieldState(reply);
  check('"Resolve" sends once: the thread is resolved and stays open with "Unresolve" and the focus on it; Enter on it unresolves it',
    same((await writes()).slice(1), [{ kind: 'resolve', threadId: 'thread-3' }, { kind: 'unresolve', threadId: 'thread-3' }])
    && resolvedNow.folded && resolvedNow.open && resolvedNow.by === 'resolved by you' && resolvedNow.flip === 'Unresolve' && resolvedNow.focus && unresolved.flip === 'Resolve',
    JSON.stringify({ resolvedNow, unresolved }));

  // The comment at the end; the comment key puts the cursor at the end of its field.
  const end = '.ghend [data-gh]';
  await conv.evaluate(() => { document.activeElement?.blur(); const field = document.querySelector('.ghend textarea'); field.value = 'Thanks'; field.dispatchEvent(new Event('input', { bubbles: true })); scrollTo(0, 0); });
  await conv.mouse.move(700, 400);
  await conv.keyboard.press('Meta+Shift+Period');
  const keyed = await conv.evaluate(() => { const field = document.activeElement; return { inField: field?.tagName === 'TEXTAREA' && !!field.closest('.ghend'), at: field?.selectionStart, length: field?.value.length, link: !!document.querySelector('.conv .answer') }; });
  await conv.keyboard.type(' for the fix.');
  const endOpen = await fieldState(end);
  await conversationAfter(() => conv.click(`${end} [data-gh-send]`));
  const commented = await fieldState(end);
  const lastItem = await conv.evaluate(() => [...document.querySelectorAll('.conv .feed .msg')].at(-1)?.textContent);
  check('the end of the conversation is a field "Write a comment…" with "Comment" in place of the link; the comment key puts the cursor at its end; the button sends it once and it stands last, marked as an example',
    !keyed.link && keyed.inField && keyed.at === 6 && keyed.length === 6 && endOpen.placeholder === 'Write a comment…' && endOpen.buttonText === 'Comment'
    && same((await writes()).at(-1), { kind: 'comment', pullId: 'made-up-pull-12', body: 'Thanks for the fix.' }) && (await writes()).length === 4
    && /you.*example.*Thanks for the fix\./.test(lastItem) && commented.value === '' && commented.focus, JSON.stringify({ keyed, endOpen, commented, lastItem }));

  // A send that fails keeps its text and shows GitHub's sentence; nothing is sent again by itself. The text survives a redraw and a change of the view; he sends it again himself.
  await conv.evaluate(() => { window.apostilExampleFailure = 'GitHub says: Resource not accessible by integration (HTTP 403)'; });
  await conv.keyboard.type('This one fails.');
  await conv.keyboard.press('Meta+Enter');
  await conv.waitForFunction((sel) => document.querySelector(`${sel} .gherr`)?.textContent, end, { timeout: 3000 });
  const failedSend = await fieldState(end);
  await conv.click('.switch a[data-view="diffs"]');
  await settle(conv);
  await conversationAfter(() => conv.click('.switch a[data-view="conversation"]'));
  await conversationAfter(() => conv.evaluate(() => App.render()));
  const survived = await fieldState(end);
  const failedCount = (await writes()).length; // after the change of the view and the redraw: still the one failed send
  await conv.click(`${end} textarea`);
  await conversationAfter(() => conv.keyboard.press('Meta+Enter'));
  const resent = await fieldState(end);
  check('a failed send keeps its text and shows GitHub\'s own sentence under the field; nothing is sent again by itself; the text survives a change of the view and a redraw; he sends it again himself with Cmd+Enter, and it goes once',
    failedSend.value === 'This one fails.' && failedSend.error === 'GitHub says: Resource not accessible by integration (HTTP 403)' && failedCount === 5
    && survived.value === 'This one fails.' && resent.value === '' && resent.error === '' && (await writes()).length === 6, JSON.stringify({ failedSend, failedCount, survived, resent }));

  // The review: a quiet button in the strip opens a panel with the text, three verdicts and "Send review".
  await conv.evaluate(() => scrollTo(0, 0));
  await conv.click('#status [data-review]');
  const panelOf = () => conv.evaluate(() => {
    const panel = document.querySelector('#status .review-panel');
    return panel && { verdicts: [...panel.querySelectorAll('.ghv')].map((label) => `${label.textContent}${label.querySelector('input').disabled ? ' (off)' : ''}${label.title ? ` [${label.title}]` : ''}`),
      chosen: panel.querySelector('input:checked')?.value, button: panel.querySelector('[data-gh-send]')?.textContent, focus: document.activeElement === panel.querySelector('textarea'),
      strip: document.querySelector('#status .status').textContent };
  });
  const reviewPanel = await panelOf();
  await conversationAfter(() => conv.evaluate((link) => { App.read[link].pull.mine = true; App.render(); }, LINK12));
  const ownPanel = await panelOf();
  await conv.evaluate(() => scrollTo(0, 0));
  await convShot('71-the-review-on-his-own-pull-request');
  check('"Review" in the strip opens a panel with the text, "Comment", "Approve" and "Request changes", and "Send review"; the cursor is in its text; on his own pull request "Approve" and "Request changes" are not available, and the tooltip says why',
    !!reviewPanel && reviewPanel.verdicts.join() === 'Comment,Approve,Request changes' && reviewPanel.chosen === 'COMMENT' && reviewPanel.button === 'Send review' && reviewPanel.focus
    && ownPanel?.verdicts.join() === 'Comment,Approve (off) [This is your own pull request.],Request changes (off) [This is your own pull request.]', JSON.stringify({ reviewPanel, ownPanel }));
  // The hint of the answer field was added after the trial with real sends.
  const answerHint = () => conv.evaluate(() => document.querySelector('[data-gh^="reply:"] .ghh')?.textContent ?? '');
  const hintBefore = await answerHint();
  await conversationAfter(() => conv.evaluate((link) => { Object.assign(App.read[link].pull, { mine: false, pending: { id: 'made-up-review-1', comments: 2 } }); App.render(); }, LINK12));
  const hintWithReview = await answerHint();
  const pendingPanel = await panelOf();
  await conv.click('#status .review-panel .ghv:has(input[value="APPROVE"])');
  await conv.click('#status .review-panel textarea');
  await conv.keyboard.type('Good to go.');
  await conversationAfter(() => conv.keyboard.press('Meta+Enter'));
  const reviewed = await conv.evaluate(() => ({ panel: !!document.querySelector('#status .review-panel'), strip: document.querySelector('#status .status').textContent, focus: document.activeElement?.matches('[data-review]'),
    last: [...document.querySelectorAll('.conv .feed .card.review')].at(-1)?.textContent }));
  check('his review that is not sent yet: the answer field of a thread says that the answer goes into it (with none it says nothing); the strip says "Your review is not sent: 2 comments"; Cmd+Enter sends that review with the verdict once, the panel closes and the review shows',
    hintBefore === '' && hintWithReview === 'This goes into your review that is not sent yet.'
    && /Your review is not sent: 2 comments/.test(pendingPanel?.strip) && same((await writes()).at(-1), { kind: 'review', pullId: 'made-up-pull-12', verdict: 'APPROVE', body: 'Good to go.', pendingId: 'made-up-review-1' })
    && (await writes()).length === 7 && !reviewed.panel && !/not sent/.test(reviewed.strip) && reviewed.focus && /approved.*Good to go\./.test(reviewed.last), JSON.stringify({ hintBefore, hintWithReview, pendingPanel, reviewed }));

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
      const parts = boxes.flatMap((box) => [...box.querySelectorAll('textarea, button, .ghk, .ghr, .ghv, .gherr')]).filter((el) => el.offsetHeight > 0);
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
  check('at 520 and 1400 px no field or button of writing to GitHub is cut off or overlaps another thing; nothing was written by the page without a send: one write for each send, seven in all',
    fits.every((fit) => fit.boxes >= 3 && fit.parts >= 8 && !fit.over.length && !fit.overlaps.length && !fit.sideways) && (await writes()).length === 7, JSON.stringify({ fits, writes: (await writes()).length }));

  // A failure says why in one line and offers "Try again", which reads again.
  await conv.evaluate(() => { App.read['https://example.com/made-up/pull/12'] = { problem: 'GitHub cannot be reached. Check the network.' }; return App.render(); });
  const problem = await conv.evaluate(() => document.querySelector('.conv-problem')?.textContent);
  await conversationAfter(() => conv.click('[data-retry]'));
  const retried = await conv.evaluate(() => !!document.querySelector('.conv .ptitle') && !document.querySelector('.conv-problem'));
  check('a failure is one plain line with "Try again", and "Try again" reads the pull request again', problem === 'GitHub cannot be reached. Check the network.Try again' && retried, `${problem}; ${retried}`);

  // Widths, in both looks, narrow (under 640 px) and wide: nothing cut off, no sideways scroll of the page; code lines of a thread wrap; the rows of the stack, open, stay inside.
  // "Classic" has a third layout between 640 and 1000 px, with its side facts under the title.
  const widthFits = [];
  for (const look of ['messages', 'classic']) {
    await conv.evaluate((name) => document.querySelector(`[data-mode="${name}"]`)?.click(), look);
    await frames(conv, 8);
    for (const width of look === 'classic' ? [370, 760, 1400] : [370, 1400]) {
      await resize(conv, width);
      const fit = await conv.evaluate(() => {
        document.querySelectorAll('.conv [data-box]').forEach((box) => box.classList.add('open'));
        document.querySelector('[data-classic-more]')?.click();
        document.querySelector('.conv .stack:not(.open) .sline')?.click();
        scrollTo(0, 0);
        const scrolls = (el) => { for (let at = el.parentElement; at; at = at.parentElement) if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(at).overflowX)) return true; return false; }; // a box that scrolls, or a row that ends in dots
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
      if (look === 'messages' && width === 370) await convShot('65-messages-at-370', true);
    }
  }
  check('both looks at 370 and 1400 px, and "Classic" at 760 px: no sideways scroll, nothing past the right edge, no code line of a thread cut off (at 760 px and less a long one wraps), and the open rows of the stack stay inside',
    widthFits.every((fit) => !fit.sideways && !fit.over.length && !fit.cut && fit.stackInside && (fit.width > 760 || fit.wraps === true)), JSON.stringify(widthFits));
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
  await conv.evaluate(() => { document.body.classList.remove('vscode-dark'); document.documentElement.style.removeProperty('--vscode-editor-background'); document.querySelector('[data-mode="messages"]')?.click(); });
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
    // Scroll through the whole page in 40 steps, one frame each, and take the longest frame.
    let longest = 0;
    const height = document.documentElement.scrollHeight;
    scrollTo(0, 0);
    for (let step = 1; step <= 40; step++) {
      const before = performance.now();
      scrollTo(0, (height * step) / 40);
      await new Promise((done) => requestAnimationFrame(done));
      longest = Math.max(longest, performance.now() - before);
    }
    document.querySelector('[data-earlier]')?.click();
    const t1 = performance.now();
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    return { drawMs: Math.round(drawMs), paintMs: Math.round(paintMs), longestFrameMs: Math.round(longest), unfoldMs: Math.round(performance.now() - t1), entries: document.querySelectorAll('.conv .feed > *').length, line: document.getElementById('new-line')?.textContent };
  });
  console.log(`      500 items: ${JSON.stringify(big)}`);
  // The longest frame is 40 to 60 ms alone; npm run check runs every group at the same time with a real VS Code window, where it reached 155 ms.
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
  // The page of a pull request of this repo with no stored change says in one quiet line that it has no description of Apostil yet, with the words for an agent and a button that copies them.
  const noDescription = await pullOnly.evaluate(async () => {
    const read = APOSTIL_EXAMPLE.answers['pull:https://example.com/made-up/pull/12'];
    App.page = { ...App.page, pullOnly: { link: read.pull.url, number: 35, local: false, otherRepo: false, fetch: 'git fetch origin pull/35/head' }, files: read.pull.files, parts: [] };
    App.state.view = 'conversation';
    await App.render();
    const line = document.getElementById('summary');
    const text = line.textContent;
    line.querySelector('[data-copy]').click();
    const views = [...document.querySelectorAll('.bar .switch a:not([hidden])')].map((a) => a.textContent);
    return { text, views, copied: window.apostilSent.filter((message) => message.type === 'copy').map((message) => message.text), button: line.querySelector('[data-copy]').textContent };
  });
  check('the page of a pull request with no stored change says in one quiet line that it has no description of Apostil yet and gives the words "Describe pull request #35 for Apostil", its button copies them, and its switch has "Conversation" first and "Diffs" second',
    /^This pull request has no description of Apostil yet\. Give an agent these words: Describe pull request #35 for Apostil Copy$/.test(noDescription.text)
    && noDescription.copied.join() === 'Describe pull request #35 for Apostil' && noDescription.button === 'Copied' && noDescription.views.join() === 'Conversation,Diffs', JSON.stringify(noDescription));
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

  // ----- "@github" in the comment box on code: in the open diffs of the list of "Diagram" (since build prompt 42 "Diffs" opens no diff), on an added line,
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

  // ----- a stack of pull requests: the made-up #12 is the middle of a stack of three, #9 below it and #13 on top (build prompt 21) -----
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

  // ----- a change whose branch has a pull request opens at "Conversation" (build 72) -----
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
