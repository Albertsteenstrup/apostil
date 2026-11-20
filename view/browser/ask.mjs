// The browser check of the direct link that has an agent describe a pull request, with no words to give the agent: one press in
// place of "Copy", which names the session that will do it and shows no words for the agent, and the line of that run after the press. VS Code sends what the press says (App.ask, an AskView of shared/ask.ts); here the check sends it as VS Code does.
// A group of view/browser-check.mjs; alone:
//   node view/browser/ask.mjs [--pictures] [<folder for pictures>]

import { check, errors, finish, newPage, pageFile, takePicture } from './tools.mjs';

const WORDS = 'Describe pull request #35 for Apostil';

try {
  const page = await newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2 });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`file://${pageFile}`);
  await page.waitForFunction(() => window.APOSTIL_EXAMPLE, null, { timeout: 15000 });
  /** The line under the head of the page of a pull request with no stored change: its text, its press and links, and anything in it that moves. */
  const line = () => page.evaluate(() => {
    const summary = document.getElementById('summary');
    const press = summary.querySelector('[data-ask]');
    const open = summary.querySelector('[data-ask-open]');
    const words = summary.cloneNode(true);
    words.querySelectorAll('.rpick').forEach((el) => el.remove()); // the control of the models after the press: read on its own
    return {
      text: words.textContent.replace(/ · $/, ''), control: summary.querySelector('.rpick .rp')?.textContent.trim() ?? '',
      press: press && { label: press.textContent, tip: press.title }, open: open && { text: open.textContent, tip: open.title },
      copy: !!summary.querySelector('[data-copy]'), moves: [...summary.querySelectorAll('*')].filter((el) => getComputedStyle(el).animationName !== 'none').length,
    };
  });

  /** Scrolls to the top, where the line stands, once the drawing of the conversation is done, for a picture of the line. */
  const toTop = () => page.evaluate(async () => {
    await App.drawing;
    scrollTo(0, 0);
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });

  // The page of #35 as VS Code opens it, first with no VS Code (the words stay as text), then with the press that VS Code sends.
  const before = await page.evaluate(async (words) => {
    const read = APOSTIL_EXAMPLE.answers['pull:https://example.com/made-up/pull/12'];
    App.page = { ...App.page, pullOnly: { link: read.pull.url, number: 35, local: false, otherRepo: false, fetch: 'git fetch origin pull/35/head' }, files: read.pull.files, parts: [] };
    App.state.view = 'conversation';
    App.ask = null;
    await App.render();
    const plain = document.getElementById('summary').textContent;
    App.ask = { words, press: { label: 'Describe it with a new Claude Code session', tip: 'Starts a new Claude Code session that writes the description.' }, team: APOSTIL_EXAMPLE.askTeam };
    await App.render();
    return { plain, views: [...document.querySelectorAll('.bar .switch a:not([hidden])')].map((a) => a.textContent) };
  }, WORDS);
  const pressed = await line();
  await toTop(); // the conversation opens at its newest message, under the line
  await takePicture(page.locator('#summary'), '75-the-line-before-the-press.png');
  check('the page of a pull request with no stored change has one direct link in place of "Copy", named after the session that will describe it, and shows no words to give an agent; with no app that can be started it links to the pages that install one; its switch has "Conversation" first and "Diffs" second',
    before.plain === 'This pull request has no description of Apostil yet. Install Claude Code or Codex to describe it.'
      && pressed.text === 'This pull request has no description of Apostil yet. Describe it with a new Claude Code session'
      && pressed.press?.tip === 'Starts a new Claude Code session that writes the description.' && !pressed.text.includes(WORDS) && !before.plain.includes(WORDS) && !pressed.copy && !/Copy/.test(pressed.text) && before.views.join() === 'Conversation,Diffs',
    JSON.stringify({ before, pressed }));

  // The control after the press: the model of the lead at Medium, as everywhere else; its menu has one model list and the efforts. A choice goes with the
  // press, and no writer: the writers are always the smallest model at Medium (teamFrom and teamRun in shared/models.ts).
  await page.click('#summary [data-rp-open]', { timeout: 3000 }).catch(() => {});
  const menu = await page.$$eval('#summary .rmenu :is(.ph, .pi, .chip)', (rows) => rows.map((row) => `${row.textContent.trim()}${row.classList.contains('on') ? ' ✓' : ''}`).filter(Boolean));
  await page.click('#summary [data-rp-model="opus"]', { timeout: 3000 }).catch(() => {});
  await page.click('#summary [data-rp-effort="xhigh"]', { timeout: 3000 }).catch(() => {});
  await page.mouse.move(5, 5);
  await takePicture(page, '82-the-control-after-describe-with-its-menu-open.png');
  const chosen = (await line()).control;
  await page.keyboard.press('Escape');
  // A click sends the words to VS Code, which starts the run and answers with the line of the run; its link opens the session (in a terminal here).
  await page.click('#summary [data-ask]', { timeout: 3000 }).catch(() => {});
  const sent = await page.evaluate(() => window.apostilSent.filter((message) => message.type === 'askAgent'));
  await page.evaluate((words) => window.postMessage({ type: 'asked', ask: { words, line: { words: 'Description by a new Claude Code session 1a2b3c4d', state: 'working', tip: 'Session 1a2b3c4d-0000-4000-8000-00000000cafe', opens: 'terminal' } } }, '*'), WORDS);
  await page.waitForFunction(() => !!document.querySelector('#summary [data-ask-open]'), null, { timeout: 3000 }).catch(() => {});
  const after = await line();
  await toTop();
  await takePicture(page.locator('#summary'), '75-the-line-after-the-press.png');
  await page.click('#summary [data-ask-open]', { timeout: 3000 }).catch(() => {});
  const opened = await page.evaluate(() => window.apostilSent.filter((message) => message.type === 'openAskSession'));
  check('after the press the control says "Sonnet 5.5 · Medium", and its menu has one model list and the efforts, as on a comment card; a click on the press sends the words once to VS Code with the model and the effort that the control shows and no writer, and the line then names the session that writes the description, its state and one link that opens it, with no words for the agent (a click asks VS Code to open it); nothing in the line moves',
    pressed.control === 'Sonnet 5.5 · Medium'
      && JSON.stringify(menu) === JSON.stringify(['Model', 'Haiku 5.5', 'Sonnet 5.5 ✓', 'Opus 5.5', 'Fable 5.2', 'Effort', 'Low', 'Medium ✓', 'High', 'Extra', 'Max'])
      && chosen === 'Opus 5.5 · Extra'
      && JSON.stringify(sent) === JSON.stringify([{ type: 'askAgent', words: WORDS, team: { app: 'claude-code', lead: 'opus', effort: 'xhigh' } }])
      && after.text === 'Description by a new Claude Code session 1a2b3c4d · working · Open the session' && !after.press && after.open?.tip === 'Opens a terminal of VS Code that continues the session'
      && after.moves === 0 && JSON.stringify(opened) === JSON.stringify([{ type: 'openAskSession', words: WORDS }]),
    JSON.stringify({ control: pressed.control, menu, chosen, sent, after, opened }));

  // A press that started no run (Apostil could not get the branch of the pull request): the line says why in one sentence, with the press again.
  const why = 'Could not check out the branch made-up/reminders of pull request #35: couldn\'t find remote ref pull/35/head.';
  await page.evaluate(({ words, why }) => window.postMessage({ type: 'asked', ask: { words, problem: why, press: { label: 'Describe it with a new Claude Code session', tip: 'Starts a new Claude Code session that writes the description.' } } }, '*'), { words: WORDS, why });
  await page.waitForFunction(() => !document.querySelector('#summary [data-ask-open]'), null, { timeout: 3000 }).catch(() => {});
  const failed = await line();
  check('a press that started no run, because the branch of the pull request could not be checked out: the line says why in one sentence, with the press again, and nothing in it moves',
    failed.text === `${why} Describe it with a new Claude Code session` && failed.press?.label === 'Describe it with a new Claude Code session' && failed.moves === 0,
    JSON.stringify(failed));

  // The open branch with no change file: the page has its diffs (all its files in no part) and no diagram, and the same line with the press that has an agent describe the branch.
  await page.evaluate(() => {
    const { files, checks } = APOSTIL_EXAMPLE.page; // as branchPage() makes it: the changed files, all in no part
    App.page = { ...APOSTIL_EXAMPLE.page, branchOnly: true, parts: [], diagrams: [], changeDiagram: '', checks: { ...checks, filesInNoPart: files.map((file) => file.path), generated: [] } };
    App.ask = { words: 'Describe the change of this branch for Apostil', press: { label: 'Describe it with a new Claude Code session', tip: 'Starts a new Claude Code session that writes the description.' } };
    App.state.view = 'diagram';
    App.render();
  });
  await page.waitForFunction(() => App.state.view === 'diffs' && /file 1 of/.test(document.querySelector('#tabs .nav')?.textContent ?? '') && !!document.querySelector('#view .fh'), null, { timeout: 8000 }).catch(() => {});
  const branch = await page.evaluate(() => ({
    view: App.state.view, diagram: !document.querySelector('.switch a[data-view="diagram"]').hidden, files: App.page.files.length,
    order: App.order().length, shown: document.querySelectorAll('#view .fh').length, counter: document.querySelector('#tabs .nav')?.textContent ?? '',
  }));
  const branchLine = await line();
  await takePicture(page, '76-the-open-branch-with-no-change-file.png');
  check('the open branch with no change file opens at "Diffs" with every changed file and no diagram, and its line says that it has no description of Apostil yet, with the press that has an agent describe it',
    branch.view === 'diffs' && !branch.diagram && branch.order === branch.files && branch.shown > 0 && branch.counter.includes(`file 1 of ${branch.files}`)
      && branchLine.text === 'This branch has no description of Apostil yet. Describe it with a new Claude Code session' && branchLine.press?.label === 'Describe it with a new Claude Code session',
    JSON.stringify({ branch, branchLine }));
  await page.close();
} catch (error) {
  check('the check ran to its end', false, error.stack);
}
await finish();
