// The browser check of notes on "Diffs", the two halves of the diagram page and the graph that follows, each on a page of its own, at the same time.
// A group of view/browser-check.mjs, which runs every group at the same time; alone:
//   node view/browser/diffs.mjs [--pictures] [<folder for pictures>]

import { madeUpDiagrams } from './made-up.mjs';
import { check, errors, finish, HIDDEN_KEY, newPage, openPage, own, pageFile, takePicture } from './tools.mjs';

const { changeMermaid } = own('../out/view/change-diagram.js');
const { partDiagram } = own('../out/view/page-data.js');
const { withRemoved } = own('../out/shared/diagram-change.js');

const listen = (page) => {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
};
/** Waits for a function of the page to be true; false after 5 seconds, so that the check after it says what it found. */
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { polling: 'raf', timeout: 5000 }).then(() => true, () => false);
let calmToken = 0;
/** Waits until nothing moves: no animation runs, and no scroller or drawing of the page moves for two frames. */
const calm = (page) => page.waitForFunction((token) => {
  if (window.calmToken !== token) Object.assign(window, { calmToken: token, calmFrames: 0, calmSign: '' });
  const running = document.getAnimations().some((one) => one.playState === 'running' && Number.isFinite(one.effect?.getComputedTiming().endTime));
  const scrollers = [document.scrollingElement, ...document.querySelectorAll('#view .half'), typeof Code === 'object' ? Code.shown?.scroller : null];
  const sign = [...scrollers.map((el) => el?.scrollTop ?? ''), ...[...document.querySelectorAll('#view svg[viewBox]')].map((svg) => svg.getAttribute('viewBox'))].join('|');
  window.calmFrames = !running && sign === window.calmSign ? window.calmFrames + 1 : 0;
  window.calmSign = sign;
  return window.calmFrames >= 2;
}, ++calmToken, { polling: 'raf', timeout: 5000 }).catch(() => {});

/** The notes on removed lines, the notes on "Diffs", long lines, and files with no text to show: a page of its own. */
async function notes() {
  const view = await newPage({ viewport: { width: 1400, height: 900 } });
  listen(view);
  await view.goto(`file://${pageFile}`);
  await view.waitForFunction(() => (window.apostilRendered ?? 0) >= 1, null, { timeout: 15000 });
  const viewShot = (name) => takePicture(view, `${name}.png`);
  const settle = () => calm(view);
  const worker = 'src/library/night_jobs.py';
  const gone = 'web/src/api/generated/model/reservation.ts';

  // A card and its rows: the card stands at its first row and its join starts inside its rows; the pointer on it lights them.
  const cardAtRows = (root, removed, first, last) => view.evaluate(({ root, removed, first, last }) => {
    const box = document.querySelector(root);
    const cards = [...box.querySelectorAll('.mc')];
    const card = cards.find((el) => !!JSON.parse(el.dataset.remark).removed === removed);
    const rows = [...box.querySelectorAll(`.code .l${removed ? '.del' : ''}`)].filter((row) => { const n = Number(row.querySelector('.n').textContent); return n >= first && n <= last; });
    if (!card || !rows.length) return { card: !!card, rows: rows.length };
    const join = box.querySelector(`svg.links [data-join="${cards.indexOf(card)}"]`);
    const startY = box.querySelector('.notes').getBoundingClientRect().top + Number(join.getAttribute('d').match(/^M0 ([\d.]+)/)[1]);
    const [top, bottom] = [rows[0].getBoundingClientRect().top, rows.at(-1).getBoundingClientRect().bottom];
    card.dispatchEvent(new MouseEvent('mouseenter'));
    const lit = box.querySelectorAll('.code .l.lit').length;
    card.dispatchEvent(new MouseEvent('mouseleave'));
    const code = box.querySelector('.code').getBoundingClientRect();
    return { card: true, rows: rows.length, joined: startY >= top && startY <= bottom, cardOff: Math.round(card.getBoundingClientRect().top - top), lit, beside: card.getBoundingClientRect().left >= code.right };
  }, { root, removed, first, last });
  // The colour of a note: red beside removed lines; green in a file with notes on added lines.
  const toneOf = (tone) => view.evaluate((wanted) => {
    const cards = [...document.querySelectorAll('.cv .mc')];
    const card = cards.find((one) => one.classList.contains(wanted));
    const row = document.querySelector(`.cv .code .l.${wanted}`);
    if (!card || !row) return { card: !!card, row: !!row };
    const lit = card.classList.contains('cur'); // a lit card is teal: measure it at rest
    card.classList.remove('cur');
    const found = { image: getComputedStyle(card).backgroundImage, row: getComputedStyle(row).backgroundColor, join: !!document.querySelector(`.cv svg.links [data-join="${cards.indexOf(card)}"]`)?.classList.contains(wanted) };
    card.classList.toggle('cur', lit);
    return found;
  }, tone);

  // A note on removed lines in a file tab, the colour of a note, a deleted file, and the mark of the note in the narrow form.
  await view.evaluate(async (file) => { App.showCode(file, null); await App.drawing; Code.reveal({ lines: [243, 252], removed: true }); }, worker);
  await settle();
  const tabCard = await cardAtRows('.cv', true, 243, 252);
  const redNote = await toneOf('del');
  await viewShot('30-removed-note-in-a-file-tab');
  await view.evaluate(async () => { App.showCode('src/library/lending/hold_service.py', [245, 245]); await App.drawing; });
  await settle();
  const greenNote = await toneOf('add');
  await view.evaluate(async (file) => { App.showCode(file, null); await App.drawing; }, gone);
  await settle();
  const deleted = await view.evaluate(() => ({ del: document.querySelectorAll('.cv .code .l.del').length, add: document.querySelectorAll('.cv .code .l.add').length, cards: document.querySelectorAll('.cv .mc').length }));
  const deletedCard = await cardAtRows('.cv', true, 12, 30);
  await view.setViewportSize({ width: 560, height: 900 });
  await view.evaluate(async (file) => { App.showCode(file, null); await App.drawing; Code.reveal({ lines: [243, 252], removed: true }); }, worker);
  await settle();
  const narrowMark = await view.evaluate(() => {
    const mark = document.querySelector('.cv .mk');
    const rows = [...document.querySelectorAll('.cv .code .l.del')].filter((row) => { const n = Number(row.querySelector('.n').textContent); return n >= 243 && n <= 252; });
    const [box, top, bottom] = [mark?.getBoundingClientRect(), rows[0]?.getBoundingClientRect().top, rows.at(-1)?.getBoundingClientRect().bottom];
    return { marks: document.querySelectorAll('.cv .mk').length, top: Math.round(box.top - top), bottom: Math.round(box.bottom - bottom) };
  });
  check('a note on removed lines stands at its first removed row in a file tab, joined to its rows and lighting them, in the red of its rows (a note beside added lines is green); a deleted file is all removed rows with its note beside them; narrow, the mark of the note stands at its rows',
    tabCard.rows === 10 && tabCard.joined && Math.abs(tabCard.cardOff) <= 2 && tabCard.lit === 10
      && !!greenNote.image?.includes(greenNote.row) && !!redNote.image?.includes(redNote.row) && greenNote.row !== redNote.row && greenNote.join && redNote.join
      && deleted.del === 30 && deleted.add === 0 && deleted.cards === 1 && deletedCard.joined && deletedCard.lit === 19
      && narrowMark.marks === 1 && Math.abs(narrowMark.top) <= 2 && Math.abs(narrowMark.bottom) <= 2,
    JSON.stringify({ tabCard, redNote, greenNote, deleted, deletedCard, narrowMark }));

  // The open diff of a file in the list of "Diagram" (since build prompt 42 "Diffs" opens no diff): its notes beside its changed lines, as cards when the
  // list is wide (a tab of 1900 px) and as marks at 1400 px.
  const listAt = async (width) => {
    await view.setViewportSize({ width, height: 900 });
    await view.evaluate(async () => { App.go({ level: 'change' }); await App.drawing; if (Split.hidden('code')) Split.setHidden('code', false); await App.drawing; });
    await view.evaluate(async (file) => { await Split.list.reveal({ file }); }, worker);
    await view.waitForSelector(`.dfile[data-file="${worker}"] .cn .l`, { timeout: 5000 });
    await view.evaluate((file) => document.querySelector(`.dfile[data-file="${file}"] .l.del`).scrollIntoView({ block: 'center' }), worker);
    await settle();
  };
  await listAt(1900);
  const diffCard = await cardAtRows(`.dfile[data-file="${worker}"]`, true, 243, 252);
  await viewShot('32-diffs-with-notes-at-1900');
  await listAt(1400);
  const diffMarks = await view.evaluate((file) => { const section = document.querySelector(`.dfile[data-file="${file}"]`); return { marks: section.querySelectorAll('.mk').length, cards: section.querySelectorAll('.mc').length }; }, worker);
  check('an open diff in the list beside the diagram shows the note of its file beside its changed lines: at 1900 px the same card, at its first row, joined to its rows and lit with them; at 1400 px a mark at the right edge',
    diffCard.rows === 10 && diffCard.joined && diffCard.beside && Math.abs(diffCard.cardOff) <= 2 && diffCard.lit === 10 && diffMarks.marks === 1 && diffMarks.cards === 0, JSON.stringify({ diffCard, diffMarks }));

  // Nothing cut off and nothing sideways: in the list, on "Diffs" (the file alone when narrow, beside its list when wide) and in the hover window of a diff.
  const fits = (rootSelector) => view.evaluate((rootSelector) => {
    const roots = [...document.querySelectorAll(rootSelector)];
    const textRight = (x) => { const range = document.createRange(); range.selectNodeContents(x); return Math.max(0, ...[...range.getClientRects()].map((rect) => rect.right)); };
    let rows = 0;
    let cut = 0;
    let long = 0;
    for (const root of roots) {
      const box = root.querySelector('.rowsbox');
      if (!box) continue;
      const right = box.getBoundingClientRect().right;
      for (const row of box.querySelectorAll('.l')) {
        rows++;
        if (textRight(row.querySelector('.x')) > right + 1) cut++;
        if (row.getBoundingClientRect().height > 30) long++;
      }
    }
    const sideways = roots.some((root) => [...root.querySelectorAll('.cn, .code, .rowsbox')].some((el) => el.scrollWidth > el.clientWidth + 1)) || document.documentElement.scrollWidth > innerWidth;
    return { rows, cut, long, sideways };
  }, rootSelector);
  const inList = await fits('.dfile');
  const fitsAt = {};
  for (const width of [370, 1400]) {
    await view.setViewportSize({ width, height: 900 });
    await view.evaluate(async (file) => { App.showDiffs(); await App.drawing; await App.diffs.toPath(file); }, worker);
    await settle();
    const onDiffs = await fits('#view .file-left');
    await view.evaluate(async (file) => {
      const content = await fileWindow(file)();
      const frame = windowFrame({ title: content.title, sub: content.sub, width: content.width });
      frame.el.classList.add('trial');
      frame.body.innerHTML = content.body;
      content.ready(frame.body);
      placeWindow(frame.el, { top: 10, bottom: 20, left: 10, right: 20 });
    }, worker);
    await settle();
    const inWindow = await fits('.win.trial');
    const windowSideways = await view.$eval('.win.trial .wc', (body) => body.scrollWidth > body.clientWidth + 1);
    await view.evaluate(() => document.querySelector('.win.trial').remove());
    fitsAt[width] = { onDiffs, inWindow, windowSideways };
  }
  const fitOk = ({ onDiffs, inWindow, windowSideways }, narrow) => onDiffs.rows > 20 && !onDiffs.cut && !onDiffs.sideways && inWindow.rows > 20 && !inWindow.cut && !inWindow.sideways && !windowSideways
    && (!narrow || (onDiffs.long > 0 && inWindow.long > 0));
  check('no row of a diff has more text than its box shows and nothing scrolls sideways: in the list beside the diagram, and on "Diffs" and in the hover window of a diff at 370 and 1400 px; at 370 px long lines wrap',
    inList.rows > 20 && !inList.cut && !inList.sideways && fitOk(fitsAt[370], true) && fitOk(fitsAt[1400], false), JSON.stringify({ inList, ...fitsAt }));

  // Made-up files from here on, the hard cases of the trial: a minified line of 30,000 characters, a renamed file, and files with no text to show.
  const minified = 'var a=1;b=2;'.repeat(2500); // 30,000 characters on one line
  await view.evaluate((long) => {
    const answers = window.APOSTIL_EXAMPLE.answers;
    const add = (file, where = App.page.parts[0]) => { App.page.files.push({ added: 1, removed: 0, status: 'added', ...file }); where.files.unshift(file.path); };
    add({ path: 'src/minified.js' });
    answers['code:src/minified.js'] = { lines: ['// before', long, '// after'], changed: [[1, 3]], removed: [], status: 'added' };
    answers['diff:src/minified.js'] = [{ sign: '+', line: 1, text: '// before' }, { sign: '+', line: 2, text: long }, { sign: '+', line: 3, text: '// after' }];
    add({ path: 'src/new-name.py', renamedFrom: 'src/old-name.py', status: 'changed' });
    answers['diff:src/new-name.py'] = [{ sign: ' ', line: 1, text: 'def one():' }, { sign: '+', line: 2, text: '    return 1' }, { sign: ' ', line: 3, text: '' }];
    add({ path: 'empty.txt', added: 0, what: 'Empty file' });
    add({ path: 'link', what: 'Link to src/app.py' });
    add({ path: 'run.sh', added: 0, status: 'changed', what: 'Only the mode changed: now executable' });
    add({ path: 'data.bin', added: 0, what: 'Binary file, 4 KB' });
  }, minified);
  const opened = await view.evaluate(async () => {
    const started = performance.now();
    App.showCode('src/minified.js', null);
    await App.drawing;
    const row = document.querySelector('.cv .code [data-line="2"]');
    return { ms: Math.round(performance.now() - started), rows: Math.round(row.getBoundingClientRect().height / Code.shown.list.height), more: row.querySelector('.more')?.textContent };
  });
  await view.click('.cv .code .more');
  await settle();
  const unfolded = await view.evaluate(async () => {
    const row = document.querySelector('.cv .code [data-line="2"]');
    const rows = Math.round(row.getBoundingClientRect().height / Code.shown.list.height);
    const scroller = Code.shown.scroller;
    const times = [];
    for (let step = 0; step < 6; step++) {
      const started = performance.now();
      scroller.scrollTop += 600;
      Code.shown.list.refresh();
      times.push(performance.now() - started);
      await new Promise((done) => requestAnimationFrame(done));
    }
    return { rows, slowest: Math.round(Math.max(...times)), sideways: scroller.scrollWidth > scroller.clientWidth + 1 };
  });
  check('a line of 30,000 characters shows its first 8 rows with "Show all 30,000 characters"; a click wraps all of it, and the page stays fast',
    opened.rows === 9 && opened.more === 'Show all 30,000 characters' && opened.ms < 1000 && unfolded.rows > 100 && unfolded.slowest < 100 && !unfolded.sideways, JSON.stringify({ opened, unfolded }));

  // In the list of "Diagram", every diff open.
  await view.evaluate(async () => { App.go({ level: 'change' }); await App.drawing; App.diffs.list.setAll(true); window.scrollTo(0, 0); });
  await view.waitForSelector('.dfile[data-file="src/new-name.py"] .cn .l', { timeout: 5000 });
  await settle();
  const odd = await view.evaluate(() => {
    const section = (path) => document.querySelector(`.dfile[data-file="${path}"]`);
    return {
      long: section('src/minified.js').querySelector('.more')?.textContent,
      renamed: section('src/new-name.py').querySelector('.dh .from')?.textContent, marked: section('src/new-name.py').querySelectorAll('.l.add, .l.del').length,
      facts: ['empty.txt', 'link', 'run.sh', 'data.bin'].map((path) => section(path)?.querySelector('.fact')?.textContent ?? ''),
      sideways: document.documentElement.scrollWidth > innerWidth,
    };
  });
  check('in the list of diffs a renamed file says "renamed from <old path>" with only its changed line marked, the long line folds, and an empty file, a link, a new mode and a binary file each say what they are',
    odd.long === 'Show all 30,000 characters' && odd.renamed === 'renamed from src/old-name.py' && odd.marked === 1
      && odd.facts.join(' | ') === 'Empty file | Link to src/app.py | Only the mode changed: now executable | Binary file, 4 KB' && !odd.sideways, JSON.stringify(odd));

  // A picture is a picture: in a file tab and in the hover window of the file.
  const picture = 'docs/guide/holds-panel.png';
  await view.evaluate(async (file) => { App.showCode(file, null); await App.drawing; }, picture);
  await view.waitForFunction(() => document.querySelector('.cv .pics img')?.naturalWidth > 0, null, { timeout: 5000 }).catch(() => {});
  const inTab = await view.evaluate(() => ({ pictures: document.querySelectorAll('.cv .pics img').length, width: document.querySelector('.cv .pics img')?.naturalWidth, caption: document.querySelector('.cv .pics figcaption')?.textContent, rows: document.querySelectorAll('.cv .code .l').length }));
  const inWindow = await view.evaluate(async (file) => {
    const content = await fileWindow(file)();
    return /<img /.test(content.body) && !content.ready;
  }, picture);
  const pictureNav = await view.evaluate(() => document.querySelector('.cvw .nav')?.textContent ?? '');
  check('a picture shows as a picture, with its size, in a file tab and in the hover window of the file; no line of it is read as text, and its control does not say "no change"',
    inTab.pictures === 1 && inTab.width > 0 && inTab.caption === 'Now · 3 KB' && inTab.rows === 0 && inWindow && /^‹file \d+ of \d+›$/.test(pictureNav), JSON.stringify({ inTab, inWindow, pictureNav }));

  // Many tests that name a function: "many tests", and the list only on demand.
  await view.evaluate(async (file) => { App.page.functionTests.lending_night = 216; App.showCode(file, null); await App.drawing; Code.reveal({ lines: [243, 252], removed: true }); }, worker);
  await settle();
  const many = await view.$eval('.cv .mc .fn', (el) => el.textContent);
  await view.hover('.cv .mc [data-tests]');
  await view.waitForSelector('.win [data-show-tests]', { timeout: 3000 }).catch(() => {});
  const before = await view.evaluate(() => ({ text: document.querySelector('.win .wc')?.textContent ?? '', rows: document.querySelectorAll('.win .trw').length }));
  await view.click('.win [data-show-tests]').catch(() => {});
  await until(view, () => !/Show them/.test(document.querySelector('.win .wc')?.textContent ?? ''));
  const after = await view.evaluate(() => document.querySelector('.win .wc')?.textContent ?? '');
  check('a function that 216 tests name says "many tests", and its window lists them only on demand',
    many === 'lending_night · many tests' && /Show them/.test(before.text) && before.rows === 0 && !/Show them/.test(after), JSON.stringify({ many, before, after }));
  await view.close();
}

/** A tab of the diagram page (1400 px: the code beside the diagram), and the helpers of its checks. */
async function diagramTab(width = 1400) {
  const wide = await openPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
  await wide.addInitScript((key) => {
    try { if (localStorage.getItem(key) === null) localStorage.setItem(key, '0'); } catch { /* no storage */ }
    // The counter is written again after each key and each rest of the scroll, right after the graph hears the place. `toldAt` is the time of the
    // last write, `scrolledAt` of the last scroll; `markNow()` marks the start of a step: the list told the place of that step when it wrote after both.
    Object.assign(window, { toldAt: 0, scrolledAt: 0, markedAt: 0 });
    addEventListener('scroll', () => { window.scrolledAt = performance.now(); }, { capture: true, passive: true });
    window.markNow = () => {
      const nav = document.querySelector('#tabs .nav');
      if (nav && !nav.watched) { nav.watched = true; new MutationObserver(() => { window.toldAt = performance.now(); }).observe(nav, { childList: true, subtree: true, characterData: true }); }
      window.markedAt = performance.now();
    };
  }, HIDDEN_KEY);
  listen(wide);
  const quiet = () => calm(wide);
  const when = (fn, arg) => until(wide, fn, arg);
  const loaded = () => wide.waitForFunction(() => (window.apostilRendered ?? 0) >= 1, null, { timeout: 15000 }).then(quiet);
  const open = async (go) => { await wide.goto(`file://${pageFile}${go ? `?go=${encodeURIComponent(JSON.stringify(go))}` : ''}`); await loaded(); };
  const show = async (go) => { await wide.evaluate(async (place) => { await App.go(place); }, go); await quiet(); };
  const wideShot = (name) => takePicture(wide, `${name}.png`);
  const pointAt = async (selector) => { const at = await wide.locator(selector).first().boundingBox(); await wide.mouse.move(at.x + at.width / 2, at.y + at.height / 2, { steps: 4 }); };
  const toGutter = () => wide.mouse.move(6, 600, { steps: 2 }); // the gutter left of both halves
  // The code of a step follows a click, which keeps it: a click on an empty place of the diagram lets it go, and then the pointer moves below the things of a diagram.
  const away = async () => {
    const box = await wide.locator('#view > .half.left').boundingBox().catch(() => null);
    if (box) await wide.mouse.click(box.x + 20, box.y + box.height - 20);
    await wide.mouse.move(700, 880);
  };
  const clickAt = async (selector) => { await pointAt(selector); await wide.mouse.down(); await wide.mouse.up(); };
  // The name of the first open point under "Open points n" in the list of the comments that starts with `word`; the list closes again.
  const pointNamed = async (word) => {
    await wide.click('[data-comments]');
    await wide.click('.cml [data-show-points]');
    const name = await wide.evaluate((start) => [...document.querySelectorAll('.cml .cmr.point .where')].map((el) => el.title).find((text) => text.startsWith(start)) ?? '', word);
    await wide.keyboard.press('Escape');
    return name;
  };
  // The two halves: side by side, inside the tab, the page itself not scrolling, and the size of a node label of the diagram on screen.
  const halves = () => wide.evaluate(() => {
    const control = document.querySelector('[data-half="code"]');
    const place = control && (({ right, top }) => ({ right: Math.round(right), top: Math.round(top) }))(control.getBoundingClientRect());
    // By the place on the screen: the code at the left (.half.right), the diagram at the right (.half.left), since build prompt 42.
    const [left, right] = ['#view > .half.right', '#view > .half.left'].map((selector) => document.querySelector(selector)?.getBoundingClientRect());
    if (!left) return { split: false, control: control?.textContent ?? '', place };
    const svg = document.querySelector('.half.left svg');
    const label = svg.querySelector('.nodeLabel');
    const scale = svg.getBoundingClientRect().width / Number(svg.getAttribute('viewBox').split(' ')[2]);
    const side = document.getElementById('side');
    return {
      split: true, control: control?.textContent ?? '', place, apart: left.right <= right.left, label: label ? +(parseFloat(getComputedStyle(label).fontSize) * scale).toFixed(1) : 0,
      inside: left.left >= 0 && right.right <= innerWidth && left.bottom <= innerHeight + 1 && right.bottom <= innerHeight + 1,
      pageScrolls: document.documentElement.scrollHeight > innerHeight + 1 || document.documentElement.scrollWidth > innerWidth,
      sideApart: !side, // no comments window lies over the halves (build 80: a comment opens a card at its place)
    };
  });
  // A click on the text of an arrow or a message that starts with `word`; on the middle of the line of a link between two parts.
  const pointAtLabel = async (word) => {
    const at = await wide.evaluate((text) => {
      const el = [...document.querySelectorAll('#view g.edgeLabel, #view text.messageText')].find((one) => one.textContent.trim().startsWith(text));
      const box = el.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }, word);
    await wide.mouse.move(at.x, at.y, { steps: 4 });
    await wide.mouse.down();
    await wide.mouse.up();
  };
  const linkAt = (from, to) => wide.evaluate(([one, two]) => {
    const index = (id) => App.page.parts.findIndex((part) => part.id === id);
    const hit = [...document.querySelectorAll('#view path.hit')].find((path) => path.previousElementSibling?.id?.startsWith(`L_ap${index(one)}_ap${index(two)}_`));
    const middle = hit.getPointAtLength(hit.getTotalLength() / 2).matrixTransform(hit.getScreenCTM());
    return { x: middle.x, y: middle.y };
  }, [from, to]);
  const pointAtLink = async (from, to) => { const at = await linkAt(from, to); await wide.mouse.move(at.x, at.y, { steps: 4 }); };
  return { wide, quiet, when, loaded, open, show, wideShot, pointAt, clickAt, toGutter, away, halves, pointAtLabel, linkAt, pointAtLink, pointNamed };
}

/** The change on the diagram page: the code beside the diagram on a wide tab, and the change painted into the diagrams of a part. */
async function twoHalves() {
  const { wide, quiet, when, loaded, open, show, wideShot, pointAt, clickAt, toGutter, away, halves, pointAtLabel, linkAt, pointAtLink, pointNamed } = await diagramTab();
  const splitOk = (one) => one.split && one.apart && one.inside && !one.pageScrolls && one.sideApart && one.label >= 11;

  // The page of the change: its diagram at the right, every changed file as one closed row at the left, under the name of its part.
  await open();
  const changeHalves = await halves();
  const changeRight = await wide.evaluate(() => ({
    card: !!document.querySelector('.half.left .sec'), parts: [...document.querySelectorAll('.half.right .dp')].map((el) => el.textContent),
    files: document.querySelectorAll('.half.right .dfile').length, shut: document.querySelectorAll('.half.right .dfile.shut').length, opened: document.querySelectorAll('.half.right .dbody').length,
    more: document.querySelectorAll('.half.right .dmore').length,
  }));
  check('at 1400 px the page of the change is two halves, every changed file as one closed row at the left, part by part, and its diagram at the right, with the folds for many files; neither half is cut off, the page does not scroll, and a node label is at least 11 px high',
    splitOk(changeHalves) && changeHalves.control === 'Hide code' && changeRight.card && changeRight.parts[0] === 'Holds tab' && changeRight.files > 20 && changeRight.shut === changeRight.files && changeRight.opened === 0 && changeRight.more > 0,
    JSON.stringify({ changeHalves, changeRight }));
  await wideShot('40-change-diagram-beside-closed-diffs');

  const worker = 'src/library/night_jobs.py';
  const row = (file) => `.half.right .dfile[data-file="${file}"]`;
  const rowState = (file) => wide.evaluate((selector) => {
    const section = document.querySelector(selector);
    return section ? { open: section.classList.contains('open'), by: section.dataset.by ?? '', rows: section.querySelectorAll('.cn .l').length, body: !!section.querySelector('.dbody') } : null;
  }, row(file));
  const pointRow = async (file) => { await wide.locator(`${row(file)} > .dh`).scrollIntoViewIfNeeded(); await quiet(); await pointAt(`${row(file)} > .dh .c`); }; // the list stands still before its row is measured
  /** A click on the head of a row, left of the file name; it waits until the row opened or closed and nothing moves. */
  const clickHead = async (file) => {
    await wide.locator(`${row(file)} > .dh`).scrollIntoViewIfNeeded();
    const was = (await rowState(file)).open;
    const box = await wide.locator(`${row(file)} > .dh .c`).boundingBox();
    await wide.mouse.click(box.x - 60, box.y + box.height / 2);
    await when(([selector, open]) => document.querySelector(selector).classList.contains('open') !== open, [row(file), was]);
    await quiet();
  };
  const marks = () => wide.evaluate(() => ({
    here: [...document.querySelectorAll('.half.left g.node.here')].map((g) => g.querySelector('b[data-part]')?.dataset.part ?? 'no-part'),
    lit: [...document.querySelectorAll('.half.left .f.lit')].map((line) => line.dataset.file ?? `more:${line.textContent}`),
    window: !!document.querySelector('.win'),
  }));
  const hereIs = (part) => when((id) => [...document.querySelectorAll('.half.left g.node.here')].map((g) => g.querySelector('b[data-part]')?.dataset.part ?? 'no-part').join() === id, part);

  // A click on the head of a row opens its diff below it; a click on its head again closes it. The name of the file still opens its tab.
  await clickHead(worker);
  const opened = await rowState(worker);
  await clickHead(worker);
  const closedAgain = await rowState(worker);
  check('a click on a row opens its diff below it with its rows, and a click on its head closes it again',
    opened.open && opened.by === 'click' && opened.rows > 0 && !closedAgain.open && !closedAgain.body, JSON.stringify({ opened, closedAgain }));

  // A pointer that only crosses a row marks nothing and moves nothing (corrected in build 27). The pointer that rests on a row marks the node of its part and
  // lights its file there, in a short animation; a file that its node does not list (behind "5 more files") takes the place of that line while it is
  // pointed at; when the node is outside the visible part of the diagram, the diagram moves to it.
  const tableFile = 'db/migrations/0042_holds.sql';
  await wide.locator(`${row(tableFile)} > .dh`).scrollIntoViewIfNeeded();
  await toGutter();
  await quiet();
  const viewBefore = await wide.evaluate(() => document.querySelector('.half.left svg').getAttribute('viewBox'));
  const tableHead = await wide.locator(`${row(tableFile)} > .dh`).boundingBox();
  await wide.mouse.move(tableHead.x + tableHead.width - 40, tableHead.y - 30);
  await wide.mouse.move(tableHead.x + tableHead.width - 40, tableHead.y + tableHead.height + 40, { steps: 3 });
  await wide.mouse.move(6, 600);
  await wide.waitForTimeout(350); // kept: "moves nothing" needs a calm page for longer than the rest of the pointer on a row (300 ms)
  const crossed = await wide.evaluate(() => ({ here: document.querySelectorAll('.half.left g.node.here').length, viewBox: document.querySelector('.half.left svg').getAttribute('viewBox') }));
  await pointRow(worker);
  await hereIs('night-job');
  await quiet(); // the light comes in an animation
  const onRow = await marks();
  const litLine = await wide.evaluate((file) => { const line = document.querySelector(`.half.left .f[data-file="${file}"]`); return { background: getComputedStyle(line).backgroundColor, transition: getComputedStyle(line).transitionDuration }; }, worker);
  const behindMore = 'web/src/member/index.ts';
  await pointRow(behindMore);
  await hereIs('holds-tab');
  await quiet();
  const onHidden = await marks();
  await toGutter();
  await when(() => [...document.querySelectorAll('.half.left .f.more')].some((line) => line.textContent === '5 more files'));
  const afterHidden = await wide.evaluate(() => [...document.querySelectorAll('.half.left .f.more')].map((line) => line.textContent));
  const box = await wide.locator('.half.left .surface').boundingBox();
  await wide.mouse.move(box.x + 30, box.y + 90);
  await wide.keyboard.down('Meta');
  for (let at = 0; at < 2; at++) await wide.mouse.wheel(0, -150); // Cmd+scroll zooms: larger, so that the node of the table is out of view, but still smaller than the card
  await wide.keyboard.up('Meta');
  await quiet();
  const tableIn = () => {
    const card = document.querySelector('.half.left .surface').getBoundingClientRect();
    const node = document.querySelector('.half.left b[data-part="tables"]').closest('g.node').getBoundingClientRect();
    return node.left >= card.left && node.right <= card.right && node.top >= card.top && node.bottom <= card.bottom;
  };
  const outBefore = !(await wide.evaluate(tableIn));
  await pointRow(tableFile);
  await when(tableIn);
  await quiet();
  const inAfter = await wide.evaluate(tableIn);
  const onTable = await marks();
  check('a pointer that only crosses a row of the list marks nothing and moves nothing; the pointer that rests on a row marks the node of its part and lights the line of its file there, in an animation of 0.2 seconds, with no window; a file behind "5 more files" gets a line while it is pointed at; a node out of view comes into view',
    crossed.here === 0 && crossed.viewBox === viewBefore
      && onRow.here.join() === 'night-job' && onRow.lit.join() === worker && litLine.background !== 'rgba(0, 0, 0, 0)' && /0\.2s/.test(litLine.transition) && !onRow.window
      && onHidden.here.join() === 'holds-tab' && onHidden.lit.join() === 'more:index.ts +2' && afterHidden.includes('5 more files')
      && outBefore && inAfter && onTable.here.join() === 'tables',
    JSON.stringify({ crossed, viewBefore, onRow, litLine, onHidden, afterHidden, outBefore, inAfter, onTable }));
  await wide.evaluate(() => document.querySelector('.half.left .surface').surface.fit());

  // The pointer that rests on a node brings its part to the top and opens its diffs; they close when it rests on another node, and a diff opened with a
  // click stays; they stay while the pointer reads them; the pointer on one file name in a node opens only that file.
  await clickHead(worker);
  await toGutter();
  await pointAt('.half.left b[data-part="holds-tab"]');
  await when(() => document.querySelectorAll('.half.right .dfile[data-part="holds-tab"].open[data-by="pointer"]').length === 8);
  await quiet();
  const restOne = await wide.evaluate(() => {
    const right = document.querySelector('.half.right');
    const title = right.querySelector('.dp[data-part="holds-tab"]');
    const own = [...right.querySelectorAll('.dfile[data-part="holds-tab"]')];
    return { off: Math.round(title.getBoundingClientRect().top - right.getBoundingClientRect().top), own: own.length, open: own.filter((one) => one.classList.contains('open') && one.dataset.by === 'pointer').length, window: !!document.querySelector('.win') };
  });
  await pointAt('.half.left b[data-part="routes"]');
  await when(() => !document.querySelector('.half.right .dfile[data-part="holds-tab"].open') && !!document.querySelector('.half.right .dfile[data-part="routes"].open'));
  await quiet();
  const restTwo = await wide.evaluate((file) => ({
    holdsTab: document.querySelectorAll('.half.right .dfile[data-part="holds-tab"].open').length,
    routes: document.querySelectorAll('.half.right .dfile[data-part="routes"].open').length,
    worker: document.querySelector(`.half.right .dfile[data-file="${file}"]`).classList.contains('open'), window: !!document.querySelector('.win'),
  }), worker);
  // Leaving the diagram to read the diffs leaves them as they are: the pointer goes to the list, at the left since build prompt 42.
  const listBox = await wide.locator('#view > .half.right').boundingBox();
  await wide.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height * 0.6, { steps: 6 });
  await wide.waitForTimeout(350); // kept: "they stay open" needs a calm page for longer than the rest of the pointer (300 ms)
  const stayed = await wide.evaluate(() => document.querySelectorAll('.half.right .dfile[data-part="routes"].open').length);
  await toGutter();
  const modal = 'web/src/member/HoldDialog.tsx';
  await pointAt(`.half.left .f[data-file="${modal}"]`);
  await when((file) => [...document.querySelectorAll('.half.right .dfile.open[data-by="pointer"]')].map((one) => one.dataset.file).join() === file, modal);
  await quiet();
  const onName = await wide.evaluate((file) => {
    const right = document.querySelector('.half.right');
    const section = right.querySelector(`.dfile[data-file="${file}"]`);
    return {
      pointerOpen: [...right.querySelectorAll('.dfile.open[data-by="pointer"]')].map((one) => one.dataset.file), off: Math.round(section.getBoundingClientRect().top - right.getBoundingClientRect().top - (right.querySelector('.dp')?.offsetHeight ?? 0)), // under the name of its part
      window: !!document.querySelector('.win'),
    };
  }, modal);
  check('the pointer that rests on a node brings its part to the top of the list and opens the diffs of its files; on another node those close and its diffs open, and a diff opened with a click stays; they stay open while the pointer reads them; the pointer on one file name opens only that file, at the top; no window opens',
    Math.abs(restOne.off) <= 3 && restOne.own === 8 && restOne.open === 8 && !restOne.window && restTwo.holdsTab === 0 && restTwo.routes === 1 && restTwo.worker && !restTwo.window
      && stayed === 1 && onName.pointerOpen.join() === modal && Math.abs(onName.off) <= 3 && !onName.window, JSON.stringify({ restOne, restTwo, stayed, onName }));

  // A comment on a row of an open diff, as on "Diffs"; a point of the check on a file whose diff is closed is still in the comments window, and a click on
  // it opens that diff at its lines.
  await toGutter();
  await wide.evaluate((selector) => { const right = document.querySelector('.half.right'); right.scrollTop += document.querySelector(selector).getBoundingClientRect().top - right.getBoundingClientRect().top; }, row(worker));
  await quiet();
  await wide.keyboard.press('Meta+Shift+Period');
  const diffRow = wide.locator(`${row(worker)} .l.add[data-line]`).first();
  const rowLine = await diffRow.getAttribute('data-line');
  const rowBox = await diffRow.boundingBox();
  await wide.mouse.click(rowBox.x + 160, rowBox.y + rowBox.height / 2);
  await wide.waitForSelector('.cbox [data-field="new"]:focus', { timeout: 3000 }).catch(() => {});
  const commentWhere = await wide.evaluate(() => document.querySelector('.cbox .where')?.title ?? '');
  await wide.keyboard.press('Escape');
  const service = 'src/library/lending/hold_service.py';
  const serviceShut = (await rowState(service))?.open === false;
  await wide.click('[data-comments]'); // the list of the comments, with its open points
  await wide.click('.cml [data-show-points]');
  await wide.locator('.cml .cmr.point', { hasText: 'lines 214' }).first().click();
  await when((selector) => !!document.querySelector(`${selector} .l.flash[data-line]`), row(service));
  const fromPoint = await wide.evaluate((selector) => {
    const right = document.querySelector('.half.right');
    const flashed = [...document.querySelectorAll(`${selector} .l.flash[data-line]`)];
    return { open: document.querySelector(selector).classList.contains('open'), flashed: flashed.map((one) => Number(one.dataset.line)), shown: flashed.some((one) => { const box = one.getBoundingClientRect(); const half = right.getBoundingClientRect(); return box.top >= half.top && box.bottom <= half.bottom; }) };
  }, row(service));
  check('a comment works on a row of an open diff in the list, and its box names that file and line; a point on a file whose diff is closed stays in the list of the comments, and a click on it opens that diff at its lines, lit',
    commentWhere === `${worker}, line ${rowLine}` && serviceShut && fromPoint.open && fromPoint.flashed[0] === 214 && fromPoint.shown, JSON.stringify({ commentWhere, serviceShut, fromPoint }));

  // J and K go to the next and the previous row: it comes to the top and opens, and the one that the keys opened before closes. J once landed 140 px off
  // when the diff above it closed after the glide ended (build 41): the check reads the place when nothing moves any more.
  await open();
  await wide.mouse.move(800, 880);
  const keyState = () => wide.evaluate(() => {
    const right = document.querySelector('.half.right');
    const keyed = [...right.querySelectorAll('.dfile.open[data-by="key"]')];
    return { keyed: keyed.map((one) => one.dataset.file), off: keyed[0] ? Math.round(keyed[0].getBoundingClientRect().top - right.getBoundingClientRect().top - (right.querySelector('.dp')?.offsetHeight ?? 0)) : null }; // under the name of its part
  });
  const press = async (key, file) => {
    await wide.keyboard.press(key);
    await when((path) => [...document.querySelectorAll('.half.right .dfile.open[data-by="key"]')].map((one) => one.dataset.file).join() === path, file);
    await quiet();
    return keyState();
  };
  const firstJ = await press('j', modal);
  const secondJ = await press('j', 'web/src/member/HoldsPanel.test.tsx');
  const thenK = await press('k', modal);
  check('J opens the next row at the top and closes the one that the keys opened before; K goes back',
    firstJ.keyed.join() === modal && secondJ.keyed.join() === 'web/src/member/HoldsPanel.test.tsx' && thenK.keyed.join() === modal
    && [firstJ, secondJ, thenK].every((one) => Math.abs(one.off) <= 3), JSON.stringify({ firstJ, secondJ, thenK }));

  // With less motion asked for, nothing animates: a diff opens and the list scrolls at once.
  // Read as soon as the diff is open and the part is at the top: an animation would still run then.
  await wide.emulateMedia({ reducedMotion: 'reduce' });
  await wide.locator(`${row(worker)} > .dh`).scrollIntoViewIfNeeded();
  const workerHead = await wide.locator(`${row(worker)} > .dh .c`).boundingBox();
  await wide.mouse.click(workerHead.x - 60, workerHead.y + workerHead.height / 2);
  await when((selector) => document.querySelector(selector).classList.contains('open'), row(worker));
  const clicked = await wide.evaluate((selector) => ({
    open: document.querySelector(selector).classList.contains('open'), less: lessMotion(),
    animations: document.getAnimations().filter((one) => document.getElementById('view').contains(one.effect?.target)).length,
  }), row(worker));
  const routesNode = await wide.locator('.half.left b[data-part="routes"]').boundingBox();
  await wide.mouse.move(routesNode.x + 10, routesNode.y + 6, { steps: 3 });
  await when(() => !!document.querySelector('.half.right .dfile[data-part="routes"].open'));
  const rested = await wide.evaluate(() => {
    const right = document.querySelector('.half.right');
    return {
      off: Math.round(right.querySelector('.dp[data-part="routes"]').getBoundingClientRect().top - right.getBoundingClientRect().top),
      animations: document.getAnimations().filter((one) => document.getElementById('view').contains(one.effect?.target)).length,
    };
  });
  await wide.emulateMedia({ reducedMotion: 'no-preference' });
  check('with less motion asked for, nothing animates: a click opens a diff at once, and a node brings its part to the top at once',
    clicked.less && clicked.open && clicked.animations === 0 && Math.abs(rested.off) <= 3 && rested.animations === 0, JSON.stringify({ clicked, rested }));

  // The page of a part with a diagram of one file: the file at the left as a file tab shows it, opened at the lines of the diagram.
  await open({ level: 'part', part: 'hold-service', diagram: 'offer-flow' });
  const partHalves = await halves();
  const filePart = await wide.evaluate(() => {
    const right = document.querySelector('.half.right');
    const head = right.querySelector('.fh');
    const top = right.getBoundingClientRect().top + head.offsetHeight;
    const firstShown = Number([...right.querySelectorAll('.l[data-line]')].find((row) => row.getBoundingClientRect().bottom > top + 2)?.dataset.line);
    const nodes = [...document.querySelectorAll('.half.left g.node')];
    return {
      head: head.textContent, marks: right.querySelectorAll('.mk').length, firstShown, nodes: nodes.length, green: nodes.filter((g) => g.classList.contains('d-add')).length,
      words: document.querySelector('#tabs .dchg')?.textContent, ready: document.querySelector('.half.left g.node[id*="-ready-"] .ln')?.textContent,
      fill: getComputedStyle(document.querySelector('.half.left g.node[id*="-each-"] polygon')).fill, boxFill: getComputedStyle(document.querySelector('.half.left g.node[id*="-ready-"] rect')).fill,
    };
  });
  check('on the page of a part the left half shows the file of its diagram with its counts, its notes as marks at the right edge, opened at the lines of the diagram; the flow chart of a new file colours no step, counts the steps beside its title, and a step shows its diff where its line number stood',
    splitOk(partHalves) && filePart.head === 'src/library/lending/hold_service.py+296Hide code' && filePart.marks === 7 && filePart.firstShown >= 192 && filePart.firstShown <= 208
    && filePart.nodes === 10 && filePart.green === 10 && filePart.words === '+10 steps' && filePart.ready === '+7' && filePart.fill === filePart.boxFill && /^rgb\(25\d, 25\d, 2[45]\d\)$/.test(filePart.fill), JSON.stringify({ partHalves, filePart }));
  await wideShot('43-part-diagram-beside-its-file');

  // The code follows a click, not the pointer. The pointer on a step lights it after the delay and moves no code (no window, no line to rows out of view);
  // a click brings its rows into view and draws one line to them, and keeps them until the next click. The pointer on rows lights their step.
  await wide.evaluate(() => { document.querySelector('.half.right').scrollTop = 0; });
  const joinOf = () => wide.evaluate(() => {
    const right = document.querySelector('.half.right').getBoundingClientRect();
    const lit = [...document.querySelectorAll('.half.right .l.step')];
    const lines = lit.filter((row) => row.dataset.line).map((row) => Number(row.dataset.line));
    const shown = lit.filter((row) => { const box = row.getBoundingClientRect(); return box.bottom > right.top && box.top < right.bottom; }).length;
    return { first: Math.min(...lines), last: Math.max(...lines), shown, joins: document.querySelectorAll('#view svg.join path').length, window: !!document.querySelector('.win, .places-half'),
      top: document.querySelector('.half.right').scrollTop, step: [...document.querySelectorAll('.half.left g.node.joined')].map((g) => nodeKey(g)).join() };
  });
  const joinedStep = (key) => when((wanted) => [...document.querySelectorAll('.half.left g.node.joined')].map((g) => nodeKey(g)).join() === wanted && document.querySelectorAll('#view svg.join path').length === 1, key);
  await pointAt('.half.left g.node[id*="-pick-"]');
  await when(() => [...document.querySelectorAll('.half.left g.node.joined')].map((g) => nodeKey(g)).join() === 'pick');
  await wide.waitForTimeout(500); // the wait of a hover window is over: nothing moves
  const onStep = await joinOf();
  await wide.locator('.half.left g.node[id*="-pick-"]').click();
  await joinedStep('pick');
  await quiet();
  const clickedStep = await joinOf();
  await wideShot('44-a-step-joined-to-its-rows');
  const runRow = await wide.locator('.half.right .l[data-line="235"]').boundingBox();
  await wide.mouse.move(runRow.x + 220, runRow.y + runRow.height / 2, { steps: 3 });
  await joinedStep('each');
  const onRows = await joinOf();
  await wide.locator('.half.left g.node[id*="-start-"]').click();
  await wide.mouse.move(700, 880); // the pointer leaves: the click keeps the step
  await quiet();
  const kept = await joinOf();
  const stillHere = await wide.evaluate(() => App.state.view);
  const diagramBox = await wide.locator('#view > .half.left').boundingBox();
  await wide.mouse.click(diagramBox.x + 20, diagramBox.y + diagramBox.height - 20); // an empty place of the diagram, at the right since build prompt 42
  await when(() => !document.querySelector('#view svg.join path'));
  const cleared = await joinOf();
  check('the pointer on a step only lights it and moves no code, with no window and no line to rows out of view; a click on it brings its rows into view, draws one line to them, and keeps them lit until the next click, with no file tab; the pointer on rows of a step lights that step',
    onStep.step === 'pick' && onStep.top === 0 && onStep.joins === 0 && !onStep.window
      && clickedStep.first === 219 && clickedStep.last === 233 && clickedStep.shown > 0 && clickedStep.joins === 1 && !clickedStep.window && clickedStep.top > 0 && clickedStep.step === 'pick'
      && onRows.step === 'each' && onRows.first === 235 && onRows.last === 236 && onRows.joins === 1
      && kept.step === 'start' && kept.first === 208 && kept.joins === 1 && stillHere === 'diagram' && !cleared.step && cleared.joins === 0,
    JSON.stringify({ onStep, clickedStep, onRows, kept, stillHere, cleared }));

  // A diagram with no file (here the states of the example with its file taken away): the diffs of the files of its part at the left, with no joins.
  const statesFile = await wide.evaluate(() => { const states = App.page.diagrams.find((one) => one.id === 'hold-states'); const was = states.file; delete states.file; return was; });
  await show({ level: 'part', part: 'tables', diagram: 'hold-states' });
  const tableRight = await wide.evaluate(() => ({
    files: [...document.querySelectorAll('.half.right .dfile')].map((section) => section.dataset.file), own: App.page.parts.find((part) => part.id === 'tables').files,
    open: document.querySelectorAll('.half.right .dfile.open .cn .l').length > 0 && document.querySelectorAll('.half.right .dfile.shut').length === 0,
  }));
  check('a diagram with no file has the list of the files of its part at the left, all open when they are three or fewer',
    (await halves()).split && tableRight.files.length === 2 && tableRight.files.every((file) => tableRight.own.includes(file)) && tableRight.open, JSON.stringify(tableRight));
  await wide.evaluate((file) => { App.page.diagrams.find((one) => one.id === 'hold-states').file = file; }, statesFile);

  // "Hide code" and "Show code" at the same place; the choice lasts after a reload.
  await open();
  const shownPlace = (await halves()).place;
  await wide.click('[data-half="code"]');
  await when(() => !document.querySelector('#view > .half'));
  await quiet();
  const hidden = await halves();
  await wide.reload();
  await loaded();
  const hiddenAfterReload = await halves();
  await wide.click('[data-half="code"]');
  await when(() => !!document.querySelector('#view > .half.left svg'));
  await quiet();
  const shownAgain = await halves();
  check('"Hide code" over the code shows the diagram alone, "Show code" at the left of the line above the diagram brings the code back, and the choice lasts after a reload',
    !hidden.split && hidden.control === 'Show code' && !hiddenAfterReload.split && hiddenAfterReload.control === 'Show code' && splitOk(shownAgain) && shownAgain.control === 'Hide code'
    && hidden.place.right < shownPlace.right && hidden.place.top < shownPlace.top, JSON.stringify({ shownPlace, hidden, hiddenAfterReload, shownAgain }));

  // Made-up diagrams that hold what the example change does not: a changed and a removed step, a removed state and transition, a removed message.
  const page23 = await wide.evaluate(() => ({ parts: App.page.parts, links: App.page.links, files: App.page.files, filesInNoPart: App.page.checks.filesInNoPart }));
  const workerCode = await wide.evaluate((path) => ask(`code:${path}`), worker);
  const { shopFlow, shopStates, shopTransitions, shopSequence, workerLines, runEnd, broken } = madeUpDiagrams(workerCode);
  const drillUp = changeMermaid({ parts: page23.parts, links: page23.links, files: page23.files, filesInNoPart: page23.filesInNoPart }, { part: 'hold-service', whole: withRemoved(shopFlow, shopFlow.change, shopFlow.mermaid) });
  await wide.evaluate(({ diagrams, drillUp }) => {
    App.page.diagrams.push(...diagrams);
    Object.assign(App.page.parts.find((part) => part.id === 'hold-service'), { diagrams: diagrams.map((diagram) => diagram.id), drillUp });
  }, { diagrams: [shopFlow, shopStates, shopTransitions, shopSequence, broken, runEnd], drillUp });
  const painted = () => wide.evaluate(() => {
    const keys = (kind) => [...document.querySelectorAll(`#view g.node.d-${kind}`)].map((g) => nodeKey(g)).sort().join();
    const label = (key) => document.querySelector(`#view g.node[id*="-${key}-"] .ln`)?.textContent;
    const removedBox = document.querySelector('#view g.node.d-removed :is(rect,polygon,path)');
    const look = (selector, what) => { const el = document.querySelector(selector); return el ? getComputedStyle(el)[what] : ''; }; // a diagram can have no such node
    return {
      added: keys('add'), both: keys('both'), del: keys('del'), changed: keys('changed'), removed: keys('removed'), newEdges: document.querySelectorAll('#view path.d-add').length, removedEdges: document.querySelectorAll('#view path.d-removed').length,
      words: document.querySelector('#tabs .dchg')?.textContent, plain: document.querySelector('.half.left svg')?.hasAttribute('data-plain'),
      counts: ['take', 'check', 'done', 'pack'].map(label).join('|'), bothFill: document.querySelector('#view g.node.d-both polygon') && getComputedStyle(document.querySelector('#view g.node.d-both polygon')).fill,
      greenFill: look('#view g.node.d-add rect', 'fill'), redFill: look('#view g.node.d-del rect', 'fill'),
      numbers: [look('#view g.node.d-both .ln .p', 'color'), look('#view g.node.d-both .ln .m', 'color')].join('|'),
      removedLine: removedBox ? getComputedStyle(removedBox).stroke : '',
      arrows: [look('#view path.d-add', 'stroke'), look('#view path.d-removed', 'stroke'), look('#view path.d-removed', 'strokeDasharray')].join('|'),
      dashed: removedBox ? getComputedStyle(removedBox).strokeDasharray : '', error: !!document.querySelector('#view .err'),
    };
  });
  const rendered = () => wide.evaluate(() => window.apostilRendered);
  await show({ level: 'part', part: 'hold-service', diagram: 'shop-flow' });
  const flowMarks = await painted();
  check('a flow chart colours no step: a step with added lines, with removed lines or with both has the fill of any step and shows its counts where its line number stood, in green and red, and a step with no diff keeps its line number; a removed step is back in with a dashed border that is not red; no arrow is coloured, and a removed arrow is dashed; the total says "+2 steps −1 step · 3 changed"',
    flowMarks.added === 'pack,ship,take' && flowMarks.both === 'check' && flowMarks.del === 'done' && flowMarks.changed === '' && flowMarks.removed === 'mail' && flowMarks.newEdges === 3 && flowMarks.removedEdges === 2
    && flowMarks.words === '+2 steps −1 step · 3 changed' && flowMarks.greenFill === flowMarks.redFill && flowMarks.bothFill === flowMarks.greenFill && /^rgb\(25\d, 25\d, 2[45]\d\)$/.test(flowMarks.greenFill)
    && flowMarks.numbers === 'rgb(4, 120, 87)|rgb(180, 35, 24)' && flowMarks.counts === '+2|+1 −1|−1|lines 248–249' && /5/.test(flowMarks.dashed) && !/180, 35, 24/.test(flowMarks.removedLine)
    && !/4, 120, 87|180, 35, 24/.test(flowMarks.arrows) && /5/.test(flowMarks.arrows.split('|')[2]) && !flowMarks.plain, JSON.stringify(flowMarks));
  await wideShot('70-plain-nodes-with-diff-numbers-in-green-and-red');
  // The same marks inside the diagram of the change after drill up, and, with the code hidden, in the window on the part.
  const drawnBefore = await rendered();
  await wide.click('#crumb a[data-trail="1"]');
  await when((count) => window.apostilRendered > count, drawnBefore);
  await quiet();
  const drilled = await painted();
  await wide.evaluate(() => { App.page.parts.find((one) => one.id === 'hold-service').drillUp = undefined; Split.setHidden('code', true); }); // beside the diffs no window opens on a part
  await show({ level: 'change', from: null });
  await pointAt('#view b[data-part="hold-service"]');
  await when(() => !!document.querySelector('.win g.node.d-removed') && /steps/.test(document.querySelector('.win .tb .sub')?.textContent ?? ''));
  const inWindow = await wide.evaluate(() => ({ sub: document.querySelector('.win .tb .sub')?.textContent, removed: document.querySelectorAll('.win g.node.d-removed').length, added: document.querySelectorAll('.win g.node.d-add').length }));
  await away();
  await wide.evaluate(() => Split.setHidden('code', false));
  check('after drill up the part keeps its diagram whole with the same marks, the removed step back and dashed; with the code hidden, the window on the part shows them too, with the total beside its title',
    drilled.added === 'pack,ship,take' && drilled.both === 'check' && drilled.removed === 'mail' && drilled.removedEdges === 2
      && inWindow.removed === 1 && inWindow.added === 3 && /\+2 steps −1 step · 3 changed/.test(inWindow.sub), JSON.stringify({ drilled, inWindow }));

  await show({ level: 'part', part: 'hold-service', diagram: 'shop-states' });
  const stateMarks = await painted();
  check('a state diagram shows a new state, a removed state and its removed transitions; the total says "+1 state −1 state · +1 transition −2 transitions"',
    stateMarks.added === 'delivered' && stateMarks.removed === 'lost' && stateMarks.newEdges === 1 && stateMarks.removedEdges === 2 && stateMarks.words === '+1 state −1 state · +1 transition −2 transitions', JSON.stringify(stateMarks));

  // A transition and a message with code lines: their change at their label, and the pointer joins them to their rows in the file at the left.
  const joined = () => when(() => document.querySelectorAll('#view svg.join path').length === 1 && !!document.querySelector('.half.right .l.step')).then(quiet);
  await show({ level: 'part', part: 'hold-service', diagram: 'shop-sequence' });
  const messages = await wide.evaluate(() => ({
    texts: [...document.querySelectorAll('#view text.messageText')].map((text) => `${text.textContent}${text.classList.contains('d-add') ? ':new' : text.classList.contains('d-removed') ? ':removed' : ''}`),
    dashed: [...document.querySelectorAll('#view .d-removed:is(line,path)')].map((line) => getComputedStyle(line).strokeDasharray), words: document.querySelector('#tabs .dchg')?.textContent,
  }));
  await away();
  await pointAtLabel('lock the orders');
  await joined();
  const lockJoin = await joinOf();
  check('a sequence shows a new message and a removed message at its place, and the total says "+1 message −1 message"; the pointer on a message with code lines lights its rows in the file at the left and draws one line to them',
    messages.texts.join('|') === 'wake up|load the orders|mail the owner:removed|lock the orders +3:new|counts' && messages.dashed.length === 1 && /5/.test(messages.dashed[0]) && messages.words === '+1 message −1 message'
      && lockJoin.first === 248 && lockJoin.last === 250 && lockJoin.joins === 1 && !lockJoin.window, JSON.stringify({ messages, lockJoin }));
  await show({ level: 'part', part: 'hold-service', diagram: 'shop-transitions' });
  const arrows = await wide.evaluate(() => ({
    paints: [...document.querySelectorAll('#view .edgePaths path:not(.hit)')].map((path) => ['add', 'del', 'both'].find((kind) => path.classList.contains(`d-${kind}`)) ?? ''),
    counts: [...document.querySelectorAll('#view text.ecount')].map((text) => text.textContent), words: document.querySelector('#tabs .dchg')?.textContent,
  }));
  await away();
  await pointAtLabel('send');
  await joined();
  const sendJoin = { ...(await joinOf()), lit: await wide.evaluate(() => document.querySelectorAll('#view path.joined:not(.hit)').length) };
  check('transitions with code lines show their change: added lines green, removed lines red, both green and red, each with its counts at its label, and the total counts them; the pointer on one lights its rows in the file at the left and draws one line to them, with no window',
    arrows.paints.join() === ',add,both,,del' && arrows.counts.join('|') === '+2|+1 −1|−1' && arrows.words === '+1 transition · 2 changed'
      && sendJoin.first === 245 && sendJoin.last === 247 && sendJoin.joins === 1 && sendJoin.lit === 1 && !sendJoin.window, JSON.stringify({ arrows, sendJoin }));
  await show({ level: 'part', part: 'hold-service', diagram: 'shop-broken' });
  const brokenMarks = await painted();
  check('a text with the removed things that does not draw still draws the diagram of now, with the marks that need no removed thing and the total, and no error',
    brokenMarks.plain && !brokenMarks.error && brokenMarks.added === 'pack,ship,take' && brokenMarks.both === 'check' && brokenMarks.removed === '' && brokenMarks.removedEdges === 0 && brokenMarks.words === '+2 steps −1 step · 3 changed', JSON.stringify(brokenMarks));

  // ----- the code of each node and arrow (build prompt 25) -----
  const placesShown = () => wide.evaluate(() => ({
    heads: [...document.querySelectorAll('.places-half .plh a')].map((a) => a.textContent), lit: document.querySelectorAll('.places-half .l.lit').length,
    check: document.querySelector('.places-half .pck')?.textContent ?? '', joins: document.querySelectorAll('#view svg.join path').length, window: document.querySelector('.win .tb b')?.textContent ?? '',
  }));
  // A thing with places in three files: the left half shows them one under the other while the pointer rests on it; then the file of the diagram is back.
  await show({ level: 'part', part: 'tables', diagram: 'hold-states' });
  await away();
  await pointAtLabel('place');
  await when(() => document.querySelectorAll('.places-half .plh a').length === 3);
  await quiet();
  const create = await placesShown();
  await away();
  await when(() => !document.querySelector('.places-half'));
  const back = await wide.evaluate(() => ({ places: !!document.querySelector('.places-half'), file: document.querySelector('.half.right .fh a')?.textContent }));
  const fills = await wide.evaluate(() => [...new Set([...document.querySelectorAll('#view g.node :is(rect,polygon)')].filter((el) => !el.closest('.opt')).map((el) => getComputedStyle(el).fill))]);
  check('the pointer on a transition with places in three files shows them one under the other over the file at the left, each with its file name and its rows lit; when it leaves, the file of the diagram is back; no state has a colour from the change',
    create.heads.join('|') === 'src/library/lending/hold_service.py|src/library/lending/hold_models.py|db/migrations/0042_holds.sql' && create.lit === 30 + 1 + 1 && !create.window
      && !back.places && back.file === 'db/migrations/0042_holds.sql' && fills.every((fill) => /^rgb\(25\d, 25\d, 2[45]\d\)$|^none$|^rgb\(0, 0, 0\)$/.test(fill)), JSON.stringify({ create, back, fills }));

  // A removed transition shows its −1 and is joined to its red row; the transition that stands there now has only its own +1. A thing with a reason.
  await show({ level: 'part', part: 'hold-service', diagram: 'run-end' });
  await away();
  const endCounts = await wide.evaluate(() => [...document.querySelectorAll('#view text.ecount')].map((text) => text.textContent));
  await pointAtLabel('log the sweep failure');
  await when(() => !!document.querySelector('.half.right .l.del.step') && document.querySelectorAll('#view svg.join path').length === 1);
  await quiet();
  const removedJoin = await wide.evaluate(() => ({
    red: [...document.querySelectorAll('.half.right .l.del.step')].map((row) => row.dataset.old), joins: document.querySelectorAll('#view svg.join path').length,
    dashed: getComputedStyle(document.querySelector('#view path.d-removed')).strokeDasharray,
  }));
  await away();
  await pointAt('#view g.node[id*="-idle-"]');
  await wide.waitForSelector('.win .why', { timeout: 3000 }).catch(() => {});
  const reason = await wide.evaluate(() => ({ title: document.querySelector('.win .tb b')?.textContent, why: document.querySelector('.win .why')?.textContent, joins: document.querySelectorAll('#view svg.join path').length }));
  check('a removed transition shows its "−1" and the pointer joins it to its red row; its neighbour that stands there now has only its own "+1"; the pointer on a thing with a reason shows the reason in plain words in a small window, and nothing else',
    endCounts.join('|') === '+3 −6|+1|−1' && removedJoin.red.join() === '539' && removedJoin.joins === 1 && /5/.test(removedJoin.dashed)
      && reason.title === 'idle' && reason.why === 'No line of its own.' && reason.joins === 0, JSON.stringify({ endCounts, removedJoin, reason }));
  await away();

  // A removed line is a changed line in no step too: the end of the night run with one transition that holds lines, and the removed line (old line 539) that no
  // transition holds. The count is the added lines in no transition plus that one, and the removed row has the quiet mark.
  const runCovered = {
    ...partDiagram({
      id: 'run-covered', kind: 'state', title: 'How a night run ends, in part', file: worker, covers: [526, 540],
      mermaid: 'stateDiagram-v2\n  running --> idle: requeued', nodeLines: { running: 'no-line', idle: 'no-line' }, edgeLines: [{ from: 'running', to: 'idle', lines: [531, 533] }],
    }, { fileChange: () => workerLines, text: () => workerCode.lines, fileIsNew: false, checked: false }), part: 'hold-service',
  };
  await wide.evaluate((diagram) => { App.page.diagrams.push(diagram); App.page.parts.find((part) => part.id === 'hold-service').diagrams.push(diagram.id); }, runCovered);
  await show({ level: 'part', part: 'hold-service', diagram: 'run-covered' });
  const noStep = await wide.evaluate(() => ({
    words: document.querySelector('#tabs .dfact.nothing')?.textContent, added: App.page.diagrams.find((one) => one.id === 'run-covered').inNoThing.length,
    removed: App.page.diagrams.find((one) => one.id === 'run-covered').inNoThingRemoved,
    markedRemoved: [...document.querySelectorAll('.half.right .l.del.nothing')].map((row) => row.dataset.old),
    markedAdded: document.querySelectorAll('.half.right .l.add.nothing').length,
  }));
  check('the count of changed lines in no step counts a removed line: the added lines in no transition plus the removed line 539, and that removed row has the quiet mark in the code',
    noStep.removed.join() === '539' && noStep.markedRemoved.join() === '539' && noStep.added >= 1 && noStep.markedAdded >= 1
    && noStep.words === `${noStep.added + 1} changed lines in no state or transition`, JSON.stringify(noStep));

  // The example flow chart: the count of changed lines in no step, with its marked rows; "checked" beside the title; an open point at a step;
  // a "yes" out of a decision lights the rows of the decision.
  await wide.evaluate(() => App.page.parts.find((part) => part.id === 'hold-service').diagrams.push('offer-flow', 'offer-sequence')); // the made-up diagrams took their place
  await show({ level: 'part', part: 'hold-service', diagram: 'offer-flow' });
  const facts = await wide.evaluate(() => ({
    words: [...document.querySelectorAll('#tabs .dfact')].map((el) => el.textContent), marked: [...document.querySelectorAll('.half.right .l.nothing')].map((row) => Number(row.dataset.line)),
    point: !!document.querySelector('#view g.node[id*="-open-"] .opt'),
  }));
  await pointAtLabel('yes');
  await joined();
  const yes = await joinOf();
  const yesLabel = await wide.evaluate(() => {
    const label = document.querySelector('#view g.edgeLabel.joined');
    const els = label ? [...label.querySelectorAll('span, p, div')] : [];
    return {
      found: !!label, color: els.length && getComputedStyle(els.at(-1)).color,
      plain: els.every((el) => { const look = getComputedStyle(el); return look.boxShadow === 'none' && (look.outlineStyle === 'none' || look.outlineWidth === '0px') && look.borderTopWidth === '0px' && look.borderBottomWidth === '0px'; }),
    };
  });
  check('the pointer on a "yes" out of a decision lights the rows of that decision; the text of the joined arrow has no box, no outline and no border, in the teal of "joined"',
    yes.first === 214 && yes.last === 214 && yes.joins === 1 && yesLabel.found && yesLabel.plain && yesLabel.color === 'rgb(15, 118, 110)', JSON.stringify({ yes, yesLabel }));
  await away();
  await when(() => !document.querySelector('#view svg.join path'));
  await clickAt('#view g.node[id*="-open-"]');
  await when(() => !!document.querySelector('.places-half .pck'));
  const pointAtStep = await placesShown();
  const sideLabel = await pointNamed('Node');
  check('beside the title of the flow chart: "7 changed lines in no step" and "checked", and the head of the function, in no step, has a quiet mark in the code; an open point at a step marks the step, shows at the step with its places, and stands under "Open points"',
    facts.words.join('|') === '7 changed lines in no step|checked' && facts.marked.length >= 1 && facts.marked.every((line) => line >= 197 && line <= 206)
      && facts.point && /^Check: The step asks only whether the library is open/.test(pointAtStep.check) && pointAtStep.heads.length === 1 && sideLabel.startsWith('Node "Library open today?"'),
    JSON.stringify({ facts, pointAtStep, sideLabel }));
  await away();
  await show({ level: 'part', part: 'hold-service', diagram: 'offer-sequence' });
  const sequenceFacts = await wide.evaluate(() => [...document.querySelectorAll('#tabs .dfact')].map((el) => el.textContent));
  // A participant that stands for a whole file shows the head of that file and its counts.
  await clickAt('#view rect.actor[name="S"]');
  await when(() => !!document.querySelector('.places-half .plh'));
  const table = await wide.evaluate(() => ({ head: document.querySelector('.places-half .plh')?.textContent, rows: document.querySelectorAll('.places-half .l').length }));
  check('a diagram that no second agent read says "not checked yet"; a participant that stands for a whole file shows its file name, "whole file" and its counts, with no rows',
    sequenceFacts.at(-1) === 'not checked yet' && /hold_service\.py.*whole file.*\+296/.test(table.head ?? '') && table.rows === 0, JSON.stringify({ sequenceFacts, table }));
  await away();

  // ----- the code of the links between the parts (build prompt 26) -----
  const linkShown = () => wide.evaluate(() => {
    const right = document.querySelector('.half.right');
    const lit = [...right.querySelectorAll('.l.step')].map((row) => Number(row.dataset.line)).filter(Boolean);
    const first = right.querySelector('.dfile.open');
    return {
      file: first?.dataset.file ?? '', top: first ? Math.round(first.getBoundingClientRect().top - right.getBoundingClientRect().top - (right.querySelector('.dp')?.offsetHeight ?? 0)) : null, lit: lit.length ? `${Math.min(...lit)}-${Math.max(...lit)}` : '',
      joined: document.querySelectorAll('.half.left path.joined:not(.hit)').length, window: !!document.querySelector('.win'),
      heads: [...document.querySelectorAll('.places-half .plh a')].map((a) => a.textContent), placeLit: document.querySelectorAll('.places-half .l.lit').length,
      check: document.querySelector('.places-half .pck')?.textContent ?? '',
    };
  });
  const linkRows = () => when(() => !!document.querySelector('.half.right .l.step')).then(quiet);
  const places = (count) => when((wanted) => document.querySelectorAll('.places-half .plh a').length === wanted, count).then(quiet);
  const nothingShown = () => when(() => !document.querySelector('.places-half') && !document.querySelector('.half.right .l.step') && !document.querySelector('.win'));
  await show({ level: 'change', from: null });
  await toGutter();
  const linkCounts = await wide.evaluate(() => ({
    counts: [...document.querySelectorAll('.half.left text.ecount')].map((text) => text.textContent), checked: [...document.querySelectorAll('.sec .sh .dfact')].map((el) => el.textContent),
    colours: [...new Set([...document.querySelectorAll('.half.left .edgePaths path:not(.hit)')].map((path) => getComputedStyle(path).stroke))],
  }));
  check('each link of the example has its code: a link with a diff has its counts at the middle of its line, in green; no link is coloured by the change; beside the title "not checked yet"',
    linkCounts.counts.join('|') === '+3|+4|+4|+1|+1' && linkCounts.checked.join() === 'not checked yet' && !linkCounts.colours.some((stroke) => /4, 120, 87|180, 35, 24/.test(stroke)), JSON.stringify(linkCounts));

  // The pointer on a link: the diff of its place comes to the top, open at its lines, and its rows light. A click keeps it; a click elsewhere lets it go.
  // Places in two files: one under the other over the list.
  await pointAtLink('night-job', 'hold-service');
  await linkRows();
  const onLink = await linkShown();
  const linkPoint = await linkAt('night-job', 'hold-service');
  await wide.mouse.click(linkPoint.x, linkPoint.y);
  await toGutter();
  await quiet();
  const linkKept = await linkShown();
  const surface = await wide.locator('.half.left .surface').boundingBox();
  await wide.mouse.click(surface.x + 20, surface.y + surface.height - 20);
  await when(() => !document.querySelector('.half.right .l.step'));
  const letGo = await linkShown();
  await pointAtLink('holds-tab', 'routes');
  await places(2);
  const twoFiles = await linkShown();
  check('the pointer on the link "Night job → Hold service" brings the diff of night_jobs.py to the top, opens it at lines 244–247 and lights those rows, the link joined and no window; a click keeps them after the pointer leaves, and a click elsewhere in the diagram lets them go; a link with places in two files shows them one under the other over the list, each with its file name and its rows lit',
    onLink.file === worker && onLink.top !== null && Math.abs(onLink.top) <= 4 && onLink.lit === '244-247' && onLink.joined === 1 && !onLink.window && !onLink.heads.length
      && linkKept.lit === '244-247' && linkKept.joined === 1 && letGo.lit === '' && letGo.joined === 0
      && twoFiles.heads.join('|') === 'web/src/member/holdsApi.ts|src/library/web/holds_router.py' && twoFiles.placeLit === 2 + 1 && twoFiles.joined === 1 && !twoFiles.window,
    JSON.stringify({ onLink, linkKept, letGo, twoFiles }));
  await toGutter();
  await nothingShown();

  // Made up: a link with a text, a link whose place is on a line that the change did not touch, and a link with a reason.
  const unchanged = await wide.evaluate(async (path) => {
    const code = await ask(`code:${path}`);
    return Array.from({ length: code.lines.length }, (_, at) => at + 1).find((one) => one > 50 && !code.changed.some(([first, last]) => first - 3 <= one && one <= last + 3) && code.lines[one - 1].trim());
  }, worker);
  const labelled = await wide.evaluate(() => ({ parts: App.page.parts, links: App.page.links.map((link, at) => (at === 2 ? { ...link, label: 'offer_returned_copies' } : link)), files: App.page.files, filesInNoPart: App.page.checks.filesInNoPart }));
  const labelledDiagram = changeMermaid(labelled);
  await wide.evaluate(({ diagram, line, path }) => {
    App.page.changeDiagram = diagram;
    App.page.links[2].label = 'offer_returned_copies';
    App.page.links[4].code = { places: [{ file: path, lines: [line, line] }] };
    App.page.links[3].code = { places: [], reason: 'outside', why: 'Outside the repo.' };
  }, { diagram: labelledDiagram, line: unchanged, path: worker });
  await show({ level: 'change', from: null });
  await toGutter();
  const beside = await wide.evaluate(() => {
    const label = [...document.querySelectorAll('.half.left g.edgeLabel')].find((one) => one.textContent.trim() === 'offer_returned_copies');
    const count = [...document.querySelectorAll('.half.left text.ecount')].find((text) => text.textContent === '+4' && Math.abs(text.getBoundingClientRect().left + text.getBoundingClientRect().width / 2 - label.getBoundingClientRect().left - label.getBoundingClientRect().width / 2) < 4);
    return { label: !!label, under: !!count && count.getBoundingClientRect().top >= label.getBoundingClientRect().bottom - 2 && count.getBoundingClientRect().top - label.getBoundingClientRect().bottom < 16, counts: [...document.querySelectorAll('.half.left text.ecount')].map((text) => text.textContent) };
  });
  await pointAtLabel('offer_returned_copies');
  await linkRows();
  const byLabel = await linkShown();
  await toGutter();
  await nothingShown();
  await pointAtLink('hold-service', 'tables');
  await places(1);
  const notTouched = await linkShown();
  await toGutter();
  await nothingShown();
  await pointAtLink('desk-screen', 'hold-service');
  await wide.waitForSelector('.win .why', { timeout: 3000 }).catch(() => {});
  const linkReason = await wide.evaluate(() => ({ title: document.querySelector('.win .tb b')?.textContent, why: document.querySelector('.win .why')?.textContent, panel: !!document.querySelector('.places-half') }));
  check(`a link with a text has its counts just under its text, and the pointer on its text does what the pointer on its line does; a link whose place is on a line that the change did not touch (night_jobs.py, line ${unchanged}) shows that file with the lines around the place, the place lit, and has no counts; a link with a reason has no counts and shows the reason in plain words in a small window, and nothing else`,
    beside.label && beside.under && beside.counts.join('|') === '+3|+4|+4' && byLabel.file === worker && byLabel.lit === '244-247'
      && notTouched.heads.join() === worker && notTouched.placeLit === 1 && !notTouched.window
      && linkReason.title === 'Desk screen → Hold service' && linkReason.why === 'Outside the repo.' && !linkReason.panel, JSON.stringify({ beside, byLabel, notTouched, linkReason }));
  await toGutter();

  // "checked", and an open point at a link: marked at the link, shown with its places, and under "Open points"; with the code hidden, in the window on the link.
  await wide.evaluate(() => {
    App.page.linksChecked = true;
    App.page.openPoints.push({ id: 99, changeId: App.page.changeId, kind: 'thing-not-supported', text: 'Line 246 calls the service, but line 243 imports it inside the function.', edge: ['night-job', 'hold-service'], name: 'offer_returned_copies', used: false });
  });
  await show({ level: 'change', from: null });
  await toGutter();
  const pointed = await wide.evaluate(() => ({
    checked: [...document.querySelectorAll('.sec .sh .dfact')].map((el) => el.textContent), ring: document.querySelectorAll('.half.left .opt').length,
  }));
  pointed.side = await pointNamed('Arrow');
  await pointAtLabel('offer_returned_copies');
  await places(1);
  const atPoint = await linkShown();
  await toGutter();
  await wide.evaluate(() => Split.setHidden('code', true));
  await show({ level: 'change', from: null });
  await pointAtLink('night-job', 'hold-service');
  await when(() => !!document.querySelector('.win .l.lit') && !!document.querySelector('.win .pck'));
  const hiddenLink = await wide.evaluate(() => ({ title: document.querySelector('.win .tb b')?.textContent, lit: document.querySelectorAll('.win .l.lit').length, check: document.querySelector('.win .pck')?.textContent ?? '' }));
  check('beside the title "checked" when a second agent read the links; an open point at a link marks the link, shows at it with its places, and stands under "Open points"; with the code hidden the pointer on the link opens a window with its places and its open point',
    pointed.checked.join() === 'checked' && pointed.ring === 1 && pointed.side.startsWith('Arrow "Night job" to "Hold service"') && /^Check: Line 246 calls the service/.test(atPoint.check) && atPoint.heads.join() === worker
      && hiddenLink.title === 'offer_returned_copies' && hiddenLink.lit === 4 && /^Check:/.test(hiddenLink.check), JSON.stringify({ pointed, atPoint, hiddenLink }));
  await wide.close();
}

/** A narrow tab (900 px): the diagram alone, as before the two halves, and a window on each thing; on a page of its own. */
async function narrowTab() {
  const { wide, quiet, when, open, show, pointAt, halves, pointAtLabel, pointAtLink } = await diagramTab(900);
  await open();
  const workerCode = await wide.evaluate((path) => ask(`code:${path}`), 'src/library/night_jobs.py');
  const { shopTransitions, runEnd } = madeUpDiagrams(workerCode);
  await wide.evaluate((diagrams) => {
    App.page.diagrams.push(...diagrams);
    App.page.parts.find((part) => part.id === 'hold-service').diagrams.push(...diagrams.map((diagram) => diagram.id));
  }, [shopTransitions, runEnd]);
  const narrowDiagram = await wide.evaluate(() => ({ halves: document.querySelectorAll('#view > .half').length, control: !!document.querySelector('[data-all]'), nav: !!document.querySelector('#tabs .nav') }));
  await pointAtLink('holds-tab', 'routes');
  await when(() => document.querySelectorAll('.win .plc').length === 2 && !!document.querySelector('.win .l.lit'));
  await quiet();
  const narrowLink = await wide.evaluate(() => ({ title: document.querySelector('.win .tb b')?.textContent, sub: document.querySelector('.win .tb .sub')?.textContent, places: document.querySelectorAll('.win .plc').length, lit: document.querySelectorAll('.win .l.lit').length }));
  await show({ level: 'part', part: 'hold-service', diagram: 'offer-flow' });
  const narrow = await halves();
  await pointAt('#view g.node[id*="-start-"]');
  await wide.waitForSelector('.win .l', { timeout: 3000 }).catch(() => {});
  const stepWindow = await wide.evaluate(() => ({ title: document.querySelector('.win .tb')?.textContent, added: document.querySelectorAll('.win .l.add').length, rows: document.querySelectorAll('.win .l').length, sign: document.querySelector('.win .l.add .g')?.textContent }));
  await wide.locator('#view g.node[id*="-start-"]').click({ modifiers: ['Meta'] });
  await when(() => App.state.view === 'code');
  await quiet();
  const clickedStep = await wide.evaluate(() => ({ view: App.state.view, lines: App.state.lines }));
  check('at 900 px the page of the change and the page of a part are the diagram alone, as before: no halves, no list, no control and no counter; the window on a step shows its lines as rows of the diff with two rows around them, added rows green; a Cmd+click on a step opens the code at its lines',
    narrowDiagram.halves === 0 && !narrowDiagram.control && !narrowDiagram.nav && !narrow.split && narrow.control === ''
      && stepWindow.rows === 9 && stepWindow.added === 9 && stepWindow.sign === '+' && /^Read the date and the opening hours/.test(stepWindow.title ?? '')
      && clickedStep.view === 'code' && clickedStep.lines?.join() === '208,212', JSON.stringify({ narrowDiagram, narrow, stepWindow, clickedStep }));
  await show({ level: 'part', part: 'hold-service', diagram: 'shop-transitions' });
  await pointAtLabel('send');
  await wide.waitForSelector('.win .l', { timeout: 3000 }).catch(() => {});
  const arrowWindow = await wide.evaluate(() => ({ title: document.querySelector('.win .tb b')?.textContent, sub: document.querySelector('.win .tb .sub')?.textContent, rows: document.querySelectorAll('.win .l[data-line]').length }));
  await show({ level: 'part', part: 'tables', diagram: 'hold-states' });
  await pointAtLabel('place');
  await when(() => document.querySelectorAll('.win .plc').length === 3 && !!document.querySelector('.win .l.lit'));
  await quiet();
  const narrowPlaces = await wide.evaluate(() => ({ sub: document.querySelector('.win .tb .sub')?.textContent, places: document.querySelectorAll('.win .plc').length, lit: document.querySelectorAll('.win .l.lit').length }));
  await show({ level: 'part', part: 'hold-service', diagram: 'run-end' });
  await pointAt('#view g.node[id*="-failed-"]');
  await wide.waitForSelector('.win .why', { timeout: 3000 }).catch(() => {});
  const narrowReason = await wide.evaluate(() => document.querySelector('.win .why')?.textContent);
  check('at 900 px a window opens on each thing in place of the half: on a transition with code lines its rows with two rows around them, on a transition with three places the places one under the other, on a thing with a reason the reason, on a link with two places the places, their rows lit',
    arrowWindow.title === 'send' && arrowWindow.sub === 'night_jobs.py · lines 245–247' && arrowWindow.rows === 7 && narrowPlaces.sub === '3 places' && narrowPlaces.places === 3 && narrowPlaces.lit === 32
      && narrowReason === 'No line of its own.' && narrowLink.title === 'Holds tab → Routes' && narrowLink.sub === '2 places' && narrowLink.places === 2 && narrowLink.lit === 3,
    JSON.stringify({ arrowWindow, narrowPlaces, narrowReason, narrowLink }));
  await wide.close();
}

/** The graph that follows the diffs (build prompt 27; on "Diagram" since build prompt 41), on a wide tab of its own. */
async function graph() {
  const { wide, quiet, when, open, wideShot, pointAt, toGutter } = await diagramTab();
  const service = 'src/library/lending/hold_service.py';
  // On "Diagram" after "Open all" the left half is the list that "Diffs" had beside the graph before build 41, and the graph at the right follows it.
  // What the two halves show: the cards of the diagram half with their lit things and marks, the counter, and the place at the reading line,
  // with how far the first row of the current change stands from that line.
  await open();
  const diffsNow = () => wide.evaluate(() => {
    const left = document.querySelector('#view > .half.left');
    const right = document.querySelector('#view > .half.right');
    const at = App.diffs?.here();
    const run = at?.section.view && at.run >= 0 ? changeRuns(at.section.view.rows)[at.run] : null;
    const reading = right ? right.getBoundingClientRect().top + right.clientHeight / 3 : 0;
    const off = run ? Math.round(at.section.view.box.getBoundingClientRect().top + at.section.view.list.top(run[0]) - reading) : null;
    const cards = [...(left?.children ?? [])].map((el) => el.getBoundingClientRect());
    return {
      split: !!left && !!right, cards: [...(left?.children ?? [])].map((el) => el.querySelector('.gt')?.textContent ?? 'change'),
      stacked: cards.every((box, index) => index === 0 || box.top >= cards[index - 1].bottom) && cards.every((box) => Math.abs(box.width - left.clientWidth) < 2),
      lit: [...new Set([...(left?.querySelectorAll('.joined') ?? [])].map((el) => el.closest('[data-rk]')?.dataset.rk ?? el.tagName))],
      here: [...(left?.querySelectorAll('g.node.here') ?? [])].map((g) => g.querySelector('b[data-part]')?.dataset.part ?? 'no-part'),
      fileLit: [...(left?.querySelectorAll('.f.lit') ?? [])].map((line) => line.dataset.file ?? line.textContent),
      nav: document.querySelector('#tabs .nav')?.textContent ?? '', control: document.querySelector('[data-half="code"]')?.textContent ?? '',
      path: at?.path ?? '', run: at?.run ?? -2, off, top: Math.round(right?.scrollTop ?? 0),
      lastRowAtBottom: run ? Math.round(right.getBoundingClientRect().bottom - at.section.getBoundingClientRect().bottom) : null,
      headAtTop: [...(right?.querySelectorAll('.dfile') ?? [])].find((section) => Math.abs(section.getBoundingClientRect().top - right.getBoundingClientRect().top - (right.querySelector('.dp')?.offsetHeight ?? 0)) <= 2)?.dataset.file ?? '',
      pageScrolls: document.documentElement.scrollHeight > innerHeight + 1 || document.documentElement.scrollWidth > innerWidth,
    };
  });
  /** Waits until the diagram half shows the diagrams of the place at the reading line (or the diagram of the change), as after a key or a rest of the scroll, and nothing moves. */
  const followed = () => when(() => {
    const at = App.diffs?.here();
    const left = document.querySelector('#view > .half.left');
    if (!at || !left) return false;
    const found = at.section.view ? thingsAt(App.page.diagrams, at.path, at.section.view.rows, at.focus) : [];
    const want = found.length ? found.map((one) => App.page.diagrams.find((diagram) => diagram.id === one.id).title) : ['change'];
    return [...left.children].map((el) => el.querySelector('.gt')?.textContent ?? 'change').join() === want.join();
  }).then(quiet);
  /**
   * Does something that moves the list (a key, a click on the counter, a scroll in the page) and waits until the list rested after its last scroll and
   * told its place, the graph followed, and nothing moves. A step is told at once, and again when the scroll of its glide rests (150 ms after it); each
   * rest fills up to three diffs above the reading line, which can move the list again: after a step to a file far down that takes about a second.
   * A key counts from the place that the key before went to for 280 ms (MOTION_MS + 80 in code-notes.js), also when the list moved meanwhile: so a step
   * lasts at least 300 ms, as a person's next key comes later.
   */
  const told = () => wide.evaluate(() => window.toldAt > Math.max(window.scrolledAt, window.markedAt));
  const step = async (act) => {
    await wide.evaluate(() => window.markNow());
    await act();
    for (let round = 0; round < 12; round++) {
      await when(() => window.toldAt > Math.max(window.scrolledAt, window.markedAt));
      await followed();
      if (await told()) break; // no scroll since: the diffs that were filled above it moved nothing
    }
    await when(() => performance.now() > window.markedAt + 300);
  };
  const altKey = (key) => step(() => wide.keyboard.press(`Alt+${key}`));
  /** Scrolls the list so that the head of a file stands `down` pixels under its top, as a person scrolls there, and again when the diffs above it filled. */
  const scrollToFile = async (file, down = 40) => {
    for (let at = 0; at < 4; at++) {
      const place = await wide.evaluate(([path, offset]) => {
        const right = document.querySelector('.half.right');
        return Math.round(right.querySelector(`.dfile[data-file="${path}"]`).getBoundingClientRect().top - right.getBoundingClientRect().top - offset);
      }, [file, down]);
      if (Math.abs(place) < 1) break;
      await step(() => wide.evaluate((by) => { document.querySelector('.half.right').scrollTop += by; }, place));
    }
    await followed();
  };
  const worker2 = 'src/library/night_jobs.py';
  const router = 'src/library/web/holds_router.py';
  await toGutter();
  await wide.click('[data-all="open"]');
  await when(() => !!document.querySelector('[data-all="close"]'));
  await quiet();
  const startDiffs = await diffsNow();
  const tabsText = await wide.evaluate(() => document.querySelector('.dctl').textContent);
  check('at 1400 px on "Diagram" after "Open all": every diff open at the left, and at the right the diagram of the change; "Close all" and "Hide code" stand over the code and the counter in the line of tabs, and the page does not scroll',
    startDiffs.split && startDiffs.cards.join() === 'change' && startDiffs.control === 'Hide code' && /Close all/.test(tabsText)
      && /^‹file 1 of 40›↑(79 changes|change 1 of 79)↓$/.test(startDiffs.nav) && !startDiffs.pageScrolls, JSON.stringify(startDiffs));

  // A scroll to the file of another part, and the rest: the sequence of the night run, its message lit; a scroll in steps that never rest changes nothing at the right.
  await scrollToFile(worker2, 600); // the end of the router at the reading line, night_jobs.py under it
  const beforeScroll = await diffsNow();
  await wide.evaluate(() => window.markNow());
  const during = await wide.evaluate(async () => {
    const right = document.querySelector('.half.right');
    const left = document.querySelector('#view > .half.left');
    const look = () => JSON.stringify([[...left.children].map((el) => el.querySelector('.gt')?.textContent ?? 'change'), [...new Set([...left.querySelectorAll('.joined')].map((el) => el.closest('[data-rk]')?.dataset.rk ?? el.tagName))], left.querySelectorAll('g.node.here').length]);
    const first = look();
    const seen = [];
    for (let at = 0; at < 8; at++) {
      right.scrollTop += 90;
      await new Promise((done) => setTimeout(done, 60)); // kept: steps closer than the rest of a scroll (150 ms) show that a scroll that does not rest changes nothing
      seen.push(look());
    }
    return { first, changed: seen.filter((one) => one !== first) };
  });
  await step(() => {}); // the rest after the last step of the scroll
  const afterRest = await diffsNow();
  await scrollToFile(worker2, 30);
  const atWorker = await diffsNow();
  check('while the list scrolls the diagram does not change; when the scroll rests it shows the diagram of the file at the reading line: at night_jobs.py the sequence of the night run, with the things of the change at the reading line lit, the night job and its first message',
    !during.changed.length && afterRest.path !== beforeScroll.path && afterRest.cards.join() !== beforeScroll.cards.join()
      && atWorker.path === worker2 && atWorker.cards.join() === 'The night run, message by message' && atWorker.lit.length === 2 && /^‹file 10 of 40›/.test(atWorker.nav),
    JSON.stringify({ beforeScroll: [beforeScroll.path, beforeScroll.cards], during, afterRest: [afterRest.path, afterRest.cards, afterRest.lit], atWorker }));
  await wideShot('101-diffs-a-scroll-to-another-part-shows-its-diagram');

  // Alt+Down: the next change comes to the reading line; a change in no thing keeps the diagram and lights nothing. Alt+Up goes back. Over the edge of a
  // file: the router is one change of 188 rows, taller than the view, so Alt+Up into it brings the end of the router to the bottom (build prompt 40).
  await altKey('ArrowDown');
  const noThing = await diffsNow();
  await altKey('ArrowUp');
  const backUp = await diffsNow();
  await altKey('ArrowUp');
  const overEdge = await diffsNow();
  await altKey('ArrowDown');
  const downOver = await diffsNow();
  check('Alt+Down brings the next change of night_jobs.py to the reading line, in no thing, so the diagram stays and nothing is lit; Alt+Up goes back and its things light again; Alt+Up over the start of the file brings the end of the router (in no diagram: the diagram of the change with the node of the API marked) to the bottom; Alt+Down over its end brings the head of night_jobs.py to the top, its first change current and its thing lit',
    noThing.path === worker2 && noThing.run === 1 && Math.abs(noThing.off) <= 2 && noThing.cards.join() === 'The night run, message by message' && noThing.lit.length === 0
      && backUp.path === worker2 && backUp.run === 0 && Math.abs(backUp.off) <= 2 && backUp.lit.length === 2
      && overEdge.path === router && Math.abs(overEdge.lastRowAtBottom) <= 2 && overEdge.cards.join() === 'change' && overEdge.here.join() === 'routes'
      && downOver.path === worker2 && downOver.run === 0 && downOver.headAtTop === worker2 && downOver.lit.length === 2,
    JSON.stringify({ noThing, backUp, overEdge, downOver }));

  // The diagrams of the service, one under the other; the counter over the whole list, with the arrows that name the keys; ↓ is Alt+Down.
  await step(() => wide.evaluate((path) => App.diffs.toPath(path), service)); // the long new files between are read one view at a time: J-like, to the service
  const toService = await diffsNow();
  const titles = await wide.evaluate(() => [...document.querySelectorAll('#tabs .nav a[title]')].map((a) => a.title));
  await step(() => wide.click('#tabs .nav [data-change="1"]'));
  const byArrow = await diffsNow();
  // ↓ at the head of the service reads its long change on by one view less two rows; the change stays the current one (build prompt 40).
  check('three diagrams of the service stand one under the other, each the width of the half; the counter counts over the whole list ("file 13 of 40", "change 20 of 79"), its arrows have titles that name the keys, and ↓ steps as Alt+Down does: the long change of the service is read on and stays the current one',
    toService.path === service && toService.cards.length === 3 && toService.stacked
      && /‹file 13 of 40›↑change 20 of 79↓/.test(toService.nav) && byArrow.nav === toService.nav && byArrow.top > toService.top + 500 && titles.join() === 'Previous file (K),Every changed file,Next file (J),Previous change (Alt+Up),Next change (Alt+Down)',
    JSON.stringify({ toService: { ...toService, lit: toService.lit.length }, byArrow: { nav: byArrow.nav, top: byArrow.top, run: byArrow.run }, titles }));

  // The long new file of the service, scrolled to its middle: a change taller than the view lights only the things at the row at the reading line, not all.
  const middleLine = await wide.evaluate(() => {
    const lines = Object.values(App.page.diagrams.find((one) => one.id === 'offer-flow').code).flatMap((code) => code.places).filter((place) => place.lines).map((place) => place.lines[0]).sort((a, b) => a - b);
    return lines[Math.floor(lines.length / 2)];
  });
  await scrollToFile(service, 30);
  await step(() => wide.evaluate((line) => {
    const right = document.querySelector('.half.right');
    const { view } = right.querySelector('.dfile[data-file="src/library/lending/hold_service.py"]');
    const index = view.rows.findIndex((row) => row.now === line);
    right.scrollTop += view.box.getBoundingClientRect().top + view.list.top(index) + 4 - right.getBoundingClientRect().top - right.clientHeight / 3;
  }, middleLine));
  const longMiddle = await diffsNow();
  check('a change taller than the view lights only the things at the reading line: at the start of the service fewer than ten, and in its middle one to four, not every thing of its diagrams',
    toService.lit.length < 10 && longMiddle.path === service && longMiddle.lit.length >= 1 && longMiddle.lit.length <= 4 && longMiddle.cards.length === 3 && longMiddle.cards[0] === 'How one night run offers returned copies',
    JSON.stringify({ atStart: toService.lit.length, middleLine, lit: longMiddle.lit, cards: longMiddle.cards }));

  // The pointer that rests on a thing of the diagram half brings its first place to the reading line and lights its rows; the pointer on rows lights their thing.
  await scrollToFile(worker2, 30);
  await altKey('ArrowDown'); // the second change of night_jobs.py: nothing lit
  const restTop = await wide.evaluate(() => document.querySelector('.half.right').scrollTop);
  await pointAt('.half.left text.messageText');
  await when(() => document.querySelectorAll('.half.left .joined').length > 0);
  await wide.waitForTimeout(700); // longer than the wait of a hover window: the pointer must not move the code
  const onlyLit = await wide.evaluate((top) => ({ moved: Math.abs(document.querySelector('.half.right').scrollTop - top) > 1, window: !!document.querySelector('.win, .places-half') }), restTop);
  await wide.mouse.down();
  await wide.mouse.up();
  await when(() => !!document.querySelector('.half.right .l.step'));
  await quiet();
  const onThing = await wide.evaluate(() => {
    const right = document.querySelector('.half.right');
    const lit = [...right.querySelectorAll('.l.step')];
    const reading = right.getBoundingClientRect().top + right.clientHeight / 3;
    return { lines: lit.map((row) => Number(row.dataset.line)).filter(Boolean), off: lit.length ? Math.round(lit[0].getBoundingClientRect().top - reading) : null, joined: document.querySelectorAll('.half.left .joined').length, window: !!document.querySelector('.win') };
  });
  await wide.locator('.half.left').click({ position: { x: 6, y: 6 } }); // a click elsewhere in the diagram lets the kept message go
  await toGutter();
  await when(() => !document.querySelector('.half.right .l.step'));
  const rowOfThing = await wide.evaluate(() => document.querySelector('.half.right .dfile[data-file="src/library/night_jobs.py"]').view.rows.findIndex((row) => row.now === 244));
  await step(() => wide.evaluate((index) => {
    const section = document.querySelector('.half.right .dfile[data-file="src/library/night_jobs.py"]');
    const right = document.querySelector('.half.right');
    right.scrollTop += section.view.box.getBoundingClientRect().top + section.view.list.top(index) - right.getBoundingClientRect().top - right.clientHeight / 2;
  }, rowOfThing));
  const thingRow = await wide.locator(`.half.right .dfile[data-file="${worker2}"] .rowsbox [data-row="${rowOfThing}"]`).boundingBox();
  await wide.mouse.move(thingRow.x + 200, thingRow.y + thingRow.height / 2, { steps: 3 });
  await when(() => [...new Set([...document.querySelectorAll('#view > .half.left .joined')].map((el) => el.closest('[data-rk]')?.dataset.rk ?? el.tagName))].length === 1);
  const rowsLight = await diffsNow();
  check('the pointer that rests on a message in the diagram only lights it and moves no code; a click on it brings its first place to the reading line and lights its rows there, with no window; the pointer on a row of the night job lights the night job in the diagram',
    !onlyLit.moved && !onlyLit.window && onThing.lines.length > 0 && Math.min(...onThing.lines) === 246 && Math.abs(onThing.off) <= 24 && onThing.joined > 0 && !onThing.window
      && rowsLight.lit.length === 1 && /:J$/.test(rowsLight.lit[0]), JSON.stringify({ onlyLit, onThing, rowsLit: rowsLight.lit }));
  await toGutter();

  // A file in no part: the diagram of the change with "In no part" marked. A scroll back follows; "Close all" brings the diagram of the change back.
  await scrollToFile('docs/decisions.md', 30);
  const noPart = await diffsNow();
  await scrollToFile(worker2, 30);
  const followedAgain = await diffsNow();
  await wide.click('[data-all="close"]');
  await when(() => !!document.querySelector('[data-all="open"]') && [...document.querySelector('#view > .half.left').children].every((el) => !el.querySelector('.gt')));
  await quiet();
  const closedAll = await diffsNow();
  const closedRows = await wide.evaluate(() => ({ open: document.querySelectorAll('.half.right .dfile.open').length, control: document.querySelector('[data-all]')?.textContent }));
  check('a file in no part shows the diagram of the change with the box "In no part" marked; "Close all" closes every diff, says "Open all" again, and the diagram of the change shows again',
    noPart.cards.join() === 'change' && noPart.here.join() === 'no-part' && followedAgain.cards.join() === 'The night run, message by message'
      && closedAll.cards.join() === 'change' && closedRows.open === 0 && closedRows.control === 'Open all', JSON.stringify({ noPart, followed: followedAgain.cards, closed: closedAll.cards, closedRows }));

  // A change of 400 more files still opens fast with the diffs beside its diagram: the folds and the loading on view do the work.
  const huge = await wide.evaluate(async () => {
    const more = Array.from({ length: 400 }, (_, index) => ({ path: `src/shelves/shelf_${String(index).padStart(3, '0')}.py`, added: 12, removed: 3, status: 'changed' }));
    App.page.files.push(...more);
    App.page.checks.filesInNoPart.push(...more.map((file) => file.path));
    const start = performance.now();
    await App.go({ level: 'change', from: null });
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); // until the page is painted
    return { ms: Math.round(performance.now() - start), files: App.page.files.length, sections: document.querySelectorAll('.half.right .dfile').length };
  });
  check(`a change of ${huge.files} files opens with the diffs beside its diagram in ${huge.ms} ms, under 1.5 seconds, with the files past the first of each part folded`, huge.ms < 1500 && huge.sections < 120, JSON.stringify(huge));
  await wide.close();
}

/**
 * Build 68, six faults of the change page, one check for each (the code follows a click, item 3, is in the checks of the join of a step and of a message above):
 * a file with no diagram opens its diff; the arrows of the stepper answer a click; "n more files" opens a window with the files of its part; a scroll moves a
 * diagram that is larger than its half; the controls of the code stand over the code.
 */
async function faults() {
  const { wide, quiet, when, open, show, away, clickAt } = await diagramTab();
  await open();
  const state = () => wide.evaluate(() => ({
    view: App.state.view, level: App.state.level, cards: [...document.querySelector('#view > .half.left').children].map((el) => el.querySelector('.gt')?.textContent ?? 'change'),
    opened: [...document.querySelectorAll('.half.right .dfile.open')].map((el) => el.dataset.file), top: Math.round(document.querySelector('.half.right').scrollTop),
  }));

  // 1. A part with no diagram, and a file of it in a node, open their diff in the list; the diagram half keeps its diagram and no tab opens.
  const noDiagram = 'src/library/web/holds_router.py';
  // On its name: the middle of the title row of a short name holds the comment mark of the part, which opens its card.
  const nameAt = await wide.evaluate(() => { const box = document.querySelector('#view b[data-part="routes"]').getBoundingClientRect(); return { x: box.left + 12, y: box.top + box.height / 2 }; });
  await wide.mouse.move(nameAt.x, nameAt.y, { steps: 4 });
  await wide.mouse.down();
  await wide.mouse.up();
  await when((path) => !!document.querySelector(`.half.right .dfile.open[data-file="${path}"]`), noDiagram);
  const byPart = await state();
  await clickAt('.half.left .f[data-file="tests/test_holds.py"]');
  await when(() => !!document.querySelector('.half.right .dfile.open[data-file="tests/test_holds.py"]'));
  const byFile = await state();
  check('on "Diagram" a click on a part with no diagram, and a click on the row of one of its files, open the diff of that file in the list, in place; the diagram half keeps the diagram of the change and no tab opens',
    byPart.view === 'diagram' && byPart.level === 'change' && byPart.opened.includes(noDiagram) && byPart.cards.join() === 'change'
      && byFile.view === 'diagram' && byFile.opened.includes('tests/test_holds.py') && byFile.cards.join() === 'change', JSON.stringify({ byPart, byFile }));
  await away();

  // 2. The arrows of the stepper answer a click, as Alt+Down and Alt+Up do: ↓ reads on, ↑ goes back, › goes to the next file.
  await show({ level: 'change', from: null });
  const nav = () => wide.evaluate(() => ({ nav: document.querySelector('#tabs .nav')?.textContent, top: Math.round(document.querySelector('.half.right').scrollTop) }));
  await wide.click('#tabs .nav [data-change="1"]');
  await when(() => /change 1 of/.test(document.querySelector('#tabs .nav')?.textContent ?? ''));
  await quiet();
  const first = await nav();
  await wide.click('#tabs .nav [data-change="1"]');
  await when((top) => document.querySelector('.half.right').scrollTop > top + 100, first.top);
  await quiet();
  const down = await nav();
  await wide.click('#tabs .nav [data-change="-1"]');
  await when((top) => document.querySelector('.half.right').scrollTop < top - 100, down.top);
  await quiet();
  const up = await nav();
  await wide.click('#tabs .nav [data-step="1"]');
  await when(() => /file 2 of/.test(document.querySelector('#tabs .nav')?.textContent ?? ''));
  const next = await nav();
  check('the arrows of the stepper answer a click: ↓ opens the first change and reads on, ↑ goes back, and › goes to the next file',
    /^‹file 1 of 40›↑change 1 of 79↓$/.test(first.nav) && down.top > first.top + 100 && up.top < down.top - 100 && /file 2 of 40/.test(next.nav), JSON.stringify({ first, down, up, next }));

  // 4. "5 more files": a window in the diagram half with every file of the part and its counts; the list brings the part to its top; a file in it opens its diff there.
  await show({ level: 'change', from: null });
  await wide.locator('.half.left g.node:has(b[data-part="holds-tab"]) .f.more').click();
  await when(() => !!document.querySelector('.win.files'));
  const windowOf = await wide.evaluate(() => {
    const win = document.querySelector('.win.files');
    const diagram = document.querySelector('#view > .half.left').getBoundingClientRect();
    return { title: win.querySelector('.tb b').textContent, rows: [...win.querySelectorAll('[data-show]')].map((a) => a.textContent), inDiagram: win.getBoundingClientRect().left >= diagram.left - 1 };
  });
  await quiet();
  const settled = await wide.evaluate(() => Math.round(document.querySelector('.half.right .dp[data-part="holds-tab"]').getBoundingClientRect().top - document.querySelector('.half.right').getBoundingClientRect().top));
  await wide.click('.win.files [data-show="web/src/member/member.css"]');
  await when(() => !document.querySelector('.win.files') && !!document.querySelector('.half.right .dfile.open[data-file="web/src/member/member.css"]'));
  await quiet();
  const picked = await state();
  check('a click on "5 more files" opens a window in the diagram half with all 8 files of its part and their counts, the list brings the part to its top, and a file in the window opens its diff in the list',
    windowOf.title === 'Holds tab' && windowOf.rows.length === 8 && windowOf.rows.every((row) => /[+−]\d/.test(row)) && windowOf.inDiagram && Math.abs(settled) <= 2 && picked.opened.includes('web/src/member/member.css'),
    JSON.stringify({ windowOf, settled, picked }));
  await away();

  // 5. A diagram larger than its half moves with a scroll, also in the stack of the graph that follows (a sequence), and Cmd+scroll zooms it.
  // The tab is as wide as the page was beside the comments window (before build 80), so that the sequence is wider than its half.
  await wide.setViewportSize({ width: 1080, height: 900 });
  await quiet();
  await wide.evaluate((path) => App.diffs.toPath(path), 'src/library/night_jobs.py');
  await when(() => !!document.querySelector('.half.left .gcard svg'));
  await quiet();
  const box = await wide.locator('.half.left .gcard .stage').first().boundingBox();
  const frame = () => wide.evaluate(() => document.querySelector('.half.left .gcard svg').getAttribute('viewBox').split(' ').map(Number));
  const before = await frame();
  await wide.mouse.move(box.x + 100, box.y + 100);
  await wide.mouse.wheel(150, 0);
  await when((x) => Number(document.querySelector('.half.left .gcard svg').getAttribute('viewBox').split(' ')[0]) !== x, before[0]);
  const moved = await frame();
  await wide.keyboard.down('Meta');
  await wide.mouse.wheel(0, -200);
  await wide.keyboard.up('Meta');
  await when((width) => Number(document.querySelector('.half.left .gcard svg').getAttribute('viewBox').split(' ')[2]) !== width, moved[2]);
  const zoomed = await frame();
  check('a scroll moves a sequence that is wider than its half in the stack of the graph that follows (its size stays), and Cmd+scroll zooms it',
    moved[0] > before[0] + 20 && Math.abs(moved[2] - before[2]) < 0.5 && Math.abs(zoomed[2] - moved[2]) > 5, JSON.stringify({ before, moved, zoomed }));

  // 6. The controls of the code stand over the code, at the right end of the line of its first group header, and stay there while the list scrolls;
  // "Show code" stands at the left of the line above the diagram while the code is hidden.
  await show({ level: 'change', from: null });
  const placed = () => wide.evaluate(() => {
    const control = (selector) => document.querySelector(selector)?.getBoundingClientRect();
    const [all, hide, list, nav] = ['[data-all]', '[data-half="code"]', '.half.right', '#tabs .nav'].map(control);
    const first = [...document.querySelectorAll('.half.right .dp')].map((el) => el.getBoundingClientRect()).filter((box) => box.top <= list.top + 2 && box.bottom > list.top).at(-1); // the group header at the top of the list
    return { allOver: !!all && all.left >= list.left && all.right <= list.right, hideRight: !!hide && hide.right <= list.right && hide.right > list.right - 40, onHeader: !!first && hide.top >= first.top - 2 && hide.bottom <= first.bottom + 4,
      navAbove: !!nav && nav.bottom <= list.top, inTabs: !!document.querySelector('#tabs [data-all], #tabs [data-half="code"]') };
  });
  const atStart = await placed();
  await wide.evaluate(() => { document.querySelector('.half.right').scrollTop = 1500; });
  await quiet();
  const scrolled = await placed();
  await wide.click('[data-half="code"]');
  await when(() => !document.querySelector('#view > .half') && !!document.querySelector('#tabs [data-half="code"]'));
  const hidden = await wide.evaluate(() => ({ left: Math.round(document.querySelector('#tabs [data-half="code"]').getBoundingClientRect().left), text: document.querySelector('#tabs [data-half="code"]').textContent, all: !!document.querySelector('[data-all]') }));
  check('on "Diagram" "Open all" and "Hide code" stand over the code at the right end of the line of the first group header and stay there while the list scrolls, the stepper stays in the line above; with the code hidden "Show code" stands at the left of that line',
    atStart.allOver && atStart.hideRight && atStart.onHeader && atStart.navAbove && !atStart.inTabs && scrolled.allOver && scrolled.onHeader && hidden.text === 'Show code' && hidden.left < 60 && !hidden.all,
    JSON.stringify({ atStart, scrolled, hidden }));
  await wide.close();
}

// The two halves take the longest; the notes, the narrow tab and the graph that follows run beside them, one after the other, each on a page of its own.
const flow = async (name, run) => {
  try { await run(); } catch (error) { check(`the checks of ${name} ran to the end`, false, error.message.split('\n').slice(0, 14).join(' / ')); }
};
await Promise.all([
  flow('the two halves', twoHalves),
  flow('the six faults of build 68', faults),
  flow('the notes', notes).then(() => flow('the narrow tab', narrowTab)).then(() => flow('the graph that follows', graph)),
]);
await finish();
