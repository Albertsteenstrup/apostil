// A schema diagram, drawn by the page (shared/schema.ts gives its tables): each table a box with its rows of columns, each relation a line from the row
// of its column, or from the table, to the table that it points at. The drawing has the form of a Mermaid flow chart: a table is a g.node whose id names
// it, a relation a path "L_<from>_<to>_<n>" in .edgePaths. So the marks, the counts, the join to the code and the lit things of diagram-stage.js work on it as they are.
'use strict';

const SCHEMA_SHOWN = 8; // a table with more than SCHEMA_SHOWN + 2 columns shows SCHEMA_SHOWN of them and "12 more columns"
const openTables = new Set(); // "<diagram>/<table>": the tables whose columns a click opened, while the page lives
let schemaCount = 0;

const svgEl = (tag, attrs = {}, html = '') => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  if (html) el.innerHTML = html;
  return el;
};

/** "+" in green or "−" in red for a thing that the change added or removed, as an SVG tspan; "~" quiet for a changed column. */
const signTspan = (change) => (change === 'new' ? '<tspan class="sg p">+</tspan>' : change === 'removed' ? '<tspan class="sg m">−</tspan>' : change === 'changed' ? '<tspan class="sg">~</tspan>' : '');

/** The order of the tables: the ones that the change touched first (the removed ones after those of now), then the ones that stand there for context. */
const touched = (table) => !!(table.change || table.counts);

/**
 * Draws a schema into an element and returns the SVG. `key` names the diagram, so that a table opened with a click stays open when it is drawn again.
 * A click on "12 more columns" opens the rest of that table in place; the things keep their marks and joins, and the surface takes the new frame.
 */
function drawSchema(into, schema, key = '') {
  const id = `apostil-s${++schemaCount}`;
  into.innerHTML = '';
  const svg = svgEl('svg', { class: 'schema', id, xmlns: SVG_NS });
  svg.innerHTML = `<defs><marker id="${id}-to" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">`
    + '<path class="tip" d="M0 0L10 5L0 10z"/></marker></defs><g class="edgePaths"></g><g class="tables"></g>';
  into.append(svg);

  // Sizes from the font of the drawing: a probe row in the mono font of the page.
  const probe = svg.appendChild(svgEl('text', { class: 'cn' }, 'M'));
  const style = getComputedStyle(probe);
  const size = parseFloat(style.fontSize) || 12;
  const measure = document.createElement('canvas').getContext('2d');
  const width = (text, bold = false) => { measure.font = `${bold ? 600 : 400} ${size}px ${style.fontFamily || 'monospace'}`; return measure.measureText(text).width; };
  probe.remove();
  const row = Math.round(size * 1.75);
  const head = Math.round(size * 2.3);
  const pad = 12;
  const sign = Math.round(size * 1.1); // the room of "+" before a name
  const mark = Math.round(size * 1.2); // the room of the key mark
  const countsText = (counts) => (counts ? [counts.added ? `+${number(counts.added)}` : '', counts.removed ? `−${number(counts.removed)}` : ''].filter(Boolean).join(' ') : '');
  // A removed table shows its removed lines only: the lines of now that drop it are no green of its own.
  const shownCounts = (table) => (table.change === 'removed' ? (table.counts?.removed ? { added: 0, removed: table.counts.removed } : undefined) : table.counts);

  const order = [...schema.tables.filter(touched), ...schema.tables.filter((table) => !touched(table))];
  const boxes = order.map((table) => {
    const many = table.columns.length > SCHEMA_SHOWN + 2;
    const g = svgEl('g', { class: `node schema-table${touched(table) ? '' : ' quiet'}`, id: `${id}-flowchart-${table.name}-0` });
    const rect = svgEl('rect', { class: 'box', rx: 6, ry: 6 });
    const signed = table.change === 'new' || table.change === 'removed'; // a changed table shows its counts, not a sign
    const title = svgEl('text', { class: 'th' }, `${signed ? `${signTspan(table.change)} ` : ''}<tspan class="nm">${esc(table.name)}</tspan>`);
    const counts = shownCounts(table);
    const total = svgEl('text', { class: 'tc', 'text-anchor': 'end' }, counts ? countsTspans(counts) : '');
    const rule = svgEl('line', { class: 'hl' });
    g.append(rect, title, total, rule);
    const rows = table.columns.map((column) => {
      const one = svgEl('g', { class: `row${column.change ? ` c-${column.change}` : ''}` });
      const keyMark = column.keys.includes('PK') ? '◆' : column.keys.length ? '◇' : '';
      one.append(
        svgEl('text', { class: 'sg' }, signTspan(column.change)),
        svgEl('text', { class: 'ky' }, keyMark),
        svgEl('text', { class: 'cn' }, esc(column.name)),
        svgEl('text', { class: 'ct', 'text-anchor': 'end' }, `${column.was ? `<tspan class="was">${esc(column.was)}</tspan> ` : ''}${esc(column.type)}`),
      );
      g.append(one);
      return one;
    });
    const more = many ? svgEl('text', { class: 'more' }) : null;
    if (more) g.append(more);
    const empty = !table.columns.length ? svgEl('text', { class: 'none' }, 'no columns given') : null;
    if (empty) g.append(empty);
    const columnsWidth = Math.max(0, ...table.columns.map((column) => sign + mark + width(column.name) + size * 2 + width(`${column.was ? `${column.was} ` : ''}${column.type}`)));
    const titleWidth = sign + width(table.name, true) + (counts ? size * 1.5 + width(countsText(counts)) : 0);
    const boxWidth = Math.ceil(Math.max(size * 11, columnsWidth, titleWidth, empty ? width('no columns given') + sign : 0) + 2 * pad);
    svg.querySelector('.tables').append(g);
    return { table, g, rect, title, total, rule, rows, more, empty, width: boxWidth, open: openTables.has(`${key}/${table.name}`) };
  });
  const byName = new Map(boxes.map((box) => [box.table.name, box]));

  const paths = schema.relations.map((relation, at) => {
    const path = svgEl('path', { id: `L_${relation.from}_${relation.to}_${at}`, class: 'relation', 'marker-end': `url(#${id}-to)` });
    svg.querySelector('.edgePaths').append(path);
    return path;
  });

  const shown = (box) => (box.open || !box.more ? box.rows.length : SCHEMA_SHOWN);
  const height = (box) => head + 6 + Math.max(1, shown(box) + (box.more && !box.open ? 1 : 0)) * row + 6;
  // Two columns of boxes, one under the other in each, read in a half of the page. A touched table goes to the shorter column; a table that stands there
  // for context goes to the column that holds most of the tables it is related to, so that its lines are short. Chosen once, so a table that opens moves nothing sideways.
  const columns = boxes.length <= 1 ? 1 : 2;
  const filled = [0, 0];
  const related = (box, column) => schema.relations.filter((one) => [one.from, one.to].includes(box.table.name))
    .filter((one) => byName.get(one.from === box.table.name ? one.to : one.from)?.column === column).length;
  for (const box of boxes) {
    const shorter = filled[1] < filled[0] ? 1 : 0;
    box.column = columns === 1 ? 0 : touched(box.table) ? shorter : related(box, 0) === related(box, 1) ? shorter : related(box, 0) > related(box, 1) ? 0 : 1;
    filled[box.column] += height(box);
  }

  /** Where each box stands and how tall it is, and the lines of the relations between them. Run again when a table opens. */
  const layout = () => {
    const gap = { x: 84, y: 30 };
    const columnWidth = [0, 1].map((column) => Math.max(0, ...boxes.filter((box) => box.column === column).map((box) => box.width)));
    const y = [0, 0];
    for (const box of boxes) {
      box.x = box.column ? columnWidth[0] + gap.x + (columnWidth[1] - box.width) / 2 : (columnWidth[0] - box.width) / 2;
      box.y = y[box.column];
      box.height = height(box);
      y[box.column] += box.height + gap.y;
    }
    const middle = (box, index) => box.y + head + 6 + index * row + row / 2; // the middle of row `index`
    const base = (at) => at + size * 0.36; // the line of text in a row with this middle
    for (const box of boxes) {
      const { x, y: top, width: w } = box;
      Object.entries({ x, y: top, width: w, height: box.height }).forEach(([name, value]) => box.rect.setAttribute(name, value));
      Object.entries({ x: x + pad, y: base(top + head / 2) }).forEach(([name, value]) => box.title.setAttribute(name, value));
      Object.entries({ x: x + w - pad, y: base(top + head / 2) }).forEach(([name, value]) => box.total.setAttribute(name, value));
      Object.entries({ x1: x, x2: x + w, y1: top + head, y2: top + head }).forEach(([name, value]) => box.rule.setAttribute(name, value));
      const count = shown(box);
      box.rows.forEach((one, index) => {
        one.style.display = index < count ? '' : 'none';
        const at = base(middle(box, index));
        const [signText, keyText, nameText, typeText] = one.children;
        [[signText, x + pad], [keyText, x + pad + sign], [nameText, x + pad + sign + mark], [typeText, x + w - pad]].forEach(([el, left]) => { el.setAttribute('x', left); el.setAttribute('y', at); });
      });
      if (box.more) {
        box.more.style.display = box.open ? 'none' : '';
        box.more.textContent = `${number(box.rows.length - SCHEMA_SHOWN)} more columns`;
        box.more.setAttribute('x', x + pad + sign + mark);
        box.more.setAttribute('y', base(middle(box, SCHEMA_SHOWN)));
      }
      if (box.empty) { box.empty.setAttribute('x', x + pad + sign); box.empty.setAttribute('y', base(middle(box, 0))); }
    }
    // A relation leaves the row of its column (a column behind "more columns" from that line, no column from the head) and ends at the key of the table it
    // points at, or at its head. Between two columns of boxes it goes across; inside one column it bends round the outer side.
    const rowOf = (box, column) => {
      const index = box.rows.findIndex((one) => one.children[2].textContent === column);
      if (index < 0) return box.y + head / 2;
      return index < shown(box) ? middle(box, index) : middle(box, SCHEMA_SHOWN);
    };
    const bends = new Map();
    schema.relations.forEach((relation, at) => {
      const from = byName.get(relation.from);
      const to = byName.get(relation.to);
      if (!from || !to) return;
      const key = to.table.columns.find((column) => column.keys.includes('PK'))?.name;
      const [y1, y2] = [relation.column ? rowOf(from, relation.column) : from.y + head / 2, relation.column && key ? rowOf(to, key) : to.y + head / 2];
      let d;
      if (from.column !== to.column) {
        const right = from.column < to.column;
        const [x1, x2] = right ? [from.x + from.width, to.x] : [from.x, to.x + to.width];
        const bend = (x2 - x1) / 2;
        d = `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`;
      } else {
        const side = from.column === 0 ? -1 : 1;
        const n = bends.get(from.column) ?? 0;
        bends.set(from.column, n + 1);
        const out = 34 + 10 * (n % 4);
        const [x1, x2] = side < 0 ? [from.x, to.x] : [from.x + from.width, to.x + to.width];
        d = `M${x1} ${y1} C${x1 + side * out} ${y1} ${x2 + side * out} ${y2} ${x2} ${y2}`;
      }
      const path = paths[at];
      path.setAttribute('d', d);
      // The wide line that the pointer finds, and the counts at the middle of the line, follow (diagram-stage.js adds them after the first drawing).
      if (path.nextElementSibling?.classList.contains('hit')) path.nextElementSibling.setAttribute('d', d);
      if (path.countsText) {
        const point = path.getPointAtLength(path.getTotalLength() / 2);
        path.countsText.setAttribute('x', point.x + 6);
        path.countsText.setAttribute('y', point.y + 4);
      }
    });
  };
  layout();
  // A first frame from the boxes, with room for the lines that bend round the sides; fitToContent makes it exact when the drawing is on screen.
  const [left, right] = [Math.min(...boxes.map((box) => box.x)) - 60, Math.max(...boxes.map((box) => box.x + box.width)) + 60];
  const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + 8;
  if (boxes.length) Object.entries({ viewBox: `${left} -8 ${right - left} ${bottom + 8}`, width: right - left, height: bottom + 8 }).forEach(([name, value]) => svg.setAttribute(name, value));

  for (const box of boxes.filter((one) => one.more)) {
    box.more.addEventListener('click', (event) => {
      if (into.closest('.pnl')) return; // a small panel opens its diagram as a whole
      event.stopPropagation();
      event.preventDefault();
      box.open = true;
      openTables.add(`${key}/${box.table.name}`);
      layout();
      if (into.surface?.reframe) into.surface.reframe();
      else fitToContent(svg);
    });
  }
  return svg;
}
