// Made-up diagrams of a part for the browser checks, which hold what the example change does not: a changed and a removed step,
// a removed state and transition, a removed message. "diffs" and "looks" use them.

import { own } from './tools.mjs';

const { partDiagram } = own('../out/view/page-data.js');

/** The made-up diagrams. `workerCode` is the answer of the example page to "code:src/library/night_jobs.py" (its lines, changed and removed rows). */
export function madeUpDiagrams(workerCode) {
  const worker = 'src/library/night_jobs.py';
  // A made-up diagram is built as the page builds one (partDiagram), from made-up added and removed lines of one file, or from the real ones of night_jobs.py.
  const madeUpLines = (added, removedAt) => ({ length: 9000, added, removed: removedAt.map((at, index) => ({ at, line: 900 + index })), totals: { added: 0, removed: 0 } });
  const fixture = (diagram, lines = madeUpLines([], [])) => ({ ...partDiagram(diagram, { fileChange: () => lines, text: () => [], fileIsNew: false, checked: false }), part: 'hold-service' });
  const shopFlow = fixture({
    id: 'shop-flow', kind: 'flow', title: 'How the shop sends an order', file: worker, nodeLines: { take: [238, 241], check: [242, 244], pack: [248, 249], done: [251, 251] },
    before: 'flowchart TD\n  take["Take the order"]\n  check{"Paid?"}\n  mail["Mail the receipt"]\n  done(["Done"])\n  take --> check\n  check -- yes --> mail\n  mail --> done\n  check -- no --> done',
    mermaid: 'flowchart TD\n  take["Take the order"]\n  check{"Paid in full?"}\n  pack["Pack the box"]\n  ship["Ship the box"]\n  done(["Done"])\n  take --> check\n  check -- yes --> pack\n  pack --> ship\n  ship --> done\n  check -- no --> done',
  }, madeUpLines([[238, 239], [242, 242]], [243, 251]));
  const shopStates = fixture({
    id: 'shop-states', kind: 'state', title: 'The states of a parcel',
    before: 'stateDiagram-v2\n  [*] --> waiting\n  waiting --> packed: pack\n  packed --> sent: send\n  packed --> waiting: unpack\n  sent --> lost: lose',
    mermaid: 'stateDiagram-v2\n  [*] --> waiting\n  waiting --> packed: pack\n  packed --> sent: send\n  sent --> delivered: deliver',
  });
  const shopTransitions = fixture({
    id: 'shop-transitions', kind: 'state', title: 'How a parcel moves', file: worker,
    mermaid: 'stateDiagram-v2\n  [*] --> waiting\n  waiting --> packed: pack\n  packed --> sent: send\n  packed --> waiting: unpack\n  sent --> delivered: deliver',
    edgeLines: [{ from: 'waiting', to: 'packed', label: 'pack', lines: [240, 241] }, { from: 'packed', to: 'sent', label: 'send', lines: [245, 247] }, { from: 'sent', to: 'delivered', label: 'deliver', lines: [221, 222] }],
  }, madeUpLines([[240, 241], [245, 245]], [246, 221]));
  const shopSequence = fixture({
    id: 'shop-sequence', kind: 'sequence', title: 'One night of the shop', file: worker,
    edgeLines: [{ from: 'S', to: 'S', label: 'lock the orders', lines: [248, 250] }],
    before: 'sequenceDiagram\n  participant C as Night run\n  participant S as Shop\n  C->>S: wake up\n  S->>S: load the orders\n  S->>S: mail the owner\n  S-->>C: counts',
    mermaid: 'sequenceDiagram\n  participant C as Night run\n  participant S as Shop\n  C->>S: wake up\n  S->>S: load the orders\n  S->>S: lock the orders\n  S-->>C: counts',
  }, madeUpLines([[248, 250]], []));
  // The end of the night run in night_jobs.py, with its real lines: the change removed the line that logged a failed sweep of reservations (old line 539)
  // and added the line that logs a failed requeue of holds (line 535), at the same place. The removed transition has the removed line.
  const workerLines = { length: workerCode.lines.length, added: workerCode.changed, removed: workerCode.removed.map(({ at, line, text }) => ({ at, line, text })), totals: { added: 0, removed: 0 } };
  const runEnd = fixture({
    id: 'run-end', kind: 'state', title: 'How a night run ends', file: worker,
    before: 'stateDiagram-v2\n  running --> idle: requeued\n  running --> failed: log the sweep failure',
    mermaid: 'stateDiagram-v2\n  running --> idle: requeued\n  running --> failed: log the requeue failure',
    nodeLines: { running: 'no-line', idle: 'no-line', failed: 'no-line' },
    edgeLines: [
      { from: 'running', to: 'idle', lines: [531, 533] }, { from: 'running', to: 'failed', label: 'log the requeue failure', lines: [535, 535] },
      { from: 'running', to: 'failed', label: 'log the sweep failure', lines: { lines: [539, 539], removed: true } },
    ],
  }, workerLines);
  // A text with the removed things that does not draw: the diagram of now is drawn, with the marks that need no removed thing.
  const broken = { ...shopFlow, id: 'shop-broken', title: 'A text that does not draw', draw: `${shopFlow.plain}\n  mail["Mail the receipt"` };
  return { madeUpLines, fixture, shopFlow, shopStates, shopTransitions, shopSequence, workerLines, runEnd, broken };
}
