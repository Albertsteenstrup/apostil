// The state card of a pull request, at the top of "Conversation" (conversation.js draws it): what matters before a merge, in one place.
// From the facts of the read alone: the state in one headline with its icon, its colour and one sentence; what blocks a merge, each with the place
// of its fix; three counts (checks, threads, approvals); and the actions that GitHub lets him take, the primary one first. No drawing: the tests read it in Node.
'use strict';

const MergeCard = (() => {
  // The words. Change them here.
  const WORDS = {
    ready: 'Ready to merge', able: 'Able to merge', blocked: 'Blocked', behind: (base) => `Behind ${base}`, conflicts: (base) => `Conflicts with ${base}`,
    draft: 'Draft', merged: 'Merged', closed: 'Closed', queued: 'In the merge queue', unknown: 'Checking if it can merge', merging: 'Merging…',
    notApproved: 'No one has approved it',
    noBlock: (count) => (count === 1 ? 'This does not block a merge.' : 'These do not block a merge.'),
    behindSay: (count, base) => `${count ? `${count === 1 ? '1 commit' : `${count} commits`} behind ${base}. ` : ''}The repo wants the branch up to date before a merge.`,
    conflictsSay: 'Fix them on GitHub, or in the branch here and push.',
    draftSay: 'Not ready for review yet.',
    unknownSay: 'GitHub is still working out if it can merge.',
    mergingSay: (method, base) => `${METHODS[method]?.name ?? 'Merge'} into ${base}`,
    openThreads: (count) => (count === 1 ? '1 thread is not resolved' : `${count} threads are not resolved`),
    // The meters
    checks: 'Checks', comments: 'Comments', approvals: 'Approvals',
    noChecks: 'No checks', noThreads: 'No threads on code', allResolved: (count) => (count === 1 ? 'The thread is resolved' : `All ${count} resolved`),
    unresolved: (open, all) => `${open} of ${all} unresolved`, noReview: 'No review asked', approvedOf: (approved, of) => `${approved} of ${of} approved`,
    // The actions
    merge: 'Merge', confirm: 'Confirm merge', cancel: 'Cancel', mergeAdmin: 'Merge as admin', update: 'Update branch', readyIt: 'Ready for review',
    draftIt: 'Convert to draft', close: 'Close pull request', reopen: 'Reopen', deleteBranch: 'Delete branch', conflictsLink: 'Resolve the conflicts on GitHub',
    branchDeleted: (branch) => `The branch ${branch} is deleted.`,
    adminLine: 'As an admin you may merge past the rules of the repo.',
    title: 'Commit title', message: 'Commit message', method: 'How it merges',
  };

  // The merge methods, in GitHub's order, each with one sentence.
  const METHODS = {
    MERGE: { name: 'Merge commit', say: (base) => `Every commit of the branch goes into ${base}, joined by one merge commit.` },
    SQUASH: { name: 'Squash', say: (base) => `The commits become one commit on ${base}.` },
    REBASE: { name: 'Rebase', say: (base) => `Each commit is put on top of ${base}, with no merge commit.` },
  };

  // The icon and the colour of each kind of card: the state colours of the page (--pr-green and the others).
  const KINDS = {
    ready: ['git-merge', 'green'], able: ['git-merge', 'grey'], blocked: ['stop', 'red'], behind: ['sync', 'amber'], conflicts: ['git-merge-conflict', 'red'],
    draft: ['git-pull-request-draft', 'grey'], merged: ['git-merge', 'purple'], closed: ['git-pull-request-closed', 'red'], queued: ['git-merge-queue', 'amber'],
    unknown: ['clock', 'grey'], merging: ['git-merge', 'grey'],
  };

  // The looks of the states that an action gives at once, as STATE_LOOKS in shared/pull-requests.ts has them (a test keeps them the same).
  // A pull request that opens again, or leaves its draft, looks "review needed" until the next read says more.
  const LOOKS = {
    closed: { icon: 'git-pull-request-closed', colour: 'red' }, merged: { icon: 'git-merge', colour: 'purple' }, draft: { icon: 'git-pull-request-draft', colour: 'grey' },
    'review needed': { icon: 'git-pull-request', colour: 'green' },
  };

  const MERGEABLE = ['CLEAN', 'UNSTABLE', 'HAS_HOOKS']; // GitHub may merge it now; what else the sentence says does not block
  const FAILED = ['failed', 'timed out', 'needs action', 'cancelled'];
  // Where the fix of a blocker is: the checks list, the first open thread, the review panel, "Update branch", the conflicts on GitHub, the pull request below.
  const FIX = { 'checks failed': 'checks', 'checks running': 'checks', review: 'review', threads: 'comments', behind: 'update', conflicts: 'conflicts', stack: 'stack', draft: 'ready', rule: 'github' };

  /** Every review thread of a pull request: in a review, or alone. */
  const threadsOf = (pull) => pull.items.flatMap((item) => (item.kind === 'review' ? item.threads : item.kind === 'thread' ? [item.thread] : []));
  const approvedBy = (pull) => pull.reviewers.filter((one) => one.state === 'approved').map((one) => one.person.login);
  const isApproved = (pull) => pull.review === 'APPROVED' || approvedBy(pull).length > 0;
  const behind = (pull) => (pull.behindBy ?? 0) > 0 || pull.mergeState === 'BEHIND';

  /** The checks by state, from their list; from the counts of the read when the list was cut. */
  function checkCounts(pull) {
    const list = pull.checks.list ?? [];
    const of = (states) => list.filter((check) => states.includes(check.state)).length;
    return list.length && !pull.cut?.checks
      ? { failed: of(FAILED), running: of(['waiting', 'running']), skipped: of(['skipped']), passed: of(['passed', 'neutral']) }
      : { failed: pull.checks.failed, running: pull.checks.pending, skipped: 0, passed: pull.checks.passed };
  }

  /** The three counts, each with its words and the parts of its thin bar ({ count, look }): checks, threads on code, approvals. */
  function meters(pull) {
    const checks = checkCounts(pull);
    const checkWords = [[checks.failed, 'failed'], [checks.running, 'running'], [checks.skipped, 'skipped'], [checks.passed, 'passed']].filter(([count]) => count).map(([count, word]) => `${count} ${word}`);
    const threads = threadsOf(pull);
    const open = threads.filter((thread) => !thread.resolved).length;
    // Approvals: of the people asked or who gave a verdict, at least as many as GitHub needs. A bot that only commented gives no verdict.
    const people = pull.reviewers.filter((one) => !one.person.bot);
    const approved = people.filter((one) => one.state === 'approved').length;
    const waiting = people.filter((one) => one.state === 'asked' || one.state === 'changes requested').length;
    const needed = pull.needs?.approvals ?? (pull.review === 'REVIEW_REQUIRED' ? 1 : 0);
    const asked = Math.max(needed, approved + waiting);
    return {
      checks: { go: 'checks', label: WORDS.checks, text: checkWords.join(' · ') || WORDS.noChecks, parts: [[checks.failed, 'bad'], [checks.running, 'wait'], [checks.skipped, 'quiet'], [checks.passed, 'ok']].map(([count, look]) => ({ count, look })) },
      comments: { go: 'comments', label: WORDS.comments, text: !threads.length ? WORDS.noThreads : open ? WORDS.unresolved(open, threads.length) : WORDS.allResolved(threads.length), parts: [{ count: threads.length - open, look: 'ok' }, { count: open, look: 'wait' }] },
      approvals: { go: 'review', label: WORDS.approvals, text: asked ? WORDS.approvedOf(approved, asked) : WORDS.noReview, parts: [{ count: approved, look: 'ok' }, { count: asked - approved, look: 'none' }], none: approved === 0 },
    };
  }

  /**
   * What blocks a merge and what does not, from GitHub's own word (mergeStateStatus) and the parts of the merge sentence:
   * CLEAN, UNSTABLE and HAS_HOOKS can merge, so only the stack below blocks and the rest are notes; BEHIND blocks only for being behind;
   * BLOCKED, or no word, blocks for every part but being behind. Threads that are not resolved block when the base asks for it.
   */
  function split(pull) {
    const state = pull.mergeState ?? '';
    const blockers = [];
    const notes = [];
    for (const part of pull.merge?.parts ?? []) {
      if (['ready', 'unknown', 'done'].includes(part.about)) continue;
      const blocks = part.about === 'stack' || (!MERGEABLE.includes(state) && part.about !== 'auto merge'
        && (state === 'BEHIND' ? part.about === 'behind' : part.about !== 'behind'));
      (blocks ? blockers : notes).push(part);
    }
    const open = threadsOf(pull).filter((thread) => !thread.resolved).length;
    if (pull.needs?.resolved && open && state === 'BLOCKED') {
      const rule = blockers.findIndex((part) => part.about === 'rule'); // the rule of the repo is this one
      blockers.splice(rule < 0 ? blockers.length : rule, rule < 0 ? 0 : 1, { text: WORDS.openThreads(open), about: 'threads' });
    }
    if (!blockers.length && !isApproved(pull) && !pull.merge?.ready) notes.push({ text: WORDS.notApproved, about: 'review' });
    return { blockers: blockers.map((part) => ({ ...part, go: fixOf(pull, part.about) })), notes };
  }

  /** The place of the fix of a blocker; "github" when only GitHub can do it, or he may not. */
  function fixOf(pull, about) {
    if (about === 'behind' && !pull.may?.updateBranch) return 'github';
    if (about === 'draft' && !pull.may?.update) return '';
    return FIX[about] ?? 'github';
  }

  /** The sentence of a ready pull request: what holds. */
  function readySay(pull) {
    const names = approvedBy(pull);
    const people = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
    const approval = names.length ? `Approved by ${people}` : pull.review === 'APPROVED' ? 'Approved' : 'No review is needed';
    const { passed, skipped } = checkCounts(pull); // a ready pull request has no failed or running check that blocks
    const checks = !passed ? 'no checks ran' : passed === 1 ? 'the check passed' : `all ${passed} checks passed`;
    return `${approval}, and ${checks}${skipped ? ` (${skipped} skipped)` : ''}.`;
  }

  /** The kind of the card, from the facts: the first that holds. */
  function kindOf(pull, blockers, notes) {
    if (pull.state === 'merged') return 'merged';
    if (pull.state === 'closed') return 'closed';
    if (pull.queued) return 'queued';
    if (pull.draft) return 'draft';
    if (pull.mergeable === 'CONFLICTING' || pull.mergeState === 'DIRTY') return 'conflicts';
    if (pull.merge && !pull.merge.known) return 'unknown';
    if (blockers.length) return blockers.every((part) => part.about === 'behind') ? 'behind' : 'blocked';
    return notes.length ? 'able' : 'ready';
  }

  /**
   * The card of a pull request: { kind, headline, sentence, icon, colour, blockers, notes, meters, primary, links }.
   * `ago` says a time in words ("3 days ago"); the page gives its own. `primary` is "merge" or null: the only filled button of the page.
   * `links` are the quiet actions in their order: merge-admin, update, ready, draft, conflicts, close, reopen, delete-branch.
   */
  function of(pull, ago = () => '') {
    const { blockers, notes } = split(pull);
    const counts = meters(pull);
    const kind = kindOf(pull, blockers, notes);
    const may = pull.may ?? {};
    const open = pull.state !== 'merged' && pull.state !== 'closed';
    const ended = pull.ended ?? {};
    const byWhen = [ended.by ? `by ${ended.by.login}` : '', ended.at ? ago(ended.at) : ''].filter(Boolean).join(' '); // "by ines 3 days ago"
    const say = (bits) => { const text = bits.filter(Boolean).join(', '); return text.charAt(0).toUpperCase() + text.slice(1); };
    const sentence = {
      ready: () => readySay(pull),
      able: () => `${notes.map((part) => part.text).join(' · ')}. ${WORDS.noBlock(notes.length)}`,
      blocked: () => blockers.map((part) => part.text).join(' · '),
      behind: () => WORDS.behindSay(pull.behindBy, pull.base),
      conflicts: () => WORDS.conflictsSay,
      draft: () => WORDS.draftSay,
      merged: () => say([byWhen, ended.commit ? `as ${ended.commit}` : '']),
      closed: () => say([byWhen, 'not merged']),
      queued: () => pull.merge?.sentence ?? '',
      unknown: () => WORDS.unknownSay,
    }[kind]();
    const headline = { behind: WORDS.behind(pull.base), conflicts: WORDS.conflicts(pull.base) }[kind] ?? WORDS[kind];
    const canMerge = open && !pull.draft && (kind === 'ready' || kind === 'able') && !!may.merge && (pull.methods ?? []).length > 0;
    const links = [
      kind === 'blocked' && may.mergeAsAdmin && (pull.methods ?? []).length ? 'merge-admin' : '',
      open && behind(pull) && may.updateBranch ? 'update' : '',
      open && pull.draft && may.update ? 'ready' : '',
      open && !pull.draft && may.update ? 'draft' : '',
      kind === 'conflicts' ? 'conflicts' : '',
      open && may.close ? 'close' : '',
      pull.state === 'closed' && may.reopen ? 'reopen' : '',
      pull.state === 'merged' && may.deleteBranch && pull.headRefId ? 'delete-branch' : '',
    ].filter(Boolean);
    const [icon, colour] = KINDS[kind];
    return { kind, headline, sentence, icon, colour: kind === 'blocked' && !blockers.some((part) => ['checks failed', 'conflicts'].includes(part.about)) ? 'amber' : colour, blockers, notes, meters: counts, primary: canMerge ? 'merge' : null, links };
  }

  /** The card while a merge runs: "Merging…", the method and the base; no action. */
  const merging = (pull, method) => ({ ...of(pull), kind: 'merging', headline: WORDS.merging, sentence: WORDS.mergingSay(method, pull.base), icon: KINDS.merging[0], colour: KINDS.merging[1], blockers: [], notes: [], primary: null, links: [] });

  /** True when he may merge now: the press "Merge" in the strip and the filled button of the card. */
  const canMerge = (pull) => of(pull).primary === 'merge';

  /** The method that the merge step starts with: the one he used last in this repo, else GitHub's for him, else the first that the repo allows. */
  const firstMethod = (pull, last) => [last, pull.defaultMethod].find((method) => (pull.methods ?? []).includes(method)) ?? (pull.methods ?? [])[0];

  /** The commit title and message that the merge step starts with: as GitHub fills them for him, else as GitHub writes them. A rebase has none. */
  function commitText(pull, method) {
    if (method === 'REBASE') return null;
    const own = pull.commitTexts?.[method];
    if (own) return own;
    const owner = (pull.headRepo || pull.repo).split('/')[0];
    return method === 'SQUASH' ? { title: `${pull.title} (#${pull.number})`, body: '' } : { title: `Merge pull request #${pull.number} from ${owner}/${pull.head}`, body: pull.title };
  }

  const done = (sentence) => ({ known: true, ready: false, parts: [{ text: sentence, about: 'done' }], sentence });
  const UNKNOWN = { known: false, ready: false, parts: [{ text: 'GitHub is still working it out', about: 'unknown' }], sentence: 'GitHub is still working it out' };
  const without = (merge, about) => {
    const parts = (merge?.parts ?? []).filter((part) => part.about !== about);
    return { ...merge, parts, sentence: parts.map((part) => part.text).join(' · ') };
  };

  /**
   * What an action changes in the pull request at once, before GitHub answers: the fields to put on it. `me` is he himself, `now` the time,
   * `merged` GitHub's answer to a merge. A failure puts back what these fields were.
   */
  function after(pull, action, me, now, merged = {}) {
    switch (action) {
      case 'close': return { state: 'closed', look: LOOKS.closed, open: false, merge: done('Closed, not merged'), ended: { by: me, at: now } };
      case 'reopen': return { state: 'review needed', look: LOOKS['review needed'], open: true, merge: UNKNOWN, ended: undefined };
      case 'ready': return { draft: false, state: pull.state === 'draft' ? 'review needed' : pull.state, look: pull.state === 'draft' ? LOOKS['review needed'] : pull.look, merge: without(pull.merge, 'draft') };
      case 'draft': return { draft: true, state: 'draft', look: LOOKS.draft, merge: { ...pull.merge, parts: [{ text: 'A draft: not ready for review', about: 'draft' }, ...without(pull.merge, 'draft').parts] } };
      // The branch gets new commits: GitHub works out again if it can merge, and its checks run again.
      case 'update': return { behindBy: 0, merge: UNKNOWN };
      case 'merged': {
        const by = merged.by ?? me;
        const how = { MERGE: ' with a merge commit', SQUASH: ' with a squash', REBASE: ' with a rebase' }[merged.method] ?? '';
        return { state: 'merged', look: LOOKS.merged, open: false, queued: false, merge: done(`Merged by ${by.login}${how}`), ended: { by, at: merged.at ?? now, commit: merged.commit } };
      }
      case 'delete-branch': return { headRefId: '', branchDeleted: true };
      default: return {};
    }
  }

  return { WORDS, METHODS, LOOKS, of, merging, meters, canMerge, firstMethod, commitText, after, threadsOf };
})();

if (typeof module === 'object') module.exports = MergeCard; // for the tests in Node
