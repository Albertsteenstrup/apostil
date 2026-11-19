// The browser check of Alt+Down and Alt+Up, and a file tab with the graph beside it. A group of view/browser-check.mjs, which runs every group at the same time; alone:
//   node view/browser/steps.mjs [--pictures] [<folder for pictures>]
// Each round runs once, in the look "Apostil": the group "looks" checks the colours of these pages in the themes of VS Code.
// The rule of a step itself (stepPlace) has its unit tests in view/follow.test.ts; these checks prove that every place that shows a diff uses it.

import { check, errors, FILES_HIDDEN_KEY, finish, HIDDEN_KEY, openPage, pageFile, takePicture } from './tools.mjs';

/** A page of the example change, 1400 by 900, with the code beside a diagram and the list of "Diffs" shown. */
async function examplePage(url = `file://${pageFile}`) {
  const one = await openPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  await one.addInitScript((keys) => { try { for (const key of keys) localStorage.setItem(key, '0'); } catch { /* no storage */ } }, [HIDDEN_KEY, FILES_HIDDEN_KEY]);
  // The time of the last scroll of any list, and of the last write in the line of tabs (the counter), for `rested` below.
  await one.addInitScript(() => {
    Object.assign(window, { lastScroll: 0, lastWrite: 0 });
    addEventListener('scroll', () => { window.lastScroll = performance.now(); }, { capture: true, passive: true });
    document.addEventListener('DOMContentLoaded', () => new MutationObserver(() => { window.lastWrite = performance.now(); }).observe(document.getElementById('tabs'), { childList: true, subtree: true }));
  });
  one.on('pageerror', (error) => errors.push(error.message));
  one.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await one.goto(url);
  await one.waitForFunction(() => (window.apostilRendered ?? 0) >= 1, null, { timeout: 15000 });
  return one;
}

/** What waits for the page: each helper waits for the state that the next step reads, not for a time. */
function waitsOf(one) {
  /** Two frames: the scroll event of the last move has drawn the rows in view. */
  const frames = () => one.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  /**
   * Presses keys of the steps (Alt+Down, Alt+Up, J, K) with no wait between them, then waits until the last key made its place the current one and the
   * list in `scroller` glided there. A key makes a new place (`here()` with its `top`); the glide ends at that top.
   */
  const press = async (scroller, ...keys) => {
    await one.evaluate(() => { window.placeBefore = (App.diffs ?? Code.shown?.steps)?.here(); window.placeKeyed = null; });
    for (const key of keys) await one.keyboard.press(key);
    await one.waitForFunction((where) => {
      const at = (App.diffs ?? Code.shown?.steps)?.here();
      if (at && at !== window.placeBefore && at.top !== undefined) window.placeKeyed = at;
      const keyed = window.placeKeyed;
      const box = document.querySelector(where);
      return !!keyed && !!box && (Math.abs(box.scrollTop - keyed.top) < 1 || performance.now() > keyed.until + 100);
    }, scroller, { polling: 'raf', timeout: 8000 });
    await rested();
  };
  /**
   * On "Diagram" with every diff open, waits until the list rested: when a scroll rests (150 ms), the page fills the diffs above the reading line and
   * writes the counter again; a fill moves the list (the browser keeps the rows in view in place), which is a new scroll, so the rest comes again.
   * Rested: the counter was written after the last scroll, and no open diff near the view waits to be filled (they fill within 800 px of it).
   * Elsewhere (one file) nothing fills: two frames, for the rows of the last scroll.
   */
  const rested = async () => {
    await frames(); // the scroll event of the last move
    await one.waitForFunction(() => {
      const box = document.querySelector('#view > .half.right');
      if (!box?.querySelector('.diffs:not(.rows) .dfile.open')) return true;
      const view = box.getBoundingClientRect();
      const waiting = [...box.querySelectorAll('.dfile.open')].some((section) => {
        const holder = section.querySelector('.dfw');
        if (section.view || !holder) return false;
        const at = holder.getBoundingClientRect();
        return at.bottom > view.top - 800 && at.top < view.bottom + 800;
      });
      return !waiting && window.lastWrite > window.lastScroll;
    }, null, { polling: 'raf', timeout: 8000 });
    await frames();
  };
  /** Brings a file to the top (its head, at its first change), as a click on its name does. */
  const toPath = async (file) => {
    await one.evaluate((where) => App.diffs.toPath(where), file);
    await rested();
  };
  /** Goes to a view of the change; App.go draws it and returns when it is drawn. */
  const showIn = async (go) => { await one.evaluate(async (place) => { await App.go(place); }, go); await frames(); };
  /** Does something that draws the page again (a new width, "Hide files"), and waits for that drawing. */
  const redrawn = async (action) => {
    const before = await one.evaluate(() => window.apostilRendered);
    await action();
    await one.waitForFunction((count) => window.apostilRendered > count, before, { timeout: 8000 });
    await frames();
  };
  /** Waits until the list in `scroller` stands still for three frames: a glide that a step or the pointer started has ended. */
  const still = (scroller) => one.evaluate((where) => new Promise((done) => {
    const box = document.querySelector(where);
    let [last, calm, count] = [box.scrollTop, 0, 0];
    const frame = () => {
      if (box.scrollTop === last) calm++; else [last, calm] = [box.scrollTop, 0];
      if (calm >= 3 || ++count > 300) done(); else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), scroller);
  return { frames, press, rested, toPath, showIn, redrawn, still };
}

const [modal, panelTest, panel] = ['web/src/member/HoldDialog.tsx', 'web/src/member/HoldsPanel.test.tsx', 'web/src/member/HoldsPanel.tsx'];
const [worker2, service] = ['src/library/night_jobs.py', 'src/library/lending/hold_service.py'];
const pack = 'src/library/lending/ready_shelf.py';
const models = 'src/library/lending/hold_models.py';
const tasks = 'src/library/lending/requests.py';

try {

  // ----- one way to step through changes -----
  // Alt+Down and Alt+Up by one rule in every place that shows a diff. Each check reads the rows in the view before the key and after it:
  // a row is in the view when its middle is below the head that sticks over the list and above the bottom edge.
  const stepRound = async () => {
    const one = await examplePage();
    const { press: pressIn, rested, toPath, showIn, redrawn, frames } = waitsOf(one);
    const snap = (picture) => takePicture(one, `${picture}.png`);
    const RIGHT = '#view > .half.right';
    const press = (...keys) => pressIn(RIGHT, ...keys);
    const seen = (selector) => one.evaluate((where) => {
      const scroller = document.querySelector(where);
      const box = scroller.getBoundingClientRect();
      // What sticks at the top: the name of the part, and under it the head of the file, each standing on the one above.
      const heads = [...scroller.querySelectorAll('.dp, .dh, .fh')].map((el) => el.getBoundingClientRect()).filter((head) => head.height);
      let viewTop = box.top;
      for (let head = heads.find((one) => Math.abs(one.top - viewTop) < 2); head; head = heads.find((one) => Math.abs(one.top - viewTop) < 2)) viewTop = head.bottom;
      const drawn = [...scroller.querySelectorAll('.rowsbox [data-row]')].map((el) => ({ el, row: el.getBoundingClientRect() })).filter(({ row }) => row.height > 0);
      const line = Math.min(...drawn.map(({ row }) => row.height)); // one drawn row of text; a long line that wraps is a taller row
      const keyOf = (el) => `${el.closest('[data-file]').dataset.file}#${el.dataset.row}`;
      // A row counts in a band of two drawn rows when more than `inset` pixels of it are in the band. The view before counts a row with more than half
      // of it there (10 of 18 pixels); the view after with more than a third (6), since a scroll place is a whole pixel.
      const within = (from, to, inset = 1) => drawn.filter(({ row }) => row.bottom > from + inset && row.top < to - inset).map(({ el }) => keyOf(el));
      const rows = drawn.filter(({ row }) => row.top + row.height / 2 >= viewTop && row.top + row.height / 2 <= box.bottom).map(({ el }) => keyOf(el));
      const at = (App.diffs ?? Code.shown?.steps)?.here();
      const run = at?.section.view && at.run >= 0 ? changeRuns(at.section.view.rows)[at.run] : null;
      const reading = box.top + scroller.clientHeight / 3;
      const left = document.querySelector('#view > .half.left');
      const titles = at?.section.view ? thingsAt(App.page.diagrams, at.path, at.section.view.rows, at.focus).map((found) => App.page.diagrams.find((diagram) => diagram.id === found.id).title) : [];
      return {
        rows, visible: within(viewTop, box.bottom), first2: within(viewTop, viewTop + 2 * line, 10), last2: within(box.bottom - 2 * line, box.bottom, 10),
        first2After: within(viewTop, viewTop + 2 * line, 6), last2After: within(box.bottom - 2 * line, box.bottom, 6),
        top: Math.round(scroller.scrollTop), path: at?.path ?? '', run: at?.run ?? -2,
        off: run ? Math.round(at.section.view.box.getBoundingClientRect().top + at.section.view.list.top(run[0]) - reading) : null,
        nav: document.querySelector('#tabs .nav, .cvw .nav')?.textContent ?? '', titles,
        cards: left ? [...left.children].map((el) => el.querySelector('.gt')?.textContent ?? 'change') : [], lit: left ? left.querySelectorAll('.joined').length : 0,
        headAtTop: [...scroller.querySelectorAll('.dfile')].find((section) => Math.abs(section.getBoundingClientRect().top - box.top - (scroller.querySelector('.dp')?.offsetHeight ?? 0)) <= 2)?.dataset.file ?? '',
      };
    }, selector);
    const changeOf = (look) => Number(/change (\d+) of/.exec(look.nav)?.[1] ?? 0);
    // The last two drawn rows of the view before are the first two drawn rows of the view after (upward: the first two the last two); a long line that wraps is one row of several drawn rows.
    const keptAtTop = (before, after) => before.last2.length > 0 && before.last2.every((row) => after.first2After.includes(row));
    const keptAtBottom = (before, after) => before.first2.length > 0 && before.first2.every((row) => after.last2After.includes(row));
    const keptIn = (before, after) => before.last2.length > 0 && before.last2.every((row) => after.visible.includes(row));
    // Upward, the key that brings the first row of the change within reach brings it to the reading line, and the first two rows of the view before stay in the view.
    const keptUp = (before, after) => keptAtBottom(before, after) || (Math.abs(after.off) <= 2 && before.first2.length > 0 && before.first2.every((row) => after.visible.includes(row)));
    const filesOf = (look, file) => look.rows.filter((row) => row.startsWith(`${file}#`)).map((row) => Number(row.split('#')[1]));
    const rowCount = (file) => one.evaluate((where) => document.querySelector(`#view .dfile[data-file="${where}"]`).view.rows.length, file);

    // On "Diagram" with every diff open: the list of the diffs, with the graph that follows.
    await one.click('[data-all="open"]');
    await one.waitForFunction(() => document.querySelector('[data-all]')?.textContent === 'Close all' && !document.querySelector('#view .dfile.shut:not(.quiet)'));
    await frames();

    // 1. A change within reach: its first row comes to the reading line, and the last two rows of the view before stay in the view.
    await toPath(worker2);
    const before1 = await seen(RIGHT);
    await press('Alt+ArrowDown');
    const after1 = await seen(RIGHT);
    check('Alt+Down to a change within reach brings its first row to the reading line, and the last two rows of the view before stay in the view',
      after1.path === worker2 && after1.run === 1 && Math.abs(after1.off) <= 2 && before1.rows.length > 20 && keptIn(before1, after1),
      JSON.stringify({ before: before1.last2, after: [after1.path, after1.run, after1.off, after1.rows.length] }));

    // 2. A step into a new file, the case of the film: from night_jobs.py to ready_shelf.py its head comes to the top, and no row of night_jobs.py is in the view.
    let before4 = after1;
    for (let at = 0; at < 6 && (await seen(RIGHT)).path !== pack; at++) { before4 = await seen(RIGHT); await press('Alt+ArrowDown'); }
    const after4 = await seen(RIGHT);
    check('Alt+Down from the last change of night_jobs.py brings the head of ready_shelf.py to the top, with no row of night_jobs.py in the view, and its first change is the current one',
      before4.path === worker2 && after4.path === pack && after4.run === 0 && after4.headAtTop === pack && filesOf(after4, worker2).length === 0 && filesOf(before4, worker2).length > 0
        && changeOf(after4) === changeOf(before4) + 1, JSON.stringify({ before: [before4.path, before4.nav], after: [after4.path, after4.headAtTop, after4.nav, after4.rows.slice(0, 2)] }));

    // 3. A change taller than the view: the first new file, 160 rows, is read with Alt+Down one view less two rows at a time, with no row passed over;
    // the counter stays on it; then the head of the next file comes to the top and its change is the current one.
    await toPath(modal);
    const startModal = await seen(RIGHT);
    const looks = [startModal];
    for (let at = 0; at < 40 && looks.at(-1).path === modal; at++) {
      await press('Alt+ArrowDown');
      looks.push(await seen(RIGHT));
      if (at === 0) await snap('140-apostil-2-a-long-change-one-view-on');
    }
    const reading = looks.filter((look) => look.path === modal);
    const seenRows = new Set(looks.flatMap((look) => filesOf(look, modal)));
    const modalRows = await rowCount(modal);
    const end2 = looks.at(-1);
    check('a change taller than the view: after one Alt+Down the last two rows of the view before are the first two under the head; every key keeps two rows; every row of the change was in a view; the counter stays on it; then the next file\'s change is the current one with its head at the top',
      reading.length > 3 && reading.slice(1).every((look, index) => keptAtTop(reading[index], look)) && seenRows.size === modalRows && reading.every((look) => look.nav === startModal.nav)
        && end2.path === panelTest && end2.headAtTop === panelTest && changeOf(end2) === changeOf(startModal) + 1,
      JSON.stringify({ keys: looks.length - 1, seen: seenRows.size, rows: modalRows, firstKey: [startModal.last2, looks[1].first2], broken: reading.slice(1).flatMap((look, index) => (keptAtTop(reading[index], look) ? [] : [[index, reading[index].last2, look.first2]])), navs: [...new Set(reading.map((look) => look.nav))], end: [end2.path, end2.nav] }));

    // 4. The same upward: from the head of HoldsPanel.tsx, Alt+Up brings the end of the test file above to the bottom; each key keeps the first two
    // rows of the view before as its last two; every row is read; then the change of the first file is the current one.
    await toPath(panel);
    const up = [await seen(RIGHT)];
    for (let at = 0; at < 30 && up.at(-1).path !== modal; at++) { await press('Alt+ArrowUp'); up.push(await seen(RIGHT)); }
    const upReading = up.filter((look) => look.path === panelTest);
    const upRows = new Set(up.flatMap((look) => filesOf(look, panelTest)));
    const testRows = await rowCount(panelTest);
    const lastRowAtBottom = upReading[0] && upReading[0].rows.at(-1) === `${panelTest}#${testRows - 1}`;
    check('Alt+Up into a long change of the file above brings its last row to the bottom; each key keeps the first two rows of the view before as its last two; every row is read; then the change before is the current one',
      upReading.length > 2 && lastRowAtBottom && upReading.slice(1).every((look, index) => keptUp(upReading[index], look)) && upRows.size === testRows && up.at(-1).path === modal
        && changeOf(up.at(-1)) === changeOf(upReading[0]) - 1,
      JSON.stringify({ keys: up.length - 1, seen: upRows.size, rows: testRows, first: upReading[0]?.rows.slice(-2), broken: upReading.slice(1).flatMap((look, index) => (keptUp(upReading[index], look) ? [] : [[index, upReading[index].first2, look.last2]])), end: [up.at(-1).path, up.at(-1).nav] }));

    // 5. A step whose change is in the view but not at the reading line (a short file): the counter has its number and the left half shows its diagram.
    // a) From the end of the long new file of the service into hold_models.py, whose change lights a state of a hold.
    await toPath(service);
    await one.evaluate((where) => {
      const right = document.querySelector('#view > .half.right');
      const section = right.querySelector(`.dfile[data-file="${where}"]`);
      right.scrollTop += section.getBoundingClientRect().bottom - right.getBoundingClientRect().top - right.clientHeight * 0.66;
    }, service);
    await rested();
    const before5 = await seen(RIGHT);
    await press('Alt+ArrowDown');
    // The left half draws the diagram of the change that the key went to.
    await one.waitForFunction(() => {
      const at = App.diffs.here();
      const titles = thingsAt(App.page.diagrams, at.path, at.section.view.rows, at.focus).map((found) => App.page.diagrams.find((diagram) => diagram.id === found.id).title);
      return titles.length > 0 && [...document.querySelector('#view > .half.left').children].map((el) => el.querySelector('.gt')?.textContent ?? 'change').join() === titles.join();
    }, null, { timeout: 5000 }).catch(() => {});
    const after5 = await seen(RIGHT);
    await snap('140-apostil-5-the-counter-and-the-graph-of-the-change-the-key-went-to');
    // b) In requests.py: its change of 54 rows (long lines wrap in the half) is taller than the view. Each key moves one view less two rows, the change
    // stays the current one while the next is not in the view, and the key that brings the next change into the view makes it the current one, with its number.
    await toPath(tasks);
    for (let at = 0; at < 4 && (await seen(RIGHT)).run < 2; at++) await press('Alt+ArrowDown');
    const longSteps = [await seen(RIGHT)];
    for (let at = 0; at < 12 && longSteps.at(-1).run === 2; at++) { await press('Alt+ArrowDown'); longSteps.push(await seen(RIGHT)); }
    const [start5b, end5b] = [longSteps[0], longSteps.at(-1)];
    check('Alt+Down into hold_models.py: its change is in the view but not at the reading line, the counter has its number, and the diagram half shows its diagram; in requests.py a change taller than the view is read on one view less two rows at a time and stays the current one, and the key that brings the next change into the view makes it the current one with its number',
      before5.path === service && after5.path === models && after5.run === 0 && Math.abs(after5.off) > 2 && changeOf(after5) === changeOf(before5) + 1
        && after5.titles.length > 0 && after5.cards.join() === after5.titles.join() && after5.cards.join() !== before5.cards.join()
        && start5b.path === tasks && start5b.run === 2 && longSteps.length > 2 && longSteps.slice(1, -1).every((look, index) => look.run === 2 && keptAtTop(longSteps[index], look))
        && end5b.path === tasks && end5b.run === 3 && changeOf(end5b) === changeOf(start5b) + 1 && longSteps.slice(1, -1).every((look) => look.nav === start5b.nav),
      JSON.stringify({ models: { before: [before5.path, before5.nav, before5.cards], after: [after5.path, after5.off, after5.nav, after5.cards, after5.lit] }, requests: { keys: longSteps.length - 1, runs: longSteps.map((look) => look.run), offs: longSteps.map((look) => look.off), navs: [start5b.nav, end5b.nav] } }));

    // 6. Two keys with no wait between them end where two keys with a wait end: a second key while the list glides counts from where the glide ends.
    await toPath(worker2);
    await press('Alt+ArrowDown', 'Alt+ArrowDown');
    const quick = await seen(RIGHT);
    await toPath(worker2);
    await press('Alt+ArrowDown');
    await press('Alt+ArrowDown');
    const slow = await seen(RIGHT);
    check('two keys with no wait between them end where two keys with a wait end: the same rows in the view and the same change',
      quick.path === slow.path && quick.run === slow.run && slow.run === 2 && Math.abs(quick.top - slow.top) <= 2 && quick.rows.join() === slow.rows.join(), JSON.stringify({ quick: [quick.run, quick.top], slow: [slow.run, slow.top] }));

    // 7. "Diffs": the file beside the list, the file alone ("Hide files"), and a narrow tab: the same counter, and Alt+Down in the file
    // lands as on "Diagram": the same change of night_jobs.py, its first row at the reading line of the file.
    await toPath(worker2);
    await press('Alt+ArrowDown');
    const beside = await seen(RIGHT);
    const FILE = '#view > .file-left .cv';
    const landIn = async () => { await toPath(worker2); await pressIn(FILE, 'Alt+ArrowDown'); return seen(FILE); };
    await showIn({ view: 'diffs' });
    const withList = await landIn();
    await redrawn(() => one.evaluate(() => Split.setHidden('files', true)));
    const hidden = await landIn();
    await redrawn(() => one.evaluate(() => Split.setHidden('files', false)));
    await redrawn(() => one.setViewportSize({ width: 900, height: 900 }));
    const narrow = await landIn();
    await redrawn(() => one.setViewportSize({ width: 1400, height: 900 }));
    const same = (look) => look.path === beside.path && look.run === beside.run && Math.abs(look.off) <= 2 && look.nav === beside.nav;
    check('"Diffs" beside its list, alone with the list hidden, and on a narrow tab has the same counter, and Alt+Down in the file lands as on "Diagram": the same change, its first row at the reading line',
      beside.path === worker2 && beside.run === 1 && /^‹file 10 of 40›↑change \d+ of 79↓$/.test(beside.nav) && same(withList) && same(hidden) && same(narrow),
      JSON.stringify({ beside: [beside.run, beside.off, beside.nav], withList: [withList.run, withList.off, withList.nav], hidden: [hidden.run, hidden.off, hidden.nav], narrow: [narrow.run, narrow.off, narrow.nav] }));

    // 8. The file beside the diagram of a part, and the file tab: Alt+Down lands by the same rule.
    await showIn({ level: 'part', part: 'hold-service', diagram: 'offer-flow' });
    await one.mouse.move(6, 880);
    const beforePart = await seen(RIGHT);
    await press('Alt+ArrowDown');
    const afterPart = await seen(RIGHT);
    await one.goto(`file://${pageFile}?file=${worker2}`);
    await one.waitForFunction(() => (window.apostilRendered ?? 0) >= 1 && /change \d+ of/.test(document.querySelector('.cvw .nav')?.textContent ?? ''), null, { timeout: 15000 });
    await frames();
    const beforeTab = await seen('.cv');
    await pressIn('.cv', 'Alt+ArrowDown');
    const afterTab = await seen('.cv');
    check('beside the diagram of a part Alt+Down steps through its file by the same rule (its one long change moves one view less two rows, under the head of the file); in a file tab it brings the next change to the reading line with the last two rows of the view before still in the view, and the counter follows',
      beforePart.rows.length > 20 && afterPart.top > beforePart.top && keptAtTop(beforePart, afterPart) && afterPart.path === service
        && beforeTab.run === 0 && Math.abs(beforeTab.off) <= 20 && afterTab.run === 1 && Math.abs(afterTab.off) <= 2 && keptIn(beforeTab, afterTab)
        && /change 1 of 4/.test(beforeTab.nav) && /change 2 of 4/.test(afterTab.nav),
      JSON.stringify({ part: { before: [beforePart.top, beforePart.last2], after: [afterPart.top, afterPart.first2] }, tab: { before: [beforeTab.run, beforeTab.off, beforeTab.nav], after: [afterTab.run, afterTab.off, afterTab.nav] } }));
    await one.close();
  };

  // ----- "Diagram" with the diffs and the graph that follows, "Diffs" with the list and the file, and the sides -----
  // Each check reads what is in the view: the rows drawn, the cards, the lit things.
  const fileRound = async () => {
    const one = await examplePage();
    const { press: pressIn, rested, toPath, showIn, redrawn, still, frames } = waitsOf(one);
    const snap = (picture) => takePicture(one, `${picture}.png`);
    const FILE = '#view > .file-left .cv';
    // The two halves of "Diagram" now: what stands at the left and at the right, the counter, the current change.
    const halves = () => one.evaluate(() => {
      const left = document.querySelector('#view > .half.left');
      const right = document.querySelector('#view > .half.right, #view > .alone');
      const at = App.diffs?.here();
      return {
        left: left ? (left.classList.contains('file-left') ? 'file' : 'graph') : 'none',
        cards: [...(left?.children ?? [])].map((el) => el.querySelector('.gt')?.textContent ?? (el.classList.contains('gchange') ? 'change' : el.className)),
        lit: left?.querySelectorAll('.stage .joined').length ?? 0,
        here: [...(left?.querySelectorAll('g.node.here') ?? [])].map((g) => g.querySelector('b[data-part]')?.dataset.part ?? 'no-part'),
        fileLit: [...(left?.querySelectorAll('.f.lit') ?? [])].map((line) => line.dataset.file ?? line.textContent),
        open: right?.querySelectorAll('.dfile.open').length ?? 0, shut: right?.querySelectorAll('.dfile.shut').length ?? 0,
        nav: document.querySelector('#tabs .nav')?.textContent ?? '', tabs: document.querySelector('.dctl')?.textContent ?? '',
        path: at?.path ?? '', run: at?.run ?? -2,
      };
    });
    const cardsAre = (text) => one.waitForFunction((want) => [...document.querySelector('#view > .half.left').children].map((el) => el.querySelector('.gt')?.textContent ?? 'change').join() === want, text, { timeout: 5000 }).catch(() => {});
    await one.waitForFunction(() => /79 changes|change \d+ of/.test(document.querySelector('#tabs .nav')?.textContent ?? ''));

    // 1. "Diagram" at first: the diagram of the change at the right, the closed list at the left; "Open all" and the counter. Alt+Down from the top opens the
    // diff of the first changed file; that file is in no diagram, so the diagram of the change marks its part and lights its line. A step into night_jobs.py:
    // the sequence of the night run, with its things lit.
    const first = await halves();
    await pressIn('#view > .half.right', 'Alt+ArrowDown');
    await one.waitForSelector('#view > .half.left g.node.here', { timeout: 5000 }).catch(() => {});
    const key1 = await halves();
    await toPath('src/library/night_jobs.py');
    await pressIn('#view > .half.right', 'Alt+ArrowDown');
    await pressIn('#view > .half.right', 'Alt+ArrowUp');
    await cardsAre('The night run, message by message');
    const inNight = await halves();
    await snap('150-apostil-3-diagram-the-graph-follows-the-key');
    check('"Diagram" starts with every diff closed at the left and the diagram of the change at the right, "Open all" over the list and the counter in the line of tabs; Alt+Down from the top opens the diff of the first changed file, says "change 1", and the diagram of the change marks its part and lights its line; a step to the first change of night_jobs.py shows the sequence of the night run with the things of that change lit',
      first.left === 'graph' && first.cards.join() === 'change' && first.open === 0 && first.shut > 20 && /Open all/.test(first.tabs) && /79 changes/.test(first.nav)
        && key1.path === 'web/src/member/HoldDialog.tsx' && key1.run === 0 && key1.open === 1 && /change 1 of 79/.test(key1.nav) && key1.cards.join() === 'change' && key1.here.join() === 'holds-tab' && key1.fileLit.join() === 'web/src/member/HoldDialog.tsx'
        && inNight.path === 'src/library/night_jobs.py' && inNight.run === 0 && inNight.cards.join() === 'The night run, message by message' && inNight.lit > 0,
      JSON.stringify({ first, key1, inNight }));

    // 2. "Close all" closes every diff and the left shows the diagram of the change; the pointer that rests on a node opens the diffs of its part and brings
    // them to the top, and the left does not follow that scroll.
    // "Open all" opens every diff and says "Close all"; a diff far down is filled only when it comes near the view.
    const allShut = async () => {
      await one.click('[data-all="close"]');
      await one.waitForFunction(() => !document.querySelector('#view > .half.right .dfile.open') && document.querySelector('[data-all]')?.textContent === 'Open all');
      await cardsAre('change');
    };
    await allShut();
    const closed = await halves();
    const node = await one.locator('.half.left b[data-part="night-job"]').boundingBox();
    await one.mouse.move(node.x + node.width / 2, node.y + node.height / 2, { steps: 4 });
    await one.waitForSelector('#view > .half.right .dfile.open', { timeout: 5000 }).catch(() => {});
    // The list glides the part to the top, then rests: the left could follow only then.
    await one.waitForFunction(() => {
      const right = document.querySelector('#view > .half.right');
      const title = right.querySelector('.dp[data-part="night-job"]');
      return !!title && Math.abs(title.getBoundingClientRect().top - right.getBoundingClientRect().top) <= 2;
    }, null, { timeout: 5000 }).catch(() => {});
    await rested();
    const pointed = await halves();
    await one.mouse.move(6, 880, { steps: 2 });
    await allShut(); // the diffs that the pointer opened: the control says "Close all" while one is open
    await one.click('[data-all="open"]');
    await one.waitForFunction(() => document.querySelector('[data-all]')?.textContent === 'Close all' && !document.querySelector('#view .dfile.shut:not(.quiet)'));
    const far = await one.evaluate(async () => {
      const right = document.querySelector('#view > .half.right');
      right.scrollTop = 0;
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const open = [...right.querySelectorAll('.dfile.open:not(.quiet)')];
      const last = open.at(-1);
      const before = { open: open.length, all: right.querySelectorAll('.dfile:not(.quiet)').length, filled: !!last.view };
      right.scrollTop += last.getBoundingClientRect().top - right.getBoundingClientRect().top;
      for (let at = 0; at < 100 && !last.view; at++) await new Promise((done) => requestAnimationFrame(done)); // until it is filled
      return { ...before, filledNear: !!last.view, control: document.querySelector('[data-all]').textContent };
    });
    check('"Close all" closes every diff and the left shows the diagram of the change; the pointer that rests on a node opens the diffs of its part, and the left does not follow; "Open all" opens every diff of the list and says "Close all"; a diff far down is filled only when it comes near the view',
      closed.cards.join() === 'change' && closed.open === 0 && /Open all/.test(closed.tabs) && pointed.open > 0 && pointed.cards.join() === 'change'
        && far.open === far.all && !far.filled && far.filledNear && far.control === 'Close all',
      JSON.stringify({ closed: [closed.cards, closed.open], pointed: [pointed.cards, pointed.open, pointed.path], far }));

    // 3. The name of a part stays at the top while its files scroll, with the head of the file in view under it.
    const stuck = await one.evaluate(async () => {
      const right = document.querySelector('#view > .half.right');
      const third = right.querySelectorAll('.dgroup')[2];
      const section = third.querySelectorAll('.dfile')[0];
      // The diffs above fill as they come near, and move it: scroll again until it stays 120 px under the top for two rounds.
      for (let at = 0, calm = 0; at < 30 && calm < 2; at++) {
        const off = section.getBoundingClientRect().top - right.getBoundingClientRect().top + 120;
        calm = Math.abs(off) < 1 ? calm + 1 : 0;
        right.scrollTop += off;
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      }
      const box = right.getBoundingClientRect();
      const name = document.elementFromPoint(box.left + 30, box.top + 6)?.closest('.dp');
      const head = document.elementFromPoint(box.left + 30, (name?.getBoundingClientRect().bottom ?? box.top) + 6)?.closest('.dh');
      return { part: third.querySelector('.dp').textContent, name: name?.textContent ?? '', head: head?.closest('.dfile')?.dataset.file ?? '', file: section.dataset.file, joined: name && head ? Math.round(head.getBoundingClientRect().top - name.getBoundingClientRect().bottom) : null };
    });
    check('the list scrolled into the files of the third part: the name of that part stands at the top of the list, and the head of the file in view right under it',
      stuck.name === stuck.part && stuck.head === stuck.file && Math.abs(stuck.joined) <= 1, JSON.stringify(stuck));
    await snap('150-apostil-4-the-name-of-a-part-stays-at-the-top');

    // ----- "Diffs": the list of the files as closed rows at the left, the file with its notes at the right -----
    // What "Diffs" shows now: the file, the list, the marked row, the counter, the place of each half, and the rows of the file in its view.
    const diffsNow = () => one.evaluate(() => {
      const file = document.querySelector('#view > .file-left');
      const list = document.querySelector('#view > .half.right');
      const cv = file?.querySelector('.cv');
      const row = list?.querySelector('.dfile.here');
      const at = App.diffs?.here();
      const box = cv?.getBoundingClientRect();
      const head = cv?.querySelector('.fh')?.getBoundingClientRect().bottom ?? box?.top;
      const drawn = [...(cv?.querySelectorAll('.rowsbox [data-row]') ?? [])].map((el) => ({ row: Number(el.dataset.row), rect: el.getBoundingClientRect() })).filter(({ rect }) => rect.height > 0);
      const visible = drawn.filter(({ rect }) => rect.top + rect.height / 2 >= head && rect.top + rect.height / 2 <= box.bottom).map(({ row }) => row);
      const rect = (el) => el?.getBoundingClientRect();
      return {
        file: file?.querySelector('.fh a')?.textContent ?? '', cards: file?.querySelectorAll('.mc').length ?? 0, marks: file?.querySelectorAll('.mk').length ?? 0,
        alone: !!document.querySelector('#view > .alone.file-left'), list: !!list, rows: list?.querySelectorAll('.dfile').length ?? 0,
        opened: list?.querySelectorAll('.dfile.open, .dbody, .cn').length ?? 0, twisties: [...(list?.querySelectorAll('.tw') ?? [])].length,
        here: row?.dataset.file ?? '', hereInView: !!row && rect(row).top >= rect(list).top - 1 && rect(row).bottom <= rect(list).bottom + 1,
        nav: document.querySelector('#tabs .nav')?.textContent ?? '', tabs: `${document.querySelector('#tabs')?.textContent ?? ''} ${document.querySelector('.dctl')?.textContent ?? ''}`, // "Hide files" stands over the list
        hideOverList: (() => { const hide = document.querySelector('.dctl [data-half="files"]')?.getBoundingClientRect(); const head = document.querySelector('#view .half.right .dp')?.getBoundingClientRect(); return !!hide && !!head && Math.abs((hide.top + hide.height / 2) - (head.top + head.height / 2)) <= 3 && hide.right <= head.right + 1; })(),
        path: at?.path ?? '', run: at?.run ?? -2, runs: at?.section?.view ? changeRuns(at.section.view.rows).length : 0,
        visible, top: cv ? Math.round(cv.scrollTop) : 0,
        widths: [rect(list)?.width ?? 0, rect(file)?.width ?? 0].map(Math.round), xs: [rect(list)?.left ?? 0, rect(file)?.left ?? 0].map(Math.round),
      };
    });
    const changeOf = (look) => Number(/change (\d+) of/.exec(look.nav)?.[1] ?? 0);
    const press = (...keys) => pressIn(FILE, ...keys);
    // The file reads: no card over the code, no text cut off or sideways, and room for at least 40 columns of code.
    const fileReads = () => one.evaluate(() => {
      const file = document.querySelector('#view > .file-left');
      const boxes = (selector) => [...file.querySelectorAll(selector)].map((el) => el.getBoundingClientRect()).filter((box) => box.height > 0);
      const code = boxes('.cn .code .x');
      const over = boxes('.mc').some((card) => code.some((row) => card.left < row.right - 1 && card.right > row.left + 1 && card.top < row.bottom && card.bottom > row.top));
      const box = file.querySelector('.rowsbox');
      const textRight = (x) => { const range = document.createRange(); range.selectNodeContents(x); return Math.max(0, ...[...range.getClientRects()].map((rect) => rect.right)); };
      const cut = [...file.querySelectorAll('.rowsbox .x')].filter((x) => textRight(x) > box.getBoundingClientRect().right + 1).length;
      const sideways = [...file.querySelectorAll('.cv, .code, .rowsbox')].some((el) => el.scrollWidth > el.clientWidth + 1);
      const char = (() => { const x = file.querySelector('.rowsbox .x'); const range = document.createRange(); range.selectNodeContents(x); return range.getBoundingClientRect().width / Math.max(1, x.textContent.length); })();
      const columns = Math.floor((file.querySelector('.rowsbox .x')?.clientWidth ?? 0) / (char || 7));
      return { ok: !over && !cut && !sideways && columns >= 40, over, cut, sideways, columns };
    });
    // 4. "Diffs" on a wide tab: the narrow list of closed rows at the left, the file with its cards at the right.
    // A long path is cut at its left end, and whole in the tooltip; the row is one line. The longest path of the example is the removed client type.
    await showIn({ view: 'diffs' });
    await toPath(service);
    const wideDiffs = await diffsNow();
    const reads = await fileReads();
    const longFile = 'web/src/api/generated/model/reservation.ts';
    const longPath = await one.evaluate((file) => {
      const head = document.querySelector(`#view > .half.right .dfile[data-file="${file}"] .dh`);
      const [dir, name, counts] = ['.dir', '.nm', '.c'].map((selector) => head.querySelector(selector));
      const range = document.createRange();
      range.selectNodeContents(dir);
      return {
        title: head.title, name: name.textContent, nameWhole: name.scrollWidth <= name.clientWidth + 1, cut: dir.scrollWidth > dir.clientWidth + 1,
        endShows: Math.abs(range.getBoundingClientRect().right - dir.getBoundingClientRect().right) <= 2, // the end of the folder, next to the name, shows
        oneLine: Math.round(head.getBoundingClientRect().height) < 2 * parseFloat(getComputedStyle(head).lineHeight), counts: counts.textContent,
      };
    }, longFile);
    check('"Diffs" on a wide tab: the list of closed rows at the left, 260 to 340 px wide, with no row open, no small mark and no code; the file at the right with its notes as cards, readable; no "Open all"; a long path in the list is cut at its left end with its name whole, the whole path in the tooltip, on one line with its counts',
      wideDiffs.list && wideDiffs.xs[0] < wideDiffs.xs[1] && wideDiffs.widths[0] >= 260 && wideDiffs.widths[0] <= 340 && wideDiffs.rows > 20 && wideDiffs.opened === 0 && wideDiffs.twisties === 0
        && wideDiffs.file === service && wideDiffs.cards > 0 && reads.ok && /Hide files/.test(wideDiffs.tabs) && !/Open all|Close all/.test(wideDiffs.tabs)
        && longPath.title === longFile && longPath.name === 'reservation.ts' && longPath.nameWhole && longPath.cut && longPath.endShows && longPath.oneLine && /−30/.test(longPath.counts),
      JSON.stringify({ widths: wideDiffs.widths, xs: wideDiffs.xs, rows: wideDiffs.rows, opened: wideDiffs.opened, cards: wideDiffs.cards, reads, tabs: wideDiffs.tabs, longPath }));
    console.log(`NOTE  "Diffs" at 1400 px: the list ${wideDiffs.widths[0]} px, the file ${wideDiffs.widths[1]} px (${wideDiffs.cards ? 'cards' : 'marks'}, ${reads.columns} columns of code)`);
    await snap('150-apostil-5-diffs-the-list-and-the-file-with-cards');

    // 5. The row of the file is marked. Alt+Down through the last change of night_jobs.py: ready_shelf.py shows at its first change, its row is marked and in
    // view, and the counter moves by one. Alt+Down in the long new file HoldDialog.tsx moves one view less two rows; Alt+Up from the first change of
    // ready_shelf.py shows the last change of night_jobs.py.
    await toPath(worker2);
    let lastOfWorker = await diffsNow();
    for (let at = 0; at < 8 && lastOfWorker.run < lastOfWorker.runs - 1; at++) { await press('Alt+ArrowDown'); lastOfWorker = await diffsNow(); }
    await press('Alt+ArrowDown');
    const intoPack = await diffsNow();
    await toPath(modal);
    const longBefore = await diffsNow();
    await press('Alt+ArrowDown');
    const longAfter = await diffsNow();
    const lastTwo = longBefore.visible.slice(-2);
    await toPath(pack);
    const packFirst = await diffsNow();
    await press('Alt+ArrowUp');
    const backInWorker = await diffsNow();
    check('on "Diffs" the row of the file is marked; Alt+Down after the last change of night_jobs.py shows ready_shelf.py at its first change, marks its row in view, and the counter moves by one; Alt+Down in a long new file keeps the last two rows of the view before in the view; Alt+Up from the first change of a file shows the last change of the file before',
      lastOfWorker.here === worker2 && lastOfWorker.path === worker2 && intoPack.path === pack && intoPack.file === pack && intoPack.run === 0 && intoPack.here === pack && intoPack.hereInView
        && changeOf(intoPack) === changeOf(lastOfWorker) + 1 && /file 11 of 40/.test(intoPack.nav)
        && longBefore.path === modal && longAfter.top > longBefore.top && lastTwo.length === 2 && lastTwo.every((row) => longAfter.visible.slice(0, 3).includes(row)) && longAfter.path === modal
        && packFirst.run === 0 && backInWorker.path === worker2 && backInWorker.file === worker2 && backInWorker.run === backInWorker.runs - 1 && backInWorker.here === worker2,
      JSON.stringify({ last: [lastOfWorker.path, lastOfWorker.run, lastOfWorker.runs, lastOfWorker.nav], into: [intoPack.path, intoPack.run, intoPack.here, intoPack.hereInView, intoPack.nav],
        long: [longBefore.top, lastTwo, longAfter.top, longAfter.visible.slice(0, 3)], up: [packFirst.path, packFirst.run, backInWorker.path, backInWorker.run, backInWorker.runs] }));

    // 6. J and K; a click on a row; a file that comes back at the place where he left it.
    await press('j');
    const afterJ = await diffsNow();
    await press('k');
    const afterK = await diffsNow();
    await one.evaluate(() => { const cv = document.querySelector('#view > .file-left .cv'); cv.scrollTop = Math.round(cv.scrollHeight / 2); });
    await frames();
    const leftAt = await diffsNow();
    const clickRow = async (file) => {
      await one.click(`#view > .half.right .dfile[data-file="${file}"] .dh`);
      await one.waitForFunction((want) => document.querySelector('#view > .file-left .fh a')?.textContent === want && document.querySelector('#view > .file-left .rowsbox [data-row]'), file, { timeout: 5000 });
      await frames();
    };
    await clickRow(service);
    const clicked = await diffsNow();
    await clickRow(worker2);
    const cameBack = await diffsNow();
    check('on "Diffs" J shows the next file and K the one before, each at its first change; a click on a row shows its file; a file comes back at the place where he left it',
      afterJ.file === pack && afterJ.run === 0 && afterK.file === worker2 && afterK.run === 0 && clicked.file === service && clicked.here === service
        && cameBack.file === worker2 && Math.abs(cameBack.top - leftAt.top) <= 1 && leftAt.top > 0,
      JSON.stringify({ j: [afterJ.file, afterJ.run], k: [afterK.file, afterK.run], clicked: clicked.file, back: [leftAt.top, cameBack.top] }));

    // 7. "Hide files" and "Show files"; the narrow tab.
    const withSide = await diffsNow();
    const sideReads = await fileReads();
    console.log(`NOTE  "Diffs" at 1400 px: the list ${withSide.widths[0]} px, the file ${withSide.widths[1]} px (${withSide.cards ? 'cards' : 'marks'})`);
    await redrawn(() => one.click('.dctl .codeswitch[data-half="files"]'));
    const hidden = await diffsNow();
    await redrawn(() => one.click('#tabs .codeswitch[data-half="files"]'));
    const shownAgain = await diffsNow();
    check('"Hide files" stands over the list at the right end of the line of its first group head, as "Hide code" over the code; "Show files" then stands at the left of the line above the file',
      withSide.hideOverList && !!hidden && /Show files/.test(hidden.tabs) && shownAgain.hideOverList, JSON.stringify({ over: withSide.hideOverList, hidden: hidden?.tabs, again: shownAgain.hideOverList }));
    await redrawn(() => one.setViewportSize({ width: 900, height: 900 }));
    const narrow = await diffsNow();
    await redrawn(() => one.setViewportSize({ width: 1400, height: 900 }));
    check(`"Diffs" at 1400 px: the list at the left and the file at the right, readable, its notes as ${withSide.cards ? 'cards' : 'marks'}; "Hide files" leaves the file alone with the counter, "Show files" brings the list back, and a narrow tab has the file alone; the file stays the same`,
      withSide.list && withSide.xs[0] < withSide.xs[1] && withSide.file !== '' && (withSide.cards > 0 || withSide.marks > 0) && sideReads.ok
        && hidden.alone && !hidden.list && /Show files/.test(hidden.tabs) && /change/.test(hidden.nav) && hidden.file === withSide.file && shownAgain.list && /Hide files/.test(shownAgain.tabs)
        && narrow.alone && !narrow.list && !/Hide files/.test(narrow.tabs) && /file \d+ of 40/.test(narrow.nav),
      JSON.stringify({ withSide: { widths: withSide.widths, cards: withSide.cards, marks: withSide.marks, sideReads }, hidden: [hidden.alone, hidden.list, hidden.tabs, hidden.file], shownAgain: [shownAgain.list], narrow: [narrow.alone, narrow.tabs, narrow.nav] }));

    // ----- The sides: the list or the code at the left, the diagram or the file at the right, on all three pages -----
    const sides = () => one.evaluate(() => {
      const [left, right] = ['#view > .half.left', '#view > .half.right'].map((selector) => document.querySelector(selector)?.getBoundingClientRect());
      return left && right ? { code: Math.round(right.left), other: Math.round(left.left), widths: [Math.round(right.width), Math.round(left.width)] } : null;
    });
    await showIn({ view: 'diffs' });
    const diffsSides = await sides();
    await showIn({ level: 'change' });
    const changeSides = await sides();
    const changeKinds = await one.evaluate(() => ({ list: !!document.querySelector('#view > .half.right .diffs'), diagram: !!document.querySelector('#view > .half.left .stage, #view > .half.left .surface') }));
    await showIn({ level: 'part', part: 'hold-service', diagram: 'offer-flow' });
    const partSides = await sides();
    const thing = await one.locator('#view > .half.left g.node', { hasText: 'Select the returned copies' }).first().boundingBox();
    await one.mouse.move(thing.x + thing.width / 2, thing.y + thing.height / 2, { steps: 4 });
    // The thing lights its rows and draws the line; its rows come into view with a glide, and the line follows the scroll.
    await one.waitForSelector('#view svg.join path', { timeout: 5000 }).catch(() => {});
    await still('#view > .half.right');
    const line = await one.evaluate(() => {
      const path = document.querySelector('#view svg.join path');
      if (!path) return null;
      const numbers = path.getAttribute('d').match(/-?[\d.]+/g).map(Number);
      const base = document.getElementById('view').getBoundingClientRect();
      const [file, diagram] = ['#view > .half.right', '#view > .half.left'].map((selector) => document.querySelector(selector).getBoundingClientRect());
      const box = document.querySelector('#view > .half.right .rowsbox').getBoundingClientRect();
      const lit = [...document.querySelectorAll('#view > .half.right .l.step')].map((row) => row.getBoundingClientRect());
      const [x1, y1, x2, y2] = [numbers[0] + base.left, numbers[1] + base.top, numbers.at(-2) + base.left, numbers.at(-1) + base.top];
      return {
        startsInDiagram: x1 >= diagram.left - 1 && x1 <= diagram.right + 1, endsInFile: x2 >= file.left && x2 <= file.right + 1 && x2 >= box.right - 2,
        atRows: lit.length > 0 && y2 >= lit[0].top - 1 && y2 <= lit.at(-1).bottom + 1, lit: lit.length,
      };
    });
    await snap('150-apostil-14-sides-of-the-page-of-a-part');
    await one.mouse.move(6, 880);
    check('the sides: on "Diffs" the list is left of the file; on "Diagram" the list of diffs is left of the diagram, the two halves of equal width; on the page of a part the file is left of the diagram, and the line from a thing in the diagram at the right ends at its rows in the file at the left',
      !!diffsSides && diffsSides.code < diffsSides.other && !!changeSides && changeSides.code < changeSides.other && Math.abs(changeSides.widths[0] - changeSides.widths[1]) <= 1
        && changeKinds.list && changeKinds.diagram && !!partSides && partSides.code < partSides.other && !!line && line.startsInDiagram && line.endsInFile && line.atRows,
      JSON.stringify({ diffsSides, changeSides, changeKinds, partSides, line }));
    await one.close();
  };

  await stepRound();
  await fileRound();
} catch (error) {
  check('the checks ran to the end', false, error.message.split('\n').slice(0, 14).join(' / '));
}
await finish();
