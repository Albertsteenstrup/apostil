// The small code map at the right of a whole file, as VS Code has beside its editor: each row of the file as a thin row of its coloured pieces,
// and a soft box over the part in view. A click shows that place, a drag of the box scrolls. The note cards lie over it (look.css).
'use strict';

const MAP_ROW = 2; // the height of one row of the code on the map, in px; one character is 1 px wide, as in VS Code
const MAP_WIDTH = 120; // beside the cards of a wide tab, and alone beside the code of a file with no notes: 120 characters, as VS Code shows at most
const MAP_NARROW = 60; // beside the marks of a narrow tab
const MAP_INK = 0.5; // how strong the code is on the map

/** The colours of the map, read from the colours of the page once, and again when the theme changes. */
const MapColors = (() => {
  let colors = null;
  const NAMES = { ink: '--ink', k: '--kw', s: '--str', c: '--faint', teal: '--teal', add: '--diff-add-line', del: '--diff-del-line' };
  const forget = () => { colors = null; CodeMap.drawAll(); };
  // VS Code puts its theme on the class of the body and its colours on the style of the html element.
  const watch = new MutationObserver(forget);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
  watch.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-vscode-theme-id'] });
  return {
    get(probe) {
      if (colors) return colors;
      colors = {};
      for (const [name, variable] of Object.entries(NAMES)) {
        probe.style.color = `var(${variable})`;
        colors[name] = getComputedStyle(probe).color;
      }
      return colors;
    },
  };
})();

/** The pieces of a line of coloured HTML (colorLine): [{ text, kind }], kind "k", "s", "c" or "" for the rest. */
function mapPieces(markup) {
  const pieces = [];
  const text = (part) => part.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[name]);
  for (const [, kind, inner, plain] of markup.matchAll(/<span class="(\w)">([^<]*)<\/span>|([^<]+)|<[^>]*>/g)) {
    if (inner !== undefined) pieces.push({ text: text(inner), kind: 'ksc'.includes(kind) ? kind : '' });
    else if (plain !== undefined) pieces.push({ text: text(plain), kind: '' });
  }
  return pieces;
}

/** Every map on the page, and the setting of VS Code "editor.minimap.enabled" that shows or hides them. */
const CodeMap = {
  on: true,
  all: new Set(),

  /** The setting changed: each map shows or hides in place. */
  set(on) {
    this.on = on;
    for (const map of this.all) map.show(on);
  },

  /** True when a map shows on the page. */
  shown() {
    return [...this.all].some((map) => map.el.isConnected && !map.el.hidden);
  },

  drawAll() {
    for (const map of this.all) map.draw();
  },
};

/**
 * The map of the rows of `view` (codeWithNotes), in `side`: the column of the notes, or a column of its own. It sticks at the right of the box `scroller`,
 * from `top()` down; it moves with the file when the file is taller than the map, so that its top shows at the top and its end at the end.
 * `rowHtml(index)` is the coloured HTML of a row (the colours of the code view); `spans` are the rows of each note, for the marks at its edge;
 * `narrow` puts it beside the marks of the notes; `holder` is the element that gets the class "with-map" while the map shows; `tint(line)` is the colour that a rule of
 * the look gives a line of the file now, or nothing.
 */
function codeMap(side, { scroller, view, rowHtml, spans = [], top = () => 0, narrow = false, holder, tint = () => undefined }) {
  const width = narrow ? MAP_NARROW : MAP_WIDTH;
  const el = html(`<div class="cmap" style="width:${width}px"><canvas></canvas><i class="slider"></i><i class="probe"></i></div>`);
  side.prepend(el);
  const canvas = el.querySelector('canvas');
  const slider = el.querySelector('.slider');
  const { rows, box, list } = view;
  const pieces = new Map(); // the pieces of each row, worked out once
  let frame = 0;
  let geometry = null; // the numbers of the last draw, for a click and a drag

  /** The numbers of the map now: its height, the scale from the box to the map, where the map stands in the file, the box in view. */
  function measure() {
    const view = scroller.getBoundingClientRect();
    const room = top();
    el.style.top = el.style.marginTop = `${room}px`; // it sticks below the control of the files
    const at = Math.max(room, side.getBoundingClientRect().top - view.top + room);
    const height = Math.max(0, scroller.clientHeight - at);
    const scale = MAP_ROW / list.height;
    const whole = scroller.scrollHeight * scale; // the whole file on the map
    const most = scroller.scrollHeight - scroller.clientHeight;
    const moves = whole > height && most > 0 ? (whole - height) / most : 0; // how far the map moves for each px of scroll
    const shift = scroller.scrollTop * moves;
    return { at, height: Math.min(height, whole), scale, moves, shift, offset: box.getBoundingClientRect().top - view.top + scroller.scrollTop };
  }

  /** Draws the rows that show on the map, the marks of the notes and the box in view. */
  function draw() {
    cancelAnimationFrame(frame);
    if (!el.isConnected || el.hidden) return;
    const numbers = geometry = measure();
    const { height, scale, shift, offset } = numbers;
    const ratio = devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.height = `${height}px`;
    const paint = canvas.getContext('2d');
    paint.scale(ratio, ratio);
    const colors = MapColors.get(el.querySelector('.probe'));
    const yOf = (index) => (offset + list.top(index)) * scale - shift;
    const first = list.rowAt(shift / scale - offset);
    const last = Math.min(rows.length - 1, list.rowAt((shift + height) / scale - offset));
    const columns = view.columns;
    for (let index = first; index <= last; index++) {
      const row = rows[index];
      const y = yOf(index);
      const tall = yOf(index + 1) - y;
      if (row.kind === 'add' || row.kind === 'del') { paint.globalAlpha = 1; paint.fillStyle = colors[row.kind]; paint.fillRect(0, y, width, tall); }
      const tone = row.now && row.kind !== 'del' && tint(row.now) && Marks.lineColors(tint(row.now)); // the tint of a rule of the look, in the colour of the theme
      if (tone) { paint.globalAlpha = 0.45; paint.fillStyle = document.body.classList.contains('vscode-dark') ? tone.dark : tone.light; paint.fillRect(0, y, width, tall); }
      if (row.kind === 'gap' || row.kind === 'cell') continue;
      if (!pieces.has(index)) pieces.set(index, mapPieces(rowHtml(index)));
      paint.globalAlpha = MAP_INK; // the code is faint, as on the map of VS Code: the map is for the shape
      // Each run of characters with no space is one bar in its colour; a long line wraps as the code does, at its indent plus 2.
      const hang = Wrap.hang(Wrap.measure(row.text).indent, columns);
      let column = 0;
      for (const { text, kind } of pieces.get(index)) {
        paint.fillStyle = colors[kind || 'ink'];
        let start = -1;
        const flush = (end) => {
          if (start < 0) return;
          const [line, x] = place(start, columns, hang);
          const [, xEnd] = place(end - 1, columns, hang);
          if (line * MAP_ROW < tall && x < width) paint.fillRect(x, y + line * MAP_ROW + MAP_ROW * 0.125, Math.min(xEnd + 1, width) - x, MAP_ROW * 0.75);
          start = -1;
        };
        for (const char of text) {
          const next = char === '\t' ? column + 4 - (column % 4) : column + 1;
          if (char === ' ' || char === '\t' || (start >= 0 && place(column, columns, hang)[0] !== place(start, columns, hang)[0])) flush(column);
          if (char !== ' ' && char !== '\t' && start < 0) start = column;
          column = next;
        }
        flush(column);
      }
    }
    // A thin teal mark at the right edge for the rows of each note, with a gap at its end, so two notes read as two.
    paint.fillStyle = colors.teal;
    paint.globalAlpha = 0.6;
    for (const [from, to] of spans) {
      const [y, end] = [yOf(from), yOf(to + 1)];
      if (end >= 0 && y <= height) paint.fillRect(width - 3, y, 2, Math.max(1, end - y - 1));
    }
    paint.globalAlpha = 1;
    Object.assign(slider.style, { top: `${scroller.scrollTop * scale - shift}px`, height: `${scroller.clientHeight * scale}px` });
  }

  /** Draws in the next frame, once. */
  const soon = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };

  // A click on the map brings that place to the middle of the box in view; a drag goes on from there, and a drag of the box scrolls with it.
  el.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !geometry) return;
    event.preventDefault();
    const { scale, moves } = geometry;
    const perPixel = 1 / (scale - moves); // the box stands at scroll × (scale − moves): the scroll for each px that the box moves on the map
    const y = event.clientY - el.getBoundingClientRect().top;
    const boxTop = scroller.scrollTop * scale - geometry.shift;
    const boxHeight = scroller.clientHeight * scale;
    if (y < boxTop || y > boxTop + boxHeight) scroller.scrollTop = (y - boxHeight / 2) * perPixel;
    const [from, start] = [event.clientY, scroller.scrollTop];
    el.setPointerCapture(event.pointerId);
    el.classList.add('held');
    const move = (moved) => { scroller.scrollTop = start + (moved.clientY - from) * perPixel; };
    const up = () => { el.classList.remove('held'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  // A wheel on the map scrolls the file, as on the code.
  el.addEventListener('wheel', (event) => { scroller.scrollTop += event.deltaY; event.preventDefault(); }, { passive: false });

  const onScroll = () => (el.isConnected ? soon() : stop());
  const resized = new ResizeObserver(() => (el.isConnected ? soon() : stop()));
  const stop = () => { scroller.removeEventListener('scroll', onScroll); resized.disconnect(); CodeMap.all.delete(map); };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  resized.observe(scroller);

  const map = {
    el, draw, soon,
    get geometry() { return geometry; }, // the numbers of the last draw: { at, height, scale, moves, shift, offset }
    /** Shows or hides the map; a column of its own goes with it. */
    show(on) {
      el.hidden = !on;
      holder.classList.toggle('with-map', on);
      if (on) draw();
    },
  };
  CodeMap.all.add(map);
  map.show(CodeMap.on);
  return map;
}

/** Where character `at` of a line stands on the map: [its visual row, its column], wrapped at `columns` with the rows after the first at `hang`. */
function place(at, columns, hang) {
  if (at < columns) return [0, at];
  const per = Math.max(1, columns - hang);
  return [1 + Math.floor((at - columns) / per), hang + ((at - columns) % per)];
}
