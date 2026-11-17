// The Claude mod of Apostil: when a Bash command made or edited a pull request, one quiet band above the prompt, "#12 · Read it in Apostil", with a ×.
// The link comes from "apostil link", so the switch of Apostil holds, and a computer with no Apostil shows no band. Once for each pull request.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Band } from '../types'

const band = atom({ plugin: 'apostil', key: 'band' } as const, null as Band)
const SEEN = 'pullRequestsWithBand' // in $.store, across sessions: each pull request that had its band

/** The https link of a pull request from "apostil link", or undefined: no Apostil here, the links are off, or the command failed. */
async function linkOf($: EngineInterface, pull: string): Promise<string | undefined> {
  try {
    const { exitCode, stdout } = await $.process.run(['apostil', 'link', '--pr', pull], { timeoutMs: 5000 })
    const link = stdout.trim()
    return exitCode === 0 && link.startsWith('https://') ? link : undefined
  } catch {
    return undefined // the command is not on this computer
  }
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const pr = ran.isError || ran.deny !== undefined ? undefined : ran.result.gitOperation?.pr
    if (pr?.action !== 'created' && pr?.action !== 'edited') return ran
    const id = pr.url ?? String(pr.number) // "apostil link --pr" takes a link or a number
    const seen = ((await $.store.get(SEEN)) as string[] | undefined) ?? []
    const link = seen.includes(id) ? undefined : await linkOf($, id)
    if (link) {
      // Kept as soon as it shows: a press on the link is not seen by the mod, so the band never comes back for this pull request.
      await $.store.set(SEEN, [...seen, id].slice(-500))
      await update($, band, () => ({ number: pr.number, link }))
    }
    return ran
  }).catch(($, e, next) => next(e)) // a fault of the band never changes the result of the command: next(e) gives what the tool answered

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, band)
    if (!shown || e.props.hasSurvey) return next(e)
    const { Box, Button, Link, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>#{shown.number} · </Text>
        <Link href={shown.link} label="Read it in Apostil" />
        <Text> </Text>
        <Button key="close" label="×" plain role="dismiss" onPress={() => update($, band, () => null)} />
      </Box>
    )
  })
}
