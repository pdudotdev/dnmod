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

/** What this session's logged requests (its subagents' included) cost, by local day (hooks/ledger.ts). */
export type Spend = {
  /** Local date ("2026-10-02") -> USD. */
  days: Record<string, number>
  /** All days together: what the transcripts log, which Claude Code's own total should reach or pass. */
  all: number
  /** Requests whose model has no known price, so not in the sums. */
  unpriced: number
  /** The machine's time zone when this was summed, minutes east of UTC. */
  offsetMinutes: number
}

/** The last 30 days, across every session on this machine (hooks/stats.ts), as the band and the side panel show them. */
export type Stats30 = {
  spend: number
  requests: number
  /** Spend a day over the days the transcripts cover, when that's more than a day. */
  perDay: number | null
  /** Input tokens read back from the cache, as a share of all input tokens. */
  cached: number | null
  /** What cache misses added (writing again what could have been read back), and the biggest cause. */
  misses: number
  topCause: string | null
  /** The model family with the most spend: its name on screen, and its share. */
  topModel: { name: string; share: number } | null
  /** Where the data begins: the period's start, or the first day the transcripts cover if later. */
  coveredFrom: number
  /** Spend on each of the last 30 local days, today last. */
  days: number[]
  /** When it was worked out. */
  at: number
  /** Spend split by model (fast mode apart), by project folder, misses by cause, and spend by context size; biggest first, the rest as "others" (context: smallest band first). */
  byModel: Share[]
  byProject: Share[]
  byCause: Share[]
  byContext: Share[]
}

/** One slice of a breakdown: its name on screen, and USD. */
export type Share = { name: string; spend: number }

declare module 'claude-code' {
  interface PluginState {
    dnmod: { view: View; probe: Probe | null; cache: CacheState; demoFrom: number | null; spend: Spend | null; stats30: Stats30 | null }
  }
}
