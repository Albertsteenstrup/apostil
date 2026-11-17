// The page of one change, or the tab of one of its files: where the owner is, the top line, and the switch between the diagram, the diffs and
// the conversation of its pull request. A pull request with no stored change has a page too: "Conversation" and "Diffs".
'use strict';

const App = {
  page: null,
  tab: null, // the file that this tab shows: a file tab of VS Code, or "?file=" when the page is a file in a browser
  // view: "diagram", "diffs" or "code". level: "broad", "change" or "part". from: the part that drill up came from. at: the change of a file to start at.
  // lit: the nodes that a panel of the graphs page asked to light; for the change, the ids of its parts.
  // view "conversation": the conversation of a pull request; pull: the number of the pull request that he chose, when the branch has more than one.
  state: { view: 'diagram', level: 'change', part: null, diagram: null, from: null, file: null, lines: null, at: null, lit: null, pull: null },
  scrolls: {}, // where each diagram view was scrolled, for the way back
  pulls: [], // the pull requests of the branch, in short, newest first; they come after the page
  pullsKnown: false, // the pull requests of the branch have come, maybe none
  read: {}, // each pull request as read in full from GitHub, by its link: { pull, lastLooked } or { problem }
  looked: new Set(), // the pull requests whose conversation he opened on this page: their time is set once
  unknownTries: {}, // how often a pull request was read again because GitHub did not know yet if it can merge
  tabPull: null, // a file tab in VS Code: the link of the pull request that the page read, for a comment on code
  diffs: null, // the steps of "Diffs" (diffsPage) or of the list of "Diagram" (changeWithDiffs) while they show: the keys and the control use them

  /** The pull request of the page in short: the one he chose, else the newest open one, else the newest. */
  pull() {
    const { pulls, state } = this;
    return pulls.find((pull) => pull.number === state.pull) ?? pulls.find((pull) => pull.state !== 'merged' && pull.state !== 'closed') ?? pulls[0] ?? null;
  },

  /** The link of the pull request that the page shows, or null. */
  pullLink() {
    return this.page?.pullOnly?.link ?? this.pull()?.url ?? this.tabPull;
  },

  /** After a write to GitHub: reads the pull request again, and draws the conversation with the new item, or the strip. A file tab hears it from VS Code. */
  reread() {
    if (this.tab) return Promise.resolve();
    return this.loadPull(true).then(() => (this.state.view === 'conversation' ? this.render() : drawStrip()));
  },

  /** Reads the pull request of the page in full, once; "Try again" reads it again. A page with no stored change gets its files with it. */
  loadPull(again = false) {
    const link = this.pullLink();
    if (!link) return Promise.resolve(null);
    const question = `pull:${link}`;
    if (again) { answers.delete(question); delete this.read[link]; }
    return ask(question).then((answer) => {
      const read = answer ?? { problem: 'GitHub gave no answer.' };
      if (read.page && this.page?.pullOnly?.link === link) this.page = read.page;
      this.read[link] = read;
      // GitHub is still working out if it can merge: ask again after a moment, a few times.
      const tries = (this.unknownTries[link] = (this.unknownTries[link] ?? 0) + 1);
      if (read.pull && !read.pull.merge.known && tries <= 3) {
        setTimeout(() => { if (this.pullLink() === link) this.loadPull(true).then(() => (this.state.view === 'conversation' || this.page.pullOnly ? this.render() : drawStrip())); }, 6000);
      }
      return read;
    });
  },

  /** Goes to a view of the change. It is a step of the path, unless `quiet`: VS Code asked for it, and the path has it already. */
  go(change, quiet = false) {
    Hover.hide();
    if (this.tab) return tell({ type: 'showChange', go: change }); // a file tab: the change page shows it
    this.keepScroll();
    const from = this.state.view === 'diagram' && this.state.level === 'part' ? this.state.part : null; // drill up: that part keeps its diagram whole
    Object.assign(this.state, { view: 'diagram', from, lit: null }, change);
    if (!quiet) Trail.take(this.ownStep());
    return this.render();
  },

  /** The page "Diffs", with every changed file. */
  showDiffs() {
    return this.go({ view: 'diffs' });
  },

  /** The view that the page shows, as a step of the path: the change, the diagram of a part, a wider diagram, or "Diffs". A file is not a step. */
  ownStep() {
    const { page, state } = this;
    const number = page.pullOnly?.number ?? this.pull()?.number;
    if (page.pullOnly) return { tab: 'pull', link: page.pullOnly.link, name: `Pull request #${number}` };
    const at = { tab: 'change', change: page.changeId };
    const lit = state.lit ?? undefined;
    if (state.view === 'diffs') return { ...at, go: { view: 'diffs' }, name: 'Diffs' };
    if (state.view === 'conversation') return { ...at, go: { view: 'conversation', pull: number }, name: `Pull request #${number ?? ''}` };
    const part = state.level === 'part' && page.parts.find((candidate) => candidate.id === state.part);
    if (part) return { ...at, go: { level: 'part', part: part.id, diagram: state.diagram ?? part.diagrams[0], lit }, name: part.name };
    const broad = state.level === 'broad' && broadOf(state);
    if (broad) return { ...at, go: { level: 'broad', diagram: broad.id, lit }, name: broad.title };
    return { ...at, go: { level: 'change', lit }, name: page.title };
  },

  /** The name of the diagram view that the owner is on. */
  place() {
    const { level, part } = this.state;
    return level === 'part' ? `part/${part}` : level;
  },

  keepScroll() {
    if (this.state.view === 'diagram') this.scrolls[this.place()] = scrollY;
  },

  /** A click on a part: its diagram, or its first file when it has none (or the look leaves out all its diagrams). */
  openPart(id) {
    const part = this.page.parts.find((candidate) => candidate.id === id);
    const [first] = partDiagrams(part);
    if (first) this.go({ level: 'part', part: id, diagram: first.id });
    else this.showCode(this.firstFile(part), null);
  },

  /** The file of a part that opens first: its first file with notes, else its first file. */
  firstFile(part) {
    return part.files.find((path) => this.page.notes.some((note) => note.file === path)) ?? part.files[0];
  },

  /** The code of one file, with a range of lines lit: in the file's own tab inside VS Code, else on this page. */
  showCode(file, lines, at = null) {
    Hover.hide();
    if (file !== this.tab && this.hasTab(file)) return tell({ type: 'openFileTab', path: file, lines: lines ?? undefined, at: at ?? undefined, replace: !!this.tab });
    if (this.tab && file !== this.tab && vscodeApi) return tell({ type: 'showChange', go: { code: file, at } }); // a removed file stays on the change page
    if (this.tab) this.tab = file; // as a file in a browser, the tab shows the next file
    this.keepScroll();
    Object.assign(this.state, { view: 'code', file, lines: lines ?? null, at });
    this.render();
  },

  /** True when a file opens in a tab of its own: inside VS Code, for a file that the change did not remove. */
  hasTab(file) {
    return !!vscodeApi && this.page.files.find((candidate) => candidate.path === file)?.status !== 'removed';
  },

  /** A click on a file name: its own tab with the whole file and its notes. Cmd+click opens it in the editor of VS Code. */
  fileClick(path, event) {
    if (event.metaKey) this.openFile(path);
    else this.showCode(path, null);
  },

  /** Opens a file in VS Code beside the page, only when the owner asks: "Open" in a hover window, or Cmd+click. */
  openFile(path, lines) {
    Hover.hide();
    tell({ type: 'openFile', path, lines });
  },

  /** The changed files in the order of the parts, the files in no part last, the generated files left out. */
  order() {
    return filesByPart().flatMap((group) => group.paths);
  },

  /** J and K: the next or the previous changed file, at its first or last change. */
  step(direction, at = null) {
    const order = this.order();
    const index = order.indexOf(this.state.file);
    const next = order[index < 0 ? (direction > 0 ? 0 : order.length - 1) : index + direction];
    if (next) this.showCode(next, null, at);
  },

  // Renders one at a time, so a quick second click does not mix two drawings.
  // A hidden tab has no size, and Mermaid draws empty boxes there: the drawing waits until the tab shows again.
  render() {
    this.waiting = !document.body.clientWidth || document.hidden;
    if (this.waiting) return this.drawing ?? Promise.resolve();
    this.drawing =(this.drawing ?? Promise.resolve()).then(() => this.draw()).catch((error) => console.error(error));
    return this.drawing;
  },

  async draw() {
    const { page, state } = this;
    if (!page) return;
    if (this.tab) Object.assign(state, { view: 'code', file: this.tab });
    // A change of one part with no diagram opens the code of that part with its notes.
    const only = onlyPart();
    if (state.view === 'diagram' && state.level === 'change' && only && !only.diagrams.length) Object.assign(state, { view: 'code', file: this.firstFile(only), lines: null });
    if (state.view === 'code') state.part = page.parts.find((part) => part.files.includes(state.file))?.id ?? null;
    if (page.pullOnly && state.view === 'diagram') state.view = 'conversation';
    // A view that a rule of the look leaves out does not open: the next view of the switch opens in its place.
    const views = lookViews();
    if (!this.tab && !page.pullOnly && state.view !== 'code' && views.length && !views.includes(state.view)) state.view = views[0];
    document.body.classList.toggle('file-tab', !!this.tab);
    // The path that he followed; a file shown on the page (a removed one) is a bold name after it. The large view of a wider diagram has its title there.
    if (!this.tab) {
      const broad = state.view === 'diagram' && state.level === 'broad' && broadOf(state);
      Trail.show(document.getElementById('crumb'), this.ownStep(), { attrs: broad ? Places.attrs({ kind: 'diagram', diagram: broad.id }) : '', extra: state.view === 'code' ? baseName(state.file) : '', look: this.page?.look });
    }
    document.getElementById('summary').innerHTML = this.tab || page.pullOnly ? '' : summaryHtml();
    drawSwitch();
    drawStrip();
    const tabs = document.getElementById('tabs');
    const view = document.getElementById('view');
    tabs.innerHTML = '';
    view.innerHTML = '';
    view.className = 'view'; // a diagram drawn here before made it a stage, or two halves
    Code.shown = null;
    Split.right = null;
    Split.list = null;
    this.diffs = null;

    if (state.view === 'code') {
      await drawCode(view, state.file, state.lines, state.at);
      state.at = null;
    } else if (page.pullOnly && !this.read[page.pullOnly.link]) {
      drawReading(view);
    } else if (state.view === 'conversation') {
      drawConversation(view);
    } else if (state.view === 'diffs' && page.pullOnly && !page.pullOnly.local) {
      drawPullFiles(view);
    } else if (state.view === 'diffs') {
      // "Diffs": one file with its notes, with a counter over every changed file; on a wide tab the list of the files stands at its left, as closed rows.
      tabs.innerHTML = `${Split.controlHtml('files')}<span class="nav"></span>`;
      this.diffs = Split.wanted('files') ? diffsPage(...Split.halves(view, `${LIST_WIDTH}px minmax(0,1fr)`)) : diffsPage(Split.alone(view), null);
      await this.diffs.ready;
    } else if (state.level === 'part') {
      await drawPartView(tabs, view, page.parts.find((candidate) => candidate.id === state.part));
    } else if (state.level === 'change' && onlyPart()?.diagrams.length) {
      await drawPartView(tabs, view, onlyPart());
    } else if (state.level === 'broad') {
      const broad = broadOf(state);
      if (page.onHome?.includes(broad.id)) tabs.innerHTML = `<a class="home-link" data-home="${esc(broad.id)}">on Home</a>`;
      await drawBroad(view, broad);
    } else if (Split.wanted()) {
      // The diagram of the change and the list of its diffs, closed; the keys step through the changes, and the graph follows them.
      tabs.innerHTML = `${Split.controlHtml()}${Split.allHtml(false)}<span class="nav"></span>`;
      this.diffs = await changeWithDiffs(...Split.halves(view), state.from);
    } else {
      tabs.innerHTML = Split.controlHtml();
      await drawSections(view, state.from);
    }
    if (state.view === 'diagram' && state.lit?.length) {
      const keys = state.level === 'change' ? state.lit.map((id) => `ap${page.parts.findIndex((part) => part.id === id)}`) : state.lit;
      lightNodes(view, keys);
      const first = view.querySelector('g.node.lit');
      const stage = first?.closest('.surface');
      if (stage && !stage.surface.kept) stage.surface.show(first); // not when the same diagram drew again: the view stays where he left it
    }
    Remarks.paint(view);
    Remarks.draw();
    if (state.view === 'diagram') scrollTo(0, this.scrolls[this.place()] ?? 0);
    else if (state.view !== 'conversation') scrollTo(0, 0); // the conversation opens at its own place
    tell({ type: 'state', view: state.view === 'diagram' ? 'diagram' : 'code', part: state.part ?? undefined, file: state.view === 'code' ? state.file : undefined, lines: state.lines ?? undefined });
    this.rendered = { type: 'rendered', view: state.view, level: state.level, nodes: view.querySelectorAll('g.node').length, notes: view.querySelectorAll('.mc').length, lines: state.lines ?? undefined, map: CodeMap.shown() };
    tell(this.rendered);
    window.apostilRendered = (window.apostilRendered ?? 0) + 1;
  },
};

/** The switch of views: "Conversation" when there is a pull request; a pull request with no stored change has no diagram. */
function drawSwitch() {
  const { page, state } = App;
  const link = (view) => document.querySelector(`.switch a[data-view="${view}"]`);
  const notFound = page.pullOnly && App.read[page.pullOnly.link]?.problem; // a pull request that cannot be read offers no view
  link('conversation').hidden = !App.pullLink() || !!notFound;
  link('diagram').hidden = !!page.pullOnly;
  link('diffs').hidden = !!notFound;
  link('diffs').textContent = page.pullOnly?.otherRepo ? 'Files' : 'Diffs';
  link('diagram').textContent = onlyPart() && !onlyPart().diagrams.length ? 'Code' : 'Diagram'; // one part with no diagram opens on its code
  // The look: the views in the order of a rule, without those that it leaves out.
  const views = lookViews();
  for (const view of views) document.querySelector('.switch').append(link(view));
  for (const view of ['diagram', 'diffs', 'conversation']) if (!views.includes(view)) link(view).hidden = true;
  const shown = state.view === 'code' && !App.tab && onlyPart() ? 'diagram' : state.view; // the code of a change of one part is its first view
  document.querySelectorAll('.switch a').forEach((one) => one.classList.toggle('on', one.dataset.view === shown));
}

/** The status strip of the pull request: in short from the list of the branch, in full when it is read. A file tab has none. */
function drawStrip() {
  const el = document.getElementById('status');
  const link = App.tab ? null : App.pullLink();
  const full = link && App.read[link]?.pull;
  const short = App.page.pullOnly ? full : App.pull();
  const height = el.offsetHeight;
  el.innerHTML = link && short ? Conversation.stripHtml(short, full, App.page.pullOnly ? 0 : App.pulls.length - 1) : '';
  Conversation.bindStrip(el);

  if (link && !App.read[link]) App.loadPull().then(() => (App.page.pullOnly ? App.render() : drawStrip()));
}

/** A page of a pull request with no stored change, while it is read from GitHub. */
function drawReading(view) {
  view.innerHTML = `<p class="quiet">Reading pull request #${App.page.pullOnly.number} from GitHub…</p>`;
}

/** The view "Conversation": read the pull request, then draw it, opened at the first new message. Each failure says why, with "Try again". */
function drawConversation(view) {
  const link = App.pullLink();
  if (!link) {
    view.innerHTML = `<p class="quiet">${App.pullsKnown ? 'This branch has no pull request.' : 'Looking for the pull request of this branch…'}</p>`;
    return;
  }
  const show = (read) => {
    if (App.state.view !== 'conversation' || App.pullLink() !== link) return; // he went on meanwhile
    if (!read.pull) { view.innerHTML = Conversation.problemHtml(read.problem); return; }
    Conversation.draw(view, read.pull, read.lastLooked);
    if (!App.looked.has(link)) { // the time of this look is kept; the line stays where it was on this page
      App.looked.add(link);
      tell({ type: 'looked', repo: read.pull.repo, number: read.pull.number });
    }
    window.apostilConversations = (window.apostilConversations ?? 0) + 1;
  };
  if (App.read[link]) return show(App.read[link]);
  view.innerHTML = `<p class="quiet">Reading pull request #${App.pull()?.number ?? ''} from GitHub…</p>`;
  App.loadPull().then((read) => { drawStrip(); show(read); });
}

/** "Diffs" of a pull request whose commits are not in the folder, or "Files" of another repo: its files with their counts from GitHub. */
function drawPullFiles(view) {
  const { pullOnly, files } = App.page;
  const read = App.read[pullOnly.link]?.pull;
  const line = pullOnly.otherRepo
    ? 'This pull request is in another repo. Here are its changed files.'
    : `The commits of this pull request are not in this folder. Get them with <code>${esc(pullOnly.fetch)}</code>, then open it again.`;
  const cut = read?.cut.files ? `<p class="quiet">${plural(read.cut.files, 'more file')} past the limit are on <a data-link="${esc(read.url)}">GitHub</a>.</p>` : '';
  view.innerHTML = `<p class="quiet pline">${line}</p><div class="pfiles">${files.map((file) => `<div class="pf"><span>${esc(file.path)}</span><i class="c">${countsHtml(file)}</i></div>`).join('')}</div>${cut}`;
}

/** The other pull requests of the branch, to choose one. */
function pullChoice(anchor) {
  const frame = windowFrame({ title: 'Pull requests of this branch', sub: '', width: 460, actions: '<a data-close>Close</a>' });
  frame.el.classList.add('pulls');
  const shown = App.pull();
  frame.body.innerHTML = `<div class="rows">${App.pulls.map((pull) => `<a data-pick="${pull.number}" class="${pull === shown ? 'on' : ''}">${Conversation.icon(pull, false)}<span>#${pull.number}</span><span class="ttl">${esc(pull.title)}</span><i class="c">${esc(pull.state)}</i></a>`).join('')}</div>`;
  placeWindow(frame.el, anchor.getBoundingClientRect());
  const close = () => { frame.el.remove(); removeEventListener('mousedown', outside, true); };
  const outside = (event) => { if (!frame.el.contains(event.target)) close(); };
  addEventListener('mousedown', outside, true);
  frame.el.addEventListener('click', (event) => {
    const pick = event.target.closest('[data-pick]');
    if (pick || event.target.closest('[data-close]')) close();
    if (pick) { App.state.pull = Number(pick.dataset.pick); App.render(); }
  });
}

/**
 * The views of the switch in the look of the repo (build 60): in the order of a rule on "change-view" ("order.first" comes first), without the views
 * that a rule leaves out. With no look: diagram, diffs, conversation.
 */
function lookViews() {
  return Marks.shownInOrder(Marks.changeThings(App.page, 'change-view'), App.page.look).map((view) => view.id);
}

/** The view that a change opens at first: the first view of the switch in the look that the page has; "Conversation" only with a pull request. */
function firstView() {
  return lookViews().find((view) => view !== 'conversation' || App.pullLink() || !App.pullsKnown) ?? 'diagram';
}

/**
 * The diagrams of a part in the look (build 60): without those that a rule on "part-diagram" leaves out, those of its "order.first" first, each with the
 * name that a rule gives it in the switch ("content.words", as `named`). With no look, the diagrams of the part as they are.
 */
function partDiagrams(part) {
  const { page } = App;
  const own = part.diagrams.map((id) => page.diagrams.find((candidate) => candidate.id === id));
  if (!page.look) return own;
  const things = own.filter(Boolean).map((diagram) => Marks.diagramThing(diagram, page));
  return Marks.shownInOrder(things, page.look).map((thing) => {
    const words = Marks.slotsIn(page.look, thing).content?.words;
    const diagram = own.find((one) => one.id === thing.id);
    return words ? { ...diagram, named: Marks.fillWords(esc(words), thing.fields) } : diagram;
  });
}

/** The wider diagram that the large view shows. */
const broadOf = (state) => App.page.diagrams.find((diagram) => diagram.id === state.diagram);

const KIND_WORDS = { flow: 'flow', sequence: 'sequence', state: 'states', schema: 'schema' };

/**
 * Quiet text tabs for the diagrams of a part, each named by what it explains: its function when each has its own, else its title, cut when long,
 * with the kind as a quiet word after it. The full title stands after them when the names do not already show it.
 */
function tabsHtml(diagrams, current) {
  const title = `<span class="title" ${Places.attrs({ kind: 'diagram', diagram: current.id })}>${esc(current.title)}</span>`;
  if (diagrams.length < 2) return title;
  const bySymbol = diagrams.every((diagram) => diagram.symbol) && new Set(diagrams.map((diagram) => diagram.symbol)).size === diagrams.length;
  const cut = (text) => (text.length > 40 ? `${text.slice(0, 38).trimEnd()}…` : text);
  // Named by its title, the chosen one holds a comment on the diagram as a whole, as the title does.
  const names = diagrams.map((diagram) => `<a data-diagram="${esc(diagram.id)}" title="${esc(diagram.title)}" `
    + (diagram === current ? `class="on" ${bySymbol ? '' : Places.attrs({ kind: 'diagram', diagram: diagram.id })}>` : '>')
    + `${diagram.named ?? esc(cut(bySymbol ? diagram.symbol : diagram.title))} <i class="k">${KIND_WORDS[diagram.kind]}</i></a>`).join(' · ');
  return names + (bySymbol ? title : '');
}

/** The one part of a change that has nothing else, no file in no part: the change opens that part at once. */
function onlyPart() {
  const { parts, checks } = App.page;
  return parts.length === 1 && !checks.filesInNoPart.length ? parts[0] : null;
}

/**
 * The diagrams of a part: the tabs to choose one, with what the change did to the chosen one, and the chosen one drawn.
 * On a wide tab the code stands beside it: the file of the diagram, each step joined to its rows, or else the diffs of the files of the part.
 */
async function drawPartView(tabs, view, part) {
  const { state } = App;
  const diagrams = partDiagrams(part);
  if (!diagrams.length) return App.showCode(App.firstFile(part), null); // the look leaves out all its diagrams: its code, as for a part with none
  const diagram = diagrams.find((candidate) => candidate.id === state.diagram) ?? diagrams[0];
  tabs.innerHTML = tabsHtml(diagrams, diagram) + diagramFactsHtml(diagram) + Split.controlHtml();
  if (!Split.wanted()) return drawPart(view, diagram);
  const [left, right] = Split.halves(view);
  const join = diagram.file ? await Split.showFile(right, diagram) : null;
  if (!join) Split.showDiffs(right, part.id);
  await drawPart(left, diagram, join);
}

/** The line under the head, only for what shows nowhere else: the branch that a stacked change is compared with, and what the check found wrong. Empty for a change with nothing wrong: the counts of its files are in the diagram. */
function summaryHtml() {
  const { page } = App;
  const checks = page.checks;
  const bits = [];
  if (page.baseBranch) bits.push(`compared with ${esc(page.baseBranch)}`);
  if (checks.filesInTwoParts.length) bits.push(`<b>${plural(checks.filesInTwoParts.length, 'file')} in two parts</b>`);
  if (checks.filesNotChanged.length) bits.push(`<b>${plural(checks.filesNotChanged.length, 'file')} named but not changed</b>`);
  if (checks.renamedFiles?.length) bits.push(`<b>${plural(checks.renamedFiles.length, 'file')} named by the old path</b>`);
  if (checks.badNotes.length) bits.push(`<b>${plural(checks.badNotes.length, 'note')} failed the line check</b>`);
  if (page.outOfDate) bits.push('the branch has commits that are newer than this description');
  return bits.join(' · ');
}

/** The list of every changed file, under the names of the parts, each with its counts; picking one opens it, on "Diffs" shows it, on "Diagram" brings it to the top. */
function fileList(anchor) {
  const { page } = App;
  const order = App.order();
  const current = App.diffs ? App.diffs.here()?.path : App.state.file;
  const group = ({ name, paths }) => `<div class="gp">${esc(name)}</div>` + paths.map((path) =>
    `<a data-show="${esc(path)}" class="${path === current ? 'on' : ''}"><span>${esc(path)}</span><i class="c">${countsHtml(page.files.find((file) => file.path === path))}</i></a>`).join('');
  const frame = windowFrame({ title: 'Files', sub: plural(order.length, 'changed file'), width: 640, actions: '<a data-close>Close</a>' });
  frame.el.classList.add('files');
  frame.body.innerHTML = `<div class="rows">${filesByPart().map(group).join('')}</div>`;
  placeWindow(frame.el, anchor.getBoundingClientRect());
  frame.body.querySelector('.on')?.scrollIntoView({ block: 'center' });
  const close = () => { frame.el.remove(); removeEventListener('mousedown', outside, true); };
  const outside = (event) => { if (!frame.el.contains(event.target)) close(); };
  addEventListener('mousedown', outside, true);
  frame.el.addEventListener('click', (event) => {
    const show = event.target.closest('[data-show]');
    if (show || event.target.closest('[data-close]')) close();
    if (show && App.diffs) App.diffs.toPath(show.dataset.show);
    else if (show) App.showCode(show.dataset.show, null, 'first');
  });
}

// Clicks that work anywhere on the page.
document.addEventListener('click', (event) => {
  const target = event.target;
  const go = target.closest('[data-go]');
  if (go) return App.go(JSON.parse(go.dataset.go));
  const view = target.closest('.switch a');
  if (view) {
    if (view.dataset.view === 'diffs') return App.showDiffs();
    if (view.dataset.view === 'conversation') return App.go({ view: 'conversation' });
    return App.go({ level: App.state.level === 'part' ? 'part' : App.state.level === 'broad' ? 'broad' : 'change' });
  }
  const home = target.closest('[data-home]');
  if (home) return Trail.take({ tab: 'home', diagram: home.dataset.home, lit: [], name: broadOf(App.state).title }, true);
  const diagram = target.closest('[data-diagram]');
  if (diagram) return App.go({ diagram: diagram.dataset.diagram }); // the part stays, or the change of one part
  const folder = target.closest('[data-folder]');
  if (folder) return tell({ type: 'revealFolder', path: folder.dataset.folder });
  const file = target.closest('[data-open-file]');
  if (file) return App.fileClick(file.dataset.openFile, event);
  const step = target.closest('[data-step]');
  if (step) return App.diffs ? App.diffs.stepFile(Number(step.dataset.step)) : App.step(Number(step.dataset.step), 'first');
  const change = target.closest('[data-change]');
  if (change) return App.diffs ? App.diffs.step(Number(change.dataset.change)) : Code.step(Number(change.dataset.change));
  const half = target.closest('[data-half]');
  if (half) return Split.setHidden(half.dataset.half, half.dataset.to === 'hide');
  const all = target.closest('[data-all]');
  if (all) return App.diffs?.list?.setAll(all.dataset.all === 'open');
  if (target.closest('[data-files]')) fileList(target.closest('[data-files]'));
  if (target.closest('[data-pulls]')) pullChoice(target.closest('[data-pulls]'));
  if (target.closest('[data-retry]')) App.loadPull(true).then(() => App.render());
});

// Keys for reading fast: J and K go from file to file, Alt+Down and Alt+Up from change to change by one rule (changeSteps): on "Diagram" of the change
// over the whole list; on "Diffs", in a file tab and in the file beside the diagram of a part over the changes of the file.
document.addEventListener('keydown', (event) => {
  if (event.target.closest?.('[data-field], textarea') || event.metaKey || event.ctrlKey) return;
  const { view } = App.state;
  const file = !event.altKey && (event.key === 'j' || event.key === 'k') ? (event.key === 'j' ? 1 : -1) : 0;
  const change = event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp') ? (event.key === 'ArrowDown' ? 1 : -1) : 0;
  if (file && view === 'code') App.step(file, 'first');
  else if (file && view === 'diffs') App.diffs?.stepFile(file);
  else if (file && view === 'diagram' && Split.list) Split.list.step(file);
  else if (change && (view === 'diffs' || (view === 'diagram' && App.diffs))) App.diffs?.step(change);
  else if (change && (view === 'code' || Code.shown?.steps)) Code.step(change);
  else return;
  event.preventDefault();
});

// Messages from VS Code: new data (for a file tab with its file and lines), a place to show, and the remark key.
window.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.type === 'data') {
    const changed = App.page?.changeId !== message.page.changeId || App.page?.pullOnly?.link !== message.page.pullOnly?.link;
    App.page = message.page;
    App.tab = message.file ?? null;
    if (changed) {
      Object.assign(App.state, { view: message.page.pullOnly ? 'conversation' : 'diagram', level: 'change', part: null, diagram: null, from: null, file: null, lines: null, at: null, lit: null, pull: null });
      Object.assign(App, { pulls: [], pullsKnown: false });
      if (!message.page.pullOnly && !message.file) App.state.view = firstView(); // the first view of the look
    }
    if (message.minimap !== undefined) CodeMap.on = message.minimap; // the setting of VS Code "editor.minimap.enabled"
    if (message.lines) App.state.lines = message.lines;
    if (message.at) App.state.at = message.at;
    if (message.trail) Trail.set(message.trail);
    if (message.pullRead) takePullRead(message.pullRead);
    App.render();
  }
  if (message?.type === 'pullRead') takePullRead(message);
  if (message?.type === 'minimap') { CodeMap.set(message.on); if (App.rendered) tell({ ...App.rendered, map: CodeMap.shown() }); }
  if (message?.type === 'reread') App.reread();
  if (message?.type === 'lines') App.showCode(App.tab, message.lines ?? null, message.at ?? null);
  if (message?.type === 'trail') Trail.set(message.steps);
  // A large pull request while it is read: the head and what is read so far, with how far the read is.
  if (message?.type === 'pullProgress' && App.page && App.pullLink() === message.link && !App.read[message.link]
    && (App.state.view === 'conversation' || App.page.pullOnly)) {
    Conversation.draw(document.getElementById('view'), message.pull, undefined, { read: message.read, total: message.total });
  }
  // The pull requests of the branch, in short: they come after the page. The strip and the switch show them.
  if (message?.type === 'pulls' && App.page) {
    Object.assign(App, { pulls: message.pulls, pullsKnown: true });
    if (App.state.view === 'conversation') App.render();
    else { drawSwitch(); drawStrip(); }
  }
  // A place to show: from a step back along the path (the path has it), or from a file tab (a step), with a thing to light there.
  if (message?.type === 'go') {
    const shown = message.go.code ? App.showCode(message.go.code, null, message.go.at) : App.go(message.go, !message.walk);
    if (message.place) Promise.resolve(shown).then(() => Remarks.show(message.place));
  }
  if (message?.type === 'remark') (App.drawing ?? Promise.resolve()).then(() => Remarks.openFromVsCode());
});

/** A file tab in VS Code: the pull request that the page read, so that a comment on code can go to it. */
function takePullRead({ link, read }) {
  App.read[link] = read;
  App.tabPull = link;
}

// A step back along the path that this page shows by itself: a view of the change. As a file in a browser it is the example change.
Trail.here((step) => (step.tab === 'change' && !App.tab && (App.go(step.go, true), true))
  || (step.tab === 'pull' && App.page?.pullOnly?.link === step.link && (App.go({ view: 'conversation' }, true), true)));
// A target of the look (Marks.act) that is a view of Apostil opens as a step of the path of this page; a file tab has no path, so the extension opens it.
Marks.useHere({ walk: (step) => Trail.take(step, true) });

// A drawing that waited for the hidden tab is made when the tab shows again.
const drawIfWaiting = () => { if (App.waiting) App.render(); };
document.addEventListener('visibilitychange', drawIfWaiting);

// The code view of a file tab has a narrow form, and the diagram page two halves on a wide tab: draw it again when the tab crosses that width.
// A column of another width (the tab, the side bar, the comments window) wraps the long lines again: codeWithNotes watches its own width.
let wasNarrow = null;
let wasWide = null;
const resized = new ResizeObserver(() => {
  drawIfWaiting();
  const narrow = isNarrow(document.getElementById('view'));
  const wide = Split.wide();
  if (wasNarrow !== null && narrow !== wasNarrow && App.state.view === 'code') App.render();
  else if (wasWide !== null && wide !== wasWide && (App.state.view === 'diagram' || (App.state.view === 'diffs' && !Split.hidden('files')))) App.render();
  else if (Code.shown?.scroller) fillHeight(Code.shown.scroller, Split.right ? 240 : undefined);
  wasNarrow = narrow;
  wasWide = wide;
});
resized.observe(document.body);
resized.observe(document.getElementById('view'));
// The status strip of a pull request can change its height (it arrives later, it wraps, its checks open): a diagram below fills the height that is left again.
let stripHeight = 0;
new ResizeObserver(() => {
  const height = document.getElementById('status').offsetHeight;
  if (height !== stripHeight) { stripHeight = height; dispatchEvent(new Event('resize')); }
}).observe(document.getElementById('status'));

// Start: inside VS Code ask for the data; as a file in a browser, load example-data.js with the same nonce.
const pageNonce = document.currentScript?.nonce;
if (vscodeApi) {
  tell({ type: 'ready' });
} else {
  const script = document.createElement('script');
  script.nonce = pageNonce;
  script.src = 'example-data.js';
  script.onload = () => {
    const query = new URLSearchParams(location.search);
    App.page = window.APOSTIL_EXAMPLE.page;
    if (query.get('look')) App.page = { ...App.page, look: window.APOSTIL_EXAMPLE.pageLooks[query.get('look')] }; // a made-up look of the example: "1", "shared" or "change"
    Object.assign(App, { pulls: window.APOSTIL_EXAMPLE.pagePulls ?? [], pullsKnown: true }); // in VS Code they come later
    if (query.get('pull')) return loadPullData(query.get('pull'));
    App.tab = query.get('file'); // the page as a file tab
    if (App.tab) App.loadPull(); // the pull request of the example, so that a comment on code can go to it
    if (query.get('go')) App.go(JSON.parse(query.get('go')), true); // a view that another page opened: "?go=<place>"
    else { if (!App.tab) App.state.view = firstView(); App.render(); }
  };
  script.onerror = () => { document.getElementById('view').innerHTML = '<p class="quiet">Run node out/view/example-data.js to write example-data.js.</p>'; };
  document.head.append(script);
}

/** As a file in a browser, "?pull=<file>" shows a real pull request that view/pull-request-data.ts wrote into that file, next to page.html. */
function loadPullData(file) {
  const script = document.createElement('script');
  script.nonce = pageNonce;
  script.src = file;
  script.onload = () => {
    const { page, read } = window.APOSTIL_PULL;
    App.page = page;
    App.read[page.pullOnly.link] = read;
    App.state.view = 'conversation';
    App.render();
  };
  script.onerror = () => { document.getElementById('view').innerHTML = `<p class="quiet">${esc(file)} is not there. Write it with node out/view/pull-request-data.js.</p>`; };
  document.head.append(script);
}
