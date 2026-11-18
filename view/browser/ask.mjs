// The browser check of the direct link that has an agent describe a pull request (build prompt 75, then "no words to give an agent"): one press in
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
    return {
      text: summary.textContent, press: press && { label: press.textContent, tip: press.title }, open: open && { text: open.textContent, tip: open.title },
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
    App.ask = { words, press: { label: 'Describe it with a new Claude Code session', tip: 'Starts a new Claude Code session that writes the description.' } };
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
  check('a click on the press sends the words once to VS Code, and the line then names the session that writes the description, its state and one link that opens it, with no words for the agent (a click asks VS Code to open it); nothing in the line moves',
    JSON.stringify(sent) === JSON.stringify([{ type: 'askAgent', words: WORDS }])
      && after.text === 'Description by a new Claude Code session 1a2b3c4d · working · Open the session' && !after.press && after.open?.tip === 'Opens a terminal of VS Code that continues the session'
      && after.moves === 0 && JSON.stringify(opened) === JSON.stringify([{ type: 'openAskSession', words: WORDS }]),
    JSON.stringify({ sent, after, opened }));
  await page.close();
} catch (error) {
  check('the check ran to its end', false, error.stack);
}
await finish();
