// The browser check of build 64: back and forward along the path with the keys of a browser, the focus on a node, the view that stays when a
// diagram draws again, and one icon for one service between an arrow and its ends. A group of view/browser-check.mjs; alone:
//   node view/browser/navigate.mjs [--pictures] [<folder for pictures>]

import { fileURLToPath } from 'node:url';
import { check, errors, finish, newPage, takePicture } from './tools.mjs';

try {
  const homeFile = fileURLToPath(new URL('../media/home.html', import.meta.url));
  const home = await newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  home.on('pageerror', (error) => errors.push(error.message));
  home.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  home.setDefaultTimeout(5000); // a step that leads nowhere fails its own check soon
  const drawn = () => home.waitForFunction(() => (window.apostilRendered ?? 0) >= 1, null, { timeout: 15000 }); // the first drawing of a page just loaded
  const homeAt = async (query) => { await home.goto(`file://${homeFile}${query}`); await drawn(); };
  const settled = () => home.evaluate(() => (typeof Home === 'object' ? Home : App).drawing); // the drawing that a click or a key asked for
  const crumb = () => home.evaluate(() => document.getElementById('crumb').textContent);
  const nodeOf = (key) => `#view g.node[id*="flowchart-${key}-"]`;
  const away = async () => { await home.mouse.move(2, 2); await home.waitForSelector('.win', { state: 'detached', timeout: 3000 }); };
  /** A key that goes to another page: the page that it leads to is drawn. */
  const toPage = async (key, address) => { await home.keyboard.press(key); await home.waitForURL(address, { timeout: 5000 }).catch(() => {}); await drawn(); };

  // ----- Cmd+Left and Cmd+Right: back and forward along the path, inside one page and from page to page; not in a text field -----
  await homeAt('');
  await home.click(nodeOf('lending'));
  await settled();
  const lower = await crumb();
  await away();
  await home.keyboard.press('Meta+ArrowLeft');
  await settled();
  const back = await crumb();
  await home.keyboard.press('Meta+ArrowRight');
  await settled();
  const forward = await crumb();
  // On to the page of a change, from the window of a node; back from there to Home, and forward to the change again.
  const touched = await home.evaluate(() => Object.entries(diagramOf(Home.at).nodes).find(([, node]) => node.changes.length)[0]);
  await home.hover(nodeOf(touched));
  await home.click('.win .rows a[data-change-id]').catch(() => {});
  await home.waitForURL(/page\.html/, { timeout: 5000 }).catch(() => {});
  await drawn();
  const onChange = await crumb();
  await toPage('Meta+ArrowLeft', /home\.html/);
  const backHome = await crumb();
  await toPage('Meta+ArrowRight', /page\.html/);
  const forwardChange = await crumb();
  // In a text field the key keeps its meaning: the caret goes to the start of the line, and the page stays.
  await home.keyboard.press('Meta+Shift+Period');
  const part = await home.$eval('#view b[data-part]', (el) => { const box = el.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; }).catch(() => ({ x: 700, y: 450 }));
  await home.mouse.move(part.x - 3, part.y - 3);
  await home.mouse.move(part.x, part.y, { steps: 2 });
  await home.mouse.click(part.x, part.y);
  await home.waitForSelector('.cbox [data-field="new"]:focus', { timeout: 3000 }).catch(() => {});
  await home.keyboard.type('bc');
  await home.keyboard.press('Meta+ArrowLeft');
  await home.keyboard.type('a');
  await home.waitForTimeout(250); // a step back would load another page by now
  const inField = { text: await home.$eval('.cbox [data-field="new"]', (el) => el.innerText.trim()).catch(() => ''), page: /page\.html/.test(home.url()), crumb: await crumb() };
  await home.keyboard.press('Escape');
  // A new step drops the steps ahead: back to Home, one level down another way, and forward leads nowhere.
  await toPage('Meta+ArrowLeft', /home\.html/);
  await home.keyboard.press('Meta+ArrowLeft');
  await settled();
  const top = await crumb();
  await home.click(nodeOf('routes')).catch(() => {});
  await settled();
  const other = await crumb();
  await home.keyboard.press('Meta+ArrowRight');
  await settled();
  await home.waitForTimeout(250);
  const dropped = { crumb: await crumb(), page: /home\.html/.test(home.url()) };
  check('Cmd+Left goes one step back along the path and Cmd+Right forward again, inside Home and from the page of a change to Home and back; in a text field the key moves the caret and the page stays; a new step drops the steps ahead',
    lower === 'Home›Lending: holds, requests and mails' && back === 'Home' && forward === lower && onChange.startsWith(`${lower}›`) && backHome === lower && forwardChange === onChange
      && inField.text === 'abc' && inField.page && inField.crumb === onChange && top === 'Home' && other === 'Home›Processes of Web routes' && dropped.crumb === other && dropped.page,
    JSON.stringify({ lower, back, forward, onChange, backHome, forwardChange, inField, top, other, dropped }));

  // ----- Option+click focuses a node with its arrows and the nodes at their other ends; Escape, the ×, the same node again and the look -----
  await homeAt('?diagram=lib-lending');
  const focusNow = () => home.evaluate(() => {
    const view = document.getElementById('view');
    const faint = (el) => getComputedStyle(el).opacity === '0.4';
    const nodes = [...view.querySelectorAll('g.node')];
    return {
      on: view.classList.contains('focus'), focused: nodes.filter((g) => g.classList.contains('focused')).map(nodeKey).join(),
      near: nodes.filter((g) => !faint(g)).map(nodeKey).sort().join(), faint: nodes.filter(faint).length,
      arrows: [...view.querySelectorAll('.edgePaths > path:not(.hit)')].filter((path) => !faint(path)).length,
      line: (document.querySelector('#summary .fc')?.textContent ?? '').replace(/^ · /, ''), // after other words of the line a dot stands before it
    };
  });
  // The node with the most arrows that still leaves a node out, and what the graph says is near it.
  const wanted = await home.evaluate(() => {
    const { nodes, edges } = diagramOf(Home.at).graph;
    const nearOf = (key) => new Set([key, ...edges.filter((edge) => edge.from === key || edge.to === key).flatMap((edge) => [edge.from, edge.to])]);
    const key = Object.keys(nodes).filter((one) => nearOf(one).size < Object.keys(nodes).length).sort((a, b) => nearOf(b).size - nearOf(a).size)[0];
    return { key, near: [...nearOf(key)].sort().join(), arrows: edges.filter((edge) => edge.from === key || edge.to === key).length, all: Object.keys(nodes).length, name: Marks.nameOf(document.querySelector(`#view g.node[id*="flowchart-${key}-"]`)) };
  });
  const sentBefore = await home.evaluate(() => window.apostilSent.length);
  await home.click(nodeOf(wanted.key), { modifiers: ['Alt'] });
  const focused = await focusNow();
  const led = await home.evaluate((from) => window.apostilSent.slice(from).map((one) => one.type).filter((type) => type !== 'pointer'), sentBefore);
  const stayed = await home.evaluate(() => Home.at);
  await takePicture(home, '64-focus-on-a-node.png');
  await away();
  await home.keyboard.press('Escape');
  const afterEscape = await focusNow();
  // The quiet link in the window of the node does the same; the × of the line ends it; so does Option+click on the same node again.
  await home.hover(nodeOf(wanted.key));
  await home.waitForSelector('.win .tb .act [data-act]', { timeout: 3000 }).catch(() => {});
  const link = await home.textContent('.win .tb .act [data-act]').catch(() => '');
  await home.click('.win .tb .act [data-act]').catch(() => {});
  const byLink = await focusNow();
  await home.click('#summary [data-end-focus]').catch(() => {});
  const afterCross = await focusNow();
  await home.click(nodeOf(wanted.key), { modifiers: ['Alt'] });
  await home.click(nodeOf(wanted.key), { modifiers: ['Alt'] });
  const afterAgain = await focusNow();
  // A look that gives Option+click on a node a target wins: no focus, and the click goes to that target.
  await homeAt('?look=shared');
  const lookBefore = await home.evaluate(() => window.apostilSent.length);
  await home.click(nodeOf('jobs'), { modifiers: ['Alt'] });
  const lookWins = { on: (await focusNow()).on, sent: await home.evaluate((from) => window.apostilSent.slice(from).map((one) => one.type).filter((type) => type !== 'pointer').join(), lookBefore) };
  // A step of a drawn process that holds steps: the click goes no level down, and the line names the step without the count of its steps.
  await homeAt('?diagram=process:ask-request');
  const step = home.locator('#view g.node', { hasText: /\d+ steps?$/ }).first();
  const stepWords = (await step.textContent().catch(() => '')).trim();
  await step.click({ modifiers: ['Alt'] }).catch(() => {});
  const onStep = { ...(await focusNow()), at: await home.evaluate(() => Home.at) };
  // The graphs page: a panel is one thing to click, and Option+click on a node in it focuses that node in the panel; the page stays.
  await homeAt(`?path=${encodeURIComponent('src/library/lending/')}`);
  const inPanel = home.locator('.pnl .pd g.node[id*="flowchart-service-"]').first();
  await inPanel.waitFor({ state: 'attached' }).catch(() => {});
  await inPanel.click({ modifiers: ['Alt'] }).catch(() => {});
  const panelNow = () => home.evaluate(() => ({
    graphs: /[?&]path=/.test(location.search), focused: [...document.querySelectorAll('.pnl .pd.focus g.node.focused')].map((g) => nodeKey(g)).join(),
    panels: document.querySelectorAll('.pnl .pd.focus').length, line: document.querySelector('#summary .fc')?.textContent ?? '',
  })).catch(() => ({})); // a click that led away leaves a page that is still loading
  await home.waitForTimeout(300); // a click of the panel itself would have left the page by now
  const onPanel = await panelNow();
  await home.keyboard.press('Escape');
  const panelAfter = await panelNow();
  check('Option+click on a node of a diagram focuses it: the node, its arrows and the nodes at their other ends stay and the rest is faint, one quiet line names it, and the click leads nowhere; Escape ends it; the link "Focus on this node" in its window does the same, the × of the line ends it, and Option+click on the same node again ends it; a look that gives that click a target wins; a step of a drawn process is named without the count of its steps; on the graphs page the click focuses the node inside its panel and the page stays',
    focused.on && focused.focused === wanted.key && focused.near === wanted.near && focused.faint === wanted.all - wanted.near.split(',').length && focused.faint > 0 && focused.arrows === wanted.arrows
      && focused.line === `Focus: ${wanted.name} · ×` && led.join() === '' && stayed === 'lib-lending'
      && !afterEscape.on && afterEscape.faint === 0 && afterEscape.line === '' && link === 'Focus on this node' && byLink.focused === wanted.key && byLink.near === wanted.near
      && !afterCross.on && !afterAgain.on && afterAgain.faint === 0 && !lookWins.on && lookWins.sent === 'target'
      && onStep.on && onStep.at === 'process:ask-request' && /\d+ steps?$/.test(stepWords) && /^Focus: \S/.test(onStep.line) && !/\d+ steps?/.test(onStep.line)
      && onPanel.graphs && onPanel.focused === 'service' && onPanel.panels === 1 && /Focus: \S/.test(onPanel.line) && panelAfter.graphs && panelAfter.panels === 0 && panelAfter.line === '',
    JSON.stringify({ wanted, focused, led, stayed, afterEscape, link, byLink, afterCross, afterAgain, lookWins, stepWords, onStep, onPanel, panelAfter }));

  // ----- the view stays: a diagram that draws again with new marks keeps its zoom and its place; a fit and a new diagram fit again -----
  await homeAt('');
  const frame = () => home.$eval('#view svg', (svg) => svg.getAttribute('viewBox').split(' ').map((part) => Math.round(Number(part))).join(' '));
  const chips = () => home.$$eval('#view .mk-chip', (all) => all.length);
  const fitted = await frame();
  /** A pinch at the pointer (a wheel with Ctrl) zooms in. */
  const pinch = async (x, y) => { await home.mouse.move(x, y); await home.keyboard.down('Control'); await home.mouse.wheel(0, -60); await home.keyboard.up('Control'); };
  await pinch(900, 500);
  await home.mouse.down();
  await home.mouse.move(820, 440, { steps: 4 }); // and a drag moves it
  await home.mouse.up();
  const left = await frame();
  const chipsBefore = await chips();
  // New data of the same diagram: one more service at a file of the desk, as a writer adds it.
  await home.evaluate(async () => {
    const look = Home.data.look;
    Home.data = { ...Home.data, look: { ...look, marks: [...look.marks, { ...look.marks[0], value: 'night-bell', file: 'src/library/desk/desk.py', line: 3, at: 3 }] } };
    await Home.render();
  });
  const again = { frame: await frame(), chips: await chips() };
  // A double click on an empty place fits it, and the next drawing fits too; a new diagram fits.
  const corner = await home.$eval('#view', (el) => { const box = el.getBoundingClientRect(); return { x: box.left + 6, y: box.bottom - 6 }; });
  await home.mouse.dblclick(corner.x, corner.y);
  const afterFit = await frame();
  await home.evaluate(() => Home.render());
  const fitAgain = await frame();
  // The page of a change: its diagram keeps the view too when the page draws again.
  await home.goto(`file://${fileURLToPath(new URL('../media/page.html', import.meta.url))}`);
  await drawn();
  const changeFitted = await frame();
  await pinch(700, 500);
  const changeLeft = await frame();
  await home.evaluate(() => App.render());
  const changeAgain = await frame();
  check('a diagram that draws again with new data keeps the zoom and the place that he left it at, on Home (one more service shows) and on the page of a change; a double click on an empty place fits it, and then a new drawing fits too',
    left !== fitted && again.frame === left && again.chips > chipsBefore && afterFit === fitted && fitAgain === fitted && changeLeft !== changeFitted && changeAgain === changeLeft,
    JSON.stringify({ fitted, left, chipsBefore, again, afterFit, fitAgain, changeFitted, changeLeft, changeAgain }));

  // ----- one icon for one service: the call box shows it, the arrow to that box does not, and the window of the box lists the use at that line -----
  await homeAt('?diagram=process:ask-request');
  const once = await home.evaluate(() => {
    const diagram = diagramOf(Home.at);
    // The arrow to a call box whose line holds a mark: the made-up process stores a row in the database of the example there.
    const markAt = (line) => Home.data.look.marks.find((one) => one.file === line.file && one.line === line.line);
    const [from, to] = Object.keys(diagram.edgeLines).map((key) => key.split('>')).find(([start, end]) => diagram.nodes[end].kind === 'call' && markAt(diagram.edgeLines[`${start}>${end}`][0]));
    const mark = markAt(diagram.edgeLines[`${from}>${to}`][0]);
    return {
      box: to, value: mark?.value, line: mark?.at,
      onBox: [...document.querySelectorAll(`#view g.node[id*="flowchart-${to}-"] .mk-chip`)].map((chip) => chip.dataset.mk).join(),
      onArrows: document.querySelectorAll('#view .edgePaths .mk-chip').length, all: document.querySelectorAll(`#view .mk-chip[data-mk="services:${mark?.value}"]`).length,
      onSteps: document.querySelectorAll(`#view g.node:not([id*="flowchart-${to}-"]) .mk-chip[data-mk="services:${mark?.value}"]`).length,
    };
  });
  await takePicture(home, '64-one-icon-for-one-service.png');
  await home.hover(nodeOf(once.box));
  await home.waitForSelector('.win .mk-line', { timeout: 3000 }).catch(() => {});
  const use = await home.$$eval('.win .mk-line [data-mk-line]', (all) => all.map((el) => Number(el.dataset.mkLine))).catch(() => []);
  check('in a drawn process a service whose call box shows its icon has no second icon on the arrow to that box, and the window of the box lists the use at the line of the arrow',
    !!once.value && once.onBox === `services:${once.value}` && once.onArrows === 0 && once.all === 1 + once.onSteps && use.includes(once.line), JSON.stringify({ once, use }));
} catch (error) {
  check('the checks ran to the end', false, String(error).split('\n').slice(0, 12).join(' / ').slice(0, 1200));
}
await finish();
