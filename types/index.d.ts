export type View = 'session' | 'days30'

/** What /dnmod found about the machine the engine runs on. */
export type Probe = {
  at: number
  surfaces: string[]
  version: string
  sessionId: string
  host: string
  os: string
  claudeDir: string
  projects: string
  transcript: string
  tail: string
}

declare module 'claude-code' {
  interface PluginState {
    dnmod: { view: View; probe: Probe | null }
  }
}
