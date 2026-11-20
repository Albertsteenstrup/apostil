// The browser check of many notes beside the code, and the code map. A group of view/browser-check.mjs, which runs every group at the same time; alone:
//   node view/browser/dense.mjs [--pictures] [<folder for pictures>]
// Each round runs once, in the look "Apostil": the group "looks" checks the colours of the pages in the themes of VS Code. The colours of the code map
// are drawn on a canvas, which that group does not read: they are checked here in the dark default theme too.
// The placement rules themselves (lanesOf, cardPlaces) have their unit tests in view/view.test.ts; these checks prove the drawn page.

import { denseFile } from '../dense-notes.mjs';
import { THEMES, wearTheme } from '../theme-look.mjs';
import { check, errors, FILES_HIDDEN_KEY, finish, HIDDEN_KEY, openPage, pageFile, takePicture } from './tools.mjs';

/** A page, 1400 by 900, with the code and the files shown. */
async function notesPage(url) {
  const one = await openPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  await one.addInitScript((keys) => { try { for (const key of keys) localStorage.setItem(key, '0'); } catch { /* no storage */ } }, [HIDDEN_KEY, FILES_HIDDEN_KEY]);
  one.on('pageerror', (error) => errors.push(error.message));
  one.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await one.goto(url);
  await one.waitForFunction(() => (window.apostilRendered ?? 0) >= 1, null, { timeout: 15000 });
  return one;
}

/** Frames: a scroll draws its rows and the map in the next frame, and the cards are placed when the box has its size. */
const framesOf = (one) => (count = 2) => one.evaluate((left) => new Promise((done) => {
  const frame = () => (--left > 0 ? requestAnimationFrame(frame) : done());
  requestAnimationFrame(frame);
}), count);

/** Does something that draws the page again (a new width), and waits for that drawing. */
const redrawnOf = (one) => async (action) => {
  const before = await one.evaluate(() => window.apostilRendered);
  await action();
  await one.waitForFunction((count) => window.apostilRendered > count, before, { timeout: 8000 });
};

try {

  // ----- many notes beside the code: made-up dense notes of the map, a note for each function and for each step inside it -----
  // The file is made up in the check (dense-notes.mjs); it is in no change.
  const denseRound = async () => {
    const one = await notesPage(`file://${pageFile}`);
    const frames = framesOf(one);
    const redrawn = redrawnOf(one);
    const snap = (picture) => takePicture(one, `${picture}.png`);
    const open = async (file, line = 1) => {
      await one.evaluate(async ({ file, line }) => {
        window.APOSTIL_EXAMPLE.answers[`code:${file.path}`] = file.code;
        App.showCode(file.path, null);
        await App.drawing;
        Code.reveal([line, line]);
      }, { file, line });
      await frames();
    };
    // Each card: its note, how many rows below its first row it stands, its left edge, whether it shows its title only, where its join meets the code.
    const cardRows = () => one.evaluate(() => {
      const { list, box, path: file } = Code.shown;
      const byKey = new Map(window.APOSTIL_EXAMPLE.answers[`code:${file}`].notes.map((note) => [note.key, note]));
      const [rowTop, columnTop] = [box.getBoundingClientRect().top, document.querySelector('.cv .notes').getBoundingClientRect().top];
      return [...document.querySelectorAll('.cv .mc')].map((card, index) => {
        const note = byKey.get(card.querySelector('.nt').dataset.note);
        const at = card.getBoundingClientRect();
        const first = rowTop + list.top(note.lines[0] - 1);
        const join = columnTop + Number(document.querySelector(`.cv svg.links [data-join="${index}"]`).getAttribute('d').match(/^M0 ([\d.]+)/)[1]);
        return {
          title: note.title, lines: note.lines, off: (at.top - first) / list.height, left: Math.round(at.left), top: Math.round(at.top), height: Math.round(at.height),
          brief: card.classList.contains('brief'), from: !!card.querySelector('.from') || /From the map/.test(card.textContent), joinRow: (join - first) / list.height,
        };
      });
    });
    const numbers = (cards) => { const offs = cards.map((card) => card.off).sort((a, b) => a - b); return { max: Math.round(offs.at(-1) * 10) / 10, middle: Math.round(offs[Math.floor(offs.length / 2)] * 10) / 10 }; };
    /** Moves the pointer onto an element and waits for what it lights (`lit`, a selector). */
    const pointAt = async (selector, lit) => {
      const at = await one.locator(selector).first().boundingBox();
      const y = Math.min(at.y + at.height / 2, Math.max(at.y + 8, one.viewportSize().height - 40)); // a tall mark: a point of it that is in view
      await one.mouse.move(at.x + Math.min(120, at.width / 2) - 10, y - 2);
      await one.mouse.move(at.x + Math.min(120, at.width / 2), y, { steps: 4 });
      await one.waitForSelector(lit, { timeout: 3000 }).catch(() => {});
    };
    const away = async () => { await one.mouse.move(6, 880, { steps: 2 }); await one.waitForSelector('.cv .mc.open', { state: 'detached', timeout: 3000 }).catch(() => {}); };
    const litNow = () => one.evaluate(() => ({ card: document.querySelector('.cv .mc.cur .nt')?.textContent ?? '', open: !!document.querySelector('.cv .mc.cur.open'), rows: [...document.querySelectorAll('.cv .l.lit')].map((row) => Number(row.dataset.line)) }));

    // 1. Forty notes in 450 lines: ten functions, each with three steps inside it. No card says where it came from; each card stands at its first row.
    // A function is the head of its steps: its steps stand one lane in under it, the next function at the left again; the join of a function meets its first row.
    const forty = denseFile({ path: 'src/forty_notes.py', lines: 450, every: 15, fn: 45 });
    await open(forty, 46);
    const fortyCards = await cardRows();
    const measured = { 'every 15 (40 notes)': numbers(fortyCards) };
    for (const every of [4, 8, 15]) {
      await open(denseFile({ path: `src/every_${every}.py`, lines: 450, every }));
      measured[`every ${every} in functions of 30`] = numbers(await cardRows());
    }
    // A card stands lower than its row only at the top of the file, where the control of the file tab stands above the first card.
    const belowTop = Object.values(measured).every(({ max, middle }) => max <= 2.5 && middle === 0);
    const heads = fortyCards.filter((card) => fortyCards.some((other) => other !== card && card.lines[0] <= other.lines[0] && other.lines[1] <= card.lines[1]));
    const lanes = heads.map((head) => {
      const steps = fortyCards.filter((card) => card !== head && head.lines[0] <= card.lines[0] && card.lines[1] <= head.lines[1]);
      const after = fortyCards[fortyCards.indexOf(steps.at(-1)) + 1];
      return { steps: steps.length, inset: steps.every((step) => step.left - head.left >= 12), nextAtLeft: !after || after.left === head.left, joinAtFirstRow: head.joinRow >= 0 && head.joinRow <= 1 };
    });
    check('a file tab with 40 made-up notes of the map in 450 lines: no card says "From the map", and each card stands at its first row; each function is the head of its steps: its steps stand one lane in under it, the next function at the left again, and its join meets its first row',
      fortyCards.length === 40 && fortyCards.every((card) => !card.from) && belowTop && heads.length === 10 && lanes.every((lane) => lane.steps === 3 && lane.inset && lane.nextAtLeft && lane.joinAtFirstRow),
      JSON.stringify({ cards: fortyCards.length, rowsBelowTheFirstRow: measured, lanes: lanes.slice(0, 3) }));

    // 2. The pointer on a row of a step lights the step and its card; a row of the function in no step (its def) lights the function.
    await open(forty, 46);
    await snap('45-apostil-1-forty-notes-in-450-lines');
    const stepNote = forty.code.notes.find((note) => note.lines[0] === 62);
    const fnNote = forty.code.notes.find((note) => note.lines[0] === 46);
    await pointAt('.cv .l[data-line="65"] .x', '.cv .l.lit[data-line="62"]');
    const onStep = await litNow();
    await pointAt('.cv .l[data-line="46"] .x', '.cv .l.lit[data-line="46"]');
    const onDef = await litNow();
    check('the pointer on a row of a step lights the step and its card, not the function; the def row, in no step, lights the function',
      onStep.card === stepNote.title && onStep.rows.length === 15 && onStep.rows[0] === 62 && onDef.card === fnNote.title && onDef.rows.includes(46) && onDef.rows.includes(65),
      JSON.stringify({ onStep: { ...onStep, rows: onStep.rows.length }, onDef: { ...onDef, rows: onDef.rows.length } }));
    await away();

    // 3. A dense stretch, a note for each 4 lines: the cards show their titles; the pointer opens one over the cards below it, no other card moves, and it closes when he leaves.
    const dense = denseFile({ path: 'src/every_4_lines.py', lines: 450, every: 4 });
    await open(dense, 61);
    const before = await cardRows();
    const target = dense.code.notes.find((note) => note.lines[0] === 70);
    const index = before.findIndex((card) => card.title === target.title && card.lines[0] === 70);
    const titles = before.filter((card) => card.lines[0] >= 61 && card.lines[0] < 86);
    await pointAt(`.cv .mc >> nth=${index}`, '.cv .mc.open');
    const opened = await cardRows();
    const openState = await one.evaluate((at) => { const card = document.querySelectorAll('.cv .mc')[at]; return { open: card.classList.contains('open'), z: getComputedStyle(card).zIndex }; }, index);
    await snap('45-apostil-4-dense-titles-and-one-open');
    await away();
    const closed = await cardRows();
    await pointAt('.cv .l[data-line="71"] .x', '.cv .mc.cur.open');
    const byRows = await litNow();
    await away();
    const moved = opened.filter((card, at) => at !== index && card.top !== before[at].top).length;
    check('a note for each 4 lines: the cards of the stretch show their titles at their rows; the pointer on one opens it over the cards below, no other card moves, it closes when he leaves, and the pointer on its rows opens it too',
      titles.length >= 7 && titles.every((card) => card.brief && Math.abs(card.off) < 0.75) && openState.open && Number(openState.z) > 1 && opened[index].height > before[index].height + 10 && !moved
        && closed[index].height === before[index].height && byRows.card === target.title && byRows.open,
      JSON.stringify({ titles: titles.length, brief: titles.filter((card) => card.brief).length, height: [before[index].height, opened[index].height, closed[index].height], moved, openState, byRows: byRows.card }));

    // 4. The narrow tab: the mark of a function stands beside the marks of its steps, no two marks on top of each other, and the pointer on a mark opens its note as a window.
    await redrawn(() => one.setViewportSize({ width: 600, height: 900 })); // the file tab draws again in its narrow form
    await open(forty, 46);
    const marks = await one.evaluate(() => [...document.querySelectorAll('.cv .mk')].map((mark) => { const at = mark.getBoundingClientRect(); return { left: at.left, right: at.right, top: at.top, bottom: at.bottom }; }));
    const overlaps = marks.flatMap((a, i) => marks.slice(i + 1).filter((b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)).length;
    const stepMark = await one.evaluate((first) => {
      const all = [...document.querySelectorAll('.cv .mk')];
      const row = document.querySelector(`.cv .l[data-line="${first}"]`).getBoundingClientRect();
      return all.findIndex((mark) => Math.abs(mark.getBoundingClientRect().top - row.top) <= 2 && mark.style.left !== '4px');
    }, 62);
    await pointAt(`.cv .mk >> nth=${stepMark}`, '.win .mc');
    const markWindow = await one.locator('.win .mc').first().textContent({ timeout: 1000 }).catch(() => '');
    await snap('45-apostil-5-narrow-marks-and-the-window-of-a-step');
    check('on a narrow tab the mark of a function stands beside the marks of its steps, no two marks lie on top of each other, and the pointer on the mark of a step opens its note as a window',
      marks.length === 40 && overlaps === 0 && stepMark >= 0 && markWindow.includes(stepNote.title), JSON.stringify({ marks: marks.length, overlaps, stepMark, markWindow: markWindow.slice(0, 60) }));
    await one.mouse.move(300, 880, { steps: 2 });
    await redrawn(() => one.setViewportSize({ width: 1400, height: 900 }));

    // 5. A file of 1,500 lines with 150 notes opens and scrolls with no wait that he can see: the time to place the cards is less than one frame.
    const big = denseFile({ path: 'src/fifteen_hundred_lines.py', lines: 1500, every: 15 });
    const timing = await one.evaluate(async (file) => {
      window.APOSTIL_EXAMPLE.answers[`code:${file.path}`] = file.code;
      const started = performance.now();
      App.showCode(file.path, null);
      await App.drawing;
      const opens = performance.now() - started;
      const places = [];
      for (let time = 0; time < 5; time++) { const at = performance.now(); Code.shown.view.place(); void document.body.offsetHeight; places.push(performance.now() - at); }
      const scrolls = [];
      for (let time = 0; time < 10; time++) {
        const at = performance.now();
        Code.shown.scroller.scrollTop += 700;
        Code.shown.list.refresh();
        void document.body.offsetHeight;
        scrolls.push(performance.now() - at);
        await new Promise((done) => requestAnimationFrame(done));
      }
      return { notes: file.code.notes.length, cards: document.querySelectorAll('.cv .mc').length, opens: Math.round(opens), place: Math.round(Math.max(...places) * 10) / 10, scroll: Math.round(Math.max(...scrolls) * 10) / 10 };
    }, big);
    check('a file of 1,500 lines with 150 notes opens in less than a second and places its cards in less than one frame (16 ms); a scroll draws in less than 50 ms',
      timing.notes === 150 && timing.cards === 150 && timing.opens < 1000 && timing.place < 16 && timing.scroll < 50, JSON.stringify(timing));
    await one.close();
  };

  // ----- the small code map in the file tab: a map of the whole file at the right, under the cards; and "Edit" -----
  // In a file tab. The files are made up in the check (dense-notes.mjs).
  const mapRound = async () => {
    const one = await notesPage(`file://${pageFile}?file=src/library/night_jobs.py`);
    const frames = framesOf(one);
    const redrawn = redrawnOf(one);
    const snap = (picture) => takePicture(one, `${picture}.png`);
    // Opens a made-up file in this file tab, at a line.
    const open = async (file, line = 1) => {
      await one.evaluate(async ({ file, line }) => {
        window.APOSTIL_EXAMPLE.answers[`code:${file.path}`] = file.code;
        App.tab = file.path;
        App.render();
        await App.drawing;
        Code.reveal([line, line]);
      }, { file, line });
      await frames(3);
    };
    /** Scrolls the file and waits for the map of that place. */
    const scrollTo = async (top) => { await one.evaluate((to) => { Code.shown.scroller.scrollTop = to; }, top); await frames(3); };
    // The map in numbers: its box, the column of the notes, the box of the code, the box in view, and the scroll.
    const mapNow = () => one.evaluate(() => {
      const box = (el) => { const at = el?.getBoundingClientRect(); return at && { left: Math.round(at.left), right: Math.round(at.right), top: Math.round(at.top), bottom: Math.round(at.bottom), width: Math.round(at.width), height: Math.round(at.height) }; };
      const map = [...CodeMap.all].find((one) => one.el.isConnected);
      const { scroller } = Code.shown;
      return {
        on: CodeMap.shown(), map: box(document.querySelector('.cv .cmap:not([hidden]) canvas')), slider: box(document.querySelector('.cv .cmap:not([hidden]) .slider')),
        column: box(document.querySelector('.cv .notes')), code: box(document.querySelector('.cv .rowsbox')), scroller: box(scroller),
        scrollRight: Math.round(scroller.getBoundingClientRect().left + scroller.clientWidth), scrollTop: scroller.scrollTop, most: scroller.scrollHeight - scroller.clientHeight,
        rowHeight: map?.geometry && map.geometry.scale * Code.shown.list.height, geometry: map?.geometry,
      };
    });
    // The colour of the map at a row of the file and a place across it (px from its left), as [r, g, b, a].
    const mapPixel = (row, x) => one.evaluate(({ row, x }) => {
      const map = [...CodeMap.all].find((one) => one.el.isConnected);
      const { scale, shift, offset } = map.geometry;
      const canvas = map.el.querySelector('canvas');
      const ratio = canvas.width / canvas.getBoundingClientRect().width;
      const y = ((offset + Code.shown.list.top(row)) * scale - shift + 1) * ratio;
      return [...canvas.getContext('2d').getImageData(Math.floor(x * ratio), Math.floor(y), 1, 1).data];
    }, { row, x });

    // 1. 450 lines with 40 notes: the map at the right of the box, left of its scroll bar, at the right end of the column of the notes, which keeps its width.
    // The code is as wide as with no map (the map takes its room before the code is measured). The cards lie over the map, whole, each with its line to its rows.
    const forty = denseFile({ path: 'src/forty_notes.py', lines: 450, every: 15, fn: 45 });
    await open(forty, 46);
    const withMap = await mapNow();
    const over = await one.evaluate(() => {
      const map = document.querySelector('.cv .cmap canvas').getBoundingClientRect();
      const cards = [...document.querySelectorAll('.cv .mc')].filter((card) => { const at = card.getBoundingClientRect(); return at.top > map.top && at.bottom < map.bottom; });
      // A point of each card over the map is the card; a point of the map with no card is the map.
      const onCards = cards.every((card) => { const at = card.getBoundingClientRect(); return card.contains(document.elementFromPoint(map.left + 40, at.top + at.height / 2)) && card.contains(document.elementFromPoint(at.right - 4, at.top + 6)); });
      const all = [...document.querySelectorAll('.cv .mc')].map((card) => card.getBoundingClientRect()).filter((at) => at.top > map.top && at.top < map.bottom).sort((a, b) => a.top - b.top);
      const gap = all.findIndex((at, index) => index > 0 && all.slice(0, index).every((above) => above.bottom + 12 < at.top));
      const free = gap > 0 ? document.elementFromPoint(map.left + 40, at(gap)) : null;
      function at(index) { return (Math.max(...all.slice(0, index).map((above) => above.bottom)) + all[index].top) / 2; }
      const joins = document.querySelectorAll('.cv svg.links [data-join]').length;
      return { cards: cards.length, onCards, free: free?.closest('.cmap') ? 'map' : free?.tagName ?? '', joins, notes: document.querySelectorAll('.cv .mc').length };
    });
    await snap('46-apostil-1-the-map-under-the-cards');
    await one.evaluate(() => CodeMap.set(false));
    const noMap = await mapNow();
    await one.evaluate(() => CodeMap.set(true));
    await frames(3);
    check(`a file tab with 450 lines and 40 notes has the map at the right, ${withMap.map?.width} px wide with a row of ${withMap.rowHeight} px, left of the scroll bar at the right end of the column of the notes; the column keeps its 330 px and the code keeps its width; each card lies over the map, whole; where no card stands, the map shows; every card keeps its line to its rows`,
      withMap.on && withMap.map.width === 120 && withMap.rowHeight === 2 && withMap.map.right === withMap.scrollRight && withMap.map.right === withMap.column.right && withMap.column.width === 330
        && !noMap.on && noMap.column.width === 330 && noMap.code.width === withMap.code.width
        && over.cards >= 3 && over.onCards && over.free === 'map' && over.joins === over.notes && over.notes === 40,
      JSON.stringify({ withMap: { ...withMap, geometry: undefined }, noMap: { code: noMap.code, column: noMap.column }, over }));

    // 2. The box of the part in view: it moves when the file scrolls; a click on the map shows that place; a drag of the box scrolls; it is softer at rest.
    await scrollTo(0);
    const atTop = await mapNow();
    await scrollTo(1500);
    const scrolled = await mapNow();
    // A click below the box, on the right strip that no card covers: the place clicked comes to the middle of the box.
    const clickY = scrolled.map.top + Math.min(scrolled.map.height - 10, scrolled.slider.bottom - scrolled.map.top + 300);
    await one.mouse.click(scrolled.map.right - 4, clickY);
    await frames(3);
    const clicked = await mapNow();
    const middle = (clicked.slider.top + clicked.slider.bottom) / 2;
    const hovered = await one.evaluate(() => getComputedStyle(document.querySelector('.cv .cmap .slider')).backgroundColor);
    // A drag of the box down by 40 px of the map.
    const [dragX, dragY] = [clicked.map.right - 4, middle];
    await one.mouse.move(dragX, dragY);
    await one.mouse.down();
    await one.mouse.move(dragX, dragY + 20, { steps: 3 });
    await one.mouse.move(dragX, dragY + 40, { steps: 3 });
    await one.mouse.up();
    await frames(3);
    const dragged = await mapNow();
    await one.mouse.move(6, 880);
    await frames();
    const resting = await one.evaluate(() => getComputedStyle(document.querySelector('.cv .cmap .slider')).backgroundColor);
    const perPixel = 1 / (dragged.geometry.scale - dragged.geometry.moves);
    check('the box of the part in view moves with the scroll; a click on the map brings that place to the middle of the box; a drag of the box scrolls with it; the pointer shows the box stronger',
      atTop.slider.top === atTop.map.top && Math.abs(scrolled.slider.top - atTop.slider.top - 1500 * (scrolled.geometry.scale - scrolled.geometry.moves)) <= 1
        && Math.abs(middle - clickY) <= 2 && clicked.scrollTop > scrolled.scrollTop && Math.abs(dragged.scrollTop - clicked.scrollTop - 40 * perPixel) <= perPixel * 2 && hovered !== resting,
      JSON.stringify({ atTop: atTop.slider, scrolled: [scrolled.scrollTop, scrolled.slider.top], clicked: [clicked.scrollTop, middle, clickY], dragged: dragged.scrollTop, perPixel, hovered, resting }));

    // 3. A file taller than the map moves the map with it: the top of the file at the top of the map, the end of the file at the end of the map.
    const tall = denseFile({ path: 'src/fifteen_hundred_lines.py', lines: 1500, every: 15 });
    await open(tall, 1);
    const tallTop = await mapNow();
    await scrollTo(1e7);
    const tallEnd = await mapNow();
    const lastRow = await mapPixel(1498, 6); // the last line with code
    check('a file of 1,500 lines is taller than the map: at the top the map shows its top, at the end its end, and the box in view is at the end of the map',
      tallTop.geometry.shift === 0 && tallTop.geometry.moves > 0 && Math.abs(tallEnd.geometry.shift - tallEnd.most * tallEnd.geometry.moves) < 1
        && Math.abs(tallEnd.slider.bottom - tallEnd.map.bottom) <= 1 && lastRow[3] > 0,
      JSON.stringify({ top: tallTop.geometry, end: tallEnd.geometry, slider: tallEnd.slider, map: tallEnd.map, lastRow }));

    // 4. The narrow tab: the notes are marks; the map stands at the right of them, 60 px, and no mark lies on it.
    await redrawn(() => one.setViewportSize({ width: 640, height: 900 }));
    await open(forty, 46);
    const narrow = await mapNow();
    const marks = await one.evaluate(() => Math.max(...[...document.querySelectorAll('.cv .mk')].map((mark) => mark.getBoundingClientRect().right)));
    check('on a narrow tab the map stands at the right of the marks of the notes, 60 px, left of the scroll bar, and no mark lies on it',
      narrow.on && narrow.map.width === 60 && narrow.map.right === narrow.scrollRight && marks <= narrow.map.left, JSON.stringify({ map: narrow.map, marks, scrollRight: narrow.scrollRight }));
    await redrawn(() => one.setViewportSize({ width: 1400, height: 900 }));

    // 5. The setting of VS Code "editor.minimap.enabled" off: no map, in the tab that is open and in a tab that opens; on again, the map is back.
    await open(forty, 46);
    await one.evaluate(() => window.postMessage({ type: 'minimap', on: false }, '*'));
    await one.waitForFunction(() => !CodeMap.on, null, { timeout: 3000 }).catch(() => {});
    const offNow = await mapNow();
    await redrawn(() => one.evaluate(() => window.postMessage({ type: 'data', page: App.page, file: App.tab, minimap: false }, '*')));
    await frames();
    const offOpened = await mapNow();
    await one.evaluate(() => window.postMessage({ type: 'minimap', on: true }, '*'));
    await one.waitForFunction(() => CodeMap.on, null, { timeout: 3000 }).catch(() => {});
    await frames();
    const onAgain = await mapNow();
    check('with "editor.minimap.enabled" off the file tab has no map, at once and when it draws again; on again, the map is back',
      !offNow.on && !offNow.map && !offOpened.on && !offOpened.map && onAgain.on && onAgain.map?.width === 120, JSON.stringify({ offNow: offNow.on, offOpened: offOpened.on, onAgain: onAgain.map }));

    // 6. A file of 20,000 lines with no notes opens and scrolls with no wait that he can see; the map draws only the part that shows.
    const huge = denseFile({ path: 'src/twenty_thousand_lines.py', lines: 20000, every: 15 });
    huge.code.notes = [];
    const timing = await one.evaluate(async (file) => {
      window.APOSTIL_EXAMPLE.answers[`code:${file.path}`] = file.code;
      App.tab = file.path;
      const started = performance.now();
      App.render();
      await App.drawing;
      void document.body.offsetHeight;
      const opens = performance.now() - started;
      const map = [...CodeMap.all].find((one) => one.el.isConnected);
      const scrolls = [];
      const { scroller } = Code.shown;
      for (const to of [3000, 60000, 180000, 359000, 1e7, 120000, 0]) {
        const at = performance.now();
        scroller.scrollTop = to;
        Code.shown.list.refresh();
        map.draw();
        void document.body.offsetHeight;
        scrolls.push(performance.now() - at);
        await new Promise((done) => requestAnimationFrame(done));
      }
      return { lines: file.code.lines.length, side: !!document.querySelector('.cv .mside .cmap canvas'), opens: Math.round(opens), slowestScroll: Math.round(Math.max(...scrolls) * 10) / 10, scrolls: scrolls.map((ms) => Math.round(ms)) };
    }, huge);
    check(`a file of 20,000 lines with no notes has the map in a column of its own; it opens in ${timing.opens} ms and the slowest scroll with the map takes ${timing.slowestScroll} ms (under 1 s and 100 ms)`,
      timing.lines === 20000 && timing.side && timing.opens < 1000 && timing.slowestScroll < 100, JSON.stringify(timing));

    // 7. "Edit" in the control of the file tab: VS Code gets the message to change this tab to its editor, at the first line in view; a double click on a line, at that line.
    await open(forty, 120);
    const edit = await one.evaluate(() => ({ text: document.querySelector('.cvw .nav [data-edit]')?.textContent, title: document.querySelector('.cvw .nav [data-edit]')?.title, first: firstLineInView() }));
    await one.click('.cvw .nav [data-edit]');
    const sentClick = await one.evaluate(() => window.apostilSent.filter((one) => one.type === 'edit').at(-1));
    await one.locator('.cv .l[data-line="125"] .x').dblclick();
    const sentDouble = await one.evaluate(() => window.apostilSent.filter((one) => one.type === 'edit').at(-1));
    const firstShown = await one.evaluate(() => { const top = Code.shown.scroller.getBoundingClientRect().top; return Number([...document.querySelectorAll('.cv .l[data-line]')].find((row) => row.getBoundingClientRect().top + row.offsetHeight / 2 >= top).dataset.line); });
    check(`"Edit" stands in the control of the file tab with its tooltip; a click sends VS Code "edit" at the first line in view (${sentClick?.line}), a double click on line 125 at line 125`,
      edit.text === 'Edit' && edit.title === `Open this file in the editor of VS Code (${process.platform === 'darwin' ? 'Cmd' : 'Ctrl'}+Shift+,). The same key brings the notes back.`
        && sentClick?.line === firstShown && sentClick?.line >= 115 && sentClick?.line <= 120 && sentDouble?.line === 125, JSON.stringify({ edit, sentClick, sentDouble, firstShown }));

    // 8. The marks: a thin teal mark at the right edge for the lines of each note, and the colour of added rows where the file has them,
    // in the look "Apostil" and in the dark default theme, put on the open page (the map takes the colours of a new theme at once).
    const changed = denseFile({ path: 'src/changed_rows.py', lines: 450, every: 15, fn: 45 });
    changed.code.changed = [[100, 110]];
    await open(changed, 90);
    const marksNow = async () => ({ noteMark: await mapPixel(105, 118), added: await mapPixel(105, 110), plain: await mapPixel(130, 110) });
    const inLook = await marksNow();
    await one.evaluate(wearTheme, THEMES.dark);
    await frames(3);
    const inDark = await marksNow();
    const marked = ({ noteMark, added, plain }) => noteMark[3] > 0 && Math.abs(noteMark[1] - noteMark[0]) > 30 && noteMark[2] > noteMark[0] && added[3] > 0 && plain[3] === 0;
    check('the map has a teal mark at its right edge for the lines of a note, and the faint colour of added rows where the file has them, in the look "Apostil" and in the dark default theme',
      marked(inLook) && marked(inDark) && inLook.noteMark.join() !== inDark.noteMark.join(), JSON.stringify({ inLook, inDark }));
    await one.close();
  };

  await denseRound();
  await mapRound();

  // A click on a note card focuses it: it stands whole and moves the card under it down, where it lay over it before. A click on the code ends the focus.
  const focusPage = await openPage({ viewport: { width: 1400, height: 900 } });
  await focusPage.goto(`file://${pageFile}?file=src/library/lending/requests.py`);
  await focusPage.waitForSelector('.mc .nt', { timeout: 15000 });
  const cardOf = (title) => `.mc:has(.nt:text-is("${title}"))`;
  const focusNow = () => focusPage.evaluate(() => {
    const cards = [...document.querySelectorAll('.mc')];
    const at = (title) => cards.find((mc) => mc.querySelector('.nt').textContent === title);
    return { cur: cards.filter((mc) => mc.classList.contains('cur')).map((mc) => mc.querySelector('.nt').textContent).join(), brief: at('Answer the request').classList.contains('brief'),
      gap: Math.round(at('Lock the requests for the book').getBoundingClientRect().top - at('Answer the request').getBoundingClientRect().bottom), lines: App.state.lines };
  });
  const briefBefore = (await focusNow()).brief;
  await focusPage.$eval(cardOf('Answer the request'), (el) => el.scrollIntoView({ block: 'center' }));
  await focusPage.click(cardOf('Answer the request'));
  await focusPage.mouse.move(5, 5);
  const focusedNote = await focusNow();
  await focusPage.click('.rowsbox [data-row="3"]');
  const endedNote = await focusNow();
  check('a click on a note card focuses it: it stands whole and moves the card under it down, so it covers no card; a click on the code ends the focus',
    briefBefore && focusedNote.cur === 'Answer the request' && !focusedNote.brief && focusedNote.gap >= 0 && focusedNote.lines?.length === 2 && endedNote.cur === '' && endedNote.brief && endedNote.lines === null,
    JSON.stringify({ briefBefore, focusedNote, endedNote }));
  await focusPage.close();
} catch (error) {
  check('the checks ran to the end', false, error.message.split('\n').slice(0, 14).join(' / '));
}
await finish();
