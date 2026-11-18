// The pages on a wide tab, in two halves that each scroll by itself. One list of diffs (drawDiffs), one stepper (changeSteps), one file view (fileView)
// and one graph that follows (graphThatFollows) stand in them. The code or the list stands at the left, the diagram or the file at the right
// (the owner, 13 November). In the code, the half `left` is the diagram or the file and the half `right` the code or the list; look.css puts
// `right` in the left column. Each page:
// - "Diagram" of the change: the list of diffs closed at the left, its diagram at the right; the keys step through it, and the graph follows (changeWithDiffs).
// - The page of a part: the file of the diagram at the left, its diagram at the right, each step joined to its rows (showFile, joinOf).
// - "Diffs": the list of the changed files as closed rows at the left, the file of the marked row with its notes at the right (diffsPage).
'use strict';

const SPLIT = 1040; // from this width of the tab the diagram page is two halves
const HALF_LEAST = 420; // the least width of a half: an open comments window can leave too little room
const LIST_WIDTH = 300; // the list of closed rows beside the file on "Diffs"
// The two choices, each of its own: the code beside a diagram ("Hide code"), and the list of files beside the file of "Diffs" ("Hide files").
const HIDDEN_KEYS = { code: 'apostil.codeHidden', files: 'apostil.filesHidden' };

const Split = {
  right: null, // the right half while it shows

  /** True when he hid the code beside a diagram, or the list beside the file of "Diffs". Each choice lasts for every change; as a file in a browser it lasts in the storage of the browser. */
  hidden(half = 'code') {
    if (kept[`${half}Hidden`] !== undefined) return kept[`${half}Hidden`];
    try { return localStorage.getItem(HIDDEN_KEYS[half]) === '1'; } catch { return false; }
  },

  /** "Hide code" and "Show code", "Hide files" and "Show files". */
  setHidden(half, hidden) {
    keep({ [`${half}Hidden`]: hidden });
    try { localStorage.setItem(HIDDEN_KEYS[half], hidden ? '1' : '0'); } catch { /* no storage: the choice lasts while the page is open */ }
    App.render();
  },

  /** True when the tab is wide enough for two halves, and the page still has room for two readable halves. */
  wide() {
    return document.body.clientWidth >= SPLIT && document.getElementById('view').clientWidth >= 2 * HALF_LEAST;
  },

  /** True when the page is drawn in two halves now: a diagram with its code (`half` "code"), or "Diffs" with its list of files ("files"). */
  wanted(half = 'code') {
    return this.wide(half) && !this.hidden(half) && this.halved(half);
  },

  /** A page of a pull request alone has no diagram; its "Diffs" has the list beside the file when its commits are in the folder. */
  halved: (half) => !App.page.pullOnly || (half === 'files' && !!App.page.pullOnly.local),

  /**
   * The quiet control that shows a hidden half again, "Show code" (or "Show files" on "Diffs") at the left of the line above the diagram or the file.
   * While the code shows, its controls stand over the code (controls); nothing on a narrow tab or on a page with no such half.
   */
  controlHtml(half = 'code') {
    if (!this.wide(half) || !this.halved(half)) return '';
    return this.hidden(half) ? `<a class="codeswitch at-left" data-half="${half}" data-to="show">Show ${half}</a>` : '';
  },

  /**
   * The controls of the code or of the list of files over it, at the right end of the line of its first group header: "Hide code" (or "Hide files" on
   * "Diffs"), and with `all` "Open all" (or "Close all"). They lie over the right end of the left half and stay there while its list scrolls.
   */
  controls(view, all = false, half = 'code') {
    view.querySelector('.half.right').classList.add('ctl');
    view.insertAdjacentHTML('beforeend', `<div class="dctl">${all ? this.allHtml(false) : ''}${this.hideHtml(half)}</div>`);
  },

  hideHtml: (half = 'code') => `<a class="codeswitch" data-half="${half}" data-to="hide">Hide ${half}</a>`,

  /**
   * Makes the view two halves and returns them: [the diagram or the file, the code or the list]. look.css puts the second in the left column.
   * The code or the list takes the height that is left in the tab. `columns`: other widths of the columns than two equal ones, the left one first.
   */
  halves(view, columns = '') {
    view.classList.add('split');
    view.style.gridTemplateColumns = columns;
    view.innerHTML = '<div class="half left"></div><div class="half right"></div><svg class="join" width="1" height="1"></svg>';
    const [left, right] = view.querySelectorAll('.half');
    this.right = right;
    keepFilled(right);
    return [left, right];
  },

  /** Makes the view one box that takes the height that is left in the tab: the file of "Diffs" with no list beside it. */
  alone(view) {
    view.innerHTML = '<div class="alone"></div>';
    keepFilled(view.firstChild);
    return view.firstChild;
  },

  list: null, // the list of diffs beside a diagram while it shows, or "Diffs": a row of the list of comments finds the file of a comment there
  diffsFile: null, // the file that "Diffs" showed last: it shows it again when it draws again

  /**
   * The right half as a list of closed diffs: every changed file, or the files of one part (all open when they are three or fewer).
   * Returns the list, which the diagram of the change in `change` ties to its nodes (diffList).
   */
  showDiffs(right, part, change = right.parentElement.querySelector('.half.left')) {
    this.list = diffList(right, drawDiffs(right, { scroller: right, part, closed: true }), change);
    const sections = [...right.querySelectorAll('.dfile')];
    if (part && sections.length <= 3) sections.forEach((section) => this.list.open(section, 'click', false));
    return this.list;
  },

  /** The quiet control that opens every diff of the list and closes them again: "Open all" while none is open (`opened` false), else "Close all". */
  allHtml: (opened) => `<a class="codeswitch" data-all="${opened ? 'close' : 'open'}">${opened ? 'Close all' : 'Open all'}</a>`,

  /** Writes that control again for the list now. */
  showAll(list) {
    const control = document.querySelector('[data-all]');
    if (control) control.outerHTML = this.allHtml(list.anyOpen());
  },

  /**
   * The right half as the file of a diagram, as a file tab shows it (the whole file, notes as marks at the right edge), opened at the lines of the diagram.
   * Returns the join that ties each step to its rows, or null when there is no code to show.
   */
  async showFile(right, diagram) {
    const path = diagram.file;
    const code = await ask(`code:${path}`);
    if (!code) return null;
    const file = App.page.files.find((candidate) => candidate.path === path);
    right.classList.add('file-half');
    right.innerHTML = `<div class="fh" ${Places.attrs({ kind: 'file', file: path })}><a data-open-file="${esc(path)}">${esc(path)}</a><i class="c">${countsHtml(file)}</i>${this.hideHtml()}</div>`
      + `<div class="fc" data-file="${esc(path)}"></div>`;
    const rows = fileRows(code);
    const color = lineColors(codeToColor(code));
    const notes = App.page.notes.filter((note) => note.file === path);
    const holder = right.querySelector('.fc');
    const view = codeWithNotes(holder, { rows, notes, scroller: right, path, narrow: true, colorOf: (row) => (row.now ? color(row.now) : undefined) });
    // Alt+Down and Alt+Up step through its changes as in a file tab; after its last change they stop, since the next file would leave the diagram.
    const steps = fileSteps(holder, right, path, view, { head: () => right.querySelector('.fh').getBoundingClientRect().height });
    Code.shown = { path, rows, runs: changeRuns(rows), scroller: right, box: view.box, list: view.list, view, steps };
    // The changed lines that the diagram covers and that are in no node and no arrow have a quiet mark.
    if (diagram.inNoThing) view.mark('nothing', { any: [...diagram.inNoThing.map((line) => ({ lines: [line, line] })), ...(diagram.inNoThingRemoved ?? []).map((line) => ({ lines: [line, line], removed: true }))] });
    const all = Object.values(diagram.code).flatMap((code) => code.places).filter((place) => place.file === path && place.lines && !place.removed).map((place) => place.lines);
    const shown = diagram.covers ?? (all.length ? [Math.min(...all.map(([first]) => first)), Math.max(...all.map(([, last]) => last))] : null);
    if (shown) Code.reveal(shown);
    return joinOf(right, view, path);
  },
};

/** The top of an element inside the half that scrolls, as a place to scroll to. */
const topIn = (right, el) => right.scrollTop + el.getBoundingClientRect().top - right.getBoundingClientRect().top;

/** The node of a part in the diagram of the change in the left half, or of "In no part". */
const nodeOf = (left, id) => left.querySelector(id === 'no-part' ? 'b[data-nopart]' : `b[data-part="${CSS.escape(id)}"]`)?.closest('g.node');

/** Marks one node of the diagram of the change in the left half (a darker border), and takes away the marks of the files; null clears all. */
function markNode(left, g) {
  left.querySelectorAll('g.node.here').forEach((one) => one.classList.remove('here'));
  left.querySelectorAll('.f.lit').forEach((line) => line.classList.remove('lit'));
  for (const line of left.querySelectorAll('.f.more.shows')) { line.innerHTML = line.dataset.was; line.classList.remove('shows'); }
  g?.classList.add('here');
}

/**
 * Marks the node of the part of a file and lights the line of the file there; a file that the node does not list takes the place of "5 more files".
 * The diagram moves to the node when it is out of view. Null clears the marks.
 */
function markFile(left, path) {
  const g = path && nodeOf(left, partOfFile(App.page, path));
  markNode(left, g);
  if (!g) return;
  let line = g.querySelector(`.f[data-file="${CSS.escape(path)}"]`);
  if (!line && (line = g.querySelector('.f.more'))) {
    line.dataset.was = line.innerHTML;
    line.innerHTML = `${esc(baseName(path))} ${countsHtml(App.page.files.find((file) => file.path === path))}`;
    line.classList.add('shows');
  }
  requestAnimationFrame(() => line?.classList.add('lit')); // a frame later, so that its colour comes in its transition
  if (g.isConnected) g.closest('.surface')?.surface.show(g, true); // not while cards of parts stand in its place
}

/** The places of a thing one under the other over the right half, in its place and size (drawPlaces); `check` is an open point at the thing. Returns the panel. */
function placesOver(right, code, check) {
  const panel = html('<div class="places-half"><div class="places"></div></div>');
  Object.assign(panel.style, { left: `${right.offsetLeft}px`, top: `${right.offsetTop}px`, width: `${right.offsetWidth}px`, height: `${right.offsetHeight}px` });
  right.parentElement.append(panel);
  drawPlaces(panel.firstChild, code, panel, check);
  return panel;
}

/**
 * One thing whose code shows at a time, and the thing that a click keeps. `show(thing, still, ...more)` shows a thing and returns how to take it away
 * again; `still()` stays true while that thing shows, for what comes later. Two things are the same when they are one object or have one `key`.
 * point: the pointer rests on a thing; rest: the pointer left it, and the kept thing shows again; pin: a click keeps a thing, a second click lets it go;
 * drop: the kept thing goes. A click that reaches `area` lets the kept thing go (a click on a thing stops before it).
 * `more` of a pin is kept, so that the kept thing shows again as the click asked for it (a click brings its rows into view; the pointer does not).
 */
function oneShown(area, show) {
  let now = null;
  let pinned = null;
  let pinnedMore = [];
  let hide = () => {};
  const same = (a, b) => a === b || (!!a && !!b && a.key !== undefined && a.key === b.key);
  const put = (thing, ...more) => {
    if (same(now, thing)) return;
    hide();
    now = thing ?? null;
    hide = (thing && show(thing, () => now === thing, ...more)) || (() => {});
  };
  const one = {
    get now() { return now; },
    point: put,
    rest: () => put(pinned, ...pinnedMore),
    pin(thing, ...more) {
      pinned = same(pinned, thing) ? null : thing;
      pinnedMore = more;
      if (pinned) { hide(); hide = () => {}; now = null; } // it shows again, as the click asks for it
      put(pinned, ...more);
    },
    drop: () => { pinned = null; put(null); },
  };
  area.addEventListener('click', () => { if (pinned) one.drop(); });
  return one;
}

/** Opens an element to its height, or closes it to none, in a short animation; the promise ends with it. */
function fold(el, open) {
  if (lessMotion()) return Promise.resolve();
  const height = `${el.offsetHeight}px`;
  el.style.overflow = 'hidden';
  const run = el.animate(open ? [{ height: '0px', opacity: 0 }, { height, opacity: 1 }] : [{ height }, { height: '0px', opacity: 0 }], { duration: MOTION_MS, easing: 'ease-out' });
  return run.finished.catch(() => {}).then(() => { el.style.overflow = ''; });
}

/**
 * The closed diffs of the right half (the list of drawDiffs), tied to the nodes of the diagram of the change in `change` both ways.
 * A click on the head of a row opens its diff, and a click on the head again closes it; the name of the file still opens its tab.
 * The pointer on a row or an open diff marks the node of its part and lights its file there (a file that the node does not list takes the place
 * of "5 more files"); the diagram moves to the node when it is out of view. The pointer that rests on a node opens the diffs of its part
 * (part.id), on a file name only that file (file); those close again when the pointer rests on another node. A diff opened with a click stays.
 * J and K open the next and the previous row and close the one that the keys opened before. The pointer that rests on a link between parts shows its code (link).
 * `movedUntil` is the time until which a rest of the scroll is one that the list made by itself for the pointer, not his scroll.
 */
function diffList(right, list, change) {
  const page = right.parentElement;
  let pointed = null; // the file of the row under the pointer
  let focus = null; // what the diagram marks when the pointer is on no row: { part } that the pointer rested on, or { path } opened last
  let keyed = null; // the row that the keys opened
  let rested = null; // the node or file name that the pointer rested on last
  let stopScroll = () => {};

  const left = change;
  const sectionOf = (path) => right.querySelector(`.dfile[data-file="${CSS.escape(path)}"]`);
  const isOpen = list.isOpen;
  /** Glides the list to an element (a diff above it can close meanwhile), under the name of its part when `under`; `own` marks a scroll for the pointer. */
  const scrollTo = (el, { under = false, own = true } = {}) => {
    stopScroll();
    const to = () => topIn(right, el) - (under ? partHead(right) : 0);
    if (own && Math.abs(to() - right.scrollTop) > 1) moving();
    stopScroll = glideScroll(right, to);
  };
  const moving = () => { self.movedUntil = performance.now() + 2 * MOTION_MS + REST_MS + 400; }; // the glide, the diffs that open and close meanwhile, and the rest

  /** A row of a file behind "57 more files": that fold opens first. */
  const find = (path) => {
    if (!sectionOf(path)) right.querySelector(`[data-more-files][data-part="${CSS.escape(partOfFile(App.page, path))}"]`)?.click();
    return sectionOf(path);
  };

  const refresh = () => (pointed ? markFile(left, pointed) : focus?.part ? markNode(left, nodeOf(left, focus.part)) : markFile(left, focus?.path && isOpen(sectionOf(focus.path)) ? focus.path : null));
  const point = (path) => { if (path !== pointed) { pointed = path; refresh(); } };

  /** Opens the diff of a row: "click", "key", "step" (Alt+Down) or "pointer" says what opened it; `animate` false opens it at once. */
  async function open(section, by, animate = true) {
    if (!section) return;
    if (by !== 'pointer' || !section.dataset.by) section.dataset.by = by;
    if (by !== 'pointer') focus = { path: section.dataset.file };
    await list.open(section, { animate });
  }

  async function close(section) {
    if (!isOpen(section)) return;
    delete section.dataset.by;
    if (keyed === section) keyed = null;
    await list.close(section);
    refresh();
  }

  list.onHead = (section) => (isOpen(section) ? close(section) : open(section, 'click').then(refresh));
  list.onAll = (opened) => {
    keyed = null;
    if (!opened) focus = null;
    right.querySelectorAll('.dfile[data-by]').forEach((section) => { if (!isOpen(section)) delete section.dataset.by; });
    refresh();
  };

  /** Closes the diffs that the pointer opened, but not `keep`. */
  const closePointed = (keep = []) => right.querySelectorAll('.dfile.open[data-by="pointer"]').forEach((section) => { if (!keep.includes(section)) close(section); });

  /**
   * The code of a link between parts. Places that are all changed lines of one file: that diff opens at the top, at those lines, and its rows light.
   * Places in other files, on lines that the change did not touch, a whole file, or an open point: the places one under the other over the list.
   */
  const link = oneShown(left, (one, still) => {
    const shown = {}; // the section or the panel where its code shows
    one.els.forEach((el) => el.classList.add('joined'));
    const { code, check } = one;
    const files = [...new Set(code.places.map((place) => place.file))];
    const section = files.length === 1 && !check && code.places.every((place) => place.lines) ? find(files[0]) : null;
    (async () => {
      if (section) {
        closePointed([section]);
        await open(section, 'pointer');
        if (!still()) return;
        const spans = code.places.map((place) => section.view?.span(place));
        if (spans.every(Boolean)) {
          shown.section = section;
          section.view.mark('step', { any: code.places });
          const top = topIn(right, section) - partHead(right);
          const lines = topIn(right, section.view.box) + section.view.list.top(spans[0][0]);
          const bottom = topIn(right, section.view.box) + section.view.list.top(spans[0][1] + 1);
          const to = bottom - top <= right.clientHeight - 24 ? top : lines - right.clientHeight / 3; // the head of the file, or the lines when they are far down
          stopScroll();
          if (Math.abs(to - right.scrollTop) > 1) moving();
          stopScroll = glideScroll(right, to);
          focus = { path: files[0] };
          return refresh();
        }
      }
      shown.panel = placesOver(right, code, check);
    })();
    return () => {
      one.els.forEach((el) => el.classList.remove('joined'));
      shown.section?.view?.mark('step', null);
      shown.panel?.remove();
      if (shown.section) { focus = null; refresh(); } // its node no longer stays marked
    };
  });

  page.querySelector('.half.left').addEventListener('mouseleave', () => { rested = null; }); // back on the same node, its diffs open again
  // The node of a row is marked when the pointer rests on the row, as long as a hover window waits: a pointer that only crosses rows moves nothing.
  // Each row gets its wait when the pointer first comes on it (rows behind "57 more files" come later).
  right.addEventListener('mouseover', (event) => {
    const section = event.target.closest('.dfile');
    if (!section || section.waits) return;
    section.waits = true;
    Hover.after(section, () => point(section.dataset.file));
  });
  right.addEventListener('mouseleave', () => point(null));
  // A click inside a diff that the pointer opened keeps it.
  right.addEventListener('click', (event) => {
    if (event.target.closest('a, [data-more-files], .dh') || document.body.classList.contains('picking')) return;
    const section = event.target.closest('.dfile');
    if (isOpen(section)) section.dataset.by = 'click';
  });

  const self = {
    list, open, movedUntil: 0,

    /** The pointer rested on the node of a part: its part comes to the top and the diffs that show under it open. */
    part(id) {
      if (rested === id) return;
      rested = id;
      link.drop(); // resting on a part moves on from a kept link
      const title = right.querySelector(`.dp[data-part="${CSS.escape(id)}"]`);
      const sections = [...right.querySelectorAll(`.dfile[data-part="${CSS.escape(id)}"]:not(.quiet)`)];
      closePointed(sections);
      sections.forEach((section) => open(section, 'pointer'));
      if (title) scrollTo(title);
      focus = { part: id };
      refresh();
    },

    /** The pointer rested on a link (`one`: { key, code, check, els }): its code shows in the right half. */
    link(one) {
      rested = one.key;
      link.point(one);
    },

    /** The pointer left a link: the link that a click keeps shows again, else nothing. */
    rest: () => link.rest(),

    /** A click on a link keeps its code; a second click on it lets it go. */
    pin: (one) => link.pin(one),

    /** The pointer rested on a file name in a node: only that file opens, at the top. With `by` "click" it stays open, as a click on its row keeps it. */
    file(path, by = 'pointer') {
      rested = `file:${path}`;
      link.drop();
      const section = find(path);
      closePointed([section]);
      open(section, by).then(refresh);
      if (section) scrollTo(section, { under: true });
      focus = { path };
    },

    /** A click on a part or on "In no part": one with no diagram opens its first file in the list and the diagram half keeps what it shows; the others open as ever. */
    click(id) {
      const part = App.page.parts.find((one) => one.id === id);
      if (part && partDiagrams(part).length) return App.openPart(id);
      const paths = filesByPart().find((one) => one.id === id)?.paths ?? [];
      const path = paths.find((one) => App.page.notes.some((note) => note.file === one)) ?? paths[0];
      if (path) self.file(path, 'click');
    },

    /** A click on "3 more files" in a node: the group of its part comes to the top of the list, and a window in the diagram half lists every file of the part. */
    more(id, anchor) {
      const title = right.querySelector(`.dp[data-part="${CSS.escape(id)}"]`);
      if (title) scrollTo(title);
      fileList(anchor, id);
    },

    /** J and K: the next or the previous row comes to the top and opens; the one that the keys opened before closes. */
    step(direction) {
      const sections = [...right.querySelectorAll('.diffs .dfile')];
      const now = keyed ? sections.indexOf(keyed) + direction : topFile(right, partHead(right)).now + (direction > 0 ? 0 : -1);
      const next = sections[Math.max(0, Math.min(sections.length - 1, now))];
      if (!next || next === keyed) return;
      const closing = keyed?.dataset.by === 'key' ? close(keyed) : null;
      keyed = next;
      const opening = open(next, 'key').then(refresh);
      scrollTo(next, { under: true, own: false });
      // The diff above that closes shrinks in its own animation, which can end after the glide on a busy machine: then the row is put at the top.
      Promise.all([closing, opening]).then(() => { if (keyed === next) { stopScroll(); right.scrollTop = topIn(right, next) - partHead(right); } });
    },

    /** Opens the diff of the file of a comment and brings it, or its lines, into view; false when the file is not in this list. */
    async reveal(target) {
      const section = target.file && find(target.file);
      if (!section) return false;
      await open(section, 'click', false);
      const span = target.lines && section.view?.span(target);
      right.scrollTop = span ? topIn(right, section.view.box) + section.view.list.top(span[0]) - right.clientHeight / 3 : topIn(right, section) - partHead(right);
      const lit = span ? section.view : null;
      lit?.mark('flash', target);
      section.querySelector('.dh').classList.toggle('flash', !span);
      setTimeout(() => { lit?.mark('flash', null); section.querySelector('.dh').classList.remove('flash'); }, 1600);
      return true;
    },
  };
  return self;
}

/**
 * The graph that follows a list of diffs in `right`: in `left` (at the right of the page), with no click, the diagram or diagrams that the current change belongs to, one under
 * the other, with the things of that change lit (thingsAt in code-notes.js); the schema first for a file that builds one. For a file in no diagram,
 * and while the diff at the reading line is closed, the diagram of the change (`change`, drawn already), with the node of the file marked. A diagram
 * drawn once is kept, so that it comes back at once. The pointer that rests on a thing at the left brings its first place to the reading line and lights
 * its rows, or shows its places over the right half when the list does not hold them all; a click keeps it. The pointer on rows lights their things.
 * `steps` are the steps of the list (diffSteps). Returns { follow(at), back() }: follow the place of the stepper, or go back to the diagram of the change.
 */
function graphThatFollows(left, right, change, steps) {
  left.classList.add('beside');
  keepFilled(left);
  const drawn = new Map([['change', { el: change }]]); // by diagram id, or "change": { el, body, things }
  let shown = 'change'; // the ids of the diagrams that show, in order
  let current = []; // those diagrams, each with the keys of its things at the current change: [{ id, lit }]
  let followed = ''; // the file and the change that the left half shows
  let drawing = Promise.resolve();

  /** Lights the things of the current change, or the things of the rows under the pointer (`pointed`); while a thing shows its code, only that thing. */
  const light = (pointed = null) => {
    for (const [id, one] of drawn) {
      for (const [key, thing] of one.things ?? []) {
        const on = held.now ? held.now.key === thing.key : !!(pointed ?? current).find((found) => found.id === id)?.lit.includes(key);
        thing.els.forEach((el) => el.classList.toggle('joined', on));
      }
    }
  };

  const byFile = (places) => {
    const files = new Map();
    for (const place of places) files.set(place.file, [...(files.get(place.file) ?? []), place]);
    return files;
  };

  /** The places of a thing as the list holds them, by file in their order, each file opened and filled: [[section, places]]; null when the list does not hold one. */
  const inList = async (places) => {
    const found = [];
    for (const [path, list] of byFile(places)) {
      const section = await steps.reach(path);
      if (!section?.view || !list.every((place) => section.view.span(place))) return null;
      found.push([section, list]);
    }
    return found;
  };

  /** The same with nothing opened or filled: only what the list shows now, and only the places whose first rows are in view. */
  const inView = (places) => [...byFile(places)].flatMap(([path, list]) => {
    const section = right.querySelector(`.dfile.open[data-file="${CSS.escape(path)}"]`);
    const span = section?.view && section.view.span(list[0]);
    if (!span || !list.every((place) => section.view.span(place))) return [];
    const top = steps.topOf(section.view.box) + section.view.list.top(span[0]);
    const bottom = steps.topOf(section.view.box) + section.view.list.top(span[1] + 1);
    return bottom > right.scrollTop && top < right.scrollTop + right.clientHeight ? [[section, list]] : [];
  });

  /**
   * The code of a thing at the left. The pointer lights it, and its rows when they are in view already. A click (`click`) glides its first place to the reading line
   * (a closed diff opens first) and lights the rows of all its places; a place that the list does not hold shows over the right half, with a click only.
   */
  const held = oneShown(left, (one, still, click) => {
    const shown = { views: [] }; // the views of the diffs whose rows it lights, or the panel of its places
    light();
    one.els.forEach((el) => el.classList.add('joined'));
    const { code, check } = one;
    const nothing = check || code.places.some((place) => !place.lines);
    if (!click) {
      for (const [section, places] of nothing ? [] : inView(code.places)) { section.view.mark('step', { any: places }); shown.views.push(section.view); }
    } else {
      (nothing ? Promise.resolve(null) : inList(code.places)).then((placed) => {
        if (!still()) return;
        if (!placed) { shown.panel = placesOver(right, code, check); return; }
        for (const [section, places] of placed) { section.view.mark('step', { any: places }); shown.views.push(section.view); }
        const [[section, places]] = placed;
        steps.glideTo(steps.topOf(section.view.box) + section.view.list.top(section.view.span(places[0])[0]) - right.clientHeight * READING);
      });
    }
    return () => {
      one.els.forEach((el) => el.classList.remove('joined'));
      shown.views.forEach((view) => view.mark('step', null));
      shown.panel?.remove();
      queueMicrotask(light); // after `held.now` is the next one
    };
  });

  /** The card of a diagram of a part: its quiet title and the diagram, fit to the width of the half; its things join the list. */
  async function card(id) {
    const diagram = App.page.diagrams.find((one) => one.id === id);
    const el = html(`<section class="sec gcard"><div class="sh" ${Places.attrs({ kind: 'diagram', diagram: id })}><span class="gt">${esc(diagram.title)}</span><i class="k">${KIND_WORDS[diagram.kind]}</i></div><div class="sb"></div></section>`);
    left.append(el);
    const one = { el, body: el.querySelector('.sb'), things: new Map() };
    drawn.set(id, one);
    const thingOf = (main) => [...one.things.values()].find((thing) => thing.main === main);
    await drawPart(one.body, diagram, {
      step: (main, code, els, check, key) => one.things.set(key, { key: `${id}:${key}`, main, code, els, check }),
      show: (main) => held.point(thingOf(main)), rest: held.rest, pin: (main) => held.pin(thingOf(main), true),
    }, true);
    Remarks.paint(el, true); // the page painted its circles before this card came
  }

  /** Shows these diagrams one under the other, each drawn once. */
  async function show(ids) {
    if (ids.join() === shown) return;
    shown = ids.join();
    left.replaceChildren();
    for (const id of ids) {
      if (drawn.has(id)) left.append(drawn.get(id).el);
      else await card(id);
    }
    left.scrollTop = 0;
  }

  /** The diagram of the change, with nothing lit. */
  async function toChange() {
    followed = '';
    current = [];
    await show(['change']);
    light();
  }

  /** The left half follows the place at the reading line: the diagrams of its file, drawn again only when they are other ones, with its things lit. */
  async function follow(at) {
    if (held.now || !at) return;
    if (!at.section.view) return toChange(); // the diff there is closed
    if (`${at.path}:${at.run}:${at.focus}` === followed) return;
    followed = `${at.path}:${at.run}:${at.focus}`;
    const found = thingsAt(App.page.diagrams, at.path, at.section.view.rows, at.focus);
    await show(found.length ? found.map((one) => one.id) : ['change']);
    current = found;
    light();
    for (const { id, lit } of found) {
      const one = drawn.get(id);
      const first = lit.map((key) => one.things.get(key)).find(Boolean);
      if (first) one.body.surface?.show(first.main.querySelector?.(':scope > rect.actor') ?? first.main, true); // a participant by its box, not its long line
    }
    if (!found.length) markFile(change, at.path);
  }

  // The pointer on rows of a diff lights, in each diagram that shows, the narrowest thing whose place holds them; the right half does not move for it.
  let pointedRow = '';
  right.addEventListener('mousemove', (event) => {
    if (held.now) return;
    const row = event.target.closest('.rowsbox [data-row]');
    const section = row?.closest('.dfile');
    const key = section?.view ? `${section.dataset.file}:${row.dataset.row}` : '';
    if (key === pointedRow) return;
    pointedRow = key;
    if (!key) return light();
    const path = section.dataset.file;
    const found = current.flatMap(({ id }) => {
      const codes = Object.entries(App.page.diagrams.find((one) => one.id === id).code).filter(([, code]) => !code.filled);
      const best = narrowestAt(codes, ([, code]) => code.places.filter((place) => place.file === path), section.view.rows, Number(row.dataset.row));
      return best ? [{ id, lit: [best[0]] }] : [];
    });
    light(found.length ? found : null);
  });
  right.addEventListener('mouseleave', () => { pointedRow = ''; if (!held.now) light(); });

  const queue = (work) => { drawing = drawing.then(work).catch((error) => console.error(error)); return drawing; };
  return {
    follow: (at) => queue(() => follow(at)),
    back: () => queue(toChange),
  };
}

/**
 * "Diagram" of the change on a wide tab: the list of every diff at the left, closed at first, and its diagram at the right (Split.showDiffs, diffList).
 * Alt+Down and Alt+Up step through the changes of the list by the one rule of a step (diffSteps); a step opens the diff of the file that it goes into,
 * and the graph at the right follows the current change (graphThatFollows). It follows a key, and a scroll that rests with an open diff at the reading
 * line; not a scroll that the list made for the pointer on a node, a file name or a link. "Close all" brings the diagram of the change back.
 * Returns the steps, with the list, for the keys and the controls; J and K open the next and the previous row, as before.
 */
async function changeWithDiffs(left, right, from) {
  Split.controls(left.parentElement, true);
  const change = html('<div class="gchange"></div>');
  left.append(change);
  const rows = Split.showDiffs(right, null, change);
  const { list } = rows;
  await drawSections(change, from, rows);
  let graph = null;
  const steps = diffSteps(right, right, {
    nav: document.querySelector('#tabs .nav'),
    open: (section) => rows.open(section, 'step', false),
    moved: (at, key) => { if (key || performance.now() > rows.movedUntil) graph?.follow(at); }, // not a scroll that the list made for the pointer
  });
  graph = graphThatFollows(left, right, change, steps);
  const heard = list.onAll;
  list.onAll = (opened) => { heard(opened); if (!opened) graph.back(); Split.showAll(list); };
  const onHead = list.onHead;
  list.onHead = (section) => Promise.resolve(onHead(section)).then(() => { Split.showAll(list); if (!list.isOpen(section)) graph.follow(steps.here()); });
  list.onChange = () => Split.showAll(list);
  // The arrows ‹ and › of the counter: the file before or after the one that the counter names, at the top (J and K go on from the row that the keys opened last).
  const stepFile = (direction) => {
    const order = App.order();
    const next = order[order.indexOf(steps.here()?.path) + direction];
    return next && steps.toPath(next);
  };
  return { ...steps, list, stepFile };
}

/**
 * "Diffs": the file leads. `into` shows one changed file as the file view shows it (the whole file, each note as a card beside its lines, marks when
 * it is narrow); `list`, on a wide tab, is the list of every changed file as closed rows, where a row never opens (drawDiffs with `rows`).
 * Alt+Down and Alt+Up step through the changes of the file by the one rule of a step (fileSteps); after its last change they go on to the first change
 * of the next file with a change, and Alt+Up from its first change to the last change of the file before. J and K show the next and the previous file
 * at its first change; a click on a row shows that file, back at the place where he left it when it was drawn before. The counter counts over the
 * whole list (changeCounts). The row of the file that shows is marked and in view. With no `list` (a narrow tab, "Hide files") it is the file alone.
 * Returns what the keys, the counter, the list of files and the comments window use: step, stepFile, toPath, here, reveal, ready.
 */
function diffsPage(into, list) {
  into.classList.add('file-left');
  keepFilled(into);
  const nav = document.querySelector('#tabs .nav');
  const drawn = new Map(); // by path: { path, el, width, shown (fileView), steps, top }
  let now = null; // the file that shows
  let started = false; // the page painted its comment circles: a file drawn after that gets its own
  let drawing = Promise.resolve();
  const queue = (work) => (drawing = drawing.then(work).catch((error) => console.error(error)));

  const rows = list && drawDiffs(list, { scroller: list, closed: true, rows: true });
  if (rows) rows.onHead = (section) => queue(() => show(section.dataset.file, 0));

  /** The row of a file in the list; "57 more files" opens first. */
  const rowOf = (path) => {
    const find = () => list.querySelector(`.dfile[data-file="${CSS.escape(path)}"]`);
    if (!find()) list.querySelector(`[data-more-files][data-part="${CSS.escape(partOfFile(App.page, path))}"]`)?.click();
    return find();
  };

  /** Marks the row of the file that shows and brings it into view, under the name of its part. */
  function markRow(path) {
    if (!list) return;
    list.querySelector('.dfile.here')?.classList.remove('here');
    const row = rowOf(path);
    if (!row) return;
    row.classList.add('here');
    const top = topIn(list, row) - partHead(list);
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + partHead(list) + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + partHead(list) + row.offsetHeight - list.clientHeight;
  }

  /** Alt+Down after the last change of a file, or Alt+Up before its first: the next or the previous file with a change. */
  async function past(direction) {
    const files = await changeCounts();
    const other = nextChange(files, { file: files.findIndex((one) => one.path === now?.path), run: direction * Infinity }, direction);
    if (other) queue(() => show(files[other.file].path, direction));
  }

  /** Draws the file of a path, once for each width of the half. */
  async function draw(path) {
    const el = html('<div class="cvw"></div>');
    into.replaceChildren(el);
    const shown = await fileView(el, path, { head: true, fill: false });
    if (started) Remarks.paint(el, true);
    const one = { path, el, width: into.clientWidth, shown };
    if (shown?.view) {
      one.steps = fileSteps(shown.holder, shown.scroller, path, shown.view, { head: () => el.querySelector('.fh')?.offsetHeight ?? 0, past, nav, files: changeCounts });
      one.steps.ready.catch((error) => console.error(error));
    }
    drawn.set(path, one);
    return one;
  }

  /** Writes the counter for the file that shows, also for a file with no change to step through. */
  async function count(one) {
    const files = await changeCounts();
    const { number, total } = changeNumber(files, { file: files.findIndex((file) => file.path === one.path), run: -1 });
    const order = App.order();
    if (now === one && nav?.isConnected) nav.innerHTML = counterHtml({ file: order.indexOf(one.path), files: order.length, cur: number - 1, changes: total });
  }

  /** Shows the file of a path: at its first change (1), at its last change (-1), or at the place where he left it (0). */
  async function show(path, at) {
    if (now?.shown?.scroller) now.top = now.shown.scroller.scrollTop;
    let one = drawn.get(path);
    if (one && one.width === into.clientWidth) into.replaceChildren(one.el);
    else one = await draw(path);
    now = one;
    Split.diffsFile = path;
    markRow(path);
    if (!one.steps) return count(one);
    if (at === 0 && one.top !== undefined) {
      one.shown.scroller.scrollTop = one.top;
      const numbers = await one.steps.count(one.steps.here());
      if (now === one && nav?.isConnected) nav.innerHTML = counterHtml(numbers);
    } else one.steps.enter(at === -1 ? -1 : 1);
  }

  // A new width of the half (the comments window, the tab): the file is drawn again for it, in cards or in marks, with the same line at its top.
  new ResizeObserver(() => {
    if (!into.isConnected || !now || !into.clientWidth || now.width === into.clientWidth) return;
    queue(async () => {
      const was = now;
      const view = was.shown?.view;
      const row = view ? view.list.rowAt(was.shown.scroller.scrollTop - view.box.offsetTop) : 0;
      drawn.clear();
      const one = (now = await draw(was.path));
      if (one.shown?.view) one.shown.scroller.scrollTop = one.shown.view.box.offsetTop + one.shown.view.list.top(row);
    });
  }).observe(into);

  const order = App.order();
  const first = App.page.files.some((file) => file.path === Split.diffsFile) ? Split.diffsFile : order[0] ?? App.page.files[0]?.path;
  const self = {
    /** Alt+Down (1) and Alt+Up (-1). */
    step: (direction) => queue(() => (now?.steps ? now.steps.step(direction) : past(direction))),
    /** J and K: the next or the previous changed file, at its first change. */
    stepFile: (direction) => queue(() => {
      const files = App.order();
      const index = files.indexOf(now?.path);
      const next = files[index < 0 ? (direction > 0 ? 0 : files.length - 1) : index + direction];
      return next && show(next, 1);
    }),
    /** A file picked in the list of files: at its first change. */
    toPath: (path) => queue(() => show(path, 1)),
    /** The place of the file that shows: its current change, or only its path. */
    here: () => now?.steps?.here() ?? (now ? { path: now.path, run: -1 } : null),
    /** A click on the card of a comment: its file shows, and its lines, or its head, light for a moment. False for a file that the change does not have. */
    async reveal(target) {
      if (!target.file || !App.page.files.some((file) => file.path === target.file)) return false;
      await queue(() => (now?.path === target.file ? null : show(target.file, 1)));
      const view = now.shown?.view;
      const span = target.lines && view?.span(target);
      const lit = span ? view : null;
      if (span) now.shown.scroller.scrollTop = view.box.offsetTop + view.list.top(span[0]) - now.shown.scroller.clientHeight * READING;
      lit?.mark('flash', target);
      now.el.querySelector('.fh')?.classList.toggle('flash', !span);
      const one = now;
      setTimeout(() => { lit?.mark('flash', null); one.el.querySelector('.fh')?.classList.remove('flash'); }, 1600);
      return true;
    },
    ready: (first ? queue(() => show(first, 1)) : Promise.resolve()).then(() => { started = true; }),
  };
  Split.list = self; // the comments window finds the file of a comment here
  return self;
}

/**
 * The join of the things of a diagram to their code in the half `right` (at the left of the page). The code follows a click, not the pointer.
 * The pointer on a thing only lights it, and draws one line to its rows when they are in view already; the pointer on rows lights their thing.
 * A click on a thing keeps it until the next click: its first rows come into view, and a thing with a place in another file, a whole file as a place,
 * or an open point shows its places one under the other over the file; a second click lets it go. One join at a time. `path` is the file of the code half.
 */
function joinOf(right, view, path) {
  const steps = []; // { g, els, here, away, code, check }: g is the thing, or the label of an arrow; els are all its drawn parts; here its places in the file of the code half
  const page = right.parentElement;
  const line = page.querySelector('svg.join');

  const draw = () => {
    const shown = join.now;
    const span = shown && !shown.away && shown.here.length && view.span(shown.here[0]);
    if (!span || !shown.g.isConnected) { line.innerHTML = ''; return; }
    const [base, half, box, node, diagram] = [page, right, view.box, shown.g, page.querySelector('.half.left')].map((el) => el.getBoundingClientRect());
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const head = right.querySelector('.fh').offsetHeight;
    const [rowsTop, rowsBottom] = [box.top + view.list.top(span[0]), box.top + view.list.top(span[1] + 1)];
    if (rowsBottom < half.top + head || rowsTop > half.bottom) { line.innerHTML = ''; return; } // its rows are not in view: no line, a click brings them
    const rowsMiddle = clamp((rowsTop + rowsBottom) / 2, half.top + head, half.bottom - 4);
    // From the left edge of the thing in the diagram at the right to the right edge of its rows in the file at the left.
    const [x1, y1] = [clamp(node.left, diagram.left, diagram.right) - base.left, clamp(node.top + node.height / 2, diagram.top, diagram.bottom) - base.top];
    const [x2, y2] = [Math.min(box.right, half.right) - base.left, rowsMiddle - base.top];
    const middle = (x1 + x2) / 2;
    line.innerHTML = `<path d="M${x1} ${y1} C${middle} ${y1} ${middle} ${y2} ${x2} ${y2}"/>`;
  };

  // A thing lights with its rows; a click (`click`) also brings its first rows into view when they are out of it, or shows its places over the file.
  const join = oneShown(page.querySelector('.half.left'), (step, still, click) => {
    step.els.forEach((el) => el.classList.add('joined'));
    if (!step.away) view.mark('step', { any: step.here });
    const panel = step.away && click ? placesOver(right, step.code, step.check) : null;
    const span = !step.away && click && view.span(step.here[0]);
    const [top, bottom] = span ? [view.box.offsetTop + view.list.top(span[0]), view.box.offsetTop + view.list.top(span[1] + 1)] : [0, 0];
    if (span && (bottom < right.scrollTop + right.querySelector('.fh').offsetHeight || top > right.scrollTop + right.clientHeight)) Code.reveal(step.here[0]);
    draw();
    return () => {
      step.els.forEach((el) => el.classList.remove('joined'));
      view.mark('step', null);
      panel?.remove();
      requestAnimationFrame(draw); // after the next thing shows, or none
    };
  });
  const find = (g) => steps.find((step) => step.g === g);

  // The pointer on rows lights the narrowest thing whose places hold them: a removed row is in removed lines, or counts at the line that it stands before.
  view.box.addEventListener('mousemove', (event) => {
    const index = Number(event.target.closest('[data-row]')?.dataset.row ?? -1);
    const step = view.rows[index] && narrowestAt(steps.filter((one) => !one.away), (one) => one.here, view.rows, index);
    if (step) join.point(step);
    else join.rest();
  });
  view.box.addEventListener('mouseleave', join.rest);
  right.addEventListener('scroll', draw, { passive: true });
  addEventListener('resize', draw);
  const moved = new MutationObserver(draw); // the join follows the diagram while he moves or zooms it

  return {
    /** Ties a drawn thing to its places (`code`); `els` are all its drawn parts, which light with it; `check` is an open point at it. */
    step(g, code, els = [g], check) {
      const here = code.places.filter((place) => place.file === path && place.lines);
      steps.push({ g, els, here, code, check, away: !!check || here.length < code.places.length });
      const svg = g.ownerSVGElement;
      if (steps.length === 1 && svg) moved.observe(svg, { attributes: true, attributeFilter: ['viewBox'] });
    },
    show: (g) => join.point(find(g)),
    rest: join.rest,
    pin: (g) => join.pin(find(g), true),
  };
}

