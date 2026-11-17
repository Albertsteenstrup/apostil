// The values the mod keeps for the session: the band that shows, or null.
export type Band = { number: number; link: string } | null

declare module 'claude-code' {
  interface PluginState {
    apostil: { band: Band }
  }
}
