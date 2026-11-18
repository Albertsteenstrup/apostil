// Every state word, every dot rule and the fold of pull requests, in one place. The list, the page and the tests read it.
'use strict';

const States = (() => {
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // The words. Change them here.
  const WORDS = {
    working: 'the agent is working',
    answers: (n) => `${count(n, 'answer', 'answers')} to read`,
    waiting: (n) => `${count(n, 'comment', 'comments')} waiting for the agent`,
    sent: 'waiting for the agent',
    listening: 'the session is listening',
    openSession: 'open the session',
    connect: 'connect Claude Code',
    startRun: 'Start a run',
    answered: 'answered',
    session: 'session',
    closedOne: 'closed',
    resolve: 'Resolve',
    reopen: 'Reopen',
    resolved: (n) => `${n} resolved`,
    resolvedBy: (name) => `resolved by ${name}`,
    reply: 'Reply',
    comment: 'Comment, or @ to send it to the agent',
    discard: 'Discard this comment?',
    discardIt: 'Discard',
    keepWriting: 'Keep writing',
    you: 'You',
    comments: 'Comments',
    openPoints: 'Open points',
    goneFromDiagram: 'no longer in the diagram',
    changedFiles: 'changed:',
    noAgent: 'No agent to send to: this change has no known session, and no agent app is connected.',
    // The card of a comment and the picker of where it goes
    writeComment: 'Write a comment…',
    writeReply: 'Write a reply…',
    sendTo: 'Send to',
    close: 'Close',
    moreActions: 'More',
    openTheSession: 'Open the session',
    choiceThis: 'This session',
    choiceThisSub: 'made this change',
    choiceNew: 'New session',
    choiceGitHub: 'The pull request on GitHub',
    choiceNone: 'No agent: keep it as a note',
    keptAsNote: 'Keep it as a note',
    usedAgo: (ago) => `used ${ago}`,
    defaultModel: 'default model',
    ownModel: "OpenCode's own model",
    model: 'Model',
    effort: 'Effort',
    noAppConnected: 'No agent app is connected.',
    setUpAgents: 'Set up for agents',
    changedCount: (n) => `Changed ${count(n, 'file', 'files')}`,
    openPoint: 'Open point',
    noteToNoAgent: 'a note, sent to no agent',
    thisSession: 'the session that made this change',
    placeThis: 'this session',
    placeNew: 'new session',
    namedSession: (name) => `the session ${name}`,
    newSession: 'a new session',
    waitingFor: (name) => `waiting for ${name}`,
    isWorking: (name) => `${name} is working`,
    fold: 'Fold the comments',
    unfold: 'Open the comments',
    morePulls: (n) => `${count(n, 'more pull request', 'more pull requests')}`,
    fewer: 'Show fewer',
    pullRequests: 'Pull requests',
    nMore: (n) => `${n} more`,
    history: (n) => `History · ${n}`,
    historyTip: 'Changes whose pull requests are merged or closed',
    failedChecks: (checks) => `${checks.failed} of ${checks.failed + checks.passed + checks.pending} checks failed`,
    inStack: (place, base) => `${place.position} of ${place.size} in a stack${base ? ` onto ${base}` : ''}`,
    stackMark: (place) => `${place.position}/${place.size}`,
    // The search of the list in the side bar (media/search.js)
    changes: 'Changes',
    searchChanges: 'Search changes',
    sortAndFilter: 'Sort and filter',
    sortAndFilterFind: 'Type to find a sort, a person or a label', // in the quick pick of VS Code
    clearSearch: 'Clear the search',
    sort: 'Sort',
    sorts: { modified: 'Modified', created: 'Created', author: 'Author', size: 'Size' },
    sortOrder: { modified: ['newest first', 'oldest first'], created: ['newest first', 'oldest first'], author: ['A to Z', 'Z to A'], size: ['largest first', 'smallest first'] },
    filters: { author: 'Author', reviewer: 'Reviewer', label: 'Label', state: 'State', agent: 'Agent' },
    matching: (n, all) => `${n} of ${count(all, 'change', 'changes')}`,
    noMatch: 'No change matches',
    clear: 'Clear',
  };

  // The dots: "pulse" is the one moving thing and pulses slowly; "teal" is a filled teal dot; none else.

  // The word of each app in a mention, in the order that "@" offers them.
  const MENTION_WORDS = { 'claude-code': 'claude', codex: 'codex', antigravity: 'antigravity', opencode: 'opencode' };

  /** The one word of a mention: "claude-current" or "codex-new". */
  const mentionName = (to) => `${MENTION_WORDS[to.app] ?? to.app}-${to.kind}`;

  /** True when the change has a session of its own in an app that "@" knows. */
  const hasSession = (agent) => !!(agent && (agent.session || agent.hostSession) && MENTION_WORDS[agent.app]);

  /**
   * What "@" offers: the session that made the change first, when it has one in a connected app; then a new session of each connected app.
   * agent: the agent of the change; apps: the connected apps (on the path, with the skills of Apostil).
   */
  function mentionChoices(agent, apps) {
    const current = hasSession(agent) && apps.includes(agent.app) ? [{ app: agent.app, kind: 'current' }] : [];
    const fresh = Object.keys(MENTION_WORDS).filter((app) => apps.includes(app)).map((app) => ({ app, kind: 'new' }));
    const named = agent?.name ? WORDS.namedSession(agent.name) : WORDS.thisSession;
    return [...current, ...fresh].map((to) => ({ ...to, name: mentionName(to), does: to.kind === 'current' ? named : WORDS.newSession }));
  }

  /** The choices whose name starts with what was typed after "@". */
  const cutChoices = (choices, typed) => choices.filter((choice) => choice.name.startsWith(typed.toLowerCase()));

  const MINUTE = 60_000;
  /** How long ago a time was, in short words: "just now", "4 min ago", "3 hours ago", "2 days ago". */
  function agoWords(iso, now = Date.now()) {
    const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / MINUTE));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${count(hours, 'hour', 'hours')} ago` : `${count(Math.round(hours / 24), 'day', 'days')} ago`;
  }

  // ----- the model and the effort of a run (shared/models.ts gives the lists) -----

  /** Every effort, lowest first; a model that does not take an effort takes the nearest lower one. */
  const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  /** The words of an effort as each app names it: Claude Code says "Extra", Codex "Extra high"; the others start with a capital. */
  const EFFORT_WORDS = { 'claude-code': { xhigh: 'Extra' }, codex: { xhigh: 'Extra high' } };
  const effortWord = (app, effort) => EFFORT_WORDS[app]?.[effort] ?? (effort ? `${effort.charAt(0).toUpperCase()}${effort.slice(1)}` : '');

  /** The effort that a model takes for a wanted one: the same, else the nearest lower one, else its lowest (nearestEffort in shared/models.ts). */
  function nearestEffort(efforts = [], wanted) {
    if (!efforts.length || efforts.includes(wanted)) return wanted;
    return [...efforts].reverse().find((one) => EFFORTS.indexOf(one) <= EFFORTS.indexOf(wanted)) ?? efforts[0];
  }
  const modelIn = (list = [], id) => list.find((model) => model.id === id);
  const modelName = (list, id, name) => modelIn(list, id)?.name ?? name ?? id;

  /** The quiet words of the model and the effort of a run: "Haiku 5.5 · High"; with no model, the model of the app's own settings. */
  function runWords(app, run, list = []) {
    if (!run) return '';
    const model = run.model ? modelName(list, run.model, run.name) : run.name ?? (app === 'opencode' ? WORDS.ownModel : WORDS.defaultModel);
    return run.effort ? `${model} · ${effortWord(app, run.effort)}` : model;
  }

  /**
   * The run that a choice of the picker starts with: a session that a run continues, what it last used (`known`, from its own record), else the model of
   * a new session; a new session the model of the setting (`menu.fresh`). The effort: the session's last one, else high, as the model takes it.
   */
  function choiceRun(app, menu, known) {
    if (app === 'antigravity' || !menu) return null;
    const base = known?.model ? known : menu.fresh ?? {};
    const effort = nearestEffort(modelIn(menu.list, base.model)?.efforts, known?.effort ?? 'high');
    return { ...(base.model ? { model: base.model } : {}), ...(base.name ? { name: base.name } : {}), ...(app === 'opencode' && !base.model ? {} : { effort }) };
  }

  const PICKED_MAX = 3; // the known sessions of one app that the picker offers

  /**
   * Where a comment can go, for the picker under the box of a card. For each connected app, in the order of `apps`: this session (the session that
   * made the change, when it is of that app), the other sessions that Apostil knows in this repo and that a run can continue in this folder (newest
   * first, at most 3), and a new session. Then the pull request on GitHub, when `github` says that it takes this comment. Last, no agent.
   * A page with no stored change offers only GitHub. Each choice: { key, app, to, words, sub, model }; `to` is what the remark is sent to
   * ({ app, kind: 'current' | 'new' | 'session', session }), { app: 'github' }, or null for a note.
   */
  function sendChoices({ agent, apps = [], sessions = [], models = {}, own, github = false, pullOnly = false, now = Date.now() }) {
    const gitHub = github ? [{ key: 'github', app: 'github', to: { app: 'github' }, words: WORDS.choiceGitHub, sub: '', run: null }] : [];
    if (pullOnly) return gitHub;
    const ofApp = (app) => {
      const ofChange = hasSession(agent) && agent.app === app;
      const known = sessions.filter((one) => one.app === app && one.session !== agent?.session).sort((a, b) => b.at.localeCompare(a.at)).slice(0, PICKED_MAX);
      const menu = models[app];
      const list = menu?.list ?? [];
      return [
        ...(ofChange ? [{ key: `${app}:current`, app, to: { app, kind: 'current' }, words: WORDS.choiceThis, sub: WORDS.choiceThisSub, run: choiceRun(app, menu, own), list }] : []),
        ...known.map((one) => ({
          key: `${app}:session:${one.session}`, app, to: { app, kind: 'session', session: one.session, ...(one.name ? { name: one.name } : {}) },
          words: one.name || one.session.slice(0, 8), sub: WORDS.usedAgo(agoWords(one.at, now)), run: choiceRun(app, menu, one.run), list,
        })),
        { key: `${app}:new`, app, to: { app, kind: 'new' }, words: WORDS.choiceNew, sub: '', run: choiceRun(app, menu), list },
      ];
    };
    return [...apps.filter((app) => MENTION_WORDS[app]).flatMap(ofApp), ...gitHub, { key: 'none', app: '', to: null, words: WORDS.choiceNone, sub: '', run: null }];
  }

  /** The key of the choice that a remark was sent to: "claude-code:current", "codex:session:<id>", "github"; "none" for a note. */
  const choiceKey = (to) => (!to ? 'none' : to.app === 'github' ? 'github' : to.kind === 'session' ? `${to.app}:session:${to.session}` : `${to.app}:${to.kind}`);

  /**
   * The choice that the picker starts at: `wanted` (the choice of a thread, or the last choice in this repo) when the picker has it, else this session,
   * else a new session of the first connected app, else the first choice (GitHub on a page with no stored change, else no agent).
   */
  function startChoice(choices, wanted) {
    const has = (key) => choices.find((choice) => choice.key === key);
    return (wanted !== undefined && has(choiceKey(wanted))) || choices.find((choice) => choice.to?.kind === 'current') || choices.find((choice) => choice.to?.kind === 'new') || choices[0];
  }

  /** The place of a choice in words: "this session", "new session", or the name of a known session. */
  const placeWords = (to) => (to.kind === 'current' ? WORDS.placeThis : to.kind === 'new' ? WORDS.placeNew : to.name || to.session.slice(0, 8));

  /** The closed picker in words: "Claude Code · this session", "Codex · new session", "GitHub · the pull request". The model and the effort stand on their own line. */
  function choiceWords(choice) {
    if (!choice.to) return WORDS.keptAsNote;
    if (choice.app === 'github') return 'GitHub · the pull request';
    return `${AGENT_WORDS[choice.app] ?? choice.app} · ${placeWords(choice.to)}`;
  }
  const AGENT_WORDS = { 'claude-code': 'Claude Code', codex: 'Codex', antigravity: 'Antigravity', opencode: 'OpenCode' };

  /** Who a remark went to, in the words of the picker, for its state line: "Claude Code · this session", "Codex · new session", "Claude Code · Tests for holds". */
  const toName = (to) => `${AGENT_WORDS[to.app] ?? to.app} · ${placeWords(to)}`;

  /** How long a run has worked, in short words: "just now", "4 min", "3 hours", "2 days". */
  const forWords = (iso, now = Date.now()) => agoWords(iso, now).replace(/ ago$/, '');

  /** The state line of a row, the first that applies. counts: remarks by state; phrase: what the row says without remarks. */
  function rowLine(counts, phrase) {
    if (counts.running) return { text: WORDS.working, dot: 'pulse' };
    if (counts.done) return { text: WORDS.answers(counts.done), dot: 'teal' };
    if (counts.sent) return { text: WORDS.waiting(counts.sent) };
    return { text: phrase ?? '' };
  }

  /** The state of a row as a look names it (ROW_STATES in shared/look.ts): the first that applies, as rowLine() says it. */
  function rowState(counts, phrase = '') {
    if (counts.running) return 'working';
    if (counts.done) return 'answers';
    if (counts.sent) return 'waiting';
    return /in no part$/.test(phrase) ? 'in no part' : ['out of date', 'open folder', 'no change file'].includes(phrase) ? phrase : 'none';
  }

  /**
   * What a remark shows under its text, in the words of the picker: "Claude Code · this session is working", "waiting for Codex · new session".
   * agent: the agent of the change ({ hostSession, link, canResume }); listening: its session has a live waiter.
   * way: what the owner can do next: "listening", "connect", "start" or none. A reply with the mention sends again.
   */
  function remarkLine(remark, agent, listening) {
    if (remark.state === 'open') return { text: '' };
    const name = remark.to && toName(remark.to);
    if (remark.state === 'running') return { text: name ? WORDS.isWorking(name) : WORDS.working, dot: 'pulse' };
    if (remark.state === 'done') return { text: WORDS.answered, dot: 'teal' };
    if (remark.state === 'closed') return { text: WORDS.closedOne };
    if (remark.to?.kind === 'new') return { text: WORDS.waitingFor(name) }; // its own run takes it
    if (remark.to?.kind === 'session') return { text: WORDS.waitingFor(name), way: 'start' }; // a run continues that session
    // A comment that the page sends starts its run at once. One that still waits was sent from elsewhere, or its session cannot be continued.
    const way = listening ? 'listening' : agent?.canResume ? 'start' : agent?.hostSession ? 'connect' : undefined;
    return { text: name ? WORDS.waitingFor(name) : WORDS.sent, way };
  }

  /** The remark whose state a thread shows: the newest one that is not open, else the newest. */
  const threadLead = (thread) => [...thread].reverse().find((remark) => remark.state !== 'open') ?? thread[thread.length - 1];

  /** The state of a thread in one word, as a rule of the look names it (THREAD_STATES in shared/look.ts): resolved when every remark is closed, else the word of its lead. */
  const threadState = (thread) => (thread.every((remark) => remark.state === 'closed') ? 'resolved'
    : ({ open: 'open', sent: 'sent', running: 'working', done: 'answered', closed: 'resolved' })[threadLead(thread).state] ?? 'open');

  /**
   * The state of the mark of a thread, from its lead remark: "note" (sent to no agent), "waiting" (sent), "working", "answered" (not read in its card yet)
   * and "seen" (answered and read). `read`: its card was open after the answer came.
   */
  const markState = (lead, read = false) => ({ open: 'note', sent: 'waiting', running: 'working', done: read ? 'seen' : 'answered' })[lead.state] ?? 'note';

  /** A pull request that is not merged and not closed. */
  const isOpen = (pull) => pull.state !== 'merged' && pull.state !== 'closed';

  /**
   * The pull requests of one row (one branch) until he unfolds them: the open ones, at most `max`, and how many more there are.
   * The merged and closed ones of the row are behind the fold. A row with no open one shows its first `max`. Each row counts for itself.
   */
  function foldPulls(pulls, max = 2) {
    if (max === Infinity) return { shown: pulls, more: 0 };
    const open = pulls.filter(isOpen);
    const shown = (open.length ? open : pulls).slice(0, max);
    return { shown, more: pulls.length - shown.length };
  }

  /**
   * The rows of one agent session in three sets, each in the order of the list.
   * shown: what stands in the list at first. more: the rows with an open pull request after the first `max` of them.
   * history: the rows whose pull requests are all merged or closed. A row with no pull request, and the row that is open now, are always shown.
   */
  function foldRows(rows, pullsOf, max = 2) {
    const sets = { shown: [], more: [], history: [] };
    let open = 0;
    for (const row of rows) {
      const mine = pullsOf(row);
      const live = mine.some(isOpen);
      if (live) open += 1;
      const set = row.open ? 'shown' : mine.length && !live ? 'history' : live && open > max ? 'more' : 'shown';
      sets[set].push(row);
    }
    return sets;
  }

  /** The tooltip of the icon of a pull request: "#12 · Review needed", with its place in a stack: "#14 · Review needed · 2 of 3 in a stack". */
  const pullTip = (pull) => `#${pull.number} · ${pull.state.charAt(0).toUpperCase()}${pull.state.slice(1)}${pull.stack ? ` · ${WORDS.inStack(pull.stack)}` : ''}`;

  /**
   * The rows of the list with the rows of one stack together, in the order of the stack, the top first, where its first row stood.
   * `placeOf(row)` is the place of the row's pull request in a stack, or undefined.
   */
  function stackOrder(rows, placeOf) {
    const done = new Set();
    return rows.flatMap((row) => {
      if (done.has(row)) return [];
      const place = placeOf(row);
      const together = place ? rows.filter((other) => placeOf(other)?.number === place.number).sort((a, b) => placeOf(b).position - placeOf(a).position) : [row];
      together.forEach((one) => done.add(one));
      return together;
    });
  }

  /** The icon of the state of a pull request, 16 pixels in the colour of its state, with its tooltip on hover and on keyboard focus. */
  const pullIcon = (pull) => `<i class="pri ${esc(pull.look.icon)} ${esc(pull.look.colour)}" data-tip="${esc(pullTip(pull))}" tabindex="0" aria-label="${esc(pullTip(pull))}"></i>`;

  /** One quiet state line as HTML: at most one small dot, then the words. */
  const lineHtml = (line, more = '') => (line.text || more
    ? `<span class="state">${line.dot ? `<i class="dot ${line.dot}"></i>` : ''}${esc(line.text)}${more}</span>`
    : '');

  /** The shape of a comment: a chat bubble. The mark of a thread and the count in the top bar draw it. */
  const BUBBLE_PATH = 'M14 2.5c6.2 0 11.2 4.1 11.2 9.2S20.2 21 14 21c-1.4 0-2.8-.2-4-.6L4.6 23l1.3-4.4C3.9 16.9 2.8 14.4 2.8 11.7 2.8 6.6 7.8 2.5 14 2.5z';
  const bubbleSvg = (cls = 'cbs') => `<svg class="${cls}" viewBox="0 0 28 26" aria-hidden="true"><path d="${BUBBLE_PATH}"/></svg>`;

  /**
   * The mark of the open threads of a thing: a chat bubble in the state of the newest thread, with the icon of the app that has it (none for a note),
   * and a small count at its corner for more than one thread. A thread id makes a click open its card.
   */
  const markHtml = (state, app, count = 1, thread) => `<i class="cb ${state}"${thread ? ` data-thread="${thread}"` : ''}>${bubbleSvg()}`
    + `${state !== 'note' && AGENT_WORDS[app] ? `<img src="agents/${app}.svg" alt="${esc(AGENT_WORDS[app])}">` : ''}${count > 1 ? `<b class="n">${count}</b>` : ''}</i>`;

  return {
    WORDS, MENTION_WORDS, mentionName, mentionChoices, cutChoices, sendChoices, choiceKey, startChoice, choiceWords, agoWords, forWords, rowLine, rowState, remarkLine,
    EFFORTS, effortWord, nearestEffort, runWords,
    threadLead, threadState, markState, isOpen, foldPulls, foldRows, stackOrder, lineHtml, markHtml, bubbleSvg, BUBBLE_PATH, pullTip, pullIcon,
  };
})();

if (typeof module === 'object') module.exports = States; // for the tests in Node
