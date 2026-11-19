// The path that he followed: the views that he went through to come here, in order. The extension keeps it for the window
// (view/trail.ts), so the tabs agree; each page draws it as the line at the top. The code says "trail" so as not to mix it with the path of a file.
// A step is one view: a map diagram on Home, the graphs of a path, a view of a change (the change, the diagram of a part, a wider diagram, "Diffs",
// the conversation of its pull request), or a pull request with no stored change.
'use strict';

const Trail = (() => {
  // The top map: the first step of every path. A step of Home names its diagram, '' for the top map.
  const HOME = { tab: 'home', diagram: '', name: 'Home' };

  /** The key of a step: two steps with the same key are the same view. */
  function key(step) {
    if (step.tab === 'home') return `home:${step.diagram ?? ''}`;
    if (step.tab === 'graphs') return `graphs:${step.path}`;
    if (step.tab === 'pull') return `pull:${step.link}`;
    if (step.tab === 'page') return `page:${step.page}`; // a page of the look
    const { level = 'change', part, diagram, view } = step.go ?? {};
    if (view === 'diffs') return `change:${step.change}:diffs`;
    if (view === 'conversation') return `change:${step.change}:conversation`;
    return `change:${step.change}:${level}${level === 'part' ? `:${part}` : level === 'broad' ? `:${diagram}` : ''}`;
  }
  const same = (a, b) => key(a) === key(b);

  /** A new path, when he opens a view from outside a page: Home, then that view. */
  const start = (step) => (same(step, HOME) ? [HOME] : [HOME, step]);

  /** The path cut back to a step that is in it, with that step as it is now; a step that is not in it starts a new path. */
  function upTo(steps, step) {
    const at = steps.findIndex((one) => same(one, step));
    return at < 0 ? start(step) : [...steps.slice(0, at), step];
  }

  /** A step that he took from a view: the path up to that view, then the new step. A step that is in the path already cuts it back there. */
  function walk(steps, from, to) {
    const path = upTo(steps, from);
    return path.some((one) => same(one, to)) ? upTo(path, to) : [...path, to];
  }

  /** The step before the view in the line of that view, or none on the top map. */
  const before = (steps, own) => upTo(steps, own).at(-2) ?? null;

  // ----- back and forward, as in a browser: the steps that a way back left stay `ahead` of the path, until he takes a new step -----

  /**
   * The path that ends at a step of the path or of the steps ahead, with that step as it is now, and the steps that are ahead of it then.
   * A step that is in neither starts a new path.
   */
  function goTo(steps, ahead, step) {
    const whole = [...steps, ...ahead];
    const at = whole.findIndex((one) => same(one, step));
    return at < 0 ? { steps: start(step), ahead: [] } : { steps: [...whole.slice(0, at), step], ahead: whole.slice(at + 1) };
  }

  /**
   * The step one back (`way` -1) or one forward (1) from a view, or null. A page with no view of its own (a file tab, `own` null) stands after the
   * last step of the path. A view that is not on the path has Home before it, as its line says, and nothing ahead.
   */
  function next(steps, ahead, own, way) {
    const whole = [...steps, ...ahead];
    if (!own) return whole[steps.length - (way < 0 ? 1 : 0)] ?? null;
    const at = whole.findIndex((one) => same(one, own));
    if (at < 0) return way < 0 ? before(steps, own) : null;
    return whole[at + way] ?? null;
  }

  const pure = { HOME, key, start, upTo, walk, before, goTo, next };
  if (typeof window !== 'object') return pure;

  // ----- in a page: its copy of the path, and the line at the top -----

  let steps = [HOME]; // the path of the window, as this page got it last
  let ahead = []; // as a file in a browser: the steps that a way back left (inside VS Code the extension keeps them)
  let own = null; // the view that this page shows, as a step
  let line = null; // { el, attrs, extra, look }: where the line is drawn, the mark of its last step, a bold name after it, and the look of the repo
  let openHere = null; // opens a step in this page when it can: the page gives it

  // As a file in a browser no extension keeps the path: the page keeps it for the next page it opens, which has "walk" in its address.
  // A page that is opened without it starts a new path, as a page opened from outside does in VS Code.
  const KEPT = 'apostil-trail';
  if (!vscodeApi) {
    try { if (new URLSearchParams(location.search).has('walk')) ({ steps, ahead } = JSON.parse(sessionStorage.getItem(KEPT)) ?? { steps, ahead }); } catch { /* no storage here */ }
  }
  const keepInBrowser = () => { try { sessionStorage.setItem(KEPT, JSON.stringify({ steps, ahead })); } catch { /* no storage here */ } };

  /**
   * The address of the page that shows a step, as a file in a browser. A pull request with no stored change is the data file pull-data-<number>.js;
   * a page of the look is a page of the made-up look that this page shows.
   */
  function addressOf(step) {
    const query = step.tab === 'graphs' ? { path: step.path }
      : step.tab === 'pull' ? { pull: `pull-data-${step.link.split('/').pop()}.js` }
      : step.tab === 'home' ? { diagram: step.diagram, lit: (step.lit ?? []).join(',') }
      : step.tab === 'page' ? { look: new URLSearchParams(location.search).get('look') ?? '', page: step.page }
      : { go: JSON.stringify(step.go) };
    return `${step.tab === 'change' || step.tab === 'pull' ? 'page.html' : 'home.html'}?${new URLSearchParams({ ...query, walk: 1 })}`;
  }

  /** The path from the extension. */
  function set(next) {
    steps = next;
    draw();
  }

  /**
   * Draws the line of the view that the page shows now. attrs: the mark of the last step; extra: a bold name after it that is not a step; look: the look
   * of the repo (view/look-data.ts), whose rules of "trail-step" give a step its words, an icon and a colour.
   */
  function show(el, step, { attrs = '', extra = '', look } = {}) {
    own = step;
    line = { el, attrs, extra, look };
    draw();
  }

  /** What a step shows: map, process, graphs, change, part, diagram, diffs or pull (the field "of" of a step of the trail in a look). */
  const ofStep = (step) => (step.tab === 'home' ? (/^process(es)?:/.test(step.diagram ?? '') ? 'process' : 'map') : step.tab === 'graphs' ? 'graphs'
    : step.tab === 'pull' || step.go?.view === 'conversation' ? 'pull' : step.go?.view === 'diffs' ? 'diffs' : step.go?.level === 'part' ? 'part'
    : step.go?.level === 'broad' ? 'diagram' : 'change');

  /** The words of a step in the line, in the look of the repo (Marks.wordsHtml); its name with no look. */
  function stepHtml(step) {
    const look = line.look;
    if (!look || typeof Marks !== 'object') return esc(step.name);
    const fields = { of: ofStep(step), name: step.name };
    return Marks.wordsHtml(step.name, Marks.resolve(look.rules, { kind: 'trail-step', diagram: step.diagram, fields }, look.one), fields, look) ?? esc(step.name);
  }

  /**
   * He took a step by himself from the view of this page. With `elsewhere` the view is on another page:
   * inside VS Code the extension opens it in its tab; as a file in a browser that page opens. False when this page shows no step (a file tab).
   */
  function take(to, elsewhere = false) {
    if (!own) return false;
    tell({ type: 'walk', from: own, to, open: elsewhere });
    steps = walk(steps, own, to);
    ahead = []; // a new step drops the steps ahead
    if (vscodeApi || !elsewhere) return true;
    keepInBrowser();
    location.href = addressOf(to);
    return true;
  }

  /** To a step of the line, or back or forward to one: the path ends there, and that view shows in its tab with what was lit there. */
  function open(step) {
    ({ steps, ahead } = goTo(steps, ahead, step));
    if (vscodeApi) return tell({ type: 'back', to: step });
    keepInBrowser();
    if (!openHere?.(step)) location.href = addressOf(step);
  }

  /** One step back (-1) or forward (1) from the view of this page. Inside VS Code the extension finds the step: it keeps the path with the steps ahead. */
  function move(way) {
    if (vscodeApi) return tell({ type: 'move', way, from: own ?? undefined });
    const to = next(steps, ahead, own, way);
    if (to) open(to);
  }

  /** The line: Home, the steps, the last one bold (or a bold name after it). `fold` steps after Home are one "…". */
  function lineHtml(shown, fold) {
    const sep = '<span class="sep">›</span>';
    const items = shown.map((step, index) => (index === shown.length - 1 && !line.extra
      ? `<b ${line.attrs}>${stepHtml(step)}</b>`
      : `<a data-trail="${index}">${stepHtml(step)}</a>`));
    if (fold) items.splice(1, fold, `<a data-unfold title="${esc(shown.slice(1, fold + 1).map((step) => step.name).join(' › '))}">…</a>`);
    if (line.extra) items.push(`<b>${esc(line.extra)}</b>`);
    return items.join(sep);
  }

  /** Draws the line; when it is too long for its width, the middle steps fold into "…", one more at a time. */
  function draw(unfolded = false) {
    if (!line || !own) return;
    const { el } = line;
    const shown = upTo(steps, own);
    el.classList.toggle('open', unfolded);
    let fold = 0;
    el.innerHTML = lineHtml(shown, 0);
    while (!unfolded && el.scrollWidth > el.clientWidth && fold < shown.length - 2) el.innerHTML = lineHtml(shown, ++fold);
    el.dataset.folded = fold;
  }

  document.addEventListener('click', (event) => {
    if (!line?.el.contains(event.target)) return;
    const step = event.target.closest('[data-trail]');
    if (step) return open(upTo(steps, own)[Number(step.dataset.trail)]);
    if (event.target.closest('[data-unfold]')) draw(true); // the folded steps show, and the line wraps
  });
  let width = 0;
  new ResizeObserver(() => { if (line && document.body.clientWidth !== width) { width = document.body.clientWidth; draw(); } }).observe(document.body);

  // Back and forward along the path, as in a browser: Cmd+Left and Cmd+Right on a Mac, Ctrl+Left and Ctrl+Right elsewhere (VS Code uses those
  // only where he types), and Alt+Left and Alt+Right everywhere. Not in a text field, where these keys move the caret.
  document.addEventListener('keydown', (event) => {
    const way = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    const { altKey: alt, metaKey: meta, ctrlKey: ctrl } = event;
    const held = alt ? !meta && !ctrl : MAC ? meta && !ctrl : ctrl && !meta;
    if (!way || !held || event.shiftKey || event.target.closest?.('[data-field], textarea, input, [contenteditable]')) return;
    event.preventDefault();
    move(way);
  });

  return { ...pure, set, show, take, here: (opener) => { openHere = opener; }, ownKey: () => (own ? key(own) : null) };
})();

if (typeof module === 'object') module.exports = Trail; // for the tests and the extension in Node
