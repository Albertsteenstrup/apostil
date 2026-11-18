// Tests for the places of the cards of the overview (build 84, placeCards in media/overview.js): no hole in the block, the first card at the top left,
// the reading order kept where it can be, and every card within 1 to 3 units each way. Given sizes; no browser.

import assert from 'node:assert/strict';
import { test } from 'node:test';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { placeCards, drawingUnits } = require('../../view/media/overview.js');

type Place = { x: number; y: number; w: number; h: number };
type Size = { w: number; h: number };

/** The cells of the block that no card covers, and the cells that two cards cover. */
function holes(places: Place[], columns: number): { empty: string[]; twice: string[] } {
  const bottom = Math.max(...places.map((one) => one.y + one.h));
  const empty: string[] = [];
  const twice: string[] = [];
  for (let y = 0; y < bottom; y++) {
    for (let x = 0; x < columns; x++) {
      const over = places.filter((one) => x >= one.x && x < one.x + one.w && y >= one.y && y < one.y + one.h).length;
      if (over === 0) empty.push(`${x},${y}`);
      if (over > 1) twice.push(`${x},${y}`);
    }
  }
  return { empty, twice };
}

const within = (places: Place[], columns: number): boolean => places.every((one) => one.w >= 1 && one.w <= 3 && one.h >= 1 && one.h <= 3 && one.x >= 0 && one.x + one.w <= columns);

test('cards of the same size of build 83 stand in rows, in their order, with the first at the top left', () => {
  const places: Place[] = placeCards(Array.from({ length: 10 }, () => ({ w: 2, h: 2 })), 10);
  assert.deepEqual(places.slice(0, 6), [{ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 }, { x: 4, y: 0, w: 2, h: 2 }, { x: 6, y: 0, w: 2, h: 2 }, { x: 8, y: 0, w: 2, h: 2 }, { x: 0, y: 2, w: 2, h: 2 }]);
  assert.deepEqual(holes(places, 10), { empty: [], twice: [] });
});

test('cards of different sizes leave no hole: a card next to a hole grows into it, the last row ends flush, and the order is kept where it can be', () => {
  // 8 columns: a wide card, a small one, a tall one, then cards that would leave holes in a plain grid.
  const sizes: Size[] = [{ w: 3, h: 2 }, { w: 1, h: 1 }, { w: 2, h: 3 }, { w: 2, h: 1 }, { w: 3, h: 1 }, { w: 1, h: 2 }, { w: 2, h: 2 }];
  const places: Place[] = placeCards(sizes, 8);
  assert.deepEqual(places[0], { x: 0, y: 0, w: 3, h: 2 }); // the first card at the top left
  assert.deepEqual(holes(places, 8), { empty: [], twice: [] });
  assert.ok(within(places, 8));
  // The order of reading: each card starts at or after the start of the one before it, unless it filled a hole further up.
  const starts = places.map((one) => one.y * 8 + one.x);
  assert.ok(starts.filter((start, at) => at > 0 && start < starts[at - 1]).length <= 2, JSON.stringify(places));
  // A last card alone in its row: the card above grows down to meet it, so the block ends flush.
  const alone: Place[] = placeCards([{ w: 2, h: 2 }, { w: 2, h: 2 }, { w: 2, h: 2 }, { w: 2, h: 2 }, { w: 1, h: 1 }], 4);
  assert.deepEqual(holes(alone, 4), { empty: [], twice: [] });
  assert.ok(within(alone, 4));
});

test('many made-up sets of sizes on grids from 4 to 12 units wide: never a hole, never two cards on one cell, and every card within its limits', () => {
  let seed = 84;
  const random = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let round = 0; round < 3000; round++) {
    const columns = 4 + Math.floor(random() * 9);
    const sizes: Size[] = Array.from({ length: 1 + Math.floor(random() * 16) }, () => ({ w: 1 + Math.floor(random() * 3), h: 1 + Math.floor(random() * 3) }));
    const places: Place[] = placeCards(sizes, columns);
    // A few cards that do not reach across stand in one row at the left, and the room at their right is not a hole.
    const across = Math.max(...places.map((one) => one.x + one.w));
    if (across < columns) assert.ok(places.every((one) => one.y === 0), JSON.stringify(places));
    const found = holes(places, across);
    assert.deepEqual(found, { empty: [], twice: [] }, `${columns} columns, sizes ${JSON.stringify(sizes)}: ${JSON.stringify(places)}`);
    assert.ok(within(places, columns), JSON.stringify(places));
    assert.deepEqual([places[0].x, places[0].y], [0, 0]);
  }
});

test('the size of a card with a drawing follows its shape: a wide drawing more units across, a tall one more down, many nodes larger than three', () => {
  const wide = drawingUnits({ nodes: 3, ratio: 4 });
  const tall = drawingUnits({ nodes: 3, ratio: 0.4 });
  assert.ok(wide.w > wide.h && tall.h > tall.w, JSON.stringify({ wide, tall }));
  const many = drawingUnits({ nodes: 14, ratio: 1.3 });
  assert.ok(many.w * many.h > 4, JSON.stringify(many));
});
