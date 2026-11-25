// The browser check of marks and the look of a repo, the themes of VS Code, the schema and notebooks. A group of view/browser-check.mjs, which runs every group at the same time; alone:
//   node view/browser/looks.mjs [--pictures] [<folder for pictures>]
// The theme rounds are the one place that proves colours and readable text in each theme; the other rounds run once, in the look "Apostil".

import { fileURLToPath } from 'node:url';
import { lookOfPage, THEMES, wearTheme } from '../theme-look.mjs';
import { madeUpDiagrams } from './made-up.mjs';
import { check, errors, FILES_HIDDEN_KEY, finish, HIDDEN_KEY, listFile, openPage, own, pageFile, takePicture } from './tools.mjs';

const { partDiagram } = own('../out/shared/page-data.js');
const homeFile = fileURLToPath(new URL('../media/home.html', import.meta.url));

/** Waits until no transition or animation that ends still runs: what is drawn has its last colours and places. A pulse that never ends does not count. */
const calm = (page) => page.waitForFunction(() => document.getAnimations().every((one) => one.effect?.getComputedTiming().iterations === Infinity), null, { timeout: 5000 });
/** Waits two frames: a scroll set by a script has drawn its rows. */
const frames = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
/** Moves the pointer to the middle of the first element of a selector. */
const pointAt = async (page, selector) => { const at = await page.locator(selector).first().boundingBox(); await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2, { steps: 4 }); };
/** Scrolls the list of diffs at the right until the head of a file stands `down` px under its top; files fill as they come near, so it scrolls again until the place holds. */
const toFile = (page, file, down) => page.evaluate(() => { window.heldScroll = 0; }).then(() => page.waitForFunction(([where, offset]) => {
  const right = document.querySelector('.half.right');
  const section = right.querySelector(`.dfile[data-file="${where}"]`);
  const off = section.getBoundingClientRect().top - right.getBoundingClientRect().top - offset;
  const before = right.scrollTop;
  if (Math.abs(off) >= 2) right.scrollTop += off;
  window.heldScroll = Math.abs(off) < 2 || right.scrollTop === before ? window.heldScroll + 1 : 0; // at its place, or at the end of the list
  return window.heldScroll >= 3;
}, [file, down], { polling: 100, timeout: 10000 }));
/** A page with the code beside a diagram and the list of files shown, in a theme of VS Code or (with none) in the look "Apostil". */
const shownPage = async (theme) => {
  const one = await openPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  await one.addInitScript((keys) => { try { for (const key of keys) localStorage.setItem(key, '0'); } catch { /* no storage */ } }, [HIDDEN_KEY, FILES_HIDDEN_KEY]);
  if (theme) await one.addInitScript(wearTheme, theme);
  one.on('pageerror', (error) => errors.push(error.message));
  one.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return one;
};
/** Waits for the first drawing of a page that was just loaded. */
const drawn = (page) => page.waitForFunction(() => (window.apostilRendered ?? 0) >= 1, null, { timeout: 15000 });
/** Goes to a view of the change page and waits until it is drawn. */
const go = (page, place) => page.evaluate(async (to) => { await App.go(to); }, place);

// A made-up change to notebooks (view/example-notebook.ts), put into the page of the example.
const { notebookExample } = own('../out/view/example-notebook.js');
const notebook = notebookExample();
const FEES = 'notebooks/fees.ipynb';
const addNotebooks = (page) => page.evaluate(({ page: added, answers }) => {
  Object.assign(window.APOSTIL_EXAMPLE.answers, answers);
  App.page.files.push(...added.files);
  App.page.parts.push(...added.parts);
  App.page.notes.push(...added.notes);
  App.page.diagrams.push(...added.diagrams);
}, notebook);

try {
  // ----- marks and the look of a repo -----
  // The made-up example has services at lines of its code and a look with neutral rules; "?look=1" shows the look, else the default look applies.
  {
    const one = await openPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
    one.on('pageerror', (error) => errors.push(error.message));
    const drawnAt = async (file, query) => { await one.goto(`file://${file}${query}`); await drawn(one); };
    const sent = () => one.evaluate(() => window.apostilSent.at(-1));
    const node = (key) => `#view :is(g.node, g.image-shape)[id*="flowchart-${key}-"]`;
    // The default look: the logos of the services at the upper right of the nodes whose code reaches a service, and nothing else changed;
    // a diagram that a look does not touch is drawn exactly as with no look.
    const plainSvg = async (query, noLook = false) => {
      await drawnAt(homeFile, query);
      await one.evaluate(async (none) => { if (none) delete Home.data.look; await Home.render(); }, noLook); // each drawn a second time, as the one with no look is
      return one.evaluate(() => document.querySelector('#view svg').outerHTML.replace(/apostil-s?\d+/g, 'apostil'));
    };
    // The areas of the member page hold no mark: the default draws them as with no look. The tables hold marks, and no rule of the look names them.
    const [none, byDefault] = [await plainSvg('?diagram=member-areas', true), await plainSvg('?diagram=member-areas')];
    const [tablesByDefault, byLook] = [await plainSvg('?diagram=lib-tables'), await plainSvg('?look=1&diagram=lib-tables')];
    await drawnAt(homeFile, '');
    const plain = await one.evaluate(() => ({
      stacks: [...document.querySelectorAll('#view .mk-stack')].map((stack) => `${nodeKey(stack.closest('g'))}:${stack.querySelectorAll('.mk-chip').length}${stack.querySelector('.mk-more')?.textContent ?? ''}`).sort(),
      changed: document.querySelectorAll('#view [class*="lk-"]').length,
      // "+1" is one more chip, which looks like one more service: as tall, round, overlapping the last chip and behind it, with its text clear of that chip.
      more: (() => {
        const more = document.querySelector('#view .mk-more'), chip = more?.previousElementSibling;
        const [m, c] = [more?.getBoundingClientRect(), chip?.getBoundingClientRect()];
        if (!m || !c) return null;
        const y = (c.top + c.bottom) / 2, x = (m.left + c.right) / 2, top = document.elementFromPoint(x, y);
        const text = document.createRange(); text.selectNodeContents(more);
        return { tall: Math.abs(m.height - c.height) <= 0.5, round: parseFloat(getComputedStyle(more).borderRadius) >= more.offsetHeight / 2 - 0.5, /* in its own size: the overview draws a small map larger */ overlaps: m.left < c.right - 1, middle: Math.abs((m.top + m.bottom) - (c.top + c.bottom)) <= 1,
          behind: !!top && chip.contains(top), clear: text.getBoundingClientRect().left >= c.right };
      })(),
    }));
    check('the default look: the logos of the services stand at the upper right of each node whose code reaches them, at most 3 then "+1" as one more chip of the same size and form, behind the third, and nothing else changes; a diagram that the look does not touch is drawn exactly as with no look',
      plain.stacks.join() === 'data:1,jobs:3+1,lending:3' && plain.more?.tall && plain.more.round && plain.more.overlaps && plain.more.middle && plain.more.behind && plain.more.clear && plain.changed === 0 && none === byDefault && tablesByDefault === byLook, JSON.stringify({ ...plain, same: [none === byDefault, tablesByDefault === byLook] }));

    // Each slot of the example look, in the look "Apostil" and in the dark default theme: a colour, a shape, a picture, a button, an arrow and the corner of a second set.
    const slots = {};
    for (const [key, theme] of [['apostil', null], ['dark', THEMES.dark]]) {
      if (theme) await one.addInitScript(wearTheme, theme);
      await drawnAt(homeFile, '?look=1');
      slots[key] = await one.evaluate(() => {
        const at = (key) => document.querySelector(`#view :is(g.node, g.image-shape)[id*="flowchart-${key}-"]`);
        const shape = (g) => g.querySelector('.label-container');
        return {
          fill: getComputedStyle(shape(at('lending'))).fill,
          cylinder: shape(at('data')).tagName === 'path' || !!shape(at('data')).querySelector('path'),
          picture: at('writing').classList.contains('image-shape') && /example-look\/.+\.png$/.test(at('writing').querySelector('image').getAttribute('href')),
          button: !!at('jobs').querySelector('.mk-stack:not(.right) .mk-button'), services: at('jobs').querySelectorAll('.mk-stack.right .mk-chip').length,
          errors: !!at('lending').querySelector('.mk-chip[data-mk^="errors:"]'),
          arrow: [...document.querySelectorAll('#view path.lk-stroke.lk-wide')].map((path) => path.id.replace(/_\d+$/, '')),
        };
      });
      slots[key].low = (await one.evaluate(lookOfPage, !!theme)).normal.low;
      await takePicture(one, `201-look-${key}-home.png`);
    }
    const slotsHold = (seen) => seen.fill !== 'rgb(255, 255, 255)' && seen.cylinder && seen.picture && seen.button && seen.services === 3 && seen.errors && seen.arrow.join() === 'L_jobs_lending' && !seen.low.length;
    check('the look of the example, in the look "Apostil" and in the dark theme: the colour of the lending nodes with words that read, the shape of the database, a picture in place of a node, a button and the logos on the night jobs, the corner of the second set, and one coloured wider arrow',
      slotsHold(slots.apostil) && slotsHold(slots.dark), JSON.stringify(slots));
    // A stack: the pointer spreads it and opens its window with each value, its count of places, what the code does with it and its named things.
    // A value with several places and no level under the node lists them, grouped by named thing; a click on a row opens that file at its line.
    await one.hover(`${node('jobs')} .mk-stack.right .mk-more`);
    await one.waitForSelector('.win .mk-rows', { timeout: 3000 });
    const stackWin = await one.evaluate(() => ({
      spread: getComputedStyle(document.querySelectorAll('#view g[id*="flowchart-jobs-"] .mk-stack.right .mk-chip')[1]).marginLeft,
      title: document.querySelector('.win .tb b').textContent, rows: [...document.querySelectorAll('.win .mk-row')].map((row) => row.textContent.replace(/\s+/g, ' ').trim()),
    }));
    await one.click('.win .mk-row[data-mk-value="services:postgresql"]');
    const places = await one.evaluate(() => ({ groups: [...document.querySelectorAll('.win .mk-rows .gp')].map((gp) => gp.firstChild.textContent.trim()), rows: document.querySelectorAll('.win [data-mk-open]').length }));
    await one.click('.win [data-mk-open][data-mk-line="389"]');
    const fromList = await sent();
    check('the pointer on a stack spreads it and opens its window: each value with its places, what the code does with it and its named things; a value with many places lists them by named thing, and a click on one opens that file at its line',
      stackWin.spread === '2px' && stackWin.title === 'Services' && stackWin.rows.length === 4 && stackWin.rows[3] === 'PostgreSQL11 placeskeeps data in it · loan, book +7'
        && places.groups.length === 9 && places.rows === 11 && fromList?.type === 'openFile' && fromList.path === 'src/library/night_jobs.py' && fromList.line === 389, JSON.stringify({ stackWin, places, fromList }));
    // A value with one place opens it at once; on a node with a level under it, the click goes down with the nodes that hold the value lit and a quiet line.
    await drawnAt(homeFile, '?diagram=lib-lending');
    await one.click(`${node('queue')} .mk-chip[data-mk="services:mail-relay"]`);
    const once = await sent();
    await drawnAt(homeFile, '');
    await one.click(`${node('lending')} .mk-chip[data-mk="services:postgresql"]`);
    await one.waitForFunction(() => window.apostilRendered >= 2, null, { timeout: 5000 });
    const down = await one.evaluate(() => ({ crumb: document.getElementById('crumb').textContent, lit: [...document.querySelectorAll('#view g.node.lit')].map((g) => nodeKey(g)), line: document.querySelector('.mk-filter')?.textContent }));
    await one.click('[data-clear-filter]');
    await one.waitForFunction(() => window.apostilRendered >= 3, null, { timeout: 5000 });
    const cleared = await one.evaluate(() => ({ lit: document.querySelectorAll('#view g.node.lit').length, line: !!document.querySelector('.mk-filter'), crumb: document.getElementById('crumb').textContent }));
    check('a value with one place opens that file at its line at once; on a node with a level under it, the click goes down with the nodes that hold the value lit and the quiet line "<value> · n places in <node> ×", which the × clears',
      once?.type === 'openFile' && once.path === 'src/library/lending/notices.py' && once.line === 35 && down.crumb === 'Home›Lending: holds, requests and mails · PostgreSQL' && down.lit.join() === 'service,requests'
        && down.line === 'PostgreSQL · 27 places in Lending ×' && !cleared.lit && !cleared.line && cleared.crumb === 'Home›Lending: holds, requests and mails', JSON.stringify({ once, down, cleared }));
    // The contents and the button of the look: a picture node opens on a click like any node, a film plays with no sound only on a click, a button does its action.
    // Where cards show, one click on it focuses it as any node; alone (where cards show it has no window) "Open" in its window goes in.
    await drawnAt(homeFile, '?look=1');
    await one.click(node('writing'));
    const pictureFocus = await one.evaluate(() => document.querySelector('#cards .ovc.focused')?.dataset.node ?? '');
    await one.evaluate(() => localStorage.setItem('apostil.diagramFull', '1'));
    await drawnAt(homeFile, '?look=1');
    await one.hover(node('writing'));
    await one.click('.win .tb .act [data-open]', { timeout: 3000 }).catch(() => {});
    const picture = await sent();
    await one.evaluate(() => localStorage.removeItem('apostil.diagramFull'));
    await one.click(`${node('jobs')} .mk-button`);
    const button = await sent();
    await drawnAt(homeFile, '?look=1&diagram=member-areas');
    const still = await one.evaluate((holds) => { const video = document.querySelector('#view video'); return { paused: video.paused, at: video.currentTime, name: document.querySelector(holds).textContent.trim() }; }, node('holds'));
    await one.click('#view .lk-play');
    await one.waitForFunction(() => !document.querySelector('#view video').paused, null, { timeout: 5000 });
    const playing = await one.evaluate(() => ({ muted: document.querySelector('#view video').muted, crumb: document.getElementById('crumb').textContent }));
    check('a picture in place of a node takes a click like any node: one click focuses it and its card, and alone "Open" in its window opens it; a film shows its first frame and plays, with no sound, only on a click, and its play mark is no word of the name of the node; a button opens its file at its line',
      pictureFocus === 'writing' && picture?.type === 'showInTree' && picture.paths.join() === 'docs/,README.md' && button?.type === 'target' && button.target.file === 'src/library/night_jobs.py' && button.target.line === 516
        && still.paused && still.at === 0 && still.name === 'Holds: books to wait for' && playing.muted && playing.crumb === 'Home›The areas of the member page', JSON.stringify({ pictureFocus, picture, button, still, playing }));
    // A service icon shows in one place only:
    // a note has no corner for the services, and the icon of its service line has its middle at the middle of the text, and in the window of a step it starts where the note does.
    /** The icon of the first service line: its middle against the middle of the name beside it, and its left edge. */
    const lineIcon = (el) => {
      const chip = el.querySelector('.mk-line > .mk-chip'), name = chip?.parentElement.querySelector(':scope > b');
      if (!chip || !name) return null;
      const [c, t] = [chip.getBoundingClientRect(), name.getBoundingClientRect()];
      return { off: Math.round(((c.top + c.bottom) / 2 - (t.top + t.bottom) / 2) * 10) / 10, left: c.left, size: c.height };
    };
    await drawnAt(homeFile, `?diagram=${encodeURIComponent('process:answer-request/2')}`);
    await one.hover(`#view g.node[id="${await one.evaluate(() => [...document.querySelectorAll('#view g.node')].find((g) => /Order the book/.test(g.textContent))?.id)}"]`);
    await one.waitForSelector('.win .mk-line', { timeout: 3000 }).catch(() => {});
    const stepWindow = await one.evaluate((lineIconText) => {
      const win = document.querySelector('.win'), note = win?.querySelector('.stepnote');
      if (!win || !note) return null;
      const icon = eval(`(${lineIconText})`)(win);
      return { corners: win.querySelectorAll('.mk-at .mk-chip').length, icon, textLeft: note.getBoundingClientRect().left + parseFloat(getComputedStyle(note).paddingLeft) };
    }, lineIcon.toString());
    // A note in the file tab: its marks at the corners of its set, its colour, one line for its service and its named things as small links.
    await one.goto(`file://${pageFile}?file=src/library/lending/requests.py&look=1`);
    await one.waitForSelector('.mc .mk-lines', { state: 'attached', timeout: 15000 });
    await one.click('[data-fold]', { timeout: 3000 }).catch(() => {});
    await one.evaluate(() => App.showCode('src/library/lending/requests.py', [43, 43]));
    const card = await one.evaluate((lineIconText) => {
      const el = [...document.querySelectorAll('.mc')].find((one) => one.querySelector('.nt')?.textContent === 'Answer the request');
      return { left: el.querySelectorAll('.mk-at.upper-left .mk-chip').length, right: el.querySelectorAll('.mk-at.upper-right .mk-chip').length, bar: el.classList.contains('lk-bar'),
        line: el.querySelector('.mk-line').textContent.replace(/\s+/g, ' ').trim(), links: [...el.querySelectorAll('.mk-links a')].map((link) => link.textContent), icon: eval(`(${lineIconText})`)(el) };
    }, lineIcon.toString());
    await one.evaluate(() => { const show = App.showCode.bind(App); window.shownCode = []; App.showCode = (...asked) => { window.shownCode.push(asked); return show(...asked); }; });
    await one.click('.mc .mk-links a:text-is("librarian")');
    const shown = await one.evaluate(() => window.shownCode);
    check('a note card shows the marks at its lines at the corners of their sets but no corner for the services, the colour of the look, one line for its service with its icon at the left, its middle at the middle of the text, and its named things as links; a click on a link shows that line; the window of a step shows its service icon in its line only, where the text of the note starts',
      card.left === 2 && card.right === 0 && card.icon?.size === 16 && Math.abs(card.icon.off) <= 1
        && stepWindow?.corners === 0 && stepWindow.icon?.size === 16 && Math.abs(stepWindow.icon.off) <= 1 && Math.abs(stepWindow.icon.left - stepWindow.textLeft) <= 1 && card.bar && card.line.startsWith('PostgreSQL · keeps data in it · 7 places') && card.links.join() === 'book_request,librarian,purchase_order,member'
        && JSON.stringify(shown) === '[["src/library/lending/requests.py",[51,51]]]', JSON.stringify({ card, shown, stepWindow }));
    // In a hover window the marks of a note corner stand inside the card, clear of its edge and of its words.
    await drawnAt(homeFile, `?look=1&diagram=${encodeURIComponent('process:answer-request/2')}`);
    await one.hover('#view g.node >> nth=0');
    await one.waitForSelector('.win .mk-at .mk-chip', { timeout: 3000 }).catch(() => {});
    await takePicture(one, '593-note-corner-in-a-window.png');
    const cornered = await one.evaluate(() => {
      const win = document.querySelector('.win')?.getBoundingClientRect();
      const text = document.querySelector('.win .stepnote')?.getBoundingClientRect();
      const chips = [...document.querySelectorAll('.win .mk-at .mk-chip')].map((chip) => chip.getBoundingClientRect());
      return { chips: chips.length, outside: chips.filter((box) => box.left < win.left || box.right > win.right || box.top < win.top || box.bottom > win.bottom).length, overText: chips.filter((box) => box.right > text.left + 12 && box.left < text.right).length };
    });
    check('in a hover window the marks of a corner of a note stand fully inside the window, and not over the words of the note', cornered.chips > 0 && cornered.outside === 0 && cornered.overText === 0, JSON.stringify(cornered));
    await one.close();
  }

  // ----- the pages in the themes of VS Code -----
  // Each kind of page in a theme: the page of a change, the diagrams of a part with a lit and a removed thing, "Diffs" beside its diagram, a notebook on "Diffs",
  // a file tab with notes, Home with a hover window, a process with the note of a step, the page of a pull request with its review panel, and the list.
  // A theme is worn before the scripts of the page start. One check for each theme; its detail names the page that does not read.
  const themeRound = async (key, name) => {
    const dark = key === 'dark' || key === 'hcDark';
    const one = await shownPage(THEMES[key]);
    const seen = {}; // what the eye sees on each kind of page
    /** Reads a kind of page when it is calm; `shows` is false when the page did not reach the state that it is read in (a window, a panel). */
    const look = async (what, shows = true, picture = '') => {
      await calm(one);
      if (picture) await takePicture(one, `90-${key}-${picture}.png`);
      seen[what] = { shows, ...(await one.evaluate(lookOfPage, dark)) };
    };
    await one.goto(`file://${pageFile}`);
    await drawn(one);
    await look('the page of a change with its diagram and its closed diffs', true, '1-change');
    const { shopFlow, shopStates, shopSequence, runEnd } = madeUpDiagrams(await one.evaluate(() => ask('code:src/library/night_jobs.py')));
    await one.evaluate((diagrams) => { App.page.diagrams.push(...diagrams); App.page.parts.find((part) => part.id === 'hold-service').diagrams = diagrams.map((diagram) => diagram.id); }, [shopFlow, shopStates, shopSequence, runEnd]);
    await go(one, { level: 'part', part: 'hold-service', diagram: 'shop-flow', lit: ['pack'] });
    await look('a flow chart with a lit step, a removed step and a removed arrow');
    await go(one, { level: 'part', part: 'hold-service', diagram: 'shop-sequence' });
    await pointAt(one, '.half.left text.messageText.d-add');
    const joined = await one.waitForSelector('.half.left .joined', { timeout: 3000 }).then(() => true, () => false);
    await look('a sequence with a lit message (the pointer on it) and a removed message', joined);
    await one.mouse.move(700, 880);
    await go(one, { level: 'part', part: 'hold-service', diagram: 'shop-states', lit: ['delivered'] });
    await look('a state diagram with a lit state, a removed state and removed transitions');
    await go(one, { level: 'part', part: 'tables', diagram: 'hold-schema' });
    // The "−" of a removed table has the red of the sum line, and no box is coloured by the change.
    const schemaColours = await one.evaluate(() => {
      const sign = [...document.querySelectorAll('.half.left svg.schema g.node')].find((g) => g.querySelector('.nm')?.textContent === 'reservation').querySelector('.th .sg');
      return getComputedStyle(sign).fill === getComputedStyle(document.querySelector('#tabs .dchg .m')).color
        && new Set([...document.querySelectorAll('.half.left svg.schema rect.box')].map((rect) => getComputedStyle(rect).fill)).size === 1;
    });
    await look('a schema diagram with added tables, removed tables (dashed, the sign red) and tables for context, no box coloured by the change', schemaColours);
    await go(one, { view: 'diffs' });
    await look('"Diffs" with the list of the files and the file with its notes');
    await addNotebooks(one);
    await go(one, { view: 'diffs' });
    await one.evaluate((file) => App.diffs.toPath(file), FEES);
    const atNotebook = await one.waitForFunction((file) => App.diffs.here()?.path === file, FEES, { timeout: 5000 }).then(() => true, () => false);
    await look('a notebook on "Diffs" by its cells', atNotebook);
    await one.goto(`file://${pageFile}?file=src/library/lending/hold_service.py`);
    await one.waitForSelector('.cv .mc', { timeout: 15000 });
    await one.evaluate(() => { const view = document.querySelector('.cv'); view.scrollTop = document.querySelector('.cv .mc').offsetTop - 60; }); // the first note in view
    await frames(one);
    await look('a file tab with its notes');
    await one.evaluate(() => localStorage.setItem('apostil.diagramFull', '1')); // alone: where cards show a node has no window
    await one.goto(`file://${homeFile}`);
    await drawn(one);
    await pointAt(one, '#view g.node[id*="flowchart-jobs-"]'); // its window has the counts of its change
    const homeWindow = await one.waitForSelector('.win .rows .c .p', { timeout: 3000 }).then(() => true, () => false);
    await look('Home with the map and a hover window', homeWindow, ['dark', 'light'].includes(key) ? '8-home' : ''); // in the two default themes
    await one.evaluate(() => localStorage.removeItem('apostil.diagramFull'));
    await one.goto(`file://${homeFile}?diagram=${encodeURIComponent('process:answer-request/2')}`);
    await drawn(one);
    await pointAt(one, '#view g.node[id*="flowchart-s7-"]');
    const stepWindow = await one.waitForSelector('.win .stepnote', { timeout: 3000 }).then(() => true, () => false);
    await look('Home at a step of a process, opened, with its branches, its quiet boxes and the note of a step', stepWindow);
    await one.goto(`file://${pageFile}?go=${encodeURIComponent(JSON.stringify({ view: 'conversation' }))}`);
    await one.waitForFunction(() => (window.apostilConversations ?? 0) >= 1, null, { timeout: 15000 });
    const panel = await one.locator('.status .rvb').click({ timeout: 3000 }).then(() => one.locator('.conv .thread textarea').first().click({ timeout: 3000 })).then(() => true, () => false);
    await look('the page of a pull request with its review panel and a field to answer', panel);
    await one.setViewportSize({ width: 370, height: 700 });
    await one.goto(`file://${listFile}`);
    await one.waitForFunction(() => window.apostilListDone && document.querySelector('.cl .row'), null, { timeout: 15000 });
    await look('the list of changes');
    await one.close();
    const bad = Object.entries(seen).filter(([, page]) => !page.shows || page.bright.length || page.boxed.length || page.dim.length || page.normal.low.length || page.quiet.low.length);
    const lowest = (kind) => Math.min(...Object.values(seen).map((page) => page[kind].lowest));
    check(`${name}: each kind of page reads: ${dark ? 'no box or shape lighter than the page, ' : ''}text on an arrow with no box, a removed thing dashed and seen, text at least 4.5 to 1 and quiet text at least 3 to 1`,
      Object.keys(seen).length === 12 && !bad.length,
      bad.length ? JSON.stringify(Object.fromEntries(bad)) : `${Object.keys(seen).length} kinds of page; the lowest contrast of a normal text ${lowest('normal')} to 1, of a quiet text ${lowest('quiet')} to 1`);
  };
  // The four rounds at the same time, each with its own page: most of a round waits for a page to load or a hover window to open.
  await Promise.all([themeRound('dark', 'the dark default theme'), themeRound('light', 'the light default theme'),
    themeRound('hcDark', 'the dark high-contrast theme'), themeRound('hcLight', 'the light high-contrast theme')]);

  // A change of the theme while a page is open: what is drawn takes the new colours at once, with the lit step, its rows and its join kept,
  // and Mermaid draws in the new colours after it. The look "Same as the computer" does this when the computer goes dark.
  {
    const live = await shownPage(THEMES.light);
    await live.goto(`file://${pageFile}?go=${encodeURIComponent(JSON.stringify({ level: 'part', part: 'hold-service', diagram: 'offer-flow' }))}`);
    await drawn(live);
    await pointAt(live, '.half.left g.node >> nth=2');
    await live.waitForFunction(() => document.querySelector('.half.left .joined') && document.querySelector('.cn .step'), null, { timeout: 3000 });
    await calm(live);
    const seenNow = () => live.evaluate(() => {
      const probe = document.body.appendChild(document.createElement('i'));
      probe.style.color = 'var(--d-node)';
      const node = getComputedStyle(probe).color;
      probe.remove();
      return {
        node, fill: getComputedStyle(document.querySelector('.half.left g.node > rect')).fill, page: getComputedStyle(document.body).backgroundColor,
        joined: document.querySelectorAll('.half.left .joined').length, rows: document.querySelectorAll('.cn .step').length, drawn: document.querySelectorAll('.half.left svg').length,
        mermaid: mermaidColors.primaryColor,
      };
    });
    const before = await seenNow();
    await live.evaluate(wearTheme, THEMES.dark);
    await live.waitForFunction((was) => mermaidColors.primaryColor !== was, before.mermaid, { timeout: 3000 }).catch(() => {}); // Mermaid takes the new colours a frame later
    const after = await seenNow();
    const darkNode = await live.evaluate(() => { const [r, g, b] = getComputedStyle(document.querySelector('.half.left g.node > rect')).fill.match(/[\d.]+/g).map(Number); return { r, g, b }; });
    await live.mouse.move(700, 880);
    await go(live, { level: 'part', part: 'tables', diagram: 'hold-states' });
    const newDrawing = await live.evaluate(() => getComputedStyle(document.querySelector('.half.left g.node > rect')).fill);
    check('a change of the theme while the page shows: the drawing takes the colours of the dark theme at once, the page is dark, the lit step keeps its rows and its join, nothing is drawn again, and Mermaid draws the next diagram in the dark colours',
      before.fill !== after.fill && after.fill === after.node && after.page !== before.page && after.joined === before.joined && after.joined > 0 && after.rows === before.rows && after.rows > 0
      && after.drawn === before.drawn && before.mermaid !== after.mermaid && newDrawing === after.node && darkNode.r < 60, JSON.stringify({ before, after, newDrawing }));
    await live.close();
  }

  // ----- a schema diagram -----
  // The schema of the migration of the example, in the look "Apostil": beside its migration with a table and its lines lit, the pointer on lines lighting
  // their table, the added and removed tables, "13 more columns" opened, the sum line, "Diagram" with its diffs open, and the narrow page.
  // A made-up description adds a dbt model, a file that is not a migration: an altered and a removed column, and a relation from a whole model.
  {
    const salesFile = 'models/marts/daily_sales.sql';
    const salesNow = ['-- The sales of each day, from the staged orders.', 'select', '    ordered_on as sale_day,', '    count(*) as orders,', '    sum(total)::numeric as revenue',
      'from (', '    select ordered_on, total', '    from', "        {{ ref('stg_orders') }}", ') as orders', 'group by ordered_on', 'order by ordered_on'];
    const salesDiff = ['@@ -3,4 +3,3 @@', '     ordered_on as sale_day,', '     count(*) as orders,', '-    sum(total)::integer as revenue,', '-    region', '+    sum(total)::numeric as revenue', ' from ('].join('\n');
    const { diffLines, removedLines } = own('../out/shared/diff-lines.js');
    const salesLines = { length: salesNow.length, added: [[5, 5]], removed: removedLines(salesDiff).map(({ at, line, text }) => ({ at, line, text })), totals: { added: 1, removed: 2 } };
    const salesModels = {
      ...partDiagram({
        id: 'sales-models', kind: 'schema', title: 'The models of the sales marts', part: 'marts', file: salesFile,
        mermaid: 'erDiagram\n  daily_sales {\n    date sale_day\n    integer orders\n    numeric revenue\n  }\n  stg_orders {\n    integer order_id PK\n    date ordered_on\n    numeric total\n  }\n  daily_sales }o--|| stg_orders : ""',
        before: 'erDiagram\n  daily_sales {\n    date sale_day\n    integer orders\n    integer revenue\n    text region\n  }\n  stg_orders {\n    integer order_id PK\n    date ordered_on\n    numeric total\n  }\n  daily_sales }o--|| stg_orders : ""',
        nodeLines: { daily_sales: [1, 12], stg_orders: { file: 'models/staging/stg_orders.sql' } },
        edgeLines: [{ from: 'daily_sales', to: 'stg_orders', lines: [9, 9] }],
      }, { fileChange: (file) => (file === salesFile ? salesLines : { length: 0, added: [], removed: [], totals: { added: 0, removed: 0 } }), text: () => salesNow, fileIsNew: false, checked: false }),
    };
    const salesAnswers = {
      [`diff:${salesFile}`]: diffLines(salesDiff),
      [`code:${salesFile}`]: { lines: salesNow, changed: [[5, 5]], removed: salesLines.removed, status: 'changed' },
    };
    const one = await shownPage(null);
    const joinedTables = () => one.evaluate(() => [...document.querySelectorAll('.half.left g.node.joined .nm')].map((el) => el.textContent));
    await one.goto(`file://${pageFile}`);
    await drawn(one);
    await go(one, { level: 'part', part: 'tables', diagram: 'hold-schema' });
    const schema = await one.evaluate(() => {
      const svg = document.querySelector('.half.left svg.schema');
      const table = (name) => [...svg.querySelectorAll('g.node')].find((g) => g.querySelector('.nm')?.textContent === name);
      const sign = (name) => table(name)?.querySelector('.th .sg')?.textContent ?? '';
      const fills = [...svg.querySelectorAll('rect.box')].map((rect) => getComputedStyle(rect).fill);
      const removed = table('reservation');
      return {
        tables: svg.querySelectorAll('g.node').length, relations: svg.querySelectorAll('.edgePaths > path.relation').length, kind: document.querySelector('#tabs a.on .k')?.textContent,
        sum: document.querySelector('#tabs .dchg')?.textContent, file: document.querySelector('.half.right .fh a')?.textContent,
        added: sign('book_hold') + sign('hold_event'), addedCount: table('book_hold')?.querySelector('.tc')?.textContent,
        removed: sign('reservation') + sign('reservation_note'), dashed: getComputedStyle(removed.querySelector('rect.box')).strokeDasharray,
        removedRed: getComputedStyle(removed.querySelector('.th .sg')).fill === getComputedStyle(document.querySelector('#tabs .dchg .m')).color, quiet: table('member')?.classList.contains('quiet'),
        oneFill: new Set(fills).size === 1, more: table('book_hold')?.querySelector('.more')?.textContent,
        shownRows: [...table('book_hold').querySelectorAll('.row')].filter((row) => row.style.display !== 'none').length,
      };
    });
    check('a schema diagram of the migration stands as a diagram of its part, with its kind word "schema", beside its file: its tables and relations, the sum line under the title, an added table with "+" and its count, a removed table with "−" in red and a dashed border, a table for context quiet, and no box coloured by the change',
      schema.tables === 7 && schema.relations === 6 && schema.kind === 'schema' && schema.sum === '+2 tables −2 tables · +6 relations' && /0042_holds\.sql$/.test(schema.file)
        && schema.added === '++' && schema.addedCount === '+28' && schema.removed === '−−' && schema.dashed !== 'none' && schema.removedRed
        && schema.quiet && schema.oneFill && schema.more === '13 more columns' && schema.shownRows === 8, JSON.stringify(schema));
    // The pointer on a table lights it and its lines at the right, and draws the line to them; the pointer on lines of the migration lights their table
    // (line 44 is a column of the events of a hold).
    const holdTable = one.locator('.half.left g.node', { has: one.locator('.nm', { hasText: /^book_hold$/ }) });
    const box = await holdTable.boundingBox();
    await one.mouse.move(box.x + 40, box.y + 12, { steps: 4 });
    await one.waitForFunction(() => document.querySelector('.half.left g.node.joined') && document.querySelector('svg.join path'), null, { timeout: 3000 }).catch(() => {});
    await takePicture(one, '120-apostil-1-schema-a-table-and-its-lines-lit.png');
    const lit = { joined: await joinedTables(), line: await one.evaluate(() => !!document.querySelector('svg.join path')), steps: await one.locator('.half.right .step').count() };
    await one.mouse.move(6, 600, { steps: 2 });
    await one.waitForFunction(() => !document.querySelector('.half.left g.node.joined'), null, { timeout: 3000 });
    const index = await one.evaluate((at) => {
      const view = Code.shown;
      const row = view.rows.findIndex((one) => one.now === at);
      const right = document.querySelector('.half.right');
      right.scrollTop = view.box.offsetTop + view.list.top(row) - right.clientHeight / 2;
      return row;
    }, 44);
    const row = await one.locator(`.half.right [data-row="${index}"]`).first();
    await row.waitFor({ timeout: 3000 });
    const rowBox = await row.boundingBox();
    await one.mouse.move(rowBox.x + 300, rowBox.y + rowBox.height / 2, { steps: 3 });
    await one.waitForFunction(() => document.querySelector('.half.left g.node.joined'), null, { timeout: 3000 }).catch(() => {});
    const fromRows = await joinedTables();
    check('the pointer on a table lights the table and its lines in the migration and draws the line to them; the pointer on lines of the migration lights their table',
      lit.joined.join() === 'book_hold' && lit.line && lit.steps > 0 && fromRows.join() === 'hold_event', JSON.stringify({ lit, fromRows }));
    await one.mouse.move(6, 600, { steps: 2 });
    // "13 more columns" opens the rest of the table in place, and the drawing takes the new frame.
    const frameBefore = await one.evaluate(() => document.querySelector('.half.left svg.schema').getBBox().height);
    await holdTable.locator('.more').click();
    await one.waitForFunction(() => [...document.querySelectorAll('.half.left g.node .more')].some((more) => more.style.display === 'none'), null, { timeout: 3000 }).catch(() => {});
    await frames(one);
    const opened = await one.evaluate(() => {
      const g = [...document.querySelectorAll('.half.left g.node')].find((one) => one.querySelector('.nm')?.textContent === 'book_hold');
      return { rows: [...g.querySelectorAll('.row')].filter((row) => row.style.display !== 'none').length, more: g.querySelector('.more').style.display, height: document.querySelector('.half.left svg.schema').getBBox().height, view: App.state.view };
    });
    check('a click on "13 more columns" opens all 21 columns in place, and the drawing grows', opened.rows === 21 && opened.more === 'none' && opened.height > frameBefore && opened.view !== 'code', JSON.stringify({ frameBefore, opened }));
    // "Diagram" with every diff open: at the migration, the left half shows its schema with the tables of the change in view lit;
    // at a dbt model of a made-up description its schema shows by itself, with an altered and a removed column, and a relation from a whole model.
    const leftNow = () => one.evaluate(() => ({
      cards: [...document.querySelectorAll('#view > .half.left > *')].map((el) => el.querySelector('.gt')?.textContent ?? 'change'),
      kinds: [...document.querySelectorAll('#view > .half.left .gcard .k')].map((el) => el.textContent),
      lit: [...new Set([...document.querySelectorAll('#view > .half.left g.node.joined .nm')].map((el) => el.textContent))],
      schema: !!document.querySelector('#view > .half.left svg.schema'),
    }));
    const openAll = async () => {
      await go(one, { level: 'change' });
      await one.click('[data-all="open"]');
      await one.waitForSelector('.half.right .dfile.open', { timeout: 3000 });
    };
    // The left half follows the file at the reading line when the scroll rests: a schema with a lit table (`table`, or any).
    const leftShows = (table) => one.waitForFunction((name) => [...document.querySelectorAll('#view > .half.left svg.schema g.node.joined .nm')].some((el) => !name || el.textContent === name), table, { timeout: 5000 }).catch(() => {});
    await openAll();
    await toFile(one, 'db/migrations/0042_holds.sql', -200);
    await leftShows('');
    const atMigration = await leftNow();
    await one.evaluate(({ diagram, answers, file }) => {
      Object.assign(window.APOSTIL_EXAMPLE.answers, answers);
      App.page.files.push({ path: file, status: 'changed', added: 1, removed: 2 });
      App.page.parts.push({ id: 'marts', name: 'Sales marts', files: [file], diagrams: [diagram.id] });
      App.page.diagrams.push(diagram);
    }, { diagram: salesModels, answers: salesAnswers, file: salesFile });
    await openAll();
    await toFile(one, salesFile, 200); // its head a little above the reading line
    await leftShows('daily_sales');
    const atModel = await leftNow();
    const model = await one.evaluate(() => {
      const svg = document.querySelector('#view > .half.left svg.schema');
      if (!svg) return { none: App.diffs?.here()?.path ?? '' };
      const rows = [...svg.querySelectorAll('g.node')].find((g) => g.querySelector('.nm')?.textContent === 'daily_sales').querySelectorAll('.row');
      const relation = svg.querySelector('.edgePaths > path.relation');
      const head = [...svg.querySelectorAll('g.node')].find((g) => g.querySelector('.nm')?.textContent === 'daily_sales').querySelector('rect.box').getBBox();
      const start = relation.getPointAtLength(0);
      return {
        rows: [...rows].map((row) => `${row.querySelector('.sg').textContent}${row.querySelector('.cn').textContent}:${row.querySelector('.ct').textContent}`),
        struck: getComputedStyle([...rows].find((row) => row.classList.contains('c-removed')).querySelector('.cn')).textDecorationLine,
        fromHead: Math.abs(start.y - (head.y + 0)) < 40,
      };
    });
    check('on "Diagram" with its diffs open, the diagram half shows the schema of the file at the reading line by itself, with the tables of the change in view lit: at the migration; at a dbt model (not a migration) with an altered column and its old type, a removed column struck through, and a relation from the whole model',
      atMigration.cards[0] === 'Holds in the database' && atMigration.kinds[0] === 'schema' && atMigration.schema && atMigration.lit.length > 0
        && atModel.cards[0] === 'The models of the sales marts' && atModel.lit.includes('daily_sales')
        && model.rows?.join() === 'sale_day:date,orders:integer,~revenue:integer numeric,−region:text' && model.struck === 'line-through' && model.fromHead, JSON.stringify({ atMigration, atModel, model }));
    // The narrow page: the schema alone, as wide as the page, with its sum line.
    await one.setViewportSize({ width: 820, height: 900 });
    await go(one, { level: 'part', part: 'tables', diagram: 'hold-schema' });
    const narrow = await one.evaluate(() => ({ halves: document.querySelectorAll('#view > .half').length, schema: !!document.querySelector('#view svg.schema'), sum: document.querySelector('#tabs .dchg')?.textContent, wide: document.documentElement.scrollWidth > innerWidth }));
    check('on a narrow page the schema diagram stands alone with its sum line, and the page does not scroll sideways', narrow.halves === 0 && narrow.schema && narrow.sum === '+2 tables −2 tables · +6 relations' && !narrow.wide, JSON.stringify(narrow));
    await one.close();
  }
  // The other places where a schema draws: the graphs page of the migration (a schema of the map and of the change, small, with the tables of the path lit),
  // Home at the schema of an area of the map, and the window on the part "Table", whose first diagram is its schema.
  {
    const one = await openPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
    one.on('pageerror', (error) => errors.push(error.message));
    await one.goto(`file://${homeFile}?path=${encodeURIComponent('db/migrations/0042_holds.sql')}`);
    await one.waitForFunction(() => document.querySelectorAll('.pnl .pd[data-lit]').length === Home.data.panels.length, null, { timeout: 15000 });
    const panels = await one.evaluate(() => [...document.querySelectorAll('.pnl')].filter((panel) => panel.querySelector('svg.schema'))
      .map((panel) => `${panel.querySelector('.t').textContent}:${panel.querySelectorAll('svg.schema g.node.lit').length}`));
    await one.goto(`file://${homeFile}?diagram=lib-tables`);
    await drawn(one);
    const home = await one.evaluate(() => ({ tables: document.querySelectorAll('#view svg.schema g.node.go').length, crumb: document.querySelector('#crumb')?.textContent }));
    await one.evaluate(() => localStorage.setItem('apostil.diagramFull', '1')); // alone: where cards show a part has no window
    await one.goto(`file://${pageFile}`);
    await drawn(one);
    await one.evaluate(() => Split.setHidden('code', true));
    await pointAt(one, '#view b[data-part="tables"]');
    await one.waitForSelector('.win svg.schema g.node', { timeout: 4000 }).catch(() => {});
    const window = await one.evaluate(() => ({ tables: document.querySelectorAll('.win svg.schema g.node').length, sub: document.querySelector('.win .tb .sub')?.textContent ?? '' }));
    await one.evaluate(() => { Split.setHidden('code', false); localStorage.removeItem('apostil.diagramFull'); });
    check('a schema draws where a diagram draws: on the graphs page of the migration (the schema of the map and of the change, with the tables of the path lit), on Home at the schema of an area, and alone in the window on its part',
      panels.join() === 'The tables of holds:2,Holds in the database:2' && home.tables === 2 && window.tables === 7 && /\+2 tables −2 tables/.test(window.sub), JSON.stringify({ panels, home, window }));
    await one.close();
  }

  // ----- a notebook by its cells -----
  // A made-up change to notebooks, in the look "Apostil": the diff of a notebook by cells with a note beside a line, a text cell as written,
  // "only outputs changed", a step of a diagram joined to rows of a cell, and Alt+Down through the cells. The theme rounds read it in each theme.
  {
    const one = await shownPage(null);
    await one.goto(`file://${pageFile}`);
    await drawn(one);
    await addNotebooks(one);
    await go(one, { level: 'change' });
    await one.evaluate(() => App.diffs.list.setAll(true)); // the open diffs of the list of "Diagram": "Diffs" opens no diff

    // The diff of a notebook by cells, with a note beside a line of a cell; a text cell shows its text as written.
    await toFile(one, FEES, 40);
    await one.waitForFunction((file) => document.querySelector(`.half.right .dfile[data-file="${file}"] .l.cell`), FEES, { timeout: 5000 });
    await takePicture(one, '130-apostil-1-diffs-a-notebook-by-cells-with-a-note.png');
    const byCells = await one.evaluate((file) => {
      const section = document.querySelector(`.half.right .dfile[data-file="${file}"]`);
      const rows = [...section.querySelectorAll('.l')];
      const row = (text) => rows.find((one) => one.querySelector('.x').textContent === text);
      // Beside a diagram the half is narrow: a note is a mark beside its rows, else a card at their height.
      const card = [...section.querySelectorAll('.mc')].find((one) => one.querySelector('.nt')?.textContent === 'No fee before the due day')
        ?? [...section.querySelectorAll('.mk')].find((mark) => Math.abs(mark.getBoundingClientRect().top - row('    if days <= 0:').getBoundingClientRect().top) < 4);
      const head = row('cell 5 · code · id feechanged');
      const textRow = rows.find((one) => one.querySelector('.x').textContent.startsWith('A fee is **2**'));
      return {
        heads: rows.filter((one) => one.classList.contains('cell')).map((one) => one.querySelector('.x').textContent),
        raw: rows.some((one) => /«cell|"source"|execution_count/.test(one.textContent)),
        counts: section.querySelector('.dh .c').textContent, numbers: ['    if days <= 0:', '        return 0'].map((text) => row(text)?.querySelector('.n').textContent),
        added: row('    if days <= 0:')?.classList.contains('add'), removed: row('def fee(days):')?.classList.contains('del'),
        card: !!card, cardBeside: card && Math.abs(card.getBoundingClientRect().top - row('    if days <= 0:').getBoundingClientRect().top) < 120,
        quietHead: head && getComputedStyle(head.querySelector('.x')).fontFamily !== getComputedStyle(row('def fee(days):').querySelector('.x')).fontFamily,
        coloured: head && getComputedStyle(head).backgroundColor === getComputedStyle(row('def fee(days):')).backgroundColor,
        text: textRow && { words: textRow.querySelector('.x').textContent, plain: textRow.querySelector('.x').children.length === 0, number: textRow.querySelector('.n').textContent, tags: section.querySelectorAll('.x h1, .x h2, .x strong').length },
      };
    }, FEES);
    check('in the list of diffs a notebook shows as its cells: a quiet head for each cell with its number, kind and id, its lines numbered inside the cell, added and removed lines as in any diff, the note beside the lines of its cell, no raw JSON, and a text cell as written with no colour of code',
      byCells.heads.slice(0, 3).join('|') === 'cell 1 · text · id intro|cell 2 · text · id summarymoved from cell 6|cell 3 · text · id rulenew' && byCells.heads.includes('cell 4 · code · id loadoutput not shown')
        && !byCells.raw && byCells.counts === '+7 −5' && byCells.numbers.join() === '2,3' && byCells.added && byCells.removed && byCells.card && byCells.cardBeside && byCells.quietHead && !byCells.coloured
        && byCells.text?.plain && byCells.text.words.includes('**2**') && byCells.text.number === '2' && !byCells.text.tags,
      JSON.stringify(byCells));

    // A notebook in which only outputs changed: one quiet line, folded; opened, it says so.
    await toFile(one, 'notebooks/outputs.ipynb', 300);
    const outputs = await one.evaluate(() => {
      const section = document.querySelector('.half.right .dfile[data-file="notebooks/outputs.ipynb"]');
      return { folded: section.classList.contains('quiet') && section.classList.contains('shut'), head: section.querySelector('.dh .c').textContent, broken: document.querySelector('.half.right .dfile[data-file="notebooks/broken.ipynb"] .dh .c')?.textContent ?? '' };
    });
    await one.locator('.half.right .dfile[data-file="notebooks/outputs.ipynb"]').click();
    const opened = await one.waitForSelector('.half.right .dfile[data-file="notebooks/outputs.ipynb"] p.quiet', { timeout: 3000 }).then((el) => el.textContent(), () => '');
    check('a notebook in which only outputs changed is one quiet folded row that says so, and opened it says so again; a .ipynb file that is not a notebook says it is shown as text',
      outputs.folded && outputs.head === ' · only outputs changed' && opened === 'Only outputs changed.' && /does not read as a notebook, shown as text/.test(outputs.broken), JSON.stringify({ outputs, opened }));

    // A step of a diagram with a place in a cell: the pointer on it lights its rows in the cell; the pointer on those rows lights the step.
    await go(one, { level: 'part', part: 'fees', diagram: 'fee-flow' });
    await pointAt(one, '.half.left g.node:has-text("Back before the due day?")');
    await one.waitForFunction(() => document.querySelector('.half.right .l.step') && document.querySelector('svg.join path'), null, { timeout: 3000 }).catch(() => {});
    const joined = await one.evaluate(() => ({
      lit: [...document.querySelectorAll('.half.right .l.step')].map((row) => `${row.querySelector('.n').textContent}:${row.querySelector('.x').textContent.trim()}`),
      heads: [...document.querySelectorAll('.half.right .l.cell')].map((row) => row.querySelector('.x').textContent),
      line: !!document.querySelector('svg.join path'),
    }));
    await one.mouse.move(6, 600, { steps: 2 });
    await one.waitForFunction(() => !document.querySelector('.half.right .l.step'), null, { timeout: 3000 }).catch(() => {});
    await pointAt(one, '.half.right .l:has-text("return days * rate")');
    await one.waitForFunction(() => document.querySelector('.half.left g.node.joined'), null, { timeout: 3000 }).catch(() => {});
    const fromRows = await one.evaluate(() => [...document.querySelectorAll('.half.left g.node.joined')].map((g) => g.textContent.trim()));
    check('a step of a diagram with a place in a cell lights its rows in the file shown by cells, numbered inside the cell, and draws the line to them; the pointer on rows of a cell lights their step',
      joined.lit.join() === '2:if days <= 0:' && joined.line && joined.heads.some((head) => head.startsWith('cell 5 · code · id fee')) && fromRows.length === 1 && fromRows[0].startsWith('Days times the rate'),
      JSON.stringify({ joined, fromRows }));

    // On "Diffs" the notebook shows at its first change, and Alt+Down goes from change to change through the cells.
    await go(one, { view: 'diffs' });
    await one.evaluate((file) => App.diffs.toPath(file), FEES);
    const where = (run) => one.waitForFunction((want) => App.diffs.here()?.run === want, run, { timeout: 3000 }).catch(() => {}).then(() => one.evaluate(() => {
      const at = App.diffs.here();
      const shown = changeRuns(at.section.view.rows)[at.run];
      const rows = at.section.view.rows.slice(0, shown[0] + 1);
      return { path: at.path, run: at.run, cell: [...rows].reverse().find((row) => row.kind === 'cell')?.text ?? '' };
    }));
    const steps = [await where(0)];
    for (let at = 1; at <= 3; at++) {
      await one.keyboard.press('Alt+ArrowDown');
      steps.push(await where(at));
    }
    check('Alt+Down goes from change to change through the cells of the notebook',
      steps.every((one) => one.path === FEES) && steps.map((one) => one.run).join() === '0,1,2,3'
        && steps.map((one) => one.cell).join('|') === 'cell 2 · text · id summary|cell 3 · text · id rule|cell 5 · code · id fee|cell 5 · code · id old', JSON.stringify(steps));
    await one.close();
  }
} catch (error) {
  check('the checks ran to the end', false, error.message.split('\n').slice(0, 14).join(' / '));
}
await finish();
