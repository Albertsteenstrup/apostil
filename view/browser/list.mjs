// The browser check of the list of the side bar and its search. A group of view/browser-check.mjs, which runs every group at the same time; alone:
//   node view/browser/list.mjs [--pictures] [<folder for pictures>]

import { lookOfPage, THEMES, wearTheme } from '../theme-look.mjs';
import { check, errors, finish, listFile, openPage, takePicture } from './tools.mjs';

/** The list as a file, with the made-up rows of example-data.ts and their pull requests; in the dark default theme when `dark`. */
/** The search field stands behind its icon until a click on it (and while a search or a sort is on): open it before a step types into it. */
const openField = async (page) => { if (await page.evaluate(() => document.querySelector('.find').hidden)) await page.click('.cl .seek'); };
const openList = async (width, height, dark = false) => {
  const one = await openPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  if (dark) await one.addInitScript(wearTheme, THEMES.dark);
  one.on('pageerror', (error) => errors.push(error.message));
  one.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await one.goto(`file://${listFile}`);
  await one.waitForFunction(() => window.apostilListDone, null, { timeout: 5000 });
  return one;
};

try {

  // The list in the sidebar, as a file: the made-up session with two changes and three pull requests, and a change with no agent.
  const list = await openList(370, 700);
  const head = await list.$eval('.grp .head', (el) => ({
    icon: el.querySelector('img.icon')?.getAttribute('src'), loaded: el.querySelector('img.icon')?.naturalWidth > 0,
    text: el.textContent, link: el.querySelector('.ses')?.dataset.link, words: el.querySelector('.ses')?.textContent,
  })).catch(() => ({}));
  const grouped = await list.$$eval('.grp', (all) => all.map((grp) => [grp.querySelectorAll('.head').length, grp.querySelectorAll('.row').length]));
  const rowState = await list.$eval('.row .top .state', (el) => [el.textContent, el.querySelector('.dot')?.className]).catch(() => []);
  const longName = 'A made-up session name that is much too long for one line of the side bar';
  const longHead = await list.evaluate((name) => {
    shown.groups[0].agent.name = name;
    draw();
    const head = document.querySelector('.grp .head');
    const ses = head.querySelector('.ses');
    const found = { lines: Math.round(head.getBoundingClientRect().height / parseFloat(getComputedStyle(head).lineHeight)), dots: getComputedStyle(ses).textOverflow, cut: ses.scrollWidth > ses.clientWidth, tooltip: ses.title };
    shown.groups[0].agent.name = 'Made-up session name';
    draw();
    return found;
  }, longName);
  check('two changes of one session stand under one head with the icon of the agent app and the name of the session as the link, and no account name; a change with no agent has no head; a long session name stays on one line, cut with dots, with the full name in the tooltip; the state line of a row with a running remark says so, after a pulsing dot',
    head.icon === 'agents/claude-code.svg' && head.loaded && head.text === 'Made-up session name' && head.words === 'Made-up session name' && head.link === 'claude://claude.ai/epitaxy/made-up-host-0001'
    && JSON.stringify(grouped) === '[[1,2],[0,1]]' && longHead.lines === 1 && longHead.dots === 'ellipsis' && longHead.cut && longHead.tooltip === longName
    && rowState[0] === 'the agent is working' && rowState[1] === 'dot pulse', JSON.stringify({ head, grouped, longHead, rowState }));
  // The list has no first words: also in a repo with no map and no saved change it shows Home and the rows only. The press that maps a repo, the set-up step and the example are on Home.
  const emptyList = await list.evaluate(() => {
    const kept = shown;
    shown = { repo: kept.repo, groups: [] };
    draw();
    const found = { words: document.querySelectorAll('.cl .empty, .cl [data-write], .cl [data-setup]').length, home: !!document.querySelector('.cl .home'), text: document.querySelector('.cl').textContent.trim() };
    shown = kept;
    draw();
    return found;
  });
  const homeRow = await list.$eval('.home', (el) => ({ first: el.parentElement === document.getElementById('list').firstElementChild && !el.previousElementSibling, text: el.textContent, mark: el.querySelector('img.mark')?.naturalWidth > 0 })).catch(() => ({}));
  await list.click('.home');
  const homeSent = await list.evaluate(() => window.apostilSent.some((message) => message.type === 'home'));
  check('the first row of the side bar is "Home" with the logo mark and the name of the repo, and a click asks VS Code for Home; the list of a repo with no map and no saved change shows "Home" and the head "Changes" only: no press, no set-up step and no example',
    homeRow.first && homeRow.text === 'Homelibrary-app' && homeRow.mark && homeSent && emptyList.words === 0 && emptyList.home && /^Home.*Changes$/.test(emptyList.text), JSON.stringify({ homeRow, homeSent, emptyList }));
  const pullLines = await list.$$eval('.pr', (all) => all.map((pr) => [...pr.querySelectorAll('.pn, .pw, .place')].map((el) => el.textContent).join(''))); // the words, without the people
  const fold = await list.textContent('.more').catch(() => '');
  const foldInRow = await list.evaluate(() => document.querySelector('.more')?.closest('.row')?.dataset.id);
  const listIcons = await list.$$eval('.pr .pri', (all) => all.map((icon) => [icon.className, getComputedStyle(icon).color, getComputedStyle(icon).maskImage.startsWith('url("data:image/svg+xml'), icon.getBoundingClientRect().width]));
  await takePicture(list, '16-list-at-370.png');
  await list.hover('.pr .pri >> nth=0');
  await list.waitForSelector('.tip', { timeout: 3000 }); // it shows after a short moment
  const listTip = await list.evaluate(() => { const tip = document.querySelector('.tip'); const box = tip?.getBoundingClientRect(); return tip && { text: tip.textContent, inside: box.left >= 0 && box.right <= innerWidth }; });
  await list.mouse.move(2, 2);
  // The count of checks in the side bar once took all statuses of other products for one check: a corrected fault.
  check('each row shows its own open pull requests, two at most, with the check counts; its merged and closed ones are behind the fold of that row; each line starts with the icon of its state, 16 pixels, in the colour of the state, with the tooltip of the page, inside the side bar',
    pullLines.join() === '#12checks failing · 1 of 8 checks failed2/3,#14checks failing · 2 of 9 checks failed' && fold === '2 more pull requests' && foldInRow === '0'
    && listIcons.length === 2 && listIcons[0][0] === 'pri git-pull-request red' && listIcons.every(([, colour, masked, width]) => masked && width === 16 && colour !== 'rgb(0, 0, 0)')
    && listTip?.text === '#12 · Checks failing · 2 of 3 in a stack' && listTip.inside, JSON.stringify({ pullLines, fold, foldInRow, listIcons, listTip }));
  await list.click('.more');
  const unfoldedLines = await list.$$eval('.pr', (all) => all.map((pr) => [...pr.querySelectorAll('.pn, .pw, .place')].map((el) => el.textContent).join('')));
  const mergedIcon = await list.$eval('.pr >> nth=1', (pr) => pr.querySelector('.pri').className);
  check('a click on the fold shows every pull request of that row, with the check counts only where a check failed',
    unfoldedLines.length === 4 && unfoldedLines[1] === '#11merged' && mergedIcon === 'pri git-merge purple' && unfoldedLines[2] === '#10closed' && unfoldedLines[3] === '#14checks failing · 2 of 9 checks failed', `${unfoldedLines.join(', ')}; ${mergedIcon}`);
  // One session with seven rows: four with an open pull request, two whose pull request is merged or closed, one with none. The rules of the folds are unit tests (view/stack.test.ts).
  const readRows = () => ({ rows: [...document.querySelectorAll('.row')].map((one) => one.querySelector('.pn')?.textContent ?? one.querySelector('.nm').textContent.slice(-8)).join(), folds: [...document.querySelectorAll('.fold')].map((fold) => fold.textContent).join('|') });
  const folds = await list.evaluate((readText) => {
    const read = new Function(`return (${readText})()`);
    window.keptList = { shown, pulls: { ...pulls } };
    const states = ['review needed', 'review needed', 'merged', 'checks failing', 'draft', 'closed', ''];
    const looks = { merged: { icon: 'git-merge', colour: 'purple' }, closed: { icon: 'git-pull-request-closed', colour: 'red' } };
    const row = (state, index) => ({ ...shown.groups[0].rows[0], id: 10 + index, branch: `made-up/branch-${index}`, open: false });
    shown = { ...shown, groups: [{ ...shown.groups[0], rows: states.map(row) }] };
    states.forEach((state, index) => { pulls[`made-up/branch-${index}`] = state ? [{ number: 20 + index, title: 't', url: 'u', state, look: looks[state] ?? { icon: 'git-pull-request', colour: 'green' }, checks: { passed: 1, failed: 0, pending: 0 } }] : []; });
    draw();
    const first = read();
    document.querySelector('.fold[data-unfold^="more"]').click();
    const more = read();
    document.querySelector('.fold[data-unfold^="more"]').click();
    const fewer = read();
    document.querySelector('.fold[data-unfold^="history"]').click();
    const history = read();
    const tip = document.querySelector('.fold[data-unfold^="history"]').title;
    const cut = [...document.querySelectorAll('.fold')].some((fold) => fold.scrollWidth > fold.clientWidth);
    return { first, more, fewer, history, tip, cut };
  }, readRows.toString());
  await takePicture(list, '16d-list-with-the-history-open.png');
  // The row that is open now stays in view, also as a third open one.
  folds.openRow = await list.evaluate((readText) => {
    shown.groups[0].rows[4].open = true;
    document.querySelector('.fold[data-unfold^="history"]').click();
    const result = new Function(`return (${readText})()`)();
    shown = window.keptList.shown;
    unfolded.clear();
    Object.keys(pulls).forEach((key) => delete pulls[key]);
    Object.assign(pulls, window.keptList.pulls);
    draw();
    return result;
  }, readRows.toString());
  check('a session with four open pull requests shows two rows and "2 more pull requests", which shows the others in their place, and "Show fewer" folds them again; rows with a merged or closed one are under "History · 2", which shows them under that line with a tooltip that says what it holds; a row with no pull request stays; the row that is open now stays in view as a third; no line is cut off',
    folds.first.rows === '#20,#21,branch-6' && folds.first.folds === '2 more pull requests|History · 2'
    && folds.more.rows === '#20,#21,#23,#24,branch-6' && folds.more.folds.startsWith('Show fewer') && folds.fewer.rows === folds.first.rows && folds.fewer.folds === folds.first.folds
    && folds.history.rows === '#20,#21,branch-6,#22,#25' && folds.history.folds.endsWith('History · 2') && /merged or closed/.test(folds.tip) && !folds.cut
    && folds.openRow.rows === '#20,#21,#24,branch-6' && folds.openRow.folds === '1 more pull request|History · 2', JSON.stringify(folds));
  await list.click('.pr >> nth=0');
  const listSent = await list.evaluate(() => window.apostilSent.map((message) => message.type + (message.url ? `:${message.url}` : '')));
  const openPull = await list.evaluate(() => window.apostilSent.find((message) => message.type === 'openPull'));
  check('a click on a pull request asks VS Code for the page of its change at "Conversation", and does not open the row', openPull?.id === 0 && openPull?.number === 12 && !listSent.includes('open'), `${listSent.join(', ')}; ${JSON.stringify(openPull)}`);
  // A stack: the place mark, and the rows of one stack together in the order of the stack, the top first. The order itself is a unit test (view/stack.test.ts).
  const side = await list.evaluate(() => {
    const mark = document.querySelector('.pr .place');
    const pull = (number, position) => ({ number, title: 't', url: 'u', state: 'review needed', look: { icon: 'git-pull-request', colour: 'green' }, checks: { passed: 1, failed: 0, pending: 0 }, stack: { number: 30, size: 3, position } });
    const row = (index) => ({ ...shown.groups[0].rows[0], id: 40 + index, branch: `made-up/step-${index}`, open: false });
    shown = { ...shown, groups: [{ ...shown.groups[0], rows: [0, 1, 2, 3].map(row) }] };
    Object.assign(pulls, { 'made-up/step-0': [pull(31, 1)], 'made-up/step-1': [{ ...pull(50, 1), stack: undefined }], 'made-up/step-2': [pull(33, 3)], 'made-up/step-3': [pull(32, 2)] });
    draw();
    const order = () => [...document.querySelectorAll('.row')].map((one) => one.querySelector('.pr').textContent);
    const first = order(), fold = document.querySelector('.fold')?.textContent;
    document.querySelector('.fold[data-unfold^="more"]')?.click(); // a stack counts each of its pull requests: two show, the fold has the others
    return { mark: mark?.textContent, markTip: mark?.title, first, fold, order: order() };
  });
  check('a quiet "2/3" for the place in a stack, and the rows of one stack stand together, the top first',
    side.mark === '2/3' && side.markTip === '2 of 3 in a stack' && side.first.join('|') === '#33review needed3/3|#32review needed2/3' && side.fold === '2 more pull requests'
    && side.order.join('|') === '#33review needed3/3|#32review needed2/3|#31review needed1/3|#50review needed', JSON.stringify(side));
  await list.close();

  // ----- the search of the list (build prompts 47 and 48): the field, the icon that asks VS Code for its quick pick, a filter, a sort, no match, and the people on a pull request line -----
  // The layout at 250 px, the narrowest side bar; the behaviour once, at 400 px, in the look "Apostil"; the colours of a filtered list in the dark default theme.
  // The made-up rows of example-data.ts have made-up people whose pictures are data addresses. The rules of the search, the sorts and the values are unit tests (view/search.test.ts).
  {
  const readList = () => ({
    field: document.querySelector('.find .q').value, dot: !document.querySelector('.find .sf .on').hidden, line: document.querySelector('.cl .eyebrow')?.textContent,
    rows: [...document.querySelectorAll('.cl .row')].map((row) => row.querySelector('.nm').textContent),
    pulls: [...document.querySelectorAll('.cl .row')].map((row) => [...row.querySelectorAll('.pr .pn')].map((pn) => pn.textContent).join(' ')),
    heads: document.querySelectorAll('.cl .grp .head').length, flat: document.querySelectorAll('.cl .row.flat').length,
    apps: [...document.querySelectorAll('.cl .row.flat .top')].map((top) => top.querySelector('img.icon')?.getAttribute('alt') ?? (top.querySelector('span.icon') ? 'none' : '')),
    menu: !!document.querySelector('.cl .menu'), sideways: document.documentElement.scrollWidth > innerWidth,
  });
  /** Sends the page a message as VS Code does, and waits until the page has taken it: its own listener runs before this one. */
  const fromVsCode = (one, message) => one.evaluate((data) => new Promise((done) => { addEventListener('message', () => done(), { once: true }); postMessage(data, '*'); }), message);
  /** The quick pick is VS Code's: the page only asks for it, and takes the search that VS Code sends back after a pick (the message "search"). */
  const picked = (one, search) => fromVsCode(one, { type: 'search', search });
  /** A picture shows the list at rest: the field and the icon without the ring of the keyboard. */
  const snap = async (one, picture) => {
    await one.evaluate(() => document.activeElement?.blur());
    await takePicture(one, `160-${picture}.png`);
  };

  // At 250 px: the empty field under "Home" and above "Changes", as wide as the view, "Search changes" in it and the icon of sort and filter at its right end;
  // the people on a pull request line: the avatar of the author at its left, the reviewers small at its right end (three, then "+1"), one line, inside the row.
  const narrow = await openList(250, 560);
  const shut = await narrow.evaluate(() => {
    const home = document.querySelector('.cl .home').getBoundingClientRect(), seek = document.querySelector('.cl .seek').getBoundingClientRect();
    return { hidden: document.querySelector('.find').hidden, beside: Math.abs((seek.top + seek.height / 2) - (home.top + home.height / 2)) <= 2 && seek.left >= home.right - 1, right: Math.round(innerWidth - seek.right), label: document.querySelector('.cl .seek').getAttribute('aria-label') };
  });
  await narrow.click('.cl .seek');
  const field = await narrow.evaluate(() => {
    const box = (selector) => document.querySelector(selector).getBoundingClientRect();
    const [home, find, eyebrow, icon] = [box('.cl .home'), box('.find .q'), box('.cl .eyebrow'), box('.find .sf .ico')];
    return {
      order: home.bottom <= find.top && find.bottom <= eyebrow.top, left: Math.round(find.left), right: Math.round(innerWidth - find.right), words: document.querySelector('.find .q').placeholder,
      icon: Math.round(icon.width), inside: icon.right <= find.right && icon.left >= find.left, label: document.querySelector('.find .sf').getAttribute('aria-label'),
      focused: document.activeElement === document.querySelector('.find .q'), clear: getComputedStyle(document.querySelector('.find .q')).backgroundColor,
    };
  });
  await narrow.keyboard.press('Escape');
  const shutAgain = await narrow.evaluate(() => document.querySelector('.find').hidden);
  // A click on the icon while the field shows hides it (the owner: "when I click on search icon when it is shown then hide"): the empty field with the keyboard
  // in it, and a field with text, whose search then ends so that no hidden text keeps rows away.
  await narrow.click('.cl .seek');
  await narrow.click('.cl .seek');
  const emptyHidden = await narrow.evaluate(() => document.querySelector('.find').hidden);
  await narrow.click('.cl .seek');
  await narrow.keyboard.type('zz');
  await narrow.click('.cl .seek');
  const typedHidden = await narrow.evaluate(() => ({ hidden: document.querySelector('.find').hidden, text: document.querySelector('.find .q').value, rows: document.querySelectorAll('.cl .changes .row, .cl .changes [data-change]').length }));
  check('the search of the list is one icon at the right end of the row "Home"; a click shows the field with the keyboard in it and a clear background, and Escape in the empty field hides it again; a click on the icon while the field shows hides it, also with text in it, and that search ends',
    shut.hidden && shut.beside && shut.right <= 12 && shut.label === 'Search changes' && field.focused && field.clear === 'rgba(0, 0, 0, 0)' && shutAgain
      && emptyHidden && typedHidden.hidden && typedHidden.text === '', JSON.stringify({ shut, field, shutAgain, emptyHidden, typedHidden }));
  await narrow.click('.cl .seek');
  const empty = await narrow.evaluate(readList);
  check('at 250 px the opened empty field stands under "Home" and above "Changes", as wide as the view, with "Search changes" in it and the icon of sort and filter, 16 px, inside it at the right; the list is grouped as before, with no dot',
    field.order && field.left <= 12 && field.right <= 12 && field.words === 'Search changes' && field.icon === 16 && field.inside && field.label === 'Sort and filter'
    && empty.heads === 1 && empty.flat === 0 && empty.line === 'Changes' && !empty.dot && !empty.sideways, JSON.stringify({ field, empty }));
  const people = await narrow.evaluate(() => [...document.querySelectorAll('.cl .pr')].map((pr) => {
    const box = pr.getBoundingClientRect();
    const author = pr.firstElementChild;
    const faces = pr.querySelector('.rvs');
    return {
      number: pr.querySelector('.pn').textContent, author: author.matches('img.av.xs') && author.naturalWidth > 0, size: Math.round(author.getBoundingClientRect().width),
      faces: faces?.querySelectorAll('.rv').length ?? 0, more: faces?.querySelector('i.muted')?.textContent ?? '', letters: [...(faces?.querySelectorAll('span.av:not(.prodav)') ?? [])].map((av) => av.textContent).join(),
      tip: faces?.querySelector('.rv')?.title ?? '', atEnd: faces ? Math.abs(faces.getBoundingClientRect().right - box.right) <= 1 : true,
      oneLine: box.height < 2.2 * parseFloat(getComputedStyle(pr).fontSize), inRow: box.right <= pr.closest('.row').getBoundingClientRect().right + 0.5,
    };
  }));
  await snap(narrow, 'apostil-250-pull-request-lines-with-avatars');
  check('at 250 px each pull request line shows the avatar of its author at its left, 16 px, and its reviewers small at its right end: three, the one who asked for changes first, then "+1"; a person with no picture is one letter; one line, inside its row',
    people.length === 2 && people.every((line) => line.author && line.size === 16 && line.atEnd && line.oneLine && line.inRow)
    && people[0].number === '#12' && people[0].faces === 3 && people[0].more === '+1' && people[0].letters === 'L,M' && people[0].tip === 'lena-s: asked for changes'
    && people[1].number === '#14' && people[1].faces === 1 && people[1].more === '', JSON.stringify(people));
  await narrow.close();

  const one = await openList(400, 560);
  const read = () => one.evaluate(readList);
  const lastMenu = () => one.evaluate(() => window.apostilSent.filter((message) => message.type === 'menu').pop());
  const menuAsks = () => one.evaluate(() => window.apostilSent.filter((message) => message.type === 'menu').length);

  // The icon asks VS Code for its quick pick and sends the values of the filters with their counts and the search; no menu opens in the view.
  await openField(one); await one.click('.find .sf');
  const asked = await lastMenu();
  const faces = (kind) => (asked?.values[kind] ?? []).map((value) => `${value.value} ${value.count}`).join(', ');
  check('a click on the icon sends VS Code the values of the rows with their counts (authors, reviewers, labels, states, agents, with their people, colours and apps) and the search; the view opens no menu of its own',
    !!asked && Object.keys(asked.values).join() === 'author,reviewer,label,state,agent' && faces('author') === 'jonas-b 2, mira-k 1'
    && faces('reviewer') === 'Copilot 1, jonas-b 1, lena-s 1, Made-up team 1, mira-k 1' && faces('label') === 'borrowing 1, bug 1, needs review 1'
    && faces('state') === 'checks failing 2, closed 1, merged 1, no pull request 1' && faces('agent') === 'claude 2'
    && asked.values.author[0].person.avatar.startsWith('data:') && asked.values.label[0].color === '0e8a16' && asked.values.state[0].look.icon && asked.values.agent[0].agent.app === 'claude-code'
    && asked.search.text === '' && asked.search.sort === 'modified' && !(await read()).menu, JSON.stringify(asked));

  // A pick of an author in VS Code: the search comes back to the page; the field holds its word, the icon has a dot, the list is flat with "2 of 3 changes" and the icon of each app.
  await picked(one, { text: 'author:jonas-b', sort: 'modified', reverse: false });
  const byAuthor = await read();
  await snap(one, 'apostil-400-filter-by-author');
  check('the search "author:jonas-b" that VS Code sends back after a pick is in the field, with a dot on the icon; the list is flat, "2 of 3 changes", each row with the icon of its app and only the pull requests of that author',
    byAuthor.field === 'author:jonas-b' && byAuthor.dot && !byAuthor.menu && byAuthor.line === '2 of 3 changes' && byAuthor.heads === 0 && byAuthor.flat === 2
    && byAuthor.rows.join() === 'book-holds,made-up/follow-up' && byAuthor.pulls.join() === '#11,#14' && byAuthor.apps.join() === 'claude-code,claude-code' && !byAuthor.sideways, JSON.stringify(byAuthor));

  // A sort by created: the first save, else the oldest pull request, else the first commit; newest first. The order turned round; "Modified" brings the groups back.
  await picked(one, { text: '', sort: 'created', reverse: false });
  const created = await read();
  await picked(one, { text: '', sort: 'created', reverse: true });
  const turned = await read();
  await picked(one, { text: '', sort: 'modified', reverse: false });
  const back = await read();
  check('a sort by created makes one flat list, newest first, with a dot on the icon: the follow-up (first save 200 minutes ago), the example branch (26 hours), the change with no agent (its first commit); turned round it lists them the other way; "Modified" brings the groups back with no dot',
    created.field === '' && created.dot && created.line === 'Changes' && created.flat === 3 && created.rows.join() === 'made-up/follow-up,book-holds,made-up/without-agent'
    && created.apps.join() === 'claude-code,claude-code,none' && !created.sideways
    && turned.rows.join() === 'made-up/without-agent,book-holds,made-up/follow-up' && turned.dot && back.heads === 1 && back.flat === 0 && !back.dot, JSON.stringify({ created, turned, back }));

  // No match: the line says so, with a link that clears the field.
  await openField(one); await one.fill('.find .q', 'nothing-matches');
  const none = await read();
  await one.click('.cl .eyebrow [data-clear]');
  const cleared = await read();
  check('text that no row holds shows no row and "No change matches · Clear"; the link empties the field and the list is grouped again',
    none.rows.length === 0 && none.line === 'No change matches · Clear' && cleared.field === '' && cleared.heads === 1 && cleared.rows.length === 3, JSON.stringify({ none, cleared }));

  // Typing filters at once. Text that only a pull request holds keeps that pull request; text that the branch holds keeps the row as it is.
  await openField(one); await one.fill('.find .q', 'follow');
  const typed = await read();
  await openField(one); await one.fill('.find .q', '#12');
  const byNumber = await read();
  await openField(one); await one.fill('.find .q', 'book-holds');
  const byBranch = await read();
  const fold = await one.evaluate(() => document.querySelector('.cl .row .more')?.textContent);
  await openField(one); await one.focus('.find .q');
  await one.keyboard.press('Escape');
  const escaped = await read();
  check('typing filters at once ("1 of 3 changes"); "#12" keeps only that pull request in its row; text that the branch holds keeps the row with its pull requests and its fold; Escape in the field empties it',
    typed.rows.join() === 'made-up/follow-up' && typed.line === '1 of 3 changes' && byNumber.rows.join() === 'book-holds' && byNumber.pulls.join() === '#12'
    && byBranch.rows.join() === 'book-holds' && byBranch.pulls.join() === '#12' && fold === '2 more pull requests' && escaped.field === '' && escaped.heads === 1, JSON.stringify({ typed, byNumber, byBranch, fold, escaped }));

  // Keys: Enter on the icon and Down in the field ask VS Code for the quick pick; a word that is typed goes with the next ask, so that its quick pick shows the check mark of its value.
  const asks = await menuAsks();
  await openField(one); await one.focus('.find .sf');
  await one.keyboard.press('Enter');
  const byIcon = await menuAsks();
  await openField(one); await one.focus('.find .q');
  await one.keyboard.press('ArrowDown');
  const byDown = await menuAsks();
  await openField(one); await one.fill('.find .q', 'state:merged');
  await openField(one); await one.click('.find .sf');
  const typedWord = await lastMenu();
  check('Enter on the icon and Down in the field each ask VS Code for the quick pick; a typed "state:merged" is in the search that the icon sends, and the value "merged" of the states is among the values',
    byIcon === asks + 1 && byDown === asks + 2 && typedWord.search.text === 'state:merged' && typedWord.values.state.some((value) => value.value === 'merged'), JSON.stringify({ asks, byIcon, byDown, search: typedWord.search }));

  // Kept: each change of the search goes to VS Code; the search that VS Code kept for a repo comes back with its rows, and a later message of that repo does not take what is typed.
  const sent = await one.evaluate(() => window.apostilSent.filter((message) => message.type === 'search').pop()?.search);
  const groups = await one.evaluate(() => shown.groups);
  await fromVsCode(one, { type: 'rows', repo: 'other-repo', groups, search: { text: 'agent:claude', sort: 'size', reverse: true } });
  const restored = await read();
  await fromVsCode(one, { type: 'rows', repo: 'other-repo', groups, search: { text: 'older', sort: 'modified', reverse: false } });
  const kept = await read();
  check('each change of the search goes to VS Code with the text and the sort; the search kept for a repo comes back with its rows (size, smallest first, the rows of Claude Code); a later message of that repo keeps what the field holds',
    sent?.text === 'state:merged' && sent.sort === 'modified' && sent.reverse === false && restored.field === 'agent:claude' && restored.dot && restored.rows.join() === 'made-up/follow-up,book-holds'
    && kept.field === 'agent:claude', JSON.stringify({ sent, restored, kept }));
  await one.close();

  // The open pull requests of the repo that have no stored change: under the head "Pull requests", 20 of 23 and "3 more" for the rest (which opens them), none twice (the branch of a row has its line
  // under that row), a click on one asks VS Code for its page, and the search finds them by their title. The open branch with no change file and no changed file opens Home; with commits it does not.
  const prs = await openList(370, 900);
  const sendRepoPulls = (message) => prs.evaluate((data) => new Promise((done) => { addEventListener('message', () => done(), { once: true }); postMessage(data, '*'); }), message);
  const made = (number, title, branch) => ({ number, title, url: `https://example.com/made-up/pull/${number}`, state: 'review needed', look: { icon: 'git-pull-request', colour: 'green' }, checks: { passed: 1, failed: 0, pending: 0 }, reviewers: [], labels: [], branch, updatedAt: new Date().toISOString() });
  await sendRepoPulls({ type: 'repoPulls', pulls: [...Array.from({ length: 23 }, (_, at) => made(100 + at, `Made-up pull request ${at}`, `made-up/open-${at}`)), made(14, 'Follow-up again', 'made-up/follow-up')] });
  const pullSection = () => prs.evaluate(() => ({
    head: [...document.querySelectorAll('.eyebrow')].map((el) => el.textContent).join('|'), rows: document.querySelectorAll('.prow').length,
    more: document.querySelector('.fold[data-unfold="repo-pulls"]')?.textContent.trim(), first: document.querySelector('.prow .nm')?.textContent, line: document.querySelector('.prow .pr')?.textContent,
    twice: [...document.querySelectorAll('.prow')].some((el) => el.dataset.pull === '14'),
  }));
  const before = await pullSection();
  await prs.click('.prow .nm');
  const opened = await prs.evaluate(() => window.apostilSent.filter((message) => message.type === 'openRepoPull').map((message) => message.number));
  await prs.click('.fold[data-unfold="repo-pulls"]');
  const unfolded = await pullSection();
  await openField(prs); await prs.fill('.find .q', 'pull request 17');
  const searched = await prs.evaluate(() => [...document.querySelectorAll('.prow .nm')].map((el) => el.textContent));
  await openField(prs); await prs.fill('.find .q', '');
  const homeAsks = () => prs.evaluate(() => window.apostilSent.filter((message) => message.type === 'home').length);
  const openBranch = async (commits, files) => {
    await prs.evaluate((counts) => { const row = { ...shown.groups[0].rows[0], id: undefined, branch: 'made-up/open-branch', open: true, ...counts }; shown = { ...shown, groups: [{ rows: [row] }] }; draw(); }, { commits, files });
    const asked = await homeAsks();
    await prs.click('.row.sel .nm');
    return (await homeAsks()) - asked;
  };
  const emptyBranch = await openBranch(0, 0);
  const changedBranch = await openBranch(2, 3);
  check('every open pull request with no stored change stands under the head "Pull requests", 20 and "3 more" that opens the rest, none twice for a branch that has a row; a click asks for its page, the search finds it by its title; the open branch with no commit and no changed file opens Home, and with changes it does not',
    before.head === 'Changes|Pull requests' && before.rows === 20 && before.more === '3 more' && before.first === 'Made-up pull request 0' && /^#100/.test(before.line) && !before.twice && opened.join() === '100'
    && unfolded.rows === 23 && !unfolded.twice && searched.join() === 'Made-up pull request 17' && emptyBranch === 1 && changedBranch === 0, JSON.stringify({ before, opened, unfolded, searched, emptyBranch, changedBranch }));

  // When gh fails the list says why, once, in one quiet line in place of the rows.
  await sendRepoPulls({ type: 'repoPulls', pulls: [], problem: 'gh is not signed in: run gh auth login' });
  const failed = await prs.evaluate(() => ({ rows: document.querySelectorAll('.prow').length, notes: [...document.querySelectorAll('.note')].map((el) => el.textContent), head: [...document.querySelectorAll('.eyebrow')].map((el) => el.textContent).join('|') }));
  check('when gh fails the list says why in one quiet line under "Pull requests", with no rows', failed.rows === 0 && failed.notes.join() === 'gh is not signed in: run gh auth login' && failed.head === 'Changes|Pull requests', JSON.stringify(failed));
  await prs.close();

  // The dark default theme: a filtered list (flat rows with the icon of each app, a dot on the icon) reads in it. The group "looks" checks the list at rest in each theme.
  const dark = await openList(250, 560, true);
  await picked(dark, { text: 'author:jonas-b', sort: 'modified', reverse: false });
  const filtered = await dark.evaluate(readList);
  const seen = await dark.evaluate(lookOfPage, true);
  check('in the dark default theme a filtered list reads: no box or shape lighter than the page, text at least 4.5 to 1 and quiet text at least 3 to 1',
    filtered.flat === 2 && filtered.dot && !seen.bright.length && !seen.normal.low.length && !seen.quiet.low.length, JSON.stringify({ filtered: filtered.rows, seen }));
  await dark.close();
  }
} catch (error) {
  check('the checks ran to the end', false, error.message.split('\n').slice(0, 14).join(' / '));
}
await finish();
