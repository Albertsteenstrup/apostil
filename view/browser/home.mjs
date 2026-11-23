// The browser check of Home, the graphs of a path, the processes, the line at the top and comments on the map. A group of view/browser-check.mjs,
// which runs every group at the same time; alone:
//   node view/browser/home.mjs [--pictures] [<folder for pictures>]

import { fileURLToPath } from 'node:url';
import { check, errors, finish, listFile, newPage, pageFile, takePicture } from './tools.mjs';

try {
  // Home and the graphs of a path, as files, with the made-up map of view/example-map.json.
  const homeFile = fileURLToPath(new URL('../media/home.html', import.meta.url));
  const home = await newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  home.on('pageerror', (error) => errors.push(error.message));
  home.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const homeDrawn = () => home.waitForFunction(() => (window.apostilRendered ?? 0) >= 1, null, { timeout: 15000 }); // the first drawing of a page just loaded
  const homeAt = async (query) => { await home.goto(`file://${homeFile}${query}`); await homeDrawn(); };
  const homeSettled = () => home.evaluate(() => Home.drawing); // the drawing that a click or a key asked for
  const panelsDrawn = () => home.waitForFunction(() => document.querySelectorAll('.pnl .pd[data-lit]').length === Home.data.panels.length, null, { timeout: 15000 });
  const crumbOf = () => home.textContent('#crumb');
  const nodeOf = (key) => `#view g.node[id*="flowchart-${key}-"]`;
  /** The way into a node where cards show: a click on its card, or on the one row of its card of files (a folder, or a file at its line). */
  const into = async (key) => {
    const card = `#cards .ovc[data-node="${key}"]`;
    const rows = await home.locator(`${card} .ovf a`).count();
    await (rows === 1 ? home.click(`${card} .ovf a`) : home.click(card));
  };
  const sentCount = () => home.evaluate(() => window.apostilSent.length);
  /** The messages sent since `count` that lead somewhere: a step of the path, the tree "Files", a file. */
  const ledSince = (count) => home.evaluate((from) => window.apostilSent.slice(from).map((one) => one.type).filter((type) => /^(walk|showInTree|openFile)$/.test(type)), count);
  /** The diagram alone (full screen) or the overview with its cards, for the next page that opens. */
  const alone = (on) => home.evaluate((on) => (on ? localStorage.setItem('apostil.diagramFull', '1') : localStorage.removeItem('apostil.diagramFull')), on);
  /** The pointer leaves for a corner, and the hover window closes. */
  const away = async () => { await home.mouse.move(2, 2); await home.waitForSelector('.win', { state: 'detached', timeout: 3000 }); };
  /** The hover window of a node: its title, its sub title, its rows and the note of a step. */
  const windowOf = async (key) => {
    await away();
    await home.hover(nodeOf(key));
    return home.waitForSelector('.win', { timeout: 3000 }).then(() => home.evaluate(() => ({
      title: document.querySelector('.win .tb b').textContent, sub: document.querySelector('.win .tb .sub').textContent,
      rows: [...document.querySelectorAll('.win .rows a')].map((row) => row.textContent), first: document.querySelector('.win .rows a .c')?.textContent,
      text: document.querySelector('.win .stepnote')?.textContent ?? '',
    })), () => ({}));
  };

  // The top map, the window of an area, and the counts of a large repo with a comma.
  await homeAt('');
  const top = await home.evaluate(() => ({
    nodes: document.querySelectorAll('#view g.node.go').length, dots: document.querySelectorAll('#view g.node circle').length,
    surface: document.getElementById('view').classList.contains('surface'),
    names: [...document.querySelectorAll('#view g.node.go')].map((g) => g.textContent.trim()).filter(Boolean).length, crumb: document.getElementById('crumb').textContent,
    // The tag of each area: under the lower-left corner of its node, inside the drawing.
    tags: Object.fromEntries([...document.querySelectorAll('#view .ptag')].map((tag) => [tag.dataset.node, tag.textContent])),
    under: [...document.querySelectorAll('#view .ptag')].filter((tag) => {
      const [node, own, svg] = [document.querySelector(`#view g.node[id*="flowchart-${tag.dataset.node}-"] > :first-child`), tag, document.querySelector('#view svg')].map((el) => el.getBoundingClientRect());
      return own.top >= node.bottom - 1 && own.top < node.bottom + 20 && own.left > node.left && own.left < node.left + 30 && own.bottom <= svg.bottom && own.left >= svg.left;
    }).length,
  }));
  await takePicture(home, '30-home-with-a-map.png');
  // The window of a node, alone: where its card shows it has none.
  await alone(true);
  await homeAt('');
  const nodeWin = await windowOf('lending');
  const grows = await home.$eval(`${nodeOf('lending')} > :first-child`, (el) => getComputedStyle(el).scale);
  const iconsStay = await home.$eval(`${nodeOf('lending')} > .mk-holder`, (el) => getComputedStyle(el).scale).catch(() => 'no icons'); // grown, they would shake under a resting pointer
  // The same node, with the counts of a large repo.
  await away();
  const bigDraw = (files, paths) => home.evaluate(async ([files, paths]) => {
    const node = diagramOf(Home.at || Home.data.map.top).nodes.lending;
    const before = [node.files, node.paths[0].files];
    [node.files, node.paths[0].files] = [files, paths];
    await Home.render();
    return before;
  }, [files, paths]);
  const smallCounts = await bigDraw(2339, 5132);
  const bigWin = await windowOf('lending');
  await away();
  await bigDraw(...smallCounts);
  await alone(false);
  await homeAt('');
  // A click on a name of a tag: a folder shows in the tree "Files"; "+1 file" shows its file there and opens it beside Home. Home stays where it is.
  const tagClicks = async (index) => {
    const from = await home.evaluate(() => window.apostilSent.length);
    await home.locator('#view .ptag[data-node="writing"] .pl').nth(index).click();
    return home.evaluate((from) => window.apostilSent.slice(from).filter((one) => /^(walk|showInTree|openFile)$/.test(one.type)).map((one) => `${one.type}:${one.paths ?? one.path}${one.beside ? ' beside' : ''}`).join(' | '), from);
  };
  const tagFrom = await home.evaluate(() => Home.at);
  const tagLed = [await tagClicks(0), await tagClicks(1)];
  const tagStayed = await home.evaluate(() => Home.at);
  check('a click on a name under a node shows that folder in the tree "Files"; on "+1 file" it shows the file there and opens it beside Home; Home stays where it is',
    tagLed[0] === 'showInTree:docs/' && tagLed[1] === 'showInTree:README.md | openFile:README.md beside' && tagStayed === tagFrom, JSON.stringify({ tagLed, tagFrom, tagStayed }));
  check('Home draws the top map as one surface: 8 named areas, no dot on any node, the line "Home" alone; an area grows a little under the pointer (the icons at its corner stay where they are) and alone opens a window with its folders and files, the count of files and the counts of the change that touches it; a large repo has commas in its counts',
    top.nodes === 8 && top.names === 8 && top.dots === 0 && top.surface && top.crumb === 'Home' && grows === '1.03' && iconsStay === 'none'
      && nodeWin.title === 'Lending' && nodeWin.sub === '9 files · 1 change' && nodeWin.rows?.[0] === 'src/library/lending/+593 −83 · 9 files' && /^book-holds/.test(nodeWin.rows?.[1] ?? '')
      && bigWin.sub === '2,339 files · 1 change' && bigWin.first === '+593 −83 · 5,132 files', JSON.stringify({ top, grows, iconsStay, nodeWin, bigWin }));

  check('under each area of the map stands a quiet tag of its folders and files, at its lower-left corner and inside the drawing: a folder by its last name, with the name above it when two folders would read the same; a few files after the folders as "+2 files"; at most two, then "+N"',
    Object.keys(top.tags).length === 8 && top.under === 8 && top.tags.web === 'web/' && top.tags.routes === 'library/web/' && top.tags.jobs === 'jobs/ +2 files' && top.tags.data === 'db/ · scripts/',
    JSON.stringify({ tags: top.tags, under: top.under }));

  // The key of a drawn process: a quiet row for each kind of box it shows, top left in its frame; a written diagram has none.
  const keyOf = async (query) => { await homeAt(query); return home.evaluate(() => [...document.querySelectorAll('#view > .pd-key > span')].map((row) => row.textContent)); };
  const keys = { step: await keyOf('?diagram=process:answer-request/2'), process: await keyOf('?diagram=process:answer-request'), map: await keyOf('?diagram=lib-lending') };
  await homeAt('');
  check('a drawn process has a quiet key in the top left corner of its frame, with a row only for what it shows: a step here, a step it calls elsewhere, outside the repo, the order of the calls; a written diagram has none',
    keys.step.join('|') === 'a step here|a step it calls elsewhere|outside the repo' && keys.process.join('|') === 'a step here|outside the repo|1 2 3the order of the calls' && keys.map.length === 0, JSON.stringify(keys));

  // A click on a node goes down and "Home" goes up; a node with no diagram under it asks for its folder in the tree "Files" and never opens the graphs
  // of the folder; the window of a node of an area lists its files, and a click on a file asks VS Code to open it.
  await into('lending');
  await homeSettled();
  const downCrumb = await crumbOf();
  const downNodes = await home.$$eval('#view g.node.go', (all) => all.length);
  await home.click('#crumb a[data-trail="0"]');
  await homeSettled();
  const upCrumb = await crumbOf();
  let sentBefore = await sentCount();
  await into('desk');
  const toTree = await home.evaluate(() => window.apostilSent.at(-1));
  const deskLed = await ledSince(sentBefore);
  const stillHome = await home.evaluate(() => Home.data.kind === 'home' && !/path=/.test(location.search) && document.getElementById('crumb').textContent === 'Home');
  await alone(true);
  await homeAt('?diagram=lib-lending');
  await home.hover(nodeOf('queue'));
  const areaWin = await home.waitForSelector('.win', { timeout: 3000 }).then(() => home.evaluate(() => ({
    title: document.querySelector('.win .tb b').textContent, group: document.querySelector('.win .rows .gp').textContent,
    files: [...document.querySelectorAll('.win .rows a[data-open]')].map((row) => row.dataset.open), folders: document.querySelectorAll('.win .rows a[data-tree]').length,
  })), () => ({}));
  await home.click('.win .rows a[data-open="src/library/lending/queue.py"]');
  const openFile = await home.evaluate(() => window.apostilSent.at(-1));
  const stayed = await home.evaluate(() => Home.data.kind === 'home' && Home.at);
  await alone(false);
  check('the card of a node goes one level down ("Home › that diagram") and "Home" goes back up; a node with no diagram under it stays on the map and its card asks for its folder in the tree "Files", never the graphs of the folder; alone, the window of a node of an area lists its files, and a click on one asks VS Code to open it',
    downCrumb === 'Home›Lending: holds, requests and mails' && downNodes === 7 && upCrumb === 'Home'
      && stillHome && deskLed.join() === 'showInTree' && toTree?.type === 'showInTree' && toTree.paths.join() === 'src/library/desk/' && toTree.open === true
      && areaWin.title === 'Queue and notices' && areaWin.group === 'Folders and files' && areaWin.files?.join() === 'src/library/lending/notices.py,src/library/lending/queue.py' && areaWin.folders === 0
      && openFile?.type === 'openFile' && openFile.path === 'src/library/lending/queue.py' && stayed === 'lib-lending', JSON.stringify({ downCrumb, downNodes, upCrumb, stillHome, deskLed, toTree, areaWin, openFile, stayed }));

  // The processes of the map: an area whose paths hold the first step of processes goes down to them, in three levels.
  const tasksPath = 'src/library/lending/requests.py';
  const drawing = () => home.evaluate(() => ({
    crumb: document.getElementById('crumb').textContent,
    names: [...document.querySelectorAll('#view g.node')].map((g) => g.textContent.trim()).sort(),
    quiet: [...document.querySelectorAll('#view g.node.elsewhere')].map((g) => g.textContent.trim()).sort(),
    boxes: [...document.querySelectorAll('#view g.cluster')].map((g) => g.textContent.trim()).filter((text) => text.endsWith('.py')).length,
    arrows: [...new Set([...document.querySelectorAll('#view g.edgeLabel')].map((el) => el.textContent.trim()).filter(Boolean))].sort(),
    dotted: document.querySelectorAll('#view path[class*="dotted"]:not(.hit)').length,
  }));
  await homeAt('');
  sentBefore = await sentCount();
  await into('routes');
  await homeSettled();
  const placeDrawn = await drawing();
  const placeSent = await ledSince(sentBefore);
  const processWin = await windowOf('q0');
  await away();
  sentBefore = await sentCount();
  await into('q0');
  await homeSettled();
  const oneProcess = await drawing();
  const processSent = (await ledSince(sentBefore)).filter((type) => type !== 'walk');
  await takePicture(home, '37-one-process.png');
  check('a click on an area that holds the first step of several processes opens them: one node for each with "N steps", joined by its handoff, a process of another place quiet, and the tree follows; the pointer on a process shows its summary; a click on it opens its top steps in one box for each of its 3 files, with the arrows of the writer and its call out of the repo quiet',
    placeDrawn.crumb === 'Home›Processes of Web routes' && placeDrawn.names.join('|') === 'Answer a book request14 steps|Ask the library for a book7 steps|List the requests of a member4 steps'
      && placeDrawn.quiet.join() === 'Ask the library for a book7 steps' && placeDrawn.arrows.join() === 'the request row' && placeSent.filter((type) => type !== 'walk').join() === 'showInTree'
      && processWin.title === 'Answer a book request' && processWin.sub === '14 steps' && processWin.text === 'Stores the answer of a librarian and tells each member who asked for the book.'
      && oneProcess.crumb === 'Home›Processes of Web routes›Answer a book request' && oneProcess.boxes === 3 && oneProcess.names.length === 6 && oneProcess.names.includes('Answer the request9 steps')
      && oneProcess.quiet.join() === 'json' && oneProcess.arrows.join() === '1 make the service,1 write the details,2 pass the answer,2 send the mail,3 shape the request' && processSent.join() === '',
    JSON.stringify({ placeDrawn, placeSent, processWin, oneProcess, processSent }));
  await into('s2');
  await homeSettled();
  const stepOpened = await drawing();
  const stepWin = await windowOf('s7');
  await away();
  // Focusing a step node that maps to a note emits focusNote for an open side code tab and offers "Open code beside" in the focus line.
  await home.click(nodeOf('s7'));
  const focusNoteSent = await home.evaluate(() => window.apostilSent.filter((m) => m.type === 'focusNote').at(-1));
  const besideLink = await home.locator('.bar > .fc [data-open-beside]').textContent();
  await home.click('.bar > .fc [data-open-beside]');
  const besideSent = await home.evaluate(() => window.apostilSent.filter((m) => m.type === 'openFile').at(-1));
  check('focusing a process step node sends focusNote with its file and note lines, and "Open code beside" in the focus bar opens that file beside without stealing focus',
    focusNoteSent?.path === tasksPath && focusNoteSent?.lines?.join(',') === '62,67'
      && besideLink === 'Open code beside'
      && besideSent?.path === tasksPath && besideSent?.beside === true && besideSent?.preserveFocus === true && besideSent?.lines?.join(',') === '62,67',
    JSON.stringify({ focusNoteSent, besideLink, besideSent }));
  await into('s7');
  const leafSent = await home.evaluate(() => window.apostilSent.at(-1));
  const leafAt = await home.evaluate(() => Home.at);
  await home.click('#crumb a[data-trail="2"]');
  await homeSettled();
  const backProcess = await crumbOf();
  await home.click('#crumb a[data-trail="1"]');
  await homeSettled();
  const backPlace = await crumbOf();
  await home.click('#crumb a[data-trail="0"]');
  await homeSettled();
  const backHome = await crumbOf();
  // A node of an area that holds the first step of one process opens that process at once.
  await homeAt('?diagram=lib-lending');
  await into('requests');
  await homeSettled();
  const single = await drawing();
  check('a click on a step that holds steps opens its 9 inner steps, two branches dotted with their labels and the steps of other places quiet; the pointer on a step shows its note with its file and lines; a step with no inner steps opens its file at its line; the line leads back up each level; a node that holds the first step of one process opens it at once',
    stepOpened.crumb === 'Home›Processes of Web routes›Answer a book request›requests.py: Answer the request' && stepOpened.names.length === 12
      && stepOpened.quiet.join('|') === 'json|notices.py: Send the answer to a member|requests.py: Shape one request row' && stepOpened.dotted === 2 && stepOpened.arrows.includes('when the key repeats') && stepOpened.arrows.includes('if it is declined')
      && stepWin.title === 'Write the answer into the rows' && stepWin.sub === 'requests.py · lines 62-67' && stepWin.text === 'Writes the answer, the librarian and the key into each open request for the book.'
      && leafSent?.type === 'openFile' && leafSent.path === tasksPath && leafSent.line === 62 && leafAt === 'process:answer-request/2'
      && backProcess === 'Home›Processes of Web routes›Answer a book request' && backPlace === 'Home›Processes of Web routes' && backHome === 'Home'
      && single.crumb === 'Home›Lending: holds, requests and mails›Ask the library for a book' && single.names.join('|') === 'Ask for a book6 steps|PostgreSQL|json',
    JSON.stringify({ stepOpened, stepWin, leafSent, leafAt, back: [backProcess, backPlace, backHome], single }));

  // The graphs of a file show the processes that have steps in it, with those steps lit; a click on a panel opens that process on Home.
  await homeAt(`?path=${encodeURIComponent(tasksPath)}`);
  await panelsDrawn();
  const processPanels = await home.$$eval('.pnl', (all) => all.map((el) => ({ line: el.querySelector('.pl .t').textContent, from: el.querySelector('.pl .fr').textContent, where: el.querySelector('.pl .in').textContent, lit: Number(el.querySelector('.pd').dataset.lit) })));
  await home.click('.pnl[data-panel="2"] .pl');
  await home.waitForURL(/diagram=process/, { timeout: 5000 }).catch(() => {});
  await homeDrawn();
  const fromPanel = await home.evaluate(() => ({ crumb: document.getElementById('crumb').textContent, lit: [...document.querySelectorAll('#view g.node.lit')].map((g) => nodeKey(g)).sort() }));
  check('the graphs of requests.py show its 3 processes after the map, each with its steps of that file lit and a line that says where they are; a click on the panel of a process opens it on Home with the same steps lit, one step after the graphs',
    processPanels.length === 5 && processPanels.slice(2).every((panel) => panel.from === 'process' && panel.lit > 0) && processPanels.slice(2).map((panel) => panel.line).join('|') === 'Answer a book request|List the requests of a member|Ask the library for a book'
      && processPanels[2].where === 'in 2 steps' && processPanels[4].where === 'in: Ask for a book' && fromPanel.crumb === `Home›${tasksPath}›Answer a book request` && fromPanel.lit.join() === 's12,s2',
    JSON.stringify({ processPanels, fromPanel }));

  // The graphs of one file: one panel for each diagram, the widest first, each with a lit part and a line that says where the path is; two panels in a row
  // at 1400 px and at 1060 px, the width of a tab beside the side bar of VS Code; the small panel of a sequence chart is filled by the chart, its lifelines
  // ending under the last message.
  const servicePath = 'src/library/lending/hold_service.py';
  await homeAt(`?path=${encodeURIComponent(servicePath)}`);
  await panelsDrawn();
  const graphs = await home.evaluate(() => {
    const panels = [...document.querySelectorAll('.pnl')];
    const rows = () => new Set(panels.map((el) => Math.round(el.getBoundingClientRect().top))).size;
    return {
      lines: panels.map((el) => `${el.querySelector('.pl .t').textContent} ${el.querySelector('.pl .fr').textContent}`), lit: panels.map((el) => Number(el.querySelector('.pd').dataset.lit)),
      words: panels.map((el) => el.querySelector('.in').textContent), rows: rows(), crumb: document.getElementById('crumb').textContent,
      sequence: panels.map((el) => el.querySelector('.pd svg')).filter((svg) => svg.querySelector('line.actor-line')).map((svg) => {
        const [, top, , height] = svg.getAttribute('viewBox').split(' ').map(Number);
        const panel = svg.closest('.pd').getBoundingClientRect();
        const drawn = svg.querySelector('rect.actor').getBoundingClientRect();
        return { lifelinesEnd: Math.round(Math.max(...[...svg.querySelectorAll('line.actor-line')].map((line) => Number(line.getAttribute('y2'))))), frameBottom: Math.round(top + height), frameHeight: Math.round(height), actorHeight: +(drawn.height / panel.height).toFixed(2) };
      }),
    };
  });
  await takePicture(home, '33-graphs-of-a-file.png');
  await home.setViewportSize({ width: 1060, height: 900 });
  const besideSideBar = await home.evaluate(() => { const boxes = [...document.querySelectorAll('.pnl')].map((el) => el.getBoundingClientRect()); return { rows: new Set(boxes.map((box) => Math.round(box.top))).size, width: Math.round(boxes[0].width) }; });
  await home.setViewportSize({ width: 1400, height: 900 });
  await home.click('.pnl[data-panel="1"] .pl');
  await home.waitForURL(/diagram=/, { timeout: 5000 }).catch(() => {});
  await homeDrawn();
  const large = await home.evaluate(() => ({ crumb: document.getElementById('crumb').textContent, lit: [...document.querySelectorAll('#view g.node.lit')].map((g) => nodeKey(g)) }));
  const [sequence] = graphs.sequence;
  check('the graphs of hold_service.py show one panel for each of its 5 diagrams, the map first, each with a lit part and a line under it that says where the path is ("in: Hold service"); two panels stand in a row at 1400 px and at 1060 px, large; the panel of a sequence chart is filled by the chart; opened from outside the line is "Home › the file"; a click on a panel of the map shows that diagram on Home with the same node lit',
    graphs.lines.length === 5 && graphs.lit.every((lit) => lit > 0) && /the map$/.test(graphs.lines[0]) && /the map$/.test(graphs.lines[1]) && /^Adds holds for books that are out change · branch/.test(graphs.lines[2])
      && graphs.words[1] === 'in: Hold service' && graphs.words.every((words) => /^in(: | \d+ )/.test(words) || words === 'in the whole diagram') && graphs.rows === Math.ceil(graphs.lines.length / 2) && besideSideBar.rows === graphs.rows && besideSideBar.width > 400
      && graphs.sequence.length === 1 && sequence.lifelinesEnd <= sequence.frameBottom && sequence.frameHeight < 600 && sequence.actorHeight > 0.05
      && graphs.crumb === `Home›${servicePath}` && large.crumb === `Home›${servicePath}›Lending: holds, requests and mails` && large.lit.join() === 'service',
    JSON.stringify({ graphs, besideSideBar, large }));

  // The path he followed: Home, a level down, a node to the graphs of its file, a panel to the change page, a part, Diffs; then back step by step.
  const pageDrawn = () => home.waitForFunction(() => typeof App === 'object' && (window.apostilRendered ?? 0) >= 1, null, { timeout: 15000 });
  const pageSettled = () => home.evaluate(() => App.drawing); // the drawing that a click asked for
  // The line with its folded steps read from the title of "…"; `shown` is what it shows.
  const lineOf = () => home.evaluate(() => {
    const crumb = document.getElementById('crumb');
    const whole = crumb.cloneNode(true);
    whole.querySelector('[data-unfold]')?.replaceWith(whole.querySelector('[data-unfold]').title.replaceAll(' › ', '›'));
    return { crumb: whole.textContent, shown: crumb.textContent, folded: Number(crumb.dataset.folded) };
  });
  const litNow = () => home.evaluate(() => [...document.querySelectorAll('#view g.node.lit')].map((g) => g.querySelector('[data-part]')?.dataset.part ?? nodeKey(g)).sort().join());
  await homeAt('');
  await into('lending');
  await homeSettled();
  await home.evaluate(() => walkTo(graphsStep('src/library/lending/hold_service.py'))); // as the icon of a file in the tree "Files" does; a click on a node never leads there
  await home.waitForURL(/path=/, { timeout: 5000 }).catch(() => {});
  await homeDrawn();
  await panelsDrawn();
  const walkGraphs = await lineOf();
  const graphsLit = await home.$$eval('.pnl .pd', (all) => all.map((el) => el.dataset.lit).join());
  await home.click('.pnl[data-panel="2"] .pl');
  await home.waitForURL(/page\.html/, { timeout: 5000 }).catch(() => {});
  await pageDrawn();
  const walkChange = await lineOf();
  const changeLit = await litNow();
  const changeTitle = await home.evaluate(() => App.page.title);
  const changeBold = await home.textContent('#crumb b');
  const walked = ['Home', 'Lending: holds, requests and mails', servicePath, changeTitle];
  await home.locator('.ovc', { has: home.locator('.ovn', { hasText: /^Hold service$/ }) }).click(); // the card of the part goes in
  await pageSettled();
  const walkPart = await lineOf();
  await home.click('.switch a[data-view="diffs"]');
  await pageSettled();
  const walkDiffs = await lineOf();
  await home.setViewportSize({ width: 370, height: 900 });
  await home.waitForFunction(() => Number(document.getElementById('crumb').dataset.folded) > 0, null, { timeout: 3000 }).catch(() => {});
  const folded = await lineOf();
  await takePicture(home, '51-folded-line-at-370.png');
  await home.click('#crumb [data-unfold]', { timeout: 3000 }).catch(() => {});
  const unfolded = await lineOf();
  check('from a map node to the graphs of its file to a panel to the change page, the line lists exactly those steps, the last one bold, and not the name of the repo; the diagram of a part adds a step, and "Diffs" adds a step; at 370 px the line folds its middle steps into "…" and keeps Home and the last step, and a click on "…" shows them',
    walkGraphs.crumb === walked.slice(0, 3).join('›') && walkChange.crumb === walked.join('›') && !/library-app/.test(walkChange.crumb) && changeBold === changeTitle && changeLit === 'hold-service'
      && walkPart.crumb === [...walked, 'Hold service'].join('›') && walkDiffs.crumb === [...walked, 'Hold service', 'Diffs'].join('›')
      && folded.folded > 0 && /^Home›…›/.test(folded.shown) && folded.shown.endsWith('›Diffs') && folded.crumb === walkDiffs.crumb && unfolded.shown === walkDiffs.crumb && unfolded.folded === 0,
    JSON.stringify({ walkGraphs: walkGraphs.crumb, walkChange: walkChange.crumb, changeBold, changeLit, walkPart: walkPart.crumb, walkDiffs: walkDiffs.crumb, folded, unfolded }));
  await home.setViewportSize({ width: 1400, height: 900 });
  await home.click('#crumb a[data-trail="3"]');
  await pageSettled();
  const backChange = await lineOf();
  const backLit = await litNow();
  const backView = await home.evaluate(() => App.state.view);
  await home.click('#crumb a[data-trail="2"]');
  await home.waitForURL(/home\.html\?path=/, { timeout: 5000 }).catch(() => {});
  await homeDrawn();
  await panelsDrawn();
  const backGraphs = await lineOf();
  const backGraphsLit = await home.$$eval('.pnl .pd', (all) => all.map((el) => el.dataset.lit).join());
  await home.click('#crumb a[data-trail="1"]');
  await home.waitForURL(/home\.html\?diagram=lib-lending/, { timeout: 5000 }).catch(() => {});
  await homeDrawn();
  const backLower = await lineOf();
  await home.mouse.move(2, 2);
  await home.keyboard.press('Alt+ArrowLeft');
  await homeSettled();
  const backTop = await lineOf();
  const topNodes = await home.$$eval('#view g.node.go', (all) => all.length);
  await home.goto(`file://${pageFile}`);
  await pageDrawn();
  const fromList = await lineOf();
  check('back along the line: the step of the change shows it with the same parts lit, the step of the graphs shows them with the same nodes lit, the step of a map diagram shows it on Home, and Alt+Left goes one step back to the top map; a change opened from outside a page (the list) has the line "Home › the change"',
    backChange.crumb === walked.join('›') && backLit === changeLit && backView === 'diagram' && backGraphs.crumb === walked.slice(0, 3).join('›') && backGraphsLit === graphsLit
      && backLower.crumb === walked.slice(0, 2).join('›') && backTop.crumb === 'Home' && topNodes === 8 && fromList.crumb === `Home›${changeTitle}`,
    JSON.stringify({ backChange: backChange.crumb, backLit, backView, backGraphs: backGraphs.crumb, backGraphsLit, backLower: backLower.crumb, backTop: backTop.crumb, topNodes, fromList: fromList.crumb }));

  // Twenty panels in a narrow tab: only those near the view are drawn at first, the rest when they come into view.
  await home.setViewportSize({ width: 370, height: 900 });
  await homeAt(`?path=${encodeURIComponent(servicePath)}`);
  const twenty = await home.evaluate(async () => {
    const until = (ok) => new Promise((done, fail) => { const end = performance.now() + 10000; const poll = () => (ok() ? done() : performance.now() > end ? fail(new Error('the panels in view were not drawn')) : requestAnimationFrame(poll)); poll(); });
    const nearDrawn = () => [...document.querySelectorAll('.pnl')].filter((el) => el.getBoundingClientRect().top < innerHeight + 150 && el.getBoundingClientRect().bottom > -150).every((el) => el.querySelector('.pd[data-lit]'));
    const panels = Home.data.panels;
    Home.data = { ...Home.data, panels: Array.from({ length: 20 }, (_, index) => panels[index % panels.length]) };
    const started = performance.now();
    await Home.render();
    const ms = performance.now() - started;
    await until(nearDrawn);
    const first = document.querySelectorAll('.pnl .pd svg').length;
    while (scrollY + innerHeight < document.documentElement.scrollHeight - 1) { scrollBy(0, innerHeight); await until(nearDrawn); }
    return { ms: Math.round(ms), first, all: document.querySelectorAll('.pnl .pd svg').length };
  });
  check('with twenty panels the page draws at once, only the panels in view first and the rest as they come into view', twenty.ms < 200 && twenty.first < 20 && twenty.all === 20, JSON.stringify(twenty));

  // A wide made-up map at 1280 by 860: it opens at a size where the words read (at least 11 px), at the start of its flow; a double click fits it whole.
  await home.setViewportSize({ width: 1280, height: 860 });
  await homeAt('');
  const wideMap = await home.evaluate(async () => {
    const names = ['Browser', 'Dev server', 'Router', 'Login', 'Session store', 'Catalogue API', 'Search index', 'Loans API', 'Holds queue', 'Mailer', 'Reports', 'Archive', 'Backup', 'Audit log'];
    const top = Home.data.map.diagrams.find((diagram) => diagram.id === Home.data.map.top);
    top.mermaid = `flowchart LR\n${names.map((name, index) => `  n${index}["${name}"]`).join('\n')}\n${names.slice(1).map((_, index) => `  n${index} --> n${index + 1}`).join('\n')}\n  n2 --> n7\n  n5 --> n11`;
    top.graph = { nodes: {}, edges: [] };
    top.nodes = {};
    await Home.render();
    const measure = () => {
      const stage = document.querySelector('#view.surface');
      const svg = stage.querySelector('svg');
      const scale = svg.getBoundingClientRect().width / Number(svg.getAttribute('viewBox').split(' ')[2]);
      const label = [...stage.querySelectorAll('g.node .nodeLabel')].find((el) => el.textContent === 'Browser');
      const card = stage.getBoundingClientRect();
      const first = label.closest('g.node').getBoundingClientRect();
      return { label: +label.getBoundingClientRect().height.toFixed(1), font: +(parseFloat(getComputedStyle(label).fontSize) * scale).toFixed(1), startInView: first.left >= card.left && first.right <= card.right && first.top >= card.top && first.bottom <= card.bottom };
    };
    const opened = measure();
    const stage = document.querySelector('#view.surface');
    const box = stage.getBoundingClientRect();
    stage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: box.left + 4, clientY: box.bottom - 4 }));
    const whole = measure();
    return { opened, whole };
  });
  check('a wide map opens at a size where its words read, at least 11 px high, with the start of the flow in view; a double click fits it whole',
    wideMap.opened.label >= 11 && wideMap.opened.font >= 11 && wideMap.opened.startInView && wideMap.whole.font < wideMap.opened.font, JSON.stringify(wideMap));
  await home.setViewportSize({ width: 1400, height: 900 });

  // The calm states: a path in no diagram, and a repo with no map (the wordmark, one press for each installed app that maps the repo, the line of the
  // next step; in a 370 px tab it fits).
  await homeAt('?path=nothing.txt');
  const nothing = await home.textContent('#view');
  await homeAt('?nomap=1');
  const noMap = await home.evaluate(() => ({ line: document.querySelector('.nomap p').textContent, actions: [...document.querySelectorAll('[data-write]')].map((a) => a.textContent), quiet: [...document.querySelectorAll('.nomap > p.quiet')].map((p) => p.textContent), svg: !!document.querySelector('#view svg:not(.chev)') }));
  await takePicture(home, '34-home-with-no-map.png');
  await home.click('[data-write="claude-code"]');
  const wrote = await home.evaluate(() => window.apostilSent.find((message) => message.type === 'writeMap'));
  await home.click('.nomap [data-other-app]');
  const other = await home.evaluate(() => window.apostilSent.find((message) => message.type === 'anotherApp'));
  // With one installed app: no "Another app", and the quiet line names that app.
  const oneApp = await home.evaluate(async () => { Home.data = { ...Home.data, apps: ['codex'], mapApp: 'codex' }; await Home.render(); return { quiet: document.querySelector('.nomap > p.quiet').textContent, link: !!document.querySelector('[data-other-app]') }; });
  await homeAt('?nomap=1');
  const NEXT_LINES = 'Your agent apps do not have the Apostil skills yet. Set up for agents';
  const markPage = () => home.evaluate(() => {
    const mark = document.querySelector('.nomap .wordmark').getBoundingClientRect();
    const view = document.documentElement.clientWidth;
    return {
      loaded: document.querySelector('.nomap .wordmark').naturalWidth > 0, width: Math.round(mark.width),
      centred: Math.abs(mark.left + mark.width / 2 - view / 2) < 2, middle: mark.top > 120, ask: document.querySelectorAll('.nomap > p.quiet')[1].textContent,
      next: [...document.querySelectorAll('.nomap .next p')].map((p) => p.textContent).join('|'), wide: document.documentElement.scrollWidth <= view,
    };
  });
  const marked = await markPage();
  await home.setViewportSize({ width: 370, height: 900 });
  const narrowMark = await markPage();
  await home.setViewportSize({ width: 1400, height: 900 });
  await home.evaluate(() => { window.apostilSent.length = 0; });
  await home.click('.nomap [data-setup]');
  const nextSent = await home.evaluate(() => window.apostilSent.map((message) => message.type).filter((type) => type !== 'pointer').join());
  check('a path in no diagram shows one calm line; a repo with no map shows one calm line, one press "Map this repo" (a click asks VS Code to start the app that it names in a quiet line under it; "Another app" asks VS Code to pick one, and is not there with one installed app), the wordmark large and centred, what the press does, and the line of the next step whose link asks VS Code to set up; in a 370 px tab it fits',
    nothing === 'nothing.txt is a part of no diagram yet.' && noMap.line === 'This repo has no map and no notes yet.' && noMap.actions.join() === 'Map this repo' && noMap.quiet[0] === 'Starts a new Claude Code session. Another app' && !noMap.svg && wrote?.app === 'claude-code' && !!other
      && oneApp.quiet === 'Starts a new Codex session. ' && !oneApp.link
      && marked.loaded && marked.width >= 280 && marked.centred && marked.middle && marked.ask === 'A new agent session reads the repo, draws its map and writes notes beside your code. It takes a few minutes and changes no file of the repo.' && marked.next === NEXT_LINES
      && nextSent === 'setUp' && narrowMark.width < 370 && narrowMark.centred && narrowMark.wide,
    JSON.stringify({ nothing, noMap, other, oneApp, marked, narrowMark, nextSent }));

  // A repo with a .apostilignore: one more quiet line under the press, with the counts by path, and "Edit" that opens the file. With none (the example), no line.
  await homeAt('?nomap=1');
  const scoped = await home.evaluate(async () => {
    Home.data = { ...Home.data, scope: { leftOut: 140, added: 12 } };
    await Home.render();
    window.apostilSent.length = 0;
    const quiet = [...document.querySelectorAll('.nomap > p.quiet')];
    quiet.at(-1).querySelector('[data-edit-scope]')?.click();
    return { lines: quiet.length, last: quiet.at(-1).textContent, sent: window.apostilSent.filter((message) => message.type !== 'pointer') };
  });
  check('with a .apostilignore and no map, one quiet line under the press says how many files it leaves out and adds, and "Edit" asks VS Code to open the file; with none, no line',
    noMap.quiet.length === 2 && scoped.lines === 3 && scoped.last === 'Your .apostilignore leaves out 140 files and adds 12. Edit'
      && JSON.stringify(scoped.sent) === JSON.stringify([{ type: 'openFile', path: '.apostilignore' }]),
    JSON.stringify({ quiet: noMap.quiet, scoped }));

  // Right after the press, the control of the map run: the model of the lead at Medium, as everywhere else; its menu has one model list and the efforts. A
  // choice goes with the press, and no writer: the writers are always the smallest model at Medium (teamFrom and teamRun in shared/models.ts).
  await homeAt('?nomap=1');
  const team = { words: await home.textContent('.nomap .runpick .rp').catch(() => '') };
  await home.mouse.move(5, 5);
  await takePicture(home, '82-the-control-of-the-map-at-its-default.png');
  await home.click('.nomap [data-rp-open]', { timeout: 3000 }).catch(() => {});
  team.heads = await home.$$eval('.nomap .rmenu .ph', (heads) => heads.map((head) => head.textContent));
  await home.click('.nomap [data-rp-model="opus"]', { timeout: 3000 }).catch(() => {});
  await home.click('.nomap [data-rp-effort="xhigh"]', { timeout: 3000 }).catch(() => {});
  team.open = await home.$$eval('.nomap .rmenu', (all) => all.length);
  await home.mouse.click(5, 5); // a click outside closes the menu
  team.closed = await home.$$eval('.nomap .rmenu', (all) => all.length) === 0;
  team.chosen = (await home.textContent('.nomap .runpick .rp').catch(() => '')).trim();
  await home.click('[data-write="claude-code"]');
  team.sent = await home.evaluate(() => window.apostilSent.filter((message) => message.type === 'writeMap').pop());
  check('right after the press "Map this repo" one quiet control says the model of the run and its effort, "Sonnet 5.5 · Medium"; its menu has one model list and the efforts, as on a comment card, a choice stays while the menu is open, a click outside closes it, and the press sends the model and the effort and no writer',
    team.words.trim() === 'Sonnet 5.5 · Medium' && team.heads.join() === 'Model,Effort' && team.open === 1 && team.closed
      && team.chosen === 'Opus 5.5 · Extra' && JSON.stringify(team.sent) === JSON.stringify({ type: 'writeMap', app: 'claude-code', team: { app: 'claude-code', lead: 'opus', effort: 'xhigh' } }),
    JSON.stringify(team));

  // The line of a map run, from the made-up records of example-data.ts. While a run writes: which session, and what is saved so far.
  const SAVED = 'overview, 3 of 8 areas, notes of 40 files';
  /** The line of the map run as Home shows it: its words, what "Open the session" says it does, its presses, and anything in it or beside it that moves. */
  const runLine = () => home.evaluate(() => {
    const line = document.querySelector('.maprun');
    return line && {
      text: line.textContent, state: line.dataset.run, tip: line.querySelector('span[title]')?.title, opens: line.querySelector('[data-open-run]')?.title,
      presses: [...document.querySelectorAll('[data-write]')].map((a) => a.textContent),
      moves: [line, ...line.querySelectorAll('*'), ...document.querySelectorAll('.nomap .dot')].filter((el) => getComputedStyle(el).animationName !== 'none').length,
      firstLine: document.querySelector('.nomap p')?.textContent, nodes: document.querySelectorAll('#view g.node.go').length, lines: document.querySelectorAll('.maprun').length,
      underHead: !!document.querySelector('#summary .maprun'),
    };
  });
  await homeAt('?run=desktop');
  const ownRun = await runLine();
  await takePicture(home, '35-home-while-a-map-run-writes.png');
  await home.click('.maprun [data-open-run]', { timeout: 3000 }).catch(() => {});
  const opened = await home.evaluate(() => window.apostilSent.find((message) => message.type === 'openMapSession'));
  await homeAt('?run=terminal');
  const terminalRun = await runLine();
  await homeAt('?nomap=1&run=home');
  const homeRun = await runLine();
  homeRun.chartTip = await home.getAttribute('.maprun [data-run-chart]', 'title').catch(() => '');
  await home.click('.maprun [data-run-chart]', { timeout: 3000 }).catch(() => {});
  homeRun.chartSent = await home.evaluate(() => window.apostilSent.some((message) => message.type === 'openMapChart'));
  await home.goto(`file://${listFile}?run=1`);
  await home.waitForFunction(() => window.apostilListDone, null, { timeout: 5000 });
  const homeRow = await home.$eval('.cl .home', (row) => ({ text: row.textContent, state: row.querySelector('.state')?.textContent }));
  check('while a map run writes, Home says in one quiet line which session writes the map and what is saved so far, and nothing in it moves: on the map, for a session of the desktop app with "Open the session", which opens it in its app (a click asks VS Code to open it); for a session in a terminal with "Open the session", which opens a terminal that continues it; in a repo with no map, for the run of Home, under the head in place of the press, with "Live chart" (a click asks VS Code to open the tab "Map run"); and the row "Home" of the list says "writing the map"',
    ownRun?.text === `Writing the map · Claude Code session "Map of library-app" · ${SAVED} · Open the session` && ownRun.lines === 1 && ownRun.nodes === 8 && ownRun.moves === 0 && ownRun.presses.length === 0
      && ownRun.tip === 'Session 1a2b3c4d-0000-4000-8000-00000000cafe\nAreas: Lending, Desk, Catalogue' && ownRun.opens === 'Opens the session in its app' && !!opened
      && terminalRun?.text === `Writing the map · Claude Code session 1a2b3c4d · ${SAVED} · Open the session` && terminalRun.opens === 'Opens a terminal of VS Code that continues the session'
      && homeRun?.text === `Writing the map · Claude Code session 1a2b3c4d (a session with no window) · ${SAVED} · Live chart` && homeRun.chartSent && /one time axis/.test(homeRun.chartTip) && homeRun.underHead && homeRun.presses.length === 0 && homeRun.moves === 0 && !homeRun.opens
      && homeRow.state === 'writing the map' && homeRow.text === 'Homelibrary-appwriting the map',
    JSON.stringify({ ownRun, opened, terminalRun, homeRun, homeRow }));

  // After a run that stopped: one line says so, with the press that starts again.
  const STOPPED = `The map run of Claude Code session "Map of library-app" stopped after ${SAVED}`;
  await homeAt('?nomap=1&run=stopped');
  const stoppedNoMap = await runLine();
  await takePicture(home, '36-home-after-a-map-run-stopped.png');
  await homeAt('?run=stopped');
  const stoppedOnMap = await runLine();
  await home.click('.maprun [data-write]', { timeout: 3000 }).catch(() => {});
  const again = await home.evaluate(() => window.apostilSent.find((message) => message.type === 'writeMap'));
  check('after a map run that stopped, Home says so in one line with the session and what was saved: in a repo with no map in place of its first line, above the press that maps the repo; on the map with one "Start again" for the app of the press (a click asks VS Code to start it)',
    stoppedNoMap?.text === `${STOPPED} · Open the session` && stoppedNoMap.state === 'stopped' && stoppedNoMap.firstLine === stoppedNoMap.text && stoppedNoMap.lines === 1
      && stoppedNoMap.presses.join() === 'Map this repo'
      && stoppedOnMap?.text === `${STOPPED} · Open the session · Start again · Another app` && stoppedOnMap.nodes === 8 && stoppedOnMap.lines === 1 && again?.app === 'claude-code',
    JSON.stringify({ stoppedNoMap, stoppedOnMap, again }));

  // The tab "Map run", from the made-up map session of example-data.ts as the real reader reads it: 10 minutes in, and after the run ended.
  const chartNow = () => home.evaluate(() => {
    const plot = document.querySelector('.mr-plot svg');
    return {
      head: document.querySelector('.mr-head')?.textContent, numbers: document.querySelector('.mr-nums')?.textContent,
      thinks: plot.querySelectorAll('.mr-think').length, commands: plot.querySelectorAll('.mr-command').length,
      writers: [...plot.querySelectorAll('.mr-writer .mr-bar')].map((bar) => bar.getAttribute('class').replace('mr-bar k-', '')),
      lefts: [...plot.querySelectorAll('.mr-writer .mr-bar')].map((bar) => bar.getBoundingClientRect().left), dots: plot.querySelectorAll('.mr-writer circle').length,
      now: plot.querySelectorAll('.mr-now').length, ahead: plot.querySelectorAll('.mr-ahead').length, alone: plot.querySelectorAll('.mr-alone').length,
      key: [...document.querySelectorAll('.mr-key span')].map((item) => item.textContent).join(', '), width: Math.round(plot.getBoundingClientRect().width),
    };
  });
  await homeAt('?chart=live');
  const live = await chartNow();
  await home.hover('.mr-writer[data-writer="2"] .mr-bar');
  const writerWindow = await home.waitForSelector('.win', { timeout: 3000 }).then(() => home.evaluate(() => document.querySelector('.win').innerText.replace(/\s+/g, ' ').trim()), () => '');
  await home.evaluate(() => new Promise((done) => { // a new chart comes, and Home has handled it
    addEventListener('message', () => Home.drawing.then(done), { once: true });
    postMessage({ type: 'data', data: window.APOSTIL_EXAMPLE.charts.live }, '*');
  }));
  const keptOpen = await home.evaluate(() => ({ open: !!document.querySelector('.win'), drawn: window.apostilRendered }));
  await takePicture(home, '94-the-live-chart-of-a-map-run.png');
  await away();
  await home.waitForFunction(() => window.apostilRendered >= 2, null, { timeout: 3000 }).catch(() => {});
  const drawnAfter = await home.evaluate(() => window.apostilRendered);
  check('the tab "Map run" while a run writes: its head says how long it writes and the minutes left, a line of numbers, the lead row with its thinking and its command, the writers in the order of their starts in the colours of their kinds with a dot on the running one, the alone band, the now line and the striped minutes left, a key of the kinds it has; a hover on a writer shows its task, model, minutes and tokens, a new chart does not close that window, and it is drawn when the window closes',
    live.head === 'Map runClaude Code session 1a2b3c4d · lead Sonnet 5.5 · Medium · writers Haiku 5.5 · MediumWriting · 10 min so far · about 7 min left'
      && live.numbers === '1 writer runs now3 donelead busy 3 min of 101k tokens written' && live.thinks === 5 && live.commands === 1
      && live.writers.join() === 'diagram,notes,process,service' && live.lefts.every((left, at) => at === 0 || left >= live.lefts[at - 1]) && live.dots === 1
      && live.now === 1 && live.ahead === 1 && live.alone === 1 && live.width > 1000
      && live.key === 'Lead thinks and writes, Lead runs a command, Diagrams, Notes, Processes, Services and marks, Lead alone'
      && writerWindow === 'Process: lending-0a1b2c Haiku 5.5 · Medium · running 8.4 min 200 tokens written so far' && keptOpen.open && keptOpen.drawn === 1 && drawnAfter === 2,
    JSON.stringify({ live, writerWindow, keptOpen, drawnAfter }));
  await homeAt('?chart=done');
  const doneChart = await chartNow();
  await takePicture(home, '94-the-chart-of-a-map-run-that-is-done.png');
  check('the tab "Map run" after the run ended says "Done in 12 min", counts its writers, and has no now line and no striped minutes left',
    /Done in 12 min$/.test(doneChart.head) && doneChart.numbers.startsWith('4 writers') && doneChart.now === 0 && doneChart.ahead === 0 && doneChart.dots === 0 && doneChart.writers.length === 4, JSON.stringify(doneChart));

  // Home while a run of the whole map writes, from the made-up runs with a plan of the work in example-data.ts (the time left comes from the plan).
  const runState = () => home.evaluate(() => {
    const view = document.getElementById('view');
    const frame = view.getBoundingClientRect();
    const fill = view.querySelector(':scope > .runbar > i');
    const time = document.getElementById('runtime');
    const cards = document.getElementById('cards').hidden ? [] : [...document.querySelectorAll('#cards .ovc')];
    return {
      time: time.hidden ? '' : time.querySelector('.rt')?.textContent ?? '', timeRight: Math.round(innerWidth - time.getBoundingClientRect().right),
      line: document.querySelector('#summary .maprun')?.textContent ?? '', wordmark: !!document.querySelector('.wordmark'),
      sketch: !!view.querySelector(':scope > svg.sketch'), shimmer: getComputedStyle(view.querySelector('.sketch .sks') ?? view).animationName,
      bar: fill && { width: fill.style.width, top: Math.round(fill.getBoundingClientRect().top - frame.top), height: Math.round(fill.getBoundingClientRect().height) },
      nodes: Object.fromEntries([...view.querySelectorAll('g.node')].filter((g) => /\brn-/.test(g.getAttribute('class'))).map((g) => [nodeKey(g), g.classList.contains('rn-working') ? 'working' : 'other'])),
      cards: cards.map((card) => ({
        title: card.querySelector('.ovn').textContent, state: /run-(\w+)/.exec(card.className)?.[1] ?? 'done', spin: getComputedStyle(card.querySelector('.ovh .spin') ?? card).animationName,
        bar: card.querySelector('.ovbar i')?.style.width ?? '', sketch: !!card.querySelector('.ovb .sketch'), content: !!card.querySelector('.ovb svg:not(.sketch), .ovf'),
        edge: getComputedStyle(card).borderTopStyle, empty: !card.querySelector('.ovb').children.length,
      })),
      fills: Math.round(frame.bottom) > innerHeight - 40, scrolls: document.documentElement.scrollHeight > innerHeight, rendered: window.apostilRendered,
    };
  });
  const cardsDrawn = () => home.waitForFunction(() => [...document.querySelectorAll('#cards .ovc')].every((card) => card.hasAttribute('data-drawn')), null, { timeout: 10000 }).catch(() => {});

  // Before the overview is saved: the sketch in the frame, the bar on its top edge, the line under the head and the time at the right end of the head.
  await homeAt('?nomap=1&run=reading');
  const reading = await runState();
  await takePicture(home, '84-1-before-the-overview.png');
  check('before the overview of a run is saved, the frame holds a soft sketch of a map that shimmers slowly in place of the wordmark; the line of the run stands under the head; no time and no bar show before the run has measured its pace; the page does not scroll',
    reading.sketch && reading.shimmer === 'sk-pass' && !reading.wordmark && reading.time === '' && reading.line.startsWith('Writing the map · Claude Code')
      && !reading.bar && reading.fills && !reading.scrolls, JSON.stringify(reading));

  // While the areas load: the states of the nodes of the top map and of their cards, the bar and the time.
  await homeAt('?run=areas');
  await cardsDrawn();
  const loading = await runState();
  await takePicture(home, '84-2-areas-loading.png');
  const cardOf = (title) => loading.cards.find((card) => card.title === title) ?? {};
  const working = ['Web routes', 'Lending'].map(cardOf);
  const done = loading.cards.filter((card) => card.state === 'done');
  check('while the areas load, the node of an area that writers work on now has an accent edge; its card shows a sketch, a turning mark and its own bar, and a card whose area is done shows its diagram or files; the bar of the run and the time stay',
    JSON.stringify(loading.nodes) === JSON.stringify({ routes: 'working', lending: 'working' })
      && working.every((card) => card.state === 'working' && card.sketch && card.spin === 'ov-turn' && !card.content) && working.map((card) => card.bar).join() === '45%,20%'
      && done.length === 6 && done.every((card) => card.content && card.edge === 'solid')
      && parseFloat(loading.bar?.width) > 15 && loading.bar.top <= 1 && /^About \d+ min left$/.test(loading.time) && !loading.scrolls, JSON.stringify(loading));

  // After a save the time changes once and calmly; the time that VS Code sends every 30 seconds changes the words and the bar, and draws nothing again.
  await home.evaluate(() => window.postMessage({ type: 'data', data: { ...Home.data, mapRun: window.APOSTIL_EXAMPLE.mapRuns.later } }, '*'));
  await home.waitForFunction((count) => window.apostilRendered > count, loading.rendered, { timeout: 5000 }).catch(() => {});
  const rolling = await home.evaluate(() => {
    const time = document.getElementById('runtime');
    return { now: time.querySelector('.rt')?.textContent ?? '', old: time.querySelector('.rt-old')?.textContent ?? '', moves: [...time.children].map((one) => getComputedStyle(one).animationName).join() };
  });
  await home.waitForSelector('#runtime .rt-old', { state: 'detached', timeout: 4000 }).catch(() => {});
  const saved = { ...(await runState()), old: await home.$$eval('#runtime .rt-old', (all) => all.length) };
  await home.evaluate(() => window.postMessage({ type: 'time', time: { minutes: 0, share: 0.97 } }, '*'));
  await home.waitForFunction(() => document.querySelector('#runtime .rt')?.textContent === 'Less than a minute left', null, { timeout: 3000 }).catch(() => {});
  const ticked = await runState();
  check('after a save the time left changes once and calmly: the old words move up and fade out above the new ones, then only the new ones stay, and the bar moves on; the time that VS Code sends every 30 seconds changes the words and the bar with nothing drawn again, and under a minute it says "Less than a minute left"',
    rolling.old === loading.time && /^About \d+ min left$/.test(rolling.now) && rolling.now !== rolling.old && rolling.moves === 'rt-in,rt-out' && saved.time === rolling.now && saved.old === 0
      && parseFloat(saved.bar?.width) > parseFloat(loading.bar.width) && ticked.time === 'Less than a minute left' && ticked.bar?.width === '97%' && ticked.rendered === saved.rendered,
    JSON.stringify({ rolling, saved, ticked }));

  // In full screen during a run: the top map with the bar and the time, and no cards. When the run ends, the bar and the time go and the page is the normal overview.
  await home.evaluate(() => Overview.choose(true, () => Home.render()));
  await homeSettled();
  const fullRun = await runState();
  await takePicture(home, '84-3-full-screen-during-a-run.png');
  await home.evaluate(() => Overview.choose(false, () => Home.render()));
  await homeSettled();
  await home.evaluate(() => { const { mapRun, ...rest } = Home.data; window.postMessage({ type: 'data', data: rest }, '*'); });
  await home.waitForFunction(() => !Home.data.mapRun && document.querySelectorAll('#cards .ovc').length > 0, null, { timeout: 5000 }).catch(() => {});
  await homeSettled();
  await cardsDrawn();
  const ended = await runState();
  check('in full screen during a run the top map shows with the bar of the run and the time left, and no cards; when the run ends the bar, the time and the states go, and the page is the normal overview with every card filled',
    fullRun.cards.length === 0 && fullRun.fills && parseFloat(fullRun.bar?.width) > 0 && fullRun.time !== '' && Object.keys(fullRun.nodes).length === 2
      && !ended.bar && ended.time === '' && ended.line === '' && Object.keys(ended.nodes).length === 0 && ended.cards.length === 8 && ended.cards.every((card) => card.state === 'done' && card.content),
    JSON.stringify({ fullRun, ended }));

  // Comments on the map of Home: a node and an arrow hold one, as on the change page; "@" offers only new sessions; a row of the list after a level down lights its node.
  await homeAt('');
  const homeAim = () => home.evaluate(() => [...new Set([...document.querySelectorAll('.aim')].map((el) => el.dataset.rk))]);
  const homeStick = async (spot) => {
    await home.keyboard.press('Meta+Shift+Period');
    await home.mouse.move(spot.x - 3, spot.y - 3);
    await home.mouse.move(spot.x, spot.y, { steps: 2 });
    const outline = await homeAim();
    await home.mouse.click(spot.x, spot.y);
    const opened = await home.waitForSelector('.cbox [data-field="new"]:focus', { timeout: 3000 }).then(() => true, () => false);
    return { outline, where: opened ? await home.$eval('.cbox .where', (el) => el.title) : '' };
  };
  const centreOf = (selector) => home.$eval(selector, (el) => { const box = el.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; });
  const mapSent = () => home.evaluate(() => window.apostilSent.filter((message) => message.type === 'remark').map((message) => message.target));
  const onMapNode = await homeStick(await centreOf(nodeOf('lending')));
  await home.keyboard.type('What lives in lending?');
  await home.keyboard.press('Enter');
  await home.locator('.cbox.card .cth .msg.mine', { hasText: 'What lives in lending?' }).waitFor({ timeout: 3000 }).catch(() => {});
  const nodeCard = await home.locator('.cbox.card .cth .msg.mine', { hasText: 'What lives in lending?' }).count(); // the card stays open on its thread
  const nodeCircle = await home.$$eval(`${nodeOf('lending')} .cb`, (all) => all.length);
  await takePicture(home, '52-comment-on-a-node-of-the-map.png');
  await home.keyboard.press('Escape');
  const nodeTarget = (await mapSent()).at(-1);
  const arrowSpot = await home.evaluate(() => {
    const hit = document.querySelector('#view path.hit');
    const point = hit.getPointAtLength(hit.getTotalLength() / 2);
    const m = hit.getScreenCTM();
    return { x: point.x * m.a + point.y * m.c + m.e, y: point.x * m.b + point.y * m.d + m.f, rk: hit.dataset.rk };
  });
  const onMapArrow = await homeStick(arrowSpot);
  await home.keyboard.type('@');
  const mapChoices = await home.$$eval('.mentions .opt .nm', (all) => all.map((el) => el.textContent)).catch(() => []);
  await home.keyboard.press('Escape');
  await home.keyboard.type('Why this arrow?');
  await home.keyboard.press('Enter');
  await home.waitForFunction(() => window.apostilSent.some((message) => message.type === 'remark' && message.target.kind === 'edge'), null, { timeout: 3000 }).catch(() => {});
  const arrowTarget = (await mapSent()).at(-1);
  await home.keyboard.press('Escape');
  check('under the comment pointer a node and an arrow of the map have the outline, a click opens the card that names them, and Enter saves the comment: the card on its thread and a mark on the node, an arrow named by its two ends; on Home "@" offers only a new session of each installed app',
    onMapNode.outline.join() === 'node:lib-top:lending' && /^Node "Lending", diagram "The library app and its parts"$/.test(onMapNode.where) && nodeCard === 1 && nodeCircle === 1 && nodeTarget?.node === 'lending'
      && onMapArrow.outline.join() === arrowSpot.rk && /^Arrow "/.test(onMapArrow.where) && arrowTarget?.kind === 'edge' && arrowTarget.diagram === 'lib-top'
      && mapChoices.join() === 'claude-new,codex-new,opencode-new', JSON.stringify({ onMapNode, nodeCard, nodeCircle, nodeTarget, onMapArrow, arrowTarget, mapChoices }));

  // ✓ on a card: the card and the mark of its thread shrink and fade. New data from VS Code where only the comments changed draws no new diagram.
  await home.evaluate(() => { window.keptRemarks = Home.data.remarks.map((remark) => ({ ...remark })); });
  await home.click(`${nodeOf('lending')} .cb`).catch(() => {});
  await home.locator('.cbox.card [data-resolve]').click({ timeout: 3000 }).catch(() => {});
  const leaving = await home.evaluate(() => ({ card: document.querySelectorAll('.cbox.leaving').length, open: document.querySelectorAll('.cbox:not(.leaving)').length }));
  await home.waitForTimeout(500);
  const leftGone = await home.evaluate(() => document.querySelectorAll('.cbox, .cb.leaving').length);
  const quietData = await home.evaluate(async () => {
    const svg = document.querySelector('#view svg');
    const drawn = window.apostilRendered;
    const remarks = Home.data.remarks.map((remark) => ({ ...remark, state: 'closed' }));
    const before = document.querySelectorAll('#view .cb').length;
    window.postMessage({ type: 'data', data: { ...Home.data, remarks } }, '*');
    await new Promise((done) => setTimeout(done, 150));
    const after = { same: document.querySelector('#view svg') === svg, drawn: window.apostilRendered - drawn, before, marks: document.querySelectorAll('#view .cb').length };
    window.postMessage({ type: 'data', data: { ...Home.data, remarks: window.keptRemarks } }, '*'); // the threads open again for the checks after this one
    await new Promise((done) => setTimeout(done, 150));
    return after;
  });
  check('✓ on the card of a comment on the map: the card and its mark shrink and fade, then go; new data where only the comments changed draws no new diagram, so nothing blinks, and the marks follow',
    leaving.card === 1 && leaving.open === 0 && leftGone === 0 && quietData.same && quietData.drawn === 0 && quietData.before > 0 && quietData.marks === 0, JSON.stringify({ leaving, leftGone, quietData }));
  await home.mouse.move(2, 2);
  await into('lending');
  await homeSettled();
  const lowerCrumb = await crumbOf();
  await home.click('[data-comments]');
  await home.locator('.cml .cmr[data-row]', { hasText: 'What lives in lending?' }).click();
  await home.waitForSelector('.paper .flash', { timeout: 3000 }).catch(() => {});
  const cardLit = await home.evaluate(() => ({ flashed: [...new Set([...document.querySelectorAll('.paper .flash')].map((el) => el.dataset.rk))], crumb: document.getElementById('crumb').textContent, card: document.querySelector('.cbox.card .cth .msg.mine')?.textContent }));
  await home.keyboard.press('Escape');
  await homeAt('?path=src/library/desk/');
  await home.keyboard.press('Meta+Shift+Period');
  const graphsPicking = await home.evaluate(() => document.body.classList.contains('picking'));
  check('a click on the row of a node in the list of the comments after one level down goes back to the top map, lights that node and opens its card, and the path ends at Home; the small panels of the graphs page hold no comment: the comment key does nothing there',
    lowerCrumb === 'Home›Lending: holds, requests and mails' && cardLit.flashed.join() === 'node:lib-top:lending' && cardLit.crumb === 'Home' && cardLit.card === 'What lives in lending?' && !graphsPicking, JSON.stringify({ lowerCrumb, cardLit, graphsPicking }));

  // On the change page, the wider diagram that the map holds too links to Home.
  await home.goto(`file://${pageFile}`);
  await homeDrawn();
  await home.click('.sec .alters a');
  await pageSettled();
  const onHome = await home.textContent('#tabs .home-link').catch(() => '');
  const repoWords = (view) => view.evaluate(() => [...document.querySelectorAll('#tabs .drepo')].map((el) => el.textContent));
  const writtenAgain = await repoWords(home); // the example map was written on the branch, after the change was described
  await home.click('#tabs .home-link');
  await home.waitForURL(/home\.html/, { timeout: 5000 }).catch(() => {});
  await homeDrawn();
  const onHomeCrumb = await crumbOf();
  check('the large view of a wider diagram that the map holds too has the link "on Home", which shows it on Home', onHome === 'on Home' && /›The areas of the member page$/.test(onHomeCrumb), `${onHome}; ${onHomeCrumb}`);

  // A diagram of a part that draws on a repo diagram ("of") links to it: the same diagram on Home, with nothing of the change painted on it.
  const partView = (view) => `file://${pageFile}?go=${encodeURIComponent(JSON.stringify({ level: 'part', ...view }))}`;
  const painted = () => home.evaluate(() => document.querySelectorAll('#view tspan.sg.p, #view tspan.sg.m, #view tspan.was, #view g.node.lit').length
    + [...document.querySelectorAll('#view text.tc')].filter((el) => el.textContent.trim()).length);
  await home.goto(partView({ part: 'tables', diagram: 'hold-schema' }));
  await homeDrawn();
  const ofPart = { link: await home.textContent('#tabs .home-link').catch(() => ''), painted: await painted() };
  await takePicture(home, 'change-diagram-on-home-link.png');
  await home.click('#tabs .home-link');
  await home.waitForURL(/home\.html/, { timeout: 5000 }).catch(() => {});
  await homeDrawn();
  const onHomeNow = { at: await home.evaluate(() => Home.at), crumb: await crumbOf(), tables: await home.evaluate(() => document.querySelectorAll('#view g.node').length), painted: await painted() };
  await takePicture(home, 'repo-diagram-on-home.png');
  check('a diagram of a part that draws on a repo diagram has "on Home", which shows that diagram on Home with nothing of the change painted on it',
    ofPart.link === 'on Home' && ofPart.painted > 0 && onHomeNow.at === 'lib-reservations' && /›The tables of reservations$/.test(onHomeNow.crumb) && onHomeNow.tables === 5 && onHomeNow.painted === 0,
    JSON.stringify({ ofPart, onHomeNow }));
  await home.goto(partView({ part: 'hold-service', diagram: 'offer-flow' }));
  await homeDrawn();
  const isNew = { words: await repoWords(home), link: await home.$('#tabs .home-link') };
  check('a diagram of code that is all new says "New in this change" and has no link to Home; one whose repo diagram the map no longer holds as it was says that the map was written again',
    isNew.words.join() === 'New in this change' && !isNew.link && writtenAgain.join() === 'The map was written again since this change was described.', JSON.stringify({ isNew: isNew.words, writtenAgain }));
  await home.close();
} catch (error) {
  check('the checks ran to the end', false, error.message.split('\n').slice(0, 14).join(' / '));
}
await finish();
