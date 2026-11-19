// The diagram stage: Mermaid draws, and this layer adds hover windows, clicks and drill to what it drew.
'use strict';

// The colours that Mermaid writes into a drawing: for each of its colours, the colour of the look (look.css) that it takes.
const DRAWING_COLORS = {
  primaryColor: '--d-node', primaryBorderColor: '--d-nodeline', primaryTextColor: '--d-text', lineColor: '--d-edge',
  secondaryColor: '--d-region', tertiaryColor: '--d-region', clusterBkg: '--d-region', clusterBorder: '--d-regionline',
  edgeLabelBackground: '--d-label', titleColor: '--d-title', actorBkg: '--d-node', actorBorder: '--d-nodeline',
  actorTextColor: '--d-text', actorLineColor: '--d-lifeline', signalColor: '--d-signal', signalTextColor: '--d-text',
  labelBoxBkgColor: '--d-region', labelBoxBorderColor: '--d-regionline', labelTextColor: '--d-title', loopTextColor: '--d-title',
  noteBkgColor: '--tealsoft', noteBorderColor: '--teal', noteTextColor: '--tealink', activationBkgColor: '--tealsoft',
  activationBorderColor: '--teal', transitionColor: '--d-edge', transitionLabelColor: '--d-title',
  stateLabelColor: '--d-text', stateBkg: '--d-node', stateBorder: '--d-nodeline', compositeBackground: '--d-region', altBackground: '--d-region',
};

/** The colours of DRAWING_COLORS in the look that shows now, as Mermaid reads colours ("#rrggbb"). A mixed colour of CSS is painted on one pixel and read back. */
function drawingColors() {
  const probe = document.body.appendChild(document.createElement('i'));
  const paint = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const colors = {};
  for (const [name, look] of Object.entries(DRAWING_COLORS)) {
    probe.style.color = `var(${look})`;
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = getComputedStyle(probe).color;
    paint.fillRect(0, 0, 1, 1);
    colors[name] = `#${[...paint.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((part) => part.toString(16).padStart(2, '0')).join('')}`;
  }
  probe.remove();
  return colors;
}

// Mermaid draws in the font and size of the page, which are VS Code's, and in the colours of the look.
const pageFont = getComputedStyle(document.body);
let mermaidColors = {}; // the colours that Mermaid has now, by its names
const startMermaid = () => {
  const colors = drawingColors();
  if (JSON.stringify(colors) === JSON.stringify(mermaidColors)) return; // the class of the body changed for another reason
  mermaidColors = colors;
  mermaid.initialize({
    startOnLoad: false, securityLevel: 'antiscript', theme: 'base',
    // The text of a diagram (an agent's, or a block of GitHub) may set no CSS, theme, font or colours of its own: only the look of the page draws it.
    secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'theme', 'themeCSS', 'themeVariables', 'fontFamily', 'altFontFamily', 'darkMode', 'htmlLabels'],
    themeVariables: { fontFamily: pageFont.fontFamily, fontSize: pageFont.fontSize, ...colors },
    flowchart: { htmlLabels: true, nodeSpacing: 34, rankSpacing: 42, padding: 13, useMaxWidth: false },
    sequence: { useMaxWidth: false, mirrorActors: false, messageMargin: 34, actorMargin: 70, width: 130, height: 46, boxMargin: 8 },
    state: { useMaxWidth: false },
  });
};
startMermaid();
// VS Code changes the class of the body and its colours when the theme changes. What is drawn has the colours of the look by name (lookColors),
// so it takes the new ones at once; Mermaid gets them too, for what it draws after.
let themeFrame = 0;
const themeWatch = new MutationObserver(() => { cancelAnimationFrame(themeFrame); themeFrame = requestAnimationFrame(startMermaid); });
themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
themeWatch.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-vscode-theme-id'] });

/**
 * Mermaid writes its colours into a drawing as they are: in the style of the drawing, and on some shapes. Each colour of the look becomes its name,
 * var(--d-…), so that the drawing follows a change of the theme at once, with nothing drawn again. A colour that two names share takes the first.
 */
function lookColors(svg) {
  const names = new Map();
  for (const [name, value] of Object.entries(mermaidColors)) if (!names.has(value)) names.set(value, DRAWING_COLORS[name]);
  const hex = (r, g, b) => `#${[r, g, b].map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
  const named = (text) => text
    .replace(/#[0-9a-f]{6}\b/gi, (value) => (names.has(value.toLowerCase()) ? `var(${names.get(value.toLowerCase())})` : value))
    .replace(/rgba\((\d+), ?(\d+), ?(\d+), ?([\d.]+)\)/g, (value, r, g, b, a) => (names.has(hex(r, g, b)) ? `color-mix(in srgb,var(${names.get(hex(r, g, b))}) ${a * 100}%,transparent)` : value));
  for (const style of svg.querySelectorAll('style')) style.textContent = named(style.textContent);
  for (const el of svg.querySelectorAll('[fill], [stroke], [style]')) {
    for (const paint of ['fill', 'stroke']) {
      const value = el.getAttribute(paint)?.toLowerCase();
      if (names.has(value)) el.style.setProperty(paint, `var(${names.get(value)})`);
    }
    if (el.getAttribute('style')?.includes('#')) el.setAttribute('style', named(el.getAttribute('style')));
  }
}

let drawCount = 0;

/**
 * Draws Mermaid text into an element and returns the SVG, or shows the error.
 * With `plain`, a text that does not draw is drawn as `plain` instead (a diagram of a part without its removed things); the SVG then has data-plain.
 * With `schema` (the tables of a schema diagram, from the page data), the page draws the tables itself (schema.js); `key` names the diagram.
 */
async function drawMermaid(into, text, plain, schema, key) {
  into.classList.add('stage');
  if (schema) {
    into.classList.remove('across');
    const svg = drawSchema(into, schema, key);
    fitToContent(svg);
    return svg;
  }
  into.classList.toggle('across', /^\s*(?:flowchart|graph)\s+(?:LR|RL)\b/m.test(text)); // a flow from left to right starts at its left end
  try {
    const { svg } = await mermaid.render(`apostil-${++drawCount}`, text);
    into.innerHTML = svg;
  } catch (error) {
    // Mermaid leaves the picture of its error at the end of the page; it would show under every later drawing.
    for (const left of document.querySelectorAll(`body > #dapostil-${drawCount}, body > #apostil-${drawCount}`)) left.remove();
    if (plain) {
      const svg = await drawMermaid(into, plain);
      svg?.setAttribute('data-plain', '');
      return svg;
    }
    into.innerHTML = `<div class="err">${esc(error?.message ?? error)}</div>`;
  }
  const svg = into.querySelector('svg');
  if (svg) {
    lookColors(svg);
    svg.classList.toggle('litnames', /^\s*classDef lit\b/m.test(text)); // a drawing of change-diagram.ts: its lit nodes have their names in teal (look.css)
    cutLifelines(svg);
    fitToContent(svg);
  }
  return svg;
}

/**
 * Mermaid leaves the lifelines of a sequence chart 2000 long when it draws no actors at the bottom.
 * They end at the bottom of Mermaid's own frame, a little under the last message. No measuring, so it also holds for a drawing that is not on screen.
 */
function cutLifelines(svg) {
  const [, top, , height] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
  if (!Number.isFinite(top + height)) return;
  for (const line of svg.querySelectorAll('line.actor-line')) line.setAttribute('y2', top + height);
}

/** Sets the frame of a drawing to all that it holds, so that no box lies outside it where scrolling cannot reach. */
function fitToContent(svg) {
  const box = svg.getBBox();
  if (!box.width) return; // not on screen, for example in a closed card
  const pad = 8;
  const [width, height] = [box.width + 2 * pad, box.height + 2 * pad];
  svg.setAttribute('viewBox', `${box.x - pad} ${box.y - pad} ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.style.maxWidth = '';
}

/** What a double click on a surface leaves alone: a double click on an empty place fits the diagram (or goes to the target of the frame of a look). */
const ON_A_THING = 'g.node, g.image-shape, .f, .go, a';

/** The smallest scale that a wide map opens at: under it the words are smaller than 11 px. */
const READABLE = 0.85;

// The zoom and the place that he left each diagram at, by the key of the diagram, while the page shows one view (a step of the path, by its key).
// A diagram that draws again with new data opens there; another view of the page forgets them, so that a new diagram fits.
const leftAt = { page: null, views: new Map() };

/**
 * Makes a drawn diagram a surface that he moves: a drag, the wheel and a scroll with two fingers move it, a pinch and Cmd+scroll zoom at the pointer,
 * and a double click on an empty place fits it whole to its card. The card takes the height that is left in the tab.
 * With `readable` (a map, a wider diagram), a diagram so wide that fitting it would make the words small opens at a size where they read, at the start of its flow.
 * With `stack` (one of several diagrams one under the other in a half that scrolls), the card takes the height of the diagram fit to its width, or at the size
 * where its words read, and at most most of the half; a scroll that the drawing cannot take (all of it shows that way) scrolls the half.
 * With `key` (the name of the diagram in its view), the same diagram drawn again keeps the zoom and the place that he left it at (leftAt); a fit forgets them.
 * With `overview` (build 83: cards stand under it), the card takes the height of the drawing at the scale that it is drawn at, at most the tab down to the
 * peek of the cards (keepOverview, build 85), and a small diagram is drawn larger, up to GROW, to fill its width.
 */
function makeSurface(stage, readable = false, stack = false, key = undefined, overview = false) {
  const page = typeof Trail === 'object' ? Trail.ownKey() : null;
  if (page !== leftAt.page) Object.assign(leftAt, { page, views: new Map() });
  const left = leftAt.views.get(key);
  const svg = stage.querySelector('svg');
  if (stack && svg) fitToContent(svg); // with the counts of its arrows, which come after Mermaid: the card shows all of it
  const frame = svg?.getAttribute('viewBox')?.split(' ').map(Number);
  if (!frame) return;
  let [x0, y0, width, height] = frame;
  stage.classList.add('surface');
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  const stackHeight = () => {
    const scale = Math.max(READABLE, Math.min(1, stage.clientWidth / width));
    stage.style.height = `${Math.round(Math.min(height * scale, stage.closest('.half').clientHeight * 0.8))}px`;
  };
  delete stage.dataset.height; // the height of the frame in an overview, which Overview.trim reads
  delete stage.dataset.least;
  // In a half of the page a diagram too large for it, wide or tall, opens readable at its start too.
  const half = !!stage.closest('.split');
  if (stack) stackHeight();
  else if (overview) keepOverview(stage, width, height, readable || half);
  else keepFilled(stage);
  let view = { x: x0, y: y0, scale: 1 };
  let moved = false; // he moved or zoomed it, so a new size of the card keeps his view
  const apply = () => {
    if (!svg.isConnected) return; // an earlier drawing of this card: its keys and its sizes are those of the new one now
    const [w, h] = [stage.clientWidth, stage.clientHeight];
    if (w && h) svg.setAttribute('viewBox', `${view.x} ${view.y} ${w / view.scale} ${h / view.scale}`);
    if (key === undefined) return;
    if (moved) leftAt.views.set(key, view);
    else leftAt.views.delete(key);
  };
  const fit = (whole = false) => {
    const [w, h] = [stage.clientWidth, stage.clientHeight];
    if (!w || !h) return;
    const room = overview ? 2 * OVERVIEW_ROOM : 0; // in the overview the drawing keeps some room from the edges of its frame
    let scale = Math.min(overview ? GROW : 1, (w - room) / width, (h - room) / height);
    const columns = stage.classList.contains('columns'); // a long chain in columns: tall, but it opens where its words read, at its top
    const wide = (readable || half) && (half || columns || w / width < h / height) && scale < READABLE;
    if (wide && !whole) scale = READABLE;
    const middle = { x: x0 - (w / scale - width) / 2, y: y0 - (h / scale - height) / 2 };
    // The start of a wide flow: its left end when it goes from left to right, else its top in the middle.
    const across = stage.classList.contains('across');
    // In a half, a diagram wider than the half starts at its left end too.
    const fromLeft = across || (half && w / scale < width);
    view = wide && !whole ? { scale, x: fromLeft ? x0 : middle.x, y: (across && !columns) || h / scale >= height ? middle.y : y0 } : { scale, ...middle };
    moved = false;
    apply();
  };
  const zoomAt = (px, py, factor) => {
    const scale = Math.min(4, Math.max(0.1, view.scale * factor));
    view = { scale, x: view.x + px / view.scale - px / scale, y: view.y + py / view.scale - py / scale };
    moved = true;
    apply();
  };
  /** Moves the view by a scroll of the wheel or two fingers (`dx`, `dy` in pixels), not out of the drawing; false when it cannot move that way. */
  const scrollBy = (dx, dy) => {
    const room = (at, delta, start, total, size) => (total <= size ? at : delta > 0 ? Math.max(at, Math.min(at + delta, start + total - size)) : Math.min(at, Math.max(at + delta, start)));
    const [w, h] = [stage.clientWidth / view.scale, stage.clientHeight / view.scale];
    const next = { ...view, x: room(view.x, dx / view.scale, x0, width, w), y: room(view.y, dy / view.scale, y0, height, h) };
    if (next.x === view.x && next.y === view.y) return false;
    view = next;
    moved = true;
    apply();
    return true;
  };
  // A scroll with two fingers or the wheel moves the drawing; a pinch (a wheel with Ctrl) and Cmd+scroll zoom at the pointer. In a stack, a scroll that the
  // drawing cannot take, because all of it shows that way, scrolls the half.
  stage.addEventListener('wheel', (event) => {
    const zoom = event.ctrlKey || event.metaKey;
    const took = zoom || scrollBy(event.deltaX, event.deltaY);
    if (!took && stack) return; // the half scrolls
    event.preventDefault();
    Hover.hide(); // no hover window opens over the diagram while he moves or zooms it
    if (!zoom) return;
    const box = stage.getBoundingClientRect();
    zoomAt(event.clientX - box.left, event.clientY - box.top, Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002))); // a pinch comes as a wheel with Ctrl
  }, { passive: false });

  // A drag starts after the pointer moved a few pixels, so a click on a part or a file name still works.
  let drag = null;
  let dragged = false;
  stage.addEventListener('pointerdown', (event) => {
    if (event.button === 0) drag = { x: event.clientX, y: event.clientY, from: { ...view }, on: false, id: event.pointerId };
  });
  stage.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const [dx, dy] = [event.clientX - drag.x, event.clientY - drag.y];
    if (!drag.on && Math.hypot(dx, dy) < 4) return;
    if (!drag.on) { drag.on = true; stage.setPointerCapture(drag.id); stage.classList.add('dragging'); Hover.hide(); }
    view = { ...drag.from, x: drag.from.x - dx / view.scale, y: drag.from.y - dy / view.scale };
    moved = true;
    apply();
  });
  const end = () => { dragged = !!drag?.on; drag = null; stage.classList.remove('dragging'); };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('click', (event) => { if (dragged) { event.stopPropagation(); event.preventDefault(); } dragged = false; }, true);
  stage.addEventListener('dblclick', (event) => { if (!event.target.closest(ON_A_THING)) fit(true); });
  new ResizeObserver(() => (moved ? apply() : fit())).observe(stage);

  /** Moves the view so that an element of the diagram is in the middle, when it is outside; with `smooth`, in a short animation. */
  let stopMove = () => {};
  const show = (el, smooth = false) => {
    const [box, card] = [el.getBoundingClientRect(), stage.getBoundingClientRect()];
    if (box.left >= card.left && box.right <= card.right && box.top >= card.top && box.bottom <= card.bottom) return;
    const from = { ...view };
    const to = { x: view.x + (box.left + box.width / 2 - card.left - card.width / 2) / view.scale, y: view.y + (box.top + box.height / 2 - card.top - card.height / 2) / view.scale };
    // In a stack the view stays on the drawing: a thing near its edge comes to that edge of the card, not to the middle of empty room.
    const keep = (at, start, size, room) => (size > room ? Math.max(start, Math.min(start + size - room, at)) : at);
    if (stack) Object.assign(to, { x: keep(to.x, x0, width, card.width / view.scale), y: keep(to.y, y0, height, card.height / view.scale) });
    moved = true;
    stopMove();
    const step = (part) => { view = { ...view, x: from.x + (to.x - from.x) * part, y: from.y + (to.y - from.y) * part }; apply(); };
    if (smooth) stopMove = glide(step);
    else step(1);
  };
  /** The drawing grew or shrank (a table of a schema opened its columns): the frame takes all of it again, and the view fits it. */
  const reframe = () => {
    const box = svg.getBBox();
    if (!box.width) return;
    [x0, y0, width, height] = [box.x - 8, box.y - 8, box.width + 16, box.height + 16];
    if (stack) stackHeight();
    fit();
  };
  stage.surface = { fit, show, reframe, kept: !!left }; // kept: the view is the one that he left, so the page moves it to nothing by itself
  if (!left) return fit();
  view = left;
  moved = true;
  apply();
}

/** The node id of the Mermaid text of a drawn node or state. */
const nodeKey = (g) => (/(?:flowchart|state)-(.+)-\d+$/.exec(g.id) || [])[1];

/** Lights the nodes and participants with these ids; with none and `all`, every node and actor, for a diagram that is wholly about the path. Returns how many. */
function lightNodes(into, keys, all = false) {
  const lit = all && !keys.length
    ? [...into.querySelectorAll('g.node, g.image-shape, rect.actor')]
    : [...into.querySelectorAll('g.node, g.image-shape, rect.actor[name]')].filter((el) => keys.includes(el.tagName === 'rect' ? el.getAttribute('name') : nodeKey(el)));
  for (const el of lit) el.classList.add('lit');
  return lit.length;
}

/** The name of a node of a graph in plain words: no tags, and without the count of the steps that a step holds. */
const plainName = (graph, node) => (graph.nodes[node] ?? node).replace(/<[^>]+>/g, ' ').replace(/\s+\d+ steps?$/, '').trim();

/** The node of a drawing that a click is on. A panel of the graphs page takes no pointer itself, so there the place of the click finds the node. */
function nodeAt(stage, event) {
  const inside = (g) => { const box = g.getBoundingClientRect(); return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom; };
  return event.target.closest('g.node, g.image-shape') ?? [...stage.querySelectorAll('g.node, g.image-shape')].find(inside) ?? null;
}

/**
 * Focus on a node (build 64): the node, its arrows and the nodes at their other ends stay as they are, and the rest of the drawing grows faint
 * (look.css), as the rest around lit nodes does. `graph` is the graph of the drawing. With no node, the focus ends. Returns the name of the node,
 * or null when the drawing has no such node. A drawn process also joins two boxes without an arrow of Mermaid: a dot at the box that calls
 * (`graph.dots`) and the arrow of the page from one column to the next (path.colink); both count as arrows of the node.
 */
function focusNode(stage, graph, node) {
  for (const el of stage.querySelectorAll('.tied, .focused')) el.classList.remove('tied', 'focused');
  const nodes = [...stage.querySelectorAll('g.node, g.image-shape')];
  const own = node ? nodes.find((g) => nodeKey(g) === node) : null;
  stage.classList.toggle('focus', !!own);
  if (!own) return null;
  const tied = new Set([node]); // the node and the nodes at the other ends of its arrows
  edgeElements(stage.querySelector('svg'), graph.edges).forEach(({ path, label }, at) => {
    const { from, to } = graph.edges[at];
    if (!path || (from !== node && to !== node)) return;
    tied.add(from).add(to);
    // The arrow with its words, the wide line that the pointer finds, its counts and its marks.
    for (const el of [path, label, path.nextElementSibling?.classList.contains('hit') && path.nextElementSibling, path.countsText, path.chips]) if (el) el.classList.add('tied');
  });
  for (const [from, list] of Object.entries(graph.dots ?? {})) for (const to of list) if (from === node || to === node) tied.add(from).add(to);
  for (const path of stage.querySelectorAll('path.colink')) {
    const { from, to } = path.dataset;
    if (from === node || to === node) { tied.add(from).add(to); path.classList.add('tied'); }
  }
  for (const g of nodes) g.classList.toggle('tied', tied.has(nodeKey(g)));
  own.classList.add('focused');
  return plainName(graph, node);
}

// ----- one click focuses a node, two clicks go into it (build 84; on Home, the graphs page and "Diagram" of a change) -----
// Build 85: where cards stand under the diagram, one click focuses the node and its card, and the card is the way in.

let focus = null; // { stage, graph, node, diagram }: the drawing with its graph, the node that the focus is on, and on Home the diagram

/**
 * Focuses a node of a drawing, with its arrows and the nodes at their other ends (focusNode); the same node again, or no node, ends the focus.
 * One quiet line in the head, after the path, names the node, with a × that ends it; it stands on the line of the path, so nothing under the pointer
 * moves when it comes (build 84). The card of the node in the overview is focused too, and comes into view when none of it shows (build 85);
 * `quiet`: the same diagram drawn again keeps its focus, and the page does not move.
 */
function focusOn(stage, graph, node, diagram, quiet = false) {
  const again = focus?.stage === stage && focus.node === node;
  if (focus) focusNode(focus.stage, focus.graph, null);
  const name = node && !again ? focusNode(stage, graph, node) : null;
  focus = name ? { stage, graph, node, diagram } : null;
  endFocusLine();
  if (name) document.getElementById('crumb')?.insertAdjacentHTML('afterend', `<span class="mk-filter fc">Focus: ${esc(name)} · <a data-end-focus title="End the focus (Escape)">×</a></span>`);
  if (typeof Overview === 'object') Overview.focused(focus?.node ?? null, !quiet);
}

/** True when cards stand under this drawing (the overview, build 83): there a click on a node does not go in, the card does (build 85). */
const cardsShow = (stage) => stage.dataset.height !== undefined;

/** The line of the focus goes: the focus ended, or the page draws another view (a new drawing starts with no focus). */
const endFocusLine = () => document.querySelector('.bar > .fc')?.remove();

/** True when the focus is on this node of this drawing. */
const hasFocus = (stage, node) => focus?.stage === stage && focus.node === node;

/** What a click inside a node leaves to its own row: a file, "5 more files", a mark or another link. */
const IN_A_NODE = '.f, a, .mk-holder, .mk-chip';

let wentInAt = 0; // the time of the last click that went into a node: the double click that follows it does not go in again

/**
 * The clicks of a node: one click focuses it (focusOn), as Option+click does; a click on the node that has the focus, or a double click, goes into it
 * (`into`: one level down, or its code). Where cards stand under the drawing (build 85), they do not: a second click keeps the focus, and the card or
 * "Open" in the window of the node goes in. A double click on a node never fits the drawing. The look wins where it gives the click, Option+click,
 * Shift+click or the double click of the node a target (Marks.bind, whose listeners come after these). `el` takes the clicks; `find(event)` is the
 * node that a click is on, or null (a panel of the graphs page finds it by the place of the click). Call it before Marks.bind.
 */
function focusClicks(el, { stage, graph, slots = {}, into, diagram, find = () => el }) {
  const looks = (event) => !!(slots.click || (event.altKey && slots['input.alt']) || (event.shiftKey && slots['input.shift']));
  const nodeOf = (event) => {
    const g = find(event);
    const row = event.target.closest?.(IN_A_NODE);
    return g && !(row && g.contains(row)) ? g : null;
  };
  el.addEventListener('click', (event) => {
    const g = !looks(event) && nodeOf(event);
    if (!g || !stage.contains(g)) return;
    event.stopImmediatePropagation(); // not also the click of the node, or of the panel that holds it
    event.preventDefault();
    if (event.detail > 1) return; // the second click of a double click: the double click goes in
    Hover.hide();
    if (!hasFocus(stage, nodeKey(g))) return focusOn(stage, graph, nodeKey(g), diagram);
    if (cardsShow(stage)) return Overview.focused(focus.node, true); // the focus stays, and its card comes into view when it is out of view
    wentInAt = Date.now();
    into?.(event);
  });
  el.addEventListener('dblclick', (event) => {
    const g = !slots['input.double'] && nodeOf(event);
    if (!g || !stage.contains(g)) return;
    event.stopPropagation();
    if (cardsShow(stage) || Date.now() - wentInAt < 700) return;
    Hover.hide();
    into?.(event);
  });
}

// Escape ends the focus, when no window is open and no comment is being placed (Escape closes those first), and not in a text field.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !focus || document.querySelector('.win') || document.body.classList.contains('picking') || event.target.closest?.('[data-field], textarea, input, [contenteditable]')) return;
  focusOn(null);
}, true);

// The × of the line ends the focus, and so does a click on an empty place of the drawing (a drag is no click: the surface takes it) or between
// the cards under it.
document.addEventListener('click', (event) => {
  if (!focus) return;
  if (event.target.closest('[data-end-focus]')) return focusOn(null);
  if (document.body.classList.contains('picking')) return;
  if (focus.stage.isConnected && focus.stage.contains(event.target) && !event.target.closest(`${ON_A_THING}, .ovt, .mk-holder`)) focusOn(null);
  else if (event.target.matches('.ovcards')) focusOn(null);
});

// ----- the things of a drawing that a comment can be stuck on -----

/**
 * The drawn arrow and label of each edge of the graph, as [{ path, label }] in the order of `edges`. A flow chart names its paths
 * "L_<from>_<to>_<n>", a state diagram "edge<n>"; n counts the edges in the order of the text. A label that does not fit is left out.
 */
function edgeElements(svg, edges) {
  // The words of a drawn label, without the number of its order: the number is no part of the label of an edge.
  const wordsOf = (label) => {
    const copy = label.cloneNode(true);
    for (const number of copy.querySelectorAll('.eo')) number.remove();
    return copy.textContent.trim();
  };
  const found = edges.map(() => ({}));
  const used = new Set();
  for (const group of svg.querySelectorAll('.edgePaths')) {
    const labels = [...(group.parentElement.querySelector(':scope > .edgeLabels')?.children ?? [])];
    [...group.querySelectorAll(':scope > path:not(.hit)')].forEach((path, index) => {
      const n = (/(\d+)$/.exec(path.id) || [])[1];
      const fits = (edge, at) => !used.has(at) && (path.id.startsWith(`L_${edge.from}_${edge.to}_`) || path.id === `edge${at}`);
      const exact = edges.findIndex((edge, at) => fits(edge, at) && String(at) === n);
      const at = exact >= 0 ? exact : edges.findIndex(fits);
      if (at < 0) return;
      used.add(at);
      const label = labels[index];
      found[at] = { path, label: label && wordsOf(label) === (edges[at].label ?? '').trim() ? label : null };
    });
  }
  return found;
}

/** Marks each drawn arrow and its label with the edge of the graph that it draws. */
function markEdges(svg, edges, thingOf) {
  edgeElements(svg, edges).forEach(({ path, label }, at) => {
    if (!path) return;
    Places.mark(path, thingOf(edges[at]));
    // A wide line that does not show, over the thin one, so the pointer finds the arrow.
    const hit = path.cloneNode(false);
    hit.removeAttribute('id');
    hit.removeAttribute('marker-end');
    hit.removeAttribute('marker-start');
    hit.setAttribute('class', 'hit');
    Places.mark(hit, thingOf(edges[at]));
    path.after(hit);
    if (label) Places.mark(label, thingOf(edges[at]));
  });
}

/** The arrows, messages or transitions of a drawn diagram of a part, in the order of the drawing: with the removed ones, unless it was drawn plain. */
const drawnEdges = (diagram, svg) => (diagram.edges ?? diagram.graph.edges).filter((edge) => edge.change !== 'removed' || !svg.hasAttribute('data-plain'));

const SVG_NS = 'http://www.w3.org/2000/svg';

/** "+3 −2" as SVG tspans in green and red, for the diff of an arrow. */
const countsTspans = ({ added, removed }) => [added ? `<tspan class="p">+${number(added)}</tspan>` : '', removed ? `<tspan class="m">−${number(removed)}</tspan>` : ''].filter(Boolean).join(' ');

/** The diff of an arrow of a flow chart or a state diagram, at the middle of its line: under its label, or beside the line with no label. Returns the text. */
function edgeCountsAt(path, label, counts) {
  const length = path.getTotalLength?.();
  if (!length) return null;
  const middle = path.getPointAtLength(length / 2);
  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('class', 'ecount');
  let [x, y] = [middle.x + 6, middle.y + 4];
  const toPath = label?.getBBox().width > 0 && path.parentElement.getScreenCTM()?.inverse().multiply(label.getScreenCTM()); // an arrow with no text has an empty label
  if (toPath) { // the middle of the lower edge of the label, in the place of the line
    const box = label.getBBox();
    const under = new DOMPoint(box.x + box.width / 2, box.y + box.height).matrixTransform(toPath);
    [x, y] = [under.x, under.y + 12];
  }
  text.setAttribute('text-anchor', toPath ? 'middle' : 'start');
  text.setAttribute('x', x);
  text.setAttribute('y', y);
  text.innerHTML = countsTspans(counts);
  path.parentElement.append(text);
  return text;
}

/**
 * Marks what the change did to a drawn diagram of a part, as classes: d-add, d-del, d-both, d-changed and d-removed, on nodes, participants, states,
 * arrows, messages and transitions. The look (look.css) colours no node and no arrow: only the diff numbers are green and red, and a removed
 * thing is dashed. An arrow with a diff gets its counts at its label.
 */
function paintChange(into, diagram) {
  const svg = into.querySelector('svg');
  const change = diagram?.change;
  if (!svg || !change) return;
  const paint = (el, kind) => kind && el?.classList.add(`d-${kind}`);
  for (const g of svg.querySelectorAll('g.node')) paint(g, change.paint[nodeKey(g)]);
  const edges = drawnEdges(diagram, svg);
  if (diagram.kind === 'sequence') {
    for (const actor of svg.querySelectorAll('rect.actor[name]')) paint(actor, change.paint[actor.getAttribute('name')]);
    const texts = svg.querySelectorAll('text.messageText');
    const lines = svg.querySelectorAll('.messageLine0, .messageLine1');
    edges.forEach((edge, at) => {
      paint(texts[at], edge.paint);
      paint(lines[at], edge.paint);
      if (edge.counts && texts[at]) texts[at].insertAdjacentHTML('beforeend', ` ${countsTspans(edge.counts)}`);
    });
    return;
  }
  edgeElements(svg, edges).forEach(({ path, label }, at) => {
    paint(path, edges[at].paint);
    paint(label, edges[at].paint);
    if (path && edges[at].counts) path.countsText = edgeCountsAt(path, label, edges[at].counts); // the pointer on it joins the arrow too
  });
}

/** The total of what the change did to a diagram, as quiet HTML beside its title: "+2 steps −1 step · 1 changed", or "new". */
const changeWordsHtml = (diagram) => (diagram?.change
  ? `<span class="dchg">${diagram.change.words.map((group) => group.map((word) => `<i class="${word.tone}">${esc(word.text)}</i>`).join(' ')).join(' · ')}</span>`
  : '');

/**
 * Marks the things of a drawn diagram: each node, participant and state, each arrow, message and transition with its label,
 * and with `whole` the drawing itself, for the diagram as a whole. The ids are those of the Mermaid text, from the page data.
 */
function markDiagram(into, diagram, whole = true) {
  const svg = into.querySelector('svg');
  if (!svg) return;
  const { id, graph } = diagram;
  if (whole) Places.mark(svg, { kind: 'diagram', diagram: id });
  const edge = (one) => ({ kind: 'edge', diagram: id, edge: [one.from, one.to], name: one.label });
  // A removed thing that the drawing puts back holds no comment: it is not in the diagram now.
  const edges = drawnEdges(diagram, svg);
  if (diagram.kind === 'sequence') {
    for (const actor of svg.querySelectorAll('rect.actor[name]')) {
      if (actor.getAttribute('name') in graph.nodes) Places.mark(actor.parentElement, { kind: 'node', diagram: id, node: actor.getAttribute('name') });
    }
    const texts = svg.querySelectorAll('text.messageText');
    const lines = svg.querySelectorAll('.messageLine0, .messageLine1');
    edges.forEach((one, at) => one.change !== 'removed' && [texts[at], lines[at]].filter(Boolean).forEach((el) => Places.mark(el, edge(one))));
    return;
  }
  // A node that the look fills with a picture is drawn by Mermaid as a picture shape, not as g.node: it is a node all the same.
  for (const g of svg.querySelectorAll('g.node, g.image-shape')) if (nodeKey(g) in graph.nodes) Places.mark(g, { kind: 'node', diagram: id, node: nodeKey(g) });
  markEdges(svg, edges.filter((one) => one.change !== 'removed'), edge);
}

// ----- what the hover windows show -----

/** The window of a file name: its facts in the quiet line of the title ("facts") and its diff ("diff"); `slots` of a rule of the look order them and leave some out. */
function fileWindow(path, slots = {}) {
  return async () => {
    const file = App.page.files.find((candidate) => candidate.path === path);
    const folder = folderOf(path);
    const facts = { id: 'facts', sub: `${countsHtml(file)}${file?.renamedFrom ? ` · renamed from ${esc(file.renamedFrom)}` : ''}${folder ? ` · <a data-folder="${esc(folder)}">${esc(folder)}</a>` : ''}` };
    // A file with no rows to draw (a picture, a fact, no changed line) has no "ready", unless a section of a look's own fills itself: nothing of it is read as code.
    const frame = (diff) => {
      const content = Marks.windowOf({ title: baseName(path), width: 640, sections: [facts, { id: 'diff', ...diff }] }, slots);
      return { ...content, ready: diff.ready || content.ids.some((id) => id.startsWith('own-')) ? content.ready : undefined, open: () => App.openFile(path) };
    };
    if (file?.what) return frame({ html: await factHtml(file) });
    const lines = (await ask(`diff:${path}`)) ?? [];
    if (!lines.length) return frame({ html: '<div class="quiet" style="padding:4px 12px">No changed lines.</div>' });
    // The scroll bar has the size of the whole diff at once; long lines wrap.
    return frame({ html: `<div data-file="${esc(path)}"></div>`, ready: (body) => codeWithNotes(body.querySelector(`[data-file="${CSS.escape(path)}"]`), { rows: diffRows(lines, file?.cells), scroller: body, path }) });
  };
}

function filesWindow(title, paths) {
  return () => {
    const rows = paths.map((path) => {
      const file = App.page.files.find((candidate) => candidate.path === path);
      return `<a data-open-file="${esc(path)}"><span>${esc(path)}</span><i class="c">${countsHtml(file)}</i></a>`;
    }).join('');
    return { title, sub: plural(paths.length, 'file'), width: 620, body: `<div class="rows">${rows}</div>` };
  };
}

const PLACE_AROUND = 2; // rows shown above and under the lines of a place

/** One place in words: "lines 12–20", "removed lines 3–4", or "whole file". */
const placeText = (place) => (!place.lines ? 'whole file' : `${place.removed ? 'removed ' : ''}${whereText(place)}`);

/**
 * The places of a thing one under the other, into `holder`: each with its file name and its lines, and a few rows around them, the added rows green
 * and the removed rows red. A whole file shows its head and its counts. `check` is what the second agent found at the thing.
 */
async function drawPlaces(holder, code, scroller, check) {
  holder.innerHTML = (check ? `<div class="pck">Check: ${esc(check)}</div>` : '') + code.places.map((place) => {
    const file = App.page.files.find((candidate) => candidate.path === place.file);
    return `<div class="plc"><div class="plh"><a data-open-file="${esc(place.file)}">${esc(place.file)}</a><span class="quiet">${esc(placeText(place))}</span>`
      + `${place.lines ? '' : `<i class="c">${countsHtml(file)}</i>`}</div>${place.lines ? `<div class="plr" data-file="${esc(place.file)}"></div>` : ''}</div>`;
  }).join('');
  const boxes = holder.querySelectorAll('.plc');
  await Promise.all(code.places.map(async (place, at) => {
    const box = boxes[at].querySelector('.plr');
    const answer = box && await ask(`code:${place.file}`);
    if (!answer) return;
    const rows = fileRows(answer);
    const span = spanOf(rows, place);
    if (!span) return void (box.outerHTML = '<p class="quiet">These lines are not in the file now.</p>');
    const shown = rows.slice(Math.max(0, span[0] - PLACE_AROUND), span[1] + PLACE_AROUND + 1);
    const color = lineColors(codeToColor(answer));
    const view = codeWithNotes(box, { rows: shown, scroller, path: place.file, colorOf: (row) => (row.now && row.kind !== 'del' ? color(row.now) : undefined) });
    view.mark('lit', place);
  }));
}

/** The window on a thing of a diagram: its places, or its reason in plain words. A click on the head of a place opens its file. */
function placesWindow(name, code, check, slots = {}) {
  return async () => {
    const [first] = code.places;
    const pointed = { id: 'check', html: check ? `<div class="pck">Check: ${esc(check)}</div>` : '' };
    if (!first) return { ...Marks.windowOf({ title: name, width: 320, sections: [{ id: 'why', html: `<div class="why">${esc(code.why ?? '')}</div>` }, pointed] }, slots), pad: true };
    const sub = code.places.length > 1 ? plural(code.places.length, 'place') : `${esc(baseName(first.file))} · ${esc(placeText(first))}`;
    // What the check found stands over the places, in the same box.
    const content = Marks.windowOf({ title: name, sub, width: 600, sections: [{ id: 'places', html: '<div class="places"></div>' }, { id: 'check' }] }, slots);
    return {
      ...content, open: () => App.showCode(first.file, first.lines && !first.removed ? first.lines : null),
      ready: async (body) => { await content.ready(body); if (content.ids.includes('places')) await drawPlaces(body.querySelector('.places'), code, body, content.ids.includes('check') ? check : undefined); }, // and the sections of a look's own
    };
  };
}

/**
 * A part shows its next diagram down ("diagram"), or else its full list of files ("files"). `slots` of a rule of the look give the sections, their
 * order and the width, and the lines of what a click does.
 */
function partWindow(part, slots = {}) {
  const diagram = App.page.diagrams.find((candidate) => candidate.id === part.diagrams[0]);
  const files = filesWindow(part.name, part.files);
  // "Open" goes where two clicks on the part went before the cards (build 85): its diagram, or its first file.
  const open = diagram ? () => App.go({ level: 'part', part: part.id }) : () => App.openPart(part.id);
  if (!diagram && !Object.keys(slots).length) return () => ({ ...files(), open });
  return () => {
    const list = files();
    const sections = [
      ...(diagram ? [{ id: 'diagram', sub: `${esc(diagram.title)} ${changeWordsHtml(diagram)}`, html: '<div class="pdg"></div>', ready: async (body) => {
        const into = body.querySelector('.pdg');
        await drawMermaid(into, diagram.draw, diagram.plain, diagram.schema, diagram.id); markDiagram(into, diagram); paintChange(into, diagram);
      } }] : []),
      { id: 'files', sub: list.sub, html: list.body },
    ];
    const shown = slots['window.sections'] ? sections : sections.slice(0, 1); // with no rule, the diagram, or else the files
    const content = Marks.windowOf({ title: part.name, width: shown[0].id === 'diagram' ? 440 : 620, sections: shown }, slots);
    return { ...content, pad: content.ids[0] === 'diagram', open };
  };
}

// ----- a click on a mark of a part or a step (build 63), as on Home (pickMark in home.js) -----

/** Opens a place of a mark: its file at its line. */
const openMark = (file, line) => App.showCode(file, [line, line]);

/** A value with one place opens it; with several, its window lists them (false). As a node of Home with no level under it. */
const pickPlace = (thing, one) => (one.marks.length === 1 ? (openMark(one.marks[0].file, one.marks[0].at), true) : false);

/** A part with a flow chart goes down to it, with the steps that hold the value lit, as a node of Home goes down a level; else as pickPlace. */
function pickPart(thing, one) {
  const page = App.page;
  const diagram = page.diagrams.find((candidate) => candidate.id === page.parts.find((part) => part.id === thing.id)?.diagrams[0]);
  if (diagram?.kind !== 'flow') return pickPlace(thing, one);
  const lit = Object.entries(Marks.stepThings(diagram, page.look.marks)).filter(([, step]) => step.marks.some((mark) => Marks.keyOf(mark) === one.key)).map(([key]) => key);
  App.go({ level: 'part', part: thing.id, diagram: diagram.id, lit });
  return true;
}

// ----- the three levels of diagrams -----

/**
 * The diagram of the change. After drill up from a part, that part holds its diagram whole or is lit.
 * With `tie` (the diffs stand beside it), no window opens on a part or a file name: the pointer that rests on a part calls tie.part(id),
 * on a file name tie.file(path); a click on a part calls tie.click(id) when the tie has it, else it opens the part.
 */
async function drawChange(into, fromPart, tie) {
  const page = App.page;
  const part = page.parts.find((candidate) => candidate.id === fromPart);
  // The links between parts, with the node ids that the Mermaid text of the change gives the parts.
  const index = (id) => page.parts.findIndex((candidate) => candidate.id === id);
  const written = page.links.filter((link) => index(link.from) >= 0 && index(link.to) >= 0)
    .map((link) => ({ from: `ap${index(link.from)}`, to: `ap${index(link.to)}`, label: link.label, link }));
  const text = part?.drillUp ?? page.changeDiagram;
  const looked = await changeLook(text, written);
  await drawMermaid(into, looked.text, looked.text === text ? part?.drillUpPlain : text);
  const svg = into.querySelector('svg');
  const inLook = page.look && svg && !svg.hasAttribute('data-plain'); // a look whose text does not draw leaves the diagram as it is
  const links = inLook ? looked.edges : written;
  if (inLook) {
    const drawn = edgeElements(svg, links).map(({ path, label }, at) => ({ ...links[at], path, label })); // decorate reads the drawn line and label of each
    // With the marks of the parts at their corners (build 63); a drawing that the look does not touch keeps its frame, as on Home.
    if (Marks.decorate(svg, looked.things, drawn, page.look, looked.filled, { nodeKey, open: openMark, pick: pickPart })) fitToContent(svg);
  }
  const fileSlotsOf = fileSlots(page);
  if (svg) Places.mark(svg, { kind: 'diagram' });
  // The graph of the drawing for a focus (build 84): the parts by the ids of their nodes, and the links in the order of their drawn arrows.
  const graph = { nodes: Object.fromEntries(page.parts.map((one, at) => [`ap${at}`, one.name])), edges: links };
  const carded = !Overview.isFull(); // each part has a card of the overview (changeCards): its window only with the rule "window" (build 86)
  for (const title of into.querySelectorAll('b[data-part]')) {
    const node = title.closest('g.node');
    const id = title.dataset.part;
    const thePart = page.parts.find((candidate) => candidate.id === id);
    const slots = (inLook && looked.things[`ap${index(id)}`]?.slots) || {};
    node.classList.add('go');
    Places.mark(node, { kind: 'part', part: id });
    // One click focuses the part, and two clicks open it (focusClicks): its diagram, or beside the list its first file there (tie.click).
    const open = () => (tie?.click ? tie.click(id) : App.openPart(id));
    focusClicks(node, { stage: into, graph, slots, into: open });
    Marks.bind(node, slots, (event) => { if (!event.target.closest('.f')) open(); }, thePart.name);
    if (tie) Hover.after(node, () => tie.part(id));
    else if (!carded || Marks.hasWindow(slots)) Hover.attach(title, partWindow(thePart, slots), node);
    else Marks.inputWindow(title, slots, thePart.name);
  }
  const noPart = into.querySelector('b[data-nopart]');
  if (noPart) {
    const box = noPart.closest('g.node');
    Places.mark(box, { kind: 'no-part' });
    // Beside the list it leads to its files there: one click focuses it, two clicks open them (focusClicks).
    graph.nodes[nodeKey(box)] = 'In no part';
    if (tie?.click) focusClicks(box, { stage: into, graph, into: () => tie.click('no-part') });
    if (tie?.click) box.addEventListener('click', (event) => { if (!event.target.closest('.f')) tie.click('no-part'); });
    if (tie) Hover.after(noPart.closest('g.node'), () => tie.part('no-part'));
    else if (!carded) Hover.attach(noPart, filesWindow('In no part', page.checks.filesInNoPart), noPart.closest('g.node'));
  }
  for (const span of into.querySelectorAll('.f[data-file]')) {
    const path = span.dataset.file;
    Places.mark(span, { kind: 'file', file: path });
    span.addEventListener('click', (event) => { event.stopPropagation(); if (tie && !event.metaKey) tie.file(path, 'click'); else App.fileClick(path, event); }); // beside the list: its diff opens there
    if (tie) Hover.after(span, () => tie.file(path));
    else Hover.attach(span, fileWindow(path, fileSlotsOf(path)), span.closest('g.node'));
  }
  for (const more of into.querySelectorAll('.f.more')) {
    const id = more.dataset.more;
    const paths = id === 'no-part' ? page.checks.filesInNoPart : page.parts.find((candidate) => candidate.id === id).files;
    Places.mark(more, { kind: 'more-files', part: id === 'no-part' ? undefined : id });
    if (tie?.more) { // beside the list: a click lists every file of the part in a window, and the list brings the part to its top
      more.classList.add('go');
      more.addEventListener('click', (event) => { event.stopPropagation(); tie.more(id, more.closest('g.node')); });
    }
    if (!tie) Hover.attach(more, filesWindow(id === 'no-part' ? 'In no part' : page.parts.find((candidate) => candidate.id === id).name, paths.slice(3)), more.closest('g.node'));
  }
  if (svg) {
    markEdges(svg, links, (one) => ({ kind: 'edge', edge: [one.link.from, one.link.to], name: one.link.label }));
    wireLinks(svg, links, tie);
  }
  if (part) {
    // The part's diagram, kept whole: its nodes and arrows hold comments, its nodes with code lines still open that code, and its frame drills down again.
    const diagram = page.diagrams.find((candidate) => candidate.id === part.diagrams[0]);
    markDiagram(into, diagram, false);
    paintChange(into, diagram);
    wireCode(into, diagram);
    for (const cluster of into.querySelectorAll(`g.cluster[id$="ap${index(part.id)}"], g.cluster[id="ap${index(part.id)}"]`)) {
      Places.mark(cluster, { kind: 'part', part: part.id });
      const name = cluster.querySelector('.cluster-label, .nodeLabel, text');
      name?.classList.add('go'); // only its name opens the part, so only the name has the hand pointer
      name?.addEventListener('click', () => App.openPart(part.id));
    }
  }
}

/**
 * The diagram of the change in the look (build 60): the parts, the box of the files in no part and the links between parts as things of the look,
 * by their node ids in the text of change-diagram.ts. The fields of a part that a rule shows, and the box in no part folded or left out, are written
 * into the labels; then marks.js adds the shapes, the icons and the words of the links before Mermaid draws, as on Home (lookText).
 * Returns the text, the things by node id and the arrows for decorate; with no look, the text as it is.
 */
async function changeLook(text, links) {
  const page = App.page;
  const { look } = page;
  if (!look) return { text, things: {}, edges: links, filled: {} };
  const things = {};
  for (const thing of Marks.changeThings(page, 'part')) things[`ap${page.parts.findIndex((part) => part.id === thing.id)}`] = thing;
  const [noPart] = Marks.changeThings(page, 'no-part');
  if (noPart) things.apnone = noPart;
  for (const [node, thing] of Object.entries(things)) things[node] = { ...thing, node, marks: thing.marks ?? [], slots: Marks.slotsIn(look, thing) }; // the box in no part has no marks
  const ofLinks = Marks.changeThings(page, 'part-link');
  const edges = links.map((one) => { const thing = ofLinks[page.links.indexOf(one.link)]; return { ...one, marks: [], fields: thing.fields, slots: Marks.slotsIn(look, thing) }; });
  const gone = things.apnone?.slots['show.shown'] === false; // its node, its class and its place in the rows go
  const lines = text.split('\n').filter((line) => !gone || !/\bapnone\b/.test(line)).map((line) => {
    const slots = things[/^\s*(ap\d+|apnone)\[/.exec(line)?.[1]]?.slots;
    const fields = slots?.content?.fields ?? (slots?.['show.folded'] ? ['name'] : null);
    return fields ? withFields(line, fields) : line;
  });
  const shaped = await Marks.lookText({ id: 'change', mermaid: lines.join('\n'), graph: { nodes: {}, edges: links } }, things, edges, look);
  return { ...shaped, things };
}

/** A node of the diagram of the change with the fields of its part in the order of a rule: its name, its files, the counts of its files. */
function withFields(line, fields) {
  return line.replace(/^(\s*\w+\[\(?")(.*)("\)?\])$/, (all, open, label, close) => {
    const end = label.indexOf('</b>') + 4;
    const name = fields.includes('name') ? label.slice(0, end) : label.slice(0, end).replace(/>[^<]*</, '><'); // the title stays, empty: the page finds the part by it
    const files = !fields.includes('files') ? '' : fields.includes('counts') ? label.slice(end) : label.slice(end).replace(/ <i class='[pm]'>[^<]*<\/i>/g, '');
    const filesFirst = fields.includes('files') && fields.indexOf('files') < fields.indexOf('name');
    return `${open}${filesFirst ? files + name : name + files}${close}`;
  });
}

/**
 * The links between parts in the diagram of the change, with their code. A link with a diff has its counts at its text, or at the middle of its line
 * when it has no text. With `tie` (the diffs stand beside it) the pointer on a link with places shows them in the right half, and a click keeps that;
 * else a window shows its places, and a click opens the first. A link with a reason shows the reason in a small window. An open point at a link marks it.
 */
function wireLinks(svg, links, tie) {
  const partName = (id) => App.page.parts.find((part) => part.id === id)?.name ?? id;
  edgeElements(svg, links).forEach(({ path, label: drawn }, at) => {
    const { link } = links[at];
    const label = links[at].label ? drawn : null; // a link with no text has an empty label; a rule of the look can give it words
    const code = link.code;
    if (!path || !code) return;
    if (code.counts) path.countsText = edgeCountsAt(path, label, code.counts);
    const els = [label, path, path.nextElementSibling?.classList.contains('hit') && path.nextElementSibling, path.countsText].filter(Boolean);
    const point = App.page.openPoints?.find((one) => !one.diagram && one.edge?.[0] === link.from && one.edge?.[1] === link.to && (one.name === undefined || one.name === (link.label ?? '')));
    const check = point?.text;
    if (check) markPoint(els, point);
    const name = link.label || `${partName(link.from)} → ${partName(link.to)}`;
    const [first] = code.places;
    for (const el of els) {
      if (first && tie) {
        Hover.after(el, () => tie.link({ key: `link:${at}`, code, check, els }), () => tie.rest());
        el.addEventListener('click', (event) => { event.stopPropagation(); tie.pin({ key: `link:${at}`, code, check, els }); });
        continue;
      }
      Hover.attach(el, placesWindow(name, code, check), els[0]);
      if (!first) continue;
      el.classList.add('go');
      el.addEventListener('click', (event) => { event.stopPropagation(); App.showCode(first.file, first.lines && !first.removed ? first.lines : null); });
    }
  });
}

/**
 * The drawn things of a diagram of a part that have code, as [{ key, name, code, els, point }]: each node, participant and state, and each arrow, message
 * or transition (its label or text first, then its line, the wide line that the pointer finds, and its counts), also a removed one. `code` holds its places
 * or its reason (page data); `point` is what the second agent found at the thing.
 */
function thingsWithCode(into, diagram) {
  const svg = into.querySelector('svg');
  if (!svg || !diagram?.code) return [];
  const label = (id) => diagram.graph.nodes[id] ?? id;
  const found = (fits) => App.page.openPoints?.find((one) => one.diagram === diagram.id && fits(one));
  const point = (fits) => found(fits)?.text;
  const nodeThing = (key, els) => ({ key, name: label(key), code: diagram.code[key], els, point: point((one) => one.node === key), open: found((one) => one.node === key) });
  const nodes = diagram.kind === 'sequence'
    ? [...svg.querySelectorAll('rect.actor[name]')].map((actor) => nodeThing(actor.getAttribute('name'), [actor.parentElement]))
    : [...svg.querySelectorAll('g.node, g.image-shape')].map((g) => nodeThing(nodeKey(g), [g]));
  const edges = drawnEdges(diagram, svg);
  const texts = svg.querySelectorAll('text.messageText');
  const lines = svg.querySelectorAll('.messageLine0, .messageLine1');
  const drawn = diagram.kind === 'sequence' ? edges.map((_, at) => [texts[at], lines[at]])
    : edgeElements(svg, edges).map(({ path, label: text }) => [text, path, path?.nextElementSibling?.classList.contains('hit') && path.nextElementSibling, path?.countsText]);
  return [...nodes, ...edges.map((edge, at) => ({
    key: edge.key, name: edge.label || `${label(edge.from)} → ${label(edge.to)}`, code: diagram.code[edge.key], els: drawn[at].filter(Boolean),
    point: edge.change === 'removed' ? undefined : point((one) => one.edge?.[0] === edge.from && one.edge?.[1] === edge.to && (one.name === undefined || one.name === (edge.label ?? ''))),
    open: edge.change === 'removed' ? undefined : found((one) => one.edge?.[0] === edge.from && one.edge?.[1] === edge.to && (one.name === undefined || one.name === (edge.label ?? ''))),
  }))].filter((thing) => thing.code && thing.els.length);
}

/**
 * Each thing with code shows it. A thing with places: a click opens its first place, and the pointer opens a window with its places.
 * With `join` (the code stands beside the diagram), the pointer on it joins it to its rows there, or shows its places there, and a click keeps that.
 * A thing with a reason shows the reason in a small window, in both forms. An open point at a thing marks it.
 */
function wireCode(into, diagram, join) {
  for (const thing of thingsWithCode(into, diagram)) {
    const { code, els } = thing;
    const [main] = els;
    if (thing.point) markPoint(els, thing.open);
    for (const el of els) {
      if (!code.places.length) { Hover.attach(el, placesWindow(thing.name, code, thing.point), main); continue; }
      const [first] = code.places;
      const tab = () => App.showCode(first.file, first.lines && !first.removed ? first.lines : null); // the file as a tab: Cmd+click, or "Open" in the window
      if (join) {
        Hover.after(el, () => join.show(main), () => join.rest());
        el.addEventListener('click', (event) => { event.stopPropagation(); if (event.metaKey) tab(); else join.pin(main); });
        continue;
      }
      el.classList.add('go');
      const opens = placesWindow(thing.name, code, thing.point);
      el.addEventListener('click', (event) => { event.stopPropagation(); if (event.metaKey) tab(); else Hover.now(main, opens, main, true); });
      Hover.attach(el, opens, main);
    }
    if (code.places.length) join?.step(main, code, els, thing.point, thing.key);
  }
}

/** A small quiet mark at the top right of a thing that the second agent found does not fit its code; a rule of the look on its open point gives its colour and icon, or leaves it out. */
function markPoint(els, point) {
  const slots = point ? Marks.slotsIn(App.page.look, Marks.pointThing(point, App.page)) : {};
  if (slots['show.shown'] === false) return;
  const el = els.find((one) => one.tagName === 'g') ?? els.find((one) => one.tagName === 'text');
  const line = !el && els.find((one) => one.tagName === 'path' && one.getTotalLength); // an arrow with no text: at the middle of its line
  if (line) {
    const middle = line.getPointAtLength(line.getTotalLength() / 2);
    return void line.after(ringAt(middle.x + 12, middle.y, slots));
  }
  if (!el?.getBBox) return;
  // On the corner of the shape itself, not of its label; on a diamond, on its upper right edge.
  const shape = el.tagName === 'g' ? el.querySelector(':scope > :is(rect, polygon, path, circle)') : null;
  const toEl = shape && el.getScreenCTM()?.inverse().multiply(shape.getScreenCTM()); // the shape can have a move of its own
  const [corner, far] = toEl ? (() => { const own = shape.getBBox(); return [new DOMPoint(own.x, own.y).matrixTransform(toEl), new DOMPoint(own.x + own.width, own.y + own.height).matrixTransform(toEl)]; })() : [];
  const box = corner ? { x: corner.x, y: corner.y, width: far.x - corner.x, height: far.y - corner.y } : el.getBBox();
  const [x, y] = shape?.tagName === 'polygon' ? [box.x + box.width * 0.75, box.y + box.height * 0.25]
    : el.tagName === 'g' ? [box.x + box.width, box.y] : [box.x + box.width + 12, box.y + box.height / 2];
  if (el.tagName === 'g') el.append(ringAt(x, y, slots));
  else el.after(ringAt(x, y, slots));
}

/** The quiet ring with "?" of an open point, at a place of the drawing; the colour and the icon of a rule of the look ("text") in place of its own. */
function ringAt(x, y, slots = {}) {
  const ring = document.createElementNS(SVG_NS, 'g');
  ring.setAttribute('class', 'opt');
  const icon = App.page?.look?.files[slots['text.icon']];
  ring.innerHTML = `<circle cx="${x}" cy="${y}" r="7"/>${icon ? `<image href="${esc(icon)}" x="${x - 5}" y="${y - 5}" width="10" height="10"/>` : `<text x="${x}" y="${y}">?</text>`}`;
  if (slots['text.color']) Marks.paint(ring, 'words', Marks.lineColors(slots['text.color'], Marks.READS));
  return ring;
}

/**
 * Beside the title of a diagram of a part: what the change did to it, the changed lines in no node and no arrow, whether a second agent read it,
 * and where it stands in the repo (repoHtml).
 */
const diagramFactsHtml = (diagram) => (diagram && !diagram.broad
  ? `${changeWordsHtml(diagram)}${diagram.inNoThingWords ? `<span class="dfact nothing">${esc(diagram.inNoThingWords)}</span>` : ''}<span class="dfact">${diagram.checked ? 'checked' : 'not checked yet'}</span>${repoHtml(diagram)}`
  : changeWordsHtml(diagram));

/**
 * Where a diagram of the change stands in the repo: code that is all new says so; a diagram that draws on a repo diagram has the quiet link "on Home",
 * which shows that diagram without the change, and one quiet line when the map was written again since the change was described.
 */
function repoHtml(diagram) {
  if (diagram.new) return '<span class="drepo">New in this change</span>';
  const repo = App.page.onHome?.[diagram.id];
  return (repo?.id ? `<a class="home-link" data-home="${esc(repo.id)}" data-title="${esc(repo.title)}">on Home</a>` : '')
    + (repo?.again ? '<span class="drepo">The map was written again since this change was described.</span>' : '');
}

/**
 * Draws a diagram of a part in the look of its steps (build 60): a colour, or a picture in place of a step, by the same code as a node on Home
 * (marks.js); and on a flow chart the marks inside the lines of each step at its corners (build 63). Returns the SVG.
 */
async function drawInLook(into, diagram) {
  const { look } = App.page;
  const things = look ? Object.fromEntries(Object.entries(Marks.stepThings(diagram, look.marks)).map(([key, thing]) => [key, { ...thing, slots: Marks.slotsIn(look, thing) }])) : {};
  const shaped = look && !diagram.schema ? await Marks.lookText({ ...diagram, mermaid: diagram.draw }, things, [], look) : { text: diagram.draw, filled: {} };
  const svg = await drawMermaid(into, shaped.text, shaped.text === diagram.draw ? diagram.plain : diagram.draw, diagram.schema, diagram.id);
  if (look && svg && !svg.hasAttribute('data-plain') && Marks.decorate(svg, things, [], look, shaped.filled, { nodeKey, open: openMark, pick: pickPlace })) fitToContent(svg);
  return svg;
}

/** The diagram of one part or function: a flow, a sequence, the states or a schema, with what the change did to it. `join` as in wireCode, `stack` as in makeSurface. */
async function drawPart(into, diagram, join, stack = false) {
  await drawInLook(into, diagram);
  markDiagram(into, diagram);
  paintChange(into, diagram);
  wireCode(into, diagram, join);
  makeSurface(into, false, stack, `part:${diagram.id}`);
}

/** A diagram of a part drawn small and read only, for a card of the overview (build 83): in the look, with what the change did to it, filling its card. */
async function drawSmall(into, diagram) {
  const svg = await drawInLook(into, diagram);
  paintChange(into, diagram);
  svg?.removeAttribute('width');
  svg?.removeAttribute('height');
}

/**
 * The page of the change: one card with the diagram of the change. Its title row shows the total diff, and whether its links were checked;
 * one quiet line under it names the wider diagrams, each a link to it: "alters:" those that the change alters, "wider:" the others.
 */
async function drawSections(into, fromPart, tie) {
  const page = App.page;
  const added = page.files.reduce((sum, file) => sum + file.added, 0);
  const removed = page.files.reduce((sum, file) => sum + file.removed, 0);
  const link = (diagram) => `<a data-go='${esc(JSON.stringify({ level: 'broad', diagram: diagram.id }))}'>${esc(diagram.title)}</a>`;
  const broad = page.diagrams.filter((diagram) => diagram.broad);
  const alters = broad.filter((diagram) => page.altered.includes(diagram.id)).map((diagram) => `${link(diagram)} ${partsHtml(diagram.difference)}`);
  const others = broad.filter((diagram) => !page.altered.includes(diagram.id)).map(link);
  const wider = [alters.length ? `alters: ${alters.join(' · ')}` : '', others.length ? `wider: ${others.join(' · ')}` : ''].filter(Boolean).join(' · ');
  // Whether a second agent read the links between the parts against their code.
  const checked = page.links.length ? `<span class="dfact">${page.linksChecked ? 'checked' : 'not checked yet'}</span>` : '';
  // The look of the card: the facts and lines that a rule names, in its order, and its colour. The counts stay those of the whole change.
  const slots = Marks.slotsIn(page.look, Marks.changeThings(page, 'change-card')[0]);
  const fields = slots.content?.fields;
  const total = !fields ? `${plural(page.files.length, 'file')} ${countsHtml({ added, removed })}`
    : fields.map((field) => ({ files: plural(page.files.length, 'file'), added: countsHtml({ added }), removed: countsHtml({ removed }) })[field]).filter(Boolean).join(' ');
  const row = { title: `<b>${esc(page.title)}</b>`, total: total && `<span class="total">${total}</span>`, checked };
  const order = !fields ? ['title', 'total', 'checked'] : [...new Set(fields.map((field) => (['files', 'added', 'removed'].includes(field) ? 'total' : field)))];
  into.innerHTML = `<section class="sec" data-section="change"><div class="sh" ${Places.attrs({ kind: 'diagram' })}>${order.map((field) => row[field] ?? '').join('')}</div>`
    + (wider && (!fields || fields.includes('wider')) ? `<div class="alters">${wider}</div>` : '') + '<div class="sb"></div></section>';
  Marks.paintBox(into.firstChild, slots);
  const body = into.querySelector('.sb');
  await drawChange(body, fromPart, tie);
  // The overview (build 83): under the card, a card for each part and for the files in no part, unless he chose the diagram alone.
  const items = changeCards(body);
  const overview = items.length > 0 && !Overview.isFull();
  makeSurface(body, false, false, `change:${fromPart ?? ''}`, overview);
  if (items.length) Overview.icon(body, !overview, () => App.render());
  // The cards stand under the view; beside the code they stand in the half of the diagram, under its card, and the half scrolls.
  const cards = into.id === 'view' ? document.getElementById('cards') : into.appendChild(html('<div class="ovcards" hidden></div>'));
  Overview.cards(cards, overview ? items : []);
}

/**
 * The cards of the overview of a change, in the reading order of its drawing: a part with its first diagram drawn small (a click opens it), or with
 * its files and their counts (a click on one opens its file tab); and the files in no part.
 */
function changeCards(body) {
  const page = App.page;
  const fileOf = (path) => ({ path, counts: page.files.find((file) => file.path === path) ?? {} });
  const nodes = [...body.querySelectorAll('b[data-part], b[data-nopart]')].map((title) => title.closest('g.node')).filter(Boolean);
  return Overview.inReadingOrder(nodes).map((g) => {
    const id = g.querySelector('b[data-part]')?.dataset.part;
    if (!id) return { title: 'In no part', files: page.checks.filesInNoPart.map(fileOf), node: nodeKey(g) };
    const part = page.parts.find((one) => one.id === id);
    const [diagram] = partDiagrams(part);
    return diagram ? { title: part.name, open: () => App.openPart(id), draw: (box) => drawSmall(box, diagram), shape: { ...drawingShape(diagram.graph, diagram.draw, diagram.schema), key: diagram.id }, node: nodeKey(g) }
      : { title: part.name, files: part.files.map(fileOf), node: nodeKey(g) };
  });
}

/** "+2 parts −1 part" for the difference of a wider diagram, as HTML. */
const partsHtml = (difference) => (difference
  ? [difference.added ? `<i class="p">+${plural(difference.added, 'part')}</i>` : '', difference.removed ? `<i class="m">−${plural(difference.removed, 'part')}</i>` : ''].filter(Boolean).join(' ')
  : '');

/** A wider diagram, large, with the difference painted in. A lit node drills down to the change. */
async function drawBroad(into, diagram) {
  await drawMermaid(into, diagram.draw, undefined, diagram.schema, diagram.id);
  markDiagram(into, diagram);
  makeSurface(into, true, false, `broad:${diagram.id}`);
  for (const g of into.querySelectorAll('g.node.lit')) {
    g.classList.add('go');
    g.addEventListener('click', () => App.go({ level: 'change' }));
    // The arrows to a new node are lit with it; a flow chart names a path "L_<from>_<to>_<n>".
    for (const path of into.querySelectorAll('path.flowchart-link')) if (path.id.endsWith(`_${nodeKey(g)}_${/\d+$/.exec(path.id)}`)) path.classList.add('lit');
  }
}
