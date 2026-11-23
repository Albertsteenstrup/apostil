// Comments at their place: a chat bubble with the icon of the agent app marks each thing that has a thread, a click on it opens the card of its threads
// beside the thing, and a count in the top bar opens a list of all of them. A new comment starts with the key and a click on a thing, in the same card.
// The picker under the box of a card says where a comment goes: a session of a connected agent app, the pull request on GitHub, or no agent.
// The code says "remark", as the store does; the page says "comment".
'use strict';

const Remarks = (() => {
  const W = States.WORDS;
  const pullPage = () => (typeof Conversation === 'object' ? Conversation : undefined); // the change page has a pull request; Home has none
  // The open card: { key, threads, reply, target, point, at, spot, el, choices, picked, menu }. key: "new" for a new comment, else the first thread of the card;
  // threads: the ids of its open threads; reply: the thread that the box answers; at: where a new card opened when it has no thing on the page;
  // spot: where the card stands on the page (onPage).
  let card = null;
  const typed = {}; // what each field holds while the card draws again, by its key
  let picking = null; // after the key, the pointer is a comment icon and the next click opens a card there: { lines, at }
  let ownKeyAt = 0; // when the page itself took the remark key: VS Code passes the same key press on once more
  let asking = null; // the small window that asks before a new comment with text is thrown away
  let list = null; // the open list of all comments under the count in the top bar: { el, points, resolved }
  let lastPick; // the choice that he made last on this page; before one, the choice of the newest comment of the repo (App.page.sendTo.last)
  let cards = 0; // the count of cards opened: the model of a run starts again in each new card

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

  // A click outside the card closes it; a new comment with text asks first, and that click does nothing else. A click outside the list closes it.
  let swallow = false;
  document.addEventListener('mousedown', (event) => {
    swallow = false;
    const inside = (el) => el?.contains(event.target);
    if (list && !inside(list.el) && !event.target.closest?.('[data-comments]')) closeList();
    if (mentions && !inside(mentions.el)) closeMentions(); // the names after "@" close on a click elsewhere, as a menu does
    // An open menu of the card (where it goes, or ⋯) closes on a click outside it; a click outside the card then does nothing else.
    if (card && (card.menu || card.moreOpen) && !event.target.closest?.('.pmenu, [data-pick], .moremenu, [data-more]')) {
      const more = card.moreOpen;
      Object.assign(card, { menu: false, moreOpen: false });
      if (more) drawCard();
      else redrawPicker();
      if (!inside(card.el)) { event.preventDefault(); swallow = true; return; }
    }
    if (!card || card.sending || inside(card.el) || inside(mentions?.el) || inside(asking)) return;
    const field = card.el.querySelector('[data-field="new"]');
    const typedNow = field?.innerText.trim();
    if (!typedNow || typedNow === card.start) return closeCard(); // nothing, or only the words that the look starts it with
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
      openNew(thing, { x: event.clientX, y: event.clientY });
      return;
    }
    // A mark, or code lines with a thread, open the card of their threads; the count in the top bar opens the list.
    const mark = event.target.closest?.('.cb[data-threads]:not(.cml *)');
    const row = !event.metaKey && getSelection().isCollapsed && event.target.closest?.('.cn .code .l[data-thread]');
    if (mark || row) {
      event.preventDefault();
      event.stopPropagation();
      return mark ? openCard(mark.dataset.threads.split(' ').map(Number), mark) : openCard(threadsOnLine(Number(row.dataset.thread)), row);
    }
    if (event.target.closest?.('[data-comments]')) {
      event.preventDefault();
      return list ? closeList() : openList();
    }
  }, true);

  /** A code line under an element: its row, its line, and its file from the code view, the Diffs page or the window around it. A removed line counts in the file as it was. */
  const rowAt = (el) => {
    const row = el?.closest('[data-line], [data-old]');
    const removed = !row?.dataset.line;
    return row && { row, line: Number(removed ? row.dataset.old : row.dataset.line), removed, file: row.closest('[data-file]')?.dataset.file ?? App.state.file };
  };
  const linesTarget = (file, lines, removed = false) => ({ kind: 'lines', file, lines, ...(removed ? { removed } : {}), label: `${file}, ${removed ? 'removed ' : ''}${linesText(lines)}` });

  /**
   * The smallest thing under the pointer: a code line, else the nearest marked thing (a file name inside a part wins over the part,
   * a part over the diagram, a message of a pull request), else the file of a file tab. Returns its target and the elements that draw it.
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
  let pointerAt = null; // the last place of the pointer, where the quick comment opens
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
   * The remark key: the pointer becomes a comment icon, and the next click opens a card there. Esc, or the key again, switches it back.
   * It works on every view, also on "Conversation", where a click on a message opens the card there. A hover window that the pointer is in stays,
   * so a line or a test in it can hold the comment. VS Code may pass on the same key press a moment later; that one changes nothing.
   */
  function open() {
    if (!App.page) return; // nothing here holds a comment: the graphs page, or Home with no map
    if (App.page.pullOnly && !App.page.pullOnly.local && App.state?.view !== 'conversation') return; // no code here to comment on
    if (!document.querySelector('.win:hover')) Hover.hide();
    if (card?.key === 'new') return focusField(card.el, 'new');
    if (picking) return Date.now() - picking.at > 300 && stopPicking();
    closeList();
    picking = { lines: selectedLines(), at: Date.now() };
    document.body.classList.add('picking');
    if (!picking.lines) aim(thingAt([...document.querySelectorAll(':hover')].pop() ?? document.body)?.els);
  }

  /** The card of a new comment on a thing, empty, with the cursor in its box. `point`: the open point that it answers. */
  function openNew(target, at, point) {
    const { point: fromNote, ...place } = target;
    closeCard();
    Hover.hide();
    card = { key: 'new', threads: [], target: place, point: point ?? fromNote, at, serial: ++cards };
    drawCard();
    // The words that the box starts with, from a rule of "comment-box" of the look of the repo.
    const look = App.page?.look;
    const fields = { on: place.label ?? '' };
    const words = look && typeof Marks === 'object' && Marks.resolve(look.rules, { kind: 'comment-box', diagram: place.diagram, fields }, look.one).content?.words;
    if (words) {
      const field = card.el.querySelector('[data-field="new"]');
      field.innerHTML = Marks.fillWords(esc(words), fields);
      card.start = field.innerText.trim(); // only these words in the box count as nothing typed
    }
    focusField(card.el, 'new');
  }

  /** The card of a new comment on a thing of the page, at its middle: the target "comment" of a look. A thing that holds no comment opens nothing. */
  function boxOn(el) {
    const marked = el?.closest?.('[data-remark]');
    if (!App.page || !marked || card?.key === 'new') return;
    const box = el.getBoundingClientRect();
    openNew(JSON.parse(marked.dataset.remark), { x: box.left + box.width / 2, y: box.top + box.height / 2 });
  }

  /** The card of open threads of one thing: they stand one under the other, and the box answers the newest. */
  function openCard(ids, from) {
    const shown = ids.map(threadOf).filter((thread) => thread && !isResolved(thread));
    if (!shown.length) return;
    closeCard();
    Hover.hide();
    const rect = from?.getBoundingClientRect();
    card = { key: shown[0][0].id, threads: shown.map((thread) => thread[0].id), reply: shown.at(-1)[0].id, target: shown[0][0].target, at: rect && { x: rect.right, y: rect.top }, serial: ++cards };
    drawCard();
  }

  /** "Discard this comment?" under the card, with "Discard" and "Keep writing". */
  function askToDiscard() {
    if (asking) return;
    asking = html(`<div class="cbox ask"><span>${esc(W.discard)}</span><a data-discard>${esc(W.discardIt)}</a><a data-keep>${esc(W.keepWriting)}</a></div>`);
    document.body.append(asking);
    const box = card.el.getBoundingClientRect();
    const below = box.bottom + 6 + asking.offsetHeight <= innerHeight;
    Object.assign(asking.style, { left: `${Math.max(8, Math.min(box.left, innerWidth - asking.offsetWidth - 8))}px`, top: `${below ? box.bottom + 6 : Math.max(8, box.top - 6 - asking.offsetHeight)}px` });
    asking.addEventListener('click', (event) => {
      if (event.target.closest('[data-discard]')) closeCard();
      if (!event.target.closest('[data-keep]')) return;
      asking.remove();
      asking = null;
      focusField(card.el, 'new');
    });
  }

  function closeCard() {
    closeMentions();
    asking?.remove();
    asking = null;
    if (!card) return;
    card.el?.remove();
    if (card.key === 'new') delete typed.new;
    card = null;
    lightLines(null);
    document.querySelectorAll('.cb.on').forEach((el) => el.classList.remove('on'));
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

  // ----- the look of the list, its threads, its open points and the comment marks -----

  const lookOf = (thing) => Marks.slotsIn(App.page?.look, thing);
  /** Rows in the order that a rule of the look gives them ("order"), with their things; with no rule, as they came. Returns [{ group, rows }]. */
  const lookOrder = (rows) => (App.page?.look ? Marks.orderRows(rows, Marks.listOrder(rows, App.page.look)) : [{ group: undefined, rows }]);
  /** The open threads in the order of the look: [{ thread, slots }]. */
  const threadRows = (open) => lookOrder(open.map((thread) => ({ ...Marks.threadThing(thread), thread })))[0].rows.map((row) => ({ thread: row.thread, slots: lookOf(row) }));
  const slotsOfThread = (thread) => lookOf(Marks.threadThing(thread));
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

  // ----- where a comment goes: the picker under the box -----

  /** The choices of the picker for a target: the sessions of the connected apps, a new session of each, GitHub when it takes the comment, and no agent. */
  function choicesFor(target) {
    const pull = pullPage();
    const github = !!(pull && (target.kind === 'message' ? pull.messageChoice(target) : pull.githubChoice(target)));
    const sendTo = App.page.sendTo ?? {};
    return States.sendChoices({ agent: App.page.agent, apps: App.page.apps ?? [], sessions: sendTo.sessions, models: sendTo.models, own: sendTo.own, github, pullOnly: !!App.page.pullOnly });
  }

  /** The choice that a card starts at: a reply goes where its thread went; else his last choice on this page, else that of the newest comment of the repo. */
  function firstChoice(choices) {
    const lead = card.reply && threadOf(card.reply) && States.threadLead(threadOf(card.reply));
    const wanted = lead?.to ?? (lastPick !== undefined ? lastPick : App.page.sendTo?.last);
    return States.startChoice(choices, wanted);
  }

  const DOWN = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10l5 5 5-5"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const MORE = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>';
  const CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const appIcon = (app) => (app === 'github' ? '<i class="ico git-pull-request"></i>' : agentIcon({ app }));

  /** The control of the model and the effort of the run of a choice (RunPick in tools.js): it starts again in a new card and for another choice. */
  const runControl = (choice) => (choice.run ? RunPick.html('card', { app: choice.app, list: choice.list, run: choice.run, reset: `${card.serial}:${choice.key}`, onOpen: () => { if (card.menu) { card.menu = false; redrawPicker(); } } }) : '');

  /**
   * The closed picker: "Send to <icon> Claude Code · this session", or "Keep it as a note", and on its own line after the place the model and the effort
   * of the run ("Haiku 5.5 · High"), whose click opens their small menu.
   */
  function pickerHtml() {
    const choice = card.picked;
    if (!choice) return '';
    const words = States.choiceWords(choice);
    const [app, rest] = [words.split(' · ')[0], words.split(' · ').slice(1).join(' · ')];
    const shown = choice.to ? `${esc(W.sendTo)} ${appIcon(choice.app)}<b>${esc(app)}</b>${rest ? `<span class="pw"> · ${esc(rest)}</span>` : ''}` : esc(words);
    const run = runControl(choice);
    return `<a class="pick${card.menu ? ' on' : ''}" data-pick tabindex="0">${shown}${DOWN}</a>${run ? `<div class="prun">${run}</div>` : ''}${card.menu ? menuHtml() : ''}`;
  }

  /** The menu of the picker: each connected app with its sessions and a new session, then GitHub, then no agent; the model of each run in faint words. */
  function menuHtml() {
    let app = null;
    const rows = card.choices.map((choice) => {
      const head = choice.app !== app && choice.to?.kind ? `<div class="ph">${appIcon(choice.app)}${esc(appName({ app: choice.app }))}</div>` : '';
      const sep = choice.app !== app && !choice.to?.kind ? '<div class="psep"></div>' : '';
      app = choice.app;
      const sub = [choice.sub, States.runWords(choice.app, choice.run, choice.list)].filter(Boolean).join(' · ');
      const lead = choice.app === 'github' ? appIcon('github') : '';
      return `${head}${sep}<a class="pi${choice.to?.kind ? '' : ' flat'}${choice === card.picked ? ' on' : ''}" data-choice="${esc(choice.key)}">${lead}<span>${esc(choice.words)}${sub ? `<i>${esc(sub)}</i>` : ''}</span>${choice === card.picked ? CHECK : ''}</a>`;
    }).join('');
    const none = (App.page.apps ?? []).length || App.page.pullOnly ? '' : `<p class="pnone">${esc(W.noAppConnected)} <a data-setup>${esc(W.setUpAgents)}</a></p>`;
    return `<div class="pmenu">${rows}${none}</div>`;
  }

  /** Picks a choice: the picker shows it, and the next comment of this page starts there. */
  function pick(key) {
    const choice = card?.choices.find((one) => one.key === key);
    if (!choice) return;
    card.picked = choice;
    card.menu = false;
    lastPick = choice.to ?? null;
    redrawPicker();
  }

  function redrawPicker() {
    const at = card?.el.querySelector('.pickbox');
    if (!at) return;
    at.innerHTML = pickerHtml();
    RunPick.placeIn(at);
    const menu = at.querySelector('.pmenu:not(.rmenu)');
    if (!menu) return;
    // Under the picker when it fits, else above it; when neither fits, on the side with more room, which it scrolls.
    const pick = at.getBoundingClientRect();
    const [below, above] = [innerHeight - pick.bottom - 16, pick.top - 16];
    const up = menu.offsetHeight > below && (menu.offsetHeight <= above || above > below);
    menu.classList.toggle('up', up);
    menu.style.maxHeight = `${Math.max(120, up ? above : below)}px`;
  }

  // ----- saving and acting -----

  /** Saves the text of the box: a new thread, or a reply in the thread that the box answers. It goes where the picker says. */
  function save(field) {
    const text = field.innerText.replace(/\u00a0/g, ' ').trim();
    if (!text || !card) return;
    const choice = card.picked;
    if (choice?.app === 'github') return sendToGitHub(field, text);
    if (App.page.pullOnly) return boxLine(pullPage().WRITE.onlyGitHub, true); // a page with no stored change keeps no comment
    // The model and the effort go with it: a new session takes the model that the control shows; a session that a run continues keeps its own unless he chose one.
    const run = choice?.run ? RunPick.value('card') : undefined;
    const model = run?.model && (choice.to.kind === 'new' || run.changed) ? { model: run.model } : {};
    const to = choice?.to ? { ...choice.to, ...model, ...(run?.effort ? { effort: run.effort } : {}) } : undefined;
    const thread = card.key === 'new' ? null : threadOf(card.reply);
    const point = card.key === 'new' && card.point ? points().find((one) => one.id === card.point) : null;
    const target = thread ? thread[0].target : card.target;
    tell({ type: 'remark', target, point: point?.id, text, thread: thread?.[0].id, to });
    // The page shows it at once; inside VS Code the saved data that follows takes its place.
    const id = Math.max(0, ...App.page.remarks.map((remark) => remark.id)) + 1;
    App.page.remarks.push({ id, changeId: App.page.changeId, target, text, thread: thread?.[0].id, to, createdAt: new Date().toISOString(), state: to ? 'sent' : 'open' });
    if (point) point.used = true;
    lastPick = to ?? null;
    delete typed[card.key === 'new' ? 'new' : card.reply];
    field.innerHTML = '';
    if (!thread) Object.assign(card, { key: id, threads: [id], reply: id, sent: { text, target } }); // the card stays open on its new thread
    App.render();
  }

  /** The quiet line of the card: what "@github" does, why it is not offered, "Sending…", or GitHub's sentence of a failed send. */
  function boxLine(text, error = false) {
    const line = card?.el.querySelector('.cbline');
    if (!line) return;
    line.textContent = text;
    line.hidden = !text;
    line.classList.toggle('err', error);
  }

  /**
   * A comment to the pull request on GitHub: on code lines, a comment on those lines; on a message, an answer in its thread or a comment that quotes it.
   * The box is locked while it goes; when it went through the card closes, and the page reads the pull request again; when it failed the text stays
   * and GitHub's sentence stands in the card.
   */
  async function sendToGitHub(field, text) {
    if (card.sending) return;
    const box = card;
    box.sending = true;
    field.contentEditable = 'false';
    boxLine(pullPage().WRITE.sending);
    const body = text.replace(/(^|\s)@github\b\s?/, '$1').trim();
    const result = await (box.target.kind === 'message' ? pullPage().sendOnMessage(box.target, body) : pullPage().sendCode(box.target, body));
    box.sending = false;
    if (card !== box) return;
    field.contentEditable = 'true';
    if (result.problem) {
      boxLine(result.problem, true);
      return focusField(box.el, box.key === 'new' ? 'new' : box.reply);
    }
    closeCard();
  }

  /** Resolve, Reopen or Start a run; a run takes the model and the effort of the control after "Start a run". As a file in a browser the page changes the states itself. */
  function act(id, action) {
    if (action === 'resolve') leave(id);
    const run = action === 'start' ? RunPick.value(`start:${id}`) : undefined;
    tell({ type: 'remarkAction', id, action, ...(run ? { run: { ...(run.changed ? { model: run.model } : {}), ...(run.effort ? { effort: run.effort } : {}) } } : {}) });
    if (vscodeApi || action === 'start') return;
    for (const remark of threads().find((thread) => thread.some((one) => one.id === id))) {
      if (action === 'resolve') remark.state = 'closed';
      if (action === 'reopen' && remark.state === 'closed') remark.state = remark.answer ? 'done' : 'open';
    }
    App.render();
  }

  const LEAVE_MS = 420;

  /** A resolved thread goes calmly: its card shows the check, shrinks and fades, and its mark on the page shrinks and fades with it. */
  function leave(id) {
    const marks = [...document.querySelectorAll('.cb[data-threads]')].filter((el) => el.dataset.threads.split(' ').includes(String(id)));
    const gone = card?.threads.includes(id) ? card.el : null;
    if (gone) { card.el = null; closeCard(); gone.classList.remove('card'); document.body.append(gone); } // no longer the card: only a picture of it that goes
    for (const el of [gone, ...marks].filter(Boolean)) {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : LEAVE_MS);
    }
  }

  /**
   * The marks of the comments drawn again on a view that stays as it is, when only the comments changed: no new drawing, so nothing blinks.
   * Every mark goes, not only those in the view: the trail and the cards under it have marks too. A mark that fades out stays until it is gone.
   */
  function repaint(view) {
    document.querySelectorAll('.cb[data-threads]:not(.leaving):not(.cml *)').forEach((el) => el.remove());
    paint(view);
    draw();
  }

  // ----- the place of a thread on the page -----

  // Code lines, notes and tests are places in the code; the code view lights them with a mark, since its rows are drawn as he scrolls.
  // A thing that is gone from the change file points to the nearest thing that is there.
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
      await new Promise((done) => requestAnimationFrame(done)); // the rows in view are drawn again
      return;
    }
    const view = Places.viewOf(target);
    if (App.tab) return tell({ type: 'showChange', go: view === 'diffs' ? { view: 'diffs' } : view, place: shown }); // a file tab: the change page shows it
    if (view === 'conversation') {
      if (App.state.view !== 'conversation') { App.go({ view: 'conversation' }); await App.drawing; }
      await until(() => Places.find(target).length);
      Places.find(target)[0]?.scrollIntoView({ block: 'center' });
      return;
    }
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

  /** Waits a few frames until a test holds: a conversation that is still read draws its messages later. */
  async function until(test, frames = 90) {
    for (let at = 0; at < frames && !test(); at++) await new Promise((done) => requestAnimationFrame(done));
  }

  /** Goes to the place of a thread and opens its card there, at its mark; a thing that is gone from the page opens it at the nearest thing. */
  async function goToThread(id) {
    const thread = threadOf(id);
    if (!thread) return;
    await showPlace(thread[0].target);
    if (App.tab && !codeShows(placeOf(thread[0].target))) return; // a file tab asked the change page to show it, which opens the card there
    // The mark of the thing itself, before the mark of the part around it, which counts the threads of its things too.
    const own = Places.find(placeOf(thread[0].target)).map((el) => (el.nextElementSibling?.matches?.(`.cb[data-threads~="${id}"]`) ? el.nextElementSibling : el.querySelector?.(`.cb[data-threads~="${id}"]`))).find(Boolean);
    const mark = own ?? document.querySelector(`.cb[data-threads~="${id}"]`);
    const ids = mark ? mark.dataset.threads.split(' ').map(Number) : [id];
    openCard(ids, mark ?? Places.find(placeOf(thread[0].target))[0]);
  }

  /** The place that VS Code asked for from a file tab: shown, and the card of its threads opened there. */
  async function showAndOpen(place) {
    await showPlace(place);
    const thread = openThreads().find((one) => sameThing(one[0].target, place));
    if (thread) await goToThread(thread[0].id);
  }

  /** True when two targets name the same thing. */
  const sameThing = (a, b) => a.kind === b.kind && Places.keyOf(a) === Places.keyOf(b) && a.file === b.file && a.lines?.[0] === b.lines?.[0] && a.message?.id === b.message?.id;

  // ----- the marks -----

  const ofPart = (thread, part) => thread[0].target.part === part.id || part.files.includes(thread[0].target.file);
  const ofNote = (thread, note) => thread[0].target.kind === 'note' && thread[0].target.file === note.file && thread[0].target.lines?.[0] === note.lines[0]
    && !thread[0].target.removed === !note.removed;

  /** The app whose icon a thread shows: the app that it went to, else the agent of the change. */
  const appOf = (lead) => lead.to?.app ?? App.page.agent?.app;
  /** The answer of a thread that its card showed last, by thread id: a newer answer tints its mark until its card is open. Kept while the tab lives. */
  const readAnswers = kept.readAnswers ?? {};
  const newestAnswer = (thread) => thread.map((remark) => remark.answeredAt ?? '').sort().at(-1);
  const isRead = (thread) => !!newestAnswer(thread) && readAnswers[thread[0].id] === newestAnswer(thread);

  /**
   * The mark of the open threads of a thing: one chat bubble in the state of the newest thread, with the icon of its app and a count for more than one.
   * A rule of the look on the comment mark gives it a colour and an icon in place of the icon of the app, or leaves it out.
   */
  function markOf(list) {
    if (!list.length) return '';
    const slots = lookOf({ kind: 'comment-mark', fields: { count: list.length } });
    if (slots['show.shown'] === false) return '';
    const newest = list[list.length - 1];
    const lead = States.threadLead(newest);
    const html = States.markHtml(States.markState(lead, isRead(newest)), appOf(lead), list.length);
    const el = document.createElement('i');
    el.innerHTML = html;
    const mark = el.firstChild;
    mark.dataset.threads = list.map((thread) => thread[0].id).join(' ');
    const icon = App.page.look?.files[slots['text.icon']];
    if (icon) {
      mark.querySelector('img')?.remove();
      mark.insertAdjacentHTML('beforeend', `<img class="lk" src="${esc(icon)}" alt="">`);
    }
    if (slots['text.color']) Marks.paint(mark, 'words', Marks.lineColors(slots['text.color'], Marks.READS));
    return el.innerHTML;
  }

  /**
   * A mark on a drawn thing: after the text of an HTML thing (a file name, a title row, the name line of a message); on a drawn box a small bubble
   * at its top right corner, and beside a line of SVG text, as a message of a sequence diagram.
   */
  function putMark(els, list) {
    const html = els.find((el) => el instanceof HTMLElement);
    const mark = markOf(list);
    if (!mark) return;
    if (html) return (html.querySelector(':scope > .top') ?? html).insertAdjacentHTML('beforeend', mark);
    // An arrow with no words has an empty label at the corner of the drawing: its mark stands beside the middle of its line instead.
    const drawn = (one) => { const { width, height } = one.getBBox(); return width > 0 || height > 0; };
    const el = els.find((one) => one.tagName === 'g' && drawn(one)) ?? els.find((one) => one.tagName === 'text') ?? els.find((one) => one.tagName === 'path' && !one.classList.contains('hit'));
    if (!el) return;
    const box = el.tagName === 'path' ? null : el.getBBox();
    const middle = el.tagName === 'path' ? el.getPointAtLength(el.getTotalLength() / 2) : null;
    const [x, y] = middle ? [middle.x - 40, middle.y - 13] : el.tagName === 'g' ? [box.x + box.width - 10, box.y - 12] : [box.x + box.width + 4, box.y + box.height / 2 - 13];
    const holder = document.createElement('i');
    holder.innerHTML = mark;
    const bubble = holder.firstChild;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `${bubble.getAttribute('class')} svg`);
    g.setAttribute('transform', `translate(${x} ${y})`);
    g.dataset.threads = bubble.dataset.threads;
    if (bubble.style.cssText) g.style.cssText = bubble.style.cssText;
    const icon = bubble.querySelector('img');
    const count = bubble.querySelector('.n');
    g.innerHTML = `<path d="${States.BUBBLE_PATH}"/>${icon ? `<image href="${esc(icon.getAttribute('src'))}" x="8" y="5.8" width="12" height="12"/>` : ''}`
      + (bubble.classList.contains('working') ? '<circle class="wd" cx="24.5" cy="4" r="3.5"/>' : '') + (count ? `<text class="n" x="25" y="4">${esc(count.textContent)}</text>` : '');
    if (el.tagName === 'g') el.append(g);
    else el.after(g);
  }

  // Parts, the files in no part, notes, code lines and messages have marks of their own; every other thing gets one on itself.
  const OWN_MARKS = new Set(['part', 'no-part', 'note', 'lines', 'open-point', 'message']);

  /**
   * Marks on parts, on the files in no part, on notes and on every other drawn thing with an open thread; code lines with a thread have the mark at the
   * end of the text of their first line and take a click. With `only`, only inside `view`: a diagram drawn after the page (beside "Diffs") gets its marks,
   * and the things drawn before get none twice.
   */
  function paint(view, only = false) {
    const open = openThreads();
    for (const title of view.querySelectorAll('b[data-part]')) {
      const part = App.page.parts.find((candidate) => candidate.id === title.dataset.part);
      title.insertAdjacentHTML('beforeend', markOf(open.filter((thread) => ofPart(thread, part))));
    }
    const noPart = view.querySelector('b[data-nopart]');
    if (noPart) noPart.insertAdjacentHTML('beforeend', markOf(open.filter((thread) => thread[0].target.kind === 'no-part' || App.page.checks.filesInNoPart.includes(thread[0].target.file))));
    paintNotes(view, open);
    const byThing = new Map();
    for (const thread of open.filter((one) => !OWN_MARKS.has(one[0].target.kind))) {
      const key = Places.keyOf(thread[0].target);
      byThing.set(key, [...(byThing.get(key) ?? []), thread]);
    }
    for (const list of byThing.values()) {
      const els = Places.find(list[0][0].target).filter((el) => !only || view.contains(el));
      if (els.length) putMark(els, list);
    }
    paintMessages(true);
    if (Code.shown && !only) paintLines();
  }

  /** The threads on code lines of the file in view: each line knows its first thread, and the first line of each place has the mark at the end of its text. */
  function paintLines() {
    const open = openThreads().filter((one) => codeShows(one[0].target) && !one[0].target.removed); // removed lines have no line of the file now
    const byLine = new Map();
    const marks = new Map();
    const byStart = new Map();
    for (const thread of open) byStart.set(thread[0].target.lines[0], [...(byStart.get(thread[0].target.lines[0]) ?? []), thread]);
    for (const [line, list] of byStart) marks.set(line, markOf(list));
    for (const thread of [...open].reverse()) {
      for (let line = thread[0].target.lines[0]; line <= thread[0].target.lines[1]; line++) byLine.set(line, thread[0].id);
    }
    Code.mark('threads', byLine);
    Code.mark('bubbles', marks);
  }
  /** The threads that start on the line of a thread: the card of a click on its lines. */
  const threadsOnLine = (id) => {
    const start = threadOf(id)?.[0].target.lines?.[0];
    return openThreads().filter((one) => codeShows(one[0].target) && one[0].target.lines[0] === start).map((one) => one[0].id);
  };

  /** The mark on the title of each note in an element: the Diffs page fills its files as they come into view. */
  function paintNotes(el, open = openThreads()) {
    for (const title of el.querySelectorAll('[data-note]')) {
      const note = App.page.notes.find((candidate) => candidate.key === title.dataset.note);
      title.insertAdjacentHTML('beforeend', markOf(open.filter((thread) => ofNote(thread, note))));
    }
  }

  // ----- the messages of a pull request: each is a thing that holds a comment, with its mark at the end of its name line -----

  /** The message of a pull request with this id, as read: a comment, a review, or a comment in a thread on code. */
  function messageById(pull, id) {
    for (const item of pull.items) {
      if ((item.kind === 'comment' || item.kind === 'review') && item.id === id) return item;
      if (item.kind === 'reply' && item.comment.id === id) return item.comment;
      for (const thread of item.kind === 'review' ? item.threads : item.kind === 'thread' || item.kind === 'reply' ? [item.thread] : []) {
        const found = thread.comments.find((comment) => comment.id === id);
        if (found) return { ...found, threadId: thread.id };
      }
    }
    return undefined;
  }

  /** The words of a message in one short line: what an agent gets with a comment on it, and the card shows. */
  const shortWords = (html) => {
    const text = (new DOMParser().parseFromString(html ?? '', 'text/html').body.textContent ?? '').replace(/\s+/g, ' ').trim();
    return text.length > 200 ? `${text.slice(0, 199)}…` : text;
  };

  /**
   * Marks each message of the conversation as a thing that holds a comment (a message, its number, id, link, author and words), and puts the mark of its
   * open threads at the end of its name line. With `all`, the marks of every message are drawn again; else only messages that came since.
   */
  function paintMessages(all = false) {
    const conv = document.querySelector('.conv');
    const link = App.pullLink?.();
    const pull = link && App.read?.[link]?.pull;
    if (!conv || !pull) return;
    const fresh = [...conv.querySelectorAll('[data-msg]:not([data-remark]), .sc[data-said]:not([data-remark])')];
    for (const el of fresh) {
      const id = el.dataset.msg ?? el.dataset.said;
      const said = messageById(pull, id);
      if (!said) continue;
      const message = { pull: pull.number, id, url: said.url ?? '', author: said.author?.login ?? '', words: shortWords(said.html), ...(said.threadId ? { thread: said.threadId } : {}) };
      el.dataset.remark = JSON.stringify({ kind: 'message', message, label: `Message of ${message.author}` });
      el.dataset.rk = `message:${id}`;
    }
    if (!all && !fresh.length) return;
    if (all) conv.querySelectorAll('.cb').forEach((el) => el.remove());
    const open = openThreads().filter((thread) => thread[0].target.kind === 'message');
    const byId = new Map();
    for (const thread of open) byId.set(thread[0].target.message?.id, [...(byId.get(thread[0].target.message?.id) ?? []), thread]);
    for (const [id, list] of byId) {
      const el = conv.querySelector(`[data-rk="message:${CSS.escape(id)}"]`);
      const holder = el && markHolder(el);
      if (holder && (all || fresh.includes(el)) && !holder.querySelector(':scope > .cb')) putMark([holder], list);
    }
  }
  /** Where the mark of a message stands: at the end of its name line, after the relative time; a later message of a group has no name line, so at the end of its text. */
  function markHolder(el) {
    const body = el.querySelector(':scope > .body') ?? el;
    const top = body.querySelector(':scope > .top');
    if (top) return top;
    const text = body.querySelector(':scope > .tx, :scope > .long > .tx, :scope > .bub > .tx, :scope > .bub > .long > .tx');
    return text?.lastElementChild?.tagName === 'P' ? text.lastElementChild : text ?? body;
  }
  // The conversation draws its messages after it is read, and a write draws a thread again in its place: new messages are marked as they come.
  let messagesLater = false;
  new MutationObserver(() => {
    if (messagesLater || !document.querySelector('.conv')) return;
    messagesLater = true;
    requestAnimationFrame(() => { messagesLater = false; paintMessages(); });
  }).observe(document.getElementById('view'), { childList: true, subtree: true });

  // ----- the card -----

  const clock = (moment) => (moment ? new Date(moment).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const MENTION = new RegExp(`@(${Object.values(States.MENTION_WORDS).join('|')})-(current|new)\\b`, 'g');

  /** Text of a comment as HTML, with each mention in the teal ink. */
  const textHtml = (text) => esc(text).replace(MENTION, (mention) => `<span class="mention">${mention}</span>`);

  const SHOWN_FILES = 3; // the changed files of a run that show before "n more"
  /** The block under an answer whose run changed files (from Git, kept on the remark): "Changed 2 files", then a row for each, at most 3, then "n more". A row opens its file. */
  function changedHtml(remark) {
    const files = remark.answer && remark.changed?.length ? remark.changed : [];
    if (!files.length) return '';
    const row = (path) => `<a class="cf" data-changed-file="${esc(path)}" title="${esc(path)}">${esc(baseName(path))}</a>`;
    const more = files.length - SHOWN_FILES;
    return `<div class="changed"><div class="cfh">${esc(W.changedCount(files.length))}</div>${files.slice(0, SHOWN_FILES).map(row).join('')}`
      + (more > 0 ? `<a class="cfm" data-more-files>${esc(W.nMore(more))}</a><div class="cfrest" hidden>${files.slice(SHOWN_FILES).map(row).join('')}</div>` : '') + '</div>';
  }

  /** The messages of a remark as a small chat: his own words at the right in a tinted bubble, the answer of the agent at the left with its icon and name. The exact time is in a tooltip. */
  function messagesHtml(remark) {
    const app = remark.to?.app ?? App.page.agent?.app;
    const own = `<div class="msg mine" title="${esc(clock(remark.createdAt))}"><div class="tx">${textHtml(remark.text)}</div></div>`;
    if (!remark.answer) return own;
    const who = app ? `${agentIcon({ app })}<b>${esc(appName({ app }))}</b>` : '<b>Agent</b>';
    return `${own}<div class="msg agent" title="${esc(clock(remark.answeredAt))}"><span class="av">${app ? agentIcon({ app }) : ''}</span><div><div class="who">${who.replace(/^<img[^>]*>/, '')}</div>`
      + `<div class="tx">${textHtml(remark.answer)}</div>${changedHtml(remark)}</div></div>`;
  }

  /** True when a remark has a session to open: the one that its run reported, the known session that it went to, else the session of the change. */
  const hasSession = (remark) => !!(remark.run?.session || (remark.to?.kind === 'session' ? remark.to.session : remark.to?.kind !== 'new' && App.page.agent?.session));

  /**
   * The control of the model and the effort after "Start a run" in a card: what the comment was sent with, else what its session last used, as the picker
   * offers it for that session.
   */
  function startControl(remark) {
    const to = remark.to ?? (App.page.agent?.session ? { app: App.page.agent.app, kind: 'current' } : null);
    const choice = to && choicesFor(remark.target).find((one) => one.key === States.choiceKey(to));
    if (!choice?.run) return '';
    const run = remark.to?.model || remark.to?.effort ? { ...choice.run, ...(remark.to.model ? { model: remark.to.model } : {}), ...(remark.to.effort ? { effort: remark.to.effort } : {}) } : choice.run;
    return ` · ${RunPick.html(`start:${remark.id}`, { app: choice.app, list: choice.list, run, reset: card?.serial })}`;
  }

  /**
   * The quiet state line of a thread, with the way on that fits it, in the words of the picker; how long a run works as a relative time, with the exact
   * time in its tooltip. In a card, "Start a run" has the control of the model and the effort after it.
   */
  function stateOf(remark, inCard = false) {
    const { agent, listening } = App.page;
    const line = States.remarkLine(remark, agent, listening);
    const link = (text, attrs) => `<a ${attrs}>${esc(text)}</a>`;
    // The session that works or worked on it: a click opens it, in its app or in a terminal that continues it.
    const session = hasSession(remark) ? link(W.session, `data-session="${remark.id}"`) : '';
    if (remark.state === 'running' || remark.state === 'done') {
      const start = remark.state === 'running' && remark.run?.startedAt;
      const since = start ? `<span class="ago" title="${esc(new Date(start).toLocaleString())}">${esc(States.forWords(start))}</span>` : '';
      return States.lineHtml(line, [since, session].filter(Boolean).map((bit) => ` · ${bit}`).join(''));
    }
    const more = {
      listening: ` · ${esc(W.listening)}`,
      connect: ` · ${agent?.link ? link(W.openSession, `data-link="${esc(agent.link)}"`) : esc(W.openSession)}, or ${link(W.connect, 'data-connect')}`,
      start: ` · ${link(W.startRun, `data-start="${remark.id}"`)}${inCard ? startControl(remark) : ''}`,
    }[line.way] ?? '';
    return States.lineHtml(line, more);
  }

  const fieldHtml = (key, placeholder) => `<div class="field" contenteditable="true" data-field="${key}" data-placeholder="${esc(placeholder)}"></div>`;

  /** The place of a target in a few words for the head of a card: "Desk screen", "hold_service.py · lines 253–258", "mira-k · message". */
  function shortPlace(target, words) {
    if (target.kind === 'message') return `${target.message?.author ?? '?'} · message`;
    if (target.kind === 'lines' || target.kind === 'open-point') return target.file ? `${baseName(target.file)}${target.lines ? ` · ${target.removed ? 'removed ' : ''}${linesText(target.lines)}` : ''}` : W.openPoint;
    const quoted = /^[A-Z][a-z]* "([^"]*)"/.exec(words);
    return ['part', 'node', 'diagram', 'note'].includes(target.kind) && quoted ? quoted[1] : words;
  }

  /** The name of a thing in quiet words, the full words in its tooltip; a thing that is gone from the change file says so. */
  const whereHtml = (target) => {
    const gone = !!App.page && target.kind !== 'message' && Places.isGone(target);
    // A thing that is gone, or names another thing now, keeps the title that it had when the comment was put on it.
    const words = gone && target.kept && target.label && target.kind !== 'edge' ? target.label.replace(/"[^"]*"/, () => `"${target.kept.title}"`) : target.label ?? target.kind;
    return `<span class="where" title="${esc(words)}">${esc(shortPlace(target, words))}${gone ? `<span class="gone-place"> · ${esc(W.goneFromDiagram)}</span>` : ''}</span>`;
  };

  /** One thread in a card: its place when the card holds more than one place, its messages, its state; a rule of the look names which show ("content.fields"). */
  function threadHtml(thread, many) {
    const slots = slotsOfThread(thread);
    const fields = slots.content?.fields ?? ['where', 'messages', 'state', 'reply'];
    const lead = States.threadLead(thread);
    const parts = {
      where: many && !sameThing(thread[0].target, card.target) ? `<div class="sub">${whereHtml(thread[0].target)}</div>` : '', // the head names the first thing
      messages: thread.map(messagesHtml).join(''),
      state: `<div class="st">${stateOf(lead, true)}</div>`,
      reply: many && thread[0].id !== card.reply ? `<a class="toreply" data-reply-to="${thread[0].id}">${esc(W.reply)}</a>` : '',
    };
    return `<div class="cth${many && thread[0].id === card.reply ? ' cur' : ''}" data-thread="${thread[0].id}">${fields.map((field) => parts[field] ?? '').join('')}</div>`;
  }

  /** The less used actions of a card, behind "⋯": open the session of the thread, start a run for a comment that waits. */
  function moreActions() {
    const lead = card.reply && threadOf(card.reply) && States.threadLead(threadOf(card.reply));
    if (!lead) return [];
    const line = States.remarkLine(lead, App.page.agent, App.page.listening);
    return [
      ...(['running', 'done'].includes(lead.state) && hasSession(lead) ? [`<a data-session="${lead.id}">${esc(W.openTheSession)}</a>`] : []),
      ...(line.way === 'start' ? [`<a data-start="${lead.id}">${esc(W.startRun)}</a>`] : []),
    ];
  }

  /** Draws the card: a quiet head with the place and the tools, the threads as a small chat, the box and the picker under it. */
  function drawCard() {
    if (!card) return;
    const shown = card.threads.map(threadOf).filter((thread) => thread && !isResolved(thread));
    if (card.key !== 'new' && !shown.length) return closeCard(); // resolved meanwhile
    if (card.key !== 'new' && !shown.some((thread) => thread[0].id === card.reply)) card.reply = shown.at(-1)[0].id;
    const focused = card.el?.contains(document.activeElement) ? document.activeElement.dataset.field : undefined;
    card.choices = choicesFor(card.target);
    if (!card.picked || !card.choices.some((choice) => choice.key === card.picked.key)) card.picked = firstChoice(card.choices);
    else card.picked = card.choices.find((choice) => choice.key === card.picked.key);
    const actions = moreActions();
    const tools = card.key === 'new' ? `<a class="tl" data-close title="${esc(W.close)}">${CLOSE}</a>`
      : `<a class="tl" data-resolve title="${esc(W.resolve)}">${CHECK}</a>${actions.length ? `<a class="tl" data-more title="${esc(W.moreActions)}">${MORE}</a>` : ''}<a class="tl" data-close title="${esc(W.close)}">${CLOSE}</a>`;
    const point = card.key === 'new' && card.point ? points().find((one) => one.id === card.point) : null;
    const key = card.key === 'new' ? 'new' : card.reply;
    const replies = card.key === 'new' || (slotsOfThread(threadOf(card.reply)).content?.fields ?? ['reply']).includes('reply');
    const github = card.key === 'new' ? pullPage()?.codeLine(card.target) ?? '' : '';
    const body = `<div class="ch">${whereHtml(card.target)}<span class="tools">${tools}</span></div>`
      + (card.moreOpen && actions.length ? `<div class="moremenu">${actions.join('')}</div>` : '')
      + (point ? `<div class="msg agent point"><div><div class="who"><b>${esc(W.openPoint)}</b></div><div class="tx">${esc(point.text)}</div></div></div>` : '')
      + shown.map((thread) => threadHtml(thread, shown.length > 1)).join('')
      + (replies ? `<div class="cbx">${fieldHtml(key, card.key === 'new' ? W.writeComment : W.writeReply)}<div class="pickbox">${pickerHtml()}</div></div>` : '')
      + `<p class="cbline"${github ? '' : ' hidden'}>${esc(github)}</p>`;
    if (!card.el) {
      card.el = html('<div class="cbox card"></div>');
      card.el.addEventListener('pointerdown', dragCard);
      document.body.append(card.el);
    }
    card.el.innerHTML = body;
    if (shown[0]) Marks.paintBox(card.el, slotsOfThread(shown.at(-1)));
    for (const field of card.el.querySelectorAll('[data-field]')) if (typed[field.dataset.field]) field.innerHTML = typed[field.dataset.field];
    if (focused) focusField(card.el, focused);
    for (const thread of shown) if (newestAnswer(thread)) readAnswers[thread[0].id] = newestAnswer(thread); // the answers are read now
    if (shown.some((thread) => newestAnswer(thread))) keep({ readAnswers });
    lightLines(inCode(card.target) && card.target.lines && !card.target.removed ? card.target : null); // draws the rows of the code again, with their marks
    document.querySelectorAll('.cb.on').forEach((el) => el.classList.remove('on'));
    for (const id of card.threads) {
      document.querySelectorAll(`.cb[data-threads~="${id}"]`).forEach((el) => el.classList.replace('answered', 'seen'));
      document.querySelectorAll(`.cb[data-threads~="${id}"]`).forEach((el) => el.classList.add('on'));
    }
    placeCard();
    RunPick.placeIn(card.el);
  }

  /** While the card of code lines is open, those lines have a soft tint. */
  function lightLines(target) {
    if (Code.shown) Code.mark('near', target && codeShows(target) ? target : null);
  }

  /**
   * The rectangle that the card opens beside, and the element there: the drawn thing (a node, a part, a message), else its mark, else where the card opened.
   * Code lines reach to the right edge of the code, so that the card stands beside the code, over the column of the notes when there is one.
   */
  function anchor() {
    const mark = card.threads.length ? document.querySelector(`.cb[data-threads~="${card.threads[0]}"]`) : null;
    const target = placeOf(card.target);
    if (inCode(target) && codeShows(target)) {
      const rows = (target.lines ?? []).map((line) => document.querySelector(`.cn .code .l[data-line="${line}"]`));
      const [row, last] = rows.map((one) => one?.getBoundingClientRect());
      const code = document.querySelector('.cn .code')?.getBoundingClientRect();
      if (row && code && row.bottom > 0 && row.top < innerHeight) return { rect: { left: row.left, right: code.right, top: row.top, bottom: (last ?? row).bottom }, el: rows[0] };
    }
    const things = !inCode(target) ? Places.find(target).filter((one) => one.tagName !== 'svg' && one.getClientRects().length) : [];
    const el = things.map((one) => one.closest('g.node, g.cluster') ?? one)[0] ?? mark;
    const rect = el?.getBoundingClientRect();
    if (rect && rect.bottom > 0 && rect.top < innerHeight && (rect.width || rect.height)) return { rect, el };
    const at = card.at ?? pointerAt ?? { x: innerWidth / 2, y: 80 };
    return { rect: { left: at.x, right: at.x, top: at.y, bottom: at.y }, el: document.elementsFromPoint(at.x, at.y).find((one) => !card.el.contains(one)) };
  }

  /** The element whose scroll moves an element: the nearest one that scrolls, else the page. */
  function scrollerOf(el) {
    for (let box = el; box && box !== document.body; box = box.parentElement) if (/auto|scroll/.test(getComputedStyle(box).overflow)) return box;
    return document.scrollingElement;
  }
  /** Where the content of a scrolling element starts in the tab. */
  function originOf(box) {
    const rect = box === document.scrollingElement ? { left: 0, top: 0 } : box.getBoundingClientRect();
    return { x: rect.left - box.scrollLeft, y: rect.top - box.scrollTop };
  }
  /** A point of the tab as a spot on the page: from the start of the content that `box` scrolls, so that it moves with that content. */
  function onPage(x, y, box) {
    const origin = originOf(box);
    return { box, x: x - origin.x, y: y - origin.y };
  }

  /**
   * The spot where the card opens: beside its thing, at its right when there is room, else at its left, else under it or over it; with no free side,
   * over the side with the most room. It opens inside the tab, 8 px from its edges.
   */
  function openingSpot() {
    const { rect, el } = anchor();
    const [width, height, gap, edge] = [card.el.offsetWidth, card.el.offsetHeight, 12, 8];
    let left;
    let top = rect.top - 10;
    if (rect.right + gap + width <= innerWidth - edge) left = rect.right + gap;
    else if (rect.left - gap - width >= edge) left = rect.left - gap - width;
    else {
      left = innerWidth - rect.right >= rect.left ? innerWidth - edge - width : edge;
      if (rect.bottom + gap + height <= innerHeight - edge) top = rect.bottom + gap;
      else if (rect.top - gap - height >= edge) top = rect.top - gap - height;
    }
    return onPage(Math.max(edge, Math.min(left, innerWidth - width - edge)), Math.max(edge, Math.min(top, innerHeight - height - edge)), scrollerOf(el));
  }

  /** The card stands at its spot on the page, like a note on paper: it scrolls with the page, out of view too. A new spot comes when the element that scrolled it is gone. */
  function placeCard() {
    if (!card?.el) return;
    if (!card.spot?.box.isConnected) card.spot = openingSpot();
    const origin = originOf(card.spot.box);
    card.el.style.left = `${origin.x + card.spot.x}px`;
    card.el.style.top = `${origin.y + card.spot.y}px`;
  }
  /** The head of the card is its handle: a drag there moves the card to a new spot on the page; its tools keep their clicks. */
  function dragCard(event) {
    if (event.button !== 0 || !event.target.closest('.ch') || event.target.closest('.tools, a')) return;
    const own = card;
    const box = own.el.getBoundingClientRect();
    const from = { x: event.clientX - box.left, y: event.clientY - box.top };
    own.el.classList.add('dragging');
    event.preventDefault(); // no text selection while it moves
    const move = (step) => {
      own.spot = onPage(step.clientX - from.x, step.clientY - from.y, own.spot.box);
      if (card === own) placeCard();
    };
    const stop = () => {
      own.el?.classList.remove('dragging');
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', stop);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', stop);
  }
  addEventListener('resize', () => { placeCard(); placeList(); });
  addEventListener('scroll', () => placeCard(), true);

  /** Puts the cursor at the end of a field. */
  function focusField(within, key) {
    const field = within?.querySelector(`[data-field="${key}"]`);
    if (!field) return;
    field.focus();
    getSelection().selectAllChildren(field);
    getSelection().collapseToEnd();
  }

  // A click in the card: the tools, the picker and its menu, the links of a state line, the changed files of a run.
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!card?.el?.contains(target)) return;
    if (target.closest('[data-close]')) return closeCard();
    if (target.closest('[data-resolve]')) return act(card.reply, 'resolve');
    if (target.closest('[data-more]')) { card.moreOpen = !card.moreOpen; return drawCard(); }
    if (target.closest('[data-pick]')) { card.menu = !card.menu; RunPick.close('card'); return redrawPicker(); }
    const choice = target.closest('[data-choice]');
    if (choice) { pick(choice.dataset.choice); return focusField(card.el, card.key === 'new' ? 'new' : card.reply); }
    const reply = target.closest('[data-reply-to]');
    if (reply) { card.reply = Number(reply.dataset.replyTo); card.picked = null; return drawCard(); }
    const changed = target.closest('[data-changed-file]');
    if (changed) { // its change, as a click on a file of the change opens it; Home opens the file
      closeCard();
      return App.fileClick ? App.fileClick(changed.dataset.changedFile, event) : tell({ type: 'openFile', path: changed.dataset.changedFile });
    }
    const more = target.closest('[data-more-files]');
    if (more) { more.nextElementSibling.hidden = false; return more.remove(); }
    if (target.closest('[data-start]')) return act(Number(target.closest('[data-start]').dataset.start), 'start');
    if (target.closest('[data-connect]')) return tell({ type: 'connect' });
    if (target.closest('[data-session]')) return tell({ type: 'openSession', id: Number(target.closest('[data-session]').dataset.session) });
  });

  // ----- the list of all comments, from the count in the top bar -----

  /** The count in the top bar: a chat bubble with the number of open threads, beside the switch of views; only when there is a thread or an open point. */
  function drawCount() {
    const bar = document.querySelector('.paper > .bar');
    if (!bar) return;
    let count = bar.querySelector('[data-comments]');
    const open = openThreads().length;
    if (!open && !points().length && !threads().length) { count?.remove(); return closeList(); }
    if (!count) {
      count = html(`<a class="cmc" data-comments tabindex="0" title="Comments">${States.bubbleSvg('cmi')}<span class="n"></span></a>`);
      const after = bar.querySelector('.switch');
      if (after) after.after(count);
      else bar.append(count);
    }
    count.querySelector('.n').textContent = open || '';
    count.classList.toggle('on', !!list);
  }

  /** The words of the newest message of a thread on one line: the answer of an agent starts with the name of its app. */
  function newestWords(thread) {
    const last = thread.at(-1);
    if (!last.answer) return last.text;
    const app = last.to?.app ?? App.page.agent?.app;
    return `${app ? `${appName({ app })}: ` : ''}${last.answer}`;
  }

  /** One row of the list: the mark, the place in bold, the newest words on one line, and the state line. */
  function rowHtml(thread) {
    const lead = States.threadLead(thread);
    const state = lead.state === 'open' ? `<span class="state"><i class="dot grey"></i>${esc(W.noteToNoAgent)}</span>` : stateOf(lead);
    return `<div class="cmr" data-row="${thread[0].id}">${markOf([thread])}<span class="rt"><b>${whereHtml(thread[0].target)}</b>`
      + `<span class="rx">${esc(newestWords(thread))}</span><span class="rs">${state}</span></span></div>`;
  }

  /** The list of all comments, under the count: the open threads in the order of the page, then the open points and the resolved threads when he asks. */
  function drawList() {
    if (!list) return;
    const open = openThreads();
    const resolved = threads().filter(isResolved);
    const sorted = [...points()].sort((a, b) => byPlace(pointTarget(a), pointTarget(b)));
    const rows = threadRows(open).map(({ thread }) => rowHtml(thread)).join('');
    const pointRows = !list.points ? '' : pointGroups(sorted).map(({ group, rows: some }) => (group !== undefined ? `<div class="pgroup">${esc(group || 'none')}</div>` : '')
      + some.map(({ point }) => `<div class="cmr point" data-point="${point.id}"><span class="cb note">${States.bubbleSvg()}</span><span class="rt"><b>${whereHtml(pointTarget(point))}</b><span class="rx">${esc(point.text)}</span></span></div>`).join('')).join('');
    const resolvedRows = !list.resolved ? '' : resolved.map((thread) => `<div class="cmr gone" data-gone="${thread[0].id}"><span></span><span class="rt"><b>${whereHtml(thread[0].target)}</b>`
      + `<span class="rx">${esc(thread[0].text)}</span>${thread[0].closedBy ? `<span class="rs"><span class="state">${esc(W.resolvedBy(appName({ app: thread[0].closedBy })))}</span></span>` : ''}</span><a class="reopen" data-reopen="${thread[0].id}">${esc(W.reopen)}</a></div>`).join('');
    const foot = [sorted.length ? `<a data-show-points class="${list.points ? 'on' : ''}">${esc(W.openPoints)} ${sorted.length}</a>` : '', '<span class="sp"></span>',
      resolved.length ? `<a data-show-resolved class="${list.resolved ? 'on' : ''}">${esc(W.resolved(resolved.length))}</a>` : ''].join('');
    list.el.innerHTML = `${rows}${pointRows}${resolvedRows}${sorted.length || resolved.length ? `<div class="foot">${foot}</div>` : ''}`;
    // The colour of a thread that a rule gives it, and the colour and icon of the place of an open point: on its row.
    for (const { thread, slots } of threadRows(open)) { const row = list.el.querySelector(`[data-row="${thread[0].id}"]`); if (row) Marks.paintBox(row, slots); }
    for (const { point, slots } of pointGroups(points()).flatMap((group) => group.rows)) {
      const where = list.el.querySelector(`[data-point="${point.id}"] b`);
      if (where) Marks.paintText(where, App.page.look, slots);
    }
    placeList();
  }

  function openList() {
    closeCard();
    stopPicking();
    list = { el: html('<div class="cml" role="dialog"></div>'), points: false, resolved: false };
    document.body.append(list.el);
    // A rule of the look on the comments list ("comments-window"): its width and its colour.
    const own = lookOf({ kind: 'comments-window', fields: {} });
    if (own['window.width']) list.el.style.width = `${own['window.width']}px`;
    Marks.paintBox(list.el, own);
    drawList();
    drawCount();
  }

  function closeList() {
    if (!list) return;
    list.el.remove();
    list = null;
    drawCount();
  }

  /** The list stands under the count, its right edge at the right edge of the count, inside the tab. */
  function placeList() {
    const count = document.querySelector('[data-comments]');
    if (!list || !count) return;
    const at = count.getBoundingClientRect();
    const width = list.el.offsetWidth;
    list.el.style.top = `${at.bottom + 8}px`;
    list.el.style.left = `${Math.max(8, Math.min(at.right - width, innerWidth - width - 8))}px`;
  }

  document.addEventListener('click', (event) => {
    if (!list?.el.contains(event.target)) return;
    const target = event.target;
    if (target.closest('[data-show-points]')) { list.points = !list.points; return drawList(); }
    if (target.closest('[data-show-resolved]')) { list.resolved = !list.resolved; return drawList(); }
    const reopen = target.closest('[data-reopen]');
    if (reopen) return act(Number(reopen.dataset.reopen), 'reopen');
    if (target.closest('[data-start]')) return act(Number(target.closest('[data-start]').dataset.start), 'start');
    if (target.closest('[data-session]')) return tell({ type: 'openSession', id: Number(target.closest('[data-session]').dataset.session) });
    if (target.closest('[data-connect]')) return tell({ type: 'connect' });
    const row = target.closest('[data-row]');
    if (row) { closeList(); return void goToThread(Number(row.dataset.row)); }
    const point = target.closest('[data-point]');
    if (point) {
      const found = points().find((one) => one.id === Number(point.dataset.point));
      closeList();
      return void showPlace(pointTarget(found)).then(() => openNew(pointTarget(found), null, found.id));
    }
  });

  /** Draws what shows of the comments: the count in the top bar, the open list and the open card. A new thread that VS Code saved takes the place of its stand-in. */
  function draw() {
    if (!App.page) return;
    if (card?.sent && !card.threads.every(threadOf)) adopt();
    drawCount();
    drawList();
    if (card) drawCard();
  }

  /** The thread that VS Code stored for the comment of the card: its id may differ from the one that the page gave it. */
  function adopt() {
    const found = [...App.page.remarks].reverse().find((remark) => !remark.thread && remark.text === card.sent.text && sameThing(remark.target, card.sent.target));
    if (found) Object.assign(card, { key: found.id, threads: [found.id], reply: found.id });
  }

  // ----- writing in the card: Enter or Cmd+Enter sends, Shift+Enter makes a new line, Esc closes, @ names where it goes -----

  document.addEventListener('keydown', (event) => {
    const field = event.target.closest?.('[data-field]');
    if (!field) {
      if (event.metaKey && event.shiftKey && (event.key === '.' || event.code === 'Period')) { event.preventDefault(); ownKeyAt = Date.now(); open(); }
      if (event.key === 'Escape') {
        if (picking) stopPicking();
        else if (card?.menu) { card.menu = false; redrawPicker(); } else if (card) closeCard();
        else if (list) closeList();
      }
      // The quick comment: Enter after the key, with no click, opens the card on the whole of what the page shows (or on the selected lines).
      if (event.key === 'Enter' && picking) {
        event.preventDefault();
        const thing = picking.lines ?? wholeView();
        stopPicking();
        openNew(thing, pointerAt ?? { x: innerWidth / 2 - 160, y: 80 });
      }
      if ((event.key === 'Enter' || event.key === ' ') && event.target.closest?.('[data-pick]')) { event.preventDefault(); card.menu = !card.menu; redrawPicker(); }
      return;
    }
    event.stopPropagation();
    if (mentions && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); return moveLit(event.key === 'ArrowDown' ? 1 : -1); }
    if (mentions && (event.key === 'Enter' || event.key === 'Tab')) { event.preventDefault(); return insertMention(); }
    if (mentions && event.key === 'Escape') return closeMentions();
    if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); document.execCommand('insertLineBreak'); return; }
    if (event.key === 'Enter') { event.preventDefault(); return save(field); }
    if (event.key !== 'Escape') return;
    if (card?.menu) { card.menu = false; return redrawPicker(); }
    closeCard();
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
  /** Whom "@" offers: the agents, and "@github" when the open pull request takes the comment. A page with no stored change offers GitHub only. */
  const choices = () => {
    const target = card?.target;
    const pull = pullPage();
    const github = card && pull ? (target.kind === 'message' ? pull.messageChoice(target) : pull.githubChoice(target)) : null;
    return [...(App.page.pullOnly ? [] : States.mentionChoices(App.page.agent, App.page.apps ?? [])), ...(github ? [github] : [])];
  };

  /** After each key: opens the list when "@" was typed, cuts it by the letters after "@", and closes it when nothing fits. */
  function lookForMention() {
    const selection = getSelection();
    const node = selection.focusNode;
    const before = node?.nodeType === 3 ? node.textContent.slice(0, selection.focusOffset) : '';
    const match = /(^|\s)@([a-z-]*)$/i.exec(before);
    const all = choices();
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
    const { el, ghost, shown, lit, typed: letters } = mentions;
    el.innerHTML = shown.length
      ? shown.map((choice, index) => `<a class="opt${index === lit ? ' lit' : ''}" data-pick-mention="${index}">${appIcon(choice.app)}<span class="nm">${esc(choice.name)}</span><span class="does" title="${esc(choice.does)}">${esc(choice.does)}</span></a>`).join('')
      : `<p class="none">${esc(W.noAgent)}</p>`;
    const box = getSelection().getRangeAt(0).getBoundingClientRect();
    const below = box.bottom + 6 + el.offsetHeight <= innerHeight;
    el.style.left = `${Math.max(8, Math.min(box.left, innerWidth - el.offsetWidth - 8))}px`;
    el.style.top = `${below ? box.bottom + 6 : box.top - 6 - el.offsetHeight}px`;
    ghost.textContent = shown[lit]?.name.slice(letters.length) ?? '';
    Object.assign(ghost.style, { left: `${box.right}px`, top: `${box.top}px`, height: `${box.height}px`, lineHeight: `${box.height}px` });
    el.onmousedown = (event) => {
      event.preventDefault();
      const row = event.target.closest('[data-pick-mention]');
      if (row) { mentions.lit = Number(row.dataset.pickMention); insertMention(); }
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

  /** Puts the lit name into the text as one unit with a space after it, in place of "@" and what was typed after it; the picker goes to that choice. */
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
    const space = document.createTextNode(' ');
    range.insertNode(mention);
    mention.after(space);
    getSelection().collapse(space, 1);
    const field = mention.closest('[data-field]');
    typed[field.dataset.field] = field.innerHTML;
    pick(States.choiceKey(choice.app === 'github' ? { app: 'github' } : choice));
  }

  /**
   * The remark key as VS Code passes it on. When the page had the keyboard it took that key press itself already, and the copy from VS Code
   * can come late (the page waits with it until a drawing is done): it must not switch the comment pointer off again. VS Code shows the page
   * before it sends the copy, which takes the keyboard out of an open box: the copy puts it back.
   */
  function openFromVsCode() {
    if (card?.key === 'new') return focusField(card.el, 'new');
    if (Date.now() - ownKeyAt < 2000) { ownKeyAt = 0; return; }
    open();
  }

  return { openFromVsCode, boxOn, paint, repaint, paintNotes, draw, show: showAndOpen };
})();
