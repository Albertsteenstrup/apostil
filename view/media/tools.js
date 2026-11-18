// Small helpers that every script of the page uses, and the bridge to VS Code.
'use strict';

/** Escapes text from a change file or from Git before it goes into HTML. */
const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Makes one element from HTML text. */
function html(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}

const baseName = (path) => path.split('/').pop();
const folderOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '');
const number = (value) => value.toLocaleString('en-US');
const linesText = ([first, last]) => (first === last ? `line ${first}` : `lines ${first}–${last}`);
/** The lines of a note or a place in words: "lines 12–20", or in a cell of a notebook "cell 3, lines 2–4" (its lines counted inside the cell). */
const whereText = (target) => (target.inCell ? `${target.inCell.words}, ${linesText(target.inCell.lines)}` : linesText(target.lines));
const plural = (count, word) => `${number(count)} ${word}${count === 1 ? '' : 's'}`;

/** "+25 −17" for a changed file, as HTML. */
const countsHtml = (file) =>
  [file?.added ? `<i class="p">+${number(file.added)}</i>` : '', file?.removed ? `<i class="m">−${number(file.removed)}</i>` : ''].filter(Boolean).join(' ');

/** An animation of the page is short, and none runs when the system asks for less motion. */
const MOTION_MS = 200;
const lessMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Calls `step(part)` each frame for MOTION_MS, `part` going from 0 to 1 and easing out; with less motion once, with 1. Returns a stop. */
function glide(step) {
  if (lessMotion()) { step(1); return () => {}; }
  const start = performance.now();
  let stopped = false;
  const frame = (now) => {
    if (stopped) return;
    const t = Math.min(1, (now - start) / MOTION_MS);
    step(1 - (1 - t) ** 3);
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return () => { stopped = true; };
}

// The bridge: inside VS Code the page talks to the extension; as a file in a browser it reads example-data.js.
const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
const waiting = new Map();
let askCount = 0;
const answers = new Map();
window.apostilSent = []; // what the page told VS Code, for the browser check

// What the page keeps when VS Code loads it again: the closed sections and the fold of the remarks.
const kept = { ...(vscodeApi?.getState() ?? {}) };
function keep(change) {
  Object.assign(kept, change);
  vscodeApi?.setState(kept);
}

const MAC = /Mac/.test(navigator.platform);

// One run for one shortcut (build 64). VS Code runs a shortcut from the key that a page passes on to it. While a page has the keyboard, VS Code also
// tells macOS to leave the shortcuts of its menu alone: one switch for the window, which each page sets by its own clock, four times a second. When
// the keyboard goes from one page of Apostil to another (the list in the side bar and a tab), the "off" of the old page can come after the "on" of the
// new one. Then the menu runs the shortcut too: Cmd+B hid the side bar and showed it again at once. A key that the page marks as handled never
// reaches that menu, and VS Code still gets it from the page, so it runs once. This holds for Cmd with a letter or a digit, outside a text field;
// not for the keys that the page or VS Code's own script of a page handles (select all, copy, cut, paste, undo), and not for those that only macOS
// runs (hide, minimize, quit).
if (MAC && vscodeApi) {
  document.addEventListener('keydown', (event) => {
    const own = /^[a-z0-9]$/i.test(event.key) && !'acxvzhmq'.includes(event.key.toLowerCase());
    if (event.metaKey && own && !event.target.closest?.('[data-field], textarea, input, [contenteditable]')) event.preventDefault();
  });
}

/** Asks VS Code a question, for example "diff:src/app.py". Each answer is kept, so a second hover is instant. */
function ask(question) {
  if (!answers.has(question)) {
    answers.set(question, vscodeApi
      ? new Promise((resolve) => { const id = ++askCount; waiting.set(id, resolve); vscodeApi.postMessage({ type: 'ask', id, question }); })
      : Promise.resolve(window.APOSTIL_EXAMPLE?.answers[question]));
  }
  return answers.get(question);
}

/** Asks VS Code a question afresh, for data that may have changed since the last answer: the blocks of a look, read each time their window opens. */
function askAgain(question) {
  answers.delete(question);
  return ask(question);
}

/** Tells VS Code something that needs no answer: open a file, save a remark, what is selected. */
function tell(message) {
  window.apostilSent.push(message);
  vscodeApi?.postMessage(message);
}

// A click on a link of a session or a pull request: VS Code opens it in its app.
document.addEventListener('click', (event) => {
  const link = event.target.closest?.('[data-link]');
  if (link) tell({ type: 'openLink', url: link.dataset.link });
});

/** What to say to an agent that Apostil cannot start: the words that map the repo, which brings the notes beside the code. */
const ASK_FOR_MAP = 'Ask your agent: <b>"Map this repo for Apostil."</b> It draws the map and writes notes beside your code.';
/** What the press does, so that nobody fears the click: a new agent session reads the repo and saves the map and the notes; no file of the repo changes. */
const MAP_RUN_WORDS = 'A new agent session reads the repo, draws its map and writes notes beside your code. It takes a few minutes and changes no file of the repo.';

/** The quiet link under the press that picks another app (VS Code's quick pick); only with two or more installed apps. */
const anotherAppHtml = (apps) => (apps.length > 1 ? '<a data-other-app>Another app</a>' : '');

/**
 * The quiet line of a map run (`run`, a MapRunLine of shared/map-run.ts): which session writes the map and what is saved so far, or that the run stopped.
 * After the words, the link that opens the session in its app; for a session with no link, the command that resumes it, as text to copy (a click selects it).
 * `again`: after a run that stopped, on the map, the press "Start again" (it starts `again.app`, the pointer says which) and "Another app". Nothing in the line moves.
 */
function mapRunHtml(run, again = null) {
  const words = `<span${run.tip ? ` title="${esc(run.tip)}"` : ''}>${esc(run.words)}</span>`;
  const reach = run.link ? `<a data-link="${esc(run.link)}">Open the session</a>`
    : run.command ? `<code title="The command that resumes this session in a terminal">${esc(run.command)}</code>` : '';
  const press = again?.app ? `<a data-write="${esc(again.app)}" title="Starts a new ${esc(AGENT_NAMES[again.app] ?? again.app)} session">Start again</a>` : '';
  return `<span class="state maprun" data-run="${esc(run.state)}">${[words, reach, press, again?.app ? anotherAppHtml(again.apps) : ''].filter(Boolean).join(' · ')}</span>`;
}

/**
 * The press that maps a repo, on Home of a repo with no map: one link, "Map this repo", that starts a new session of `app` (the app that Apostil started
 * last, see appToStart in shared/map-app.ts); nobody has to type the words into a chat. Under it one quiet line that says which app, with "Another app" when
 * two or more are installed (`apps`), and what the press does. With no app (none is installed), the words to say to an agent.
 * While a map run writes (`run`), its line stands in place of the press; after a run that stopped, its line stands above it.
 */
function mapPressHtml(apps = [], run = null, app = undefined) {
  const line = run ? `<p>${mapRunHtml(run)}</p>` : '';
  if (run?.state === 'writing') return line;
  if (!app) return `${line}<p>${ASK_FOR_MAP}</p>`;
  return `${line}<p class="acts"><a data-write="${esc(app)}">Map this repo</a></p><p class="quiet">Starts a new ${esc(AGENT_NAMES[app] ?? app)} session. ${anotherAppHtml(apps)}</p><p class="quiet">${MAP_RUN_WORDS}</p>`;
}
// A click on the press: VS Code starts the session, and Home shows that it works.
document.addEventListener('click', (event) => {
  const write = event.target.closest?.('[data-write]');
  if (write) tell({ type: 'writeMap', app: write.dataset.write });
  if (event.target.closest?.('[data-other-app]')) tell({ type: 'anotherApp' }); // VS Code asks which app, and starts the map with it
});

/** What else to do next, on Home of a repo with no map: the set-up step when no agent app has the skills. */
const nextStepsHtml = (needsSetup) => (needsSetup ? '<p>Your agent apps do not have the Apostil skills yet. <a data-setup>Set up for agents</a></p>' : '');

// The link of the next step: VS Code runs "Set up for agents".
document.addEventListener('click', (event) => {
  if (event.target.closest?.('[data-setup]')) tell({ type: 'setUp' });
});

const AGENT_APPS = ['claude-code', 'codex', 'antigravity', 'opencode'];
const AGENT_NAMES = { 'claude-code': 'Claude Code', codex: 'Codex', antigravity: 'Antigravity', opencode: 'OpenCode' };

/** The icon of an agent app as HTML, or nothing for an app with no icon. */
const agentIcon = (agent) => (AGENT_APPS.includes(agent.app) ? `<img class="icon" src="agents/${agent.app}.svg" alt="${esc(agent.app)}">` : '');
const appName = (agent) => AGENT_NAMES[agent.app] ?? agent.app;

/** The head of an agent session: the icon of its app (or `icon`, from a look) and the name of the session on one line, as the link that opens it; the full name in the tooltip. */
const agentHead = (agent, icon = agentIcon(agent)) => {
  const name = esc(agent.name ?? States.WORDS.session);
  return `<div class="head">${icon || `<span>${esc(agent.app)}</span>`}`
    + (agent.link ? `<a class="ses" data-link="${esc(agent.link)}" title="${name}">${name}</a>` : agent.name ? `<span class="ses" title="${name}">${name}</span>` : '')
    + '</div>';
};

/** An icon of icons/, in the colour of its text. */
const ico = (name, cls = '') => `<i class="ico ${name}${cls ? ` ${cls}` : ''}"></i>`;

// People of GitHub: the page of a pull request and the list of the side bar draw them with the same parts.
const TINTS = 6;
const tint = (login) => [...login].reduce((sum, c) => sum + c.charCodeAt(0), 0) % TINTS;
/** The avatar: a known product's icon, GitHub's picture, or letters in a circle (one in the size "xs", else two). `size` is "xs", "s", "" or "lg". */
function avatar(person, size = '', tip = person.login) {
  if (person.icon) return `<span class="av ${size} prodav" title="${esc(tip)}">${ico(person.icon)}</span>`;
  const letters = esc(person.login.replace(/[^a-zA-Z0-9]/g, '').slice(0, size === 'xs' ? 1 : 2).toUpperCase() || '?');
  return person.avatar
    ? `<img class="av ${size}" src="${esc(person.avatar)}" alt="${letters}" title="${esc(tip)}">`
    : `<span class="av ${size} t${tint(person.login)}" title="${esc(tip)}">${letters}</span>`;
}

/** The colour of a label as "r,g,b", from the six hex digits that GitHub gives, for the variable --lc. */
const labelRgb = (label) => [0, 2, 4].map((at) => parseInt(String(label.color).slice(at, at + 2), 16) || 0).join(',');

/** Each state of a reviewer: its icon, the class of its colour, its words. */
const REVIEWER_LOOK = {
  approved: ['check', 'ok', 'approved'], 'changes requested': ['file-diff', 'bad', 'asked for changes'], reviewed: ['comment', 'quiet', 'commented'],
  dismissed: ['x', 'quiet', 'dismissed'], 'not sent yet': ['pencil', 'quiet', 'not sent yet'], asked: ['dot-fill', 'wait', 'waiting'],
};
const REVIEWERS_SHOWN = 3; // the reviewers that show as avatars; the others are a count

/**
 * The reviewers as avatars that lie over each other, the first one on top and whole; each has a small dot in the colour of its state at its lower right.
 * The pointer says the name and the state. Three show: first who asked for changes, then who approved, then who is asked, then the others; with the same
 * state a person stands before a team and a team before a bot, so that a bot that only commented takes no place from a person. The others are a count
 * ("+2"), and the pointer on it names each with the state. The status strip of a pull request and its line in the list of the side bar use it.
 */
function reviewerFaces(reviewers, size = 's') {
  const order = ['changes requested', 'approved', 'asked'];
  const rank = ({ state, person }) => (order.indexOf(state) + 1 || order.length + 1) * 3 + (person.bot ? 2 : person.team ? 1 : 0);
  const sorted = [...reviewers].sort((a, b) => rank(a) - rank(b));
  const tipOf = (reviewer) => `${reviewer.person.login}: ${(REVIEWER_LOOK[reviewer.state] ?? REVIEWER_LOOK.reviewed)[2]}`;
  const one = (reviewer, index) => {
    const [, look] = REVIEWER_LOOK[reviewer.state] ?? REVIEWER_LOOK.reviewed;
    return `<span class="rv" style="z-index:${REVIEWERS_SHOWN - index}" title="${esc(tipOf(reviewer))}">${avatar(reviewer.person, size, tipOf(reviewer))}<i class="rb ${look}"></i></span>`;
  };
  const rest = sorted.slice(REVIEWERS_SHOWN);
  return `<span class="rvs">${sorted.slice(0, REVIEWERS_SHOWN).map(one).join('')}${rest.length ? `<i class="muted" title="${esc(rest.map(tipOf).join(', '))}">+${rest.length}</i>` : ''}</span>`;
}

window.addEventListener('message', (event) => {
  if (event.data?.type !== 'answer') return;
  waiting.get(event.data.id)?.(event.data.value);
  waiting.delete(event.data.id);
});

/**
 * The small dark tooltip of an element with data-tip: it shows after a short moment while the pointer rests on the element,
 * or at once when the element has the keyboard focus, and goes when the pointer leaves. It stands above the element, below it when
 * there is no room above, and never past the edge of the page.
 */
const Tip = (() => {
  const DELAY_MS = 400;
  const EDGE = 6;
  let el = null;
  let timer = 0;
  let on = null;
  function show(target) {
    hide();
    on = target;
    el = document.createElement('div');
    el.className = 'tip';
    el.textContent = target.dataset.tip;
    document.body.append(el);
    const box = target.getBoundingClientRect();
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const top = box.top - height - 6 >= EDGE ? box.top - height - 6 : box.bottom + 6;
    const left = Math.max(EDGE, Math.min(box.left + box.width / 2 - width / 2, innerWidth - width - EDGE));
    Object.assign(el.style, { left: `${left}px`, top: `${top}px` });
  }
  function hide() {
    clearTimeout(timer);
    el?.remove();
    el = null;
    on = null;
  }
  document.addEventListener('mouseover', (event) => {
    const target = event.target.closest?.('[data-tip]');
    if (!target || target === on) return;
    clearTimeout(timer);
    timer = setTimeout(() => show(target), DELAY_MS);
  });
  document.addEventListener('mouseout', (event) => {
    const target = event.target.closest?.('[data-tip]');
    if (target && !target.contains(event.relatedTarget) && document.activeElement !== target) hide();
  });
  document.addEventListener('focusin', (event) => { if (event.target.dataset?.tip && event.target.matches(':focus-visible')) show(event.target); });
  document.addEventListener('focusout', (event) => { if (event.target === on) hide(); });
  addEventListener('scroll', hide, { passive: true, capture: true });
  document.addEventListener('mousedown', hide, true);
  return { show, hide };
})();

/** Colours comments, strings and keywords of one code line. `open` is the string quote that a line before left open. */
const KEYWORDS = new Set(('and as assert async await break case catch class const continue def del elif else except export extends false '
  + 'finally for from function if import in interface is lambda let new none nonlocal not null or pass raise return self static '
  + 'super switch this throw true try type typeof undefined var while with yield None True False').split(' '));
function colorLine(text, open) {
  let out = '';
  let at = 0;
  let word = '';
  const flushWord = () => { out += KEYWORDS.has(word) ? `<span class="k">${esc(word)}</span>` : esc(word); word = ''; };
  if (open) {
    const end = text.indexOf(open);
    if (end < 0) return { html: `<span class="s">${esc(text)}</span>`, open };
    out += `<span class="s">${esc(text.slice(0, end + open.length))}</span>`;
    at = end + open.length;
  }
  while (at < text.length) {
    const rest = text.slice(at);
    const comment = /^(#|\/\/|--\s)/.exec(rest);
    const quote = /^("""|'''|"|'|`)/.exec(rest);
    if (comment) { flushWord(); return { html: `${out}<span class="c">${esc(rest)}</span>`, open: null }; }
    if (quote) {
      flushWord();
      const mark = quote[1];
      let end = at + mark.length;
      while (end < text.length && text.slice(end, end + mark.length) !== mark) end += text[end] === '\\' ? 2 : 1;
      if (end >= text.length && (mark.length === 3 || mark === '`')) return { html: `${out}<span class="s">${esc(rest)}</span>`, open: mark };
      out += `<span class="s">${esc(text.slice(at, end + mark.length))}</span>`;
      at = end + mark.length;
      continue;
    }
    if (/\w/.test(text[at])) word += text[at];
    else { flushWord(); out += esc(text[at]); }
    at++;
  }
  flushWord();
  return { html: out, open: null };
}

/** A changed line with the words that differ from its partner line marked, as in VS Code's diff editor. */
function markedWords(text, partner) {
  let start = 0;
  while (start < text.length && text[start] === partner[start]) start++;
  let end = 0;
  while (end < text.length - start && end < partner.length - start && text[text.length - 1 - end] === partner[partner.length - 1 - end]) end++;
  const middle = text.slice(start, text.length - end);
  return middle ? `${esc(text.slice(0, start))}<span class="w">${esc(middle)}</span>${esc(text.slice(text.length - end))}` : esc(text);
}

/** The height of one code row in a box, measured once. */
function rowHeight(box) {
  box.innerHTML = '<div class="l"><span class="x">x</span></div>';
  const height = box.firstChild.getBoundingClientRect().height;
  box.innerHTML = '';
  return height || 18;
}

const OVERSCAN = 30; // rows drawn above and below what is in view

/**
 * Draws only the rows that are in view, inside a box that has the height of all rows, so the scroll bar has its real size from the start.
 * scroller: the element that scrolls, or window. row(index): the HTML of one row.
 * size(index): how many visual rows a row takes (1 when left out). The top of each row is a running sum of the heights before it.
 */
function virtualRows(scroller, box, count, row, size = () => 1) {
  const height = rowHeight(box);
  const tops = new Float64Array(count + 1);
  const real = new Map(); // rows drawn with another height than worked out (a wide character): index → height
  let width = 0; // the width of the box that the heights were worked out for
  const sum = () => {
    width = box.clientWidth;
    for (let index = 0; index < count; index++) tops[index + 1] = tops[index] + (real.get(index) ?? size(index) * height);
    box.style.height = `${tops[count]}px`;
  };
  /** The row at a height inside the box: the last row that starts at or above it. */
  const rowAt = (y) => {
    let [low, high] = [0, count];
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (tops[middle] <= y) low = middle; else high = middle - 1;
    }
    return Math.min(low, Math.max(0, count - 1));
  };
  let shown = '';
  const draw = (force) => {
    if (!box.isConnected) return stop();
    const view = scroller === window ? { top: 0, bottom: innerHeight } : scroller.getBoundingClientRect();
    const top = box.getBoundingClientRect().top;
    const first = Math.max(0, rowAt(view.top - top) - OVERSCAN);
    const last = Math.min(count, Math.max(first, rowAt(view.bottom - top) + 1 + OVERSCAN));
    if (!force && shown === `${first}:${last}`) return;
    shown = `${first}:${last}`;
    let html = `<div style="height:${tops[first]}px"></div>`;
    for (let index = first; index < last; index++) html += row(index);
    box.innerHTML = html;
    // A row drawn taller or shorter than worked out keeps its real height, and the rows are drawn again, so each stands where the sums say.
    // A page with no layout (a hidden tab) measures every row as 0, and a box of another width waits for resize(): neither is a real height.
    if (box.clientWidth !== width) return;
    let changed = false;
    [...box.children].slice(1).forEach((el, at) => {
      const drawn = el.getBoundingClientRect().height;
      if (drawn > 0 && Math.abs(drawn - (tops[first + at + 1] - tops[first + at])) > 1) { real.set(first + at, drawn); changed = true; }
    });
    if (changed) { sum(); draw(true); }
  };
  const onScroll = () => draw(false);
  const stop = () => { scroller.removeEventListener('scroll', onScroll); removeEventListener('resize', onScroll); };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  sum();
  draw(true);
  return {
    height, rowAt, top: (index) => tops[index], refresh: () => draw(true),
    /** Works every height out again, after the box got another width. */
    resize: () => { real.clear(); sum(); draw(true); },
  };
}

/** Gives an element the height that is left in the tab, now and after each resize of the tab, until it leaves the page. */
function keepFilled(el, least = 240) {
  fillHeight(el, least);
  const refill = () => (el.isConnected ? fillHeight(el, least) : removeEventListener('resize', refill));
  addEventListener('resize', refill);
}

/** Glides an element that scrolls (or window) to a place in a short animation; `to` can be a function, for a place that moves meanwhile. Returns how to stop it. */
function glideScroll(scroller, to) {
  const from = scroller === window ? scrollY : scroller.scrollTop;
  const end = typeof to === 'function' ? to : () => to;
  return glide((part) => { const y = from + (end() - from) * part; if (scroller === window) scrollTo(0, y); else scroller.scrollTop = y; });
}

/** Gives an element the height that is left in the tab below its top, so the page itself does not scroll. */
function fillHeight(el, least = 200) {
  const set = (height) => { el.style.height = `${Math.max(least, Math.floor(height))}px`; };
  set(innerHeight - el.getBoundingClientRect().top - scrollY);
  const over = document.documentElement.scrollHeight - innerHeight; // what lies below it: paddings and borders
  if (over > 0) set(el.offsetHeight - over);
}
