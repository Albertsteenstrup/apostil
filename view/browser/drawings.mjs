// The browser check of the drawn processes: the numbers on the arrows of a box, a box that many boxes call, and a long chain in columns.
// A group of view/browser-check.mjs; alone:
//   node view/browser/drawings.mjs [--pictures] [<folder for pictures>]

import { fileURLToPath } from 'node:url';
import { check, errors, finish, newPage, own, takePicture } from './tools.mjs';

const { processDrawings } = own('../out/shared/process-diagrams.js');
const { processHomeDiagram } = own('../out/shared/home-data.js');
const { stepKey } = own('../out/shared/processes.js');

/** A made-up process of one long function of 30 steps; its steps 3, 6 … 24 (eight) all call one helper after it in the same file. Its drawing of the opened function, as Home gets it. */
function longFunction() {
  const note = (file, lines, title) => ({ file, lines, title, text: `Does ${title.toLowerCase()}.` });
  const outer = note('src/loans/sweep.py', [1, 40], 'Sweep the loans of one branch');
  const steps = Array.from({ length: 30 }, (_, at) => note('src/loans/sweep.py', [at + 2, at + 2], `Step ${at + 1} of the sweep`));
  const helper = note('src/loans/sweep.py', [44, 49], 'Filter the current rows');
  const callers = steps.filter((_, at) => at % 3 === 2 && at < 24);
  const process = {
    id: 'sweep', title: 'Sweep the loans', summary: 'Walks every loan of a branch.', group: 'g', steps: [outer, ...steps, helper].map(stepKey),
    arrows: callers.map((one, at) => ({ from: stepKey(one), to: stepKey(helper), label: 'filter current rows', fromLine: one.lines[0], name: `rows${at}` })),
  };
  const drawings = processDrawings({ fileNotes: [outer, ...steps, helper], processes: [process] }, process);
  return drawings.map(processHomeDiagram);
}

try {
  const home = await newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  home.on('pageerror', (error) => errors.push(error.message));
  home.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const file = fileURLToPath(new URL('../media/home.html', import.meta.url));
  await home.goto(`file://${file}`);
  await home.waitForFunction(() => (window.apostilRendered ?? 0) >= 1, null, { timeout: 15000 });
  const drawings = longFunction();
  const opened = drawings.find((one) => one.id.includes('/'));
  /** Shows a made-up drawing on Home, apart from the example, so that its counts do not change. */
  const show = (diagrams, id, one = false) => home.evaluate(async ({ diagrams, id, one }) => {
    const data = structuredClone(window.APOSTIL_EXAMPLE.home);
    data.map.diagrams.push(...diagrams);
    Home.data = data;
    Home.at = id;
    Home.lit = [];
    await Home.render();
    if (one) { document.querySelector('.pd-columns').click(); await Home.drawing; }
  }, { diagrams, id, one });
  // The 30 steps: three columns, titles that read at 1400 by 900, and the shared box once with its count.
  await show(drawings, opened.id);
  await takePicture(home, 'drawing-30-columns.png');
  const drawn = await home.evaluate(() => {
    const svg = document.querySelector('#view svg');
    const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    const steps = [...document.querySelectorAll('#view g.node')].filter((g) => /^Step/.test(g.textContent));
    const left = (n) => steps.find((g) => g.textContent.startsWith(`Step ${n} `)).getBoundingClientRect().left;
    const ordered = left(4) < left(11) && left(11) < left(21) && Math.abs(left(11) - left(20)) < 3 && Math.abs(left(21) - left(30)) < 3;
    const font = parseFloat(getComputedStyle(steps[0].querySelector('.nodeLabel')).fontSize) * scale;
    const shared = [...document.querySelectorAll('#view g.node')].filter((g) => /Filter the current rows/.test(g.textContent));
    const words = [...document.querySelectorAll('#view .edgeLabel')].map((el) => el.textContent.trim()).filter((text) => /steps/.test(text)).filter((text, at, all) => all.indexOf(text) === at);
    return { steps: steps.length, ordered, font, shared: shared.length, words, dots: document.querySelectorAll('#view circle.calldot').length, links: document.querySelectorAll('#view path.colink').length };
  });
  check('a drawing of 30 steps with a shared box is in 3 columns (each from top to bottom, left to right) with one arrow between them, its titles read at 11 px or more at 1400 by 900, and the shared box stands once with one arrow and its count',
    drawn.steps === 30 && drawn.ordered && drawn.links === 2 && drawn.font >= 11 && drawn.shared === 1 && drawn.words.join() === 'filter current rows · 8 steps' && drawn.dots === 7, JSON.stringify(drawn));

  // A focus on a node counts the calls that have no arrow of Mermaid: a dot, and the arrow of the page from one column to the next.
  const tiedNow = () => home.evaluate(() => ({ boxes: document.querySelectorAll('#view g.node.tied').length, links: [...document.querySelectorAll('#view path.colink')].map((path) => path.classList.contains('tied')).join() }));
  await home.click('#view g.node:has-text("Filter the current rows")', { modifiers: ['Alt'] });
  const onShared = await tiedNow();
  const end = opened.columns.columns[0].filter((id) => opened.nodes[id].kind === 'step' && !opened.nodes[id].quiet).at(-1);
  await home.evaluate((id) => [...document.querySelectorAll('#view g.node')].find((g) => nodeKey(g) === id).dispatchEvent(new MouseEvent('click', { altKey: true, bubbles: true })), end); // it stands under the card
  const onEnd = await tiedNow();
  await home.mouse.move(2, 2);
  await home.waitForSelector('.win', { state: 'detached', timeout: 3000 }).catch(() => {});
  await home.keyboard.press('Escape');
  check('a focus on a node of a drawn process counts the calls with no arrow: on the shared box its 8 callers stay lit, and on the last step of a column the first step of the next with the arrow of the page between them',
    onShared.boxes === 9 && onShared.links === 'false,false' && onEnd.boxes === 3 && onEnd.links === 'true,false' && (await tiedNow()).boxes === 0, JSON.stringify({ onShared, onEnd }));

  // The pointer on the shared box lights its eight callers; a dot says which box it calls; "One column" draws the drawing in one column.
  await home.hover('#view g.node:has-text("Filter the current rows")');
  const lit = await home.evaluate(() => document.querySelectorAll('#view g.node.lit').length);
  await home.mouse.move(2, 2);
  const unlit = await home.evaluate(() => document.querySelectorAll('#view g.node.lit').length);
  // A dot inside the frame: in the overview the frame is the upper part of the tab, and the drawing opens at its top.
  const inFrame = await home.evaluate(() => { const frame = document.getElementById('view').getBoundingClientRect(); return [...document.querySelectorAll('#view circle.calldot')].findIndex((dot) => { const box = dot.getBoundingClientRect(); return box.top >= frame.top && box.bottom <= frame.bottom && box.left >= frame.left && box.right <= frame.right; }); });
  // The tip comes 0.4 s after the pointer enters the dot, and a scroll or a window that comes over the dot takes it away; under the load of the other
  // parts that can take more than 3 s. So the pointer rests on the dot until the tip shows, and enters it again if no tip came.
  const tipOf = async (target) => {
    for (let turn = 0; turn < 3; turn += 1) {
      await home.mouse.move(2, 2);
      await target.hover();
      const text = await home.waitForFunction(() => document.querySelector('.tip')?.textContent, null, { timeout: 4000 }).then((handle) => handle.jsonValue(), () => '');
      if (text) return text;
    }
    return '';
  };
  const tip = await tipOf(home.locator(`#view circle.calldot >> nth=${Math.max(0, inFrame)}`));
  await home.mouse.move(2, 2);
  await show(drawings, opened.id, true);
  const flat = await home.evaluate(() => ({ links: document.querySelectorAll('#view path.colink').length, arrows: document.querySelectorAll('#view .edgeLabel').length, again: document.querySelector('.pd-columns').textContent }));
  check('the pointer on the shared box lights its 8 callers and no more after it leaves, the pointer on a dot says which box it calls, and "One column" draws one column with the link "Columns"',
    lit === 8 && unlit === 0 && tip === 'Calls Filter the current rows' && flat.links === 0 && flat.again === 'Columns', JSON.stringify({ lit, unlit, tip, flat }));
  await takePicture(home, 'drawing-30-one-column.png');

  // A box of the example with two calls: its arrows are numbered 1 and 2 in the order of their lines, and the box with one arrow has no number.
  await home.goto(`file://${file}?diagram=process:list-requests`);
  await home.waitForFunction(() => (window.apostilRendered ?? 0) >= 1, null, { timeout: 15000 });
  const numbers = await home.$$eval('#view .edgeLabel:has(.eo)', (labels) => [...new Set(labels.map((el) => el.textContent.trim()))]);
  // The number is no part of the name of an arrow: a comment stays on its arrow when the order of the calls changes.
  const names = await home.$$eval('#view .edgeLabel:has(.eo)', (labels) => [...new Set(labels.map((el) => JSON.parse(el.closest('[data-remark]')?.dataset.remark ?? '{}').name ?? 'no mark'))]);
  check('a box of the example with two calls shows "1" and "2" before the words of its arrows, in the order of their lines, and a comment names each arrow by its words alone',
    numbers.join() === '1 make the service,2 turn rows into views' && names.join() === 'make the service,turn rows into views', `${numbers.join()} / ${names.join()}`);
  await takePicture(home, 'two-numbered-arrows.png');

  // A group whose node has many labelled arrows to nodes above it: Mermaid puts some labels on the title of the group (set here by hand, the way the owner saw them);
  // they slide along their arrows off it, and a label that moved still lies on its arrow.
  const arrows = Array.from({ length: 7 }, (_, at) => `  inside -->|"${at + 1} serve the app ${at}"| up${at}["Outside node ${at}"]`).join('\n');
  const text = `flowchart BT\n  subgraph a["some-folder/approaches/some-long-name-with-many-words/serve_thing.py"]\n    inside["Inside node"]\n  end\n${arrows}`;
  const crowded = await home.evaluate(async ({ text, slide }) => {
    const probe = Object.assign(document.body.appendChild(document.createElement('div')), { id: 'probe', style: 'position:fixed;left:0;top:0;width:1300px;background:#fff;z-index:9' });
    const svg = await drawMermaid(probe, text);
    const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const line = probe.querySelector('g.cluster .cluster-label p').getBoundingClientRect();
    const labels = [...probe.querySelectorAll('.edgeLabels > g.edgeLabel')];
    labels.slice(2, 5).forEach((label, at) => {
      const box = label.getBoundingClientRect();
      const toLocal = label.parentElement.getScreenCTM().inverse();
      const point = new DOMPoint(line.left + line.width / 2 + (at - 1) * 70, line.top + line.height / 2).matrixTransform(toLocal);
      label.setAttribute('transform', `translate(${point.x}, ${point.y})`);
    });
    const titles = () => [...probe.querySelectorAll('g.cluster .cluster-label p')].map((one) => {
      const range = document.createRange();
      range.selectNodeContents(one);
      return range.getBoundingClientRect();
    });
    const covering = () => labels.filter((label) => titles().some((title) => overlap(label.getBoundingClientRect(), title))).length;
    const before = covering();
    if (slide) slideLabelsOffGroupTitles(svg);
    const paths = [...probe.querySelectorAll('.edgePaths > path:not(.hit)')];
    const off = [...probe.querySelectorAll('.edgeLabels > g.edgeLabel[data-slid]')].map((label) => {
      const box = label.getBoundingClientRect();
      const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      const path = paths[labels.indexOf(label)];
      const matrix = path.getScreenCTM();
      let near = Infinity;
      for (let at = 0; at <= path.getTotalLength(); at += 0.5) {
        const point = path.getPointAtLength(at).matrixTransform(matrix);
        near = Math.min(near, Math.hypot(point.x - middle.x, point.y - middle.y));
      }
      return near;
    });
    return { labels: labels.length, before, covering: covering(), slid: off.length, farthest: Math.max(0, ...off), masked: svg.querySelectorAll('.edgePaths[mask]').length };
  }, { text, slide: true });
  await takePicture(home.locator('#probe'), 'group-title-labels.png');
  await home.evaluate(() => document.getElementById('probe').remove());
  check('a label of an arrow that lay on the title of a group slides along its arrow off it and stays on the arrow (within 2 px), and the arrows pass behind the title',
    crowded.labels === 7 && crowded.before === 3 && crowded.covering === 0 && crowded.slid === 3 && crowded.farthest <= 2 && crowded.masked === 1, JSON.stringify(crowded));
  await home.close();
} catch (error) {
  check('the checks ran to the end', false, error.message.split('\n').slice(0, 14).join(' / '));
}
await finish();
