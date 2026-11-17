// Home: the map of the repo as one large diagram that he moves and zooms, one level at a time.
// The graphs page: one small panel for each diagram that a folder or file is a part of, drawn when it comes into view.
// A page of the look (build 58): the blocks of one page of the look of the repo, in a tab of its own.
'use strict';

const Home = {
  data: null, // a HomeData or a GraphsData from home-data.ts, or a CustomPageData from look-blocks.ts
  at: null, // the id of the map diagram that Home shows
  lit: [], // the nodes to light on it
  filter: null, // after a click on a mark: the quiet line "<value> · n places in <node>", and the nodes that hold the value are lit

  // Draws one at a time; a hidden tab has no size and Mermaid would draw empty boxes, so the drawing waits until it shows.
  render() {
    this.waiting = !document.body.clientWidth || document.hidden;
    if (this.waiting) return this.drawing ?? Promise.resolve();
    Marks.setPages(this.data?.look?.pages); // the titles of the pages of the look, for the words of a target "page"
    const draw = { graphs: drawGraphs, page: drawPage }[this.data?.kind] ?? drawHome;
    this.drawing = (this.drawing ?? Promise.resolve()).then(() => draw()).catch((error) => console.error(error));
    return this.drawing;
  },

  /** One level down or up on Home: a diagram of the map, with nodes lit, and the line of a mark that lit them. */
  goTo(diagram, lit = [], filter = null) {
    Hover.hide();
    Object.assign(this, { at: diagram, lit, filter });
    this.render();
  },
};

const diagramOf = (id) => Home.data.map.diagrams.find((diagram) => diagram.id === id);

// ----- focus on a node (build 64) -----

let focus = null; // { stage, graph, node, diagram }: the drawing with its graph, the node that the focus is on, and on Home the diagram

/**
 * Focuses a node of a drawing, with its arrows and the nodes at their other ends (focusNode); the same node again, or no node, ends the focus.
 * One quiet line names the node, with a × that ends it.
 */
function focusOn(stage, graph, node, diagram) {
  const again = focus?.stage === stage && focus.node === node;
  if (focus) focusNode(focus.stage, focus.graph, null);
  const name = node && !again ? focusNode(stage, graph, node) : null;
  focus = name ? { stage, graph, node, diagram } : null;
  const summary = document.getElementById('summary');
  summary.querySelector('.fc')?.remove();
  if (name) summary.insertAdjacentHTML('beforeend', `<span class="mk-filter fc">${summary.textContent.trim() ? ' · ' : ''}Focus: ${esc(name)} · <a data-end-focus title="End the focus (Escape)">×</a></span>`);
}

/** Option+click on a node of a drawing focuses it; the look wins when it gives that click a target (`lookAlt`). True when the click was taken. */
function focusClick(event, stage, graph, lookAlt, diagram) {
  const g = event.altKey && !lookAlt ? event.target.closest('g.node, g.image-shape') : null;
  if (!g || !stage.contains(g)) return false;
  event.stopImmediatePropagation(); // not also the click of the node, or of the panel that holds it
  event.preventDefault();
  Hover.hide();
  focusOn(stage, graph, nodeKey(g), diagram);
  return true;
}

// Escape ends the focus, when no window is open and no comment is being placed (Escape closes those first), and not in a text field.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !focus || document.querySelector('.win') || document.body.classList.contains('picking') || event.target.closest?.('[data-field], textarea, input, [contenteditable]')) return;
  focusOn(null);
}, true);

// ----- the steps of the path: a diagram of the map, the graphs of a path, a change -----

/** The step of a diagram of the map: the top map is Home. With the line of a mark, the step names the value too. */
const mapStep = (id, lit = [], filter = null) => {
  const step = id === Home.data.map?.top ? { ...Trail.HOME, lit } : { tab: 'home', diagram: id, lit, name: diagramOf(id).title };
  return filter ? { ...step, filter, name: `${step.name} · ${filter.value}` } : step;
};
const graphsStep = (path) => ({ tab: 'graphs', path, name: path });
const pageStep = (data) => ({ tab: 'page', page: data.id, name: data.title });

/** The view that this tab shows now, as a step of the path. */
const ownStep = () => (Home.data.kind === 'graphs' ? graphsStep(Home.data.path) : Home.data.kind === 'page' ? pageStep(Home.data)
  : Home.data.map ? mapStep(Home.at, Home.lit, Home.filter) : Trail.HOME);

/** He goes from here to another view: one level down on Home, or the graphs of a path, a change or a diagram in another tab. */
function walkTo(step) {
  Hover.hide();
  const here = step.tab === 'home' && Home.data.kind === 'home';
  Trail.take(step, !here);
  if (here) Home.goTo(step.diagram || null, step.lit, step.filter);
}

// A step back along the path that this tab shows by itself: a diagram of the map, when this tab is Home.
Trail.here((step) => step.tab === 'home' && Home.data?.kind === 'home' && (Home.goTo(step.diagram || null, step.lit ?? [], step.filter), true));

// ----- comments on the map -----
// The comments window (remarks.js) and the things that hold a comment (places.js) read `App`, as on the change page.
// On Home it holds the map in the shape of a change page; the small panels of the graphs page hold no comment.

const Code = { shown: null }; // Home has no code view
const App = {
  page: null, // while Home shows a map: its diagrams and the comments on it
  tab: null,
  state: { view: 'diagram' },
  get drawing() { return Home.drawing; },
  render: () => Home.render(),
  go: (view) => walkTo(mapStep(diagramOf(view.diagram) ? view.diagram : Home.data.map.top)), // a click on a card: the diagram of its thing (gone: the top map), as a step
};

/** The map as the comments read it: every diagram is one of the map; there are no parts, files or notes. */
const mapPage = (data) => (data.kind === 'home' && data.map
  ? { map: true, title: data.repo, diagrams: data.map.diagrams, remarks: data.remarks, apps: data.apps, parts: [], files: [], notes: [], links: [], openPoints: [], checks: { filesInNoPart: [] }, look: data.look }
  : null);

// ----- Home -----

/**
 * The window of a node, from its sections: the folders and files it stands for with their counts ("files"), the changes that touch it ("changes"), and
 * the marks of a set that stands in no corner of the node ("marks": a rule put something else there), each value with its count of places. A rule of the
 * look orders the sections and leaves some out. A folder opens in the tree "Files" of the side bar; a file opens in VS Code.
 */
function nodeWindow(g, node, thing) {
  return () => {
    const paths = node.paths.map(({ path, files }) => (path.endsWith('/')
      ? `<a data-tree="${esc(path)}"><span>${esc(path)}</span><i class="c">${plural(files, 'file')}</i></a>`
      : `<a data-open="${esc(path)}"><span>${esc(path)}</span><i class="c"></i></a>`)).join('');
    const changes = node.changes.map((change) => `<a data-change-id="${change.id}" data-title="${esc(change.title)}"><span>${esc(change.branch)}</span><i class="c">${esc(change.title)}</i></a>`).join('');
    const look = Home.data.look;
    const hidden = thing ? look.sets.filter((set) => !thing.cornered?.has(set.id)).map((set) => [set, Marks.stackOf(thing.marks, set.id)]).filter(([, stack]) => stack.length) : [];
    const marks = hidden.map(([set, stack]) => `<div class="gp">${esc(set.name)}</div>${stack.map((one) => `<a data-mk-node="${esc(one.key)}"><span>${esc(look.values[one.key]?.name ?? one.value)}</span><i class="c">${plural(one.marks.length, 'place')}</i></a>`).join('')}`).join('');
    return Marks.windowOf({
      title: Marks.nameOf(g), width: 520,
      sub: `${plural(node.files, 'file')}${node.changes.length ? ` · ${plural(node.changes.length, 'change')}` : ''}`,
      sections: [
        { id: 'files', html: `<div class="gp">Folders and files</div>${paths}` },
        { id: 'changes', html: changes && `<div class="gp">Changes</div>${changes}` },
        { id: 'marks', html: marks },
      ],
      wrap: (inner) => `<div class="rows">${inner}</div>`,
      ready: (body) => body.addEventListener('click', (event) => {
        const row = event.target.closest('[data-mk-node]');
        const one = row && hidden.flatMap(([, stack]) => stack).find((each) => each.key === row.dataset.mkNode);
        if (one && !pickMark(thing, one)) body.innerHTML = Marks.placesHtml(one.marks);
        const place = event.target.closest('[data-mk-open]');
        if (place) { Hover.hide(); openAt(place.dataset.mkOpen, Number(place.dataset.mkLine)); }
      }),
    }, thing?.slots);
  };
}

/**
 * The window of a step, a process or a call out of the repo of a drawn process, from its sections: its note or its summary ("note"), where it is ("where",
 * in the quiet line of the title), and the look of a note with its marks ("marks"). A rule of the look orders the sections and leaves some out.
 */
function noteWindow(node, thing) {
  return () => {
    const look = Home.data.look;
    const content = Marks.windowOf({
      title: node.note.title, width: 460,
      sections: [
        { id: 'note', html: node.note.text ? `<p class="stepnote">${esc(node.note.text)}</p>` : '' },
        { id: 'where', sub: esc(node.note.where) },
        { id: 'marks', html: '<div class="mk-lines"></div>' },
      ],
      wrap: (inner) => `<div class="mk-note">${inner}</div>`,
    }, thing?.slots);
    const marks = content.ids.includes('marks');
    // A section of its own can stand between sections of today: the look of the note goes to the part that holds the marks.
    const note = (body) => body.querySelector('.mk-note:has(> .mk-lines)') ?? body.querySelector('.mk-note');
    return { ...content, ready: async (body) => { await content.ready(body); if (look && thing) await Marks.decorateNote(note(body), look, { ...thing, kind: 'note', marks: marks ? thing.marks : [] }, openAt); } };
  };
}

// ----- the marks and the look on Home -----

/** Opens a file of the repo at a line, as a step of a process does. */
const openAt = (path, line) => tell({ type: 'openFile', path, line });

// What Home does itself for a target of the look (Marks.act): a diagram of the map goes one level in this tab, the graphs of a path open as a step;
// a prompt names the diagram that Home shows.
// On a page of the look or the graphs page every step opens in its own tab.
Marks.useHere({
  walk: (step) => {
    const onHome = step.tab === 'home' && Home.data.kind === 'home';
    if (onHome && !diagramOf(step.diagram)) return true; // a diagram that the map no longer has: nothing opens
    walkTo(onHome ? mapStep(step.diagram, step.lit) : step);
    return true;
  },
  diagram: () => Home.at,
});

/**
 * The frame of the diagram on Home in the look (a rule of "frame"): its background, its line and its width, a key while the pointer is on it, and a
 * double click on an empty place, which goes to its target in place of the fit.
 */
let frameDouble = null;
function frameLook(view, look, diagram) {
  const slots = look ? Marks.resolve(look.rules, { kind: 'frame', diagram, fields: {} }, look.one) : {};
  view.removeAttribute('data-lk-keys'); // the key of an earlier drawing
  view.removeAttribute('tabindex');
  frameDouble = slots['input.double'] ?? null;
  Marks.paintBox(view, slots);
  if (slots['input.key']) Marks.bind(view, { 'input.key': slots['input.key'] }, null);
}
// Before the double click of diagram-stage.js, which would fit the diagram.
document.getElementById('view').addEventListener('dblclick', (event) => {
  if (!frameDouble || event.target.closest(ON_A_THING)) return;
  event.stopImmediatePropagation();
  Marks.act(frameDouble, event.currentTarget.querySelector('svg') ?? event.currentTarget);
}, true);

/**
 * A click on a value of a mark on a node. When the node has a level under it, Home goes down with the nodes that hold the value lit and a quiet line;
 * else one place opens at once. Returns false when the value has several places and no level under the node: its window lists them.
 */
function pickMark(thing, one) {
  const node = diagramOf(thing.diagram).nodes[thing.node];
  const look = Home.data.look;
  const name = look.values[one.key]?.name ?? one.value;
  const below = node.down && diagramOf(node.down);
  if (below) {
    const lit = Object.entries(Marks.thingsOf(below, look)).filter(([, other]) => other.marks.some((mark) => Marks.keyOf(mark) === one.key)).map(([key]) => key);
    const nodeName = diagramOf(thing.diagram).graph.nodes[thing.node] ?? thing.node;
    walkTo(mapStep(node.down, lit, { value: name, text: `${name} · ${plural(one.marks.length, 'place')} in ${nodeName.replace(/<[^>]+>/g, ' ').replace(/\s+\d+ steps?$/, '').trim()}` }));
    return true;
  }
  if (one.marks.length === 1) { openAt(one.marks[0].file, one.marks[0].at); return true; }
  return false;
}

/**
 * The repo has no map: the wordmark of Apostil, large and quiet, where VS Code shows its own logo in an empty editor area.
 * Under it the press that maps the repo, one link for each app that can write the map (mapPressHtml in tools.js), and the next steps (the set-up step and the example).
 */
function noMapHtml() {
  const { apps, writing, needsSetup } = Home.data;
  const mark = '<img class="wordmark" src="apostil-wordmark.svg" alt="Apostil">';
  if (writing) return `<div class="nomap">${mark}${mapPressHtml(apps, writing)}</div>`;
  return `<div class="nomap">${mark}<p>This repo has no map and no notes yet.</p>${mapPressHtml(apps)}<div class="next">${nextStepsHtml(needsSetup)}</div></div>`;
}

async function drawHome() {
  const { map } = Home.data;
  const view = document.getElementById('view');
  view.innerHTML = '';
  view.className = 'view';
  const diagram = map && (diagramOf(Home.at) ?? diagramOf(map.top));
  if (diagram) Home.at = diagram.id;
  App.page = mapPage(Home.data);
  const look = Home.data.look;
  Trail.show(document.getElementById('crumb'), ownStep(), { look });
  const summary = document.getElementById('summary');
  summary.textContent = map?.written ?? '';
  // The header line of the look: words with the fields of the repo, a picture in its place, or nothing.
  const headFields = diagram && { repo: Home.data.repo, areas: Object.keys(diagramOf(map.top).graph.nodes).length, files: map.files ?? 0, age: map.written ?? 'written at this commit' };
  const head = diagram && look ? Marks.resolve(look.rules, { kind: 'header', diagram: diagram.id, fields: headFields }, look.one) : {};
  if (Object.keys(head).length) summary.innerHTML = Marks.wordsHtml(map.written ?? '', head, headFields, look) ?? '';
  // After a click on a mark: the quiet line of the value, which the × clears.
  if (Home.filter && diagram) summary.insertAdjacentHTML('beforeend', `${map.written ? ' · ' : ''}<span class="mk-filter">${esc(Home.filter.text)} <a data-clear-filter title="Clear">×</a></span>`);
  let nodes = 0;
  if (!diagram) view.innerHTML = noMapHtml();
  else {
    // The look: the slots of each node and arrow, what shows, and the shapes, words and contents that go into the text before Mermaid draws.
    // A step that a rule opens holds its inner steps in place.
    const shown = look ? Marks.openSteps(diagram, look, diagramOf) : diagram;
    const things = look ? Marks.thingsOf(shown, look) : {};
    const edges = look ? Marks.edgesOf(shown, look, things) : [];
    const shaped = look ? await Marks.lookText(shown, things, edges, look) : { text: diagram.mermaid, filled: {}, graph: diagram.graph, edges };
    const svg = await drawMermaid(view, shaped.text, shaped.text === diagram.mermaid ? undefined : diagram.mermaid, diagram.schema, diagram.id);
    const plain = svg?.hasAttribute('data-plain'); // a look whose text does not draw leaves the diagram as it is
    const drawn = plain ? { graph: diagram.graph, edges: shown === diagram ? edges : Marks.edgesOf(diagram, look, Marks.thingsOf(diagram, look)), boxes: [] } : shaped;
    const nodesOf = plain ? diagram.nodes : shown.nodes;
    markDiagram(view, { ...diagram, graph: drawn.graph }); // each node, each arrow and the diagram as a whole hold a comment
    if (look && svg) {
      edgeElements(svg, drawn.graph.edges).forEach(({ path, label }, at) => Object.assign(drawn.edges[at], { path, label }));
      // With the marks at the corners of the nodes at its edges; a drawing that the look does not touch keeps its frame.
      if (Marks.decorate(svg, things, drawn.edges, look, shaped.filled, { nodeKey, open: openAt, pick: pickMark }, drawn.boxes)) fitToContent(svg);
      // The words of an arrow with a click or other input of the look: the pointer says what they do.
      for (const edge of drawn.edges.filter((one) => one.label)) {
        if (Marks.bind(edge.label, edge.slots, null, edge.label.textContent.trim())) edge.label.classList.add('go');
        Marks.inputWindow(edge.label, edge.slots, edge.label.textContent.trim());
      }
    }
    makeSurface(view, true, false, diagram.id); // a wide map opens where its words read; drawn again with new data, it stays where he left it
    frameLook(view, look, diagram.id);
    for (const g of view.querySelectorAll('g.node, g.image-shape')) {
      const node = nodesOf[nodeKey(g)];
      if (!node) continue;
      nodes++;
      const thing = things[nodeKey(g)];
      // The window of the node, with a quiet link that focuses it as Option+click does.
      const content = node.note ? noteWindow(node, thing) : nodeWindow(g, node, thing);
      const focusIt = () => focusOn(view, drawn.graph, nodeKey(g), diagram.id);
      Hover.attach(g, async () => ({ ...(await content()), act: { words: focus?.stage === view && focus.node === nodeKey(g) ? 'End the focus' : 'Focus on this node', run: focusIt } }));
      g.addEventListener('click', (event) => focusClick(event, view, drawn.graph, thing?.slots['input.alt'], diagram.id)); // before the click of the node (Marks.bind)
      const paths = node.paths.map(({ path }) => path);
      // A click on an area with a diagram of its own goes into it, and the tree "Files" of the side bar follows when it shows. An area with none
      // stays on the map and leads to its code: one file opens, and folders open in the tree. A click never opens the graphs of a folder.
      // In a drawn process a step that holds steps goes one level down, and a step with none opens its file at its first line.
      // A call out of the repo leads nowhere: it is a quiet box with its window only. A click of the look goes to its target instead.
      const today = paths.length ? () => {
        if (node.down) { if (!node.note) tell({ type: 'showInTree', paths }); walkTo(mapStep(node.down)); }
        else if (node.line) tell({ type: 'openFile', path: paths[0], line: node.line });
        else if (paths.length === 1 && !paths[0].endsWith('/')) tell({ type: 'openFile', path: paths[0] });
        else tell({ type: 'showInTree', paths, open: true });
      } : null;
      if (Marks.bind(g, thing?.slots ?? {}, today, Marks.nameOf(g))) g.classList.add('go');
    }
    lightNodes(view, Home.lit);
    const first = view.querySelector('g.node.lit');
    if (first && !view.surface?.kept) view.surface?.show(first); // not when the same diagram drew again: the view stays where he left it
    // The same diagram drawn again keeps its focus; another diagram has none.
    const focused = focus?.diagram === diagram.id ? focus.node : null;
    focus = null;
    if (focused) focusOn(view, drawn.graph, focused, diagram.id);
    Remarks.paint(view);
  }
  if (!diagram) focus = null;
  Remarks.draw();
  tell({ type: 'rendered', kind: 'home', diagram: diagram?.id, nodes, panels: 0, drawn: 0 });
  window.apostilRendered = (window.apostilRendered ?? 0) + 1;
}

// ----- the graphs of a folder or file -----

let panelQueue = Promise.resolve(); // panels draw one after the other
let drawnPanels = 0;

/** Draws one panel small, with the nodes of the path lit and the rest quiet, in the look of the repo; also a diagram of a block (blocks.js). Resolves when it is drawn. */
function drawPanel(box, panel) {
  return panelQueue = panelQueue.then(async () => {
    if (!box.isConnected) return;
    const look = Home.data.look;
    const diagram = look && panel.nodes ? { id: panel.id, nodes: panel.nodes, graph: panel.graph, edgeLines: panel.edgeLines, mermaid: panel.mermaid } : null;
    const things = diagram ? Marks.thingsOf(diagram, look) : {};
    // A node of the panel has rules of its own too ("panel-node"): its box, and whether it shows, by whether it is lit.
    for (const thing of Object.values(things)) {
      const own = Marks.resolve(look.rules, { ...thing, kind: 'panel-node', fields: { lit: !panel.lit.length || panel.lit.includes(thing.node) } }, look.one);
      Object.assign(thing.slots, own);
    }
    const edges = diagram ? Marks.edgesOf(diagram, look, things) : [];
    const shaped = diagram ? await Marks.lookText(diagram, things, edges, look) : { text: panel.mermaid, filled: {}, edges };
    const svg = await drawMermaid(box, shaped.text, shaped.text === panel.mermaid ? undefined : panel.mermaid, panel.schema);
    if (!svg) return;
    if (diagram && !svg.hasAttribute('data-plain')) {
      // A click on a mark of a panel opens its one place, or lists its places; it never goes down a level, as a click on the panel opens the diagram on Home.
      edgeElements(svg, shaped.graph.edges).forEach(({ path, label }, at) => Object.assign(shaped.edges[at], { path, label }));
      const pick = (thing, one) => (one.marks.length === 1 ? (openAt(one.marks[0].file, one.marks[0].at), true) : false);
      if (Marks.decorate(svg, things, shaped.edges, look, shaped.filled, { nodeKey, open: openAt, pick }, shaped.boxes)) fitToContent(svg);
    }
    // A drawing that a rule left with few nodes is drawn at most half again its size, not blown up to the panel.
    const natural = Object.values(things).some((thing) => thing.slots['show.shown'] === false) && [Number(svg.getAttribute('width')), Number(svg.getAttribute('height'))];
    if (natural?.[0]) Object.assign(svg.style, { maxWidth: `${natural[0] * 1.5}px`, maxHeight: `${natural[1] * 1.5}px`, margin: '0 auto' });
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    box.classList.toggle('rest', panel.lit.length > 0); // only the lit part stands out
    box.dataset.lit = lightNodes(box, panel.lit, true);
    drawnPanels++;
    if (Home.data.kind === 'graphs') tell({ type: 'rendered', kind: 'graphs', nodes: 0, panels: Home.data.panels.length, drawn: drawnPanels });
  });
}

/**
 * The panels of the graphs page in the look: each with its slots ("panel"), those that show, in the order that the rules give the list (Marks.listOrder)
 * and in its groups, and the HTML of its lines (a title, a level line and an "in" line, each with rules of its own). With no look, every panel as it was.
 */
function panelsInLook(data) {
  const look = data.look;
  const base = (panel) => ({ title: panel.line, level: panel.level, branch: panel.branch ?? '', path: data.path, where: panel.where });
  const one = (panel) => {
    const fields = { id: panel.id ?? '', level: panel.level, type: panel.type ?? '', branch: panel.branch ?? '', title: panel.line };
    const thing = { kind: 'panel', diagram: panel.nodes ? panel.id : undefined, paths: [data.path], fields };
    const lineOf = (kind, text) => (look ? Marks.wordsHtml(text, Marks.slotsIn(look, { ...thing, kind, fields: base(panel) }), base(panel), look) : esc(text));
    return { ...thing, panel, id: fields.id, slots: Marks.slotsIn(look, thing), title: lineOf('panel-title', panel.line), level: lineOf('panel-level', panel.from), where: lineOf('panel-in', panel.where) };
  };
  const all = data.panels.map(one);
  const rows = all.filter((row) => row.slots['show.shown'] !== false);
  const order = look ? Marks.listOrder(all, look) : {};
  return { groups: Object.keys(order).length ? Marks.orderRows(rows, order) : [{ rows }], ordered: Object.keys(order).length > 0, count: rows.length };
}

async function drawGraphs() {
  const { data } = Home;
  const view = document.getElementById('view');
  view.className = 'view';
  frameDouble = null;
  focus = null;
  Trail.show(document.getElementById('crumb'), ownStep(), { look: data.look });
  const { groups, ordered, count } = panelsInLook(data);
  // The count line: the panels that show; "the widest first" while no rule orders them. A rule gives other words, or leaves it out.
  const summary = document.getElementById('summary');
  const countText = count ? `${plural(count, 'diagram')}${ordered ? '' : ', the widest first'}` : '';
  const countFields = { count, path: data.path };
  const countSlots = data.look ? Marks.resolve(data.look.rules, { kind: 'count-line', paths: [data.path], fields: countFields }, data.look.one) : {};
  if (Object.keys(countSlots).length && count) summary.innerHTML = Marks.wordsHtml(countText, countSlots, countFields, data.look) ?? '';
  else summary.textContent = countText;
  drawnPanels = 0;
  if (!data.panels.length) {
    view.innerHTML = `<p class="nomap">${esc(data.path)} is a part of no diagram yet.</p>`;
  } else {
    const line = (cls, html, tag = 'span') => (html === null ? '' : `<${tag} class="${cls}">${html}</${tag}>`);
    view.innerHTML = `<div class="panels">${groups.map((group) => (group.group !== undefined ? `<div class="pgp">${esc(group.group)}</div>` : '') + group.rows.map((row) => `<a class="pnl" data-panel="${data.panels.indexOf(row.panel)}"><div class="pd"></div>`
      + `<div class="pl">${line('t', row.title)} ${line('fr', row.level)}${line('in', row.where, 'div')}</div></a>`).join('')).join('')}</div>`;
    // A click opens the panel at its level, or goes to the target of the look.
    for (const el of view.querySelectorAll('.pnl')) {
      const panel = data.panels[Number(el.dataset.panel)];
      const row = groups.flatMap((group) => group.rows).find((one) => one.panel === panel);
      // Option+click on a node of a panel focuses it in that panel, in place of the click of the panel.
      const box = el.querySelector('.pd');
      if (panel.graph) box.addEventListener('click', (event) => focusClick(event, box, panel.graph, row.slots['input.alt']));
      Marks.bind(el, row.slots, () => walkTo(panel.open), panel.line);
    }
    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries.filter((one) => one.isIntersecting)) {
        seen.unobserve(entry.target);
        drawPanel(entry.target.querySelector('.pd'), data.panels[Number(entry.target.dataset.panel)]);
      }
    }, { rootMargin: '200px' });
    view.querySelectorAll('.pnl').forEach((el) => seen.observe(el));
  }
  tell({ type: 'rendered', kind: 'graphs', nodes: 0, panels: data.panels.length, drawn: 0 });
  window.apostilRendered = (window.apostilRendered ?? 0) + 1;
}

// ----- a page of the look -----

/** A page of the look: its title and its blocks, drawn by blocks.js; a page that the look no longer has says so in one quiet line. */
async function drawPage() {
  const { data } = Home;
  const view = document.getElementById('view');
  view.className = 'view bk-page';
  Trail.show(document.getElementById('crumb'), ownStep());
  document.getElementById('summary').textContent = '';
  view.innerHTML = data.gone ? `<p class="nomap">${esc(data.gone)}</p>` : `<h1 class="bk-head">${esc(data.title)}</h1><div class="bk-body"></div>`;
  if (!data.gone) await Blocks.show(view.querySelector('.bk-body'), data.blocks);
  tell({ type: 'rendered', kind: 'page', nodes: 0, panels: 0, drawn: 0 });
  window.apostilRendered = (window.apostilRendered ?? 0) + 1;
}

// ----- clicks and messages -----

document.addEventListener('click', (event) => {
  const target = event.target;
  if (target.closest('[data-clear-filter]')) return walkTo(mapStep(Home.at)); // the same diagram, with nothing lit and no line of a mark
  if (target.closest('[data-end-focus]')) return focusOn(null);
  const folder = target.closest('[data-tree]');
  if (folder) return tell({ type: 'showInTree', paths: [folder.dataset.tree], open: true });
  const file = target.closest('[data-open]');
  if (file) return tell({ type: 'openFile', path: file.dataset.open });
  const change = target.closest('[data-change-id]');
  if (change) return walkTo({ tab: 'change', change: Number(change.dataset.changeId), go: { level: 'change' }, name: change.dataset.title });
});

// Messages from VS Code: new data with the path, a new path, a diagram of the map to show (a step back along the path), and the comment key.
window.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.type === 'data') {
    Home.data = message.data;
    if (message.trail) Trail.set(message.trail);
    Home.render();
  }
  if (message?.type === 'trail') Trail.set(message.steps);
  if (message?.type === 'go') Home.goTo(message.go.diagram || null, message.go.lit ?? []);
  if (message?.type === 'remark') (Home.drawing ?? Promise.resolve()).then(() => Remarks.openFromVsCode()); // the comment key
});

const drawIfWaiting = () => { if (Home.waiting) Home.render(); };
document.addEventListener('visibilitychange', drawIfWaiting);
new ResizeObserver(drawIfWaiting).observe(document.body);

// Start: inside VS Code ask for the data; as a file in a browser, load example-data.js:
// "?path=<path>" is the graphs page of that path, "?nomap=1" Home with no map, "?diagram=<id>&lit=<ids>" Home at that diagram, "?look=<name>" Home with a
// made-up look of the example: "?look=1" the look of build 51 (look.json), "?look=shared" look-shared.json; "?look=blocks&page=<id>" a page of that look;
// "?look=home" look-home.json, also with "?path=".
if (vscodeApi) {
  tell({ type: 'ready' });
} else {
  const script = document.createElement('script');
  script.nonce = document.currentScript?.nonce;
  script.src = 'example-data.js';
  script.onload = () => {
    const example = window.APOSTIL_EXAMPLE;
    const query = new URLSearchParams(location.search);
    const path = query.get('path');
    const page = query.get('page') && example.lookPages[query.get('look')]?.[query.get('page')];
    // "?look=<name>": Home with a made-up look of the example; else the default look, with the logos of the services.
    const graphs = (query.get('look') && example.graphsLooks?.[query.get('look')]) || example.graphs; // the graphs pages in a made-up look, for a few paths
    Home.data = page || (path ? graphs[path] ?? example.graphs[path] ?? { kind: 'graphs', repo: example.home.repo, folder: '', path, panels: [] } : query.get('nomap') ? example.homeNoMap : query.get('look') ? example.homeLooks[query.get('look')] : example.home);
    Home.at = query.get('diagram') || null;
    Home.lit = (query.get('lit') ?? '').split(',').filter(Boolean);
    Home.render();
  };
  document.head.append(script);
}
