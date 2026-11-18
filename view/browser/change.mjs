// The browser check of the change page: its diagram and hover windows, the diagram of a part, the code view with its notes, the file tabs, "Diffs",
// and made-up changes. Its comments are the group "comments". A group of view/browser-check.mjs, which runs every group at the same time; alone:
//   node view/browser/change.mjs [--pictures] [<folder for pictures>]

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { check, errors, finish, newPage, own, pageFile, shots, takePicture } from './tools.mjs';

const { changeMermaid } = own('../out/view/change-diagram.js');
const { diagramGraph } = own('../out/shared/diagram-graph.js');

const page = await newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

const shot = (name) => takePicture(page, `${name}.png`);
const changeSection = '.sec[data-section="change"]';
// Waits until a page is still: two frames, the drawing that runs, and one frame more.
const settle = (one = page) => one.evaluate(async () => {
  const frame = () => new Promise((done) => requestAnimationFrame(done));
  await frame();
  await frame();
  await App.drawing;
  await frame();
});
// Does something that draws the page again, and waits until that drawing is done.
const drawn = async (act, one = page) => {
  const before = await one.evaluate(() => window.apostilRendered ?? 0);
  await act();
  await one.waitForFunction((count) => (window.apostilRendered ?? 0) > count, before, { timeout: 15000 });
  await settle(one);
};
const loaded = async (one) => { await one.waitForFunction(() => (window.apostilRendered ?? 0) >= 1, null, { timeout: 15000 }); await settle(one); };
const hoverWindow = () => page.waitForSelector('.win', { timeout: 3000 }).catch(() => null);
// The pointer goes to the corner, and the hover window closes (0.25 s after the pointer leaves).
const away = async () => { await page.mouse.move(2, 2); await page.waitForSelector('.win', { state: 'detached', timeout: 3000 }).catch(() => {}); };
// The transitions of an element end: a node grows under the pointer in 0.15 s.
const grown = (locator) => locator.evaluate(async (el) => {
  await new Promise((done) => requestAnimationFrame(done));
  await Promise.all(el.getAnimations().map((one) => one.finished));
});

// True when a note card covers a line number: no note may lie over the code.
const notesOverNumbers = () => page.evaluate(() => {
  const boxes = (selector) => [...document.querySelectorAll(selector)].map((el) => el.getBoundingClientRect()).filter((box) => box.height > 0);
  const numbers = boxes('.cv .code .n');
  return boxes('.cv .mc').some((card) => numbers.some((number) => card.left < number.right && card.right > number.left && card.top < number.bottom && card.bottom > number.top));
});
// Long lines wrap inside the box of the code: no drawn row has text past the right edge of its box, nothing in the code view scrolls sideways,
// a line longer than the box takes more than one visual row, each row has the height that the sums say, and the line numbers stay at the left.
// The code and the notes stand side by side: the box of the code ends where the notes begin.
const codeWraps = () => page.evaluate(() => {
  const view = document.querySelector('.cv');
  const code = view.querySelector('.code');
  const box = view.querySelector('.rowsbox');
  const { list, view: { columns } } = Code.shown;
  const rows = [...box.querySelectorAll('.l[data-line]')];
  const right = box.getBoundingClientRect().right;
  const textRight = (x) => { const range = document.createRange(); range.selectNodeContents(x); return Math.max(0, ...[...range.getClientRects()].map((rect) => rect.right)); };
  const cut = rows.filter((row) => textRight(row.querySelector('.x')) > right + 1).map((row) => row.dataset.line);
  const clipped = [...box.querySelectorAll('.x')].some((x) => getComputedStyle(x).overflow === 'hidden' || getComputedStyle(x).textOverflow === 'ellipsis');
  const sideways = [view, code, box].some((el) => el.scrollWidth > el.clientWidth + 1) || document.documentElement.scrollWidth > innerWidth;
  const long = rows.filter((row) => row.querySelector('.x').textContent.replace(/\t/g, '    ').length > columns);
  const wrapped = long.filter((row) => row.getBoundingClientRect().height > 1.5 * list.height).length;
  const index = (row) => Number(row.dataset.row);
  const offSums = rows.filter((row) => Math.abs(row.getBoundingClientRect().height - (list.top(index(row) + 1) - list.top(index(row)))) > 1).length;
  const numberLefts = new Set(rows.map((row) => Math.round(row.querySelector('.n').getBoundingClientRect().left)));
  const notes = view.querySelector('.notes')?.getBoundingClientRect().left;
  const beside = notes === undefined || Math.abs(code.getBoundingClientRect().right - notes) < 2; // the notes begin where the box of the code ends
  const ok = !cut.length && !clipped && !sideways && wrapped === long.length && !offSums && numberLefts.size === 1 && [...numberLefts][0] === Math.round(box.getBoundingClientRect().left) && beside;
  return { ok, columns, drawn: rows.length, long: long.length, wrapped, cut: cut.slice(0, 5), clipped, sideways, offSums, numberLefts: [...numberLefts], beside };
});
// The card of the change diagram: where it ends, and how many of its boxes lie inside it.
const diagramCard = () => page.evaluate(() => {
  const stage = document.querySelector('.sec[data-section="change"] .surface');
  const card = stage.getBoundingClientRect();
  const nodes = [...stage.querySelectorAll('g.node')].map((node) => node.getBoundingClientRect());
  const inside = nodes.filter((node) => node.left >= card.left - 1 && node.right <= card.right + 1 && node.top >= card.top - 1 && node.bottom <= card.bottom + 1).length;
  return { bottom: Math.round(card.bottom), nodes: nodes.length, inside };
});

try {
  await page.goto(`file://${pageFile}`);
  await loaded(page);

  // ----- the page of the change and its diagram -----
  // The page fills the tab: no margin and no frame around it; text in the fonts and sizes of VS Code, here their fallbacks. One card, its total diff
  // beside its title, and one quiet line with the wider diagrams that it alters; a wider diagram that it does not alter is in the same line
  // (the example has none, so its one wider diagram is made unaltered for a moment).
  const first = await page.evaluate(() => {
    const paper = document.querySelector('.paper');
    const style = getComputedStyle(paper);
    const sizes = [...document.querySelectorAll('body *')].filter((el) => [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim()))
      .map((el) => parseFloat(getComputedStyle(el).fontSize));
    return {
      left: paper.getBoundingClientRect().left, top: paper.getBoundingClientRect().top, border: style.borderTopWidth, radius: style.borderTopLeftRadius,
      body: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.body).fontSize, largest: Math.max(...sizes),
      code: getComputedStyle(document.querySelector('.nodeLabel .f')).fontSize,
      cards: [...document.querySelectorAll('.sec')].map((section) => section.dataset.section).join(), total: document.querySelector('.sec .sh .total').textContent,
      alters: document.querySelector('.sec .alters')?.textContent, scrolls: document.documentElement.scrollHeight > innerHeight,
      parts: document.querySelectorAll('.sec[data-section="change"] b[data-part]').length, noPart: document.querySelector('.sec[data-section="change"] b[data-nopart]')?.textContent ?? '',
      summary: document.getElementById('summary').textContent,
    };
  });
  first.wider = await page.evaluate(async () => {
    const kept = App.page.altered;
    App.page.altered = [];
    await App.render();
    const text = document.querySelector('.sec .alters')?.textContent;
    App.page.altered = kept;
    await App.render();
    return text;
  });
  check('the change page fills the tab with no frame, no text over 13 px and code at 12 px; one card with "48 files +1,991 −333", the line "alters: The areas of the member page +2 parts" ("wider: …" when the change alters none), the six parts and "In no part · 24 files", no summary line, and no scroll',
    first.left === 0 && first.top === 0 && first.border === '0px' && first.radius === '0px' && first.body === 'rgb(255, 254, 252)' && first.font === '13px' && first.largest <= 13 && first.code === '12px'
      && first.cards === 'change' && first.total === '48 files +1,991 −333' && first.alters === 'alters: The areas of the member page +2 parts' && !first.scrolls
      && first.parts === 6 && /In no part · 24 files/.test(first.noPart) && first.summary === '' && first.wider === 'wider: The areas of the member page', JSON.stringify(first));
  await shot('1-change-with-one-card');
  await drawn(() => page.click('.sec .alters a'));
  const wider = await page.evaluate(() => ({ crumb: document.getElementById('crumb').textContent, lit: document.querySelectorAll('#view g.node.lit').length, surface: !!document.querySelector('#view.surface') }));
  await drawn(() => page.click('#crumb a[data-trail="1"]'));
  check('the link opens the wider diagram large with its 2 added parts painted in, and the line at the top goes back to the change',
    /The areas of the member page$/.test(wider.crumb) && wider.lit === 2 && wider.surface && (await page.$$(changeSection)).length === 1, JSON.stringify(wider));

  // A file with removed lines: its hover window, beside its part, shows the diff as VS Code's diff editor does.
  const requests = '#view .f[data-file$="/requests.py"]';
  await page.hover(requests);
  const fileWindow = await hoverWindow();
  const diffLook = fileWindow ? await page.evaluate((anchor) => {
    const win = document.querySelector('.win');
    const box = win.getBoundingClientRect();
    const node = document.querySelector(anchor).closest('g.node').getBoundingClientRect();
    return {
      rows: win.querySelectorAll('.cn .l:not(.gap)').length, signs: win.querySelectorAll('.cn .l:not(.gap) .g').length,
      numbers: [...win.querySelectorAll('.cn .l .n')].filter((number) => number.textContent).length, removed: getComputedStyle(win.querySelector('.cn .l.del') ?? win).backgroundColor,
      covers: box.left < node.right && box.right > node.left && box.top < node.bottom && box.bottom > node.top,
    };
  }, requests) : {};
  check('a hover on a file name opens a window with its diff beside its part: line numbers, a sign column, and removed lines on the removed background',
    diffLook.rows > 3 && diffLook.signs === diffLook.rows && diffLook.numbers === diffLook.rows && diffLook.removed === 'rgba(255, 0, 0, 0.2)' && diffLook.covers === false, JSON.stringify(diffLook));
  await shot('2-hover-on-file');
  await away();

  // A long diff in a hover window: the wheel scrolls the window and not the page, and its scroll bar has the size of the whole diff from the start.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.hover('#view .f[data-file="src/library/lending/hold_service.py"]');
  const longWindow = await hoverWindow();
  const sizeAtStart = longWindow ? await page.$eval('.win .wc', (body) => body.scrollHeight) : 0;
  const inside = longWindow ? await longWindow.boundingBox() : null;
  if (inside) {
    await page.mouse.move(inside.x + inside.width / 2, inside.y + inside.height / 2);
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 400);
    await page.waitForFunction(() => document.querySelector('.win .wc')?.scrollTop > 0, null, { timeout: 3000 }).catch(() => {});
  }
  const wheel = longWindow ? await page.evaluate(async () => {
    const body = document.querySelector('.win .wc');
    const scrolled = body.scrollTop;
    body.scrollTop = body.scrollHeight;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    return {
      scrolled, page: window.scrollY, height: document.querySelector('.win').getBoundingClientRect().height, drawn: body.querySelectorAll('.cn .l').length,
      sizeAtEnd: body.scrollHeight, last: body.querySelector('.cn .l:last-child .n')?.textContent,
    };
  }) : {};
  check('the wheel in a hover window scrolls its content and not the page, the window has a largest height, and its scroll height is the same at the start and at the end of the diff',
    wheel.scrolled > 0 && wheel.page === 0 && wheel.height <= 521 && sizeAtStart > 4000 && wheel.sizeAtEnd === sizeAtStart && wheel.last === '296' && wheel.drawn < 200,
    `${sizeAtStart} at the start, then ${JSON.stringify(wheel)}`);
  await away();

  // A tab that shows again gets pointer events at the place where the pointer was before. After a close from outside, such events open no hover window.
  // But the pointer can also rest on a thing when its window was closed from outside: then its first real move on it brings the window, with no leave first.
  const fileName = '#view .f[data-file="src/library/night_jobs.py"]';
  await page.hover(fileName);
  const openedFirst = !!(await hoverWindow());
  await page.evaluate(() => Hover.hide()); // what the page does when VS Code says that the tab was hidden or shown
  await page.$eval(fileName, (el) => el.dispatchEvent(new MouseEvent('mouseenter'))); // the event at the old place
  await page.waitForTimeout(450); // a calm page: a window would open 0.3 s after the enter
  const openedAtOldPlace = await page.$$eval('.win', (all) => all.length);
  const onName = await page.$eval(fileName, (el) => { const box = el.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; });
  await page.mouse.move(onName.x + 3, onName.y + 1); // a small move that stays on the name
  const openedBySmallMove = !!(await hoverWindow());
  await away();
  check('after a close from outside, a pointer event at the old place opens no hover window, and the first real move of the pointer on the same thing opens it again',
    openedFirst && openedAtOldPlace === 0 && openedBySmallMove, JSON.stringify({ openedFirst, openedAtOldPlace, openedBySmallMove }));

  // A node that a click opens grows a little under the pointer, from its middle. A node that opens nothing does not, and none does under the comment pointer.
  const underPointer = async (title, picking = false) => {
    const shape = page.locator(`${changeSection} g.node:has(${title}) > :first-child`);
    const box = () => shape.evaluate((el) => { const { left, width } = el.getBoundingClientRect(); return { width, middle: left + width / 2 }; });
    await grown(shape);
    const before = await box();
    await page.evaluate((on) => document.body.classList.toggle('picking', on), picking);
    await page.hover(`${changeSection} ${title}`);
    await grown(shape);
    const after = await box();
    const scale = await shape.evaluate((el) => getComputedStyle(el).scale);
    await page.evaluate(() => document.body.classList.remove('picking'));
    await away();
    return { scale, wider: +(after.width / before.width).toFixed(3), moved: +Math.abs(after.middle - before.middle).toFixed(2) };
  };
  const grows = { part: await underPointer('b[data-part="hold-service"]'), noPart: await underPointer('b[data-nopart]'), picking: await underPointer('b[data-part="hold-service"]', true) };
  check('a part grows a little under the pointer and stays in its place; the node for files in no part does not, and no node does under the comment pointer',
    grows.part.scale === '1.03' && grows.part.wider > 1.02 && grows.part.wider < 1.05 && grows.part.moved < 0.6 && grows.noPart.scale === 'none' && grows.picking.scale === 'none', JSON.stringify(grows));

  await page.hover('#view b[data-part="hold-service"]');
  await hoverWindow();
  await page.waitForFunction(() => document.querySelectorAll('.win svg g.node').length >= 8, null, { timeout: 5000 }).catch(() => {});
  const nextDiagram = await page.$$eval('.win svg g.node', (nodes) => nodes.length);
  check('a hover on a part shows its next diagram down', nextDiagram >= 8, `${nextDiagram} nodes`);
  await shot('3-hover-on-part');
  await away();

  // Drill down into a part and up again. Mermaid leaves the lifelines of a sequence 2000 long; cut, the chart keeps its size: an actor box is 46 high.
  await page.evaluate(() => window.scrollTo(0, 120));
  await page.hover('#view b[data-part="hold-service"]');
  const scrolled = await page.evaluate(() => window.scrollY);
  await drawn(() => page.click('#view b[data-part="hold-service"]'));
  const down = await page.evaluate(() => ({ crumb: document.getElementById('crumb').textContent, tabs: [...document.querySelectorAll('#tabs > :not(.dchg, .dfact, .codeswitch)')].map((el) => el.textContent).join(' · ') }));
  await drawn(() => page.click('#tabs [data-diagram="offer-sequence"]'));
  const sequence = await page.$eval('#view svg', (svg) => ({
    actors: svg.querySelectorAll('.actor').length, actorHeight: Math.round(svg.querySelector('rect.actor').getBoundingClientRect().height),
    lifelineEnd: Math.round(Math.max(...[...svg.querySelectorAll('line.actor-line')].map((line) => Number(line.getAttribute('y2'))))),
  }));
  await drawn(() => page.click('#tabs [data-diagram="offer-flow"]'));
  check('a click on a part drills down to its diagram, with tabs named by the titles of its diagrams and the kind after each; the tab "Sequence" draws the sequence at a size that he can read, the lifelines ending under the last message',
    /Hold service$/.test(down.crumb) && down.tabs === 'How one night run offers returned copies flow · The night run, message by message sequence'
      && sequence.actors >= 3 && sequence.actorHeight >= 36 && sequence.lifelineEnd < 700, JSON.stringify({ ...down, ...sequence }));
  await drawn(() => page.click('#crumb a[data-trail="1"]'));
  const up = await page.evaluate(() => ({ clusters: document.querySelectorAll('.sec[data-section="change"] g.cluster').length, crumb: document.getElementById('crumb').textContent, at: window.scrollY, deepest: document.documentElement.scrollHeight - innerHeight }));
  check('the line at the top goes back to the sections at the same scroll place, and the part keeps its diagram whole',
    up.clusters === 1 && !/Hold service/.test(up.crumb) && up.at === Math.min(scrolled, up.deepest), `${JSON.stringify(up)}; scrolled ${scrolled}`);

  // The pointer is a hand only where a click opens something. Elsewhere on a diagram it is the open hand that moves the diagram.
  const pointerAt = (selector, across = 0.5, down = 0.5) => page.evaluate(([sel, ax, ay]) => {
    const el = document.querySelector(sel);
    const before = scrollY;
    el.scrollIntoView({ block: 'center' });
    const box = el.getBoundingClientRect();
    const pointer = getComputedStyle(document.elementFromPoint(box.left + box.width * ax, box.top + box.height * ay)).cursor;
    scrollTo(0, before);
    return pointer;
  }, [selector, across, down]).catch(() => 'not found');
  const pointers = {
    part: await pointerAt(`${changeSection} b[data-part="routes"]`), noPart: await pointerAt(`${changeSection} b[data-nopart]`),
    frameName: await pointerAt(`${changeSection} g.cluster .cluster-label`), frame: await pointerAt(`${changeSection} g.cluster rect`, 0.02, 0.5),
    stepInFrame: await pointerAt(`${changeSection} g.node.go:not(:has(b[data-part]))`), empty: await pointerAt(`${changeSection} .surface`, 0.99, 0.98),
    fileName: await pointerAt(`${changeSection} .f[data-file]`, 0.2), moreFiles: await pointerAt(`${changeSection} .f.more`, 0.2),
  };
  check('the pointer is a hand on a part, a file name, the name of a part\'s frame and a step with code lines; on the box "In no part", on "more files", inside the frame and on an empty place it is the open hand',
    ['part', 'fileName', 'frameName', 'stepInFrame'].every((key) => pointers[key] === 'pointer') && ['noPart', 'moreFiles', 'frame', 'empty'].every((key) => pointers[key] === 'grab'), JSON.stringify(pointers));

  // ----- the code view with its notes -----
  await drawn(() => page.click(`${changeSection} g.cluster .cluster-label`));
  await drawn(() => page.click('#view g.node[id*="flowchart-ready-"]', { modifiers: ['Meta'] }));
  const codeView = await page.evaluate(() => ({
    firstLit: document.querySelector('.cv .code .l.lit')?.dataset.line, notes: document.querySelectorAll('.cv .mc').length,
    dashed: [...document.querySelectorAll('.cv .mc.chk')].map((card) => card.textContent), points: document.querySelectorAll('.points').length,
    counts: [...document.querySelectorAll('.cv .mc')].map((card) => card.querySelector('[data-tests]')?.textContent ?? ''),
  }));
  check('a node with lines opens the code view at its first line on Cmd+click (a click opens its window), with the seven notes, a dashed note with its check, the test count once on the first note of the function, and no list of open points',
    codeView.firstLit === '245' && codeView.notes === 7 && codeView.dashed.length === 1 && /Check: /.test(codeView.dashed[0]) && codeView.points === 0
      && codeView.counts[0] === '3 tests' && codeView.counts.slice(1).every((count) => count === ''), JSON.stringify(codeView));
  // The lines beside the code: each note is joined to the middle of its code lines, and an arrow goes from each note to the next note of the same function.
  const links = await page.evaluate(() => {
    const column = document.querySelector('.cv .notes').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.cv .mc')];
    const joins = [...document.querySelectorAll('.cv svg.links [data-join]')].map((path, index) => {
      const [, startY, endX, endY] = path.getAttribute('d').match(/^M0 ([\d.]+) C.* ([\d.]+) ([\d.]+)$/).map(Number);
      const lines = JSON.parse(cards[index].dataset.remark).lines;
      const [first, last] = lines.map((line) => document.querySelector(`.cv .code [data-line="${line}"]`));
      const card = cards[index].getBoundingClientRect();
      return {
        // the start is inside the lines of the note (from the top of its first line to the bottom of its last), and the end is on the left edge of its card
        fromLines: !first || !last || (startY >= first.offsetTop && startY <= last.offsetTop + last.offsetHeight + 1),
        toCard: Math.abs(endX - (card.left - column.left)) < 1.5 && endY >= cards[index].offsetTop && endY <= cards[index].offsetTop + cards[index].offsetHeight,
      };
    });
    document.querySelector('.cv .mc').dispatchEvent(new MouseEvent('mouseenter'));
    const lit = [...document.querySelectorAll('.cv svg.links [data-join]')].map((path) => path.classList.contains('cur'));
    document.querySelector('.cv .mc').dispatchEvent(new MouseEvent('mouseleave'));
    return { joins, arrows: document.querySelectorAll('.cv svg.links path.arrow').length, lit: lit.indexOf(true), litCount: lit.filter(Boolean).length };
  });
  links.overNumbers = await notesOverNumbers();
  check('at 1400 px each of the seven notes stands beside the code over no line number, joined by a line to its code lines; six arrows go from note to note of the function, and the pointer on a note lights its line',
    !links.overNumbers && links.joins.length === 7 && links.joins.every((join) => join.fromLines && join.toCard) && links.arrows === 6 && links.lit === 0 && links.litCount === 1, JSON.stringify(links));
  await shot('6-code-with-notes');

  await page.hover('.cv .mc [data-tests]');
  const testWindow = await hoverWindow();
  const groups = testWindow ? await testWindow.$$eval('.tgp', (all) => all.map((group) => group.textContent)) : [];
  const tests = testWindow ? await testWindow.$$eval('.trw .nm', (names) => names.map((name) => name.textContent)) : [];
  check('a hover on the test count lists the tests, and a call outside a test has a group of its own', tests.length === 3 && groups.some((group) => /outside a test/.test(group)), tests.join(', '));
  await away();

  // Below 720 px of column the notes fold to marks at the right edge; long lines wrap inside the box of the code. 900 px is cards, 370 px marks.
  const atWidth = async (width) => {
    await page.setViewportSize({ width, height: 900 });
    await settle();
    const wraps = await codeWraps();
    const form = await page.evaluate(() => ({ narrow: !!document.querySelector('.cv.narrow'), marks: document.querySelectorAll('.cv .mk').length, cards: document.querySelectorAll('.cv .mc').length, column: document.getElementById('view').clientWidth }));
    return { wraps, form, overNumbers: await notesOverNumbers() };
  };
  const at900 = await atWidth(900);
  check('at 900 px the notes are cards beside their lines, over no line number; no code text is cut and nothing scrolls sideways: each line longer than the box takes more than one visual row, at the height the sums say, and the line numbers stay at the left',
    at900.wraps.ok && at900.wraps.long > 0 && !at900.overNumbers && !at900.form.narrow && at900.form.cards === 7, JSON.stringify(at900));
  const at370 = await atWidth(370);
  await page.hover('.cv .mk >> nth=1');
  const markWindow = await hoverWindow();
  at370.markText = markWindow ? (await markWindow.textContent()).slice(0, 60) : '';
  at370.markLit = await page.$$eval('.cv .code .l.lit', (rows) => rows.length);
  check('at 370 px the notes are marks at the right edge, over no line number, and long lines wrap with nothing cut or sideways; the pointer on a mark lights the lines of its note and shows the note in a window',
    at370.wraps.ok && at370.wraps.long > 0 && !at370.overNumbers && at370.form.narrow && at370.form.marks === 7 && at370.form.cards === 0 && at370.markText.length > 20 && at370.markLit > 0, JSON.stringify(at370));
  await shot('8b-note-as-a-window-at-370');
  await away();

  // ----- the diagram of the change as a surface -----
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.reload(); // the plain page of the change, as it first opens
  await loaded(page);
  const cards = {};
  for (const width of [370, 1400]) {
    await page.setViewportSize({ width, height: 900 });
    await settle();
    cards[width] = await diagramCard();
  }
  check('at 370 and 1400 px the diagram of the change fills the height that is left in the tab, and fits in its card with every box inside',
    Object.values(cards).every((card) => card.bottom >= 860 && card.bottom <= 900 && card.inside === card.nodes && card.nodes >= 7), JSON.stringify(cards));

  // A drag moves the diagram, the wheel zooms at the pointer with no hover window over it, and a double click on an empty place fits it again.
  const surface = `${changeSection} .surface`;
  const service = `${changeSection} b[data-part="hold-service"]`;
  const viewBox = () => page.$eval(`${surface} svg`, (svg) => svg.getAttribute('viewBox').split(' ').map(Number));
  const nodeAt = () => page.$eval(service, (title) => { const box = title.closest('g.node').getBoundingClientRect(); return { x: box.left, y: box.top, width: box.width }; });
  const empty = await page.$eval(surface, (el) => { const box = el.getBoundingClientRect(); return { x: box.left + 30, y: box.bottom - 30 }; });
  const fitted = await viewBox();
  const start = await nodeAt();
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  await page.mouse.move(empty.x + 60, empty.y - 40, { steps: 6 });
  await page.mouse.up();
  const dragged = await nodeAt();
  const onPart = { x: dragged.x + 20, y: dragged.y + 10 };
  await page.mouse.move(onPart.x, onPart.y);
  await grown(page.locator(`${changeSection} g.node:has(b[data-part="hold-service"]) > :first-child`)); // the part under the pointer grows a little first
  const under = await nodeAt();
  await page.keyboard.down('Meta'); // Cmd+scroll zooms
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Meta');
  await settle();
  const zoomed = await nodeAt();
  const larger = zoomed.width / under.width;
  await page.waitForTimeout(450); // a calm page: the hover window of the part, asked for when the pointer came, would open 0.3 s after
  const windowsWhileZoom = await page.$$eval('.win', (els) => els.length);
  await page.mouse.dblclick(empty.x, empty.y);
  const refitted = await viewBox();
  check('a drag moves the diagram, Cmd+scroll makes it larger at the pointer (the point under the pointer stays) with no hover window, and a double click on an empty place fits it to its card again',
    Math.abs(dragged.x - start.x - 60) < 2 && Math.abs(dragged.y - start.y + 40) < 2 && larger > 1.3
      && Math.abs(onPart.x - (zoomed.x + (onPart.x - under.x) * larger)) < 1 && Math.abs(onPart.y - (zoomed.y + (onPart.y - under.y) * larger)) < 1
      && windowsWhileZoom === 0 && refitted.every((value, index) => Math.abs(value - fitted[index]) < 0.5),
    JSON.stringify({ start, dragged, under, zoomed, windowsWhileZoom, fitted, refitted }));

  // ----- a file on the page -----
  // A plain click on a file name shows its diff on the page and opens no editor of VS Code; the line at the top goes back at the same scroll place.
  await page.setViewportSize({ width: 1400, height: 1000 });
  await settle();
  const openFiles = () => page.evaluate(() => window.apostilSent.filter((message) => message.type === 'openFile').map((message) => message.path));
  await page.evaluate(() => window.scrollTo(0, 140));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await drawn(() => page.click(fileName));
  await page.evaluate(() => Code.shown.steps.enter(-1)); // at its last change, as Alt+Up from the next file brings it
  await settle();
  const diffView = await page.evaluate(() => ({
    crumb: document.getElementById('crumb').textContent,
    removed: document.querySelectorAll('.cv .code .l.del').length,
    added: document.querySelectorAll('.cv .code .l.add').length,
    signs: [...document.querySelectorAll('.cv .code .l.del .g, .cv .code .l.add .g')].map((sign) => sign.textContent).join(''),
    removedColour: getComputedStyle(document.querySelector('.cv .code .l.del') ?? document.body).backgroundColor,
    folds: document.querySelectorAll('.cv .code .l.gap').length,
    rows: Code.shown.rows.length, height: document.querySelector('.rowsbox').offsetHeight, row: Code.shown.list.height, sum: Code.shown.list.top(Code.shown.rows.length),
  }));
  diffView.editors = (await openFiles()).length;
  await drawn(() => page.click('#crumb a[data-trail="1"]'));
  [diffView.scrollBack, diffView.deepest] = await page.evaluate(() => [window.scrollY, document.documentElement.scrollHeight - innerHeight]);
  check('a plain click on a changed file shows the whole file on the page: every line, nothing folded, removed lines in place with their sign and colour, and no editor; the line at the top goes back at the same scroll place',
    /night_jobs\.py$/.test(diffView.crumb) && diffView.removed > 0 && diffView.added > 0 && /^[−+]+$/.test(diffView.signs) && diffView.removedColour === 'rgba(255, 0, 0, 0.2)' && diffView.folds === 0
      && Math.abs(diffView.height - diffView.sum) < 1 && diffView.sum >= diffView.rows * diffView.row - 1 && diffView.editors === 0 && diffView.scrollBack === Math.min(scrollBefore, diffView.deepest),
    JSON.stringify(diffView));

  // The real editor only on request: Cmd+click on a file name, and "Open" in its hover window.
  await page.click(fileName, { modifiers: ['Meta'] });
  const afterCmd = await openFiles();
  await away();
  await page.hover(fileName);
  if (await hoverWindow()) await page.click('.win [data-open]');
  const afterOpen = await openFiles();
  check('Cmd+click on a file name and "Open" in its hover window each ask VS Code to open the file', afterCmd.join() === 'src/library/night_jobs.py' && afterOpen.join() === 'src/library/night_jobs.py,src/library/night_jobs.py', afterOpen.join(', '));

  // A long file: it opens fast, its scroll bar has the height of the whole file at once, and the last line is reached. The row of a line far down stands
  // where the running sums of the row heights say: scrolled to its sum, the line is at the top of the view; a narrower column wraps again and keeps it there.
  const started = Date.now();
  await drawn(() => page.evaluate(() => App.showCode('src/library/night_jobs.py', null)));
  const openMs = Date.now() - started;
  const long = await page.evaluate(async () => {
    const box = document.querySelector('.cv');
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    const heights = [box.scrollHeight];
    for (const part of [0.25, 0.5, 0.75, 1]) { box.scrollTop = part * box.scrollHeight; await frame(); await frame(); heights.push(box.scrollHeight); }
    const rows = [...document.querySelectorAll('.cv .code [data-line]')];
    return { lines: Code.shown.rows.filter((row) => row.now).length, last: Number(rows.at(-1)?.dataset.line), drawn: rows.length, heights: [...new Set(heights)] };
  });
  const lineAtTop = (line) => page.evaluate(async (line) => {
    const { scroller, box, list, view } = Code.shown;
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    if (line) { scroller.scrollTop = box.offsetTop + list.top(view.span({ lines: [line, line] })[0]); await frame(); await frame(); }
    const top = scroller.getBoundingClientRect().top;
    const row = [...box.querySelectorAll('[data-line]')].find((el) => el.getBoundingClientRect().bottom > top + 1);
    const index = Number(row.dataset.row);
    const wrappedAbove = list.top(index) - index * list.height; // the room of the wrapped rows above it
    return { line: Number(row.dataset.line), off: Math.round(row.getBoundingClientRect().top - top), wrappedAbove: Math.round(wrappedAbove), columns: view.columns };
  }, line);
  const farDown = await lineAtTop(480);
  await page.setViewportSize({ width: 1150, height: 1000 });
  await settle();
  const afterNarrower = await lineAtTop(0);
  await page.setViewportSize({ width: 1400, height: 1000 });
  await settle();
  check(`a long file (${long.lines} lines) opens in ${openMs} ms with fewer than 200 rows drawn, the last line is reached, and the scroll height does not change while scrolling; scrolled to the sum of the row heights above line 480, that line is at the top, also after a narrower column wraps the lines again`,
    long.lines > 500 && long.last === long.lines && long.drawn < 200 && long.heights.length === 1 && openMs < 3000
      && farDown.line === 480 && Math.abs(farDown.off) <= 1 && farDown.wrappedAbove > 0 && afterNarrower.line === 480 && Math.abs(afterNarrower.off) <= 1 && afterNarrower.columns < farDown.columns
      && afterNarrower.wrappedAbove > farDown.wrappedAbove, JSON.stringify({ long, farDown, afterNarrower }));

  // ----- the page as the tab of one file -----
  const tab = await newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  tab.on('pageerror', (error) => errors.push(error.message));
  const openTab = async (file) => { await tab.goto(`file://${pageFile}?file=${file}`); await loaded(tab); };
  const reveal = async (lines) => { await tab.evaluate((at) => Code.reveal(at), lines); await settle(tab); };
  // The whole file with nothing above it, the notes at the right edge (the comments window starts folded there).
  await openTab('src/library/lending/hold_service.py');
  await reveal([208, 208]);
  const tabView = await tab.evaluate(() => ({
    bar: document.querySelector('.bar').offsetHeight, summary: document.getElementById('summary').textContent, crumb: document.getElementById('crumb').textContent,
    top: document.querySelector('.cv').getBoundingClientRect().top, left: document.querySelector('.cv').getBoundingClientRect().left,
    notesRight: Math.round(document.querySelector('.cv .notes').getBoundingClientRect().right), width: document.querySelector('.cv').clientWidth,
    cards: [...document.querySelectorAll('.cv .mc')].filter((card) => { const box = card.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; }).length,
  }));
  check('a file tab has no line of names, no summary and no switch: the code starts at the top of the tab, and the notes stand at its right edge beside their lines',
    tabView.bar === 0 && !tabView.summary && !tabView.crumb && tabView.top === 0 && tabView.left === 0 && tabView.notesRight === tabView.width && tabView.cards >= 3, JSON.stringify(tabView));
  await takePicture(tab, '19-file-tab-at-1400.png');
  // A note of another saved change (made up: merged long ago), and a note of the map, stand beside the lines that they were written for, found by their text.
  const noteBeside = (text, line) => tab.evaluate(([text, line]) => {
    const cards = [...document.querySelectorAll('.cv .mc')];
    const card = cards.find((one) => one.textContent.includes(text));
    const row = document.querySelector(`.cv .l[data-line="${line}"]`);
    return card && {
      cards: cards.length, tone: ['add', 'del'].filter((name) => card.classList.contains(name)), from: card.querySelector('.from')?.textContent, mapLine: /From the map/.test(card.textContent),
      rowAdded: row?.classList.contains('add') ?? null, off: row ? Math.abs(Math.round(card.getBoundingClientRect().top - row.getBoundingClientRect().top)) : null,
    };
  }, [text, line]);
  await openTab('src/library/dev_clock.py');
  await reveal([17, 17]);
  const earlier = await noteBeside('Read the test date from the settings', 17);
  await openTab('src/library/lending/hold_models.py');
  if (await tab.isVisible('#side [data-fold]')) await tab.click('#side [data-fold]'); // the comments window lies over the notes
  await reveal([46, 46]);
  const ofMap = await noteBeside('Refuse an unknown branch', 46);
  check('a file tab shows the note of another saved change and a note of the map beside their lines, found by their text, with no colour of the diff; the first names the change it came from, the second says nothing of where it came from',
    !!earlier && earlier.tone.length === 0 && earlier.from === 'From “A test date for the night jobs”' && earlier.rowAdded === false && earlier.off < 40
      && !!ofMap && ofMap.cards === 2 && ofMap.tone.length === 0 && ofMap.from === undefined && !ofMap.mapLine && ofMap.off < 40, JSON.stringify({ earlier, ofMap }));
  // A file whose first change is below the first screen opens at that change; scrolled to the top, the counter still names its first change.
  await openTab('src/library/night_jobs.py');
  const opened = await tab.evaluate(() => ({ nav: document.querySelector('.nav .steps').textContent, atChange: (() => { const row = document.querySelector('.cv .code .l.add, .cv .code .l.del'); return !!row && row.getBoundingClientRect().top < innerHeight; })() }));
  opened.atTop = await tab.evaluate(() => new Promise((done) => {
    const nav = document.querySelector('.nav .steps');
    const late = setTimeout(() => done(`not written again: ${nav.textContent}`), 3000);
    new MutationObserver((_, watcher) => { watcher.disconnect(); clearTimeout(late); done(nav.textContent); }).observe(nav, { childList: true, subtree: true, characterData: true });
    Code.shown.scroller.scrollTop = 0; // the counter is written again when the scroll rests
  }));
  const counter = /^‹file 10 of 40›↑change 1 of \d+↓$/;
  check('a file whose first change is below the first screen opens at that change, the control at the top right says "file 10 of 40" and "change 1 of N", and at the top of the file it still names that first change',
    opened.atChange && counter.test(opened.nav) && counter.test(opened.atTop), JSON.stringify(opened));

  // Alt+Down goes from change to change, and after the last one on to the first change of the next file; Alt+Up goes back. J and K step through the files.
  const where = () => tab.evaluate(() => ({ file: App.tab, nav: document.querySelector('.nav').textContent }));
  await tab.locator('.cv .code').click({ position: { x: 300, y: 200 } });
  const firstChange = await where(); // the file opened at its first change
  const runs = await tab.evaluate(() => Code.shown.runs.length);
  // One key after the other, each until the counter names the next change: a change taller than the view takes more than one key.
  const counterSays = (text, ms) => tab.waitForFunction((now) => document.querySelector('.nav').textContent.includes(now), text, { timeout: ms }).then(() => true, () => false);
  for (let i = 2, keys = 0; i <= runs && keys < 3 * runs; keys++) {
    await tab.keyboard.press('Alt+ArrowDown');
    if (await counterSays(`change ${i} of ${runs}`, 2000)) i++;
  }
  const lastChange = await where();
  await drawn(() => tab.keyboard.press('Alt+ArrowDown'), tab);
  const nextFile = await where();
  nextFile.shown = await tab.evaluate(() => { const row = document.querySelector('.cv .code .l.add, .cv .code .l.del'); return !!row && row.getBoundingClientRect().top < innerHeight; });
  await drawn(() => tab.keyboard.press('Alt+ArrowUp'), tab);
  const backFile = await where();
  await drawn(() => tab.keyboard.press('j'), tab);
  const afterJ = await where();
  await drawn(() => tab.keyboard.press('k'), tab);
  const afterK = await where();
  check('in a file tab Alt+Down goes from change to change ("change 1 of N" … "change N of N"), then to the first change of the next file; Alt+Up goes back to the last change of the file before; J opens the next file and K the one before',
    /change 1 of \d+/.test(firstChange.nav) && lastChange.nav.includes(`change ${runs} of ${runs}`) && nextFile.file !== firstChange.file && /file 11 of 40/.test(nextFile.nav) && /change 1 of/.test(nextFile.nav) && nextFile.shown
      && backFile.file === firstChange.file && backFile.nav.includes(`change ${runs} of ${runs}`) && /file 11 of 40/.test(afterJ.nav) && afterK.file === firstChange.file,
    [firstChange.nav, lastChange.nav, nextFile.nav, backFile.nav, afterJ.nav, afterK.file].join(' | '));

  await tab.click('.nav [data-files]');
  const fileList = await tab.evaluate(() => ({
    groups: [...document.querySelectorAll('.win.files .gp')].map((group) => group.textContent), rows: document.querySelectorAll('.win.files [data-show]').length,
    on: document.querySelector('.win.files .on span')?.textContent, counts: document.querySelector('.win.files [data-show] .c')?.textContent,
  }));
  await drawn(() => tab.click('.win.files [data-show="web/src/member/HoldsPanel.tsx"]'), tab);
  fileList.picked = (await where()).file;
  check('a click on "file 10 of 40" lists every changed file under the names of the parts, each with its counts; picking one opens it',
    fileList.rows === 40 && fileList.groups[0] === 'Holds tab' && fileList.groups.at(-1) === 'In no part' && fileList.on === 'src/library/night_jobs.py' && /^\+/.test(fileList.counts) && fileList.picked === 'web/src/member/HoldsPanel.tsx',
    JSON.stringify(fileList));
  await tab.close();

  // ----- "Diffs": the list of every changed file at the left as closed rows, part by part, and one file at the right (build prompt 42) -----
  const diffsShown = () => page.evaluate(() => ({
    files: document.querySelectorAll('.diffs .dfile').length, folded: document.querySelectorAll('.diffs .dfile.quiet.shut').length,
    more: [...document.querySelectorAll('.diffs .dmore')].map((link) => link.textContent).join(), parts: [...document.querySelectorAll('.diffs .dp')].map((part) => part.textContent),
    open: document.querySelectorAll('.diffs .dfile.open, .diffs .dbody').length,
    file: document.querySelector('#view > .file-left .fh a')?.textContent ?? '', first: App.order()[0],
    here: document.querySelector('.diffs .dfile.here')?.dataset.file ?? '', shown: App.diffs.here()?.path,
  }));
  await drawn(() => page.click('.switch a[data-view="diffs"]'));
  const listed = await diffsShown();
  await shot('20-diffs');
  await page.click('.diffs .dmore[data-more-files]');
  const foldedFile = await page.$eval('.diffs .dfile.quiet.shut', (el) => el.dataset.file);
  await page.click(`.diffs .dfile.quiet[data-file="${foldedFile}"] .dh .c`);
  await page.waitForFunction((file) => App.diffs.here()?.path === file && document.querySelector('.diffs .dfile.here')?.dataset.file === file, foldedFile, { timeout: 5000 }).catch(() => {});
  const unfolded = await diffsShown();
  const dialog = 'web/src/member/HoldDialog.tsx'; // a generated file has no name to click: a file of code has
  await page.evaluate((file) => App.diffs.toPath(file), dialog);
  await drawn(() => page.click('#view > .file-left .fh a'));
  const fromDiffs = await page.evaluate(() => App.state.file);
  check('"Diffs" lists the first 20 files of each part and at most 5 generated files as closed rows, folds the rest behind "4 more files in In no part" and "3 more files", and shows the first file beside the list; "4 more files" shows the rest, a click on a row shows its file and marks the row, no row opens, and a click on the name of the file opens it',
    listed.files === 41 && listed.folded === 5 && listed.more === '4 more files in In no part,3 more files in Generated' && listed.parts[0] === 'Holds tab' && listed.parts.at(-1) === 'Generated'
      && listed.open === 0 && listed.file === listed.first && unfolded.files === 45 && unfolded.folded === 5 && unfolded.more === '3 more files in Generated'
      && unfolded.shown === foldedFile && unfolded.here === foldedFile && unfolded.open === 0 && fromDiffs === dialog, JSON.stringify({ listed, unfolded, foldedFile, fromDiffs }));

  // ----- a page that draws while its tab is hidden (an iframe with no size, as a hidden webview can be): coming back shows the diagram with its parts -----
  const holder = path.join(shots, 'hidden-tab.html');
  writeFileSync(holder, `<!doctype html><body style="margin:0"><iframe id="tab" src="file://${pageFile}" style="width:1200px;height:800px;border:0"></iframe></body>`);
  const outer = await newPage({ viewport: { width: 1200, height: 800 } });
  outer.on('pageerror', (error) => errors.push(error.message));
  await outer.goto(`file://${holder}`);
  const inner = await (await outer.waitForSelector('#tab')).contentFrame();
  await inner.waitForFunction(() => (window.apostilRendered ?? 0) >= 1, null, { timeout: 15000 });
  await outer.evaluate(() => { document.getElementById('tab').style.display = 'none'; });
  const hiddenAt = await inner.evaluate(() => { App.page.remarks = [...App.page.remarks]; App.render(); return window.apostilRendered; });
  await outer.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))); // the hidden tab goes through frames of the window
  await outer.evaluate(() => { document.getElementById('tab').style.display = ''; });
  await inner.waitForFunction((count) => (window.apostilRendered ?? 0) > count, hiddenAt, { timeout: 5000 }).catch(() => {});
  const shown = await inner.evaluate(async (count) => {
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    return {
      redrawn: window.apostilRendered > count, parts: document.querySelectorAll('#view b[data-part]').length, nodes: document.querySelectorAll('#view g.node').length,
      sized: [...document.querySelectorAll('#view g.node')].filter((node) => {
        const box = node.getBoundingClientRect();
        const card = node.closest('svg').parentElement.getBoundingClientRect();
        const [x, y] = [box.left + box.width / 2, box.top + box.height / 2];
        return box.width > 40 && x > card.left && x < card.right && y > card.top && y < card.bottom;
      }).length,
    };
  }, hiddenAt);
  check('a page that got new data while its tab was hidden draws it when the tab comes back, the diagram with its parts', shown.redrawn && shown.parts === 6 && shown.nodes >= 7 && shown.sized === shown.nodes, JSON.stringify(shown));
  await outer.close();

  // ----- diagrams that read well, with made-up changes at 1280 by 860 -----
  const reads = await newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  reads.on('pageerror', (error) => errors.push(error.message));
  await reads.goto(`file://${pageFile}`);
  await loaded(reads);
  const readsShot = (name) => takePicture(reads, `${name}.png`);
  // Shows a made-up change: its parts, made from the files of the example, and its own diagrams.
  const showChange = async (change) => {
    await reads.evaluate(async ({ parts, diagrams, changeDiagram }) => {
      Object.assign(App.page, { parts, links: [], changeDiagram, diagrams: [...App.page.diagrams.filter((diagram) => diagram.broad), ...diagrams] });
      App.page.checks = { ...App.page.checks, filesInNoPart: [] };
      App.state.diagram = null;
      await App.go({ view: 'diagram', level: 'change' }, true);
    }, change);
    await settle(reads);
  };
  const files = await reads.evaluate(() => App.page.files.map((file) => ({ path: file.path, added: file.added, removed: file.removed, status: file.status })));
  // Parts with three files each: files of the example, or made-up short names.
  const madeUpParts = (count, diagrams = () => [], short = false) => Array.from({ length: count }, (_, index) => ({
    id: `shelf-${index + 1}`, name: `Shelf ${index + 1}`, diagrams: diagrams(index),
    files: short ? [1, 2, 3].map((n) => `shelves/${index + 1}/shelf-0${n}.json`) : files.slice(index * 3, index * 3 + 3).map((file) => file.path),
  }));

  // Nine parts with no links stand in three rows of three, and their words keep their normal size.
  const nine = madeUpParts(9, () => [], true);
  await showChange({ parts: nine, diagrams: [], changeDiagram: changeMermaid({ parts: nine, links: [], files, filesInNoPart: [] }) });
  const nineDrawn = await reads.evaluate(() => {
    const tops = [...document.querySelectorAll('#view .sec .surface g.node')].map((node) => Math.round(node.getBoundingClientRect().top + node.getBoundingClientRect().height / 2));
    const byRow = {};
    for (const top of tops) byRow[Math.round(top / 40)] = (byRow[Math.round(top / 40)] ?? 0) + 1;
    const svg = document.querySelector('#view .sec .surface svg');
    return { rows: Object.values(byRow).join(), scale: +(svg.getBoundingClientRect().width / Number(svg.getAttribute('viewBox').split(' ')[2])).toFixed(2) };
  });
  check('nine parts with no links stand in three rows of three, and their words have the normal size', nineDrawn.rows === '3,3,3' && nineDrawn.scale === 1, JSON.stringify(nineDrawn));
  await readsShot('38-nine-parts-in-rows');

  // A part with two diagrams of two functions opens the first one, and the switch names both by their function.
  const functionDiagram = (id, symbol, title) => {
    const mermaid = `flowchart TD\n  a["Read the ${symbol} request"] --> b{"Is it allowed?"}\n  b -->|yes| c["Save it"]\n  b -->|no| d["Say why not"]`;
    return { id, kind: 'flow', title, mermaid, draw: mermaid, part: 'shelf-1', symbol, graph: diagramGraph({ kind: 'flow', mermaid }) };
  };
  const two = [functionDiagram('renew-flow', 'renew_loan', 'How a loan is renewed, step by step, with every rule'), functionDiagram('hold-flow', 'place_hold', 'How a hold is placed')];
  const oneWithTwo = madeUpParts(1, () => two.map((diagram) => diagram.id));
  await showChange({ parts: oneWithTwo, diagrams: two, changeDiagram: changeMermaid({ parts: oneWithTwo, links: [], files, filesInNoPart: [] }) });
  const choices = () => reads.evaluate(() => ({
    names: [...document.querySelectorAll('#tabs [data-diagram]')].map((a) => a.textContent).join(), on: document.querySelector('#tabs a.on')?.textContent,
    title: document.querySelector('#tabs .title')?.textContent, drawn: document.querySelectorAll('#view g.node').length,
  }));
  const firstChoice = await choices();
  await drawn(() => reads.click('#tabs [data-diagram="hold-flow"]'), reads);
  const secondChoice = await choices();
  check('a change of one part with two diagrams of two functions opens the first, and the switch names each by its function with the kind after it',
    firstChoice.names === 'renew_loan flow,place_hold flow' && firstChoice.on === 'renew_loan flow' && firstChoice.drawn === 4
      && firstChoice.title === two[0].title && secondChoice.on === 'place_hold flow' && secondChoice.title === two[1].title, JSON.stringify({ firstChoice, secondChoice }));
  await readsShot('43-two-diagrams-named-by-function');
  // A diagram that an agent writes may carry settings of Mermaid in its text. Its own CSS or theme must not reach the page: a box could cover all of it.
  const ownStyle = await reads.evaluate(async () => {
    const into = document.createElement('div');
    document.body.append(into);
    const svg = await drawMermaid(into, '%%{init: {"themeCSS": ".node rect { fill: rgb(1, 2, 3); }", "fontFamily": "Papyrus"}}%%\nflowchart TB\n  a[One] --> b[Two]');
    const style = svg?.querySelector('style')?.textContent ?? '';
    into.remove();
    return { drawn: !!svg, css: style.includes('rgb(1, 2, 3)'), font: style.includes('Papyrus') };
  });
  check('the CSS, theme and font that the text of a diagram sets for itself are left out: only the look of the page draws it',
    ownStyle.drawn && !ownStyle.css && !ownStyle.font, JSON.stringify(ownStyle));
  await reads.close();
} catch (error) {
  check('the checks ran to the end', false, error.message.split('\n').slice(0, 14).join(' / '));
}
await finish();
