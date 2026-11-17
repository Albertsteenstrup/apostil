// What a drawn process adds to its Mermaid drawing on Home (build 67): a long chain in columns, a quiet dot at a box that calls a box without an arrow,
// the light on the callers of a box that many boxes call, and the window that lists those callers. The text of the drawing, its numbers and its dots
// are made in shared/process-diagrams.ts; here the page chooses the drawing and draws what Mermaid cannot.
'use strict';

const ProcessDrawing = (() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const oneColumn = new Set(); // the drawings that he put in one column: kept while the page is open

  /** A drawing goes in columns when it has them, no rule of the look turns it (layout.direction) or leaves a box out of it, and he did not ask for one column. */
  const columnsOn = (diagram, { direction = null, hidden = false, one = false } = {}) => !!diagram.columns && !direction && !hidden && !one;

  /** The diagram as the page draws it: itself, or with the text, the graph and the dots of its drawing in columns. */
  function laidOut(diagram, look) {
    const rules = look ? { direction: Marks.drawingOf(diagram, look)?.slots['layout.direction'], hidden: Object.values(Marks.thingsOf(diagram, look)).some((thing) => thing.slots['show.shown'] === false) } : {};
    if (!columnsOn(diagram, { ...rules, one: oneColumn.has(diagram.id) })) return diagram;
    return { ...diagram, mermaid: diagram.columns.mermaid, graph: diagram.columns.graph, dots: diagram.columns.dots };
  }

  /** The quiet link "One column" (and back "Columns") at the end of the line at the top of a drawing that has columns. */
  function link(summary, diagram, laid) {
    if (!diagram.columns || (laid === diagram && !oneColumn.has(diagram.id))) return;
    const a = document.createElement('a');
    a.className = 'pd-columns';
    a.textContent = oneColumn.has(diagram.id) ? 'Columns' : 'One column';
    a.addEventListener('click', () => { oneColumn.has(diagram.id) ? oneColumn.delete(diagram.id) : oneColumn.add(diagram.id); Home.render(); });
    summary.append(summary.textContent ? ' · ' : '', a);
  }

  const nodeOf = (svg, id) => [...svg.querySelectorAll('g.node')].find((g) => nodeKey(g) === id);
  const nameOf = (diagram, id) => diagram.nodes[id]?.note?.title ?? diagram.graph.nodes[id]?.replace(/<[^>]*>/g, ' ').trim() ?? id;

  /** The box of an element in the coordinates of `group`. */
  function boxIn(group, el) {
    const to = group.getScreenCTM().inverse();
    const { left, top, right, bottom } = el.getBoundingClientRect();
    const [a, b] = [new DOMPoint(left, top).matrixTransform(to), new DOMPoint(right, bottom).matrixTransform(to)];
    return { left: a.x, top: a.y, right: b.x, bottom: b.y, middle: (a.x + b.x) / 2 };
  }

  /**
   * One arrow from the end of each column to the start of the next, in the way that Mermaid cannot be asked for: down under the last box, along to the gap
   * between the columns, up to above the first box of the next column, and down onto it. The arrow that Mermaid drew between the two column boxes is hidden.
   */
  function connect(svg, diagram) {
    const root = svg.querySelector('g.root') ?? svg.firstElementChild;
    const marker = svg.querySelector('marker[id$="pointEnd"]')?.id;
    for (const hidden of svg.querySelectorAll('[id^="L_col"], g.edgeLabel:has([data-id^="L_col"])')) hidden.style.display = 'none';
    const steps = (ids) => ids.map((id) => nodeOf(svg, id)).filter((g, at) => g && !diagram.nodes[ids[at]].quiet && diagram.nodes[ids[at]].kind === 'step');
    const columns = diagram.columns.columns.map((ids) => ({ all: ids.map((id) => nodeOf(svg, id)).filter(Boolean).map((g) => boxIn(root, g)), steps: steps(ids).map((g) => boxIn(root, g)) }));
    columns.slice(1).forEach((next, at) => {
      const [now, end, start] = [columns[at], columns[at].steps.at(-1), next.steps[0]];
      if (!end || !start) return;
      const gap = (Math.max(...now.all.map((box) => box.right)) + Math.min(...next.all.map((box) => box.left))) / 2;
      const [down, up] = [end.bottom + 16, start.top - 16];
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'flowchart-link colink');
      path.setAttribute('d', `M${end.middle} ${end.bottom} V${down} H${gap} V${up} H${start.middle} V${start.top}`);
      if (marker) path.setAttribute('marker-end', `url(#${marker})`);
      root.append(path);
    });
  }

  /** A quiet dot at the right edge of a box for each box that it calls without an arrow; the pointer on it says which. */
  function dots(svg, diagram) {
    for (const [from, targets] of Object.entries(diagram.dots ?? {})) {
      const g = nodeOf(svg, from);
      if (!g) continue;
      const box = g.getBBox();
      const holder = document.createElementNS(SVG_NS, 'g'); // beside the box, so that the window of the box does not open on the dot
      holder.setAttribute('transform', g.getAttribute('transform') ?? '');
      g.after(holder);
      targets.forEach((to, at) => {
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('class', 'calldot');
        dot.setAttribute('r', 4);
        dot.setAttribute('cx', box.x + box.width);
        dot.setAttribute('cy', box.y + box.height / 2 + (at - (targets.length - 1) / 2) * 12);
        dot.dataset.tip = `Calls ${nameOf(diagram, to)}`;
        holder.append(dot);
      });
    }
  }

  /** The pointer on a box that other boxes call without an arrow lights all its callers, with an arrow or with a dot. */
  function lightCallers(svg, diagram) {
    const dotted = [...new Set(Object.values(diagram.dots ?? {}).flat())];
    for (const to of dotted) {
      const g = nodeOf(svg, to);
      if (!g) continue;
      const callers = new Set([...diagram.graph.edges.filter((edge) => edge.to === to).map((edge) => edge.from), ...Object.entries(diagram.dots).filter(([, list]) => list.includes(to)).map(([from]) => from)]);
      let lit = [];
      g.addEventListener('mouseenter', () => { lit = [...callers].map((id) => nodeOf(svg, id)).filter((one) => one && !one.classList.contains('lit')); lit.forEach((one) => one.classList.add('lit')); });
      g.addEventListener('mouseleave', () => { lit.forEach((one) => one.classList.remove('lit')); lit = []; });
    }
  }

  /** What the page adds to a drawn process: the dots, the light on callers and, in columns, the arrows between them. Call it before the surface is made. */
  function decorate(svg, laid, diagram) {
    if (!laid.nodes || !diagram.id?.startsWith('process:')) return;
    const columns = laid !== diagram && !svg.hasAttribute('data-plain');
    if (svg.hasAttribute('data-plain')) laid = diagram;
    if (columns) connect(svg, diagram);
    dots(svg, laid);
    lightCallers(svg, laid);
    svg.parentElement.classList.toggle('columns', columns);
    fitToContent(svg);
  }

  /** The rows of the callers of a box that three or more boxes call, each a link to its line, for the window of that box; nothing for another box. */
  function callersHtml(node) {
    if (!node.callers) return '';
    const rows = node.callers.map((one) => `<a data-open="${esc(one.file)}"${one.line ? ` data-line="${one.line}"` : ''}><span>${esc(one.title)}</span><i class="c">${esc(one.file.split('/').pop())}${one.line ? `:${one.line}` : ''}</i></a>`).join('');
    return `<div class="rows"><div class="gp">Called by ${node.callers.length} steps</div>${rows}</div>`;
  }

  return { columnsOn, laidOut, link, decorate, callersHtml };
})();

if (typeof module === 'object') module.exports = ProcessDrawing; // for the tests in Node
