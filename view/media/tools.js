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

// One run for one shortcut. VS Code runs a shortcut from the key that a page passes on to it. While a page has the keyboard, VS Code also
// tells macOS to leave the shortcuts of its menu alone: one switch for the window, which each page sets by its own clock, four times a second. When
// the keyboard goes from one page of Apostil to another (the list in the side bar and a tab), the "off" of the page that loses it can come after the
// "on" of the page that gets it. Then the menu would run the shortcut too, and Cmd+B would hide the side bar and show it again at once. A key that
// the page marks as handled never reaches that menu, and VS Code still gets it from the page, so it runs once. This holds for Cmd with a letter or a
// digit, outside a text field; not for the keys that the page or VS Code's own script of a page handles (select all, copy, cut, paste, undo), and not
// for those that only macOS runs (hide, minimize, quit).
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

/** A click on a folder or a file by its name: it shows in the tree "Files"; a file opens beside the page too, and the focus stays as it is. */
function showPaths(paths) {
  tell({ type: 'showInTree', paths, open: true });
  if (paths.length === 1 && !paths[0].endsWith('/')) tell({ type: 'openFile', path: paths[0], beside: true, preserveFocus: true });
}

// A click on a link of a session or a pull request: VS Code opens it in its app.
document.addEventListener('click', (event) => {
  const link = event.target.closest?.('[data-link]');
  if (link) tell({ type: 'openLink', url: link.dataset.link });
});

/**
 * With no agent app that Apostil can start, a direct link to install one, never words to give an agent: a page that only says what to type is not wanted.
 * The pages are INSTALL of shared/agents.ts (VS Code opens them in the browser).
 */
const INSTALL_LINKS = '<a class="inst" data-link="https://code.claude.com/docs/en/setup">Claude Code</a> or <a class="inst" data-link="https://developers.openai.com/codex/cli">Codex</a>';
const NO_APP_FOR_MAP = `To map this repo, install ${INSTALL_LINKS}. It draws the map and writes notes beside your code.`;
/** What the press does, so that nobody fears the click: a new agent session reads the repo and saves the map and the notes; no file of the repo changes. */
const MAP_RUN_WORDS = 'A new agent session reads the repo, draws its map and writes notes beside your code. It takes a few minutes and changes no file of the repo.';

/** The quiet link under the press that picks another app (VS Code's quick pick); only with two or more installed apps. */
const anotherAppHtml = (apps) => (apps.length > 1 ? '<a data-other-app>Another app</a>' : '');

const RUN_CHART_TIP = 'Opens a tab with what the lead session and each writer did, on one time axis';

/** What "Open the session" does, in its tooltip: the one way of opening a session (sessionOpens in shared/agents.ts), never a page in the browser. */
const OPENS_TIP = { app: 'Opens the session in its app', terminal: 'Opens a terminal of VS Code that continues the session', shown: 'Shows the terminal where the session writes the map' };

/**
 * The quiet line of a map run (`run`, a MapRunLine of shared/map-run.ts): which session writes the map and what is saved so far, or that the run stopped.
 * After the words, "Open the session", which VS Code opens in its app or in a terminal that continues it, and after a run of Home that stopped "Run chart" (the tab "Map run").
 * `again`: after a run that stopped, on the map, the press "Start again" (it starts `again.app`, the pointer says which) and "Another app". Nothing in the line moves.
 */
function mapRunHtml(run, again = null) {
  const words = `<span${run.tip ? ` title="${esc(run.tip)}"` : ''}>${esc(run.words)}</span>`;
  const reach = run.opens ? `<a data-open-run title="${OPENS_TIP[run.opens]}">Open the session</a>` : '';
  const chart = run.chart && run.state !== 'writing' ? `<a data-run-chart title="${RUN_CHART_TIP}">Run chart</a>` : '';
  const press = again?.app ? `<a data-write="${esc(again.app)}" title="Starts a new ${esc(AGENT_NAMES[again.app] ?? again.app)} session">Start again</a>` : '';
  return `<span class="state maprun" data-run="${esc(run.state)}">${[words, reach, chart, press, again?.app ? anotherAppHtml(again.apps) : ''].filter(Boolean).join(' · ')}</span>`;
}

/** The words of the time left of a map run: "About 14 min left", or "Less than a minute left". */
const timeWords = (minutes) => (minutes < 1 ? 'Less than a minute left' : `About ${Math.round(minutes)} min left`);

/**
 * The quiet control of the model and the effort of a run, the same everywhere a run starts or continues: "Haiku 5.5 · High"; for a map and a
 * description the lead, "Sonnet 5.5 · Medium" (its writers are fixed and do not show). A click opens its small menu in the look of the picker: the models,
 * the one in use ticked, then the efforts that the chosen model takes. One click on a model or an effort sets it; the menu stays open until Escape, a click
 * outside or a click on the box. A press reads the choice (`RunPick.value(key)`), so one click on the press starts the run with what the control shows.
 * `spec`: { app, list, run } (`run`: { model, name, effort }); `reset`: the choice starts again when it changes (another place of the card); `onOpen`:
 * called when the menu opens.
 */
const RunPick = (() => {
  const picks = {}; // by key: { spec, value, first, open }
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const DOWN = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10l5 5 5-5"/></svg>';
  const effortsOf = (list, id) => list.find((model) => model.id === id)?.efforts ?? [];

  /** The control as HTML; with its menu when it is open. */
  function html(key, spec) {
    let pick = picks[key];
    if (!pick || pick.reset !== spec.reset) pick = picks[key] = { reset: spec.reset, value: { ...spec.run }, first: { ...spec.run }, open: false };
    pick.spec = spec;
    const { app, list = [] } = spec;
    const words = States.runWords(app, pick.value, list);
    if (!list.length) return `<span class="rpick" data-rpick="${esc(key)}"><span class="rp">${esc(words)}</span></span>`; // no choice: OpenCode keeps its own
    return `<span class="rpick" data-rpick="${esc(key)}"><a class="rp${pick.open ? ' on' : ''}" data-rp-open tabindex="0">${esc(words)}${DOWN}</a>${pick.open ? menuHtml(pick) : ''}</span>`;
  }

  /**
   * The menu: the models, the one in use ticked, then the efforts that the chosen model takes, in one row of small chips, the one in use filled. It stays
   * short, so it fits under the control also in a narrow tab.
   */
  function menuHtml(pick) {
    const { app, list } = pick.spec;
    const row = (model) => `<a class="pi${model.id === pick.value.model ? ' on' : ''}" data-rp-model="${esc(model.id)}"><span>${esc(model.name)}</span>${model.id === pick.value.model ? CHECK : ''}</a>`;
    const efforts = effortsOf(list, pick.value.model);
    const chips = efforts.map((effort) => `<a class="chip${effort === pick.value.effort ? ' on' : ''}" data-rp-effort="${esc(effort)}">${esc(States.effortWord(app, effort))}</a>`).join('');
    const effortRow = efforts.length ? `<div class="psep"></div><div class="ph">${esc(States.WORDS.effort)}</div><div class="chips">${chips}</div>` : '';
    return `<div class="pmenu rmenu"><div><div class="ph">${esc(States.WORDS.model)}</div>${list.map(row).join('')}</div>${effortRow}</div>`;
  }

  /** Draws the control of a key again in place, and places its menu under it, or above it when it does not fit below, inside the page. */
  function redraw(key) {
    const el = document.querySelector(`[data-rpick="${CSS.escape(key)}"]`);
    if (!el || !picks[key]) return;
    el.outerHTML = html(key, picks[key].spec);
    place(document.querySelector(`[data-rpick="${CSS.escape(key)}"]`));
  }
  function place(el) {
    const menu = el?.querySelector('.rmenu');
    if (!menu) return;
    const at = el.getBoundingClientRect();
    const [below, above] = [innerHeight - at.bottom - 12, at.top - 12];
    const up = menu.offsetHeight > below && (menu.offsetHeight <= above || above > below);
    menu.classList.toggle('up', up);
    menu.style.maxHeight = `${Math.max(120, up ? above : below)}px`;
    if (el.closest('.pickbox')) return; // under the picker of a card it is as wide as the box
    menu.style.left = '0px';
    const right = menu.getBoundingClientRect().right;
    if (right > innerWidth - 8) menu.style.left = `${Math.max(8 - menu.getBoundingClientRect().left, innerWidth - 8 - right)}px`;
  }
  /** Places every open menu inside an element that was drawn again. */
  const placeIn = (root) => root?.querySelectorAll('[data-rpick]').forEach(place);

  const close = (key) => { if (picks[key]?.open) { picks[key].open = false; redraw(key); } };
  const openKeys = () => Object.keys(picks).filter((key) => picks[key].open);

  document.addEventListener('click', (event) => {
    const el = event.target.closest?.('[data-rpick]');
    const key = el?.dataset.rpick;
    const pick = key && picks[key];
    if (!pick) return;
    const { list = [] } = pick.spec;
    const value = pick.value;
    const take = (attr) => event.target.closest(`[${attr}]`)?.getAttribute(attr);
    if (event.target.closest('[data-rp-open]')) {
      pick.open = !pick.open;
      if (pick.open) { openKeys().filter((other) => other !== key).forEach(close); pick.spec.onOpen?.(); }
    } else if (take('data-rp-model')) {
      value.model = take('data-rp-model');
      delete value.name;
      value.effort = States.nearestEffort(effortsOf(list, value.model), value.effort);
    } else if (take('data-rp-effort')) value.effort = take('data-rp-effort');
    else return;
    event.preventDefault();
    redraw(key);
  });
  // A click outside the control closes its menu (a click on the box of a card too); Escape closes it first, and nothing else.
  document.addEventListener('mousedown', (event) => {
    for (const key of openKeys()) if (!event.target.closest?.(`[data-rpick="${CSS.escape(key)}"]`)) close(key);
  }, true);
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !openKeys().length) return;
    openKeys().forEach(close);
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  /**
   * The choice of a key: { app, model, effort, changed }, `changed` true when the model is another than the one it started with (a session that a run
   * continues keeps its own model unless he chose one). Undefined before the control was drawn.
   */
  function value(key) {
    const pick = picks[key];
    if (!pick) return undefined;
    return { app: pick.spec.app, model: pick.value.model, effort: pick.value.effort, changed: pick.value.model !== pick.first.model };
  }
  return { html, value, placeIn, close };
})();

/**
 * The control of a map run or a description run (`team`, a Team of shared/models.ts): the lead and its effort, as RunPick draws every run. The writers
 * are always the smallest model at its most effort, so they do not show and nothing here changes them. OpenCode keeps its own models.
 */
const teamPickHtml = (key, team) => RunPick.html(key, { app: team.app, list: team.list, run: team.lead ? { model: team.lead, effort: team.effort } : {}, reset: team.app });
/** The choice of that control as VS Code takes it (teamFrom in shared/models.ts): the app, the lead and its effort. Undefined before it was drawn. */
function teamChoice(key) {
  const run = RunPick.value(key);
  return run && { app: run.app, lead: run.model, effort: run.effort };
}

/**
 * One direct link that starts the work in the session that it names (`ask`, an AskView of shared/ask.ts). The page never shows the words that go to the
 * agent and never asks the person to give them: they ride in `data-ask` for VS Code alone. Before the press: `intro` and the press, with the control of
 * the model of the run after it (`ask.team`); with no app that can be started, `intro` and the links that install one. After it: the session that does
 * the work, its state ("working", "done", "stopped") and "Open the session"; after a run that stopped, the press once more.
 * A press that started no run: why, in one sentence, and the press again. Nothing in the line moves.
 */
function askHtml(ask, intro) {
  const control = ask.press && ask.team ? ` · ${teamPickHtml('ask', ask.team)}` : '';
  const press = ask.press ? `<a data-ask="${esc(ask.words)}" title="${esc(ask.press.tip)}">${esc(ask.press.label)}</a>${control}` : '';
  if (ask.problem && press) return `${esc(ask.problem)} ${press}`;
  const { line } = ask;
  if (!line) return press ? `${intro} ${press}` : `${intro} Install ${INSTALL_LINKS} to describe it.`;
  const open = line.opens ? `<a data-ask-open="${esc(ask.words)}" title="${OPENS_TIP[line.opens]}">Open the session</a>` : '';
  const who = `<span${line.tip ? ` title="${esc(line.tip)}"` : ''}>${esc(line.words)}</span>`;
  return `<span class="state ask" data-run="${esc(line.state)}">${[who, esc(line.state), open, press].filter(Boolean).join(' · ')}</span>`;
}
// A click on "Open the session" of a map run, or on the press of words and the link of their run: VS Code does it.
document.addEventListener('click', (event) => {
  if (event.target.closest?.('[data-open-run]')) tell({ type: 'openMapSession' });
  if (event.target.closest?.('[data-run-chart]')) tell({ type: 'openMapChart' });
  const ask = event.target.closest?.('[data-ask]');
  const team = teamChoice('ask');
  if (ask) tell({ type: 'askAgent', words: ask.dataset.ask, ...(team ? { team } : {}) });
  const open = event.target.closest?.('[data-ask-open]');
  if (open) tell({ type: 'openAskSession', words: open.dataset.askOpen });
});

/**
 * The press that maps a repo, on Home of a repo with no map: one link, "Map this repo", that starts a new session of `app` (the app that Apostil started
 * last, see appToStart in shared/map-app.ts); nobody has to type the words into a chat. Under it one quiet line that says which app, with "Another app" when
 * two or more are installed (`apps`), and what the press does. With no app (none is installed), the links that install one.
 * While a map run writes (`run`), its line stands in place of the press; after a run that stopped, its line stands above it.
 * Right after the press, the control of the model of the run (`team`, a Team of shared/models.ts): the lead and its effort.
 * With a .apostilignore (`scope`, scopeCounts in shared/note-groups.ts), one more quiet line: how many files it leaves out and adds, and "Edit".
 */
function mapPressHtml(apps = [], run = null, app = undefined, team = undefined, scope = undefined) {
  const line = run ? `<p>${mapRunHtml(run)}</p>` : '';
  if (run?.state === 'writing') return line;
  if (!app) return `${line}<p>${NO_APP_FOR_MAP}</p>`;
  const control = team?.app === app ? `<p class="runpick">${teamPickHtml('map', team)}</p>` : '';
  const files = (n) => `${n} ${n === 1 ? 'file' : 'files'}`;
  const scoped = scope ? `<p class="quiet">Your .apostilignore leaves out ${files(scope.leftOut)} and adds ${scope.added}. <a data-edit-scope>Edit</a></p>` : '';
  return `${line}<p class="acts"><a data-write="${esc(app)}">Map this repo</a></p>${control}<p class="quiet">Starts a new ${esc(AGENT_NAMES[app] ?? app)} session. ${anotherAppHtml(apps)}</p><p class="quiet">${MAP_RUN_WORDS}</p>${scoped}`;
}
// A click on the press: VS Code starts the session with what the control shows, and Home shows that it works.
document.addEventListener('click', (event) => {
  const write = event.target.closest?.('[data-write]');
  const team = teamChoice('map');
  if (write) tell({ type: 'writeMap', app: write.dataset.write, ...(team?.app === write.dataset.write ? { team } : {}) });
  if (event.target.closest?.('[data-other-app]')) tell({ type: 'anotherApp' }); // VS Code asks which app, and starts the map with it
  if (event.target.closest?.('[data-edit-scope]')) tell({ type: 'openFile', path: '.apostilignore' }); // the file in an editor tab
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
const ico = (name, cls = '') => `<i class="ico ${esc(name)}${cls ? ` ${esc(cls)}` : ''}"></i>`;

/**
 * The icons of files and folders as the Explorer of VS Code shows them, in the file icon theme that he uses. VS Code sends the CSS of only
 * the icons that the rows of the page use, and the class of each path (view/file-icons.ts). A row starts with FileIcons.html(path). With a theme, a
 * row with no icon keeps the room of one, so the names stand in one column; with no theme, no row has an icon or its room.
 */
const FileIcons = {
  paths: {},
  /** The icons of a page; undefined with no theme. The rows that show keep their place and get their new icons. */
  set(icons) {
    // The fonts of the theme stand in a style of their own, written again only when they change: a new @font-face loads its font again, and the
    // font icons would blink when only their colours change (a new colour theme).
    const lines = (icons?.css ?? '').split('\n');
    this.style('file-icon-fonts', lines.filter((line) => line.startsWith('@font-face')).join('\n'));
    this.style('file-icons', lines.filter((line) => !line.startsWith('@font-face')).join('\n'));
    this.paths = icons?.paths ?? {};
    document.body.classList.toggle('fi-on', !!icons);
    for (const row of document.querySelectorAll('.fi[data-fi]')) row.className = this.classOf(row.dataset.fi);
  },
  /** Writes a style element of the page, made at its first use; the same text is not written again. */
  style(id, text) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('style'); el.id = id; document.head.append(el); }
    if (el.textContent !== text) el.textContent = text;
  },
  classOf(path) {
    return this.paths[path] ? `fi ${this.paths[path]}` : 'fi';
  },
  /** The icon of a path (a folder ends with "/") at the start of its row. */
  html(path) {
    return `<i class="${this.classOf(path)}" data-fi="${esc(path)}"></i>`;
  },
};

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

/** The reviewers in the order that the faces show them: who asked for changes, who approved, who is asked, then the others; a person before a team before a bot. */
function sortedReviewers(reviewers) {
  const order = ['changes requested', 'approved', 'asked'];
  const rank = ({ state, person }) => (order.indexOf(state) + 1 || order.length + 1) * 3 + (person.bot ? 2 : person.team ? 1 : 0);
  return [...reviewers].sort((a, b) => rank(a) - rank(b));
}

/** The reviewers that the faces leave out (the "+2"). */
const hiddenReviewers = (reviewers) => sortedReviewers(reviewers).slice(REVIEWERS_SHOWN);

/**
 * The reviewers as avatars that lie over each other, the first one on top and whole; each has a small dot in the colour of its state at its lower right.
 * The pointer says the name and the state. Three show: first who asked for changes, then who approved, then who is asked, then the others; with the same
 * state a person stands before a team and a team before a bot, so that a bot that only commented takes no place from a person. The others are one more
 * round face with their count ("+2"), and the pointer on it names each with the state. The status strip of a pull request and its line in the list of the side bar use it.
 */
function reviewerFaces(reviewers, size = 's') {
  const sorted = sortedReviewers(reviewers);
  const tipOf = (reviewer) => `${reviewer.person.login}: ${(REVIEWER_LOOK[reviewer.state] ?? REVIEWER_LOOK.reviewed)[2]}`;
  const one = (reviewer, index) => {
    const [, look] = REVIEWER_LOOK[reviewer.state] ?? REVIEWER_LOOK.reviewed;
    return `<span class="rv" style="z-index:${REVIEWERS_SHOWN - index}" title="${esc(tipOf(reviewer))}">${avatar(reviewer.person, size, tipOf(reviewer))}<i class="rb ${look}"></i></span>`;
  };
  const rest = sorted.slice(REVIEWERS_SHOWN);
  // The others are one more face in the row, round and as large as the faces, with their count, behind the third face (look.css), so that it reads as the next person.
  const more = rest.length ? `<span class="rv rest" data-rest title="${esc(rest.map(tipOf).join(', '))}"><span class="av ${size}">+${rest.length}</span></span>` : '';
  return `<span class="rvs">${sorted.slice(0, REVIEWERS_SHOWN).map(one).join('')}${more}</span>`;
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

/**
 * Gives an element the height that is left in the tab, now and after each resize of the tab, until it leaves the page or another drawing in it sets its
 * height (`sized`, as keepOverview in overview.js).
 */
function keepFilled(el, least = 240) {
  fillHeight(el, least);
  const refill = () => (el.isConnected && el.sized === refill ? fillHeight(el, least) : removeEventListener('resize', refill));
  el.sized = refill;
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
