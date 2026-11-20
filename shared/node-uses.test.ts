// The test of the boxes of loose nodes on Home, on a made-up folder of code in three languages.

import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import type { Diagram } from './change-file';
import { diagramGraph } from './diagram-graph';
import { importWords, looseBoxes, withBoxes } from './node-uses';
import type { RepoMap } from './repo-map';
import { tempFolder } from './test-repo';

test('a loose node that most nodes import and one that only another area imports go in boxes with a heading; one that nothing imports stays loose', () => {
  const folder = tempFolder();
  const files: Record<string, string> = {
    'app/a.ts': "import { log } from './log';\nimport { b } from './b';\n", 'app/b.js': "const log = require('./log');\n", 'app/c.py': 'from log import write\n',
    'app/log.ts': 'export const log = 1;\n', 'app/fmt.ts': 'export const fmt = 1;\n', 'app/notes.md': '# Notes\n', 'tools/run.ts': "import { fmt } from '../app/fmt';\n",
  };
  for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(join(folder, path)), { recursive: true }); writeFileSync(join(folder, path), text); }
  const mermaid = 'flowchart LR\n  a["A"] --> b["B"]\n  b --> c["C"]\n  log["Log"]\n  fmt["Format"]\n  notes["Notes"]\n  classDef quiet fill:#eee\n';
  const area: Diagram = { id: 'app', parent: 'top', kind: 'flow', title: 'App', mermaid, nodePaths: { a: ['app/a.ts'], b: ['app/b.js'], c: ['app/c.py'], log: ['app/log.ts'], fmt: ['app/fmt.ts'], notes: ['app/notes.md'] } };
  const top: Diagram = { id: 'top', kind: 'flow', title: 'Top', mermaid: 'flowchart LR\n  app["App"] --> tools["Tools"]\n', nodePaths: { app: ['app/'], tools: ['tools/'] } };
  const map: RepoMap = { format: 1, diagrams: [top, area] };

  const boxes = looseBoxes(map, area, () => importWords(folder, Object.keys(files)));
  assert.deepEqual(boxes, [
    { id: 'usedByAll', heading: 'Used by almost every part here', nodes: ['log'] },
    { id: 'usedFromOutside', heading: 'Used from other areas: Tools', nodes: ['fmt'] },
  ]);
  // The boxes stand before the class lines and name their nodes; "notes" stays loose, and the nodes and arrows stay the same. A heading has no-break spaces.
  const text = withBoxes(mermaid, boxes).replace(/ /g, ' ');
  assert.ok(text.includes('  notes["Notes"]\n  subgraph usedByAll["Used by almost every part here"]\n    log\n  end\n  subgraph usedFromOutside["Used from other areas: Tools"]\n    fmt\n  end\n  classDef quiet'));
  assert.deepEqual(diagramGraph({ kind: 'flow', mermaid: text }), diagramGraph(area));
  assert.deepEqual(looseBoxes(map, top, () => assert.fail('no loose node: nothing is read')), []);
  rmSync(folder, { recursive: true, force: true });
});
