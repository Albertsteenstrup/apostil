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
    since: (time) => `since ${time}`,
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
    noAgent: 'No agent to send to: this change has no known session, and no agent app is installed.',
    thisSession: 'the session that made this change',
    namedSession: (name) => `the session ${name}`,
    newSession: 'a new session',
    waitingFor: (name) => `waiting for ${name}`,
    isWorking: (name) => `${name} is working`,
    fold: 'Fold the comments',
    unfold: 'Open the comments',
    morePulls: (n) => `${count(n, 'more pull request', 'more pull requests')}`,
    fewer: 'Show fewer',
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

  /**
   * What "@" offers: the session that made the change first, when it has one; then a new session of each installed app.
   * agent: the agent of the change; apps: the apps whose program is on the path.
   */
  function mentionChoices(agent, apps) {
    const current = agent && (agent.session || agent.hostSession) && MENTION_WORDS[agent.app] ? [{ app: agent.app, kind: 'current' }] : [];
    const fresh = Object.keys(MENTION_WORDS).filter((app) => apps.includes(app)).map((app) => ({ app, kind: 'new' }));
    const named = agent?.name ? WORDS.namedSession(agent.name) : WORDS.thisSession;
    return [...current, ...fresh].map((to) => ({ ...to, name: mentionName(to), does: to.kind === 'current' ? named : WORDS.newSession }));
  }

  /** The choices whose name starts with what was typed after "@". */
  const cutChoices = (choices, typed) => choices.filter((choice) => choice.name.startsWith(typed.toLowerCase()));

  /** The state line of a row, the first that applies. counts: remarks by state; phrase: what the row says without remarks. */
  function rowLine(counts, phrase) {
    if (counts.running) return { text: WORDS.working, dot: 'pulse' };
    if (counts.done) return { text: WORDS.answers(counts.done), dot: 'teal' };
    if (counts.sent) return { text: WORDS.waiting(counts.sent) };
    return { text: phrase ?? '' };
  }

  /**
   * What a remark shows under its text. agent: the agent of the change ({ hostSession, link, canResume }); listening: its session has a live waiter.
   * way: what the owner can do next: "listening", "connect", "start" or none. A reply with the mention sends again.
   */
  function remarkLine(remark, agent, listening) {
    if (remark.state === 'open') return { text: '' };
    const name = remark.to && mentionName(remark.to);
    if (remark.state === 'running') return { text: name ? WORDS.isWorking(name) : WORDS.working, dot: 'pulse' };
    if (remark.state === 'done') return { text: WORDS.answered, dot: 'teal' };
    if (remark.state === 'closed') return { text: WORDS.closedOne };
    if (remark.to?.kind === 'new') return { text: WORDS.waitingFor(name) }; // its own run takes it
    // A comment that the page sends starts its run at once. One that still waits was sent from elsewhere, or its session cannot be continued.
    const way = listening ? 'listening' : agent?.canResume ? 'start' : agent?.hostSession ? 'connect' : undefined;
    return { text: name ? WORDS.waitingFor(name) : WORDS.sent, way };
  }

  /** The remark whose state a thread shows: the newest one that is not open, else the newest. */
  const threadLead = (thread) => [...thread].reverse().find((remark) => remark.state !== 'open') ?? thread[thread.length - 1];

  /** The look of a circle: the state of the remark. A sent remark still looks open; a closed one is faint. */
  const circleOf = (remark) => ({ running: 'running', done: 'done', closed: 'closed' })[remark.state] ?? 'open';

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

  /** The circle with a number, in the look of a state. A thread id makes a click bring up its card. */
  const circleHtml = (number, look, thread) => `<i class="rk ${look}"${thread ? ` data-thread="${thread}"` : ''}>${number}${look === 'done' ? ' ✓' : ''}</i>`;

  return { WORDS, MENTION_WORDS, mentionName, mentionChoices, cutChoices, rowLine, remarkLine, threadLead, circleOf, isOpen, foldPulls, foldRows, stackOrder, lineHtml, circleHtml, pullTip, pullIcon };
})();

if (typeof module === 'object') module.exports = States; // for the tests in Node
