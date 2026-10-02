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

/** The main conversation's prompt cache: no reply yet, a clock, or why it couldn't be read. */
export type CacheState =
  | { kind: 'none' }
  | { kind: 'clock'; since: number; ttlMs: number }
  | { kind: 'unknown'; reason: string }

declare module 'claude-code' {
  interface PluginState {
    dnmod: { view: View; probe: Probe | null; cache: CacheState; demoFrom: number | null }
  }
}
