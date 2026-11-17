// Comments: a window of its own at the right of the tab, with the threads and the open points; a new comment starts in a box that he sticks on the page.
// The code says "remark", as the store does; the page says "comment". "@" sends a comment to the agent, or with "@github" to the pull request.
'use strict';

const Remarks = (() => {
  const W = States.WORDS;
  const pullPage = () => (typeof Conversation === 'object' ? Conversation : undefined); // the change page has a pull request; Home has none
  const side = document.getElementById('side');
  const narrowPage = window.matchMedia('(max-width: 899px)');
  const stillPage = window.matchMedia('(prefers-reduced-motion: reduce)');
  let folded = narrowPage.matches || !!kept.remarksFolded; // a narrow page starts folded; the window then opens over the page
  let startDecided = false; // a file tab with notes starts folded too: see draw
  const shut = new Set(kept.shutGroups ?? []); // the categories that the owner folded: "comments", "points"
  let showResolved = false;
  let selected = null; // the thread whose card is lit
  let draft = null; // the comment box that he stuck on the page: { target, point, el }
  const typed = {}; // what each field holds while the window draws again, by thread id, "p<point id>" or "new"
  let picking = null; // after the key, the pointer is a comment icon and the next click sticks the box: { lines, at }
  let ownKeyAt = 0; // when the page itself took the remark key: VS Code passes the same key press on once more
  let asking = null; // the small window that asks before a comment with text is thrown away

  // VS Code learns when the pointer is on the page, so the key works here even when the focus is in an editor.
  // It is said again now and then, so a missed message does not leave the key with the wrong owner.
  let saidAt = 0;
  document.addEventListener('mousemove', () => {
    if (Date.now() - saidAt > 250) { saidAt = Date.now(); tell({ type: 'pointer', on: true }); }
  });
  const away = () => { saidAt = 0; Hover.hide(); };
  document.addEventListener('mouseout', (event) => {
    if (!event.relatedTarget) { away(); tell({ type: 'pointer', on: false }); } // the pointer left the page
  });
  window.addEventListener('message', (event) => { if (event.data?.type === 'away') away(); }); // VS Code saw work in an editor

  // A click outside the open box removes it; with text in it, a small window asks first. That click does nothing else.
  let swallow = false;
  document.addEventListener('mousedown', (event) => {
    swallow = false;
    if (!draft || draft.sending || draft.el.contains(event.target) || mentions?.el.contains(event.target) || asking?.contains(event.target)) return;
    const typedNow = draft.el.querySelector('[data-field]').innerText.trim();
    if (!typedNow || typedNow === draft.start) return closeBox(); // nothing, or only the words that the look starts it with
    event.preventDefault();
    swallow = true;
    askToDiscard();
  }, true);

  document.addEventListener('click', (event) => {
    if (swallow) { swallow = false; event.preventDefault(); event.stopPropagation(); return; }
    if (picking) {
      event.preventDefault();
      event.stopPropagation();
      const thing = picking.lines ?? thingAt(event.target)?.target;
      if (!thing) return; // nothing to comment on here: the pointer stays a comment icon
      stopPicking();
      openBox(thing, { x: event.clientX, y: event.clientY });
      return;
    }
    // A circle on a part or a note, or code lines with a thread, bring up their card.
    const circle = event.target.closest?.('.rk[data-thread]');
    const row = !event.metaKey && getSelection().isCollapsed && event.target.closest?.('.cn .code .l[data-thread]');
    if (circle || row) {
      event.preventDefault();
      event.stopPropagation();
      return bringUp(Number((circle || row).dataset.thread));
    }
  }, true);
  narrowPage.addEventListener('change', () => { folded = narrowPage.matches || !!kept.remarksFolded; draw(); });

  /** A code line under an element: its row, its line, and its file from the code view, the Diffs page or the window around it. A removed line counts in the file as it was. */
  const rowAt = (el) => {
    const row = el?.closest('[data-line], [data-old]');
    const removed = !row?.dataset.line;
    return row && { row, line: Number(removed ? row.dataset.old : row.dataset.line), removed, file: row.closest('[data-file]')?.dataset.file ?? App.state.file };
  };
  const linesTarget = (file, lines, removed = false) => ({ kind: 'lines', file, lines, ...(removed ? { removed } : {}), label: `${file}, ${removed ? 'removed ' : ''}${linesText(lines)}` });

  /**
   * The smallest thing under the pointer: a code line, else the nearest marked thing (a file name inside a part wins over the part,
   * a part over the diagram), else the file of a file tab. Returns its target and the elements that draw it.
   */
  function thingAt(el) {
    const marked = el.closest('[data-remark]');
    const code = rowAt(el);
    if (code && (!marked || marked.contains(code.row))) return { target: linesTarget(code.file, [code.line, code.line], code.removed), els: [code.row] };
    if (marked) {
      const around = marked.parentElement.closest('svg, .win, .paper') ?? document;
      return { target: JSON.parse(marked.dataset.remark), els: [...around.querySelectorAll(`[data-rk="${CSS.escape(marked.dataset.rk)}"]`)] };
    }
    return App.tab ? { target: { kind: 'file', file: App.tab, label: `File ${App.tab}` }, els: [] } : null;
  }

  /** The quiet outline on the thing that a click would comment on. */
  function aim(els = []) {
    document.querySelectorAll('.aim').forEach((el) => el.classList.remove('aim'));
    els.forEach((el) => el.classList.add('aim'));
  }
  let pointerAt = null; // the last place of the pointer, where the quick comment box opens
  document.addEventListener('mouseover', (event) => {
    pointerAt = { x: event.clientX, y: event.clientY };
    if (picking && !picking.lines) aim(thingAt(event.target)?.els);
  });

  /** The whole of what the page shows now: the file of a file tab, else the diagram in view, else the diagram of the change. */
  function wholeView() {
    const file = App.tab ?? (App.state?.view === 'code' ? App.state.file : undefined);
    if (file) return Places.target({ kind: 'file', file });
    const diagram = document.querySelector('#view svg[data-remark]');
    return diagram ? JSON.parse(diagram.dataset.remark) : Places.target({ kind: 'diagram' });
  }

  function stopPicking() {
    picking = null;
    document.body.classList.remove('picking');
    aim();
  }

  /**
   * Code lines that the owner selected in the code view, the Diffs page or a window, as a remark target.
   * Removed lines and other lines count in two files: a selection over both keeps the lines of the file as it is now.
   */
  function selectedLines() {
    const selection = getSelection();
    if (!selection || selection.isCollapsed) return null;
    const lineOf = (node) => rowAt(node?.nodeType === 1 ? node : node?.parentElement);
    let [a, b] = [lineOf(selection.anchorNode), lineOf(selection.focusNode)];
    if (!a || !b || a.file !== b.file) return null;
    if (a.removed !== b.removed) a = b = a.removed ? b : a;
    return linesTarget(a.file, [Math.min(a.line, b.line), Math.max(a.line, b.line)], a.removed);
  }

  /**
   * The remark key: the pointer becomes a comment icon, and the next click sticks the box there. Esc, or the key again, switches it back.
   * A hover window that the pointer is in stays, so a line or a test in it can hold the comment.
   * VS Code may pass on the same key press a moment later; that one changes nothing.
   */
  function open() {
    if (!App.page) return; // nothing here holds a comment: the graphs page, or Home with no map
    if (App.state?.view === 'conversation') return pullPage()?.focusComment(); // the conversation has its own comment field
    if (App.page.pullOnly && !App.page.pullOnly.local) return; // no code here to comment on
    if (!document.querySelector('.win:hover')) Hover.hide();
    if (draft) return focusField(draft.el, 'new');
    if (picking) return Date.now() - picking.at > 300 && stopPicking();
    picking = { lines: selectedLines(), at: Date.now() };
    document.body.classList.add('picking');
    if (!picking.lines) aim(thingAt([...document.querySelectorAll(':hover')].pop() ?? document.body)?.els);
  }

  /** The small comment box, stuck where he clicked: the name of the thing in quiet text, and the field with the cursor. */
  function openBox(target, at) {
    const { point, ...place } = target;
    const github = pullPage()?.codeLine(place) ?? '';
    const el = html(`<div class="cbox"><div class="ch">${whereHtml(place)}</div>${fieldHtml('new', W.comment)}<p class="cbline"${github ? '' : ' hidden'}>${esc(github)}</p></div>`);
    document.body.append(el);
    placeBox(el, at);
    draft = { target: place, point, el };
    // The words that the field starts with, from a rule of "comment-box" of the look of the repo.
    const look = App.page?.look;
    const fields = { on: place.label ?? '' };
    const words = look && typeof Marks === 'object' && Marks.resolve(look.rules, { kind: 'comment-box', diagram: place.diagram, fields }, look.one).content?.words;
    if (words) {
      const field = el.querySelector('[data-field="new"]');
      field.innerHTML = Marks.fillWords(esc(words), fields);
      draft.start = field.innerText.trim(); // only these words in the field count as nothing typed
    }
    focusField(el, 'new');
  }

  /** The comment box on a thing of the page, at its middle: the target "comment" of a look. A thing that holds no comment opens nothing. */
  function boxOn(el) {
    const marked = el?.closest?.('[data-remark]');
    if (!App.page || !marked || draft) return;
    const box = el.getBoundingClientRect();
    openBox(JSON.parse(marked.dataset.remark), { x: box.left + box.width / 2, y: box.top + box.height / 2 });
  }

  /** Puts the box at a point, moved in where it would leave the tab, up to 8 px from the edge. */
  function placeBox(el, at) {
    const left = Math.max(8, Math.min(at.x, innerWidth - el.offsetWidth - 8));
    const top = Math.max(8, Math.min(at.y, innerHeight - el.offsetHeight - 8));
    Object.assign(el.style, { left: `${left}px`, top: `${top}px` });
  }
  addEventListener('resize', () => draft && placeBox(draft.el, { x: draft.el.offsetLeft, y: draft.el.offsetTop })); // a narrower tab keeps the box in it

  /** "Discard this comment?" under the box, with "Discard" and "Keep writing". */
  function askToDiscard() {
    if (asking) return;
    asking = html(`<div class="cbox ask"><span>${esc(W.discard)}</span><a data-discard>${esc(W.discardIt)}</a><a data-keep>${esc(W.keepWriting)}</a></div>`);
    document.body.append(asking);
    const box = draft.el.getBoundingClientRect();
    const below = box.bottom + 6 + asking.offsetHeight <= innerHeight;
    Object.assign(asking.style, { left: `${box.left}px`, top: `${below ? box.bottom + 6 : box.top - 6 - asking.offsetHeight}px` });
    asking.addEventListener('click', (event) => {
      if (event.target.closest('[data-discard]')) closeBox();
      if (!event.target.closest('[data-keep]')) return;
      asking.remove();
      asking = null;
      focusField(draft.el, 'new');
    });
  }

  function closeBox() {
    closeMentions();
    draft?.el.remove();
    asking?.remove();
    draft = asking = null;
    delete typed.new;
  }

  // ----- threads and open points -----

  /** The remarks grouped by thread, in the order of their first remark. */
  const threads = () => Marks.threadsOf(App.page.remarks);
  const isResolved = (thread) => thread.every((remark) => remark.state === 'closed');
  const threadOf = (id) => threads().find((thread) => thread[0].id === id);
  const points = () => App.page.openPoints ?? [];

  /** Where a target stands on the page: the order of its part, then its file, then its first line. */
  function placeKey(target) {
    const parts = App.page.parts;
    const owner = target.part ?? parts.find((part) => part.files.includes(target.file))?.id;
    const index = parts.findIndex((part) => part.id === owner);
    return [index < 0 ? parts.length : index, target.file ?? '', target.lines?.[0] ?? 0];
  }
  const byPlace = (a, b) => {
    const [x, y] = [placeKey(a), placeKey(b)];
    return x[0] - y[0] || x[1].localeCompare(y[1]) || x[2] - y[2];
  };
  /** The open threads, in the order of their places on the page. */
  const openThreads = () => threads().filter((thread) => !isResolved(thread)).sort((a, b) => byPlace(a[0].target, b[0].target));

  // ----- the look of the comments window, its threads, its open points and the comment marks (build 60) -----

  const lookOf = (thing) => Marks.slotsIn(App.page?.look, thing);
  /** Rows of the window in the order that a rule of the look gives them ("order"), with their things; with no rule, as they came. Returns [{ group, rows }]. */
  const lookOrder = (rows) => (App.page?.look ? Marks.orderRows(rows, Marks.listOrder(rows, App.page.look)) : [{ group: undefined, rows }]);
  /** The cards of the open threads in the order of the look: [{ thread, slots }]. */
  const threadRows = (open) => lookOrder(open.map((thread) => ({ ...Marks.threadThing(thread), thread })))[0].rows.map((row) => ({ thread: row.thread, slots: lookOf(row) }));
  /** The open points that the look shows, in its order and groups: [{ group, rows: [point] }]. A count of open points still counts them all. */
  const pointGroups = (sorted) => lookOrder(sorted.map((point) => ({ ...Marks.pointThing(point, App.page), point })).filter((row) => lookOf(row)['show.shown'] !== false))
    .map(({ group, rows }) => ({ group, rows: rows.map((row) => ({ point: row.point, slots: lookOf(row) })) }));

  /** The place of an open point, as a remark target: a node or an arrow of a diagram, a link between parts (an edge with no diagram), or code lines. */
  const pointTarget = (point) => (point.diagram || point.edge
    ? Places.target(point.node ? { kind: 'node', diagram: point.diagram, node: point.node } : { kind: 'edge', diagram: point.diagram, edge: point.edge, name: point.name })
    : {
      kind: 'open-point', file: point.file, lines: point.lines,
      label: point.file ? `${baseName(point.file)}${point.lines ? `, ${linesText(point.lines)}` : ''}` : 'Open point',
    });

  // ----- saving and acting -----

  /** Saves the text of a field: a new thread from the box, a reply, or a thread on an open point. Its first mention sends it to that agent, or to GitHub. */
  function save(key, field) {
    const text = field.innerText.replace(/ /g, ' ').trim();
    if (!text) return;
    const named = field.querySelector('[data-mention]')?.dataset.mention;
    if (key === 'new' && named === 'github') return sendToGitHub(field, text);
    if (key === 'new' && App.page.pullOnly) return boxLine(pullPage().WRITE.onlyGitHub, true); // a page with no stored change keeps no comment
    const choice = choices(key).find((one) => one.name === named);
    const to = choice && { app: choice.app, kind: choice.kind };
    const thread = /^\d+$/.test(key) ? threadOf(Number(key)) : null;
    const point = key.startsWith('p') ? points().find((one) => `p${one.id}` === key) : null;
    const target = thread ? thread[0].target : point ? pointTarget(point) : draft.target;
    const pointId = point?.id ?? (key === 'new' ? draft.point : undefined);
    tell({ type: 'remark', target, point: pointId, text, thread: thread?.[0].id, to });
    // The page shows it at once; inside VS Code the saved data that follows takes its place.
    const id = Math.max(0, ...App.page.remarks.map((remark) => remark.id)) + 1;
    App.page.remarks.push({ id, changeId: App.page.changeId, target, text, thread: thread?.[0].id, to, createdAt: new Date().toISOString(), state: to ? 'sent' : 'open' });
    if (point) point.used = true;
    delete typed[key];
    if (key !== 'new') return App.render();
    const box = draft.el;
    draft = null;
    closeMentions();
    folded = false;
    shut.delete('comments');
    selected = id;
    App.render().then(() => flyIn(box, id));
  }

  /** The quiet line of the box: what "@github" does, why it is not offered, "Sending…", or GitHub's sentence of a failed send. */
  function boxLine(text, error = false) {
    const line = draft?.el.querySelector('.cbline');
    if (!line) return;
    line.textContent = text;
    line.hidden = !text;
    line.classList.toggle('err', error);
  }

  /**
   * A comment with "@github": posted on these lines of the pull request, once. The box is locked while it goes; when it went through the box closes,
   * and the page reads the pull request again; when it failed the text stays and GitHub's sentence stands in the box.
   */
  async function sendToGitHub(field, text) {
    if (draft.sending) return;
    const box = draft;
    box.sending = true;
    field.contentEditable = 'false';
    boxLine(pullPage().WRITE.sending);
    const result = await pullPage().sendCode(box.target, text.replace(/(^|\s)@github\b\s?/, '$1').trim());
    box.sending = false;
    if (draft !== box) return;
    field.contentEditable = 'true';
    if (result.problem) {
      boxLine(result.problem, true);
      return focusField(box.el, 'new');
    }
    closeBox();
  }

  /** Moves the saved box to its card in the window in a quarter of a second, and the card takes its place. No movement with reduced motion. */
  function flyIn(box, id) {
    const card = side.querySelector(`.thread[data-thread="${id}"]`);
    if (!card || stillPage.matches) return box.remove();
    side.scrollTop = Math.max(0, card.offsetTop - side.querySelector('.sh').offsetHeight - 8);
    const from = box.getBoundingClientRect();
    const to = card.getBoundingClientRect();
    card.style.visibility = 'hidden';
    const move = box.animate([
      { transform: 'none' },
      { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`, opacity: 0.4 },
    ], { duration: 250, easing: 'ease-in-out' });
    move.onfinish = () => { box.remove(); card.style.visibility = ''; };
  }

  /** Resolve, Reopen or Start a run. As a file in a browser the page changes the states itself. */
  function act(id, action) {
    tell({ type: 'remarkAction', id, action });
    if (vscodeApi || action === 'start') return;
    for (const remark of threads().find((thread) => thread.some((one) => one.id === id))) {
      if (action === 'resolve') remark.state = 'closed';
      if (action === 'reopen' && remark.state === 'closed') remark.state = remark.answer ? 'done' : 'open';
    }
    App.render();
  }

  // ----- the place of a thread on the page -----

  // Code lines, notes and tests are places in the code; the code view lights them with a mark, since its rows are drawn as he scrolls.
  // A thing that the change file no longer holds points to the nearest thing that is still there.
  const placeOf = (target) => (Places.isGone(target) ? Places.nearest(target) : target);
  const inCode = (target) => !!target && Places.viewOf(target) === 'code';
  const codeShows = (target) => inCode(target) && Code.shown?.path === target.file;
  const FLASH_MS = 1600;

  /** Goes to the view that shows a target when it is not drawn now, moves the surface to it and lights it for a moment, as code lines are lit. */
  async function showPlace(shown) {
    const target = placeOf(shown);
    const list = typeof Split === 'object' ? Split.list : null; // Home has no halves
    if (list && target.file && await list.reveal(target)) return; // the diffs beside the diagram hold its file: its diff opens there
    if (inCode(target)) {
      if (!codeShows(target)) { App.showCode(target.file, target.lines); await App.drawing; }
      if (!codeShows(target)) return; // VS Code shows it in the tab of the file
      Code.reveal(target);
      Code.mark('flash', target);
      return setTimeout(() => Code.mark('flash', null), FLASH_MS);
    }
    const view = Places.viewOf(target);
    if (App.tab) return tell({ type: 'showChange', go: view === 'diffs' ? { view: 'diffs' } : view, place: shown }); // a file tab: the change page shows it and lights it
    if (view === 'diffs' ? App.state.view !== 'diffs' : !Places.find(target).length) {
      if (view === 'diffs') App.showDiffs();
      else App.go(view);
      await App.drawing;
    }
    const found = Places.find(target);
    const surface = found[0]?.closest('.surface')?.surface;
    if (surface && found[0].tagName !== 'svg') surface.show(found[0]);
    else found[0]?.scrollIntoView({ block: 'center' });
    for (const el of found) el.classList.add('flash');
    setTimeout(() => found.forEach((el) => el.classList.remove('flash')), FLASH_MS);
  }

  let lit = false; // a card lights its place now

  /** Lights the place of a target quietly while the pointer is on its card. */
  function lightPlace(shown) {
    const target = shown && placeOf(shown);
    lit = !!target;
    document.querySelectorAll('.near').forEach((el) => el.classList.remove('near'));
    if (Code.shown) Code.mark('near', codeShows(target) ? target : null);
    if (target && !inCode(target)) Places.find(target).forEach((el) => el.classList.add('near'));
  }

  /** Opens the window and brings the card of a thread to the top, lit. */
  function bringUp(id) {
    folded = false;
    shut.delete('comments');
    selected = id;
    draw();
    const card = side.querySelector(`.thread[data-thread="${id}"]`);
    if (card) side.scrollTop = card.offsetTop - side.querySelector('.sh').offsetHeight;
  }

  // ----- what the page shows -----

  const ofPart = (thread, part) => thread[0].target.part === part.id || part.files.includes(thread[0].target.file);
  const ofNote = (thread, note) => thread[0].target.kind === 'note' && thread[0].target.file === note.file && thread[0].target.lines?.[0] === note.lines[0]
    && !thread[0].target.removed === !note.removed;

  /** The circle on a thing: the number of its open threads, in the state of the newest; a click brings up the first card. A rule of the look on the comment mark gives its colour and an icon, or leaves it out. */
  const circle = (list) => {
    const slots = list.length ? lookOf({ kind: 'comment-mark', fields: { count: list.length } }) : {};
    if (!list.length || slots['show.shown'] === false) return '';
    const html = States.circleHtml(list.length, States.circleOf(States.threadLead(list[list.length - 1])), list[0][0].id);
    return slots['text.color'] || slots['text.icon'] ? markLook(html, slots) : html;
  };

  /** A circle in the colour and with the icon of a rule of the look. */
  function markLook(html, slots) {
    const el = document.createElement('i');
    el.innerHTML = html;
    Marks.paintText(el.firstChild, App.page.look, slots);
    return el.innerHTML;
  }

  /**
   * A circle on a drawn thing: after the text of an HTML thing (a file name, a title row); on a drawn box a small SVG circle
   * at its top right corner, and beside a line of SVG text, as a message of a sequence diagram. A label that Mermaid measured has no room for it.
   */
  function putCircle(els, list) {
    const html = els.find((el) => el instanceof HTMLElement);
    if (html) return html.insertAdjacentHTML('beforeend', circle(list));
    const el = els.find((one) => one.tagName === 'g') ?? els.find((one) => one.tagName === 'text');
    if (!el) return;
    const box = el.getBBox();
    const [x, y] = el.tagName === 'g' ? [box.x + box.width, box.y] : [box.x + box.width + 12, box.y + box.height / 2];
    const look = States.circleOf(States.threadLead(list[list.length - 1]));
    const slots = lookOf({ kind: 'comment-mark', fields: { count: list.length } });
    if (slots['show.shown'] === false) return;
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    ring.setAttribute('class', `rk svg ${look}`);
    ring.dataset.thread = list[0][0].id;
    const icon = App.page.look?.files[slots['text.icon']];
    ring.innerHTML = `<circle cx="${x}" cy="${y}" r="8"/>${icon ? `<image href="${esc(icon)}" x="${x - 20}" y="${y - 6}" width="12" height="12"/>` : ''}<text x="${x}" y="${y}">${list.length}</text>`;
    if (slots['text.color']) Marks.paint(ring, 'words', Marks.lineColors(slots['text.color'], Marks.READS));
    if (el.tagName === 'g') el.append(ring);
    else el.after(ring);
  }

  // Parts, the files in no part, notes and code lines have circles of their own; every other thing gets one on itself.
  const OWN_CIRCLES = new Set(['part', 'no-part', 'note', 'lines', 'open-point']);

  /**
   * Circles on parts, on the files in no part, on notes and on every other drawn thing with an open thread; code lines with a thread take a click.
   * With `only`, only inside `view`: a diagram drawn after the page (beside "Diffs") gets its circles, and the things drawn before get none twice.
   */
  function paint(view, only = false) {
    const open = openThreads();
    for (const title of view.querySelectorAll('b[data-part]')) {
      const part = App.page.parts.find((candidate) => candidate.id === title.dataset.part);
      title.insertAdjacentHTML('beforeend', circle(open.filter((thread) => ofPart(thread, part))));
    }
    const noPart = view.querySelector('b[data-nopart]');
    if (noPart) noPart.insertAdjacentHTML('beforeend', circle(open.filter((thread) => App.page.checks.filesInNoPart.includes(thread[0].target.file))));
    paintNotes(view, open);
    const byThing = new Map();
    for (const thread of open.filter((one) => !OWN_CIRCLES.has(one[0].target.kind))) {
      const key = Places.keyOf(thread[0].target);
      byThing.set(key, [...(byThing.get(key) ?? []), thread]);
    }
    for (const list of byThing.values()) {
      const els = Places.find(list[0][0].target).filter((el) => !only || view.contains(el));
      if (els.length) putCircle(els, list);
    }
    if (!Code.shown || only) return;
    const byLine = new Map(); // the first thread of each code line
    for (const thread of open.filter((one) => codeShows(one[0].target) && !one[0].target.removed).reverse()) { // removed lines have no line of the file now
      for (let line = thread[0].target.lines[0]; line <= thread[0].target.lines[1]; line++) byLine.set(line, thread[0].id);
    }
    Code.mark('threads', byLine);
  }

  /** The circle on the title of each note in an element: the Diffs page fills its files as they come into view. */
  function paintNotes(el, open = openThreads()) {
    for (const title of el.querySelectorAll('[data-note]')) {
      const note = App.page.notes.find((candidate) => candidate.key === title.dataset.note);
      title.insertAdjacentHTML('beforeend', circle(open.filter((thread) => ofNote(thread, note))));
    }
  }

  const clock = (moment) => (moment ? new Date(moment).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
  const MENTION = new RegExp(`@(${Object.values(States.MENTION_WORDS).join('|')})-(current|new)\\b`, 'g');

  /** Text of a comment as HTML, with each mention in the teal ink. */
  const textHtml = (text) => esc(text).replace(MENTION, (mention) => `<span class="mention">${mention}</span>`);

  /** One message of a thread: who wrote it, when, and the text. */
  const messageHtml = (who, moment, text) => `<div class="msg"><div class="who">${who}<span class="at">${esc(clock(moment))}</span></div><div class="tx">${textHtml(text)}</div></div>`;
  /** Who answered a remark: the app it was sent to, else the agent of the change. */
  const agentWho = (remark) => {
    const app = remark.to?.app ?? App.page.agent?.app;
    return app ? `${agentIcon({ app })}${esc(appName({ app }))}` : 'Agent';
  };

  /** The quiet state line of a thread, with the way on that fits it. */
  function stateOf(remark) {
    const { agent, listening } = App.page;
    const line = States.remarkLine(remark, agent, listening);
    const link = (text, attrs) => `<a ${attrs}>${esc(text)}</a>`;
    // The session that works or worked on it: a click opens it, in its app or in a terminal that continues it.
    const session = remark.run?.session || (remark.to?.kind !== 'new' && agent?.session) ? link(W.session, `data-session="${remark.id}"`) : '';
    if (remark.state === 'running' || remark.state === 'done') {
      const since = remark.state === 'running' && remark.run?.startedAt ? esc(W.since(clock(remark.run.startedAt))) : '';
      return States.lineHtml(line, [since, session].filter(Boolean).map((bit) => ` · ${bit}`).join(''));
    }
    const more = {
      listening: ` · ${esc(W.listening)}`,
      connect: ` · ${agent?.link ? link(W.openSession, `data-link="${esc(agent.link)}"`) : esc(W.openSession)}, or ${link(W.connect, 'data-connect')}`,
      start: ` · ${link(W.startRun, `data-start="${remark.id}"`)}`,
    }[line.way] ?? '';
    return States.lineHtml(line, more);
  }

  const fieldHtml = (key, placeholder) => `<div class="field" contenteditable="true" data-field="${key}" data-placeholder="${esc(placeholder)}"></div>`;
  /** The name of a thing in quiet text; a thing that the change file no longer holds says so. */
  const whereHtml = (target) => `<span class="where">${esc(target.label ?? target.kind)}${App.page && Places.isGone(target) ? `<span class="gone-place"> · ${esc(W.goneFromDiagram)}</span>` : ''}</span>`;

  /** One card: its place, the comments and answers in order, the state line and the reply field; a rule of the look names which show, in its order ("content.fields"). */
  function cardHtml(thread, slots = {}) {
    const messages = thread.map((remark) => messageHtml(esc(W.you), remark.createdAt, remark.text)
      + (remark.answer ? messageHtml(agentWho(remark), remark.answeredAt, remark.answer) : '')).join('');
    const parts = { where: `<div class="ch">${whereHtml(thread[0].target)}<a data-resolve>${esc(W.resolve)}</a></div>`, messages, state: stateOf(States.threadLead(thread)), reply: fieldHtml(thread[0].id, W.reply) };
    return `<div class="thread${thread[0].id === selected ? ' cur' : ''}" data-thread="${thread[0].id}">${(slots.content?.fields ?? Object.keys(parts)).map((field) => parts[field]).join('')}</div>`;
  }

  /** One open point: its text and its place, and a field whose reply starts a thread tied to it. */
  const pointHtml = (point) => `<div class="point" data-point="${point.id}"><div class="ch">${whereHtml(pointTarget(point))}</div>`
    + `<div class="tx">${esc(point.text)}</div>${fieldHtml(`p${point.id}`, W.reply)}</div>`;

  /** The head of a category: its fold, its name and its count; the first head also folds the window. */
  const groupHead = (key, name, count, first) => `<div class="sh${shut.has(key) ? ' shut' : ''}"><a class="grp" data-group="${key}"><span class="chev"></span><b>${esc(name)}</b><span class="n">${count}</span></a>`
    + (first ? `<a class="fold" data-fold title="${esc(W.fold)}">›</a>` : '') + '</div>';

  /** Draws the window: hidden when it holds nothing, folded to a rail, or the two categories, each with its count. */
  function draw() {
    if (!App.page) return;
    // In a file tab with notes the window lies over the notes column (look.css), so it starts folded there until he opens it.
    // A rule of the look on the comments window: its width, its colour, and folded at the start.
    const own = lookOf({ kind: 'comments-window', fields: {} });
    if (!startDecided) {
      startDecided = true;
      if (kept.remarksFolded === undefined && (own['show.folded'] || App.page.notes?.some((note) => note.file === App.tab))) folded = true;
    }
    side.style.width = own['window.width'] && !folded && !narrowPage.matches ? `${own['window.width']}px` : ''; // a narrow page keeps its own width
    document.body.style.setProperty('--side-room', own['window.width'] ? `${own['window.width'] + 16}px` : '');
    side.classList.remove('lk-fill', 'lk-ink', 'lk-line');
    Marks.paintBox(side, own);
    if (!draft) closeMentions();
    const focused = side.contains(document.activeElement) ? document.activeElement.dataset.field : undefined;
    const open = openThreads();
    const resolved = threads().filter(isResolved);
    const empty = !open.length && !resolved.length && !points().length;
    side.hidden = empty;
    side.classList.toggle('folded', folded);
    document.body.classList.toggle('with-side', !empty && !folded);
    document.body.classList.toggle('with-rail', !empty && folded);
    if (empty) return void (side.innerHTML = '');
    if (folded) {
      side.innerHTML = `<a class="rail" data-unfold title="${esc(W.unfold)}">${open.length + points().length}</a>`;
      return;
    }
    const resolvedHtml = !resolved.length ? '' : `<a class="resolved" data-show-resolved>${esc(W.resolved(resolved.length))}</a>`
      + (showResolved ? resolved.map((thread) => `<div class="thread gone" data-thread="${thread[0].id}"><div class="ch">${whereHtml(thread[0].target)}<a data-reopen>${esc(W.reopen)}</a></div>`
        + `<div class="msg"><div class="tx">${textHtml(thread[0].text)}</div></div>`
        + (thread[0].closedBy ? `<span class="state">${esc(W.resolvedBy(appName({ app: thread[0].closedBy })))}</span>` : '') + '</div>').join('') : '');
    const groups = [];
    if (open.length || resolved.length) {
      groups.push(groupHead('comments', W.comments, open.length || '', true) + (shut.has('comments') ? '' : threadRows(open).map(({ thread, slots }) => cardHtml(thread, slots)).join('') + resolvedHtml));
    }
    if (points().length) {
      const sorted = [...points()].sort((a, b) => byPlace(pointTarget(a), pointTarget(b)));
      const inGroups = pointGroups(sorted);
      groups.push(groupHead('points', W.openPoints, sorted.length, !groups.length) + (shut.has('points') ? '' : inGroups.map(({ group, rows }) => (group !== undefined && inGroups.length ? `<div class="pgroup">${esc(group || 'none')}</div>` : '')
        + rows.map(({ point }) => pointHtml(point)).join('')).join('')));
    }
    side.innerHTML = groups.join('');
    // The colour of a thread that a rule gives it, and the colour and icon of an open point: on the card itself.
    for (const { thread, slots } of threadRows(open)) { const card = side.querySelector(`.thread[data-thread="${thread[0].id}"]`); if (card) Marks.paintBox(card, slots); }
    for (const { point, slots } of pointGroups(points()).flatMap((group) => group.rows)) {
      const where = side.querySelector(`.point[data-point="${point.id}"] .ch`);
      if (where) Marks.paintText(where, App.page.look, slots);
    }
    for (const field of side.querySelectorAll('[data-field]')) if (typed[field.dataset.field]) field.innerHTML = typed[field.dataset.field];
    if (focused) focusField(side, focused);
  }

  /** Puts the cursor at the end of a field. */
  function focusField(within, key) {
    const field = within.querySelector(`[data-field="${key}"]`);
    if (!field) return;
    field.focus();
    getSelection().selectAllChildren(field);
    getSelection().collapseToEnd();
  }

  function setFolded(fold) {
    folded = fold;
    if (!narrowPage.matches) keep({ remarksFolded: fold });
    draw();
  }

  side.addEventListener('click', (event) => {
    const target = event.target;
    const card = target.closest('.thread[data-thread]');
    const id = Number(card?.dataset.thread);
    if (target.closest('[data-fold]')) return setFolded(true);
    if (target.closest('[data-unfold]')) return setFolded(false);
    const group = target.closest('[data-group]');
    if (group) {
      if (!shut.delete(group.dataset.group)) shut.add(group.dataset.group);
      keep({ shutGroups: [...shut] });
      return draw();
    }
    if (target.closest('[data-resolve]')) return act(id, 'resolve');
    if (target.closest('[data-reopen]')) return act(id, 'reopen');
    if (target.closest('[data-start]')) return act(Number(target.closest('[data-start]').dataset.start), 'start');
    if (target.closest('[data-connect]')) return tell({ type: 'connect' });
    if (target.closest('[data-session]')) return tell({ type: 'openSession', id: Number(target.closest('[data-session]').dataset.session) });
    if (target.closest('[data-show-resolved]')) { showResolved = !showResolved; return draw(); }
    if (target.closest('a, [data-field]')) return;
    const point = target.closest('.point');
    if (point) {
      const found = points().find((one) => one.id === Number(point.dataset.point));
      if (narrowPage.matches) setFolded(true);
      return found.file && showPlace(pointTarget(found));
    }
    if (!card || card.classList.contains('gone')) return;
    selected = id;
    side.querySelectorAll('.thread.cur').forEach((other) => other.classList.toggle('cur', other === card));
    card.classList.add('cur');
    if (narrowPage.matches) setFolded(true); // the window lies over the page: fold it to show the place
    showPlace(threadOf(id)[0].target);
  });
  side.addEventListener('mouseover', (event) => {
    const card = event.target.closest('.thread[data-thread], .point');
    const point = card?.classList.contains('point') && points().find((one) => one.id === Number(card.dataset.point));
    lightPlace(point ? pointTarget(point) : card && !card.classList.contains('gone') ? threadOf(Number(card.dataset.thread))?.[0].target : null);
  });
  side.addEventListener('mouseleave', () => lightPlace(null));
  // No leave event comes when the card under the pointer is drawn again or folded away, so the pointer on anything outside the window puts the light out too.
  document.addEventListener('mouseover', (event) => { if (lit && !side.contains(event.target)) lightPlace(null); });

  // ----- writing, in the box and in the window: Enter saves, Shift+Enter makes a new line, Esc closes, @ names the agent -----

  document.addEventListener('keydown', (event) => {
    const field = event.target.closest?.('[data-field]');
    if (!field) {
      if (event.metaKey && event.shiftKey && (event.key === '.' || event.code === 'Period')) { event.preventDefault(); ownKeyAt = Date.now(); open(); }
      if (event.key === 'Escape' && picking) stopPicking();
      // The quick comment: Enter after the key, with no click, sticks the box on the whole of what the page shows (or on the selected lines).
      if (event.key === 'Enter' && picking) {
        event.preventDefault();
        const thing = picking.lines ?? wholeView();
        stopPicking();
        openBox(thing, pointerAt ?? { x: innerWidth / 2 - 160, y: 80 });
      }
      return;
    }
    event.stopPropagation();
    const key = field.dataset.field;
    if (mentions && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); return moveLit(event.key === 'ArrowDown' ? 1 : -1); }
    if (mentions && (event.key === 'Enter' || event.key === 'Tab')) { event.preventDefault(); return insertMention(); }
    if (mentions && event.key === 'Escape') return closeMentions();
    if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); document.execCommand('insertLineBreak'); return; }
    if (event.key === 'Enter') { event.preventDefault(); return save(key, field); }
    if (event.key !== 'Escape') return;
    if (key === 'new') return closeBox();
    field.blur();
  }, true);
  document.addEventListener('input', (event) => {
    const field = event.target.closest?.('[data-field]');
    if (!field) return;
    if (!field.innerText.trim() && !field.querySelector('[data-mention]')) field.innerHTML = ''; // the placeholder shows again
    typed[field.dataset.field] = field.innerHTML;
    lookForMention();
  });
  document.addEventListener('paste', (event) => {
    if (!event.target.closest?.('[data-field]')) return;
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
  });

  let mentions = null; // the open list: { el, ghost, node, at, typed, shown, lit } where "@" stands at `at` in a text node
  /** Whom "@" offers: the agents, and "@github" in the box on code lines that the open pull request takes. A page with no stored change offers GitHub only. */
  const choices = (key) => {
    const github = key === 'new' && draft ? pullPage()?.githubChoice(draft.target) : null;
    return [...(App.page.pullOnly ? [] : States.mentionChoices(App.page.agent, App.page.apps ?? [])), ...(github ? [github] : [])];
  };

  /** After each key: opens the list when "@" was typed, cuts it by the letters after "@", and closes it when nothing fits. */
  function lookForMention() {
    const selection = getSelection();
    const node = selection.focusNode;
    const before = node?.nodeType === 3 ? node.textContent.slice(0, selection.focusOffset) : '';
    const match = /(^|\s)@([a-z-]*)$/i.exec(before);
    const all = choices(node?.parentElement?.closest('[data-field]')?.dataset.field);
    const shown = match ? States.cutChoices(all, match[2]) : [];
    if (!match || (!shown.length && (all.length || match[2]))) return closeMentions();
    const lit = mentions ? Math.min(mentions.lit, Math.max(0, shown.length - 1)) : 0;
    mentions ??= { el: html('<div class="mentions"></div>'), ghost: html('<span class="ghost"></span>') };
    Object.assign(mentions, { node, at: before.length - match[2].length - 1, typed: match[2], shown, lit });
    document.body.append(mentions.el, mentions.ghost);
    drawMentions();
  }

  /** Draws the list under the cursor (above it when there is no room) and the grey rest of the lit name after the cursor. */
  function drawMentions() {
    const { el, ghost, shown, lit, typed } = mentions;
    el.innerHTML = shown.length
      ? shown.map((choice, index) => `<a class="opt${index === lit ? ' lit' : ''}" data-pick="${index}">${choice.app === 'github' ? '<i class="ico git-pull-request"></i>' : agentIcon(choice)}<span class="nm">${esc(choice.name)}</span><span class="does" title="${esc(choice.does)}">${esc(choice.does)}</span></a>`).join('')
      : `<p class="none">${esc(W.noAgent)}</p>`;
    const box = getSelection().getRangeAt(0).getBoundingClientRect();
    const below = box.bottom + 6 + el.offsetHeight <= innerHeight;
    el.style.left = `${Math.max(8, Math.min(box.left, innerWidth - el.offsetWidth - 8))}px`;
    el.style.top = `${below ? box.bottom + 6 : box.top - 6 - el.offsetHeight}px`;
    ghost.textContent = shown[lit]?.name.slice(typed.length) ?? '';
    Object.assign(ghost.style, { left: `${box.right}px`, top: `${box.top}px`, height: `${box.height}px`, lineHeight: `${box.height}px` });
    el.onmousedown = (pick) => {
      pick.preventDefault();
      const row = pick.target.closest('[data-pick]');
      if (row) { mentions.lit = Number(row.dataset.pick); insertMention(); }
    };
  }

  /** Up and Down move the lit row. */
  function moveLit(step) {
    const count = mentions.shown.length;
    if (!count) return;
    mentions.lit = (mentions.lit + step + count) % count;
    drawMentions();
  }

  function closeMentions() {
    mentions?.el.remove();
    mentions?.ghost.remove();
    mentions = null;
  }

  /** Puts the lit name into the text as one unit with a space after it, in place of "@" and what was typed after it. */
  function insertMention() {
    const { node, at, shown, lit } = mentions;
    closeMentions();
    const choice = shown[lit];
    if (!choice) return;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, getSelection().focusNode === node ? getSelection().focusOffset : node.textContent.length);
    range.deleteContents();
    const mention = html(`<span class="mention" contenteditable="false" data-mention="${esc(choice.name)}">@${esc(choice.name)}</span>`);
    const space = document.createTextNode(' ');
    range.insertNode(mention);
    mention.after(space);
    getSelection().collapse(space, 1);
    const field = mention.closest('[data-field]');
    typed[field.dataset.field] = field.innerHTML;
  }

  /**
   * The remark key as VS Code passes it on. When the page had the keyboard it took that key press itself already, and the copy from VS Code
   * can come late (the page waits with it until a drawing is done): it must not switch the comment pointer off again.
   */
  function openFromVsCode() {
    if (Date.now() - ownKeyAt < 2000) { ownKeyAt = 0; return; }
    open();
  }

  return { open, openFromVsCode, boxOn, paint, paintNotes, draw, show: showPlace };
})();
