// Tests for "apostil prompt <kind>", and for the line of the skills that has each writer run it in place of a copied prompt.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runApostil } from '../shared/test-repo';
import { SKILLS, WRITER_FILES } from './prompt-command';

const skill = (path: string): string => readFileSync(join(SKILLS, path), 'utf8');

test('apostil prompt prints what a writer of that kind follows: its prompt, then the text rules, each after a line with its path, and the example of the overview; an unknown kind fails with the list of kinds', () => {
  const notes = runApostil(['prompt', 'notes']);
  assert.equal(notes.status, 0);
  assert.equal(notes.stdout, `----- apostil-map-repo/notes-writer-prompt.md -----\n${skill('apostil-map-repo/notes-writer-prompt.md')}\n\n`
    + `----- apostil-describe-change/text-rules.md -----\n${skill('apostil-describe-change/text-rules.md')}\n`);
  const overview = runApostil(['prompt', 'overview']).stdout;
  assert.ok(overview.includes(`----- apostil-map-repo/example-map.json -----\n${skill('apostil-map-repo/example-map.json')}`));

  for (const kind of ['no-such-kind', 'constructor']) { // a name of every object is no kind either
    const unknown = runApostil(['prompt', kind]);
    assert.equal(unknown.status, 1);
    assert.equal(unknown.stdout, '');
    for (const name of ['overview', 'area', 'notes', 'process', 'service', 'mark', 'describe', 'fresh-check']) assert.ok(unknown.stderr.includes(name), name);
  }
});

test('each skill gives a writer the one line that runs apostil prompt with its kind, and never the full text of a writer prompt', () => {
  const lead = { map: skill('apostil-map-repo/SKILL.md'), describe: skill('apostil-describe-change/SKILL.md') };
  for (const kind of Object.keys(WRITER_FILES)) {
    const said = ['describe', 'fresh-check'].includes(kind) ? lead.describe : lead.map;
    assert.ok(said.includes(`"First run \`apostil prompt ${kind}\` and follow what it prints."`), kind);
  }
  assert.ok(!lead.map.includes('the full text of') && !lead.describe.includes('the full text of'));
});
