// Marks and the look on a page: which rule wins each slot of a thing, the marks that roll up to it, the colours of both themes, and the drawing
// of corners, boxes, pictures, films and arrows. Home draws its diagrams with it and the file tab its note cards; one path draws a mark of any set.
// Also the shared kinds of every component: the fields that a rule reads, what shows, the words, the window of the pointer, and where a click,
// a key or a menu entry goes (act). The rules come from view/look-data.ts, in the order that they apply. The first part has no drawing, so that
// the tests read it in Node.
'use strict';

const Marks = (() => {
  // ----- which things a rule picks, and which rule wins a slot -----

  const covers = (entry, path) => entry === path || (entry.endsWith('/') && path.startsWith(entry));
  const keyOf = (mark) => `${mark.set}:${mark.value}`;
  const fits = (pattern, mark) => { const [set, value] = pattern.split(':'); return mark.set === set && (value === '*' || mark.value === value); };

  /**
   * True when a mark stands inside a thing: a line of its calls, a line inside its lines, or a file under its paths. A note in the file tab (`now`)
   * counts the lines of the file now; a step of the map counts the lines at the save of the map, as its note does.
   */
  function holds(thing, mark) {
    const line = thing.now ? mark.at : mark.line;
    if (thing.calls) return thing.calls.some((one) => one.file === mark.file && one.line === line);
    if (thing.at) return thing.at.some((span) => span.file === mark.file && line >= span.from && line <= span.to);
    return (thing.paths ?? []).some((path) => covers(path, mark.file));
  }

  /** The marks inside a thing, less those that it leaves to others (a call out of the repo shows the marks of its lines, not the step that calls it). */
  const marksIn = (thing, marks, leave = new Set()) => marks.filter((mark) => !leave.has(mark) && holds(thing, mark));

  /** True when a field of a thing has a value; a field with a list of values (the names of a call) has it when the list holds it. */
  const hasValue = (field, value) => (Array.isArray(field) ? field.includes(value) : field === value);

  /** True when a rule picks a thing. An arrow is picked by nodes, paths or a mark when both its ends are, or when its own line holds the mark. */
  function picks(pick, thing) {
    // A drawn process ("process:<id>") holds the drawings of its steps ("process:<id>/<n>") too.
    const inDiagram = !pick.diagram || pick.diagram === thing.diagram || (pick.diagram.startsWith('process:') && !!thing.diagram?.startsWith(`${pick.diagram}/`));
    if (pick.kind !== thing.kind || !inDiagram) return false;
    const ends = thing.ends ?? [thing];
    if (pick.nodes && !ends.every((end) => pick.nodes.includes(end.node))) return false;
    if (pick.paths && !ends.every((end) => (end.paths ?? []).some((path) => pick.paths.some((entry) => covers(entry, path))))) return false;
    const marked = (one) => (one.marks ?? []).some((mark) => fits(pick.mark, mark));
    if (pick.mark && !marked(thing) && !(thing.ends && thing.ends.every(marked))) return false;
    // "where": each field that it names has one of its values.
    if (pick.where && !Object.entries(pick.where).every(([field, want]) => [want].flat().some((one) => hasValue(thing.fields?.[field], one)))) return false;
    return true;
  }

  /** How closely a rule names what it picks: a node id, then a mark, then a path, then a field ("where"), then a kind. */
  const rankOf = (pick) => (pick.nodes ? 5 : pick.mark ? 4 : pick.paths ? 3 : pick.where ? 2 : 1);

  // A slot that the page takes whole: one field only, or one target (LOOK_PARTS in shared/look.ts names them; the data of a page brings them as `one`).
  const ONE = ['content', 'click'];

  /** The slots that a rule sets, each with its value: "box.color", "content", "corners.upper-right", "note.color", "arrow.width", … */
  function slotsOf(rule, one = ONE) {
    const slots = [];
    for (const [slot, fields] of Object.entries(rule)) {
      if (slot === 'pick') continue;
      if (one.includes(slot)) slots.push([slot, fields]);
      else for (const [field, value] of Object.entries(fields ?? {})) slots.push([`${slot}.${field}`, value]);
    }
    return slots;
  }

  /**
   * The slots of a thing, each with the value of the rule that wins it. A rule changes only its own slots. When two rules set one slot of one thing,
   * the one that names the thing most closely wins, then the later one. The default look is the first rule.
   */
  function resolve(rules, thing, one = ONE) {
    const won = {};
    rules.forEach((rule, index) => {
      if (!picks(rule.pick, thing)) return;
      const rank = rankOf(rule.pick);
      for (const [slot, value] of slotsOf(rule, one)) {
        const had = won[slot];
        if (!had || rank > had.rank || (rank === had.rank && index > had.index)) won[slot] = { rank, index, value };
      }
    });
    return Object.fromEntries(Object.entries(won).map(([slot, one]) => [slot, one.value]));
  }

  // ----- the fields of a thing: what the pick "where", the words in braces and an order read -----

  /** The fields of a node of a diagram, from the data of the page (LOOK_PARTS names them for each component). */
  function fieldsOf(kind, key, node, diagram) {
    const label = diagram.graph?.nodes?.[key] ?? key;
    if (kind === 'step') return { title: node.note?.title ?? label, file: node.paths[0]?.path ?? '', steps: node.steps ?? 0, is: node.process ? 'process' : 'step', quiet: !!node.quiet };
    if (kind === 'call') return { name: node.names ?? [], of: node.note?.title ?? label };
    return { title: label, files: node.files ?? 0, down: !!node.down };
  }

  const escapeHtml = (text) => String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

  /** Words of the look with the fields of a thing in braces filled in, as plain text: a part drawn as HTML escapes the whole of it. */
  const fillText = (words, fields = {}, each = (text) => text) => words.replace(/\{([^{}]*)\}/g, (all, name) => {
    const value = fields[name.trim()];
    return value === undefined ? '' : each([value].flat().join(', '));
  });

  /** Words of the look with the fields of a thing in braces filled in: "{title} · {files} files". The values from the repo are escaped. */
  const fillWords = (words, fields = {}) => fillText(words, fields, escapeHtml);

  /**
   * Rows of a list in the order of the slot "order": the ids of "first" first, in their order, then by the field "by" ("down": the largest first);
   * with "group", the rows of one value of that field together, the groups in the order of their first row. Returns [{ group, rows }].
   */
  function orderRows(rows, order = {}) {
    const { by, down, group, first = [] } = order;
    const placeOf = (row) => { const at = first.indexOf(row.id); return at < 0 ? first.length : at; };
    const compare = (a, b) => {
      const [x, y] = [a.fields?.[by], b.fields?.[by]];
      const sign = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
      return down ? -sign : sign;
    };
    const sorted = [...rows].sort((a, b) => placeOf(a) - placeOf(b) || (by ? compare(a, b) : 0));
    if (!group) return [{ group: undefined, rows: sorted }];
    const groups = new Map();
    for (const row of sorted) groups.set(row.fields?.[group], [...(groups.get(row.fields?.[group]) ?? []), row]);
    return [...groups].map(([value, own]) => ({ group: value, rows: own }));
  }

  /**
   * The things of a diagram for the look, by node id: each with its kind, its paths or lines, its fields, the marks inside it, and the slots that the
   * rules give it. A call out of the repo shows the marks of its lines, and the step that calls gets no second chip for them.
   */
  function thingsOf(diagram, look) {
    const callLines = Object.values(diagram.nodes).flatMap((node) => node.calls ?? []);
    const leave = new Set(look.marks.filter((mark) => callLines.some((one) => one.file === mark.file && one.line === mark.line)));
    const things = {};
    for (const [key, node] of Object.entries(diagram.nodes)) {
      const kind = node.kind ?? 'node';
      const where = kind === 'call' ? { calls: node.calls ?? [] } : kind === 'step' ? { at: node.at ?? [] } : {};
      const thing = { kind, diagram: diagram.id, node: key, paths: node.paths.map((one) => one.path), fields: fieldsOf(kind, key, node, diagram), ...where };
      thing.marks = marksIn(thing, look.marks, kind === 'call' ? new Set() : leave);
      thing.slots = resolve(look.rules, thing, look.one);
      // The count line of a step that holds steps, or of a process ("9 steps"): a part of its box with rules of its own.
      if (kind === 'step' && node.steps) {
        thing.count = { kind: 'step-count', diagram: diagram.id, node: key, paths: thing.paths, fields: { steps: node.steps } };
        thing.count.slots = resolve(look.rules, thing.count, look.one);
      }
      things[key] = thing;
    }
    return things;
  }

  /** The arrows of a diagram for the look: each with its two ends, the marks at its own line (a drawn process), and its slots. */
  function edgesOf(diagram, look, things) {
    const tokens = diagram.id?.startsWith('process:') ? flowArrows(diagram.mermaid ?? '') : [];
    return diagram.graph.edges.map((edge, at) => {
      const lines = diagram.edgeLines?.[`${edge.from}>${edge.to}`] ?? [];
      const marks = look.marks.filter((mark) => lines.some((one) => one.file === mark.file && one.line === mark.line));
      // What the arrow is: of a written diagram, of the writer in a drawn process (a dotted one is a branch), or a handoff between processes.
      const is = diagram.id?.startsWith('processes:') ? 'handoff' : !diagram.id?.startsWith('process:') ? 'diagram' : /^\s*-\./.test(tokens[at] ?? '') ? 'branch' : 'writer';
      // A numbered arrow of a drawn process has its number in the label: the words that a rule reads are without it.
      const order = diagram.order?.[`${edge.from}>${edge.to}`];
      const words = order ? (edge.label ?? '').replace(new RegExp(`^${order}(?: |$)`), '') : edge.label ?? '';
      const thing = { kind: 'arrow', diagram: diagram.id, ends: [things[edge.from], things[edge.to]].filter(Boolean), marks, fields: { words, of: edge.from, is } };
      return { ...edge, marks, order, fields: thing.fields, slots: resolve(look.rules, thing, look.one) };
    });
  }

  // ----- what shows: a flow chart without the things that a rule leaves out -----

  // The arrows and the node ids of a flow chart, as flowGraph() in shared/diagram-graph.ts reads them: it counts the arrows in the same order.
  const FLOW_ARROW = /\s*(?:--\s+[^-]+?\s+--[->]|==\s+[^=]+?\s+==[=>]|-\.\s+.+?\s+\.->|<?-{2,}>|<?={2,}>|-{3,}|={3,}|<?-\.+->|-\.+-)\s*(?:\|[^|]*\|)?\s*/;
  const FLOW_NODE = /^([A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*)\s*(.*)$/;
  const NOT_A_STATEMENT = /^\s*(subgraph|end|classDef|class|style|linkStyle|click|direction|%%)\b/;
  const OUTSIDE_QUOTES = /;(?=(?:[^"]*"[^"]*")*[^"]*$)/; // a ";" between two statements, not one inside quoted words such as "&lt;"

  /** An arrow without its words: "-->|yes|" and "-- yes -->" are "-->", "-. yes .->" is "-.->". */
  const bareArrow = (token) => {
    const arrow = token.trim().replace(/\|[^|]*\|$/, '').trim();
    const named = /^(--|==|-\.)\s+.+?\s+(--[->]|==[=>]|\.->)$/.exec(arrow);
    return named ? (named[1] === '-.' ? '-.->' : named[2]) : arrow;
  };

  /**
   * The parts of one statement of a flow chart: its arrows and its groups of nodes ([whole, id, shape], "a & b" is one group), with the words in
   * quotes hidden first, so that an arrow inside them does not count; `restore` puts them back.
   */
  function statementParts(trimmed) {
    const quoted = [];
    const masked = trimmed.replace(/"[^"]*"/g, (words) => `\u0000${quoted.push(words) - 1}\u0000`);
    const restore = (words) => words.replace(/\u0000(\d+)\u0000/g, (all, index) => quoted[Number(index)]);
    const arrows = masked.match(new RegExp(FLOW_ARROW.source, 'g')) ?? [];
    const groups = masked.split(FLOW_ARROW).map((segment) => segment.split(/\s+&\s+/).map((node) => FLOW_NODE.exec(node.trim())).filter(Boolean));
    return { arrows, groups, restore };
  }

  /** The parts of each statement of a flow chart that names nodes or arrows, in the order of the text. */
  const statementsOf = (text) => text.split('\n').flatMap((line) => (/^\s*(flowchart|graph)\b/.test(line) ? [] : line.split(OUTSIDE_QUOTES)
    .filter((one) => one.trim() && !NOT_A_STATEMENT.test(one)).map((one) => statementParts(one.trim()))));

  /** The arrow of each edge of a flow chart, in the order that flowGraph() counts them: "-->", "-.->|no|", … */
  const flowArrows = (text) => statementsOf(text).flatMap(({ groups, arrows }) => groups.flatMap((group, index) => (index > 0 ? groups[index - 1].flatMap(() => group.map(() => arrows[index - 1] ?? '-->')) : [])));

  /** A title of Mermaid as plain words: no quotes around it, no HTML, and "#quot;" as a quote. */
  const plainText = (text) => String(text).trim().replace(/^"([\s\S]*)"$/, '$1').replace(/<[^>]*>/g, ' ').replace(/#quot;/g, '"').replace(/#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

  /** The boxes of a flow chart (its subgraphs) that have an id: each with its id, its title, and the nodes inside it, also in the boxes inside it. */
  function groupsOf(text) {
    const groups = [];
    const open = [];
    text.split('\n').forEach((line) => {
      const start = /^\s*subgraph\s+([A-Za-z0-9_-]+)\s*(?:\[(.*)\])?\s*$/.exec(line);
      if (start) { const group = { id: start[1], title: plainText(start[2] ?? start[1]), nodes: [] }; groups.push(group); open.push(group); return; }
      if (/^\s*subgraph\b/.test(line)) return void open.push(null); // a box whose title is its id: not drawn by a rule
      if (/^\s*end\s*$/.test(line)) return void open.pop();
      if (!open.some(Boolean)) return;
      const ids = statementsOf(line).flatMap((parts) => parts.groups.flat().map(([, id]) => id));
      for (const group of open.filter(Boolean)) for (const id of ids) if (!group.nodes.includes(id)) group.nodes.push(id);
    });
    return groups;
  }

  /**
   * The Mermaid text of a flow chart without the nodes `hide.nodes` and the arrows `hide.edges` (their numbers in the order of the text), and with new
   * words `hide.words` (by number) on arrows. A statement that holds none of them stays as it was written; one that does is written again as its nodes,
   * then its arrows one by one. A box of a group (a subgraph) that is left empty goes too. The rest is laid out by Mermaid.
   * Optional: `hide.groups` (a box by its id: { fold, title }) gives a box a new title, or folds it to one node with that title; `hide.into` (a node
   * inside a folded box: the box) moves the arrows of the node to the box; `hide.rename` (a node: its new id) writes the node with another id;
   * `hide.plain` (numbers of arrows) writes those arrows plain, with no words.
   */
  function flowWithout(text, hide) {
    let edge = -1;
    const into = hide.into ?? new Map();
    const rename = hide.rename ?? new Map();
    const unwritten = (id) => hide.nodes.has(id) || into.has(id); // a node that is not written: hidden, or inside a folded box
    const end = (id) => into.get(id) ?? rename.get(id) ?? id; // where an arrow of a node goes
    const rewrite = (statement) => {
      const trimmed = statement.trim();
      if (/^class\s/.test(trimmed)) {
        const [, ids, name] = /^class\s+(\S+)\s+(.*)$/.exec(trimmed) ?? [];
        const kept = (ids ?? '').split(',').filter((id) => !unwritten(id)).map(end);
        return !ids ? statement : kept.length ? `  class ${kept.join(',')} ${name}` : '';
      }
      if (/^(style|click)\s/.test(trimmed)) { const id = trimmed.split(/\s+/)[1]; return unwritten(id) ? '' : rename.has(id) ? statement.replace(id, rename.get(id)) : statement; }
      if (!trimmed || NOT_A_STATEMENT.test(statement)) return statement;
      const { arrows, groups, restore } = statementParts(trimmed);
      const edges = [];
      groups.forEach((group, index) => {
        for (const [, from] of index > 0 ? groups[index - 1] : []) for (const [, to] of group) edges.push({ from, to, at: ++edge, arrow: arrows[index - 1] ?? '-->' });
      });
      const touched = groups.flat().some(([, id]) => unwritten(id) || rename.has(id)) || edges.some((one) => hide.edges.has(one.at) || hide.words.has(one.at) || hide.plain?.has(one.at));
      if (!touched) return statement;
      const nodes = [...new Map(groups.flat().filter(([, id]) => !unwritten(id)).map(([, id, shape]) => [id, `${end(id)}${restore(shape)}`])).values()];
      // An arrow inside a folded box goes with it; an arrow out of it starts at the box.
      const kept = edges.filter((one) => !hide.nodes.has(one.from) && !hide.nodes.has(one.to) && !hide.edges.has(one.at) && !(into.has(one.from) && into.get(one.from) === into.get(one.to)))
        .map((one) => `${end(one.from)} ${hide.plain?.has(one.at) ? '-->' : hide.words.has(one.at) ? `${bareArrow(restore(one.arrow))}|"${hide.words.get(one.at).replace(/"/g, '#quot;')}"|` : restore(one.arrow).trim()} ${end(one.to)}`);
      return [...nodes, ...kept].map((line) => `  ${line}`).join('\n');
    };
    const written = text.split('\n');
    const boxes = []; // the boxes that a line is in: true when it, or a box around it, is folded
    const lines = written.map((line) => {
      if (/^\s*(flowchart|graph)\b/.test(line)) return line;
      const start = /^(\s*subgraph\s+)([A-Za-z0-9_-]+)?(.*)$/.exec(line);
      if (start) {
        const own = hide.groups?.get(start[2]);
        const around = boxes.includes(true);
        boxes.push(around || !!own?.fold);
        if (around) return '';
        const title = own && `"${own.title.replace(/"/g, '#quot;')}"`;
        return own?.fold ? `  ${start[2]}[${title}]` : own ? `${start[1]}${start[2]}[${title}]` : line;
      }
      if (/^\s*end\s*$/.test(line) && boxes.length) return boxes.pop() ? '' : line;
      if (boxes.includes(true) && /^\s*direction\b/.test(line)) return '';
      return line.split(OUTSIDE_QUOTES).map(rewrite).filter((one, at, all) => one.trim() || all.length === 1).join(';');
    });
    // A group whose statements all went is left out.
    const open = [];
    const gone = new Set();
    lines.forEach((line, at) => {
      if (/^\s*subgraph\b/.test(line)) open.push({ at, full: false });
      else if (/^\s*end\s*$/.test(line) && open.length) { const group = open.pop(); if (!group.full) for (let index = group.at; index <= at; index++) gone.add(index); }
      else if (line.trim() && !/^\s*%%/.test(line)) open.forEach((group) => { group.full = true; });
    });
    return lines.filter((line, at) => !gone.has(at) && (line.trim() || !written[at].trim())).join('\n');
  }

  /**
   * What a flow chart shows in the look: its Mermaid text without the things and arrows whose rule says "shown": false, the arrows with the words that
   * a rule gives them, and the graph and the arrows that are drawn. A diagram of another kind is drawn as it is.
   * `boxes` (boxesOf) give a box new words, or fold it to one node with its arrows; `drawing` (drawingOf) turns a drawn process right or down.
   */
  function shownFlow(diagram, things, edges, boxes = [], drawing = null) {
    const whole = { text: diagram.mermaid, graph: diagram.graph, edges };
    if (!/^\s*(?:flowchart|graph)\b/m.test(diagram.mermaid)) return whole;
    const nodes = new Set(Object.values(things).filter((thing) => thing.slots['show.shown'] === false).map((thing) => thing.node));
    // A box with new words or folded; a node inside a folded box goes into it.
    const groups = new Map();
    const into = new Map();
    for (const box of boxes) {
      const fold = box.slots['show.folded'] === true;
      if (!box.slots.content?.words && !fold) continue;
      groups.set(box.node, { fold, title: box.slots.content?.words ? fillWords(box.slots.content.words, box.fields) : escapeHtml(box.title) });
      if (fold) for (const node of box.nodes) if (!nodes.has(node)) into.set(node, box.node);
    }
    const inside = (one) => into.has(one.from) && into.get(one.from) === into.get(one.to);
    const hidden = new Set(edges.flatMap((one, at) => (one.slots['show.shown'] === false || nodes.has(one.from) || nodes.has(one.to) || inside(one) ? [at] : [])));
    // A branch arrow that a rule leaves out between two steps that follow each other in an opened step stands for their order too: it stays, plain.
    const order = /^process:.+\//.test(diagram.id ?? '') ? Object.keys(diagram.graph.nodes).filter((id) => things[id]?.kind === 'step' && !things[id].fields.quiet) : [];
    const plainArrows = new Set([...hidden].filter((at) => { const one = edges[at]; return one.fields?.is === 'branch' && !nodes.has(one.from) && !nodes.has(one.to) && order.includes(one.from) && order.indexOf(one.to) === order.indexOf(one.from) + 1; }));
    for (const at of plainArrows) hidden.delete(at);
    const words = new Map(edges.flatMap((one, at) => {
      if (plainArrows.has(at)) return [];
      const given = one.slots.content?.words;
      const size = one.slots['text.size'];
      if (!given && (!size || size === 'normal')) return [];
      const shown = given ? fillWords(given, one.fields) : escapeHtml(one.fields?.words ?? one.label ?? '');
      const sized = size && size !== 'normal' ? `<span class='${size === 'small' ? 'lkSmall' : 'lkLarge'}'>${shown}</span>` : shown;
      return [[at, one.order ? `<span class='eo'>${one.order}</span> ${sized}` : sized]]; // the number of an arrow stays before its words
    }));
    const direction = drawing?.slots['layout.direction'];
    if (!nodes.size && !hidden.size && !words.size && !groups.size && !direction && !plainArrows.size) return whole;
    // An arrow with new words is found in the drawing by them (edgeElements in diagram-stage.js).
    const plain = (html) => html.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const worded = (one, at) => (words.has(at) ? { ...one, label: plain(words.get(at)) } : plainArrows.has(at) ? { ...one, label: undefined } : one);
    const moved = (one) => (into.has(one.from) || into.has(one.to) ? { ...one, from: into.get(one.from) ?? one.from, to: into.get(one.to) ?? one.to } : one);
    const kept = (one, at) => !hidden.has(at);
    const text = flowWithout(diagram.mermaid, { nodes, edges: hidden, words, groups, into, plain: plainArrows });
    const folded = [...groups].filter(([, group]) => group.fold).map(([id, group]) => [id, plain(group.title)]);
    return {
      text: direction ? text.replace(/^(\s*(?:flowchart|graph))\s+(?:LR|RL|TB|TD|BT)\b/m, `$1 ${direction === 'down' ? 'TB' : 'LR'}`) : text,
      graph: { nodes: Object.fromEntries([...Object.entries(diagram.graph.nodes).filter(([key]) => !nodes.has(key) && !into.has(key)), ...folded]), edges: diagram.graph.edges.map(worded).map(moved).filter(kept) },
      edges: edges.map(worded).map(moved).filter(kept),
    };
  }

  /**
   * The boxes of a flow chart for the look (its subgraphs): an area box of a diagram of the map, a file box of a drawn process. Each with its id as
   * `node`, its title, its nodes, its paths (the paths of its nodes; of a file box its file), its fields, and the slots that the rules give it.
   */
  function boxesOf(diagram, look) {
    if (!/^\s*(?:flowchart|graph)\b/m.test(diagram.mermaid ?? '')) return [];
    const file = diagram.id?.startsWith('process:');
    return groupsOf(diagram.mermaid).filter((group) => !/^col\d+$/.test(group.id)).map((group) => { // not the boxes of the columns of a long chain
      const own = group.nodes.map((node) => diagram.nodes?.[node]).filter(Boolean);
      const fields = file ? { path: group.title, name: group.title.split('/').pop(), steps: own.filter((node) => node.kind === 'step').length } : { title: group.title, nodes: group.nodes.length };
      const paths = file ? [group.title] : [...new Set(own.flatMap((node) => node.paths.map((one) => one.path)))];
      const box = { kind: file ? 'file-box' : 'area-box', diagram: diagram.id, node: group.id, title: group.title, nodes: group.nodes, paths, fields };
      box.slots = resolve(look.rules, box, look.one);
      return box;
    });
  }

  /** A drawn process as a whole, for the look: its level (the processes of a place, one process, or a step opened) and its slots. Null for a diagram of the map. */
  function drawingOf(diagram, look) {
    const id = diagram.id ?? '';
    const level = id.startsWith('processes:') ? 'processes' : !id.startsWith('process:') ? null : id.includes('/') ? 'step' : 'process';
    if (!level) return null;
    const thing = { kind: 'process-drawing', diagram: id, paths: [...new Set(Object.values(diagram.nodes ?? {}).flatMap((node) => node.paths.map((one) => one.path)))], fields: { level } };
    return { ...thing, slots: resolve(look.rules, thing, look.one) };
  }

  /**
   * A drawn process in which each step that a rule opens ("show": { "folded": false }) is a box of its inner steps, in place, one level deep: its inner
   * steps and the arrows between them, with ids "<step>_<id>". The quiet boxes and calls of the inner drawing stay out: the arrows of the step keep
   * going to its box. `find(id)` gives a drawing by its id. Returns the diagram itself when no step opens.
   */
  function openSteps(diagram, look, find) {
    const things = thingsOf(diagram, look);
    const open = Object.values(things).filter((thing) => thing.kind === 'step' && thing.slots['show.folded'] === false && find(diagram.nodes[thing.node].down ?? ''));
    if (!open.length) return diagram;
    const lines = diagram.mermaid.split('\n');
    const after = []; // the arrows inside the boxes, at the end of the text, so that the arrows of the diagram keep their numbers
    const opened = { ...diagram, nodes: { ...diagram.nodes }, graph: { nodes: { ...diagram.graph.nodes }, edges: [...diagram.graph.edges] }, edgeLines: { ...(diagram.edgeLines ?? {}) } };
    for (const thing of open) {
      const inner = find(diagram.nodes[thing.node].down);
      const kept = Object.keys(inner.nodes).filter((id) => inner.nodes[id].kind === 'step' && !inner.nodes[id].quiet);
      const rename = new Map(kept.map((id) => [id, `${thing.node}_${id}`]));
      const text = flowWithout(inner.mermaid, { nodes: new Set(Object.keys(inner.nodes).filter((id) => !rename.has(id))), edges: new Set(), words: new Map(), rename });
      const statements = text.split('\n').slice(1).filter((line) => line.trim() && !/^\s*(classDef|class)\b/.test(line));
      const declared = statements.filter((line) => !statementParts(line.trim()).arrows.length && !/^\s*[\w-]+\s*$/.test(line)); // not the bare ids before its arrows
      after.push(...statements.filter((line) => statementParts(line.trim()).arrows.length));
      const at = lines.findIndex((line) => { const parts = statementParts(line.trim()); return !parts.arrows.length && parts.groups.flat().some(([, id]) => id === thing.node); });
      const title = escapeHtml(thing.fields.title).replace(/"/g, '#quot;');
      const indent = /^\s*/.exec(lines[at] ?? '')[0];
      if (at >= 0) lines.splice(at, 1, `${indent}subgraph ${thing.node}["${title}"]`, ...declared.map((line) => `${indent}${line}`), `${indent}end`);
      for (const id of kept) { opened.nodes[rename.get(id)] = inner.nodes[id]; opened.graph.nodes[rename.get(id)] = inner.graph.nodes[id] ?? id; }
      delete opened.graph.nodes[thing.node];
      opened.graph.edges.push(...inner.graph.edges.filter((one) => rename.has(one.from) && rename.has(one.to)).map((one) => ({ ...one, from: rename.get(one.from), to: rename.get(one.to) })));
      for (const [key, starts] of Object.entries(inner.edgeLines ?? {})) {
        const [from, to] = key.split('>');
        if (rename.has(from) && rename.has(to)) opened.edgeLines[`${rename.get(from)}>${rename.get(to)}`] = starts;
      }
    }
    return { ...opened, mermaid: [...lines, ...after].join('\n') };
  }

  /** The end of an arrow as the look gives it: "none" takes its head away, "dot" puts Mermaid's dot in its place. Returns the new marker-end, or null for none. */
  const headOf = (marker, head) => (head === 'none' ? null : head === 'dot' ? marker.replace(/pointEnd/, 'circleEnd') : marker);

  /**
   * A line of words of a page in the look (a step of the trail, the header line, the count line, a line under a panel): the words of the rule with the
   * fields in braces, an icon before them, their colour, or a picture in place of the line; `text` (plain words) when no rule gives words. Null when a
   * rule leaves the line out. The words of the rule are escaped as the words of the repo are.
   */
  function wordsHtml(text, slots, fields, look) {
    if (slots['show.shown'] === false) return null;
    const picture = look.files[slots.content?.picture];
    if (picture) return `<img class="lk-picture" src="${escapeHtml(picture).replace(/"/g, '&quot;')}" alt="${escapeHtml(text).replace(/"/g, '&quot;')}">`;
    const icon = look.files[slots['text.icon']]; // the same icon before words as paintText() puts on an element
    const words = `${icon ? `<img class="lk-icon" src="${escapeHtml(icon).replace(/"/g, '&quot;')}" alt="">` : ''}${slots.content?.words !== undefined ? fillWords(escapeHtml(slots.content.words), fields) : escapeHtml(text)}`;
    const colors = slots['text.color'] && lineColors(slots['text.color'], READS);
    return colors ? `<span class="lk-words" style="--lk-words-l:${colors.light};--lk-words-d:${colors.dark}">${words}</span>` : words;
  }

  // ----- where a click goes: the words of a target -----

  // The titles of the pages of the look, by id, for the words of a target "page" (the page sets them from its data: setPages).
  const pageTitles = {};
  const setPages = (pages = []) => { for (const page of pages) pageTitles[page.id] = page.title; };

  /** What a target does, in one line: the pointer says it before a click. */
  const targetWords = (target) => (!target ? 'Does nothing.'
    : target.url ? `Opens ${target.url}, after VS Code asks.`
    : target.file ? `Opens ${target.file}${target.line ? ` at line ${target.line}` : ''}.`
    : target.command ? `Runs the command ${target.command}.`
    : target.place ? `Opens ${target.place.diagram}${target.place.node ? ` at its node ${target.place.node}` : ''} on Home.`
    : target.graphs ? `Opens the graphs of ${target.graphs}.`
    : target.folder ? `Shows ${target.folder} in the tree "Files".`
    : target.change ? `Opens the change of the branch ${target.change}${target.part ? ` at its part ${target.part}` : ''}.`
    : target.pull ? `Opens pull request #${target.pull}.`
    : target.comment ? 'Opens a comment box on it.'
    : target.window ? `Opens a window${target.window.title ? ` "${target.window.title}"` : ''} beside it.`
    : target.page ? `Opens the page "${pageTitles[target.page] ?? target.page}".`
    : `Sends this to the agent of the repo, after VS Code asks: "${target.prompt}"`);

  /** One line for the click and each other input of a thing that a rule gives: "Click: Opens …", "Alt+click: …", "Key G: …", "Right click: 2 entries". */
  function inputWords(slots) {
    const lines = [];
    if (slots.click) lines.push(`Click: ${targetWords(slots.click)}`);
    for (const [field, name] of [['alt', 'Alt+click'], ['shift', 'Shift+click'], ['double', 'Double click']]) if (slots[`input.${field}`]) lines.push(`${name}: ${targetWords(slots[`input.${field}`])}`);
    for (const [key, target] of Object.entries(slots['input.key'] ?? {})) lines.push(`Key ${key.toUpperCase()}: ${targetWords(target)}`);
    const menu = slots['input.menu'];
    if (menu?.length) lines.push(`Right click: ${menu.length === 1 ? '1 entry' : `${menu.length} entries`}`);
    return lines;
  }

  // ----- the window of the pointer, from named sections -----

  /**
   * A window of the pointer from named sections, in the order and at the width that the rule of the thing gives (`slots`: "window.sections",
   * "window.width"); a section that the rule does not name is not shown. A section is { id, html, sub, ready }: `sub` goes into the quiet line of the
   * title. `wrap` puts the sections into their frame; the lines of what a click and other input do come first. nodeWindow, noteWindow and stackWindow use it.
   */
  function windowOf({ title, sub = '', width, sections, wrap = (inner) => inner, ready }, slots = {}) {
    const order = slots['window.sections'];
    const shown = order ? order.map((id, at) => (id && typeof id === 'object' ? ownSection(id, at) : sections.find((one) => one.id === id))).filter(Boolean) : sections;
    const does = inputWords(slots);
    const lines = does.length ? `<div class="lk-does">${does.map((line) => `<p>${escapeHtml(line).replace(/"/g, '&quot;')}</p>`).join('')}</div>` : '';
    // The sections of today stand in their frame (`wrap`); a section of its own stands outside it, at its place among them.
    const runs = [];
    for (const one of shown) {
      if (one.own) runs.push(one);
      else if (runs.length && !runs.at(-1).own) runs.at(-1).list.push(one);
      else runs.push({ list: [one] });
    }
    if (!runs.some((run) => !run.own)) runs.unshift({ list: [] }); // the frame is there also with no section of today in it
    return {
      title, width: slots['window.width'] ?? width, ids: shown.map((one) => one.id),
      sub: [sub, ...shown.map((one) => one.sub)].filter(Boolean).join(' · '),
      body: `${lines}${runs.map((run) => (run.own ? run.html : wrap(run.list.map((one) => one.html ?? '').join('')))).join('')}`,
      ready: async (body) => { for (const one of shown) await one.ready?.(body); await ready?.(body); },
    };
  }

  /**
   * A section of its own in a window (build 58): its quiet title, and its blocks, which the page asks for when the window opens and Blocks draws
   * (media/blocks.js). `section.ref` names the blocks; the page carries no blocks before that.
   */
  function ownSection(section, at) {
    const titleHtml = section.title ? `<div class="bk-sectitle">${escapeHtml(section.title)}</div>` : '';
    return {
      id: `own-${at}`, own: true,
      html: `<div class="bk-sec" data-bk-own="${at}">${titleHtml}<div class="bk-hold"></div></div>`,
      ready: (body) => (typeof Blocks === 'object' ? Blocks.fill(body.querySelector(`[data-bk-own="${at}"] .bk-hold`), section.ref) : undefined),
    };
  }

  // ----- the roll-up -----

  const SHOWN = 3; // chips in a stack, then "+n"

  /** How many things of a drawing hold each value: a value that few things hold tells them apart. */
  function spreadOf(things) {
    const spread = {};
    for (const thing of things) for (const key of new Set((thing.marks ?? []).map(keyOf))) spread[key] = (spread[key] ?? 0) + 1;
    return spread;
  }

  /** The values of one set among marks, each with its marks: the values that few things hold first, so that the shared ones fold into "+n" first. */
  function stackOf(marks, set, spread = {}) {
    const byValue = new Map();
    for (const mark of marks) if (mark.set === set) byValue.set(mark.value, [...(byValue.get(mark.value) ?? []), mark]);
    return [...byValue].map(([value, own]) => ({ key: `${set}:${value}`, set, value, marks: own }))
      .sort((a, b) => (spread[a.key] ?? 0) - (spread[b.key] ?? 0) || a.value.localeCompare(b.value));
  }

  /** The named things of marks, once each, in their order, with the marks of each; and the marks with no fixed name. */
  function namedThings(marks) {
    const named = new Map();
    for (const mark of marks) if (mark.thing) named.set(mark.thing.name, [...(named.get(mark.thing.name) ?? []), mark]);
    return { named: [...named].map(([name, own]) => ({ name, kind: own[0].thing.kind, marks: own })), plain: marks.filter((mark) => !mark.thing) };
  }

  // ----- colours -----

  const READS = 4.5; // the contrast that words need
  const INK = { light: [31, 35, 40], dark: [232, 234, 237] };
  const PAPER = { light: [255, 255, 255], dark: [24, 24, 27] };
  const parse = (hex) => {
    const six = hex.length === 4 ? [...hex.slice(1)].map((one) => one + one).join('') : hex.slice(1);
    return [0, 2, 4].map((at) => parseInt(six.slice(at, at + 2), 16));
  };
  const toHex = (rgb) => `#${rgb.map((part) => Math.round(Math.max(0, Math.min(255, part))).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, share) => a.map((part, at) => part * (1 - share) + b[at] * share); // `share` of b
  const luminance = (rgb) => rgb.map((part) => { const c = part / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, at) => sum + c * [0.2126, 0.7152, 0.0722][at], 0);
  const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

  /**
   * The colours of a box from the one colour of a rule, for both themes: a soft fill of it with the colour as its line in a light theme, a deep fill
   * with a lighter line in a dark theme, and the words in dark or light ink, whichever reads. A fill whose words would not read at 4.5:1 moves toward
   * the paper until they do; when no step reads, null: the box keeps the colours of the theme.
   */
  function boxColors(hex) {
    const base = parse(hex);
    const theme = (fill, line, paper) => {
      for (let step = 0; step <= 10; step++) {
        const at = mix(fill, paper, step / 10);
        const ink = contrast(at, INK.light) >= contrast(at, INK.dark) ? INK.light : INK.dark;
        if (contrast(at, ink) >= READS) return { fill: toHex(at), line: toHex(line), text: toHex(ink) };
      }
      return null;
    };
    const light = theme(mix(base, PAPER.light, 0.82), base, PAPER.light);
    const dark = theme(mix(base, PAPER.dark, 0.68), mix(base, PAPER.light, 0.3), PAPER.dark);
    return light && dark ? { light, dark } : null;
  }

  /**
   * A colour of a line (an arrow, the bar of a note, the line of a box) for both themes: moved toward black or white until it stands out from the paper
   * at 3:1; words (`need` 4.5) until they read.
   */
  function lineColors(hex, need = 3) {
    const base = parse(hex);
    const stand = (paper, toward) => {
      for (let step = 0; step <= 10; step++) { const at = mix(base, toward, step / 10); if (contrast(at, paper) >= need) return toHex(at); }
      return toHex(toward);
    };
    return { light: stand(PAPER.light, [0, 0, 0]), dark: stand(PAPER.dark, [255, 255, 255]) };
  }

  // ----- the things of the page of a change and of a file tab (build 60): what a rule picks there, with their fields -----

  const DATA_FILE = /\.(json|csv|tsv|lock)$|(^|\/)(go\.sum|[^/]*-lock\.ya?ml)$/i; // data files: the list of diffs folds them
  const POINT_TYPES = { 'note-not-supported': 'note', 'no-note': 'no-note', 'thing-not-supported': 'thing' };
  const states =() => (typeof States === 'object' ? States : require('./states.js')); // the state words; the tests read this part in Node

  /** The slots that the look gives a thing; none with no look. */
  const slotsIn = (look, thing) => (look ? resolve(look.rules, thing, look.one) : {});

  /** The remarks grouped by thread, in the order of their first remark. */
  function threadsOf(remarks) {
    const groups = new Map();
    for (const remark of [...remarks].sort((a, b) => a.id - b.id)) groups.set(remark.thread ?? remark.id, [...(groups.get(remark.thread ?? remark.id) ?? []), remark]);
    return [...groups.values()];
  }

  /** A thread of comments as a thing: its state in one word, the name of its place, and who wrote it (the page keeps the comments of its owner only). */
  const threadThing = (thread) => ({
    kind: 'thread', id: thread[0].id, paths: thread[0].target.file ? [thread[0].target.file] : [],
    fields: { state: states().threadState(thread), where: thread[0].target.label ?? thread[0].target.kind, author: 'you' },
  });

  /** An open point as a thing: its type, its file, its part and its diagram. */
  const pointThing = (point, page) => ({
    kind: 'open-point', id: point.id, paths: point.file ? [point.file] : [], ...(point.diagram ? { diagram: point.diagram } : {}),
    fields: { type: POINT_TYPES[point.kind] ?? 'thing', file: point.file ?? '', part: point.part ?? page.parts.find((part) => part.files.includes(point.file))?.id ?? '', diagram: point.diagram ?? '' },
  });

  /**
   * The steps of the drawing of a part as things, by node id: each with the files of its places, its counts, and the marks inside its lines (build 63).
   * A step holds a mark as a step of a drawn process does (holds), by the lines of its places in the files as the change has them (`now`); a place of a
   * whole file holds all of the file, a removed place nothing. Only a flow chart: in a sequence, a schema or a state diagram no box stands for lines of code.
   */
  const stepThings = (diagram, marks = []) => Object.fromEntries(Object.entries(diagram.graph?.nodes ?? {}).map(([key, label]) => {
    const code = diagram.code?.[key];
    const places = code?.places ?? [];
    const paths = [...new Set(places.map((place) => place.file))];
    const at = places.filter((place) => !place.removed).map((place) => ({ file: place.file, from: place.lines?.[0] ?? 1, to: place.lines?.[1] ?? Infinity }));
    const thing = { kind: 'part-step', diagram: diagram.id, node: key, paths, now: true, at, fields: { title: plainText(label), added: code?.counts?.added ?? 0, removed: code?.counts?.removed ?? 0 } };
    return [key, { ...thing, marks: diagram.kind === 'flow' ? marksIn(thing, marks) : [] }];
  }));

  /** A diagram of a part as a thing: its id, its kind, its function and its title; its paths are its file, or the files of its part. */
  const diagramThing = (diagram, page) => ({
    kind: 'part-diagram', id: diagram.id, diagram: diagram.id, paths: diagram.file ? [diagram.file] : page.parts.find((part) => part.id === diagram.part)?.files ?? [],
    fields: { id: diagram.id, type: diagram.kind, function: diagram.symbol ?? '', title: diagram.title },
  });

  /**
   * The things of the page of a change of one kind, or of every kind, from its data (view/page-data.ts): the card, the parts, the box of the files in no
   * part, the links between parts, the files of the list of diffs, the views, the diagrams of the parts and their steps, the comments window, the threads,
   * the open points and the comment marks (one for each place with open threads). Each with its kind, its id, its paths and its fields. Worked out each time:
   * a page changes its data in place. A part holds the marks under its files, as a node of Home holds those under its paths, and a step of a flow chart
   * those inside its lines (build 63); `marks` are those of the files of the change, from the look of the page.
   */
  function changeThings(page, kind, marks = page.look?.marks ?? []) {
    const fileOf = (path) => page.files.find((file) => file.path === path);
    const counts = (paths) => Object.fromEntries(['added', 'removed'].map((key) => [key, paths.reduce((sum, path) => sum + (fileOf(path)?.[key] ?? 0), 0)]));
    const parts = () => page.parts.map((part) => {
      const thing = { kind: 'part', id: part.id, paths: part.files, fields: { id: part.id, name: part.name, files: part.files.length, ...counts(part.files) } };
      return { ...thing, marks: marksIn(thing, marks) };
    });
    const open = () => threadsOf(page.remarks ?? []).filter((thread) => states().threadState(thread) !== 'resolved');
    const placeOf = (thread) => thread[0].target.label ?? thread[0].target.kind;
    const generated = new Set(page.checks.generated);
    const kinds = {
      'change-card': () => [{ kind: 'change-card', paths: page.files.map((file) => file.path), fields: { title: page.title, files: page.files.length, ...counts(page.files.map((file) => file.path)), checked: !!page.linksChecked, wider: page.diagrams.filter((one) => one.broad).length } }],
      part: parts,
      'no-part': () => (page.checks.filesInNoPart.length ? [{ kind: 'no-part', paths: page.checks.filesInNoPart, fields: { files: page.checks.filesInNoPart.length } }] : []),
      'part-link': () => { const all = parts(); return page.links.map((link, at) => ({
        kind: 'part-link', id: `link:${at}`, ends: [link.from, link.to].map((id) => all.find((one) => one.id === id)).filter(Boolean),
        fields: { words: link.label ?? '', added: link.code?.counts?.added ?? 0, removed: link.code?.counts?.removed ?? 0 },
      })); },
      'diff-file': () => page.files.map((file) => ({
        kind: 'diff-file', id: file.path, paths: [file.path],
        fields: { path: file.path, part: page.parts.find((part) => part.files.includes(file.path))?.id ?? '', type: generated.has(file.path) ? 'generated' : DATA_FILE.test(file.path) ? 'data' : 'code', added: file.added, removed: file.removed },
      })),
      'change-view': () => ['diagram', 'diffs', 'conversation'].map((id) => ({ kind: 'change-view', id, fields: { id } })),
      'part-diagram': () => page.diagrams.filter((one) => !one.broad && one.part).map((diagram) => diagramThing(diagram, page)),
      'part-step': () => page.diagrams.filter((one) => !one.broad && one.part).flatMap((diagram) => Object.values(stepThings(diagram, marks))),
      'comments-window': () => [{ kind: 'comments-window', fields: {} }],
      thread: () => threadsOf(page.remarks ?? []).map(threadThing),
      'open-point': () => (page.openPoints ?? []).map((point) => pointThing(point, page)),
      'comment-mark': () => [...new Set(open().map(placeOf))].map((place) => ({ kind: 'comment-mark', fields: { count: open().filter((thread) => placeOf(thread) === place).length } })),
    };
    return kind ? kinds[kind]?.() ?? [] : Object.values(kinds).flatMap((build) => build());
  }

  /** A thing at lines of a file of a file tab: the line of a note, the first line of a function, the margin at a line. Its marks are those at its lines. */
  function lineThing(kind, path, [from, to], marks, fields = {}) {
    const thing = { kind, now: true, paths: [path], at: [{ file: path, from, to }], fields };
    thing.marks = marksIn(thing, marks);
    return thing;
  }

  /** The lines of a file with marks, each as a thing of the margin of the code (or of `kind`, the code map): [line, thing], at most `most` lines, the first ones. */
  function marginThings(path, marks, most = 200, kind = 'margin') {
    const lines = [...new Set(marks.filter((mark) => mark.file === path).map((mark) => mark.at))].sort((a, b) => a - b).slice(0, most);
    return lines.map((line) => [line, lineThing(kind, path, [line, line], marks)]);
  }

  /**
   * The icon in the margin of the code at each line of a file whose rule shows it, [line, "<set>:<value>"]: the first value of the stack there, the
   * sets in the order of the look and in a set the values that fewer lines hold first, as on a node. The one rule of the margin, for the file tab
   * (code-notes.js) and for VS Code's editor and each side of a diff (view/look-of-vscode.ts). `marks` have their line now in that text (`at`).
   */
  function marginIcons(look, path, marks) {
    const shown = marginThings(path, marks).filter(([, thing]) => slotsIn(look, thing)['show.shown'] === true);
    const spread = spreadOf(shown.map(([, thing]) => thing));
    return shown.map(([line, thing]) => {
      const set = look.sets.find((one) => thing.marks.some((mark) => mark.set === one.id))?.id ?? thing.marks[0].set;
      return [line, stackOf(thing.marks, set, spread)[0].key];
    });
  }

  /**
   * The things of the file tab of one file, for the count of set-look: from its notes in the order of their lines and its marks with their lines now.
   * The page builds the same things one by one where it draws them (code-notes.js).
   */
  function fileThings(path, notes, marks, tests = () => 0) {
    const things = [{ kind: 'code-map', paths: [path], marks: marks.filter((mark) => mark.file === path), fields: {} }, ...marginThings(path, marks).map(([, thing]) => thing)];
    if (notes.length) things.push({ kind: 'notes-column', paths: [path], fields: {} });
    notes.forEach((note, index) => {
      things.push(lineThing('note-line', path, note.lines, marks));
      if (note.symbol && notes.findIndex((other) => other.symbol === note.symbol) === index) things.push(lineThing('function-line', path, note.lines, marks, { function: note.symbol, tests: tests(note.symbol) }));
      if (index && note.symbol && notes[index - 1].symbol === note.symbol) things.push(lineThing('note-order', path, note.lines, marks));
    });
    return things;
  }

  /** The order of a list from the rules of its rows: each field of "order" that a rule gives a row of it, the first row that has it. For orderRows. */
  function listOrder(rows, look) {
    const order = {};
    for (const row of rows) for (const [slot, value] of Object.entries(slotsIn(look, row))) if (slot.startsWith('order.') && !(slot.slice(6) in order)) order[slot.slice(6)] = value;
    return order;
  }

  /** The rows of a list that the look shows, in the order that it gives them (no groups): the views of a switch, the diagrams of a part. */
  const shownInOrder = (rows, look) => (look ? orderRows(rows.filter((row) => slotsIn(look, row)['show.shown'] !== false), listOrder(rows, look))[0].rows : rows);

  const pure = {
    covers, keyOf, holds, marksIn, picks, rankOf, resolve, fieldsOf, fillText, fillWords, orderRows, thingsOf, edgesOf, flowWithout, shownFlow, targetWords, inputWords, windowOf, setPages,
    spreadOf, stackOf, namedThings, boxColors, lineColors, contrast, parse, SHOWN, READS,
    flowArrows, groupsOf, boxesOf, drawingOf, openSteps, headOf, wordsHtml,
    DATA_FILE, slotsIn, threadsOf, threadThing, pointThing, stepThings, diagramThing, changeThings, lineThing, marginThings, fileThings, listOrder, shownInOrder,
    marginIcons,
  };
  if (typeof window !== 'object') return pure;

  // ----- drawing: the shapes and the contents of nodes, before Mermaid draws -----

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const FILL = new Map(); // an icon (its address) -> true when it fills its square: it is drawn to the edge of a rounded square
  const SIZES = new Map(); // a picture or a film (its address) -> its size, or null when it does not load
  const MOST = { width: 180, height: 120 }; // a picture or a film in place of a node fits this box
  const quote = (text) => String(text).replace(/"/g, '#quot;');

  /** The size of a picture or a film, scaled down to fit MOST; null when the file does not load, so that the node keeps the default box. */
  function sizeOf(address, film) {
    if (!SIZES.has(address)) {
      SIZES.set(address, new Promise((done) => {
        const fit = (width, height) => { const scale = Math.min(1, MOST.width / width, MOST.height / height); return { width: Math.round(width * scale), height: Math.round(height * scale) }; };
        const late = setTimeout(() => done(null), 4000);
        if (film) {
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.muted = true;
          video.onloadedmetadata = () => { clearTimeout(late); done(video.videoWidth ? fit(video.videoWidth, video.videoHeight) : null); };
          video.onerror = () => { clearTimeout(late); done(null); };
          video.src = address;
        } else {
          const image = new Image();
          image.onload = () => { clearTimeout(late); done(image.naturalWidth ? fit(image.naturalWidth, image.naturalHeight) : null); };
          image.onerror = () => { clearTimeout(late); done(null); };
          image.src = address;
        }
      }));
    }
    return SIZES.get(address);
  }

  // The smallest picture that Mermaid's picture shape takes; Apostil puts the real file in after Mermaid draws, never into the text.
  const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  /**
   * The Mermaid text of a diagram in the look: a flow chart without the things that a rule leaves out (shownFlow), with the shapes, the words, the
   * sizes and the icons that the rules give its nodes added at its end. A picture or a film is a picture shape of its size with a blank picture,
   * filled after the drawing; an icon is a place of its size before the words, filled after the drawing too. Returns the text, the nodes to fill,
   * and the graph and the arrows that are drawn.
   */
  async function lookText(diagram, things, edges, look) {
    const boxes = boxesOf(diagram, look);
    const shown = shownFlow(diagram, things, edges, boxes, drawingOf(diagram, look));
    if (!/^\s*(?:flowchart|graph)\b/m.test(shown.text)) return { ...shown, filled: {}, boxes };
    const lines = [];
    const filled = {};
    const classes = { lkSmall: [], lkLarge: [], lkIcon: [] };
    for (const [node, thing] of Object.entries(things)) {
      const slots = thing.slots;
      if (slots['show.shown'] === false || !(node in shown.graph.nodes)) continue; // left out, inside a folded box, or opened as a box
      if (slots['box.shape']) lines.push(`  ${node}@{ shape: ${slots['box.shape']} }`);
      const content = slots.content;
      const count = thing.count?.slots ?? {};
      if (Object.keys(count).length) {
        // The count line of the look under the title (or the words of the step), or none.
        const title = content?.words ? fillWords(content.words, thing.fields) : escapeHtml((diagram.graph.nodes[node] ?? node).replace(/\s+\d+ steps?$/, ''));
        const steps = thing.count.fields.steps;
        const line = count['show.shown'] === false ? '' : `<br><i class='ns'>${count.content?.words ? fillWords(count.content.words, thing.count.fields) : `${steps} ${steps === 1 ? 'step' : 'steps'}`}</i>`;
        lines.push(`  ${node}@{ label: "${quote(title + line)}" }`);
      } else if (content?.words) lines.push(`  ${node}@{ label: "${quote(fillWords(content.words, thing.fields))}" }`);
      const file = content && (content.picture ?? content.film);
      const address = file && look.files[file];
      const size = address && await sizeOf(address, !!content.film);
      if (size) {
        lines.push(`  ${node}@{ img: "${BLANK}", label: "${quote(diagram.graph.nodes[node] ?? node)}", pos: "b", w: ${size.width}, h: ${size.height} }`);
        filled[node] = { address, film: !!content.film, ...size };
      }
      if (slots['text.size'] === 'small' || slots['text.size'] === 'large') classes[slots['text.size'] === 'small' ? 'lkSmall' : 'lkLarge'].push(node);
      if (look.files[slots['text.icon']]) classes.lkIcon.push(node);
    }
    for (const [name, nodes] of Object.entries(classes)) if (nodes.length) lines.push(`  class ${nodes.join(',')} ${name}`);
    return { ...shown, text: lines.length ? `${shown.text}\n${lines.join('\n')}` : shown.text, filled, boxes };
  }

  // ----- drawing: after Mermaid -----

  /** The shape of a drawn node, without its label: what a colour paints and where a corner stands. */
  const shapeOf = (g) => g.querySelector(':scope > .label-container, :scope > image, :scope > g > image') ?? g.querySelector(':scope > :is(rect, polygon, path, circle, ellipse)');

  /** The box of a node's shape in the space of the node itself. */
  function boxOf(g) {
    const shape = shapeOf(g);
    const toNode = shape && g.getScreenCTM()?.inverse().multiply(shape.getScreenCTM());
    if (!toNode) return g.getBBox();
    const own = shape.getBBox();
    const [a, b] = [new DOMPoint(own.x, own.y).matrixTransform(toNode), new DOMPoint(own.x + own.width, own.y + own.height).matrixTransform(toNode)];
    return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
  }

  /** Colours on an element by name, for both themes: look.css takes the light or the dark one, and a high-contrast theme keeps its own. */
  function paint(el, name, pair) {
    if (!pair) return;
    el.style.setProperty(`--lk-${name}-l`, pair.light);
    el.style.setProperty(`--lk-${name}-d`, pair.dark);
    el.classList.add(`lk-${name}`);
  }

  /** The box slots of a node: its colour (fill, line and words), its line colour, its line width and a dashed line. */
  function paintBox(g, slots) {
    const colors = slots['box.color'] && boxColors(slots['box.color']);
    if (colors) {
      paint(g, 'fill', { light: colors.light.fill, dark: colors.dark.fill });
      paint(g, 'ink', { light: colors.light.text, dark: colors.dark.text });
      paint(g, 'line', { light: colors.light.line, dark: colors.dark.line });
    }
    if (slots['box.line']) paint(g, 'line', lineColors(slots['box.line']));
    if (slots['box.width']) g.style.setProperty('--lk-width', `${slots['box.width']}px`);
    if (slots['box.dashed']) g.classList.add('lk-dashed');
    if (slots['box.width']) g.classList.add('lk-wide');
  }

  /** Puts a picture or a film in place of the blank picture of a node. A film shows its first frame with a play mark and plays, with no sound, only on a click. */
  function fill(g, content) {
    const image = g.querySelector('image');
    if (!image) return;
    if (!content.film) return void image.setAttribute('href', content.address);
    const holder = document.createElementNS(SVG_NS, 'foreignObject');
    for (const name of ['x', 'y', 'width', 'height', 'transform']) if (image.hasAttribute(name)) holder.setAttribute(name, image.getAttribute(name));
    holder.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="lk-film"><video muted playsinline preload="metadata" src="${esc(content.address)}"></video><button class="lk-play" title="Play the film" aria-label="Play the film"></button></div>`;
    image.replaceWith(holder);
    const [video, play] = [holder.querySelector('video'), holder.querySelector('.lk-play')];
    play.addEventListener('click', (event) => { event.stopPropagation(); video.play(); play.hidden = true; });
    video.addEventListener('ended', () => { play.hidden = false; });
    video.addEventListener('click', (event) => { if (!video.paused) { event.stopPropagation(); video.pause(); play.hidden = false; } });
  }

  /**
   * Whether an icon fills its square to its corners, read once from its pixels: such an icon is drawn to the edge of a rounded square. Until it is
   * known the chip is round; when it is known, every chip of that icon on the page takes its form.
   */
  function fillsSquare(address) {
    if (FILL.has(address)) return FILL.get(address);
    FILL.set(address, undefined);
    const image = new Image();
    image.onload = () => {
      let square = false;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 16;
        const draw = canvas.getContext('2d', { willReadFrequently: true });
        draw.drawImage(image, 0, 0, 16, 16);
        square = [[0, 0], [15, 0], [0, 15], [15, 15]].every(([x, y]) => draw.getImageData(x, y, 1, 1).data[3] > 200);
      } catch { /* a picture that cannot be read stays round */ }
      FILL.set(address, square);
      if (square) for (const img of document.querySelectorAll('.mk-chip img')) if (img.getAttribute('src') === address) img.parentElement.classList.add('square');
    };
    image.src = address;
    return undefined;
  }

  /** One chip: the icon of a value on a small light round chip, or to the edge of a rounded square when the icon fills its square; a letter when it has none. */
  function chipHtml(look, key) {
    const value = look.values[key] ?? { name: key.split(':')[1] };
    if (!value.icon) return `<span class="mk-chip letter" data-mk="${esc(key)}">${esc((value.name[0] ?? '?').toUpperCase())}</span>`;
    return `<span class="mk-chip${fillsSquare(value.icon) ? ' square' : ''}" data-mk="${esc(key)}"><img src="${esc(value.icon)}" alt=""></span>`;
  }

  /** The HTML of a stack: at most three chips, then "+n". */
  function stackHtml(look, stack) {
    const chips = stack.slice(0, SHOWN).map((one) => chipHtml(look, one.key));
    return `${chips.join('')}${stack.length > SHOWN ? `<span class="mk-more">+${stack.length - SHOWN}</span>` : ''}`;
  }

  /** A holder of HTML at a place of a drawing: a stack at a corner, or a mark on the label of an arrow. `x` is its right edge when `right`. */
  function holderAt(parent, x, y, right) {
    const holder = document.createElementNS(SVG_NS, 'foreignObject');
    const [width, height] = [160, 24];
    holder.setAttribute('x', right ? x - width : x);
    holder.setAttribute('y', y - height / 2);
    holder.setAttribute('width', width);
    holder.setAttribute('height', height);
    holder.setAttribute('class', 'mk-holder');
    holder.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="mk-stack${right ? ' right' : ''}"></div>`;
    parent.append(holder);
    return holder.firstChild;
  }

  const relationWords = { calls: 'calls it', stores: 'keeps data in it', sends: 'sends to it', 'runs on': 'runs on it' };
  const placesWord = (count) => `${count} ${count === 1 ? 'place' : 'places'}`;
  const baseName = (path) => path.split('/').pop();

  /** What the code does with a value, from the relations of its marks: "keeps data in it", "calls it and sends to it". */
  const doesWords = (marks) => [...new Set(marks.map((mark) => relationWords[mark.relation]).filter(Boolean))].join(' and ');

  /** The window of a stack: each value with its count of places, what the code does with it, and its named things (2, then "+n"). A click on a row is a click on that value. */
  function stackWindow(look, stack, setName) {
    const rows = stack.map((one) => {
      const { named } = namedThings(one.marks);
      const things = named.length ? ` · ${named.slice(0, 2).map((thing) => esc(thing.name)).join(', ')}${named.length > 2 ? ` +${named.length - 2}` : ''}` : '';
      const does = doesWords(one.marks);
      return `<a class="mk-row" data-mk-value="${esc(one.key)}">${chipHtml(look, one.key)}<span class="mk-name">${esc(look.values[one.key]?.name ?? one.value)}</span>`
        + `<i class="c">${placesWord(one.marks.length)}</i><span class="mk-does">${esc(does)}${things}</span></a>`;
    });
    return windowOf({ title: setName, sub: `${stack.length} ${stack.length === 1 ? 'value' : 'values'}`, width: 440, sections: [{ id: 'values', html: `<div class="rows mk-rows">${rows.join('')}</div>` }] });
  }

  /** The places of one value, grouped by named thing, then the places with no fixed name. A click on a row opens that file at its line. */
  function placesHtml(marks) {
    const row = (mark) => `<a data-mk-open="${esc(mark.file)}" data-mk-line="${mark.at}"><span>${esc(baseName(mark.file))}</span><i class="c">line ${mark.at}</i></a>`;
    const { named, plain } = namedThings(marks);
    return `<div class="rows mk-rows">${named.map((thing) => `<div class="gp">${esc(thing.name)} <i class="quiet">${esc(thing.kind)}</i></div>${thing.marks.map(row).join('')}`).join('')}`
      + `${plain.length && named.length ? '<div class="gp">With no fixed name</div>' : ''}${plain.map(row).join('')}</div>`;
  }

  // ----- where a click, a key or a menu entry goes: one act for every page -----

  let here = {}; // what the page can do itself: walk(step) to a view as a step of its path (true when it did), diagram() for a prompt

  /** The page says what it can do itself; everything else goes to the extension. */
  const useHere = (hooks) => { here = hooks; };

  /**
   * Where a target of the look goes, for every page (Home, the graphs page, the file tab and the change page). The comment box opens on the thing; a
   * place or the graphs of a path open as a step of the path when the page can take it; the extension does the rest in one place
   * (view/look-targets.ts), and asks before a web address opens or a prompt is sent.
   */
  function act(target, el) {
    if (!target) return;
    if (target.window) return void (typeof Hover === 'object' && openWindow(target.window, el)); // the list "Repo" has no window of the pointer
    if (typeof Hover === 'object') Hover.hide();
    if (target.comment) return void (typeof Remarks === 'object' && Remarks.boxOn(el));
    const step = target.place ? { tab: 'home', diagram: target.place.diagram, lit: target.place.node ? [target.place.node] : [], name: target.place.diagram }
      : target.graphs ? { tab: 'graphs', path: target.graphs, name: target.graphs }
      : target.page ? { tab: 'page', page: target.page, name: pageTitles[target.page] ?? target.page } : null;
    if (step && here.walk?.(step)) return;
    tell({ type: 'target', target, ...(here.diagram?.() ? { diagram: here.diagram() } : {}) });
  }

  /** The name of a drawn node as its words say it, without the letters of the chips in its corners. */
  const nameOf = (g) => (g.querySelector?.('.nodeLabel, .label') ?? g).textContent.trim();

  /** The window of a target (build 58): it opens beside the thing at once, and its blocks come when it opens. It closes as a window of the pointer does, or with Escape. */
  function openWindow(win, el) {
    const name = win.title || nameOf(el) || 'Window';
    Hover.now(el, () => ({
      title: name, width: win.width ?? 420, body: '<div class="bk-sec bk-own"></div>',
      ready: (body) => (typeof Blocks === 'object' ? Blocks.fill(body.querySelector('.bk-own'), win.ref) : undefined),
    }), undefined, true);
  }

  /** A button in a corner: its icon; the pointer says what it does, and a click does it. */
  function buttonAt(holder, look, button) {
    const icon = look.files[button.icon];
    holder.innerHTML = `<span class="mk-chip mk-button" role="button" tabindex="0" title="${esc(button.name)}">${icon ? `<img src="${esc(icon)}" alt="">` : esc(button.name[0] ?? '?')}</span>`;
    const el = holder.firstChild;
    el.addEventListener('click', (event) => { event.stopPropagation(); act(button.action, el); });
    Hover.attach(el, () => ({ title: button.name, width: 320, pad: true, body: `<p class="stepnote">${esc(targetWords(button.action))}</p>` }));
  }

  const KEYED = new WeakMap(); // a thing with keys of the look -> its keys
  const DOUBLE_WAIT = 250; // a thing with a double click waits this long before its single click

  /**
   * The input of a thing in the look: its click goes to the target of the rule, else to `today` (today's click, or none); a click with Alt or Shift,
   * a double click, a key and a right click with a menu go to their targets. Only a thing with a double click waits before its single click.
   * `name` is the title of its menu. Returns true when a click does something.
   */
  function bind(el, slots, today, name = '') {
    const [alt, shift, double, keys, menu] = ['alt', 'shift', 'double', 'key', 'menu'].map((field) => slots[`input.${field}`]);
    const click = slots.click;
    let timer = 0;
    if (click || today || alt || shift || double) {
      el.addEventListener('click', (event) => {
        const held = event.altKey ? alt : event.shiftKey ? shift : null;
        if (held) { event.stopPropagation(); return act(held, el); }
        const single = () => (click ? act(click, el) : today?.(event));
        if (!double) return single();
        clearTimeout(timer);
        timer = setTimeout(single, DOUBLE_WAIT);
      });
    }
    // A double click takes back the single click that waits.
    if (double) el.addEventListener('dblclick', (event) => { event.stopPropagation(); clearTimeout(timer); act(double, el); });
    if (menu?.length) el.addEventListener('contextmenu', (event) => { event.preventDefault(); event.stopPropagation(); openMenu(el, menu, name); });
    if (keys) {
      KEYED.set(el, keys);
      el.setAttribute('data-lk-keys', '');
      el.setAttribute('tabindex', '0');
    }
    return !!(click || today);
  }

  /** The menu of a right click: a small window with one row for each entry; VS Code's own menu does not open here. */
  function openMenu(el, menu, name) {
    Hover.now(el, () => ({
      title: name || 'Menu', width: 300,
      body: `<div class="rows lk-menu">${menu.map((entry, at) => `<a data-entry="${at}"><span>${esc(entry.name)}</span></a>`).join('')}</div>`,
      ready: (body) => body.addEventListener('click', (event) => { const row = event.target.closest('[data-entry]'); if (row) act(menu[Number(row.dataset.entry)].target, el); }),
    }));
  }

  // A key of the look goes to its target while the pointer is on its thing, or the thing has the keyboard; never while he types.
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.target.closest?.('[data-field], textarea, input, [contenteditable]')) return;
    const on = [...document.querySelectorAll('[data-lk-keys]:hover')].pop() ?? document.activeElement?.closest?.('[data-lk-keys]');
    const target = on && KEYED.get(on)?.[event.key.toLowerCase()];
    if (!target) return;
    event.preventDefault();
    act(target, on);
  });

  /** A small window of the pointer for a thing that has none of its own (the words of an arrow, a note card): what its click and its other input do. */
  function inputWindow(el, slots, title) {
    const lines = inputWords(slots);
    if (lines.length) Hover.attach(el, () => ({ title, width: 320, pad: true, body: lines.map((line) => `<p class="stepnote">${esc(line)}</p>`).join('') }));
  }

  /**
   * A stack of chips at a holder: the pointer spreads it and opens its window; a click on a chip or a row is a click on that value (`pick`).
   * In the window, a value with several places and no level under the node lists them (`pick` returns false).
   */
  function stackAt(holder, look, stack, setName, pick) {
    holder.innerHTML = stackHtml(look, stack);
    holder.classList.add('go');
    // A click on a place in a window opens its file at its line.
    const places = (body) => body.addEventListener('click', (event) => {
      const place = event.target.closest('[data-mk-open]');
      if (place) { Hover.hide(); pick.open(place.dataset.mkOpen, Number(place.dataset.mkLine)); }
    });
    const valueName = (one) => look.values[one.key]?.name ?? one.value;
    // A value with several places and no level under the thing lists its places: in the window that is open, or in a window that the click opens.
    const choose = (key, body) => {
      const one = stack.find((each) => each.key === key);
      if (!one || pick(one) !== false) return Hover.hide();
      if (body) body.innerHTML = placesHtml(one.marks);
      else Hover.now(holder, () => ({ title: valueName(one), sub: placesWord(one.marks.length), width: 440, body: placesHtml(one.marks), ready: places }));
    };
    holder.addEventListener('click', (event) => {
      event.stopPropagation();
      const chip = event.target.closest('[data-mk]');
      if (chip) choose(chip.dataset.mk, null);
    });
    Hover.attach(holder, () => {
      const content = stackWindow(look, stack, setName);
      return { ...content, ready: (body) => {
        places(body);
        body.addEventListener('click', (event) => { const row = event.target.closest('[data-mk-value]'); if (row) choose(row.dataset.mkValue, body); });
      } };
    });
  }

  /** The corners of a thing: each corner that a rule fills, with the marks of a set or a button. Returns the sets that stand in a corner. */
  function drawCorners(container, box, slots, marks, look, spread, ctx) {
    const shown = new Set();
    for (const corner of ['upper-left', 'upper-right', 'lower-left', 'lower-right']) {
      const fill = slots[`corners.${corner}`];
      if (!fill) continue;
      const right = corner.endsWith('right');
      const x = right ? box.x + box.width - 8 : box.x + 8;
      const y = corner.startsWith('upper') ? box.y : box.y + box.height;
      if (fill.icon) { buttonAt(holderAt(container, x, y, right), look, fill); continue; }
      shown.add(fill.set);
      const stack = stackOf(marks, fill.set, spread);
      if (!stack.length) continue;
      const set = look.sets.find((one) => one.id === fill.set);
      stackAt(holderAt(container, x, y, right), look, stack, set?.name ?? fill.set, ctx.pick);
    }
    return shown;
  }

  /**
   * Applies the look to a drawn diagram: the box and the corners of each node, the content and the icon that fill a node, the marks of a call out of
   * the repo and of an arrow with its own line, and the slots of the arrows. `things` holds, for each node id, its thing with its marks and its slots.
   * A diagram with no slot and no mark is left as it was drawn. Returns true when it added or changed something. `boxes` (boxesOf) get their colours
   * and the colour of their titles; a folded box is a node, which takes the colours of its box.
   */
  function decorate(svg, things, edges, look, filled, ctx, boxes = []) {
    const before = svg.innerHTML.length;
    for (const box of boxes) {
      const folded = box.slots['show.folded'] === true;
      const g = [...svg.querySelectorAll(folded ? 'g.node' : 'g.cluster')].find((one) => (folded ? ctx.nodeKey(one) : one.id) === box.node);
      if (!g) continue;
      paintBox(g, box.slots);
      const title = g.querySelector(folded ? '.label' : '.cluster-label');
      if (box.slots['text.color'] && title) paint(title, 'words', lineColors(box.slots['text.color'], READS));
    }
    const spread = spreadOf(Object.values(things));
    for (const g of svg.querySelectorAll('g.node, g.image-shape')) {
      const thing = things[ctx.nodeKey(g)];
      if (!thing) continue;
      if (filled[thing.node]) fill(g, filled[thing.node]);
      paintBox(g, thing.slots);
      const icon = look.files[thing.slots['text.icon']];
      if (icon) g.style.setProperty('--lk-icon', `url("${icon}")`);
      const shown = drawCorners(g, boxOf(g), thing.slots, thing.marks, look, spread, {
        pick: Object.assign((one) => ctx.pick(thing, one), { open: ctx.open }),
      });
      thing.cornered = shown;
    }
    for (const edge of edges) {
      if (!edge.path) continue;
      const slots = edge.slots;
      if (slots['text.color'] && edge.label) paint(edge.label, 'words', lineColors(slots['text.color'], READS));
      if (slots['arrow.color']) paint(edge.path, 'stroke', lineColors(slots['arrow.color']));
      if (slots['arrow.width']) { edge.path.style.setProperty('--lk-width', `${slots['arrow.width']}px`); edge.path.classList.add('lk-wide'); }
      if (slots['arrow.dashed']) edge.path.classList.add('lk-dashed');
      if (slots['arrow.head'] && edge.path.hasAttribute('marker-end')) {
        const marker = headOf(edge.path.getAttribute('marker-end'), slots['arrow.head']);
        if (marker) edge.path.setAttribute('marker-end', marker);
        else edge.path.removeAttribute('marker-end');
      }
      // A mark at the line of an arrow, or a button of a rule, stands at its label, or at the middle of its line.
      const icon = slots['arrow.icon'];
      if (!edge.marks.length && !icon) continue;
      const at = labelPoint(edge);
      if (!at) continue;
      const holder = holderAt(edge.path.parentElement, at.x - 9, at.y, false);
      if (icon) { buttonAt(holder, look, icon); continue; }
      const stack = [...new Set(edge.marks.map((mark) => mark.set))].flatMap((set) => stackOf(edge.marks, set, spread));
      stackAt(holder, look, stack, 'At the line of this arrow', Object.assign((one) => (one.marks.length === 1 ? (ctx.open(one.marks[0].file, one.marks[0].at), true) : false), { open: ctx.open }));
    }
    return svg.innerHTML.length !== before;
  }

  /** Where a mark of an arrow stands: over the middle of its label, else over the middle of its line, in the space of the line. */
  function labelPoint(edge) {
    const { path, label } = edge;
    const length = path.getTotalLength?.();
    if (!length) return null;
    const box = label?.getBBox?.();
    const toPath = box?.width > 0 && path.parentElement.getScreenCTM()?.inverse().multiply(label.getScreenCTM());
    if (toPath) { const top = new DOMPoint(box.x + box.width / 2, box.y - 8).matrixTransform(toPath); return { x: top.x, y: top.y }; }
    const middle = path.getPointAtLength(length / 2);
    return { x: middle.x, y: middle.y - 12 };
  }

  // ----- notes: a card in the file tab, and the window of a step -----

  /**
   * One line for each service of a note: the service, what the code does with it and the line; its named things as small links under it,
   * at most 7, then "+n more". A click on a link opens the file at its line.
   */
  function serviceLines(look, marks) {
    const LINKS = 7;
    const lines = stackOf(marks, 'services').map((one) => {
      const lineWords = one.marks.length === 1 ? `line ${one.marks[0].at}` : `${placesWord(one.marks.length)}`;
      const { named } = namedThings(one.marks);
      const link = (thing) => `<a data-mk-open="${esc(thing.marks[0].file)}" data-mk-line="${thing.marks[0].at}">${esc(thing.name)}</a>`;
      const links = named.length > 1 ? `<div class="mk-links">${named.slice(0, LINKS).map(link).join('')}${named.length > LINKS ? `<a class="mk-all" data-mk-all>+${named.length - LINKS} more</a><span class="mk-rest" hidden>${named.slice(LINKS).map(link).join('')}</span>` : ''}</div>` : '';
      const single = named.length === 1 ? ` ${esc(named[0].kind)} <a data-mk-open="${esc(named[0].marks[0].file)}" data-mk-line="${named[0].marks[0].at}">${esc(named[0].name)}</a> ·` : '';
      return `<div class="mk-line">${chipHtml(look, one.key)}<b>${esc(look.values[one.key]?.name ?? one.value)}</b> · ${esc(doesWords(one.marks))} ·${single} `
        + `<a data-mk-open="${esc(one.marks[0].file)}" data-mk-line="${one.marks[0].at}">${lineWords}</a>${links}</div>`;
    });
    return lines.join('');
  }

  /**
   * The look of a note: the colour of its bar, the corners of its card (the marks of a set, or a button) and its service lines, in the holder of the
   * lines when it has one. `el` is the card, or the body of the window of a step. `open(file, line)` opens a place.
   */
  function decorateNote(el, look, thing, open) {
    const slots = resolve(look.rules, thing, look.one);
    if (slots['note.color']) paint(el, 'bar', lineColors(slots['note.color']));
    const spread = spreadOf([thing]);
    for (const corner of ['upper-left', 'upper-right', 'lower-left', 'lower-right']) {
      const fill = slots[`corners.${corner}`];
      if (!fill) continue;
      const holder = html(`<div class="mk-stack mk-at ${corner}"></div>`);
      if (fill.icon) { el.append(holder); buttonAt(holder, look, fill); continue; }
      const stack = stackOf(thing.marks, fill.set, spread);
      if (!stack.length) continue;
      el.append(holder);
      stackAt(holder, look, stack, look.sets.find((set) => set.id === fill.set)?.name ?? fill.set, Object.assign((one) => (one.marks.length === 1 ? (open(one.marks[0].file, one.marks[0].at), true) : false), { open }));
    }
    const lines = serviceLines(look, thing.marks);
    const holder = el.querySelector(':scope > .mk-lines');
    if (holder) holder.innerHTML = lines;
    else if (lines) el.insertAdjacentHTML('beforeend', `<div class="mk-lines">${lines}</div>`);
    el.addEventListener('click', (event) => {
      const place = event.target.closest('[data-mk-open]');
      if (place) { event.stopPropagation(); open(place.dataset.mkOpen, Number(place.dataset.mkLine)); }
      const all = event.target.closest('[data-mk-all]');
      if (all) { event.stopPropagation(); all.nextElementSibling.hidden = false; all.remove(); }
    });
  }

  // ----- the page of a change and the file tab (build 60) -----

  /** The colour of the words of a rule ("text.color") on an element, in both themes, at a contrast that reads; and an icon before them ("text.icon"). */
  function paintText(el, look, slots) {
    if (slots['text.color']) paint(el, 'words', lineColors(slots['text.color'], READS));
    const icon = look?.files[slots['text.icon']];
    if (icon && !el.querySelector(':scope > .lk-icon')) el.insertAdjacentHTML('afterbegin', `<img class="lk-icon" src="${esc(icon)}" alt="">`);
  }

  return { ...pure, lookText, decorate, decorateNote, stackWindow, placesHtml, doesWords, act, useHere, bind, inputWindow, nameOf, paint, paintBox, paintText };
})();

if (typeof module === 'object') module.exports = Marks; // for the tests in Node
