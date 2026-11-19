// The code with notes: rows of code that wrap, drawn as they come into view, and the notes of those rows in a column at the right edge.
// The file tab, each file of the "Diffs" page and the hover windows of code all use it (codeWithNotes). The "Diffs" page is at the end.
'use strict';

const MANY_TESTS = 20; // above this, the tests that name a function are too many to count: "many tests", listed only on demand
const Look = typeof Marks === 'object' ? Marks : require('./marks.js'); // the look (marks.js); the tests read this file in Node

/** The tests of a window as HTML: groups of tests, each with its added lines in a box that is filled when the window is open. */
function testsHtml(answer) {
  return answer.groups.map((group, at) => {
    const folders = [...new Set(group.tests.map((test) => folderOf(test.file).replace(/\/$/, '')))];
    const rows = group.tests.map((test, index) => `<div class="trw" data-file="${esc(test.file)}" ${Places.attrs({ kind: 'test', file: test.file, name: test.name, lines: [test.line, test.line] })}><div class="nm">${esc(test.name)}${test.isNew ? '<i>new</i>' : ''}</div>`
      + `<div class="pt">${esc(baseName(test.file))} · line ${test.line}</div>`
      + (test.added.length ? `<div class="tadd" data-test="${at}:${index}"></div>` : '') + '</div>').join('');
    return `<div class="tgp">${esc(group.name)} <span>· ${number(group.tests.length)}${folders.length === 1 && folders[0] ? ` · ${esc(folders[0])}` : ''}</span></div>${rows}`;
  }).join('') || '<div class="quiet" style="padding:4px 12px">No tests found.</div>';
}

/** Fills the boxes of added lines of a tests window. */
function fillTests(body, answer) {
  for (const box of body.querySelectorAll('[data-test]')) {
    const [group, index] = box.dataset.test.split(':').map(Number);
    codeWithNotes(box, { rows: answer.groups[group].tests[index].added.map(({ line, text }) => ({ kind: 'add', line, now: line, text })), scroller: body });
  }
}

/** The tests window: "tests:<function>" for the tests that call a function, "linked:<note key>" for the tests of one note. */
function testsWindow(question) {
  return async () => {
    const title = question.startsWith('linked:') ? 'Tests of this note' : 'Tests that call this function';
    const count = question.startsWith('tests:') ? App.page.functionTests[question.slice(6)] : 0;
    if (count > MANY_TESTS) {
      // Many tests name the function: the list comes only when he asks for it.
      return {
        title, width: 620, sub: `${number(count)} tests name it`,
        body: `<div class="quiet" style="padding:4px 12px">So many tests name this function that the count says little. <a data-show-tests>Show them</a></div>`,
        ready: (body) => body.querySelector('[data-show-tests]').addEventListener('click', async () => {
          const answer = await ask(question);
          body.innerHTML = answer ? testsHtml(answer) : '';
          if (answer) fillTests(body, answer);
        }),
      };
    }
    const answer = await ask(question);
    if (!answer) return null;
    return { title, width: 620, sub: answer.newCount ? `${number(answer.newCount)} new in this change` : '', body: testsHtml(answer), ready: (body) => fillTests(body, answer) };
  };
}

/** The count of the tests that call a function, with its tests window. */
function functionTests(name) {
  const count = App.page.functionTests[name];
  if (count === undefined) return '';
  return `<span class="tc" data-tests="${esc(name)}">${count > MANY_TESTS ? 'many tests' : plural(count, 'test')}</span>`;
}

/** Gives each function test count in an element its tests window. */
function attachTestWindows(into) {
  for (const count of into.querySelectorAll('[data-tests]')) Hover.attach(count, testsWindow(`tests:${count.dataset.tests}`), count.closest('.mc') ?? count);
}

/**
 * The colour of a note is the colour of its code, as long as that code is a diff: "del" for a note on removed lines,
 * "add" when its lines hold an added line, and none for lines that the change left alone. A note of another change (`from`) has no colour.
 */
const toneOf = (rows, note, [first, last]) => (note.from ? '' : note.removed ? 'del' : rows.slice(first, last + 1).some((row) => row.kind === 'add' && hits(row, note)) ? 'add' : '');

/**
 * A note card: title, its own linked tests, text, and what a check found. The first note of a function names it with its test count.
 * A note of another saved change says which change, because that change may be old; a note of the map says nothing of where it came from.
 * A comment on a note of another change or of the map is a comment on its lines.
 */
function noteCard(note, first, tone = '') {
  const check = note.check ? `<div class="ck">Check: ${esc(note.check)}</div>` : note.failed ? `<div class="ck">Line check: ${esc(note.failed)}</div>` : '';
  const tests = note.linkedTests ? `<span class="tc" data-linked>${note.linkedTests} linked test${note.linkedTests === 1 ? '' : 's'}</span>` : '';
  const count = first ? functionTests(note.symbol) : '';
  const start = first ? `<div class="fn">${esc(note.symbol)}${count ? ` · ${count}` : ''}</div>` : '';
  const card = html(`<div class="mc${tone && ` ${tone}`}${note.check || note.failed ? ' chk' : ''}">${start}<div class="t"><span class="nt" data-note="${esc(note.key)}">${esc(note.title)}</span>${tests}</div>`
    + `${note.text ? `<div class="d">${esc(note.text)}</div>` : ''}${check}${note.from && !note.from.map ? `<div class="d from">From “${esc(note.from.title)}”</div>` : ''}</div>`);
  Places.mark(card, note.from ? { kind: 'lines', file: note.file, lines: note.lines } : { kind: 'note', part: note.part, file: note.file, lines: note.lines, point: note.pointId, removed: note.removed || undefined });
  return card;
}

const inside = (line, [first, last]) => first <= line && line <= last;

/** A note as a thing of the look: its file and lines, its fields, and the marks at its lines (`marks`: the marks of the file with their lines now). */
function noteThing(note, marks = []) {
  const thing = {
    kind: 'note', id: note.title, now: true, paths: [note.file], at: [{ file: note.file, from: note.lines[0], to: note.lines[1] }],
    fields: { title: note.title, file: note.file, function: note.symbol ?? '', tests: note.linkedTests ?? 0, check: !!(note.check || note.failed) },
  };
  thing.marks = Look.marksIn(thing, marks);
  return thing;
}

/** The slots that the look gives a note, or none: a removed note and a note with no lines keep the default. */
const noteSlots = (note, marks) => (App.page?.look && !note.removed && note.lines ? Marks.resolve(App.page.look.rules, noteThing(note, marks), App.page.look.one) : {});

/**
 * The look of a note card (marks.js): the marks at its lines at the corners of its card, one line for each service, the colour that a rule of
 * the look gives it, its fields in the order of the rule, and where a click and other input go. `marks` are the marks of the file with their lines
 * now, from the answer to "code:<path>". Returns the card.
 */
function lookOfNote(card, note, marks = []) {
  const look = App.page?.look;
  if (!look || note.removed || !note.lines) return card;
  const thing = noteThing(note, marks);
  Marks.decorateNote(card, look, thing, (file, line) => App.showCode(file, [line, line]));
  const slots = noteSlots(note, marks);
  // The first line of a function: words from its fields, or left out.
  const head = card.querySelector(':scope > .fn');
  if (head) {
    const line = Marks.lineThing('function-line', note.file, note.lines, marks, { function: note.symbol, tests: App.page.functionTests?.[note.symbol] ?? 0 });
    const own = Marks.slotsIn(look, line);
    if (own['show.shown'] === false) head.remove();
    else if (own.content?.words) head.innerHTML = Marks.fillWords(esc(own.content.words), line.fields);
  }
  if (slots.content?.fields) orderCard(card, slots.content.fields);
  const title = card.querySelector(':scope > .t');
  if (title) Marks.paintText(title, look, slots); // an icon before its title
  Marks.bind(card, slots, null, note.title);
  // Its window of the pointer when a rule gives it one: what a check found ("check"), and what a click does.
  const found = note.check ? `Check: ${note.check}` : note.failed ? `Line check: ${note.failed}` : '';
  if (Marks.hasWindow(slots)) Hover.attach(card, () => ({ ...Marks.windowOf({ title: note.title, width: 320, sections: [{ id: 'check', html: found && `<p class="stepnote">${esc(found)}</p>` }] }, slots), pad: true }));
  else Marks.inputWindow(card, slots, note.title);
  return card;
}

/**
 * The look of the parts of a file tab around its notes, from the rules on the line to the code, the order of the notes, the notes column,
 * the code map and the margin: their slots for the notes of a file and its marks with their lines now; `rank(note)` is the place of a note in the
 * order of a rule on the notes, or null with no such rule.
 */
function fileLook(path, notes, marks = []) {
  const look = App.page?.look;
  if (!look || !path) return { line: () => ({}), order: () => ({}), column: {}, map: {}, tint: () => undefined, margin: new Map(), rank: null };
  const ofNote = (kind) => new Map(notes.filter((note) => note.lines).map((note) => [note, Marks.slotsIn(look, Marks.lineThing(kind, path, note.lines, marks))]));
  const [lines, orders] = [ofNote('note-line'), ofNote('note-order')];
  const column = Marks.slotsIn(look, { kind: 'notes-column', paths: [path], fields: {} });
  const map = Marks.slotsIn(look, { kind: 'code-map', paths: [path], marks, fields: {} });
  // The code map tints the lines that a rule picks: each line with marks by its own rule, every line by a rule of the whole file.
  const whole = Marks.slotsIn(look, { kind: 'code-map', paths: [path], marks: [], fields: {} })['box.color'];
  const tints = new Map(Marks.marginThings(path, marks, Infinity, 'code-map').map(([line, thing]) => [line, Marks.slotsIn(look, thing)['box.color']]).filter(([, color]) => color));
  // The margin: at each line whose rule shows it, the icon of the first value of the stack there, as on a node.
  const margin = new Map(Marks.marginIcons(look, path, marks).map(([line, key]) => [line, { key, name: look.values[key]?.name ?? key.split(':')[1], icon: look.values[key]?.icon }]));
  // The order of a rule on the notes ranks them: a card that ranks before the next card keeps its whole text when not all fit.
  const things = notes.filter((note) => note.lines && !note.removed).map((note) => ({ ...noteThing(note, marks), note }));
  const order = Marks.listOrder(things, look);
  const ranked = order.by || order.first ? Marks.orderRows(things, order)[0].rows.map((row) => row.note) : null;
  return {
    line: (note) => lines.get(note) ?? {}, order: (note) => orders.get(note) ?? {}, column, map, tint: (line) => tints.get(line) ?? whole, margin,
    rank: ranked && ((note) => (ranked.includes(note) ? ranked.indexOf(note) : ranked.length)),
  };
}

/**
 * The fields of a note card in the order of a rule ("content": { "fields": [...] }): its title, its function line, its linked tests, its text and its
 * service lines; a field that the list does not name is not shown. The tests stand beside the title when they follow it. What a check found stays.
 */
function orderCard(card, fields) {
  const title = card.querySelector(':scope > .t');
  const tests = title?.querySelector('[data-linked]');
  tests?.remove();
  const parts = { function: card.querySelector(':scope > .fn'), title, tests, text: card.querySelector(':scope > .d:not(.from)'), services: card.querySelector(':scope > .mk-lines') };
  for (const [name, el] of Object.entries(parts)) if (el && name !== 'tests' && !fields.includes(name)) el.remove();
  let after = null;
  fields.forEach((name, index) => {
    let el = parts[name];
    if (!el) return;
    if (name === 'tests' && fields[index - 1] === 'title' && title) return void title.append(el);
    if (name === 'tests') { el = html('<div class="t"></div>'); el.append(tests); }
    card.insertBefore(el, after ? after.nextSibling : card.firstChild);
    after = el;
  });
}

/**
 * A long line wraps inside the box of the code, at any character, and goes on at its indent plus 2 characters.
 * The font is monospace, so the visual rows of a line follow from its length: no line is measured on the page.
 */
const Wrap = {
  /** The text of a line with its tabs as spaces to the next stop of 4 (each part before a tab starts at a stop). */
  expand: (text) => (text.includes('\t') ? text.replace(/[^\t]*\t/g, (part) => part.slice(0, -1) + ' '.repeat(4 - ((part.length - 1) % 4))) : text),

  /** The length and the indent of a line, in columns. */
  measure(text) {
    const wide = this.expand(text);
    return { length: wide.length, indent: wide.length - wide.trimStart().length };
  },

  /** The indent of the visual rows after the first: the indent of the line plus 2, and never more than half the box. */
  hang: (indent, columns) => Math.min(indent + 2, Math.floor(columns / 2)),

  /** How many visual rows a line takes in a box of `columns` characters. */
  rows(line, columns) {
    return 1 + Math.ceil(Math.max(0, line.length - columns) / (columns - this.hang(line.indent, columns)));
  },
};

const FOLD_ROWS = 8; // a line that takes more visual rows shows its first rows and "Show all 30,000 characters"

const charWidths = new Map(); // the width of one character of the code font, measured once for each size

/** How many characters fit in one visual row of the code: the room of the text of a row, divided by the width of one character. */
function codeColumns(box) {
  box.innerHTML = '<div class="l"><span class="n"></span><span class="g"></span><span class="x">0000000000</span></div>';
  const text = box.querySelector('.x');
  const size = getComputedStyle(text).fontSize;
  if (!charWidths.get(size)) {
    const range = document.createRange();
    range.selectNodeContents(text);
    charWidths.set(size, range.getBoundingClientRect().width / 10);
  }
  const room = text.clientWidth - parseFloat(getComputedStyle(text).paddingRight);
  box.innerHTML = '';
  return Math.max(8, Math.floor((room + 0.01) / (charWidths.get(size) || 7)));
}

const GUTTER = 36; // the room at the left of the note cards, for the lines that join a note to its code (the same number as in look.css)
const LANE = 14; // a card of a step stands this much further in than the card of its function
const MARK_LANE = 7; // on a narrow tab, the mark of a step stands this much right of the mark of its function
const LANES = 3; // at most this many lanes: a note inside a step inside a function

/**
 * The lane of each note, from its rows (`spans` in the order of their first rows): the first lane that no note before it still holds.
 * A step inside its function gets the lane after the function, so the card of a step stands under its function, one step in, and two marks never lie on top of each other.
 */
function lanesOf(spans) {
  const ends = []; // the last row of the note that took each lane last
  return spans.map(([first, last]) => {
    const free = ends.findIndex((end) => end < first);
    const lane = Math.min(free < 0 ? ends.length : free, LANES - 1);
    ends[lane] = Math.max(ends[lane] ?? -1, last);
    return lane;
  });
}

/**
 * The lines beside the code: a join from each note's code lines to its card, and an arrow from a note to the next note of the same function.
 * `boxes` are where the cards stand ({ top, height, left, tone }); `ends` are the heights where each join meets the code;
 * `follows(index)` is true when note `index` is the next step of the note before it.
 */
function noteLinks(boxes, ends, follows, looks = {}) {
  const joins = boxes.map(({ top, height, left, tone }, index) => {
    const to = top + Math.min(22, height / 2);
    const own = lineLook(looks.line?.(index));
    return `<path data-join="${index}" class="${[tone, own.class].filter(Boolean).join(' ')}"${own.style} d="M0 ${ends[index]} C${left / 2} ${ends[index]} ${left / 2} ${to} ${left} ${to}"/>`;
  });
  const arrows = boxes.map((box, index) => {
    const slots = looks.order?.(index) ?? {};
    if (!follows(index) || slots['show.shown'] === false) return '';
    const x = box.left + 56;
    const [from, to] = [boxes[index - 1].top + boxes[index - 1].height + 2, box.top - 2];
    const own = lineLook(slots);
    const head = lineLook({ ...slots, 'arrow.dashed': false });
    return to - from > 14 ? `<path${own.class ? ` class="${own.class}"` : ''}${own.style} d="M${x} ${from} L${x} ${to - 6}"/><path class="arrow${head.class ? ` ${head.class}` : ''}"${head.style} d="M${x - 4.5} ${to - 7} L${x + 4.5} ${to - 7} L${x} ${to}"/>` : '';
  });
  return `<svg class="links" width="1" height="1">${joins.join('')}${arrows.join('')}</svg>`;
}

/** The class and the style of a line beside the notes in the look ("arrow": its colour in both themes, its width, dashed); nothing with no rule. */
function lineLook(slots = {}) {
  const classes = [];
  const style = [];
  const color = slots['arrow.color'] && Marks.lineColors(slots['arrow.color']);
  if (color) { classes.push('lk-stroke'); style.push(`--lk-stroke-l:${color.light};--lk-stroke-d:${color.dark}`); }
  if (slots['arrow.width']) { classes.push('lk-wide'); style.push(`--lk-width:${slots['arrow.width']}px`); }
  if (slots['arrow.dashed']) classes.push('lk-dashed');
  return { class: classes.join(' '), style: style.length ? ` style="${style.join(';')}"` : '' };
}

/**
 * Where the cards of a column stand, by one rule: each at its first row (`want`), below the card before it with `room(index)` between them.
 * A card whose whole text would reach the row of the next card crowds it: the two show their title only (`short`), so that the next card can stand at
 * its row too. A stretch of crowded cards is so a stretch of titles. Where even the titles do not fit, a card stands lower than its row.
 * `full` and `shortHeight` are the heights of the cards, whole and as a title; `start` is the room above the first card; `keep(index)` true keeps a card whole
 * (a rule of the look on the order of the notes), and the cards after it stand lower.
 * Returns { tops, short: [true when card index shows its title only], bottom }.
 */
function cardPlaces(want, full, shortHeight, room, start, keep = () => false) {
  const tops = [];
  const short = [];
  let bottom = start;
  let crowded = false; // the card before crowds this one
  want.forEach((row, index) => {
    tops[index] = Math.max(row, bottom + room(index));
    const free = index + 1 < want.length ? want[index + 1] - room(index + 1) - tops[index] : Infinity; // the room down to the row of the next card
    const crowds = full[index] > free;
    // After a crowding card a card stays a title unless it has room for its whole text and one more title, so a stretch reads as one.
    short[index] = (crowds || (crowded && full[index] + shortHeight > free)) && shortHeight < full[index] && !keep(index);
    crowded = crowds;
    bottom = tops[index] + (short[index] ? shortHeight : full[index]);
  });
  return { tops, short, bottom };
}

/**
 * The rows of a whole file: each line as it is now, and before it the lines that the change removed there.
 * A row is { kind: "add", "del", "gap" or "", line: the number shown, now: the line of the file it stands for (0 for a removed line), text, partner? }.
 * A removed row shows its number in the file as it was. `partner` is the line that a changed line is marked against, word by word.
 */
function fileRows(code) {
  if (code.status === 'removed') return cellRows(code.lines.map((text, index) => ({ kind: 'del', line: index + 1, now: index + 1, text })), code.cells);
  const length = code.lines.length;
  const added = new Uint8Array(length + 2);
  for (const [first, last] of code.changed) added.fill(1, first, last + 1);
  const removedAt = new Map();
  for (const removed of code.removed ?? []) {
    const at = Math.min(removed.at, length + 1);
    removedAt.set(at, [...(removedAt.get(at) ?? []), removed]);
  }
  const rows = [];
  for (let line = 1; line <= length + 1; line++) {
    (removedAt.get(line) ?? []).forEach((removed, index) => {
      const partner = added[line + index] && line + index <= length ? code.lines[line + index - 1] : undefined;
      rows.push({ kind: 'del', line: removed.line, now: 0, text: removed.text, partner });
    });
    if (line <= length) rows.push({ kind: added[line] ? 'add' : '', line, now: line, text: code.lines[line - 1] });
  }
  return cellRows(rows, code.cells);
}

/**
 * The rows of a notebook by its cells (`cells`: where its cells stand before and now, from the page data). The rows count in the text of the cells
 * (shared/notebook.ts); here each cell gets a quiet head row ({ kind: "cell", text: its words, cell }) in place of its head line, and each row its number
 * inside its cell (`num`). A changed cell has one head over its removed and its added rows. Rows of a text cell are `plain`: shown as written. No cells: the rows as they are.
 */
function cellRows(rows, cells) {
  if (!cells) return rows;
  const out = [];
  let shown = null; // the key of the cell whose head stands last
  const cellOf = (list, line) => list.find((cell) => cell.at <= line && line <= cell.at + cell.length);
  for (const row of rows) {
    const line = row.kind === 'del' ? row.line : row.now;
    const cell = row.kind === 'gap' ? null : cellOf(row.kind === 'del' ? cells.before : cells.now, line);
    if (!cell) { out.push(row); continue; }
    if (cell.key !== shown) out.push({ kind: 'cell', line: '', now: 0, text: cell.words, cell });
    shown = cell.key;
    if (line !== cell.at) out.push({ ...row, num: line - cell.at, ...(cell.kind === 'text' ? { plain: true } : {}) });
  }
  return out;
}

/** The lines of a file to colour as code: in a notebook the head lines and the lines of text cells are left blank, so that a quote in a text does not colour the code under it. */
function codeToColor(code) {
  if (!code.cells) return code.lines;
  const blank = new Set();
  for (const cell of code.cells.now) for (let line = cell.at; line <= cell.at + (cell.kind === 'text' ? cell.length : 0); line++) blank.add(line);
  return code.lines.map((text, at) => (blank.has(at + 1) ? '' : text));
}

/** The rows of a diff: its changed lines with the lines around them, and a quiet row where the lines jump. Rows as in fileRows. */
function diffRows(lines, cells) {
  const rows = [];
  let shown = null; // the last line that is not a removed line
  lines.forEach((line, index) => {
    if (line.sign !== '-' && shown && line.line > shown.line + 1) rows.push({ kind: 'gap', line: '', now: 0, text: '⋯' });
    if (line.sign !== '-') shown = line;
    // A removed line is marked against the next line that is not removed, an added line against the line before its run.
    let at = index;
    if (line.sign === '-') while (at < lines.length && lines[at].sign === '-') at++;
    if (line.sign === '+') while (at >= 0 && lines[at].sign === '+') at--;
    const partner = line.sign !== ' ' && lines[at] && lines[at].sign !== ' ' ? lines[at].text : undefined;
    rows.push({ kind: line.sign === '+' ? 'add' : line.sign === '-' ? 'del' : '', line: line.line, now: line.sign === '-' ? 0 : line.line, text: line.text, partner });
  });
  return cellRows(rows, cells);
}

/** The changes of a file: each run of added and removed rows, as [first row, last row]. */
function changeRuns(rows) {
  const runs = [];
  rows.forEach((row, index) => {
    if (row.kind !== 'add' && row.kind !== 'del') return;
    const last = runs[runs.length - 1];
    if (last && last[1] === index - 1) last[1] = index;
    else runs.push([index, index]);
  });
  return runs;
}

/** True when a row is one of the lines of a note or a mark: removed lines count in the file as it was, other lines in the file now. A mark of several places is { any: [...] }. */
const hits = (row, target) => !!target && (target.any ? target.any.some((one) => hits(row, one)) : target.removed ? row.kind === 'del' && inside(row.line, target.lines) : !!row.now && !!target.lines && inside(row.now, target.lines));

/** The first and the last row of a note or of code lines, or null when none of its lines is among the rows. */
function spanOf(rows, target) {
  let first = -1;
  let last = -1;
  rows.forEach((row, index) => {
    if (!hits(row, target)) return;
    if (first < 0) first = index;
    last = index;
  });
  return first < 0 ? null : [first, last];
}

/** Colours the lines of a file once each, in order, because a string can run over several lines. Gives the HTML of line n, counted from 1. */
function lineColors(lines) {
  const colored = [];
  let open = null;
  return (line) => {
    while (colored.length < line) {
      const result = colorLine(lines[colored.length] ?? '', open);
      open = result.open;
      colored.push(result.html);
    }
    return colored[line - 1];
  };
}

const NARROW = 720; // below this width the notes fold to marks at the right edge, and a note opens as a window
const isNarrow = (into) => into.clientWidth < NARROW;

/**
 * Code with notes, drawn into `holder`. Only the rows in view are drawn; a long line wraps, and a very long one folds.
 * Each note stands at the height of its first row, joined to the middle of its rows, with an arrow to the next note of its function;
 * narrow, a note is a mark beside its rows. The pointer on a note lights its rows, and the pointer on rows lights their note.
 * Options: rows (fileRows or diffRows), notes, scroller (the element that scrolls, or window), path (the file, for Cmd+click),
 * colorOf(row) (the HTML of a row, when the caller colours a whole file), narrow, focus (lines to light and keep lit),
 * top() (the room above the first card), refold (draw again in the other form when the width crosses NARROW; the view returned before is then gone),
 * map (a whole file: the small code map at the right edge, { top() } the room above it; codeMap in code-map.js).
 */
function codeWithNotes(holder, options) {
  const { rows, notes: written = [], scroller, path, colorOf, narrow = false, focus = null, top = () => -8 } = options;
  const notes = written.filter((note) => noteSlots(note, options.marks)['show.shown'] !== false); // a note that the look leaves out is not drawn; counts elsewhere keep it
  const looks = fileLook(path, notes, options.marks); // the margin, the code map and the lines beside the notes in the look
  const map = looks.map['show.shown'] === false ? null : options.map ?? null;
  // The map lies under the column of the notes; a file with no notes has it in a column of its own.
  const side = notes.length ? `<div class="notes${narrow ? ' narrow' : ''}"></div>` : map ? `<div class="mside" style="width:${narrow ? MAP_NARROW : MAP_WIDTH}px"></div>` : '';
  // The class "with-map" is there before the width of the code is measured: narrow, the map takes room beside the marks.
  holder.innerHTML = `<div class="cn${map && CodeMap.on ? ' with-map' : ''}"><div class="code"><div class="rowsbox"></div></div>${side}</div>`;
  const box = holder.querySelector('.rowsbox');
  const column = holder.querySelector('.notes');
  const sizes = rows.map((row) => Wrap.measure(row.text));
  const opened = new Set(); // very long lines that he unfolded
  const marks = { lit: focus && { lines: focus }, step: null, near: null, flash: null, nothing: null, cur: null, threads: new Map(), bubbles: new Map() };
  let columns = codeColumns(box);
  let width = box.clientWidth;

  const fullRows = (index) => Wrap.rows(sizes[index], columns);
  const folded = (index) => fullRows(index) > FOLD_ROWS && !opened.has(index);
  const rowHtml = (index) => {
    const row = rows[index];
    if (row.kind === 'gap') return `<div class="l gap" data-row="${index}"><span class="n"></span><span class="g"></span><span class="x">⋯</span></div>`;
    if (row.kind === 'cell') {
      const words = [row.cell.state, row.cell.output ? 'output not shown' : ''].filter(Boolean).map((word) => `<i>${esc(word)}</i>`).join('');
      return `<div class="l cell" data-row="${index}"><span class="n"></span><span class="g"></span><span class="x">${esc(row.text)}${words}</span></div>`;
    }
    const hang = Wrap.hang(sizes[index].indent, columns);
    const text = folded(index)
      ? `${esc(row.text.slice(0, columns + (FOLD_ROWS - 1) * (columns - hang)))}<a class="more" data-unfold="${index}">Show all ${number(row.text.length)} characters</a>`
      : row.partner !== undefined ? markedWords(row.text, row.partner) : row.plain ? esc(row.text) : colorOf?.(row) ?? colorLine(row.text, null).html;
    const kinds = [row.kind, ...['lit', 'step', 'near', 'flash', 'nothing', 'cur'].filter((name) => hits(row, marks[name]))].join(' ');
    const thread = row.now && marks.threads.get(row.now);
    const bubble = (row.now && row.kind !== 'del' && marks.bubbles.get(row.now)) || ''; // the mark of the comments that start on this line, at the end of its text
    const mark = row.now && row.kind !== 'del' && looks.margin.get(row.now); // the icon of a mark in the margin, when a rule shows it
    const icon = mark ? `<span class="mg" data-mg="${row.now}" data-tip="${esc(mark.name)}">${mark.icon ? `<img src="${esc(mark.icon)}" alt="">` : esc(mark.name[0] ?? '?')}</span>` : '';
    // A removed row has its line in the file as it was: a comment on it goes on the old side of the diff. A line of the file now tells VS Code its
    // number for the right-click entries of a look in the file tab (data-vscode-context, read by VS Code itself).
    return `<div class="l ${kinds}" data-row="${index}"${row.now ? ` data-line="${row.now}" data-vscode-context='{"webviewSection":"codeLine","line":${row.now}}'` : row.kind === 'del' ? ` data-old="${row.line}"` : ''}${thread ? ` data-thread="${thread}"` : ''}>`
      + `<span class="n">${icon}${row.num ?? row.line}</span><span class="g">${row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}</span>`
      + `<span class="x" style="padding-left:${hang}ch;text-indent:-${hang}ch">${text}${bubble}</span></div>`;
  };
  const list = virtualRows(scroller, box, rows.length, rowHtml, (index) => (folded(index) ? FOLD_ROWS + 1 : fullRows(index)));

  const view = {
    rows, box, list,
    get columns() { return columns; }, // the characters in one visual row
    span: (target) => spanOf(rows, target),
    place: () => {},
    /** Sets a mark (lit, step, near, flash, nothing, cur: lines, a note with `removed`, or { any: [...] }; threads: by line; bubbles: the mark of comments by line) and draws the rows in view again. */
    mark(name, value) {
      marks[name] = Array.isArray(value) ? { lines: value } : value;
      list.refresh();
    },
    /** A new width of the box: works the heights of the rows out again, and keeps the row at the top of an element that scrolls at its top. */
    fit() {
      if (!box.isConnected) return resized.disconnect();
      if (box.clientWidth === width) return;
      if (options.refold && isNarrow(holder) !== narrow) {
        resized.disconnect();
        return void codeWithNotes(holder, { ...options, narrow: !narrow });
      }
      const intoBox = () => (scroller === window ? 0 : scroller.getBoundingClientRect().top) - box.getBoundingClientRect().top;
      const keep = scroller !== window && intoBox() > 0 ? list.rowAt(intoBox() + 1) : -1;
      width = box.clientWidth;
      columns = codeColumns(box);
      list.resize();
      if (keep >= 0) scroller.scrollTop += list.top(keep) - intoBox();
      view.place();
    },
  };
  const resized = new ResizeObserver(() => view.fit());
  resized.observe(box);

  box.addEventListener('click', (event) => {
    // "Show all 30,000 characters" unfolds a very long line.
    const more = event.target.closest('[data-unfold]');
    if (more) {
      opened.add(Number(more.dataset.unfold));
      list.resize();
      view.place();
      return;
    }
    // The icon of a mark in the margin: a window with the places of its value in the file, as a click on a mark of a note card.
    const icon = event.target.closest('[data-mg]');
    if (icon) return marginWindow(icon, path, looks.margin.get(Number(icon.dataset.mg)).key, options.marks);
    // Cmd+click on a line number opens the file in VS Code at that line; nothing else here opens an editor.
    const line = Number(event.target.closest('.n')?.parentElement.dataset.line);
    if (line && path && event.metaKey) App.openFile(path, [line, line]);
  });
  /** The small code map, with a mark for the rows of each note (`spans`): drawn again after each new place of the cards. */
  const addMap = (spans) => {
    if (!map) return;
    const drawn = codeMap(holder.querySelector('.notes, .mside'), {
      scroller, view, spans, narrow, top: map.top, holder: holder.firstChild, tint: looks.tint,
      rowHtml: (index) => (rows[index].plain ? esc(rows[index].text) : colorOf?.(rows[index]) ?? colorLine(rows[index].text, null).html),
    });
    const placeCards = view.place;
    view.place = () => { placeCards(); drawn.soon(); };
  };
  if (!notes.length) { addMap([]); return view; }

  // The rows of each note, from the row of its first line to the row of its last; a note with no row here stands at the top.
  // In the order of the first rows; of two notes that start on one row, the wider first (a function before its first step).
  const spans = notes.map((note) => spanOf(rows, note) ?? [0, 0]);
  const order = notes.map((_, index) => index).sort((a, b) => spans[a][0] - spans[b][0] || spans[b][1] - spans[a][1]);
  const sorted = order.map((index) => notes[index]);
  const spansInOrder = order.map((index) => spans[index]);
  const lanes = lanesOf(spansInOrder);
  // A head is a note that holds a note of a later lane: a function with its steps. Its join meets its first row only, not the middle of all its steps.
  const heads = spansInOrder.map(([first, last], index) => spansInOrder.some(([from, to], at) => lanes[at] > lanes[index] && first <= from && to <= last));
  // The first note of each function names it with its test count; its other notes show nothing of it.
  const tones = sorted.map((note, index) => toneOf(rows, note, spansInOrder[index]));
  const cards = sorted.map((note, index) => noteCard(note, !!note.symbol && sorted.findIndex((other) => other.symbol === note.symbol) === index, tones[index]));
  cards.forEach((card, index) => lookOfNote(card, sorted[index], options.marks));
  // The note under the pointer: the narrowest note that holds the row, so a row of a step lights the step and not its function.
  const noteAt = (row, among = sorted) => { const note = narrowestAt(among, (one) => [one], rows, row); return note ? sorted.indexOf(note) : -1; };
  const resting = focus ? noteAt(rows.findIndex((row) => row.now === focus[0]), sorted.filter((note) => !note.removed)) : -1;
  let lit = null;
  const light = (index) => {
    if (index === lit) return;
    lit = index;
    // A card that shows its title only opens to its whole text while it is lit; it lies over the cards below it and moves none of them.
    cards.forEach((card, at) => { card.classList.toggle('cur', at === index); card.classList.toggle('open', at === index && card.classList.contains('brief')); });
    column.querySelectorAll('.mk, [data-join]').forEach((mark, at) => mark.classList.toggle('cur', at === index));
    view.mark('lit', index >= 0 ? sorted[index] : focus && { lines: focus });
  };
  // The cards stand in the column; the rows start lower than the column when something stands above them (the control of a file tab).
  const shift = () => box.getBoundingClientRect().top - column.getBoundingClientRect().top;
  if (narrow) {
    // Narrow: a mark beside the rows of each note, in its lane; the pointer on it lights the rows and opens the note as a window.
    column.style.width = `${14 + Math.max(...lanes) * MARK_LANE}px`;
    const noteMarks = sorted.map((note, index) => {
      const mark = html(`<i class="mk ${tones[index]}" style="left:${4 + lanes[index] * MARK_LANE}px"></i>`);
      column.append(mark);
      mark.addEventListener('mouseenter', () => light(index));
      mark.addEventListener('mouseleave', () => light(resting));
      Hover.attach(mark, () => ({ title: 'Note', sub: esc(`${whereText(note)}${note.removed ? ', removed' : ''}`), width: 320, pad: true, body: lookOfNote(noteCard(note, false, tones[index]), note, options.marks) }), mark);
      return mark;
    });
    // Two marks one after the other keep a small gap, so that they read as two.
    view.place = () => noteMarks.forEach((mark, index) => {
      const [first, last] = spansInOrder[index];
      const [from, to] = [list.top(first), list.top(last + 1)];
      Object.assign(mark.style, { top: `${shift() + from + 1}px`, height: `${Math.max(list.height, to - from) - 2}px` });
    });
  } else {
    if (looks.column['window.width']) column.style.width = `${looks.column['window.width']}px`; // the width of the notes column in the look
    // Wide: each card at the height of its first row (cardPlaces), joined to its rows by a line; the card of a step one lane in under its function.
    // The notes of one function in a change are its numbered steps: an arrow goes from each to the next, with room for it between two cards.
    const follows = (index) => index > 0 && !sorted[index].from && !sorted[index - 1].from && !!sorted[index].symbol && sorted[index].symbol === sorted[index - 1].symbol;
    const room = (index) => (follows(index) ? 22 : lanes[index] ? 4 : 8);
    cards.forEach((card, index) => { card.style.left = `${GUTTER + lanes[index] * LANE}px`; });
    column.append(...cards);
    view.place = () => {
      const down = shift();
      const middle = ([first, last]) => down + (list.top(first) + list.top(last + 1)) / 2;
      // The heights first, all in one read: one card as a title, then every card whole.
      for (const card of cards) card.classList.remove('brief', 'open');
      cards[0].classList.add('brief');
      const shortHeight = cards[0].offsetHeight;
      cards[0].classList.remove('brief');
      const full = cards.map((card) => card.offsetHeight);
      const placed = cardPlaces(spansInOrder.map(([first]) => down + list.top(first)), full, shortHeight, room, top(), looks.rank ? (index) => index + 1 < sorted.length && looks.rank(sorted[index]) < looks.rank(sorted[index + 1]) : undefined);
      cards.forEach((card, index) => {
        card.classList.toggle('brief', placed.short[index]);
        card.classList.toggle('open', index === lit && placed.short[index]);
        card.style.top = `${placed.tops[index]}px`;
      });
      column.style.minHeight = `${placed.bottom + 16}px`;
      const boxes = cards.map((_, index) => ({ top: placed.tops[index], height: placed.short[index] ? shortHeight : full[index], left: GUTTER + lanes[index] * LANE, tone: tones[index] }));
      column.querySelector('svg.links')?.remove();
      column.insertAdjacentHTML('afterbegin', noteLinks(boxes, spansInOrder.map((span, index) => middle(heads[index] ? [span[0], span[0]] : span)), follows, { line: (index) => looks.line(sorted[index]), order: (index) => looks.order(sorted[index]) }));
      column.querySelector(`[data-join="${lit}"]`)?.classList.add('cur');
    };
    cards.forEach((card, index) => {
      card.addEventListener('mouseenter', () => light(index));
      card.addEventListener('mouseleave', () => light(resting));
      const linked = card.querySelector('[data-linked]');
      if (linked) Hover.attach(linked, testsWindow(`linked:${sorted[index].key}`), card);
    });
    attachTestWindows(column);
  }
  addMap(spansInOrder);
  view.place();
  // The pointer on rows lights their note, removed rows too.
  box.addEventListener('mousemove', (event) => {
    const row = Number(event.target.closest('[data-row]')?.dataset.row ?? -1);
    const index = row >= 0 ? noteAt(row) : -1;
    light(index >= 0 ? index : resting);
  });
  box.addEventListener('mouseleave', () => light(resting));
  light(resting);
  return view;
}

/** The window of a value of a mark in the margin of the code: its places in the file, grouped by named thing; a click on a place shows its line. */
function marginWindow(el, path, key, marks = []) {
  const own = marks.filter((mark) => mark.file === path && Marks.keyOf(mark) === key);
  const name = App.page.look?.values[key]?.name ?? key.split(':')[1];
  Hover.now(el, () => ({
    title: name, sub: plural(own.length, 'place'), width: 440, body: Marks.placesHtml(own),
    ready: (body) => body.addEventListener('click', (event) => {
      const place = event.target.closest('[data-mk-open]');
      if (place) { Hover.hide(); App.showCode(place.dataset.mkOpen, [Number(place.dataset.mkLine), Number(place.dataset.mkLine)]); }
    }),
  }));
}

/** What stands in place of the text of a file that has none to show: the picture, before and after, or one line that says what it is. */
async function factHtml(file) {
  const pictures = file.picture ? await ask(`picture:${file.path}`) : null;
  const sides = [['Before', pictures?.before], ['Now', pictures?.after]].filter(([, side]) => side);
  if (!sides.length) return `<p class="fact">${esc(file.what)}</p>`;
  return `<div class="pics">${sides.map(([word, side]) => `<figure><img src="${side.src}" alt="${word}"><figcaption>${word} · ${esc(side.size)}</figcaption></figure>`).join('')}</div>`;
}

/** "renamed from <old path>" for a renamed file, as HTML; nothing for any other file. */
const renamedHtml = (file) => (file?.renamedFrom ? `<span class="from">renamed from ${esc(file.renamedFrom)}</span>` : '');

const LEAD = 3; // rows shown above the lines that a note or a comment brings into view (Code.reveal); a key goes by the rule of a step

/** The code of one whole file: in a file tab, or beside the diagram of a part. Its file, rows, changes, the code with notes, and its steps (changeSteps). */
const Code = {
  shown: null,

  /** Sets a mark of the rows: lines, or a note or comment target with `removed`; threads by line. */
  mark(name, value) {
    this.shown?.view?.mark(name, value);
  },

  /** Scrolls so that a row stands a few rows below the top. */
  scrollToRow(index) {
    const { scroller, box, list } = this.shown;
    scroller.scrollTop = index < LEAD ? 0 : box.offsetTop + list.top(index - LEAD);
  },

  /** Brings lines of the file into view: lines, or a note or comment target with `removed`. */
  reveal(target) {
    const span = this.shown?.view?.span(Array.isArray(target) ? { lines: target } : target);
    if (span) this.scrollToRow(span[0]);
  },

  /** Alt+Down and Alt+Up, by the rule of a step. A file tab with no rows to show goes on to the next or the previous file. */
  step(direction) {
    if (this.shown?.steps) this.shown.steps.step(direction);
    else if (this.shown && App.state.view === 'code') App.step(direction, direction > 0 ? 'first' : 'last');
  },
};

/**
 * The steps of one whole file in `scroller` (a file tab, the file beside the diagram of a part, the file of "Diffs"): the one rule of a step over its changes.
 * `holder` holds the code with notes (`view`). head(): the head that sticks over the file; past(direction): what a key does after its last change; nav: the counter.
 * files(): the files that the counter counts over (changeCounts on "Diffs"), else this file alone.
 */
function fileSteps(holder, scroller, path, view, { head = () => 0, past = null, nav = null, files = null } = {}) {
  holder.dataset.file = path;
  holder.view = view;
  const runs = changeRuns(view.rows).length;
  return changeSteps(scroller, { sections: () => [holder], files: files ?? (async () => [{ path, runs }]), reach: async (one) => (one === path ? holder : null), head, past }, { nav });
}

/**
 * The words and arrows of the quiet control: "file 4 of 47" with ‹ and ›, and "change 3 of 12" with ↑ and ↓. `file` and `cur` count from 0, -1 for none;
 * with `steps` false the changes are left out.
 */
function navHtml(file, files, cur, changes, steps = true) {
  const fileWords = file >= 0 ? `file ${number(file + 1)} of ${number(files)}` : plural(files, 'changed file');
  const changeWords = !changes ? 'no change' : cur >= 0 ? `change ${number(cur + 1)} of ${number(changes)}` : plural(changes, 'change');
  return `<a data-step="-1" title="Previous file (K)">‹</a><a data-files title="Every changed file">${fileWords}</a><a data-step="1" title="Next file (J)">›</a>`
    + (steps ? `<span class="gap"></span><a data-change="-1" title="Previous change (Alt+Up)">↑</a><span>${changeWords}</span><a data-change="1" title="Next change (Alt+Down)">↓</a>` : '');
}

/**
 * The counter of a list of changes, from its numbers (the count of changeSteps). A changed file with no lines to step through
 * (a picture, an empty file, a link, a new mode) gets no "no change": it is changed.
 */
const counterHtml = ({ file, files, cur, changes }) => navHtml(file, files, cur, changes, changes > 0 || file < 0);

/** The quiet control at the top right of a file tab, at once while it opens; the steps of the file write it again after each key and each rest of the scroll. */
function drawNav() {
  const nav = document.querySelector('.cvw .nav .steps');
  if (!nav || !Code.shown) return;
  if (App.page.plain) return void (nav.innerHTML = ''); // a file with no change: nothing to step through
  const order = App.order();
  const changes = Code.shown.runs.length;
  nav.innerHTML = counterHtml({ file: order.indexOf(Code.shown.path), files: order.length, cur: changes ? 0 : -1, changes });
}

/**
 * The file view: one whole file with its notes, in a box of its own that scrolls (`.cv`), drawn into `into`. Added lines have the added background;
 * removed lines stand in place with the removed background. Each note is a card beside its lines when the box has the width (NARROW), else a mark at the edge.
 * A file with no text says what it is, or shows its picture. The file tab and the left half of "Diffs" use it.
 * Options: focus (lines to light and keep lit); nav (the control of a file tab stands over the box); head (the name of the file with its counts at the top of
 * the box, as beside the diagram of a part); fill (the box takes the height that is left in the tab; else its holder gives it a height).
 * Returns { scroller, holder, view, rows }, with no view and rows for a file with no text; null when there is no code to show.
 */
async function fileView(into, path, { focus = null, nav = false, head = false, fill = true } = {}) {
  const page = App.page;
  const file = page.files.find((candidate) => candidate.path === path);
  const name = head ? `<div class="fh" ${Places.attrs({ kind: 'file', file: path })}><a data-open-file="${esc(path)}">${esc(path)}</a>${renamedHtml(file)}<i class="c">${countsHtml(file)}</i></div>`
    : file?.renamedFrom ? `<p class="fact">${renamedHtml(file)}</p>` : '';
  const edit = nav && App.tab ? `<a data-edit title="Open this file in the editor of VS Code (${/Mac/.test(navigator.platform) ? 'Cmd' : 'Ctrl'}+Shift+,). The same key brings the notes back.">Edit</a>` : '';
  const shell = (inside) => `<div class="cv">${name}${inside}</div>${nav ? `<div class="nav"><span class="steps"></span>${edit}</div>` : ''}`;
  if (file?.what) {
    into.innerHTML = shell(await factHtml(file));
    return { scroller: into.querySelector('.cv'), holder: null, view: null, rows: null };
  }
  const code = await ask(`code:${path}`);
  if (!code) { into.innerHTML = '<p class="quiet">There is no code to show for this file.</p>'; return null; }
  const rows = fileRows(code);
  const notes = [...page.notes.filter((note) => note.file === path), ...(code.notes ?? [])]; // the notes of the change, then those of other saved changes
  // The notes column stands in place while the width is measured: beside code with notes the comments window lies over that column and takes no room of its own (look.css).
  into.innerHTML = shell(`<div class="cvc">${notes.length ? '<div class="cn"><div class="notes"></div></div>' : ''}</div>`);
  const scroller = into.querySelector('.cv');
  const holder = into.querySelector('.cvc');
  const narrow = isNarrow(into) || (!!page.look && Marks.slotsIn(page.look, { kind: 'notes-column', paths: [path], fields: {} })['show.folded'] === true); // folded by a rule: the marks at the edge
  if (nav) scroller.classList.toggle('narrow', narrow); // narrow, the control stands over the first row
  if (fill) fillHeight(scroller);
  const color = lineColors(codeToColor(code));
  const view = codeWithNotes(holder, {
    rows, notes, scroller, path, narrow, focus, marks: code.marks,
    colorOf: (row) => (row.now ? color(row.now) : undefined), top: () => (nav ? into.querySelector('.nav').offsetHeight : 0) - 8,
    map: { top: () => (nav ? into.querySelector('.nav').offsetHeight : 0) },
  });
  return { scroller, holder, view, rows };
}

/**
 * Draws one whole file with its notes in a file tab (fileView), with the control of the files and the steps through its changes.
 * `focus` is a range of lines to show and light; `at` is "first" or "last" to start at that change.
 */
async function drawCode(into, path, focus, at) {
  const page = App.page;
  into.innerHTML = `<div class="cvw" data-file="${esc(path)}"></div>`;
  const shown = await fileView(into.firstChild, path, { focus, nav: true });
  // The comments window lies over the notes column, below the control of the files (look.css).
  const notesTop = () => document.body.style.setProperty('--notes-top', `${Math.round(into.querySelector('.nav').getBoundingClientRect().bottom + 4)}px`);
  if (!shown) return;
  if (!shown.view) {
    Code.shown = { path, runs: [] };
    drawNav();
    return notesTop();
  }
  const { scroller, holder, view, rows } = shown;
  const steps = fileSteps(holder, scroller, path, view, {
    nav: page.plain ? null : into.querySelector('.nav .steps'), past: (direction) => App.step(direction, direction > 0 ? 'first' : 'last'),
  });
  Code.shown = { path, rows, runs: changeRuns(rows), scroller, box: view.box, list: view.list, view, steps };
  // "Edit" and a double click on a line: VS Code changes this tab to its editor, at the first line in view or at that line (the key of the notes).
  into.querySelector('[data-edit]')?.addEventListener('click', () => tell({ type: 'edit', line: firstLineInView() }));
  if (App.tab) holder.addEventListener('dblclick', (event) => { const line = Number(event.target.closest('[data-line]')?.dataset.line); if (line) tell({ type: 'edit', line }); });
  drawNav();
  view.place(); // the control of the files has its height now
  notesTop();

  // Where the file opens: at the lines asked for, else as a key that comes into it from the file before (its first change) or after it (its last change).
  if (focus) Code.reveal({ lines: focus });
  else steps.enter(at === 'last' ? -1 : 1);
  steps.ready.catch((error) => console.error(error));
}

/** The first line of the file tab that is in view: its row is more than half in view (a removed row counts as the line after it). */
function firstLineInView() {
  const { scroller, box, list, rows } = Code.shown;
  let index = list.rowAt(scroller.getBoundingClientRect().top - box.getBoundingClientRect().top + list.height / 2);
  while (index < rows.length - 1 && !rows[index].now) index++;
  return rows[index]?.now || 1;
}

// ----- the Diffs page -----

const FIRST_FILES = 20; // the files shown under each part; the rest wait behind "57 more files in <part>"
const FIRST_FOLDED = 5; // of them, the folded rows (data files, generated files): twenty rows that look the same fill a screen
const DATA_FILE = Look.DATA_FILE; // data files start folded

/**
 * The changed files of the change, by part: the parts in order, then the files in no part; generated files are left out. A rule of the look on the
 * files of the list ("diff-file") leaves files out, orders the files of each part, or groups them by another field; a part with no file left goes.
 */
function filesByPart(page = App.page) {
  const generated = new Set(page.checks.generated);
  const slots = fileSlots(page);
  const changed = (path) => page.files.some((file) => file.path === path) && !generated.has(path) && slots(path)['show.shown'] !== false;
  const groups = page.parts.map((part) => ({ id: part.id, name: part.name, paths: part.files.filter(changed) }));
  groups.push({ id: 'no-part', name: 'In no part', paths: page.checks.filesInNoPart.filter(changed) });
  const shown = groups.filter((group) => group.paths.length);
  if (!page.look) return shown;
  const rows = (paths) => paths.map((path) => slots.things.get(path));
  const order = Look.listOrder(rows(shown.flatMap((group) => group.paths)), page.look);
  if (order.group && order.group !== 'part') return Look.orderRows(rows(shown.flatMap((group) => group.paths)), order).map(({ group, rows: own }) => ({ name: String(group || 'none'), paths: own.map((row) => row.id) }));
  return shown.map((group) => ({ ...group, paths: Look.orderRows(rows(group.paths), order)[0].rows.map((row) => row.id) }));
}

/** The slots that the look gives each file of the list of diffs, by path ({} with no look); `things` holds the file as a thing of the look. */
function fileSlots(page) {
  const things = new Map(Look.changeThings(page, 'diff-file').map((thing) => [thing.id, thing]));
  const slots = (path) => (page.look && things.has(path) ? Look.slotsIn(page.look, things.get(path)) : {});
  return Object.assign(slots, { things });
}

/**
 * The list of diffs: one list that scrolls through every changed file, part by part, in its own `scroller`; `part` keeps only the files of that part.
 * Each file is a head (a mark, its path, its counts) and, when it is open, its changed lines with the notes beside them. The name of a part stays at the
 * top of the list while its files are in view, with the head of the file in view under it. With `closed` every file starts closed, else open.
 * An open diff is filled when it comes near the view. Under each part the first files show; data files and generated files start closed and say so
 * on their row (class "quiet"), at most five before the fold "57 more files in <part>". "Open all" opens every other diff; while one is open the control is "Close all". A click on the head of a file opens or closes its diff, and
 * the name of the file opens its tab. With `rows` ("Diffs" beside the file) no row opens: each is one line, its folder quiet and cut at its left end, and
 * a click on it is for `onHead`.
 * Returns the list: { el, open, close, toggle, setAll, anyOpen }; `onHead(section)`, `onAll(open)` and `onChange()`, when set, hear a click on a head,
 * "Open all" or "Close all", and any diff that opens or closes.
 */
function drawDiffs(into, { scroller, part, closed = false, rows = false }) {
  const { page } = App;
  const fileOf = (path) => page.files.find((candidate) => candidate.path === path);
  const slots = fileSlots(page); // the look of each file of the list: the fields of its head, an icon, a click
  const fields = (path) => slots(path).content?.fields;
  const folder = (path) => path.slice(0, path.lastIndexOf('/') + 1);
  const icon = (path) => (page.look?.files[slots(path)['text.icon']] ? `<img class="lk-icon" src="${esc(page.look.files[slots(path)['text.icon']])}" alt="">` : '');
  const shownPath = (path) => (!fields(path) || fields(path).includes('path') ? path : baseName(path));
  const name = (path) => (rows ? `${icon(path)}<span class="dir"><bdi dir="ltr">${esc(folder(shownPath(path)))}</bdi></span><span class="nm">${esc(baseName(path))}</span>`
    : `<i class="tw"></i>${icon(path)}<a data-open-file="${esc(path)}">${esc(shownPath(path))}</a>${renamedHtml(fileOf(path))}`);
  const tip = (path) => (rows ? ` title="${esc(path)}${fileOf(path).renamedFrom ? ` (renamed from ${esc(fileOf(path).renamedFrom)})` : ''}"` : '');
  // Its counts, or the facts that a rule names in their order: the lines added, the lines removed, and its type (code, data, generated).
  const facts = (path) => (fields(path) ?? ['added', 'removed']).map((field) => (field === 'added' ? countsHtml({ added: fileOf(path).added })
    : field === 'removed' ? countsHtml({ removed: fileOf(path).removed }) : field === 'type' ? esc(slots.things.get(path)?.fields.type ?? '') : '')).filter(Boolean).join(' ');
  const head = (path, more = '') => `<div class="dh"${tip(path)} ${Places.attrs({ kind: 'file', file: path, view: 'diffs' })}>${name(path)}`
    + `<i class="c">${facts(path)}${more || (fileOf(path).quiet ? ` · ${esc(fileOf(path).quiet)}` : '')}</i></div>`;
  const of = (group) => (group.id ? ` data-part="${esc(group.id)}"` : '');
  const room = (path) => Math.min(fileOf(path).added + fileOf(path).removed + 6, 400) * 18; // the height of a diff before it is filled
  const body = (path) => `<div class="dbody"><div class="dfw" style="height:${room(path)}px"></div></div>`;
  const open = (path, group) => `<section class="dfile ${closed ? 'shut' : 'open'}" data-file="${esc(path)}"${of(group)}>${head(path)}${closed ? '' : body(path)}</section>`;
  const foldRow = (path, group, word) => `<section class="dfile shut quiet" data-file="${esc(path)}"${of(group)}>${head(path, ` · ${closed ? word : `${word}, folded`}`)}</section>`;
  const block = (path, group) => (group.generated ? foldRow(path, group, 'generated') : DATA_FILE.test(path) ? foldRow(path, group, 'data')
    : fileOf(path).notebook === 'only-outputs' ? foldRow(path, group, fileOf(path).quiet) : open(path, group));
  const generated = part ? [] : page.checks.generated.filter((path) => fileOf(path) && slots(path)['show.shown'] !== false);
  const groups = [...filesByPart().filter((group) => !part || group.id === part), ...(generated.length ? [{ name: 'Generated', paths: generated, generated: true }] : [])];
  // The files of a part that show at first: the first 20, with at most 5 folded rows among them.
  for (const group of groups) {
    let folded = 0;
    group.first = group.paths.slice(0, FIRST_FILES).filter((path) => !(group.generated || DATA_FILE.test(path) || fileOf(path).notebook === 'only-outputs') || ++folded <= FIRST_FOLDED);
    group.rest = group.paths.filter((path) => !group.first.includes(path));
  }
  // Each part is a group of its own, so that its name stays at the top only while its files are in view.
  into.innerHTML = `<div class="diffs${rows ? ' rows' : ''}">` + groups.map((group, index) => `<div class="dgroup"><div class="dp"${of(group)}>${esc(group.name)}</div>${group.first.map((path) => block(path, group)).join('')}`
    + (group.rest.length ? `<a class="dmore" data-more-files="${index}"${of(group)}>${plural(group.rest.length, 'more file')} in ${esc(group.name)}</a>` : '') + '</div>').join('') + '</div>';
  const el = into.firstChild;
  el.scroller = scroller; // the code of each file draws its rows as this scrolls

  const load = new IntersectionObserver((seen) => {
    for (const entry of seen) {
      if (!entry.isIntersecting) continue;
      load.unobserve(entry.target);
      if (entry.target.isConnected) fillDiff(entry.target.closest('.dfile'));
    }
  }, { root: scroller, rootMargin: '800px 0px' });
  const watch = (within) => within.querySelectorAll('.dfile .dfw').forEach((box) => load.observe(box));
  watch(el);

  const list = {
    el, onHead: null, onAll: null, onChange: null,
    isOpen: (section) => !!section?.classList.contains('open'),

    /** Opens the diff of a file below its head: filled at once and in a short animation, or with `fill` false filled when it comes near the view. */
    async open(section, { animate = true, fill = true } = {}) {
      if (!section || list.isOpen(section)) return;
      section.classList.replace('shut', 'open');
      list.onChange?.();
      section.querySelector('.dbody')?.remove(); // one that was still closing
      delete section.filling; // a diff that was open before is filled again
      delete section.view;
      section.insertAdjacentHTML('beforeend', fill ? '<div class="dbody"><div class="dfw"></div></div>' : body(section.dataset.file));
      const opened = section.lastElementChild;
      if (!fill) return void load.observe(opened.firstChild);
      await fillDiff(section);
      if (section.lastElementChild === opened && animate) await fold(opened, true);
    },

    /** Closes the diff of a file to its head. */
    async close(section, { animate = true } = {}) {
      if (!list.isOpen(section)) return;
      section.classList.replace('open', 'shut');
      list.onChange?.();
      delete section.view;
      const opened = section.querySelector('.dbody');
      if (animate) await fold(opened, false);
      if (!list.isOpen(section)) opened.remove();
    },

    toggle: (section) => (list.isOpen(section) ? list.close(section) : list.open(section)),

    /** True when a diff of the list is open: the control then closes them all. */
    anyOpen: () => !!el.querySelector('.dfile.open'),

    /** "Open all" opens every diff of the list, each filled when it comes near the view; "Close all" closes them, with the file at the top kept there. */
    setAll(opened) {
      const { sections, now } = topFile(scroller, partHead(el));
      const kept = sections[now];
      for (const section of el.querySelectorAll('.dfile:not(.quiet)')) {
        if (opened) list.open(section, { fill: false });
        else list.close(section, { animate: false });
      }
      for (const section of el.querySelectorAll('.dfile.quiet.open')) if (!opened) list.close(section, { animate: false });
      if (kept) scroller.scrollTop += kept.getBoundingClientRect().top - scroller.getBoundingClientRect().top - partHead(el);
      list.onAll?.(opened);
    },
  };

  // A click on the head of a file opens or closes its diff (its name opens its tab); "57 more files" shows the rest of its part.
  el.addEventListener('click', (event) => {
    if (event.target.closest('[data-open-file]') || document.body.classList.contains('picking')) return;
    const more = event.target.closest('[data-more-files]');
    if (more) {
      const group = groups[more.dataset.moreFiles];
      const rest = html(`<div>${group.rest.map((path) => block(path, group)).join('')}</div>`);
      more.replaceWith(...rest.children);
      return watch(el);
    }
    const section = event.target.closest('.dfile > .dh')?.parentElement;
    const target = section && slots(section.dataset.file).click; // a click of the look goes to its target instead
    if (target) return Marks.act(target, section);
    if (section) (list.onHead ?? list.toggle)(section);
  });
  return list;
}

/** The height of the name of a part that stays at the top of a list of diffs, over the head of its file. */
const partHead = (within) => within.querySelector('.diffs .dp')?.offsetHeight ?? 0;

/** Fills one file of the Diffs page: what it is, or its changed lines with the notes of those lines beside them. Once: a second call waits for the first. */
function fillDiff(section) {
  section.filling ??= drawDiff(section);
  return section.filling;
}

async function drawDiff(section) {
  const path = section.dataset.file;
  const file = App.page.files.find((candidate) => candidate.path === path);
  const holder = section.querySelector('.dfw');
  if (file.what) { holder.outerHTML = await factHtml(file); return; }
  const lines = await ask(`diff:${path}`);
  if (!lines?.length) { holder.outerHTML = `<p class="quiet">${file.quiet ? `${esc(file.quiet[0].toUpperCase())}${esc(file.quiet.slice(1))}.` : 'No changed lines.'}</p>`; return; }
  holder.style.height = '';
  const rows = diffRows(lines, file.cells);
  const all = App.page.notes.filter((note) => note.file === path);
  const notes = all.filter((note) => spanOf(rows, note));
  // A note whose lines are not here is counted on the head of the file; the click opens the file tab.
  if (notes.length < all.length) {
    section.querySelector('.dh .c').insertAdjacentHTML('beforeend', ` · <a data-open-file="${esc(path)}">${plural(all.length - notes.length, 'more note')} in the file</a>`);
  }
  const list = section.closest('.diffs');
  if (!list) return; // closed meanwhile
  section.view = codeWithNotes(holder, { rows, notes, scroller: list.scroller ?? window, path, narrow: isNarrow(holder), refold: true });
  Remarks.paintNotes(holder);
}

/** The file of a Diffs list that is at the top of what shows in the element that it scrolls in, under the name of its part (`over` pixels high). */
function topFile(scroller, over = 0) {
  const top = scroller.getBoundingClientRect().top + over;
  const sections = [...scroller.querySelectorAll('.diffs .dfile')];
  const now = sections.findIndex((section) => section.getBoundingClientRect().bottom > top + 4);
  return { sections, now, top };
}

/** J and K on the Diffs page: the file that comes to the top next, or the one before (the start of the file at the top, when it shows from its middle). */
function stepDiffs(direction, scroller) {
  const { sections, now, top } = topFile(scroller, partHead(scroller));
  const back = direction < 0 && sections[now]?.getBoundingClientRect().top < top - 4 ? 0 : direction; // K inside a file goes to its start
  return sections[Math.max(0, Math.min(sections.length - 1, now + back))];
}

// ----- reading through the Diffs list: the reading line, the diagrams of the code there, and the steps over every change -----

/** The part of a file, or "no-part". */
const partOfFile = (page, path) => page.parts.find((part) => part.files.includes(path))?.id ?? 'no-part';

/** True when a place holds a row: a removed row is in removed lines, or counts at the line now that it stands before. A whole file holds no row. */
function holdsRow(rows, index, place) {
  const row = rows[index];
  if (!row || !place.lines) return false;
  if (place.removed) return hits(row, place);
  let at = index;
  while (at < rows.length && !rows[at].now) at++;
  return !!rows[at]?.now && inside(rows[at].now, place.lines);
}

/** Of `things`, the one with the narrowest place (`placesOf(thing)`) that holds a row; null when none holds it. A row inside a function lights its step, not the whole participant. */
function narrowestAt(things, placesOf, rows, index) {
  const size = (thing) => Math.min(...placesOf(thing).filter((place) => holdsRow(rows, index, place)).map((place) => place.lines[1] - place.lines[0]));
  return things.filter((thing) => placesOf(thing).some((place) => holdsRow(rows, index, place))).sort((a, b) => size(a) - size(b))[0] ?? null;
}

/**
 * The diagrams that the code of a file belongs to, as [{ id, lit }]: each diagram of a part with a thing that has a place in the file, or whose own file it is.
 * `lit` are the keys of its things with a place that holds a row of `run` ([first, last] of `rows`, or null).
 * The order: the schema of a file that builds one first, so that the schema stands beside such a file, then the diagrams with a lit thing, then the others.
 * A way out of a decision has the code of its decision: it lights with the decision only, not by itself.
 */
function thingsAt(diagrams, path, rows, run) {
  const holds = (code) => !!run && !code.filled && code.places.some((place) => {
    if (place.file !== path) return false;
    for (let index = run[0]; index <= run[1]; index++) if (holdsRow(rows, index, place)) return true;
    return false;
  });
  const found = diagrams.filter((diagram) => !diagram.broad).flatMap((diagram) => {
    const codes = Object.entries(diagram.code ?? {});
    if (diagram.file !== path && !codes.some(([, code]) => code.places.some((place) => place.file === path))) return [];
    return [{ id: diagram.id, lit: codes.filter(([, code]) => holds(code)).map(([key]) => key), rank: diagram.kind === 'schema' && diagram.file === path ? 0 : 1 }];
  });
  const rank = (one) => (one.rank === 0 ? 0 : one.lit.length ? 1 : 2);
  return [0, 1, 2].flatMap((wanted) => found.filter((one) => rank(one) === wanted)).map(({ id, lit }) => ({ id, lit }));
}

/**
 * The rows of a change whose things light: the whole change when it fits in the view; a change taller than the view lights by the row at the reading line
 * (`lineRow`), or the nearest row of the change when the line is above or below it. Null for no change.
 */
function focusRows(run, fits, lineRow) {
  if (!run || fits) return run ?? null;
  const row = Math.max(run[0], Math.min(run[1], lineRow));
  return [row, row];
}

/**
 * The next or the previous change over the files of a list, each { runs: its count of changes } (0 for a folded file).
 * `at` is { file, run }: run -1 stands before the first change of the file, and a file past the end of the list after its last. Null at either end.
 */
function nextChange(files, at, direction) {
  let { file } = at;
  const run = at.run + direction;
  if (file >= 0 && file < files.length && run >= 0 && run < files[file].runs) return { file, run };
  for (file += direction; file >= 0 && file < files.length; file += direction) {
    if (files[file].runs) return { file, run: direction > 0 ? 0 : files[file].runs - 1 };
  }
  return null;
}

/** The number of a change over the whole list, counted from 1 (0 for none), and the count of every change of the list. */
function changeNumber(files, at) {
  const total = files.reduce((sum, file) => sum + file.runs, 0);
  if (at.run < 0 || at.file < 0) return { number: 0, total };
  return { number: files.slice(0, at.file).reduce((sum, file) => sum + file.runs, 0) + at.run + 1, total };
}

const REST_MS = 150; // the scroll of a list of changes rests: what follows it moves then
const READING = 1 / 3; // the reading line, a third down the list

/**
 * Where a list of changes goes for Alt+Down (direction 1) or Alt+Up (-1): the one rule of a step, in every place that shows a diff. Places are pixels down the list.
 * view: { top: its scroll place, height, head: the head that sticks over its top, row: the height of one row, reading: the reading line below its top }.
 * from: the change that is read now, { top, bottom }, or null. to: the change that the key goes to, { top, bottom }, with file: { top, bottom } when it is in
 * another file; null past the last change.
 * - A change within reach (a move of no more than the view less two rows) comes to the reading line.
 * - Else the list moves by the view less two rows: the last two rows of the view before are now its first two rows (upward: its first two now its last two).
 * - A move that would show only rows between two changes of a whole file passes them: the change comes to the reading line. A diff never has so many.
 * - Into the next file, its head comes to the top. Into the file above, its last change comes to the reading line when it ends in the view, else the end of
 *   that file comes to the bottom. Before either, the change that is read is read to its end.
 * Returns { top: the scroll place, current: true when `to` is the current change after the move }, or null when nothing moves.
 */
function stepPlace(view, from, to, direction) {
  const { top, height, head, row, reading } = view;
  const most = Math.max(row, height - head - 2 * row); // the longest move
  const bottom = top + height;
  const land = to ? to.top - reading : 0; // the scroll place that puts the first row of `to` at the reading line
  const fits = to && to.bottom <= land + height; // `to` ends in the view when its first row is at the reading line
  if (direction > 0) {
    if (!to || to.file) {
      if (from && from.bottom > bottom + 1) return { top: top + most, current: false }; // the change that is read goes on below the view
      return to ? { top: to.file.top, current: true } : null;
    }
    const passes = (!from || from.bottom <= bottom + 1) && to.top >= bottom + most;
    if (land - top <= most || passes) return { top: land, current: true };
    return { top: top + most, current: to.top + row <= bottom + most };
  }
  if (!to || to.file) {
    if (from && from.top < top + head - 1) return { top: top - most, current: false }; // the change that is read goes on above the view
    return to ? { top: fits ? land : to.file.bottom - height, current: true } : null;
  }
  if (top - land <= most) return { top: land, current: true };
  if ((!from || from.top >= top + head - 1) && to.bottom <= top + head - most) return { top: fits ? land : to.bottom - height, current: true };
  return { top: top - most, current: to.bottom - row >= top + head - most };
}

/**
 * Alt+Down and Alt+Up over the changed files of a list that scrolls in `scroller`, by the one rule of a step (stepPlace): the list of "Diagram",
 * a file tab, the file of "Diffs", and the file beside the diagram of a part. The current change is the one that the last key made current, while the list glides
 * there or stays there; else the run of changed rows at the reading line, else the next run below it in that file, else the last run of the file.
 * `source` says what the list holds: sections() its file elements in order (each with data-file, and `view` once its rows are drawn), files() a promise
 * of [{ path, runs }] in order (a folded file has no runs), reach(path) a promise of the filled section of a file or null, head() the height of the head
 * that sticks over the list, and past(direction) what a key does after the last change (else nothing).
 * `nav` is the counter, written after each key and each rest of the scroll; `moved(at)` hears the place then too. With neither, nothing watches the scroll.
 * `at` is { path, section, run: its index or -1, focus: the rows of the run whose things light (focusRows) }.
 */
function changeSteps(scroller, source, { nav = null, moved = null } = {}) {
  const top = () => scroller.scrollTop;
  const height = () => scroller.clientHeight;
  const topOf = (el) => top() + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  const canFill = (section) => !section.view && !!section.querySelector('.dfw');
  const over = () => source.over?.() ?? 0; // the name of a part that stays over the head of a file
  let keyed = null; // the place that a key went to, while the list glides there or stays there
  let stopGlide = () => {};

  /** The changes of a filled section as places down the list: [{ top, bottom }]. */
  const changesOf = (section) => {
    if (!section?.view) return [];
    const { box, list, rows } = section.view;
    const at = topOf(box);
    return changeRuns(rows).map(([first, last]) => ({ top: at + list.top(first), bottom: at + list.top(last + 1) }));
  };

  /** The rows whose things light for change `run` of a filled section, with the list at scroll place `y`. */
  const focusAt = (section, run, y) => {
    const { view } = section;
    const rows = changeRuns(view.rows)[run];
    const lineRow = view.list.rowAt(y + height() * READING - topOf(view.box));
    return focusRows(rows, !rows || view.list.top(rows[1] + 1) - view.list.top(rows[0]) <= height(), lineRow);
  };

  /** The place at the reading line now. */
  function here() {
    if (keyed && (Math.abs(top() - keyed.top) <= 2 || performance.now() < keyed.until)) return keyed;
    const sections = source.sections();
    const reading = top() + height() * READING;
    let section = sections.find((one) => topOf(one) + one.getBoundingClientRect().height > reading + 4) ?? sections.at(-1);
    if (!section) return null;
    // Closed diffs are short rows: the place is the first closed row in view of those up to the reading line, so that a key starts at the top.
    for (let index = sections.indexOf(section); !section.view && index > 0 && !sections[index - 1].view && topOf(sections[index - 1]) >= top() + over() - 2; index--) section = sections[index - 1];
    const changes = changesOf(section);
    let run = changes.findIndex((one) => one.bottom > reading);
    if (run < 0) run = changes.length - 1;
    return { path: section.dataset.file, section, run, focus: run < 0 ? null : focusAt(section, run, top()) };
  }

  /** The place at the reading line, with the file there and the files above it filled first. */
  async function place() {
    const reading = top() + height() * READING;
    const above = source.sections().filter((one) => topOf(one) <= reading && canFill(one));
    await Promise.all(above.slice(-3).map(fillDiff));
    return here();
  }

  /** Glides the list to a place and returns where it ends. */
  function glideTo(to) {
    stopGlide();
    const end = Math.max(0, Math.min(scroller.scrollHeight - height(), to));
    stopGlide = glideScroll(scroller, end);
    return end;
  }

  /** The current change in numbers: { file, files, cur, changes }, the file in the order of every changed file, the change over the list (from 0, -1 for none). */
  async function count(at) {
    const list = await source.files();
    const order = App.order();
    const { number, total } = changeNumber(list, { file: list.findIndex((one) => one.path === at?.path), run: at?.run ?? -1 });
    return { file: order.indexOf(at?.path), files: order.length, cur: number - 1, changes: total };
  }

  /** Tells the place: the counter and `moved` (`key` true when a key put it there, else the scroll rested). */
  async function tell(at, key = false) {
    moved?.(at, key);
    if (nav && at) { const numbers = await count(at); if (nav.isConnected) nav.innerHTML = counterHtml(numbers); }
  }

  /** Change `run` of a section is the current one, with the list at scroll place `end`. */
  const went = (section, run, end) => {
    const focus = run >= 0 && section.view ? focusAt(section, run, end) : null;
    keyed = { path: section.dataset.file, section, run, top: end, until: performance.now() + MOTION_MS + 80, focus };
    tell(keyed, true);
  };

  /** Alt+Down (1) or Alt+Up (-1). A second key while the list glides counts from where the glide ends. */
  async function step(direction) {
    const list = await source.files();
    const at = await place();
    if (!at) return;
    const start = at === keyed ? keyed.top : top();
    const reading = start + height() * READING;
    const head = source.head();
    const changes = changesOf(at.section);
    const near = at.section.view?.list.height ?? 18; // a first row less than one row from the reading line stands at it (the rows can settle a little after a glide)
    // After a key, the change after the current one that already shows above the reading line (a file that came to the top) is the next one: nothing moves.
    const shown = at === keyed && at.run >= 0 && changes[at.run + 1];
    if (direction > 0 && shown && shown.top <= reading + near && shown.top >= start + head - 1) return went(at.section, at.run + 1, start);
    // In the file of the place: the change that the key goes to, and the change that is read. Down, the first change that starts below the reading line;
    // up, the last that starts above it, but not the current change while its first row shows. A change that the list cannot bring nearer the reading
    // line (at its top or its end) is passed, unless its first row is in the view and it is past the current one in the way of the key: then it is the current one and nothing moves (a short file).
    const moves = (one) => Math.abs(Math.max(0, Math.min(scroller.scrollHeight - height(), one.top - height() * READING)) - start) > 1;
    const seen = (one) => one.top >= start + head - 1 && one.top + near <= start + height();
    const next = direction > 0 ? changes.findIndex((one, index) => one.top > reading + near && (moves(one) || (seen(one) && index > at.run)))
      : changes.findLastIndex((one, index) => one.top < reading - near && (moves(one) || (seen(one) && index < at.run)) && !(index === at.run && one.top >= start + head - 1));
    const read = direction > 0 ? (next < 0 ? changes.length - 1 : next - 1) : (next < 0 ? 0 : next + 1);
    let [section, run, to] = [at.section, next, changes[next] ?? null];
    // The change that is read goes on past the view: it is read on first, and the next file is not reached (nor opened) yet.
    const readOn = changes[read] && (direction > 0 ? changes[read].bottom > start + height() + 1 : changes[read].top < start + head - 1);
    if (next < 0 && !readOn) { // the change is in another file; down from a closed file, its own first change
      const index = list.findIndex((one) => one.path === at.path);
      const shut = !at.section.view && direction > 0;
      const other = nextChange(list, { file: index < 0 ? list.length : index, run: shut ? -1 : direction * Infinity }, direction);
      section = other && await source.reach(list[other.file].path);
      const theirs = changesOf(section);
      run = other ? (direction > 0 ? 0 : theirs.length - 1) : -1;
      to = theirs[run] ? { ...theirs[run], file: { top: topOf(section) - over(), bottom: topOf(section) + section.getBoundingClientRect().height } } : null;
    }
    const from = changes[read] ?? null;
    const row = (to ? section : at.section).view?.list.height ?? 18;
    const goes = stepPlace({ top: start, height: height(), head, row, reading: height() * READING }, from, to, direction);
    if (!goes) return source.past?.(direction);
    const end = glideTo(goes.top);
    if (goes.current) went(section, run, end);
    else went(at.section, from ? read : next, end); // the change that is read stays the current one
  }

  /** A file comes to the top; its first change is the current one. */
  async function toFile(section) {
    if (!section) return;
    stopGlide();
    keyed = null;
    scroller.scrollTop = topOf(section) - over();
    if (canFill(section)) await fillDiff(section);
    went(section, changesOf(section).length ? 0 : -1, top());
  }

  /**
   * Puts a file where a key that comes into it leaves it, at once: from the file before (1) its head at the top, or its first change as one Alt+Down
   * from there brings it when the first screen does not show it; from the file after (-1) its last change, as Alt+Up into it brings it.
   */
  function enter(direction) {
    const [section] = source.sections();
    const changes = changesOf(section);
    if (!changes.length) return;
    const run = direction > 0 ? 0 : changes.length - 1;
    const view = { top: 0, height: height(), head: source.head(), row: section.view.list.height, reading: height() * READING };
    const file = { top: topOf(section), bottom: topOf(section) + section.getBoundingClientRect().height };
    const shows = changes[0].top + view.row <= height();
    const moves = direction > 0 ? (shows ? { top: 0 } : stepPlace(view, null, changes[0], 1)) : stepPlace({ ...view, top: file.bottom }, null, { ...changes[run], file }, -1);
    scroller.scrollTop = Math.max(0, Math.min(scroller.scrollHeight - height(), moves.top));
    went(section, run, top());
  }

  let timer = 0;
  const onScroll = () => {
    if (!scroller.isConnected) return scroller.removeEventListener('scroll', onScroll);
    clearTimeout(timer);
    timer = setTimeout(async () => { const at = await place(); if (at && scroller.isConnected) tell(at); }, REST_MS);
  };
  if (moved || nav) scroller.addEventListener('scroll', onScroll, { passive: true });

  return {
    here, step, toFile, enter, glideTo, topOf, count,
    reach: source.reach,
    ready: moved || nav ? place().then((at) => at && tell(at)) : Promise.resolve(),
  };
}

/**
 * The changed files in the order of the parts (App.order), each with the count of its changes, for the counter and the steps over every file;
 * a folded file and a file with no text have none. Counted once for each list of files.
 */
let counted = { key: null, files: null };
function changeCounts() {
  const order = App.order();
  const key = order.join('\n');
  if (counted.key !== key || counted.page !== App.page) {
    counted = { key, page: App.page, files: Promise.all(order.map(async (path) => {
      const file = App.page.files.find((one) => one.path === path);
      const lines = file?.what || DATA_FILE.test(path) ? [] : (await ask(`diff:${path}`)) ?? [];
      return { path, runs: changeRuns(diffRows(lines, file?.cells)).length };
    })) };
  }
  return counted.files;
}

/**
 * Reading through the list of diffs of "Diagram" in `into` that scrolls in `scroller`: the steps of changeSteps over every file of the list in its order. A file that is
 * not filled yet is filled first, a folded file is passed over, and "57 more files" opens when a step reaches it. J and K (stepFile) go from file to file;
 * toPath(path) brings a file to the top. `nav` and `moved` as in changeSteps. A step into a closed diff opens it first (`open(section)`, a promise).
 */
function diffSteps(into, scroller, { nav = null, moved = null, open = async () => {} } = {}) {
  const sectionOf = (path) => into.querySelector(`.diffs .dfile[data-file="${CSS.escape(path)}"]`);
  const files = changeCounts;

  /** The section of a file, open and filled: "57 more files" opens first. Null for a file that the list does not hold or holds folded. */
  async function reach(path) {
    if (!sectionOf(path)) into.querySelector(`[data-more-files][data-part="${CSS.escape(partOfFile(App.page, path))}"]`)?.click();
    const section = sectionOf(path);
    if (!section || section.classList.contains('quiet')) return null;
    if (section.classList.contains('shut')) await open(section);
    await fillDiff(section);
    return section;
  }

  // What sticks over the top of the list: the name of the part, and under it the head of the file.
  const over = () => partHead(into);
  const steps = changeSteps(scroller, {
    sections: () => [...into.querySelectorAll('.diffs .dfile')], files, reach, over,
    head: () => over() + (into.querySelector('.diffs .dfile .dh')?.getBoundingClientRect().height ?? 0),
  }, { nav, moved });
  return {
    ...steps,
    stepFile: (direction) => steps.toFile(stepDiffs(direction, scroller)),
    toPath: async (path) => steps.toFile((await reach(path)) ?? sectionOf(path)),
  };
}

if (typeof module === 'object') module.exports = { noteThing, lanesOf, cardPlaces, fileRows, diffRows, changeRuns, spanOf, filesByPart, partOfFile, holdsRow, narrowestAt, thingsAt, focusRows, nextChange, changeNumber, stepPlace }; // for the tests in Node
