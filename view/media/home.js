// Home: the map of the repo as one large diagram that he moves and zooms, one level at a time.
// The graphs page: one small panel for each diagram that a folder or file is a part of, drawn when it comes into view.
'use strict';

const Home = {
  data: null, // a HomeData or a GraphsData from home-data.ts
  at: null, // the id of the map diagram that Home shows
  lit: [], // the nodes to light on it
  filter: null, // after a click on a mark: the quiet line "<value> · n places in <node>", and the nodes that hold the value are lit

  // Draws one at a time; a hidden tab has no size and Mermaid would draw empty boxes, so the drawing waits until it shows.
  render() {
    this.waiting = !document.body.clientWidth || document.hidden;
    if (this.waiting) return this.drawing ?? Promise.resolve();
    this.drawing = (this.drawing ?? Promise.resolve()).then(() => (this.data?.kind === 'graphs' ? drawGraphs() : drawHome())).catch((error) => console.error(error));
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

// ----- the steps of the path: a diagram of the map, the graphs of a path, a change -----

/** The step of a diagram of the map: the top map is Home. With the line of a mark, the step names the value too. */
const mapStep = (id, lit = [], filter = null) => {
  const step = id === Home.data.map?.top ? { ...Trail.HOME, lit } : { tab: 'home', diagram: id, lit, name: diagramOf(id).title };
  return filter ? { ...step, filter, name: `${step.name} · ${filter.value}` } : step;
};
const graphsStep = (path) => ({ tab: 'graphs', path, name: path });

/** The view that this tab shows now, as a step of the path. */
const ownStep = () => (Home.data.kind === 'graphs' ? graphsStep(Home.data.path) : Home.data.map ? mapStep(Home.at, Home.lit, Home.filter) : Trail.HOME);

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
  ? { map: true, title: data.repo, diagrams: data.map.diagrams, remarks: data.remarks, apps: data.apps, parts: [], files: [], notes: [], links: [], openPoints: [], checks: { filesInNoPart: [] } }
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
      title: g.textContent.trim(), width: 520,
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
    return { ...content, ready: async (body) => { if (look && thing) await Marks.decorateNote(body.querySelector('.mk-note'), look, { ...thing, kind: 'note', marks: marks ? thing.marks : [] }, openAt); } };
  };
}

// ----- the marks and the look on Home -----

/** Opens a file of the repo at a line, as a step of a process does. */
const openAt = (path, line) => tell({ type: 'openFile', path, line });

// What Home does itself for a target of the look (Marks.act): a diagram of the map goes one level in this tab, the graphs of a path open as a step;
// a prompt names the diagram that Home shows.
Marks.useHere({
  walk: (step) => {
    if (step.tab === 'home' && !diagramOf(step.diagram)) return true; // a diagram that the map no longer has: nothing opens
    walkTo(step.tab === 'home' ? mapStep(step.diagram, step.lit) : step);
    return true;
  },
  diagram: () => Home.at,
});

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
  Trail.show(document.getElementById('crumb'), ownStep());
  const summary = document.getElementById('summary');
  summary.textContent = map?.written ?? '';
  // After a click on a mark: the quiet line of the value, which the × clears.
  if (Home.filter && diagram) summary.insertAdjacentHTML('beforeend', `${map.written ? ' · ' : ''}<span class="mk-filter">${esc(Home.filter.text)} <a data-clear-filter title="Clear">×</a></span>`);
  let nodes = 0;
  if (!diagram) view.innerHTML = noMapHtml();
  else {
    // The look: the slots of each node and arrow, what shows, and the shapes, words and contents that go into the text before Mermaid draws.
    const look = Home.data.look;
    const things = look ? Marks.thingsOf(diagram, look) : {};
    const edges = look ? Marks.edgesOf(diagram, look, things) : [];
    const shaped = look ? await Marks.lookText(diagram, things, edges, look) : { text: diagram.mermaid, filled: {}, graph: diagram.graph, edges };
    const svg = await drawMermaid(view, shaped.text, shaped.text === diagram.mermaid ? undefined : diagram.mermaid, diagram.schema, diagram.id);
    const drawn = svg?.hasAttribute('data-plain') ? { graph: diagram.graph, edges } : shaped; // a look whose text does not draw leaves the diagram as it is
    markDiagram(view, { ...diagram, graph: drawn.graph }); // each node, each arrow and the diagram as a whole hold a comment
    if (look && svg) {
      edgeElements(svg, drawn.graph.edges).forEach(({ path, label }, at) => Object.assign(drawn.edges[at], { path, label }));
      // With the marks at the corners of the nodes at its edges; a drawing that the look does not touch keeps its frame.
      if (Marks.decorate(svg, things, drawn.edges, look, shaped.filled, { nodeKey, open: openAt, pick: pickMark })) fitToContent(svg);
      // The words of an arrow with a click or other input of the look: the pointer says what they do.
      for (const edge of drawn.edges.filter((one) => one.label)) {
        if (Marks.bind(edge.label, edge.slots, null, edge.label.textContent.trim())) edge.label.classList.add('go');
        Marks.inputWindow(edge.label, edge.slots, edge.label.textContent.trim());
      }
    }
    makeSurface(view, true); // a wide map opens where its words read
    for (const g of view.querySelectorAll('g.node, g.image-shape')) {
      const node = diagram.nodes[nodeKey(g)];
      if (!node) continue;
      nodes++;
      const thing = things[nodeKey(g)];
      Hover.attach(g, node.note ? noteWindow(node, thing) : nodeWindow(g, node, thing));
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
      if (Marks.bind(g, thing?.slots ?? {}, today, g.textContent.trim())) g.classList.add('go');
    }
    lightNodes(view, Home.lit);
    const first = view.querySelector('g.node.lit');
    if (first) view.surface?.show(first);
    Remarks.paint(view);
  }
  Remarks.draw();
  tell({ type: 'rendered', kind: 'home', diagram: diagram?.id, nodes, panels: 0, drawn: 0 });
  window.apostilRendered = (window.apostilRendered ?? 0) + 1;
}

// ----- the graphs of a folder or file -----

let panelQueue = Promise.resolve(); // panels draw one after the other
let drawnPanels = 0;

/** Draws one panel small, with the nodes of the path lit and the rest quiet, in the look of the repo. */
function drawPanel(box, panel) {
  panelQueue = panelQueue.then(async () => {
    if (!box.isConnected) return;
    const look = Home.data.look;
    const diagram = look && panel.nodes ? { id: panel.id, nodes: panel.nodes, graph: panel.graph, edgeLines: panel.edgeLines, mermaid: panel.mermaid } : null;
    const things = diagram ? Marks.thingsOf(diagram, look) : {};
    const edges = diagram ? Marks.edgesOf(diagram, look, things) : [];
    const shaped = diagram ? await Marks.lookText(diagram, things, edges, look) : { text: panel.mermaid, filled: {}, edges };
    const svg = await drawMermaid(box, shaped.text, shaped.text === panel.mermaid ? undefined : panel.mermaid, panel.schema);
    if (!svg) return;
    if (diagram && !svg.hasAttribute('data-plain')) {
      // A click on a mark of a panel opens its one place, or lists its places; it never goes down a level, as a click on the panel opens the diagram on Home.
      edgeElements(svg, shaped.graph.edges).forEach(({ path, label }, at) => Object.assign(shaped.edges[at], { path, label }));
      const pick = (thing, one) => (one.marks.length === 1 ? (openAt(one.marks[0].file, one.marks[0].at), true) : false);
      if (Marks.decorate(svg, things, shaped.edges, look, shaped.filled, { nodeKey, open: openAt, pick })) fitToContent(svg);
    }
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    box.classList.toggle('rest', panel.lit.length > 0); // only the lit part stands out
    box.dataset.lit = lightNodes(box, panel.lit, true);
    drawnPanels++;
    tell({ type: 'rendered', kind: 'graphs', nodes: 0, panels: Home.data.panels.length, drawn: drawnPanels });
  });
}

async function drawGraphs() {
  const { data } = Home;
  const view = document.getElementById('view');
  view.className = 'view';
  Trail.show(document.getElementById('crumb'), ownStep());
  document.getElementById('summary').textContent = data.panels.length ? `${plural(data.panels.length, 'diagram')}, the widest first` : '';
  drawnPanels = 0;
  if (!data.panels.length) {
    view.innerHTML = `<p class="nomap">${esc(data.path)} is a part of no diagram yet.</p>`;
  } else {
    view.innerHTML = `<div class="panels">${data.panels.map((panel, index) => `<a class="pnl" data-panel="${index}"><div class="pd"></div>`
      + `<div class="pl"><span class="t">${esc(panel.line)}</span> <span class="fr">${esc(panel.from)}</span><div class="in">${esc(panel.where)}</div></div></a>`).join('')}</div>`;
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

// ----- clicks and messages -----

document.addEventListener('click', (event) => {
  const target = event.target;
  if (target.closest('[data-clear-filter]')) return walkTo(mapStep(Home.at)); // the same diagram, with nothing lit and no line of a mark
  const folder = target.closest('[data-tree]');
  if (folder) return tell({ type: 'showInTree', paths: [folder.dataset.tree], open: true });
  const file = target.closest('[data-open]');
  if (file) return tell({ type: 'openFile', path: file.dataset.open });
  const change = target.closest('[data-change-id]');
  if (change) return walkTo({ tab: 'change', change: Number(change.dataset.changeId), go: { level: 'change' }, name: change.dataset.title });
  const panel = target.closest('[data-panel]');
  if (panel) walkTo(Home.data.panels[Number(panel.dataset.panel)].open);
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
// made-up look of the example: "?look=1" the look of build 51 (look.json), "?look=shared" look-shared.json.
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
    // "?look=<name>": Home with a made-up look of the example; else the default look, with the logos of the services.
    Home.data = path ? example.graphs[path] ?? { kind: 'graphs', repo: example.home.repo, folder: '', path, panels: [] } : query.get('nomap') ? example.homeNoMap : query.get('look') ? example.homeLooks[query.get('look')] : example.home;
    Home.at = query.get('diagram') || null;
    Home.lit = (query.get('lit') ?? '').split(',').filter(Boolean);
    Home.render();
  };
  document.head.append(script);
}
