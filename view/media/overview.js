// The overview of a diagram, on Home and on "Diagram" of a change: the diagram of a level large on top, and under it one card for each
// node that leads somewhere, its own diagram drawn small or its files. A quiet icon at the top right of the frame shows the diagram alone, filling the
// tab; that choice holds for every diagram on every page until he picks the overview again with the same icon.
// Each card takes the size that its content needs, from half of a base card (250 × 212 px) to one and a half each way, and the cards are packed
// with no gaps (placeCards); while a map is written, a card shows the state of its area.
'use strict';

const FULL_KEY = 'apostil.diagramFull'; // as a file in a browser, the storage of the browser stands in for the state of VS Code
const GROW = 1.4; // in the overview a small diagram is drawn up to this much larger, so that it fills the width; a drawing card grows only so far
const OVERVIEW_LEAST = 220; // the least height of its frame
const OVERVIEW_ROOM = 24; // the room between the drawing and each edge of its frame
const PEEK_CONTENT = 36; // under the head of the first row of cards, this much of their content shows at the bottom of the tab
const PEEK_FIRST = 96; // the peek before the first cards are written: their head is measured when they are (Overview.peek)
const CARD_GAP = 12; // the gap between two cards
const UNIT_LEAST = (250 - CARD_GAP) / 2; // a unit is half a base card each way: two units and the gap between them are a base card
const UNIT_HIGH = (212 - CARD_GAP) / 2;
const MOST_UNITS = 3; // a card is 1, 2 or 3 units across and down: half a base card, a base card, or one and a half
const TRIM_MOST = 0.15; // a page that is less than this share of its frame too high for its tab takes it off the frame, so it does not scroll
const FILL_LEAST = 0.7; // a drawing card takes another size than its own only when its drawing still fills this share of it in its looser direction
const SETTLE_MS = 3000; // while the cards have just opened, a drawing that came out of another shape than guessed places them again

/**
 * The costs of what a card may give so that the block has no hole: a drawing that grows takes its drawing with it, so it comes first; then a later card
 * that moves up; a card of files that grows wider; and last a card of files that grows taller, whose rows then leave room empty.
 */
const PLACE_COST = { grow: 1, order: 4, wider: 3, taller: 20 };
const PLACE_TRIES = 2500; // the tries of one placing; the first try is a whole placing, the others look for a better one

/**
 * The sizes that a card may take, from the least that its content needs ({ w, h } in units):
 * - a card of files (`files`): as wide as it needs or wider, and as high as its rows need or up to `most`, one unit more than they need; taller is
 *   `over`, the last thing that gives way;
 * - a card with a drawing: its own size, or a size of `fits` ([w, h], each as wide as it needs or wider), at which the drawing still fills about 70% of
 *   the card in its looser direction (Overview.sizeOf);
 * - any other card: its own size.
 * A card is never narrower than it needs, except in a grid narrower than that.
 */
function sizesOf(card, columns) {
  const most = Math.min(MOST_UNITS, columns);
  const w = Math.min(Math.max(1, card.w), most);
  const h = Math.min(Math.max(1, card.h), MOST_UNITS);
  if (card.files) {
    const tallest = Math.min(MOST_UNITS, Math.max(h, card.most ?? h + 1));
    const sizes = [];
    for (let across = w; across <= most; across++) for (let down = h; down <= MOST_UNITS; down++) sizes.push({ w: across, h: down, over: down > tallest ? 1 : 0, cost: (across - w) * PLACE_COST.wider + (down - h) * PLACE_COST.taller });
    return sizes;
  }
  const fits = (card.fits ?? []).filter(([across, down]) => across >= w && across <= most && down >= 1 && down <= MOST_UNITS && !(across === w && down === h));
  return [{ w, h, over: 0, cost: 0 }, ...fits.map(([across, down]) => ({ w: across, h: down, over: 0, cost: Math.abs(across * down - w * h) * PLACE_COST.grow }))];
}

/** -1, 0 or 1 as the score `a` is better, as good as or worse than `b`: each part counts only when the parts before it are equal. */
const compareScores = (a, b) => { for (let at = 0; at < a.length; at++) if (a[at] !== b[at]) return a[at] < b[at] ? -1 : 1; return 0; };

/**
 * Places the cards of the overview on a grid `columns` units wide, in units from the top left: each card { w, h, files?, most?, fits? } (sizesOf) gets
 * { x, y, w, h }. The cards go in the reading order of their nodes, each into the first free place from the top left (the lowest place, then the
 * leftmost), standing on the cards under it; a few cards that do not reach across stand in one row at the left.
 * Where a place would stay empty, the cards close it by what costs least (PLACE_COST): a drawing card grows (also up, to end level with its
 * neighbour), a later card moves up into it, a card of files grows wider, and last a card of files grows one unit taller. At the end the cards of the
 * bottom edge grow or shrink within their sizes to one common end, so that the block ends flush.
 * A card is never narrower than its content needs, and a drawing card never takes a size that its drawing does not fill (sizesOf): those never give way.
 * When no placing meets every other rule, they give way in this order; the score of a placing ([holes, over, uneven, cost]) says which one did:
 * 1. the last row flush: a place that no card can close stays open at the bottom of the block, and no card stands on it (`uneven`: the empty units
 *    under the bottom edge, ten times for each unit deeper than a row, which is nearly a hole);
 * 2. the reading order: a card moves up past the next few cards only when none of them fits (`cost`);
 * 3. a card of files at most one unit taller than its rows need (`over`). The last row always can give way first, so this rule never gave way in the
 *    tests.
 * A hole between cards (`holes`) comes only when every column is left open and cards are still to place (it never came in the tests).
 * The search tries placings depth first, the cheapest step first, and stops after PLACE_TRIES tries with the best one so far.
 */
function placeCards(cards, columns) {
  const count = cards.length;
  if (!count) return [];
  const options = cards.map((card) => sizesOf(card, columns));
  const narrowest = options.map((list) => Math.min(...list.map((one) => one.w)));
  const places = new Array(count).fill(null);
  const chosen = new Array(count).fill(null); // the size of each placed card, from its options
  const left = new Array(count).fill(true);
  const open = new Array(columns).fill(-1); // a column left open at the bottom of the block: the height where it ends
  let best = null;
  let tries = 0;

  /**
   * The cards that end the columns [x, x + room) at height y, when each can grow by `d` units (fewer when `d` is below 0) with its width as it is:
   * [{ at, size }], or null.
   */
  const growing = (top, x, room, y, d) => {
    if (y === 0) return null; // the ground: no card under it
    const under = [];
    for (let column = x; column < x + room; column++) {
      const at = top[column];
      if (at < 0 || open[column] >= 0) return null; // an empty place, or a column left open
      const place = places[at];
      if (place.x < x || place.x + place.w > x + room || place.y + place.h !== y) return null; // another card stands on a part of it
      if (!under.some((one) => one.at === at)) {
        const size = options[at].find((one) => one.w === place.w && one.h === place.h + d);
        if (!size) return null;
        under.push({ at, size });
      }
    }
    return under;
  };
  /** The change of the score when cards take other sizes. */
  const resized = (score, list) => list.reduce((next, { at, size }) => [next[0], next[1] + size.over - chosen[at].over, next[2] + size.cost - chosen[at].cost], score);

  /**
   * All cards stand: the cards of the bottom edge grow or shrink within their sizes to one common end, the cheapest one, so that the block ends flush.
   * When no end can be reached, the bottom edge stays uneven, and the score counts its empty units.
   */
  function finish(sky, top, score) {
    const level = sky.map((one, column) => (open[column] >= 0 ? open[column] : one));
    // The columns at the right that no card reached stay out of the block when the cards stand in one row; under more rows they are a gap.
    const row = places.every((place) => place.y === 0);
    const last = level.reduce((end, one, column) => (one > 0 ? column : end), -1);
    const used = level.map((one, column) => !row || column <= last);
    let flush = null;
    for (const end of [...new Set(level.filter((one, column) => used[column]))]) {
      let final = score;
      const grown = [];
      for (let x = 0; x < columns && final;) {
        if (!used[x] || level[x] === end) { x++; continue; }
        if (open[x] >= 0) { final = null; break; } // a column left open: nothing grows into it
        let room = 0;
        while (x + room < columns && used[x + room] && level[x + room] === level[x]) room++;
        const under = growing(top, x, room, level[x], end - level[x]);
        if (under) { final = resized(final, under); grown.push(...under); } else final = null;
        x += room;
      }
      if (final && (!flush || compareScores(final, flush.score) < 0)) flush = { score: final, grown };
    }
    const bottom = Math.max(...level);
    const empty = level.reduce((sum, one, column) => sum + (used[column] ? bottom - one : 0), 0);
    const deep = level.reduce((sum, one, column) => sum + (used[column] ? Math.max(0, bottom - one - MOST_UNITS) : 0), 0); // deeper than a row: nearly a hole
    const total = flush ? [flush.score[0], flush.score[1], 0, flush.score[2]] : [score[0], score[1], empty + deep * 10, score[2]];
    if (best && compareScores(total, best.score) >= 0) return;
    const result = places.map((place) => ({ ...place }));
    for (const { at, size } of flush?.grown ?? []) result[at].h = size.h;
    best = { score: total, places: result };
  }

  /**
   * One step: the lowest free place, leftmost, gets a card, or the cards under it grow up, or it stays open at the bottom when nothing can close it.
   * The steps go cheapest first; `turns` is how many times this placing may still take another step than the cheapest, so that a search with few turns
   * first sees the placings near the cheapest one at every depth, not only near the end.
   */
  function step(sky, top, score, placed, turns) {
    if (best && (tries > PLACE_TRIES || compareScores([score[0], score[1], 0, score[2]], best.score) >= 0)) return;
    tries++;
    if (placed === count) return finish(sky, top, score);
    let y = Infinity;
    let x = 0;
    for (let column = 0; column < columns; column++) if (sky[column] < y) { y = sky[column]; x = column; }
    if (y === Infinity) { // every column is open at the bottom, and cards are left: they stand on a new row under all, over holes
      const bottom = Math.max(...open);
      const holes = open.reduce((sum, one) => sum + bottom - one, 0);
      const before = open.slice();
      open.fill(-1);
      step(new Array(columns).fill(bottom), new Array(columns).fill(-1), [score[0] + holes, score[1], score[2]], placed, turns);
      before.forEach((one, column) => { open[column] = one; });
      return;
    }
    let room = 0;
    while (x + room < columns && sky[x + room] === y) room++;
    const beside = [sky[x - 1], sky[x + room]].filter((one) => one !== undefined && one !== Infinity);
    const waiting = left.flatMap((on, at) => (on ? [at] : []));
    const leastOf = (except) => Math.min(Infinity, ...waiting.filter((at) => at !== except).map((at) => narrowest[at]));
    // The next cards in their order, a later one only when none of them fits; the card of the first node always at the top left.
    let near = waiting.slice(0, placed ? 4 : 1).filter((at) => narrowest[at] <= room);
    if (!near.length && placed) near = waiting.filter((at) => narrowest[at] <= room);
    const steps = [];
    near.forEach((at) => {
      const moved = waiting.indexOf(at) * PLACE_COST.order;
      for (const size of options[at]) {
        if (size.w > room) continue;
        const rest = room - size.w;
        const sliver = rest > 0 && rest < leastOf(at) ? 1 : 0; // a rest that no other card fits in
        const level = rest === 0 && beside.includes(y + size.h) ? 0 : 1; // it fills the place and ends level with a neighbour
        steps.push({ at, size, rank: size.over * 1e6 + sliver * 1e3 + size.cost + moved + level * 3, moved });
      }
    });
    // The cards under the place grow up to the lower neighbour.
    const target = beside.length ? Math.min(...beside) : 0;
    const under = target > y ? growing(top, x, room, y, target - y) : null;
    if (under) steps.push({ under, rank: under.reduce((sum, { at, size }) => sum + size.over * 1e6 + size.cost - chosen[at].cost, 0) + 1 });
    // It stays open at the bottom of the block, and no card stands on it: the last row gives way before a card of files grows too tall.
    steps.push({ open: true, rank: 1e5 });
    steps.sort((a, b) => a.rank - b.rank);
    for (const [turn, one] of steps.entries()) {
      if (turn > 0 && turns === 0) break;
      const later = turn > 0 ? turns - 1 : turns;
      if (one.open) {
        for (let column = x; column < x + room; column++) open[column] = y;
        step(sky.map((top0, column) => (column >= x && column < x + room ? Infinity : top0)), top, score, placed, later);
        for (let column = x; column < x + room; column++) open[column] = -1;
        continue;
      }
      if (one.under) {
        const before = one.under.map(({ at }) => ({ at, h: places[at].h, size: chosen[at] }));
        const next = resized(score, one.under);
        for (const { at, size } of one.under) { places[at].h = size.h; chosen[at] = size; }
        step(sky.map((top0, column) => (column >= x && column < x + room ? target : top0)), top, next, placed, later);
        for (const { at, h, size } of before) { places[at].h = h; chosen[at] = size; }
        continue;
      }
      const { at, size, moved } = one;
      places[at] = { x, y, w: size.w, h: size.h };
      chosen[at] = size;
      left[at] = false;
      const nextSky = sky.slice();
      const nextTop = top.slice();
      for (let column = x; column < x + size.w; column++) { nextSky[column] = y + size.h; nextTop[column] = at; }
      step(nextSky, nextTop, [score[0], score[1] + size.over, score[2] + size.cost + moved], placed + 1, later);
      left[at] = true;
      places[at] = null;
      chosen[at] = null;
    }
  }

  // The cheapest placing first, then placings with one, two, … other steps, until the tries are used.
  for (let turns = 0; turns <= count && (!best || tries <= PLACE_TRIES); turns++) step(new Array(columns).fill(0), new Array(columns).fill(-1), [0, 0, 0], 0, turns);
  return best.places;
}

/**
 * The shape of a drawing for the size of its card: its count of nodes, how wide it is for how high (`ratio`), and about how wide it comes out in
 * pixels (`width`), from its graph and the direction of its text. A flow chart is laid out in ranks by its arrows: from left to right its ranks stand
 * side by side, from top to bottom one under the other. drawnShape() puts the real shape in its place once it is drawn.
 */
function drawingShape(graph, text = '', schema = null) {
  if (schema) { const tables = schema.tables?.length ?? 2; return { nodes: tables, ratio: 1.4, width: 240 * Math.ceil(Math.sqrt(tables)) }; }
  const nodes = Object.keys(graph?.nodes ?? {});
  const edges = (graph?.edges ?? []).filter((edge) => edge.from !== edge.to);
  if (/^\s*sequenceDiagram/.test(text)) return { nodes: nodes.length || 3, ratio: Math.max(0.6, (nodes.length * 150) / (Math.max(3, edges.length) * 40)), width: Math.max(3, nodes.length) * 150 };
  const rank = Object.fromEntries(nodes.map((node) => [node, 0]));
  for (let round = 0; round < nodes.length; round++) for (const { from, to } of edges) if (rank[from] !== undefined && rank[to] !== undefined && rank[to] < rank[from] + 1) rank[to] = rank[from] + 1;
  const ranks = new Map();
  for (const value of Object.values(rank)) ranks.set(value, (ranks.get(value) ?? 0) + 1);
  const long = Math.max(1, ranks.size);
  const across = Math.max(1, ...ranks.values());
  const sideways = /^\s*(flowchart|graph)\s+(LR|RL)\b/.test(text) || /direction\s+LR/.test(text);
  return { nodes: nodes.length, ratio: sideways ? (long * 170) / (across * 60) : (across * 170) / (long * 70), width: (sideways ? long : across) * 170 };
}

/**
 * The units of a card with a drawing: a wide drawing more units across, a tall one more down, and a drawing with many nodes larger than one with three.
 * Only a drawing of three nodes or fewer may take one unit either way: more nodes would not read in it. `least`: the fewest units either way.
 */
function drawingUnits(shape, least = shape.nodes <= 3 ? 1 : 2) {
  const cells = shape.nodes <= 3 ? 2 : shape.nodes <= 6 ? 4 : shape.nodes <= 12 ? 6 : 9;
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

/** The px of `units` units of `size` px, with the gaps between them. */
const unitsPx = (units, size) => units * size + (units - 1) * CARD_GAP;

/**
 * How well a drawing of the shape `ratio` (wide for high) fills a card of w by h units, drawn as large as the card allows: 1 when it fills both ways,
 * else the share that it fills in its looser direction. `unit` is the px of a unit across, `head` the px of the head of the card.
 */
function fillOf(ratio, w, h, unit, head) {
  const across = unitsPx(w, unit) - 24 - 2; // the room of the body of the card and its borders
  const down = unitsPx(h, UNIT_HIGH) - head - 16 - 2;
  const card = across / Math.max(1, down);
  return Math.min(card / ratio, ratio / card);
}

/** The soft sketch of a map that shimmers slowly, while its diagram is not written yet: large in the frame of Home, small in a card. */
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
  shapes: new Map(), // the shape of each drawing as it came out ({ ratio: wide for high, width }), by the id of its diagram, while the page is open
  again: 0, // a placing that waits for the next frame, after a drawing came out of another shape (drawnShape)

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
   * of its own, drawn small and read only (`shape`: drawingShape() of its drawing), or { title, files: [{ path, line?, folder?, count?, counts?, diff? }] }
   * for a node that leads to files; `changes`: the changes that touch the node, as rows at its bottom; `node` is the id of its node, and `run` ({ state, share }) the state of its area while a map is written: a card
   * that a writer works on shows a sketch that shimmers, a turning mark and its own bar; a card that waits is empty, with a dashed edge and a faint name.
   * A card with a drawing is filled when it comes into view, so a level with many nodes opens at once. A click on a card with a diagram goes one level
   * down (open); a click on a file row does what the page does for that row. The cards take the sizes of their contents and are placed with no gaps.
   */
  cards(holder, items) {
    holder.innerHTML = items.map((item, at) => {
      const state = item.run?.state;
      const head = `<div class="ovh"><span class="ovn" title="${esc(item.title)}">${esc(item.title)}</span>${state === 'working' ? workHtml(item.run.share) : ''}</div>`;
      const changes = item.changes?.length ? `<div class="ovx">${changeRowsHtml(item.changes)}</div>` : ''; // under the content, the changes that touch the node
      return `<div class="ovc${item.open ? ' go' : ''}${state ? ` run-${state}` : ''}" data-card="${at}"${item.node ? ` data-node="${esc(item.node)}"` : ''}>${head}<div class="ovb"></div>${changes}</div>`;
    }).join('');
    holder.hidden = !items.length;
    holder.classList.remove('focus'); // new cards: none has the focus until focusOn says so
    this.held = { holder, items };
    this.openedAt = performance.now();
    // A drawing drawn before on this page keeps the shape that it came out in (drawnShape).
    for (const item of items) if (item.shape && this.shapes.has(item.shape.key)) item.shape = { ...item.shape, ...this.shapes.get(item.shape.key) };
    // The files of a card are written at once: their rows give its size. A drawing waits until the card comes into view.
    for (const card of holder.querySelectorAll('.ovc')) {
      const item = items[Number(card.dataset.card)];
      const body = card.querySelector('.ovb');
      if (item.run?.state === 'working') body.innerHTML = sketchHtml(true);
      else if (item.files) body.innerHTML = `<div class="ovf">${item.files.map(fileRowHtml).join('')}</div>`;
      if (item.run || item.files) card.dataset.drawn = '';
    }
    this.layout(holder, items);
    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries.filter((one) => one.isIntersecting)) {
        seen.unobserve(entry.target);
        const item = items[Number(entry.target.dataset.card)];
        item.draw(entry.target.querySelector('.ovb')).then(() => { entry.target.dataset.drawn = ''; this.drawnShape(holder, items, item, entry.target); }).catch((error) => console.error(error));
      }
    }, { rootMargin: '200px' });
    for (const card of holder.querySelectorAll('.ovc')) {
      const item = items[Number(card.dataset.card)];
      if (item.draw && !item.run) seen.observe(card);
      if (item.open) card.addEventListener('click', (event) => { if (!event.target.closest('[data-open], [data-tree], [data-open-file], [data-change-id]')) item.open(event); });
    }
    if (!this.watched?.has(holder)) {
      (this.watched ??= new WeakSet()).add(holder);
      let width = holder.clientWidth;
      new ResizeObserver(() => { if (holder.clientWidth !== width && this.held?.holder === holder) { width = holder.clientWidth; this.layout(holder, this.held.items); } }).observe(holder);
    }
  },

  /**
   * The size of each card in units (sizeOf), and their places (placeCards). Under 4 units across (a narrow tab), the cards stand in one column at full
   * width and only their heights differ: a card of files as high as its rows need, a card with a drawing as high as its drawing fills best.
   * `again`: the cards are placed again after their drawings came out (drawnShape); the frame of the diagram keeps its height then, so that the
   * diagram does not move under the pointer.
   */
  layout(holder, items, again = false) {
    if (!items.length) return this.trim();
    const style = getComputedStyle(holder);
    const inner = holder.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (!(inner > 0)) return; // not in the page yet, or hidden: the cards are placed when the holder gets its width
    const columns = Math.max(1, Math.floor((inner + CARD_GAP) / (UNIT_LEAST + CARD_GAP)));
    const unit = (inner - (columns - 1) * CARD_GAP) / columns;
    const cards = [...holder.querySelectorAll('.ovc')];
    const sizes = cards.map((card) => this.sizeOf(card, items[Number(card.dataset.card)], unit, columns));
    const narrow = columns < 2 * 2;
    const places = narrow ? (() => { let y = 0; return sizes.map(({ alone }) => ({ x: 0, y: (y += alone) - alone, w: columns, h: alone })); })() : placeCards(sizes, columns);
    holder.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    cards.forEach((card, at) => {
      const { x, y, w, h } = places[at];
      Object.assign(card.style, { gridColumn: `${x + 1} / span ${w}`, gridRow: `${y + 1} / span ${h}` });
      Object.assign(card.dataset, { units: `${w}x${h}` });
    });
    // The head of the cards gives the peek under the frame (keepOverview), so the frame takes its height again now that they are written.
    if (again) return;
    if (this.frame?.isConnected && this.frame.dataset.height && this.frame.sized) this.frame.sized();
    else this.trim();
  },

  /** The rows of the cards changed their width (an icon came or went): the cards are placed again. */
  relayout() {
    if (this.held?.holder.isConnected) this.layout(this.held.holder, this.held.items);
  },

  /**
   * What one card needs, for placeCards (sizesOf): the least units that show its content, and how it may grow.
   * - A card of files (also of a run whose area has files and no drawing yet): as wide as its longest row needs to show whole (folder, name and count;
   *   above 3 units the folder is cut at its left end), and as high as its rows need; it may grow wider, and at most one unit taller than its rows need
   *   (`most`).
   * - A card with a drawing: the units of its shape (drawingUnits), and the other sizes that its drawing still fills well (`fits`, FILL_LEAST), wider,
   *   or higher, or one unit lower to end level with a neighbour; a small drawing grows with its card to at most GROW times its own size.
   * The name in the head stays whole, with the turning mark and the bar of a run beside it when they show. `alone`: its height in one column.
   */
  sizeOf(card, item, unit, columns) {
    const work = card.querySelector('.ovw');
    // The rows of the changes at the bottom count as the head does: whole across, and their height taken from the room of the content.
    const changes = [...card.querySelectorAll('.ovx a')].map((row) => row.querySelector('.nm').scrollWidth + 10 + row.querySelector('.c').offsetWidth);
    const named = unitsFor(Math.max(card.querySelector('.ovn').scrollWidth + (work ? work.offsetWidth + 10 : 0), ...changes) + 24 + 2, unit);
    const head = card.querySelector('.ovh').offsetHeight + (card.querySelector('.ovx')?.offsetHeight ?? 0);
    if (item.shape && !item.files) {
      const fill = (w, h) => fillOf(item.shape.ratio, w, h, unit, head);
      // How much larger than its own size the drawing is drawn in a card of w by h units (its width as guessed, or as it came out).
      const scale = (w, h) => (item.shape.width ? Math.min((unitsPx(w, unit) - 26) / item.shape.width, ((unitsPx(h, UNIT_HIGH) - head - 18) * item.shape.ratio) / item.shape.width) : 1);
      const least = item.shape.nodes <= 3 && !item.changes?.length ? 1 : 2; // over the rows of its changes a drawing needs two units to read
      const own = drawingUnits(item.shape, least);
      const w = Math.max(own.w, named);
      const downs = [1, 2, 3].filter((h) => h >= least);
      const h = w === own.w ? own.h : downs.reduce((best, one) => (fill(w, one) > fill(w, best) ? one : best));
      const fits = [];
      for (let across = w; across <= MOST_UNITS; across++) for (const down of downs) if (down >= h - 1 && fill(across, down) >= FILL_LEAST && scale(across, down) <= GROW) fits.push([across, down]);
      return { w, h, fits, alone: downs.reduce((best, one) => (fill(columns, one) > fill(columns, best) ? one : best)) };
    }
    const files = item.files ?? item.areaFiles ?? [];
    const rows = [...card.querySelectorAll('.ovf a')];
    const rowHigh = rows[0]?.offsetHeight || 21;
    const need = head + 16 + 2 + files.length * rowHigh; // the head, the room of the body above and under its rows, the borders, and the rows
    // A row whole: its icon with the room after it (FileIcons), its folder, its name and its count (the name takes at most 75% of a row).
    const icon = rows[0]?.querySelector('.fi');
    const iconRoom = icon?.offsetWidth ? icon.offsetWidth + parseFloat(getComputedStyle(icon).marginRight) : 0;
    const wide = rows.length ? Math.max(...rows.map((row) => { const name = row.querySelector('.nm').scrollWidth; return Math.max(name / 0.75, iconRoom + (row.querySelector('.dir')?.scrollWidth ?? 0) + name + row.querySelector('.c').offsetWidth + 2); })) : 0;
    const h = files.length ? unitsFor(need, UNIT_HIGH) : 2;
    const most = files.length ? Math.max(h, [1, 2, 3].filter((one) => unitsPx(one, UNIT_HIGH) <= need + UNIT_HIGH + CARD_GAP).pop() ?? h) : h;
    return { w: Math.max(rows.length ? unitsFor(wide + 24 + 2, unit) : 2, named), h, files: true, most, alone: h };
  },

  /**
   * A drawing keeps the shape and the size that it came out in for the next placing on this page: its card then fits its real shape (drawingShape
   * only guessed it), and grows only while the drawing is drawn at most GROW times its own size (sizeOf). While the cards have just opened (SETTLE_MS),
   * they are placed again at once; a card drawn later, when it scrolls into view, keeps its place.
   */
  drawnShape(holder, items, item, card) {
    const svg = card.querySelector('.ovb svg');
    // The drawing without the empty room that its drawing tool leaves around it, so that it fills its card.
    const drawn = svg?.getBBox?.();
    if (drawn?.width && drawn.height) {
      const room = Math.max(drawn.width, drawn.height) * 0.02;
      svg.setAttribute('viewBox', `${drawn.x - room} ${drawn.y - room} ${drawn.width + 2 * room} ${drawn.height + 2 * room}`);
    }
    const box = svg?.viewBox?.baseVal;
    if (!item.shape || !box?.width || !box.height) return;
    const shape = { ratio: box.width / box.height, width: box.width };
    if (item.shape.key) this.shapes.set(item.shape.key, shape);
    const near = (a, b, share) => !!b && Math.abs(Math.log(a / b)) < share;
    const same = near(shape.ratio, item.shape.ratio, 0.1) && near(shape.width, item.shape.width, 0.3);
    item.shape = { ...item.shape, ...shape };
    if (same) return;
    if (performance.now() - this.openedAt > SETTLE_MS || this.held?.items !== items) return;
    cancelAnimationFrame(this.again);
    this.again = requestAnimationFrame(() => { this.again = 0; if (this.held?.items === items) this.layout(holder, items, true); });
  },

  /**
   * A page that is a little too high for its tab does not scroll: the frame of the diagram gives up those pixels. A page much higher than its
   * tab keeps its frame and scrolls to its cards. A drawing that the surface does not make smaller than READABLE keeps its whole height (`least`).
   */
  trim() {
    const frame = this.frame;
    if (!frame?.isConnected || !frame.dataset.height) return;
    const set = Number(frame.dataset.height);
    frame.style.height = `${set}px`;
    const over = document.documentElement.scrollHeight - innerHeight;
    if (over > 0 && over <= set * TRIM_MOST && set - over >= Math.max(OVERVIEW_LEAST, Number(frame.dataset.least ?? 0))) frame.style.height = `${set - over}px`;
  },

  /**
   * How much of the cards shows under a frame that fills the tab: the room above the well and inside it, the head of the first row of
   * cards and a little of their content. Before the cards are written, the peek measured last.
   */
  peek() {
    const holder = this.held?.holder;
    const head = holder && !holder.hidden ? holder.querySelector('.ovc .ovh') : null;
    if (!head) return this.peeked ?? PEEK_FIRST;
    const style = getComputedStyle(holder);
    const card = getComputedStyle(head.parentElement);
    this.peeked = Math.round(parseFloat(style.marginTop) + parseFloat(style.paddingTop) + parseFloat(card.borderTopWidth) + head.offsetHeight + PEEK_CONTENT);
    return this.peeked;
  },

  /**
   * The card of the node that has the focus is focused too: its accent edge, and the other cards fade as the other nodes do; no card has it
   * when no node has the focus. With `reveal`, the page scrolls smoothly, by the least amount, when no part of the card is in view.
   */
  focused(node, reveal = false) {
    let own = null;
    for (const card of document.querySelectorAll('.ovc[data-node]')) {
      const on = !!node && card.dataset.node === node;
      card.classList.toggle('focused', on);
      if (on) own = card;
    }
    for (const holder of document.querySelectorAll('.ovcards')) holder.classList.toggle('focus', !!own && holder.contains(own));
    if (!own || !reveal) return;
    // In view: the part of the tab that shows, and beside the code the half that scrolls.
    const box = own.getBoundingClientRect();
    const half = own.closest('.half')?.getBoundingClientRect();
    const [top, bottom] = [Math.max(0, half?.top ?? 0), Math.min(innerHeight, half?.bottom ?? innerHeight)];
    if (box.bottom > top && box.top < bottom) return;
    own.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
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
  const count = file.counts !== undefined ? countsHtml(file.counts) : mapCountHtml(file.diff, folder && file.count);
  return `<a ${attrs} title="${esc(file.path)}">${FileIcons.html(file.path)}<span class="dir"><bdi dir="ltr">${esc(at)}</bdi></span><span class="nm">${esc(name)}</span><i class="c">${count}</i></a>`;
}

/** The count of a row of the map, in a card and in the window of a node: the counts of the changes that touch it, then a folder's count of files. */
const mapCountHtml = (diff, files) => [countsHtml(diff), files ? plural(files, 'file') : ''].filter(Boolean).join(' · ');

/** One row for each change that touches a node, in its card and in its window: the branch, and how many files of the node it changes. A click opens the change. */
const changeRowsHtml = (changes = []) => changes.map((change) =>
  `<a data-change-id="${change.id}" data-title="${esc(change.title)}"><span class="nm">${esc(change.branch)}</span><i class="c">${plural(change.files.length, 'file')} changed</i></a>`).join('');

/**
 * The height of the frame of a diagram in the overview: the height of the drawing ({ width, height }) at the scale that the surface really
 * draws it at in a frame `across` px wide, with its room to the edges. That scale fits the drawing to the width, at most GROW, and not below `floor`
 * where the surface opens a wide drawing readable (READABLE). The frame is at least OVERVIEW_LEAST high, and at most `room` (the height of the tab
 * under the top of the frame) less `peek`, so that the head of the first row of cards and a little of their content still show under it.
 */
function frameHeight({ width, height, across, room, peek, floor = 0 }) {
  const scale = Math.max(floor, Math.min(GROW, (across - 2 * OVERVIEW_ROOM) / width));
  return Math.round(Math.max(OVERVIEW_LEAST, Math.min(height * scale + 2 * OVERVIEW_ROOM, room - peek)));
}

/**
 * Gives the frame of a diagram in the overview its height (frameHeight), also when the tab changes its size and when the cards under it are written:
 * a small diagram keeps a small frame, and a large one may fill the tab down to the peek of the cards. `width` and `height` are the size of the
 * drawing; `readable`: the surface opens a wide drawing at the size where its words read. The room is counted from the top of the frame with nothing
 * scrolled. A page that is then a little too high for its tab takes it off the frame (Overview.trim).
 */
function keepOverview(stage, width, height, readable) {
  const set = () => {
    let top = stage.getBoundingClientRect().top + scrollY;
    for (let el = stage.parentElement; el; el = el.parentElement) top += el.scrollTop;
    const floor = readable ? READABLE : 0;
    stage.dataset.height = String(frameHeight({ width, height, across: stage.clientWidth, room: innerHeight - top, peek: Overview.peek(), floor }));
    stage.dataset.least = String(floor * width + 2 * OVERVIEW_ROOM > stage.clientWidth ? Math.ceil(height * floor) : 0); // opened readable: not cut by a trim
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

if (typeof module === 'object') module.exports = { placeCards, drawingUnits, fillOf, frameHeight, GROW, OVERVIEW_LEAST, OVERVIEW_ROOM }; // for the tests in Node
