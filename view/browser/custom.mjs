// The browser check of the shared kinds of every component of a look (build 57): what shows, the words with fields, where a click, a key, a double
// click and a right-click entry go, the sections of a window, and the fields of a note card. A group of view/browser-check.mjs; alone:
//   node view/browser/custom.mjs [--pictures] [<folder for pictures>]
// It runs in the look "Apostil", on the made-up look "?look=shared" (view/check-example/look/look-shared.json). The later briefs add their checks here.

import { fileURLToPath } from 'node:url';
import { check, errors, finish, openPage, pageFile, takePicture } from './tools.mjs';

const homeFile = fileURLToPath(new URL('../media/home.html', import.meta.url));
const node = (key) => `#view :is(g.node, g.image-shape)[id*="flowchart-${key}-"]`;
const drawn = (page, count = 1) => page.waitForFunction((at) => (window.apostilRendered ?? 0) >= at, count, { timeout: 15000 });
/** What the page sent for a target of the look since `from` (an index into apostilSent). */
const targets = (page, from = 0) => page.evaluate((at) => window.apostilSent.slice(at).filter((one) => one.type === 'target').map((one) => one.target), from);
const sentNow = (page) => page.evaluate(() => window.apostilSent.length);
/** The pointer to the middle of an element, and its box. */
const pointAt = async (page, selector) => { const box = await page.locator(selector).first().boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 }); return box; };
const away = (page) => page.mouse.move(5, 5, { steps: 2 }).then(() => page.waitForFunction(() => !document.querySelector('.win'), null, { timeout: 3000 }).catch(() => {}));

try {
  const one = await openPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  one.on('pageerror', (error) => errors.push(error.message));
  await one.goto(`file://${homeFile}?look=shared`);
  await drawn(one);

  // What shows: the node that a rule leaves out is gone with its arrow; the words of a node and of an arrow come from their fields; the arrow words take their colour.
  const shown = await one.evaluate(() => ({
    nodes: [...document.querySelectorAll('#view :is(g.node, g.image-shape)')].map((g) => nodeKey(g)),
    arrows: [...document.querySelectorAll('#view .edgePaths > path:not(.hit)')].map((path) => path.id.replace(/_\d+$/, '')),
    jobs: document.querySelector('#view g.node[id*="flowchart-jobs-"]').textContent.trim(),
    words: [...document.querySelectorAll('#view .edgeLabel.lk-words')].map((label) => label.textContent.trim()),
    small: document.querySelector('#view g.node[id*="flowchart-jobs-"]').classList.contains('lkSmall'),
    icon: getComputedStyle(document.querySelector('#view g.node[id*="flowchart-desk-"]')).getPropertyValue('--lk-icon').startsWith('url('),
  }));
  await takePicture(one, '570-custom-home-shared-look.png');
  check('a node that a rule does not show leaves the drawing with its arrow, the rest is drawn; the words of a node and of an arrow are made from their fields, with their size, colour and icon',
    !shown.nodes.includes('checks') && shown.nodes.includes('lending') && !shown.arrows.some((id) => id.includes('checks')) && shown.arrows.includes('L_jobs_lending')
      && shown.jobs === 'Night jobs · 3 files' && shown.words.join() === 'wakes each night · from jobs' && shown.small && shown.icon, JSON.stringify(shown));

  // A window: its sections in the order of the rule, at its width, without the marks of the services, which stand in no corner of this node now.
  await pointAt(one, node('jobs'));
  await one.waitForSelector('.win .lk-does', { timeout: 3000 });
  const win = await one.evaluate(() => ({
    width: document.querySelector('.win').style.width, groups: [...document.querySelectorAll('.win .rows .gp')].map((gp) => gp.textContent),
    does: [...document.querySelectorAll('.win .lk-does p')].map((line) => line.textContent), corner: !!document.querySelector('#view g.node[id*="flowchart-jobs-"] .mk-stack.right'),
  }));
  await takePicture(one, '571-custom-window-sections.png');
  await away(one);
  await one.goto(`file://${homeFile}?look=shared&diagram=${encodeURIComponent('process:answer-request')}`);
  await drawn(one);
  await pointAt(one, '#view g.node[id*="flowchart-s0-"]');
  await one.waitForSelector('.win .mk-note .mk-lines', { state: 'attached', timeout: 3000 }).catch(() => {});
  const stepOrder = await one.evaluate(() => [...(document.querySelector('.win .mk-note')?.children ?? [])].map((el) => el.className.split(' ')[0]).filter((name) => name !== 'mk-stack'));
  check('a window shows its sections in the order of the rule, at its width, without the section that the rule leaves out; the pointer says what a click and each other input do',
    win.width === '440px' && win.groups.join() === 'Changes,Folders and files' && !win.corner && stepOrder.join() === 'mk-lines,stepnote'
      && win.does.join(' | ') === 'Click: Opens the graphs of src/library/night_jobs.py. | Alt+click: Opens src/library/night_jobs.py at line 516. | Double click: Shows src/library/jobs/ in the tree "Files". | Key G: Opens the change of the branch book-holds at its part hold-service. | Right click: 2 entries',
    JSON.stringify({ win, stepOrder }));

  // A click target takes the place of the click of today: the node opens the graphs of its file, which a click on a node never opens by itself
  // (as a file in a browser that page opens; in VS Code its tab). The click of the words of an arrow opens its place on Home.
  await one.goto(`file://${homeFile}?look=shared`);
  await drawn(one);
  await one.click(node('jobs'));
  const graphs = await one.waitForURL(/path=src%2Flibrary%2Fnight_jobs\.py/, { timeout: 5000 }).then(() => drawn(one)).then(() => one.evaluate(() => `${Home.data.kind}:${Home.data.path}`), () => one.url());
  await one.goto(`file://${homeFile}?look=shared`);
  await drawn(one);
  await pointAt(one, '#view .edgeLabel.lk-words');
  const arrowSays = await one.waitForSelector('.win .stepnote', { timeout: 3000 }).then((el) => el.textContent(), () => '');
  await one.click('#view .edgeLabel.lk-words');
  await drawn(one, 2);
  const crumb = await one.evaluate(() => document.getElementById('crumb').textContent);
  check('a click target takes the place of the click of today: the node opens the graphs of its file; the words of an arrow say what their click does, and open its place on Home',
    graphs === 'graphs:src/library/night_jobs.py' && arrowSays === 'Click: Opens process:answer-request on Home.' && /›Answer a book request$/.test(crumb), JSON.stringify({ graphs, arrowSays, crumb }));
  let from;

  // Alt+click, a key and a double click go to their targets; the double click is not also a single click; a thing with no double click does not wait.
  await one.goto(`file://${homeFile}?look=shared`);
  await drawn(one);
  from = await sentNow(one);
  await one.click(node('jobs'), { modifiers: ['Alt'] });
  await pointAt(one, node('jobs'));
  await one.keyboard.press('g');
  const box = await one.locator(node('jobs')).boundingBox();
  await one.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await one.waitForFunction((at) => window.apostilSent.slice(at).filter((sent) => sent.type === 'target').length >= 3, from, { timeout: 3000 }).catch(() => {});
  await one.evaluate(() => new Promise((done) => setTimeout(done, 400))); // a single click that the double click wrongly left would come by now
  const inputs = await targets(one, from);
  const noWait = await one.evaluate(() => {
    const before = window.apostilSent.length;
    document.querySelector('#view g.node[id*="flowchart-lending-"]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    return window.apostilSent.length - before; // sent in the same moment as the click
  });
  check('Alt+click, a key while the pointer is on the node and a double click each go to their target, and the double click does no single click; a node with no double click does its click at once',
    JSON.stringify(inputs) === JSON.stringify([{ file: 'src/library/night_jobs.py', line: 516 }, { change: 'book-holds', part: 'hold-service' }, { folder: 'src/library/jobs/' }]) && noWait > 0,
    JSON.stringify({ inputs, noWait }));

  // A right click lists the entries of the look in a small window, and an entry goes to its target.
  await one.goto(`file://${homeFile}?look=shared`);
  await drawn(one);
  const at = await pointAt(one, node('jobs'));
  await one.mouse.click(at.x + at.width / 2, at.y + at.height / 2, { button: 'right' });
  const rows = await one.waitForSelector('.win .lk-menu', { timeout: 3000 }).then(() => one.$$eval('.win .lk-menu a', (all) => all.map((row) => row.textContent)), () => []);
  await takePicture(one, '572-custom-right-click-menu.png');
  from = await sentNow(one);
  await one.click('.win .lk-menu a[data-entry="1"]');
  const entry = await targets(one, from);
  check('a right click lists the entries of the look in a small window, and a click on an entry goes to its target',
    rows.join() === 'Show the folder in Files,Open the night run' && JSON.stringify(entry) === '[{"file":"src/library/night_jobs.py","line":516}]', JSON.stringify({ rows, entry }));

  // A note card shows its fields in the order of the rule: its title with its tests, then its text; no function line and no service line.
  await one.goto(`file://${pageFile}?file=src/library/lending/requests.py&look=shared`);
  await one.waitForSelector('.mc .nt', { timeout: 15000 });
  const card = await one.evaluate(() => {
    const el = [...document.querySelectorAll('.mc')].find((mc) => mc.querySelector('.nt')?.textContent === 'Answer the request');
    return { parts: [...el.children].filter((part) => !part.classList.contains('mk-stack')).map((part) => part.className), shownBefore: !!el };
  });
  // For the picture: the comments window folded, and the card in view.
  await one.click('#side [data-fold]', { timeout: 3000 }).catch(() => {});
  await one.evaluate(() => App.showCode('src/library/lending/requests.py', [43, 43]));
  await one.waitForFunction(() => { const top = [...document.querySelectorAll('.mc')].find((mc) => mc.querySelector('.nt')?.textContent === 'Answer the request')?.getBoundingClientRect().top; return top > 0 && top < innerHeight - 100; }, null, { timeout: 5000 }).catch(() => {});
  await takePicture(one, '573-custom-note-card-fields.png');
  check('a note card shows its fields in the order of the rule: the title, then the text; the function line and the service line that the rule leaves out are not shown',
    card.parts.join() === 't,d', JSON.stringify(card));

  // ----- build 59: the rest of Home, the drawn processes and the graphs page, on the made-up look "?look=home" (look-home.json) -----
  const blue = await one.evaluate(() => Marks.lineColors('#2b6cb0')); // the line colour of the rules, in the light theme of the page
  const crumbWords = () => one.evaluate(() => { const el = document.querySelector('#crumb b .lk-words'); return el ? `${el.textContent}:${getComputedStyle(el).color}` : ''; });
  const rgb = (hex) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;
  await one.goto(`file://${homeFile}?look=home`);
  await drawn(one);
  const top = await one.evaluate(() => ({
    summary: document.getElementById('summary').textContent, frame: getComputedStyle(document.getElementById('view')).borderTopColor,
    heads: [...document.querySelectorAll('#view .edgePaths > path:not(.hit)')].map((path) => path.getAttribute('marker-end')), crumb: document.getElementById('crumb').innerHTML,
  }));
  await one.evaluate(() => Marks.act({ comment: true }, document.querySelector('#view g.node[id*="flowchart-desk-"]')));
  const startWords = await one.evaluate(() => document.querySelector('.cbox [data-field="new"]')?.innerText.trim());
  await takePicture(one, '590-custom-home-header-frame-arrows.png');
  check('Home in a look: the header line has the words of the rule with the fields of the repo, the frame its line colour, the arrows of the map no head, and the comment box starts with the words of the rule',
    top.summary === 'library-app · 8 areas · written at this commit' && top.frame === rgb(blue.light) && top.heads.length === 7 && top.heads.every((head) => head === null)
      && top.crumb === '<b>Home</b>' && startWords === 'Question:', JSON.stringify({ top, startWords }));

  // An area box folded to one node with its colour, the arrows of its nodes at it; the key of the frame, with the pointer on an empty place, opens its target.
  await one.goto(`file://${homeFile}?look=home&diagram=lib-lending`);
  await drawn(one);
  const folded = await one.evaluate(() => ({
    nodes: [...document.querySelectorAll('#view g.node')].map((g) => `${nodeKey(g)}${g.classList.contains('lk-fill') ? '*' : ''}`).sort(),
    arrows: [...document.querySelectorAll('#view .edgePaths > path:not(.hit)')].map((path) => path.id.replace(/_\d+$/, '')).sort(), boxes: document.querySelectorAll('#view g.cluster').length,
  }));
  await takePicture(one, '591-custom-area-box-folded.png');
  const frame = await one.locator('#view').boundingBox();
  await one.mouse.move(frame.x + 30, frame.y + 30, { steps: 2 });
  await one.keyboard.press('g');
  const keyed = await one.waitForURL(/path=src%2Flibrary%2Flending%2F/, { timeout: 5000 }).then(() => drawn(one)).then(() => one.evaluate(() => `${Home.data.kind}:${Home.data.path}`), () => one.url());
  check('an area box folded by a rule is one node with its title and its colour, and the arrows of its nodes go to it; the key of the frame opens its target',
    folded.nodes.join() === 'api,holding*,perms,queue,requests,shelf' && folded.boxes === 0 && folded.arrows.join() === 'L_holding_queue,L_queue_api,L_requests_queue,L_shelf_holding,L_shelf_perms'
      && keyed === 'graphs:src/library/lending/', JSON.stringify({ folded, keyed }));

  // A drawn process: the file boxes in the folder of the rule show the name of their file, the calls out of the repo are hidden, the step of the trail is blue;
  // an opened step runs from left to right, with its branch arrows hidden and its steps still in their order.
  await one.goto(`file://${homeFile}?look=home&diagram=${encodeURIComponent('process:answer-request')}`);
  await drawn(one);
  const drawnProcess = await one.evaluate(() => ({
    boxes: [...document.querySelectorAll('#view g.cluster')].map((g) => g.textContent.trim()).sort(), calls: document.querySelectorAll('#view g.node.elsewhere').length,
  }));
  const processCrumb = await crumbWords();
  await takePicture(one, '592-custom-process-file-boxes.png');
  await one.goto(`file://${homeFile}?look=home&diagram=${encodeURIComponent('process:answer-request/2')}`);
  await drawn(one);
  const step = await one.evaluate(() => {
    const at = (key) => document.querySelector(`#view g.node[id*="flowchart-${key}-"]`).getBoundingClientRect();
    return { dotted: document.querySelectorAll('#view path[class*="dotted"]:not(.hit)').length, order: !!document.querySelector('#view path[id^="L_s8_s9_"]'), across: at('s3').right < at('s11').left, calls: document.querySelectorAll('#view g.node[id*="flowchart-o0-"]').length };
  });
  check('a drawn process in a look: the file boxes of the folder of the rule show the name of their file, the calls out of the repo are hidden, the step of the trail takes its colour; an opened step runs from left to right with no branch arrow, its steps in their order',
    drawnProcess.boxes.join('|') === 'notices.py|requests.py|src/library/web/requests_router.py' && drawnProcess.calls === 0 && processCrumb === `Answer a book request:${rgb(blue.light)}`
      && step.dotted === 0 && step.order && step.across && step.calls === 0, JSON.stringify({ drawnProcess, processCrumb, step }));

  // The graphs page: the panels of the change left out, the tables first, then by level; only the lit nodes; the titles from the words of the rule;
  // a rule that picks the diagram of the tables takes its corner away there, and the map keeps its corner.
  const panelsDrawn = () => one.waitForFunction(() => document.querySelectorAll('.pnl').length && document.querySelectorAll('.pnl .pd[data-lit]').length === document.querySelectorAll('.pnl').length, null, { timeout: 15000 });
  await one.goto(`file://${homeFile}?look=home&path=${encodeURIComponent('db/migrations/0042_holds.sql')}`);
  await drawn(one);
  await panelsDrawn();
  const graphsPage = await one.evaluate(() => ({
    summary: document.getElementById('summary').textContent, titles: [...document.querySelectorAll('.pnl .pl .t')].map((el) => el.textContent),
    levels: [...document.querySelectorAll('.pnl')].map((el) => Home.data.panels[Number(el.dataset.panel)].level),
    map: (() => { const el = [...document.querySelectorAll('.pnl')].find((one) => one.querySelector('.t').textContent.startsWith('The library app')); return { nodes: el.querySelectorAll('.pd g.node').length, corners: el.querySelectorAll('.pd .mk-stack').length }; })(),
    tables: document.querySelector('.pnl').querySelectorAll('.pd .mk-stack').length,
  }));
  await takePicture(one, '593-custom-graphs-page.png', true);
  check('the graphs page in a look: the panels of the change are left out, the tables come first, then by level; a panel of the map shows only its lit node; the titles have the words of the rule; a rule of the diagram of the tables takes its corner away there only',
    graphsPage.summary === '5 diagrams' && graphsPage.levels.join() === 'map,function,function,function,map' && !graphsPage.levels.includes('change') && graphsPage.titles[0] === 'The tables of holds (map)'
      && graphsPage.titles.at(-1) === 'The library app and its parts (map)' && graphsPage.map.nodes === 1 && graphsPage.map.corners === 1 && graphsPage.tables === 0, JSON.stringify(graphsPage));

  // With no look, Home, a process and the graphs page are drawn as before: Mermaid gets the written texts, and the lines of the page carry nothing of a look.
  const asBefore = async (query) => {
    await one.goto(`file://${homeFile}${query}`);
    await drawn(one);
    return one.evaluate(async () => {
      const texts = [];
      const render = mermaid.render;
      mermaid.render = (id, text) => { texts.push(text); return render.call(mermaid, id, text); };
      await Home.render();
      if (Home.data.kind === 'graphs') await new Promise((done) => { const wait = () => (document.querySelectorAll('.pnl .pd[data-lit]').length === Home.data.panels.length ? done() : setTimeout(wait, 50)); wait(); });
      const written = Home.data.kind === 'graphs' ? Home.data.panels.filter((panel) => !panel.schema).map((panel) => panel.mermaid) : [Home.data.map.diagrams.find((one) => one.id === Home.at).mermaid];
      return {
        same: JSON.stringify(texts.sort()) === JSON.stringify(written.sort()), summary: document.getElementById('summary').innerHTML,
        look: document.querySelectorAll('#crumb .lk-words, #summary span, .pnl .pl span span, #view.lk-line, #view.lk-fill, .pgp').length,
        heads: [...document.querySelectorAll('#view .edgePaths > path:not(.hit)')].every((path) => path.hasAttribute('marker-end')),
      };
    });
  };
  const before = { top: await asBefore(''), lending: await asBefore('?diagram=lib-lending'), step: await asBefore(`?diagram=${encodeURIComponent('process:answer-request/2')}`), graphs: await asBefore(`?path=${encodeURIComponent('db/migrations/0042_holds.sql')}`) };
  check('with no look, Home, an area with its box, an opened step and the graphs page are drawn as before: Mermaid gets the written texts, the header and the count line are as they were, and no part carries a look',
    Object.values(before).every((one) => one.same && one.look === 0 && one.heads) && before.top.summary === '' && before.graphs.summary === '6 diagrams, the widest first', JSON.stringify(before));
  await one.close();
} catch (error) {
  check('the checks ran to the end', false, error.message.split('\n').slice(0, 14).join(' / '));
}
await finish();
