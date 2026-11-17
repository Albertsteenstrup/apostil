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
    const { level = 'change', part, diagram, view } = step.go ?? {};
    if (view === 'diffs') return `change:${step.change}:diffs`;
    if (view === 'conversation') return `change:${step.change}:conversation`;
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

  const pure = { HOME, key, start, upTo, walk, before };
  if (typeof window !== 'object') return pure;

  // ----- in a page: its copy of the path, and the line at the top -----

  let steps = [HOME]; // the path of the window, as this page got it last
  let own = null; // the view that this page shows, as a step
  let line = null; // { el, attrs, extra }: where the line is drawn, the mark of its last step, and a bold name after it
  let openHere = null; // opens a step in this page when it can: the page gives it

  // As a file in a browser no extension keeps the path: the page keeps it for the next page it opens, which has "walk" in its address.
  // A page that is opened without it starts a new path, as a page opened from outside does in VS Code.
  const KEPT = 'apostil-trail';
  if (!vscodeApi) {
    try { if (new URLSearchParams(location.search).has('walk')) steps = JSON.parse(sessionStorage.getItem(KEPT)) ?? steps; } catch { /* no storage here */ }
  }
  const keepInBrowser = () => { try { sessionStorage.setItem(KEPT, JSON.stringify(steps)); } catch { /* no storage here */ } };

  /** The address of the page that shows a step, as a file in a browser. A pull request with no stored change is the data file pull-data-<number>.js. */
  function addressOf(step) {
    const query = step.tab === 'graphs' ? { path: step.path }
      : step.tab === 'pull' ? { pull: `pull-data-${step.link.split('/').pop()}.js` }
      : step.tab === 'home' ? { diagram: step.diagram, lit: (step.lit ?? []).join(',') }
      : { go: JSON.stringify(step.go) };
    return `${step.tab === 'change' || step.tab === 'pull' ? 'page.html' : 'home.html'}?${new URLSearchParams({ ...query, walk: 1 })}`;
  }

  /** The path from the extension. */
  function set(next) {
    steps = next;
    draw();
  }

  /** Draws the line of the view that the page shows now. attrs: the mark of the last step; extra: a bold name after it that is not a step. */
  function show(el, step, { attrs = '', extra = '' } = {}) {
    own = step;
    line = { el, attrs, extra };
    draw();
  }

  /**
   * He took a step by himself from the view of this page. With `elsewhere` the view is on another page:
   * inside VS Code the extension opens it in its tab; as a file in a browser that page opens.
   */
  function take(to, elsewhere = false) {
    if (!own) return;
    tell({ type: 'walk', from: own, to, open: elsewhere });
    steps = walk(steps, own, to);
    if (vscodeApi || !elsewhere) return;
    keepInBrowser();
    location.href = addressOf(to);
  }

  /** Back to a step of the line: the path ends there again, and that view shows in its tab with what was lit there. */
  function open(step) {
    steps = upTo(steps, step);
    if (vscodeApi) return tell({ type: 'back', to: step });
    keepInBrowser();
    if (!openHere?.(step)) location.href = addressOf(step);
  }

  /** The line: Home, the steps, the last one bold (or a bold name after it). `fold` steps after Home are one "…". */
  function lineHtml(shown, fold) {
    const sep = '<span class="sep">›</span>';
    const items = shown.map((step, index) => (index === shown.length - 1 && !line.extra
      ? `<b ${line.attrs}>${esc(step.name)}</b>`
      : `<a data-trail="${index}">${esc(step.name)}</a>`));
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

  // **default**, not asked for by the owner: Alt+Left goes one step back along the path. Take out this listener to remove it.
  document.addEventListener('keydown', (event) => {
    if (!event.altKey || event.key !== 'ArrowLeft' || event.metaKey || event.ctrlKey || event.target.closest?.('[data-field], textarea') || !own) return;
    const back = before(steps, own);
    if (!back) return;
    event.preventDefault();
    open(back);
  });

  return { ...pure, set, show, take, open, here: (opener) => { openHere = opener; } };
})();

if (typeof module === 'object') module.exports = Trail; // for the tests and the extension in Node
