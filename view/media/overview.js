// The overview of a diagram (build 83), on Home and on "Diagram" of a change: the diagram of a level large on top, and under it one card for each
// node that leads somewhere, its own diagram drawn small or its files. A quiet icon at the top right of the frame shows the diagram alone, filling the
// tab; that choice holds for every diagram on every page until he picks the overview again with the same icon.
// Build 84: each card takes the size that its content needs, within half of the size of build 83 each way, and the cards are packed with no gaps
// (placeCards); while a map is written, a card shows the state of its area.
'use strict';

const FULL_KEY = 'apostil.diagramFull'; // as a file in a browser, the storage of the browser stands in for the state of VS Code
const GROW = 1.4; // in the overview a small diagram is drawn up to this much larger, so that it fills the width
const OVERVIEW_SHARE = 0.58; // the share of the height of the tab that the diagram takes, so that the cards show under it
const OVERVIEW_MOST = 0.85; // the share that it takes at most, for a drawing that would be smaller than its own size in the share above
const OVERVIEW_LEAST = 220; // the least height of its frame
const OVERVIEW_ROOM = 24; // the room between the drawing and each edge of its frame
const CARD_GAP = 12; // the gap between two cards
const UNIT_LEAST = (250 - CARD_GAP) / 2; // a unit is half a card of build 83 each way: two units and the gap between them are its size
const UNIT_HIGH = (212 - CARD_GAP) / 2;
const MOST_UNITS = 3; // a card is 1, 2 or 3 units across and down: half of build 83's size, its size, or half again
const TRIM_MOST = 0.15; // a page that is less than this share of its frame too high for its tab takes it off the frame, so it does not scroll

/**
 * Places cards of given sizes ({ w, h } in units, 1 to 3) on a grid `columns` units wide, with no hole in the block. Each card in the reading order goes
 * into the first free place from the top left: it stands on the cards above it there, as wide as it wants or as the room there is (a small rest of
 * that room joins it, so the next card is not cut to a sliver), and as high as it wants, or one unit more or less when that ends it level with the card
 * beside it. So no hole opens above the cards. At the end the cards of the bottom edge grow or shrink within their limits so that the block ends flush;
 * when they cannot, the last cards try one unit more or less in height, and else the cards stand in rows (rows()). Returns { x, y, w, h } for each
 * card, in units from the top left.
 */
function placeCards(sizes, columns) {
  const wanted = sizes.map(({ w, h }) => ({ w: Math.min(Math.max(1, w), columns, MOST_UNITS), h: Math.min(Math.max(1, h), MOST_UNITS) }));
  const last = Math.min(6, wanted.length);
  // The heights to try for the last cards: as they want first, then the fewest changes of one unit.
  const tries = [[]];
  for (let at = 0; at < last; at++) tries.splice(0, tries.length, ...tries.flatMap((one) => [[...one, 0], [...one, -1], [...one, 1]]));
  tries.sort((a, b) => a.filter(Boolean).length - b.filter(Boolean).length);
  for (const change of tries) {
    const heights = wanted.map((card, at) => (at < wanted.length - last ? undefined : card.h + change[at - (wanted.length - last)]));
    if (heights.some((h) => h !== undefined && (h < 1 || h > MOST_UNITS))) continue;
    const places = stack(wanted, columns, heights);
    if (places) return places;
  }
  return rows(sizes, columns);
}

/** One try of placeCards: the cards on the grid, with the heights that `heights` gives (undefined: as the card wants), or null when the end is not flush. */
function stack(wanted, columns, heights) {
  const sky = new Array(columns).fill(0); // the top of the free room in each column
  const top = new Array(columns).fill(-1); // the card that ends there
  const places = [];
  wanted.forEach((card, at) => {
    const least = Math.min(...sky);
    const x = sky.indexOf(least);
    let room = 0;
    while (x + room < columns && sky[x + room] === least) room++;
    let w = Math.min(card.w, room);
    const rest = room - w;
    if (rest > 0 && rest < (wanted[at + 1]?.w ?? MOST_UNITS + 1) && w + rest <= MOST_UNITS) w += rest;
    // As high as it wants, or one unit more or less to end level with the card at its left or its right.
    const beside = [sky[x - 1], sky[x + w]].filter((one) => one !== undefined && one > least).map((one) => one - least);
    const h = heights[at] ?? beside.find((one) => Math.abs(one - card.h) <= 1 && one >= 1 && one <= MOST_UNITS) ?? card.h;
    places.push({ x, y: least, w, h });
    for (let column = x; column < x + w; column++) { sky[column] = least + h; top[column] = at; }
  });
  // The last row: the cards at the level of the last card stretch across, within their limits, over the room that is left open at that level. A first
  // row that cannot reach the right edge ends where its cards end.
  const level = places[places.length - 1].y;
  const row = places.map((one, at) => ({ one, at })).filter(({ one }) => one.y === level).sort((a, b) => a.one.x - b.one.x);
  const open = sky.flatMap((one, column) => (one === level ? [column] : []));
  const spread = [...row.flatMap(({ one }) => Array.from({ length: one.w }, (_, i) => one.x + i)), ...open].sort((a, b) => a - b);
  if (open.length && spread.every((column, i) => i === 0 || column === spread[i - 1] + 1) && (level === 0 || spread.length <= MOST_UNITS * row.length)) {
    let room = spread.length - row.reduce((sum, { one }) => sum + one.w, 0);
    let x = spread[0];
    for (const { one, at } of row) {
      const more = Math.min(room, MOST_UNITS - one.w);
      one.w += more;
      room -= more;
      one.x = x;
      x += one.w;
      for (let column = one.x; column < one.x + one.w; column++) { sky[column] = level + one.h; top[column] = at; }
    }
  }
  // The bottom edge: a card that ends each of its columns may end from one to three units under its top; a card with another card under a part of it
  // keeps its end. One common end that all of them reach makes it flush.
  const edge = [...new Set(top.filter((at) => at >= 0))].map((at) => places[at]);
  const free = (one) => Array.from({ length: one.w }, (_, i) => places[top[one.x + i]] === one).every(Boolean);
  const low = Math.max(...edge.map((one) => (free(one) ? one.y + 1 : one.y + one.h)));
  const high = Math.min(...edge.map((one) => (free(one) ? one.y + MOST_UNITS : one.y + one.h)));
  if (low > high) return null;
  const end = Math.min(high, Math.max(low, Math.max(...sky)));
  for (const one of edge) one.h = end - one.y;
  return places;
}

/**
 * The places of the cards when no try of placeCards ends flush (rare): rows of cards two units high in their order, each row filled across by cards
 * that grow up to 3 units, and a card that does not fit in a row any more cut to the room that is left. A last row that cannot reach across stands one
 * unit high under the first cards of the row above, each as wide as the card above it, and the other cards of that row grow down to meet it.
 */
function rows(sizes, columns) {
  const lines = [];
  let at = 0;
  while (at < sizes.length) {
    const row = [];
    let used = 0;
    while (at < sizes.length) {
      const w = Math.min(sizes[at].w, columns, MOST_UNITS);
      if (used + w <= columns) { row.push({ w, h: 2 }); used += w; at++; continue; }
      // The next card does not fit: when the cards of the row cannot grow to fill it, that card comes in, cut to the room that is left.
      if (row.reduce((sum, one) => sum + MOST_UNITS - one.w, 0) < columns - used) { row.push({ w: columns - used, h: 2 }); used = columns; at++; }
      break;
    }
    let room = columns - used;
    for (const one of row) { const more = Math.min(room, MOST_UNITS - one.w); one.w += more; room -= more; }
    lines.push({ row, room });
  }
  const last = lines[lines.length - 1];
  const above = lines[lines.length - 2];
  if (last.room > 0 && above && above.row.length > last.row.length) {
    last.row.forEach((one, i) => Object.assign(one, { w: above.row[i].w, h: 1 }));
    above.row.slice(last.row.length).forEach((one) => { one.h = 3; });
  }
  const places = [];
  let y = 0;
  for (const { row } of lines) {
    let x = 0;
    for (const one of row) { places.push({ x, y, w: one.w, h: one.h }); x += one.w; }
    y += row === last.row ? Math.max(...row.map((one) => one.h)) : 2;
  }
  return places;
}

/**
 * The shape of a drawing for the size of its card: its count of nodes, and how wide it is for how high (`ratio`), from its graph and the direction of
 * its text. A flow chart is laid out in ranks by its arrows: from left to right its ranks stand side by side, from top to bottom one under the other.
 */
function drawingShape(graph, text = '', schema = null) {
  if (schema) return { nodes: schema.tables?.length ?? 2, ratio: 1.4 };
  const nodes = Object.keys(graph?.nodes ?? {});
  const edges = (graph?.edges ?? []).filter((edge) => edge.from !== edge.to);
  if (/^\s*sequenceDiagram/.test(text)) return { nodes: nodes.length || 3, ratio: Math.max(0.6, (nodes.length * 150) / (Math.max(3, edges.length) * 40)) };
  const rank = Object.fromEntries(nodes.map((node) => [node, 0]));
  for (let round = 0; round < nodes.length; round++) for (const { from, to } of edges) if (rank[from] !== undefined && rank[to] !== undefined && rank[to] < rank[from] + 1) rank[to] = rank[from] + 1;
  const ranks = new Map();
  for (const value of Object.values(rank)) ranks.set(value, (ranks.get(value) ?? 0) + 1);
  const long = Math.max(1, ranks.size);
  const across = Math.max(1, ...ranks.values());
  const sideways = /^\s*(flowchart|graph)\s+(LR|RL)\b/.test(text) || /direction\s+LR/.test(text);
  return { nodes: nodes.length, ratio: sideways ? (long * 170) / (across * 60) : (across * 170) / (long * 70) };
}

/**
 * The units of a card with a drawing: a wide drawing more units across, a tall one more down, and a drawing with many nodes larger than one with three.
 * Only a drawing of three nodes or fewer may take one unit either way: more nodes would not read in it.
 */
function drawingUnits(shape) {
  const cells = shape.nodes <= 3 ? 2 : shape.nodes <= 6 ? 4 : shape.nodes <= 12 ? 6 : 9;
  const least = shape.nodes <= 3 ? 1 : 2;
  let best = { w: 2, h: 2, score: Infinity };
  for (let w = least; w <= MOST_UNITS; w++) {
    for (let h = least; h <= MOST_UNITS; h++) {
      const score = Math.abs(Math.log((w * UNIT_LEAST) / (h * UNIT_HIGH)) - Math.log(Math.max(0.2, shape.ratio))) + 0.6 * Math.abs(Math.log((w * h) / cells));
      if (score < best.score) best = { w, h, score };
    }
  }
  return { w: best.w, h: best.h };
}

/** The fewest units of `size` px (with the gaps between them) that hold `need` px, from 1 to 3. */
const unitsFor = (need, size) => Math.min(MOST_UNITS, Math.max(1, Math.ceil((need + CARD_GAP) / (size + CARD_GAP))));

/** The soft sketch of a map that shimmers slowly, while its diagram is not written yet (build 84): large in the frame of Home, small in a card. */
let sketches = 0;
function sketchHtml(small = false) {
  const id = `sk${++sketches}`;
  const boxes = small
    ? [[14, 16, 72], [14, 66, 72], [134, 41, 72], [226, 41, 60]]
    : [[20, 40, 140], [20, 150, 140], [260, 8, 130], [260, 95, 130], [260, 182, 130], [510, 54, 140], [510, 140, 140], [760, 95, 130]];
  const high = small ? 28 : 44;
  const links = small ? [[0, 2], [1, 2], [2, 3]] : [[0, 2], [0, 3], [1, 4], [2, 5], [3, 5], [4, 6], [5, 7], [6, 7]];
  const middle = (box) => ({ x: box[0] + box[2] / 2, y: box[1] + high / 2 });
  const curve = (a, b) => { const [x1, x2] = [a[0] + a[2], b[0]]; const [y1, y2] = [middle(a).y, middle(b).y]; const m = (x1 + x2) / 2; return `M${x1} ${y1}C${m} ${y1} ${m} ${y2} ${x2} ${y2}`; };
  const [w, h] = small ? [300, 110] : [910, 240];
  const rects = boxes.map(([x, y, width]) => `<rect x="${x}" y="${y}" width="${width}" height="${high}" rx="${small ? 5 : 7}"/>`).join('');
  return `<svg class="sketch" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">`
    + `<defs><clipPath id="${id}">${rects}</clipPath><linearGradient id="${id}g" x1="0" x2="1"><stop offset="0" class="sk0"/><stop offset=".5" class="sk1"/><stop offset="1" class="sk0"/></linearGradient></defs>`
    + `${links.map(([a, b]) => `<path class="skl" d="${curve(boxes[a], boxes[b])}"/>`).join('')}<g class="skb">${rects}</g>`
    + `<g clip-path="url(#${id})"><rect class="sks" x="${-w / 3}" y="0" width="${w / 3}" height="${h}" fill="url(#${id}g)"/></g></svg>`;
}

/** The small turning mark and the small bar of a card whose area a writer works on now. */
const workHtml = (share) => `<span class="ovw"><i class="spin" aria-hidden="true"></i><span class="ovbar"><i style="width:${Math.round(share * 100)}%"></i></span></span>`;

const Overview = {
  full: null, // his choice from VS Code: the diagram alone (true) or the overview (false); null until VS Code sends it
  frame: null, // the frame of the diagram in the overview, which a page that is a little too high for its tab takes some height from

  /** True when he chose the diagram alone. */
  isFull() {
    if (this.full !== null) return this.full;
    try { return localStorage.getItem(FULL_KEY) === '1'; } catch { return false; }
  },

  /** He picks the other form. VS Code keeps it for every page and window; as a file in a browser, the storage of the browser keeps it. */
  choose(full, redraw) {
    this.full = full;
    tell({ type: 'layout', full });
    if (!vscodeApi) try { localStorage.setItem(FULL_KEY, full ? '1' : '0'); } catch { /* no storage: the choice lasts while the page is open */ }
    redraw();
  },

  /** VS Code says what he chose, with the data or after he chose on another page. True when it differs from what the page shows. */
  heard(full) {
    if (typeof full !== 'boolean' || full === this.full) return false;
    this.full = full;
    return true;
  },

  /** The quiet icon at the top right of the frame: "Full screen" in the overview, "Overview" in full screen. */
  icon(frame, full, redraw) {
    frame.querySelector(':scope > .ovt')?.remove();
    const icon = html(`<a class="ovt ${full ? 'shrink' : 'grow'}" role="button" title="${full ? 'Overview' : 'Full screen'}" aria-label="${full ? 'Overview' : 'Full screen'}"></a>`);
    icon.addEventListener('click', (event) => { event.stopPropagation(); this.choose(!full, redraw); });
    frame.append(icon);
  },

  /** Drawn nodes in the reading order of the drawing: top to bottom, then left to right. Nodes whose middles lie within half a node apart stand in one row. */
  inReadingOrder(nodes) {
    const rows = [];
    const boxes = nodes.map((g) => ({ g, box: g.getBoundingClientRect() })).sort((a, b) => (a.box.top + a.box.bottom) - (b.box.top + b.box.bottom));
    for (const one of boxes) {
      const middle = (one.box.top + one.box.bottom) / 2;
      const row = rows.at(-1);
      if (row && Math.abs(middle - row.middle) <= Math.max(one.box.height, row.height) / 2) row.items.push(one);
      else rows.push({ middle, height: one.box.height, items: [one] });
    }
    return rows.flatMap((row) => row.items.sort((a, b) => a.box.left - b.box.left).map((one) => one.g));
  },

  /**
   * The cards under the diagram, into `holder`: one for each item, in its order. An item is { title, draw(box), shape, open() } for a node with a diagram
   * of its own, drawn small and read only (`shape`: drawingShape() of its drawing), or { title, files: [{ path, line?, folder?, count?, counts? }] } for a
   * node that leads to files; `node` is the id of its node, and `run` ({ state, share }) the state of its area while a map is written (build 84): a card
   * that a writer works on shows a sketch that shimmers, a turning mark and its own bar; a card that waits is empty, with a dashed edge and a faint name.
   * A card with a drawing is filled when it comes into view, so a level with many nodes opens at once. A click on a card with a diagram goes one level
   * down (open); a click on a file row does what the page does for that row. The cards take the sizes of their contents and are placed with no gaps.
   */
  cards(holder, items) {
    holder.innerHTML = items.map((item, at) => {
      const state = item.run?.state;
      const head = `<div class="ovh"><span class="ovn" title="${esc(item.title)}">${esc(item.title)}</span>${state === 'working' ? workHtml(item.run.share) : ''}</div>`;
      return `<div class="ovc${item.open ? ' go' : ''}${state ? ` run-${state}` : ''}" data-card="${at}"${item.node ? ` data-node="${esc(item.node)}"` : ''}>${head}<div class="ovb"></div></div>`;
    }).join('');
    holder.hidden = !items.length;
    this.held = { holder, items };
    // The files of a card are written at once: their rows give its size. A drawing waits until the card comes into view.
    for (const card of holder.querySelectorAll('.ovc')) {
      const item = items[Number(card.dataset.card)];
      const body = card.querySelector('.ovb');
      if (item.run?.state === 'working') body.innerHTML = sketchHtml(true);
      else if (item.run?.state === 'waiting') body.innerHTML = '';
      else if (item.files) body.innerHTML = `<div class="ovf">${item.files.map(fileRowHtml).join('')}</div>`;
      if (item.run || item.files) card.dataset.drawn = '';
    }
    this.layout(holder, items);
    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries.filter((one) => one.isIntersecting)) {
        seen.unobserve(entry.target);
        const item = items[Number(entry.target.dataset.card)];
        item.draw(entry.target.querySelector('.ovb')).then(() => { entry.target.dataset.drawn = ''; }).catch((error) => console.error(error));
      }
    }, { rootMargin: '200px' });
    for (const card of holder.querySelectorAll('.ovc')) {
      const item = items[Number(card.dataset.card)];
      if (item.draw && !item.run) seen.observe(card);
      if (item.open) card.addEventListener('click', (event) => { if (!event.target.closest('[data-open], [data-tree], [data-open-file]')) item.open(event); });
    }
    if (!this.watched?.has(holder)) {
      (this.watched ??= new WeakSet()).add(holder);
      let width = holder.clientWidth;
      new ResizeObserver(() => { if (holder.clientWidth !== width && this.held?.holder === holder) { width = holder.clientWidth; this.layout(holder, this.held.items); } }).observe(holder);
    }
  },

  /**
   * The size of each card in units, and their places (placeCards): a card with files just tall enough for its rows and wide enough for each file name
   * whole; a card with a drawing by its shape. Under 4 units across (a narrow tab), the cards stand in one column at full width and only their heights differ.
   */
  layout(holder, items) {
    if (!items.length) return this.trim();
    const style = getComputedStyle(holder);
    const inner = holder.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (!(inner > 0)) return; // not in the page yet, or hidden: the cards are placed when the holder gets its width
    const columns = Math.max(1, Math.floor((inner + CARD_GAP) / (UNIT_LEAST + CARD_GAP)));
    const unit = (inner - (columns - 1) * CARD_GAP) / columns;
    const cards = [...holder.querySelectorAll('.ovc')];
    const sizes = cards.map((card) => this.sizeOf(card, items[Number(card.dataset.card)], unit));
    const narrow = columns < 2 * 2;
    const places = narrow ? (() => { let y = 0; return sizes.map(({ h }) => ({ x: 0, y: (y += h) - h, w: columns, h })); })() : placeCards(sizes, columns);
    holder.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    cards.forEach((card, at) => {
      const { x, y, w, h } = places[at];
      Object.assign(card.style, { gridColumn: `${x + 1} / span ${w}`, gridRow: `${y + 1} / span ${h}` });
      Object.assign(card.dataset, { units: `${w}x${h}` });
    });
    this.trim();
  },

  /** The units of one card: its rows of files, its drawing, or for a card of a run with no content yet, the files of its area (else the size of build 83). */
  sizeOf(card, item, unit) {
    // The name in the head stays whole: with the turning mark and the bar of a run beside it, when they show.
    const work = card.querySelector('.ovw');
    const named = { w: unitsFor(card.querySelector('.ovn').scrollWidth + (work ? work.offsetWidth + 10 : 0) + 24 + 2, unit), h: 1 };
    const size = this.contentSize(card, item, unit);
    return { w: Math.max(size.w, named.w), h: size.h };
  },

  /** The units of the content of a card: its rows of files, its drawing by its shape, or the size of build 83. */
  contentSize(card, item, unit) {
    const files = item.files ?? (item.shape ? null : item.areaFiles);
    if (files?.length) {
      const rows = [...card.querySelectorAll('.ovf a')];
      const rowHigh = rows[0]?.offsetHeight || 21;
      const head = card.querySelector('.ovh').offsetHeight + 16 + 2; // the head, the room of the body above and under its rows, and the borders
      const wide = rows.length ? Math.max(...rows.map((row) => { const name = row.querySelector('.nm').scrollWidth; return Math.max(name / 0.75, name + row.querySelector('.c').offsetWidth + 10); })) : 0;
      return { w: rows.length ? unitsFor(wide + 24 + 2, unit) : 2, h: unitsFor(head + files.length * rowHigh, UNIT_HIGH) };
    }
    if (item.shape) return drawingUnits(item.shape);
    return { w: 2, h: 2 };
  },

  /**
   * A page that is a little too high for its tab does not scroll: the frame of the diagram gives up those pixels (build 84). A page much higher than its
   * tab keeps its frame and scrolls to its cards.
   */
  trim() {
    const frame = this.frame;
    if (!frame?.isConnected || !frame.dataset.height) return;
    const set = Number(frame.dataset.height);
    frame.style.height = `${set}px`;
    const over = document.documentElement.scrollHeight - innerHeight;
    if (over > 0 && over <= set * TRIM_MOST && set - over >= OVERVIEW_LEAST) frame.style.height = `${set - over}px`;
  },

  /** The card of the node that has the focus gets a quiet accent edge (build 84); no card has it when no node has the focus. */
  focused(node) {
    for (const card of document.querySelectorAll('.ovc[data-node]')) card.classList.toggle('focused', !!node && card.dataset.node === node);
  },
};

/**
 * One file row of a card: the folder quiet before the name, cut at its left end, then its count or its counts. A folder of the map opens in the tree
 * "Files" and a file of the map in VS Code (data-tree, data-open, at its line); a file of a change opens its file tab (data-open-file).
 */
function fileRowHtml(file) {
  const folder = file.path.endsWith('/');
  const name = folder ? `${baseName(file.path.slice(0, -1))}/` : baseName(file.path);
  const at = folder ? folderOf(file.path.slice(0, -1)) : folderOf(file.path);
  const attrs = file.counts !== undefined ? `data-open-file="${esc(file.path)}"`
    : folder ? `data-tree="${esc(file.path)}"` : `data-open="${esc(file.path)}"${file.line ? ` data-line="${file.line}"` : ''}`;
  const count = file.counts !== undefined ? countsHtml(file.counts) : folder && file.count ? plural(file.count, 'file') : '';
  return `<a ${attrs} title="${esc(file.path)}"><span class="dir"><bdi dir="ltr">${esc(at)}</bdi></span><span class="nm">${esc(name)}</span><i class="c">${count}</i></a>`;
}

/**
 * Gives the frame of a diagram in the overview its height, also when the tab changes its size: the upper part of the tab, as large as the width
 * allows, and no taller than the drawing needs at that size. A drawing that would then be smaller than the diagram alone shows it may take more of
 * the tab, up to OVERVIEW_MOST, so that its words keep their size. `width` and `height` are the size of the drawing. The room is counted from the top
 * of the frame with nothing scrolled. A page that is then a little too high for its tab takes it off the frame (Overview.trim).
 */
function keepOverview(stage, width, height) {
  const set = () => {
    let top = stage.getBoundingClientRect().top + scrollY;
    for (let el = stage.parentElement; el; el = el.parentElement) top += el.scrollTop;
    const room = innerHeight - top;
    const across = (stage.clientWidth - 2 * OVERVIEW_ROOM) / width;
    const tall = (scale) => height * scale + 2 * OVERVIEW_ROOM; // the height of the frame for the drawing at this scale
    const most = Math.max(room * OVERVIEW_SHARE, Math.min(tall(Math.min(1, across)), room * OVERVIEW_MOST));
    stage.dataset.height = String(Math.round(Math.max(OVERVIEW_LEAST, Math.min(tall(Math.min(GROW, across)), most))));
    stage.style.height = `${stage.dataset.height}px`;
    Overview.frame = stage;
    Overview.trim();
  };
  set();
  // Only the newest drawing of the frame sets its height: Home draws each level in the same frame (`sized`, as keepFilled in tools.js).
  const again = () => (stage.isConnected && stage.sized === again ? set() : removeEventListener('resize', again));
  stage.sized = again;
  addEventListener('resize', again);
}

if (typeof module === 'object') module.exports = { placeCards, drawingShape, drawingUnits }; // for the tests in Node
