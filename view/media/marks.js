// Marks and the look on a page: which rule wins each slot of a thing, the marks that roll up to it, the colours of both themes, and the drawing
// of corners, boxes, pictures, films and arrows. Home draws its diagrams with it and the file tab its note cards; one path draws a mark of any set.
// The rules come from view/look-data.ts, in the order that they apply. The first part has no drawing, so that the tests read it in Node.
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

  /** True when a rule picks a thing. An arrow is picked by nodes, paths or a mark when both its ends are, or when its own line holds the mark. */
  function picks(pick, thing) {
    if (pick.kind !== thing.kind || (pick.diagram && pick.diagram !== thing.diagram)) return false;
    const ends = thing.ends ?? [thing];
    if (pick.nodes && !ends.every((end) => pick.nodes.includes(end.node))) return false;
    if (pick.paths && !ends.every((end) => (end.paths ?? []).some((path) => pick.paths.some((entry) => covers(entry, path))))) return false;
    const marked = (one) => (one.marks ?? []).some((mark) => fits(pick.mark, mark));
    if (pick.mark && !marked(thing) && !(thing.ends && thing.ends.every(marked))) return false;
    return true;
  }

  /** How closely a rule names what it picks: a node id, then a mark, then a path, then a kind. */
  const rankOf = (pick) => (pick.nodes ? 4 : pick.mark ? 3 : pick.paths ? 2 : 1);

  // A slot that gives one field only is taken whole (LOOK_PARTS in shared/look.ts names them; the data of a page brings them as `one`).
  const ONE = ['content'];

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

  /**
   * The things of a diagram for the look, by node id: each with its kind, its paths or lines, the marks inside it, and the slots that the rules give it.
   * A call out of the repo shows the marks of its lines, and the step that calls gets no second chip for them.
   */
  function thingsOf(diagram, look) {
    const callLines = Object.values(diagram.nodes).flatMap((node) => node.calls ?? []);
    const leave = new Set(look.marks.filter((mark) => callLines.some((one) => one.file === mark.file && one.line === mark.line)));
    const things = {};
    for (const [key, node] of Object.entries(diagram.nodes)) {
      const kind = node.kind ?? 'node';
      const where = kind === 'call' ? { calls: node.calls ?? [] } : kind === 'step' ? { at: node.at ?? [] } : {};
      const thing = { kind, diagram: diagram.id, node: key, paths: node.paths.map((one) => one.path), ...where };
      thing.marks = marksIn(thing, look.marks, kind === 'call' ? new Set() : leave);
      thing.slots = resolve(look.rules, thing, look.one);
      things[key] = thing;
    }
    return things;
  }

  /** The arrows of a diagram for the look: each with its two ends, the marks at its own line (a drawn process), and its slots. */
  function edgesOf(diagram, look, things) {
    return diagram.graph.edges.map((edge) => {
      const lines = diagram.edgeLines?.[`${edge.from}>${edge.to}`] ?? [];
      const marks = look.marks.filter((mark) => lines.some((one) => one.file === mark.file && one.line === mark.line));
      const thing = { kind: 'arrow', diagram: diagram.id, ends: [things[edge.from], things[edge.to]].filter(Boolean), marks };
      return { ...edge, marks, slots: resolve(look.rules, thing, look.one) };
    });
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

  /** A colour of a line (an arrow, the bar of a note, the line of a box) for both themes: moved toward black or white until it stands out from the paper at 3:1. */
  function lineColors(hex) {
    const base = parse(hex);
    const stand = (paper, toward) => {
      for (let step = 0; step <= 10; step++) { const at = mix(base, toward, step / 10); if (contrast(at, paper) >= 3) return toHex(at); }
      return toHex(toward);
    };
    return { light: stand(PAPER.light, [0, 0, 0]), dark: stand(PAPER.dark, [255, 255, 255]) };
  }

  const pure = { covers, keyOf, holds, marksIn, picks, rankOf, resolve, thingsOf, edgesOf, spreadOf, stackOf, namedThings, boxColors, lineColors, contrast, parse, SHOWN };
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
   * The Mermaid text of a flow chart with the shapes and the contents that the look gives its nodes, added at its end. A picture or a film is a
   * picture shape of its size with a blank picture, filled after the drawing. Returns the text and the nodes to fill.
   */
  async function shapedText(text, slotsByNode, look, labels) {
    if (!/^\s*(?:flowchart|graph)\b/m.test(text)) return { text, filled: {} };
    const lines = [];
    const filled = {};
    for (const [node, slots] of Object.entries(slotsByNode)) {
      if (slots['box.shape']) lines.push(`  ${node}@{ shape: ${slots['box.shape']} }`);
      const content = slots.content;
      if (content?.words) lines.push(`  ${node}@{ label: "${quote(content.words)}" }`);
      const file = content && (content.picture ?? content.film);
      const address = file && look.files[file];
      const size = address && await sizeOf(address, !!content.film);
      if (size) {
        lines.push(`  ${node}@{ img: "${BLANK}", label: "${quote(labels[node] ?? node)}", pos: "b", w: ${size.width}, h: ${size.height} }`);
        filled[node] = { address, film: !!content.film, ...size };
      }
    }
    return { text: lines.length ? `${text}\n${lines.join('\n')}` : text, filled };
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
    return { title: setName, sub: `${stack.length} ${stack.length === 1 ? 'value' : 'values'}`, width: 440, body: `<div class="rows mk-rows">${rows.join('')}</div>` };
  }

  /** The places of one value, grouped by named thing, then the places with no fixed name. A click on a row opens that file at its line. */
  function placesHtml(marks) {
    const row = (mark) => `<a data-mk-open="${esc(mark.file)}" data-mk-line="${mark.at}"><span>${esc(baseName(mark.file))}</span><i class="c">line ${mark.at}</i></a>`;
    const { named, plain } = namedThings(marks);
    return `<div class="rows mk-rows">${named.map((thing) => `<div class="gp">${esc(thing.name)} <i class="quiet">${esc(thing.kind)}</i></div>${thing.marks.map(row).join('')}`).join('')}`
      + `${plain.length && named.length ? '<div class="gp">With no fixed name</div>' : ''}${plain.map(row).join('')}</div>`;
  }

  /** The name and what a button does, for its window. */
  const actionWords = (action) => (!action ? 'Does nothing.' : action.url ? `Opens ${action.url}, after VS Code asks.` : action.file ? `Opens ${action.file}${action.line ? ` at line ${action.line}` : ''}.`
    : action.command ? `Runs the command ${action.command}.` : action.place ? `Opens ${action.place.diagram}${action.place.node ? ` at its node ${action.place.node}` : ''} on Home.` : `Sends this to the agent of the repo, after VS Code asks: "${action.prompt}"`);

  /** A button in a corner: its icon; the pointer says what it does, and a click does it. */
  function buttonAt(holder, look, button, act) {
    const icon = look.files[button.icon];
    holder.innerHTML = `<span class="mk-chip mk-button" role="button" tabindex="0" title="${esc(button.name)}">${icon ? `<img src="${esc(icon)}" alt="">` : esc(button.name[0] ?? '?')}</span>`;
    const el = holder.firstChild;
    el.addEventListener('click', (event) => { event.stopPropagation(); Hover.hide(); act(button.action); });
    Hover.attach(el, () => ({ title: button.name, width: 320, pad: true, body: `<p class="stepnote">${esc(actionWords(button.action))}</p>` }));
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
      if (fill.icon) { buttonAt(holderAt(container, x, y, right), look, fill, ctx.act); continue; }
      shown.add(fill.set);
      const stack = stackOf(marks, fill.set, spread);
      if (!stack.length) continue;
      const set = look.sets.find((one) => one.id === fill.set);
      stackAt(holderAt(container, x, y, right), look, stack, set?.name ?? fill.set, ctx.pick);
    }
    return shown;
  }

  /**
   * Applies the look to a drawn diagram: the box and the corners of each node, the content that fills a node, the marks of a call out of the repo
   * and of an arrow with its own line, and the slots of the arrows. `things` holds, for each node id, its thing with its marks and its slots.
   * A diagram with no slot and no mark is left as it was drawn. Returns true when it added or changed something.
   */
  function decorate(svg, things, edges, look, filled, ctx) {
    const before = svg.innerHTML.length;
    const spread = spreadOf(Object.values(things));
    for (const g of svg.querySelectorAll('g.node, g.image-shape')) {
      const thing = things[ctx.nodeKey(g)];
      if (!thing) continue;
      if (filled[thing.node]) fill(g, filled[thing.node]);
      paintBox(g, thing.slots);
      const shown = drawCorners(g, boxOf(g), thing.slots, thing.marks, look, spread, {
        act: ctx.act, pick: Object.assign((one) => ctx.pick(thing, one), { open: ctx.open }),
      });
      thing.cornered = shown;
    }
    for (const edge of edges) {
      if (!edge.path) continue;
      const slots = edge.slots;
      if (slots['arrow.color']) paint(edge.path, 'stroke', lineColors(slots['arrow.color']));
      if (slots['arrow.width']) { edge.path.style.setProperty('--lk-width', `${slots['arrow.width']}px`); edge.path.classList.add('lk-wide'); }
      if (slots['arrow.dashed']) edge.path.classList.add('lk-dashed');
      // A mark at the line of an arrow, or a button of a rule, stands at its label, or at the middle of its line.
      const icon = slots['arrow.icon'];
      if (!edge.marks.length && !icon) continue;
      const at = labelPoint(edge);
      if (!at) continue;
      const holder = holderAt(edge.path.parentElement, at.x - 9, at.y, false);
      if (icon) { buttonAt(holder, look, icon, ctx.act); continue; }
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
   * The look of a note: the colour of its bar, the corners of its card (the marks of a set, or a button) and its service lines. `el` is the card,
   * or the body of the window of a step. `open(file, line)` opens a place.
   */
  function decorateNote(el, look, thing, open, act) {
    const slots = resolve(look.rules, thing, look.one);
    if (slots['note.color']) paint(el, 'bar', lineColors(slots['note.color']));
    const spread = spreadOf([thing]);
    for (const corner of ['upper-left', 'upper-right', 'lower-left', 'lower-right']) {
      const fill = slots[`corners.${corner}`];
      if (!fill) continue;
      const holder = html(`<div class="mk-stack mk-at ${corner}"></div>`);
      if (fill.icon) { el.append(holder); buttonAt(holder, look, fill, act); continue; }
      const stack = stackOf(thing.marks, fill.set, spread);
      if (!stack.length) continue;
      el.append(holder);
      stackAt(holder, look, stack, look.sets.find((set) => set.id === fill.set)?.name ?? fill.set, Object.assign((one) => (one.marks.length === 1 ? (open(one.marks[0].file, one.marks[0].at), true) : false), { open }));
    }
    const lines = serviceLines(look, thing.marks);
    if (lines) el.insertAdjacentHTML('beforeend', `<div class="mk-lines">${lines}</div>`);
    el.addEventListener('click', (event) => {
      const place = event.target.closest('[data-mk-open]');
      if (place) { event.stopPropagation(); open(place.dataset.mkOpen, Number(place.dataset.mkLine)); }
      const all = event.target.closest('[data-mk-all]');
      if (all) { event.stopPropagation(); all.nextElementSibling.hidden = false; all.remove(); }
    });
  }

  return { ...pure, shapedText, decorate, decorateNote, stackWindow, placesHtml, actionWords, doesWords };
})();

if (typeof module === 'object') module.exports = Marks; // for the tests in Node
