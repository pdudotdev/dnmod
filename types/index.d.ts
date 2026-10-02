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

/** The main conversation as its transcript leaves it (hooks/cache.ts reads it). */
export type TranscriptState = {
  /** When its cache was last read or written, ms since the epoch: a request's start, a recap's or a compaction's. */
  since: number
  /** That cache's lifetime: the last cache write's. */
  ttlMs: number
  /** The last request's prompt as logged (uncached + read + written): what the next message re-sends. */
  prompt: number
  /** The last request's model, speed ("fast"/"standard") and region (`inference_geo`). */
  model: string | null
  speed: string | null
  geo: string | null
  /** /compact ran since the last request: the next request measures the new size. */
  compacted: boolean
  /** The session exited (Claude Code wrote its cost-state) and nothing was typed or sent since. */
  ended: boolean
}

/** The main conversation's cache: no request yet, its state, or why it couldn't be read. */
export type CacheState =
  | { kind: 'none' }
  | ({ kind: 'clock' } & TranscriptState)
  | { kind: 'unknown'; reason: string }

declare module 'claude-code' {
  interface PluginState {
    dnmod: { view: View; probe: Probe | null; cache: CacheState; demoFrom: number | null }
  }
}
