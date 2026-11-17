// The band of the mod: a pull request made shows it, × hides it for good, and with the links off nothing shows.
// Each hook of a test stands for the engine: the Bash tool and "apostil link" answer from here, nothing runs.

import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const LINK = 'https://vscode.dev/redirect?url=vscode%3A%2F%2Fapostil.apostil%2Fpull%3Frepo%3Dmade-up%2Fexample%26number%3D12'
const PR = 'https://github.com/made-up/example/pull/12'
const BAND = {
  plugin: 'apostil',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const

/** The Bash tool answers that the command made or edited pull request 12; "apostil link" prints `printed`. */
function engine(on: On, printed: string, ran: string[][] = []) {
  mock.store(on)
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 0, stdout: printed, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', { tool: 'Bash' }, (_, e) => ({
    result: { stdout: '', stderr: '', interrupted: false, gitOperation: { pr: { number: 12, url: PR, action: e.command.includes('edit') ? 'edited' : 'created' } } },
  }))
}

test('a pull request made shows the band with its link; × hides it, and it never comes back for that pull request', async ($, on) => {
  const ran: string[][] = []
  engine(on, `${LINK}\n`, ran)
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  expect(ran).toEqual([['apostil', 'link', '--pr', PR]])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /#12/ }))?.text).toBe('#12 · ')
    expect((await ui.find({ type: 'Link' }))?.props).toEqual({ href: LINK, label: 'Read it in Apostil' })
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'close' })
  expect(await ui.find({ type: 'Link' })).toBeUndefined()
  expect(await ui.keepsBeneath()).toBe(true)
  // An edit of the same pull request later: no band, and "apostil link" is not asked again.
  await $.tool.call({ tool: 'Bash', command: 'gh pr edit 12 --body-file body.md' })
  expect(await ui.find({ type: 'Link' })).toBeUndefined()
  expect(ran.length).toBe(1)
  await ui.unmount()
})

test('with the links off "apostil link" prints nothing, and no band shows', async ($, on) => {
  engine(on, '')
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Link' })).toBeUndefined()
  expect(await ui.keepsBeneath()).toBe(true)
  await ui.unmount()
})
