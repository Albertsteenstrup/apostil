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

/**
 * Makes a drawn diagram a surface that he moves: a drag moves it, the wheel and a pinch zoom at the pointer,
 * and a double click on an empty place fits it whole to its card. The card takes the height that is left in the tab.
 * With `readable` (a map, a wider diagram), a diagram so wide that fitting it would make the words small opens at a size where they read, at the start of its flow.
 * With `stack` (one of several diagrams one under the other in a half that scrolls), the card takes the height of the diagram fit to its width, or at the size
 * where its words read, and at most most of the half; the wheel scrolls the half, and only a pinch zooms.
 */
function makeSurface(stage, readable = false, stack = false) {
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
  if (stack) stackHeight();
  else keepFilled(stage);
  let view = { x: x0, y: y0, scale: 1 };
  let moved = false; // he moved or zoomed it, so a new size of the card keeps his view
  const apply = () => {
    const [w, h] = [stage.clientWidth, stage.clientHeight];
    if (w && h) svg.setAttribute('viewBox', `${view.x} ${view.y} ${w / view.scale} ${h / view.scale}`);
  };
  // In a half of the page a diagram too large for it, wide or tall, opens readable at its start too.
  const half = !!stage.closest('.split');
  const fit = (whole = false) => {
    const [w, h] = [stage.clientWidth, stage.clientHeight];
    if (!w || !h) return;
    let scale = Math.min(1, w / width, h / height);
    const wide = (readable || half) && (half || w / width < h / height) && scale < READABLE;
    if (wide && !whole) scale = READABLE;
    const middle = { x: x0 - (w / scale - width) / 2, y: y0 - (h / scale - height) / 2 };
    // The start of a wide flow: its left end when it goes from left to right, else its top in the middle.
    const across = stage.classList.contains('across');
    // In a half, a diagram wider than the half starts at its left end too.
    const fromLeft = across || (half && w / scale < width);
    view = wide && !whole ? { scale, x: fromLeft ? x0 : middle.x, y: across || h / scale >= height ? middle.y : y0 } : { scale, ...middle };
    moved = false;
    apply();
  };
  const zoomAt = (px, py, factor) => {
    const scale = Math.min(4, Math.max(0.1, view.scale * factor));
    view = { scale, x: view.x + px / view.scale - px / scale, y: view.y + py / view.scale - py / scale };
    moved = true;
    apply();
  };
  stage.addEventListener('wheel', (event) => {
    if (stack && !event.ctrlKey) return;
    event.preventDefault();
    Hover.hide(); // no hover window opens over the diagram while he zooms
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
  stage.surface = { fit, show, reframe };
  fit();
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

// ----- the things of a drawing that a comment can be stuck on -----

/**
 * The drawn arrow and label of each edge of the graph, as [{ path, label }] in the order of `edges`. A flow chart names its paths
 * "L_<from>_<to>_<n>", a state diagram "edge<n>"; n counts the edges in the order of the text. A label that does not fit is left out.
 */
function edgeElements(svg, edges) {
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
      found[at] = { path, label: label && label.textContent.trim() === (edges[at].label ?? '').trim() ? label : null };
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

function fileWindow(path) {
  return async () => {
    const file = App.page.files.find((candidate) => candidate.path === path);
    const folder = folderOf(path);
    const frame = {
      title: baseName(path), width: 640, open: () => App.openFile(path),
      sub: `${countsHtml(file)}${file?.renamedFrom ? ` · renamed from ${esc(file.renamedFrom)}` : ''}${folder ? ` · <a data-folder="${esc(folder)}">${esc(folder)}</a>` : ''}`,
    };
    if (file?.what) return { ...frame, body: await factHtml(file) };
    const lines = (await ask(`diff:${path}`)) ?? [];
    if (!lines.length) return { ...frame, body: '<div class="quiet" style="padding:4px 12px">No changed lines.</div>' };
    // The scroll bar has the size of the whole diff at once; long lines wrap.
    return { ...frame, body: `<div data-file="${esc(path)}"></div>`, ready: (body) => codeWithNotes(body.firstChild, { rows: diffRows(lines, file?.cells), scroller: body, path }) };
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
function placesWindow(name, code, check) {
  return async () => {
    const [first] = code.places;
    if (!first) return { title: name, width: 320, pad: true, body: `<div class="why">${esc(code.why ?? '')}</div>${check ? `<div class="pck">Check: ${esc(check)}</div>` : ''}` };
    const sub = code.places.length > 1 ? plural(code.places.length, 'place') : `${esc(baseName(first.file))} · ${esc(placeText(first))}`;
    return {
      title: name, sub, width: 600, body: '<div class="places"></div>', open: () => App.showCode(first.file, first.lines && !first.removed ? first.lines : null),
      ready: (body) => drawPlaces(body.firstChild, code, body, check),
    };
  };
}

/** A part shows its next diagram down, or else its full list of files. */
function partWindow(part) {
  const diagram = App.page.diagrams.find((candidate) => candidate.id === part.diagrams[0]);
  if (!diagram) return filesWindow(part.name, part.files);
  return () => ({
    title: part.name, sub: `${esc(diagram.title)} ${changeWordsHtml(diagram)}`, width: 440, pad: true, body: '<div></div>',
    ready: async (body) => { await drawMermaid(body.firstChild, diagram.draw, diagram.plain, diagram.schema, diagram.id); markDiagram(body.firstChild, diagram); paintChange(body.firstChild, diagram); },
    open: () => App.go({ level: 'part', part: part.id }),
  });
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
  await drawMermaid(into, part?.drillUp ?? page.changeDiagram, part?.drillUpPlain);
  const svg = into.querySelector('svg');
  if (svg) Places.mark(svg, { kind: 'diagram' });
  for (const title of into.querySelectorAll('b[data-part]')) {
    const node = title.closest('g.node');
    const id = title.dataset.part;
    const thePart = page.parts.find((candidate) => candidate.id === id);
    node.classList.add('go');
    Places.mark(node, { kind: 'part', part: id });
    node.addEventListener('click', (event) => { if (!event.target.closest('.f')) tie?.click ? tie.click(id) : App.openPart(id); });
    if (tie) Hover.after(node, () => tie.part(id));
    else Hover.attach(title, partWindow(thePart), node);
  }
  const noPart = into.querySelector('b[data-nopart]');
  if (noPart) {
    Places.mark(noPart.closest('g.node'), { kind: 'no-part' });
    if (tie?.click) noPart.closest('g.node').addEventListener('click', () => tie.click('no-part'));
    if (tie) Hover.after(noPart.closest('g.node'), () => tie.part('no-part'));
    else Hover.attach(noPart, filesWindow('In no part', page.checks.filesInNoPart), noPart.closest('g.node'));
  }
  for (const span of into.querySelectorAll('.f[data-file]')) {
    const path = span.dataset.file;
    Places.mark(span, { kind: 'file', file: path });
    span.addEventListener('click', (event) => { event.stopPropagation(); App.fileClick(path, event); });
    if (tie) Hover.after(span, () => tie.file(path));
    else Hover.attach(span, fileWindow(path), span.closest('g.node'));
  }
  for (const more of into.querySelectorAll('.f.more')) {
    const id = more.dataset.more;
    const paths = id === 'no-part' ? page.checks.filesInNoPart : page.parts.find((candidate) => candidate.id === id).files;
    Places.mark(more, { kind: 'more-files', part: id === 'no-part' ? undefined : id });
    if (!tie) Hover.attach(more, filesWindow(id === 'no-part' ? 'In no part' : page.parts.find((candidate) => candidate.id === id).name, paths.slice(3)), more.closest('g.node'));
  }
  // The links between parts, with the node ids that the Mermaid text of the change gives the parts.
  const index = (id) => page.parts.findIndex((candidate) => candidate.id === id);
  const links = page.links.filter((link) => index(link.from) >= 0 && index(link.to) >= 0)
    .map((link) => ({ from: `ap${index(link.from)}`, to: `ap${index(link.to)}`, label: link.label, link }));
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
 * The links between parts in the diagram of the change, with their code. A link with a diff has its counts at its text, or at the middle of its line
 * when it has no text. With `tie` (the diffs stand beside it) the pointer on a link with places shows them in the right half, and a click keeps that;
 * else a window shows its places, and a click opens the first. A link with a reason shows the reason in a small window. An open point at a link marks it.
 */
function wireLinks(svg, links, tie) {
  const partName = (id) => App.page.parts.find((part) => part.id === id)?.name ?? id;
  edgeElements(svg, links).forEach(({ path, label: drawn }, at) => {
    const { link } = links[at];
    const label = link.label ? drawn : null; // a link with no text has an empty label
    const code = link.code;
    if (!path || !code) return;
    if (code.counts) path.countsText = edgeCountsAt(path, label, code.counts);
    const els = [label, path, path.nextElementSibling?.classList.contains('hit') && path.nextElementSibling, path.countsText].filter(Boolean);
    const check = App.page.openPoints?.find((one) => !one.diagram && one.edge?.[0] === link.from && one.edge?.[1] === link.to && (one.name === undefined || one.name === (link.label ?? '')))?.text;
    if (check) markPoint(els);
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
  const point = (fits) => App.page.openPoints?.find((one) => one.diagram === diagram.id && fits(one))?.text;
  const nodeThing = (key, els) => ({ key, name: label(key), code: diagram.code[key], els, point: point((one) => one.node === key) });
  const nodes = diagram.kind === 'sequence'
    ? [...svg.querySelectorAll('rect.actor[name]')].map((actor) => nodeThing(actor.getAttribute('name'), [actor.parentElement]))
    : [...svg.querySelectorAll('g.node')].map((g) => nodeThing(nodeKey(g), [g]));
  const edges = drawnEdges(diagram, svg);
  const texts = svg.querySelectorAll('text.messageText');
  const lines = svg.querySelectorAll('.messageLine0, .messageLine1');
  const drawn = diagram.kind === 'sequence' ? edges.map((_, at) => [texts[at], lines[at]])
    : edgeElements(svg, edges).map(({ path, label: text }) => [text, path, path?.nextElementSibling?.classList.contains('hit') && path.nextElementSibling, path?.countsText]);
  return [...nodes, ...edges.map((edge, at) => ({
    key: edge.key, name: edge.label || `${label(edge.from)} → ${label(edge.to)}`, code: diagram.code[edge.key], els: drawn[at].filter(Boolean),
    point: edge.change === 'removed' ? undefined : point((one) => one.edge?.[0] === edge.from && one.edge?.[1] === edge.to && (one.name === undefined || one.name === (edge.label ?? ''))),
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
    if (thing.point) markPoint(els);
    for (const el of els) {
      if (!code.places.length) { Hover.attach(el, placesWindow(thing.name, code, thing.point), main); continue; }
      if (join) {
        Hover.after(el, () => join.show(main), () => join.rest());
        el.addEventListener('click', (event) => { event.stopPropagation(); join.pin(main); });
        continue;
      }
      const [first] = code.places;
      el.classList.add('go');
      el.addEventListener('click', (event) => { event.stopPropagation(); App.showCode(first.file, first.lines && !first.removed ? first.lines : null); });
      Hover.attach(el, placesWindow(thing.name, code, thing.point), main);
    }
    if (code.places.length) join?.step(main, code, els, thing.point, thing.key);
  }
}

/** A small quiet mark at the top right of a thing that the second agent found does not fit its code. */
function markPoint(els) {
  const el = els.find((one) => one.tagName === 'g') ?? els.find((one) => one.tagName === 'text');
  const line = !el && els.find((one) => one.tagName === 'path' && one.getTotalLength); // an arrow with no text: at the middle of its line
  if (line) {
    const middle = line.getPointAtLength(line.getTotalLength() / 2);
    return void line.after(ringAt(middle.x + 12, middle.y));
  }
  if (!el?.getBBox) return;
  // On the corner of the shape itself, not of its label; on a diamond, on its upper right edge.
  const shape = el.tagName === 'g' ? el.querySelector(':scope > :is(rect, polygon, path, circle)') : null;
  const toEl = shape && el.getScreenCTM()?.inverse().multiply(shape.getScreenCTM()); // the shape can have a move of its own
  const [corner, far] = toEl ? (() => { const own = shape.getBBox(); return [new DOMPoint(own.x, own.y).matrixTransform(toEl), new DOMPoint(own.x + own.width, own.y + own.height).matrixTransform(toEl)]; })() : [];
  const box = corner ? { x: corner.x, y: corner.y, width: far.x - corner.x, height: far.y - corner.y } : el.getBBox();
  const [x, y] = shape?.tagName === 'polygon' ? [box.x + box.width * 0.75, box.y + box.height * 0.25]
    : el.tagName === 'g' ? [box.x + box.width, box.y] : [box.x + box.width + 12, box.y + box.height / 2];
  if (el.tagName === 'g') el.append(ringAt(x, y));
  else el.after(ringAt(x, y));
}

/** The quiet ring with "?" of an open point, at a place of the drawing. */
function ringAt(x, y) {
  const ring = document.createElementNS(SVG_NS, 'g');
  ring.setAttribute('class', 'opt');
  ring.innerHTML = `<circle cx="${x}" cy="${y}" r="7"/><text x="${x}" y="${y}">?</text>`;
  return ring;
}

/** Beside the title of a diagram of a part: what the change did to it, the changed lines in no node and no arrow, and whether a second agent read it. */
const diagramFactsHtml = (diagram) => (diagram && !diagram.broad
  ? `${changeWordsHtml(diagram)}${diagram.inNoThingWords ? `<span class="dfact nothing">${esc(diagram.inNoThingWords)}</span>` : ''}<span class="dfact">${diagram.checked ? 'checked' : 'not checked yet'}</span>`
  : changeWordsHtml(diagram));

/** The diagram of one part or function: a flow, a sequence, the states or a schema, with what the change did to it. `join` as in wireCode, `stack` as in makeSurface. */
async function drawPart(into, diagram, join, stack = false) {
  await drawMermaid(into, diagram.draw, diagram.plain, diagram.schema, diagram.id);
  markDiagram(into, diagram);
  paintChange(into, diagram);
  wireCode(into, diagram, join);
  makeSurface(into, false, stack);
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
  into.innerHTML = `<section class="sec" data-section="change"><div class="sh" ${Places.attrs({ kind: 'diagram' })}><b>${esc(page.title)}</b>`
    + `<span class="total">${plural(page.files.length, 'file')} ${countsHtml({ added, removed })}</span>${checked}</div>`
    + (wider ? `<div class="alters">${wider}</div>` : '') + '<div class="sb"></div></section>';
  const body = into.querySelector('.sb');
  await drawChange(body, fromPart, tie);
  makeSurface(body);
}

/** "+2 parts −1 part" for the difference of a wider diagram, as HTML. */
const partsHtml = (difference) => (difference
  ? [difference.added ? `<i class="p">+${plural(difference.added, 'part')}</i>` : '', difference.removed ? `<i class="m">−${plural(difference.removed, 'part')}</i>` : ''].filter(Boolean).join(' ')
  : '');

/** A wider diagram, large, with the difference painted in. A lit node drills down to the change. */
async function drawBroad(into, diagram) {
  await drawMermaid(into, diagram.draw, undefined, diagram.schema, diagram.id);
  markDiagram(into, diagram);
  makeSurface(into, true);
  for (const g of into.querySelectorAll('g.node.lit')) {
    g.classList.add('go');
    g.addEventListener('click', () => App.go({ level: 'change' }));
    // The arrows to a new node are lit with it; a flow chart names a path "L_<from>_<to>_<n>".
    for (const path of into.querySelectorAll('path.flowchart-link')) if (path.id.endsWith(`_${nodeKey(g)}_${/\d+$/.exec(path.id)}`)) path.classList.add('lit');
  }
}
