// The main conversation's state, read from the end of a session transcript: its prompt cache's
// clock and what the next message re-sends. Ported from usdash (usdash/sessions.py), which holds
// the same rules. Pure.

import type { TranscriptState } from '../types'

const HOUR = 3_600_000
const FIVE_MINUTES = 300_000
// Recaps are logged a few seconds after their request started (usdash's RECAP_LAG).
const RECAP_LAG = 5_000

type Usage = {
  input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number }
  speed?: string
  inference_geo?: string
}

type TranscriptRecord = {
  type?: string
  subtype?: string
  uuid?: string
  parentUuid?: string | null
  isSidechain?: boolean
  isMeta?: boolean
  isApiErrorMessage?: boolean
  timestamp?: string
  compactMetadata?: { durationMs?: number }
  message?: { id?: string; model?: string; content?: unknown; usage?: Usage }
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

const parse = (lines: readonly string[]): TranscriptRecord[] => {
  const records: TranscriptRecord[] = []
  for (const line of lines) {
    if (line.trim() === '') continue
    try {
      records.push(JSON.parse(line) as TranscriptRecord)
    } catch {
      // The first line of a tail read is usually cut short.
    }
  }
  return records
}

/** Tokens a usage block wrote to the cache, 5-minute and 1-hour; writes without the split count as 5-minute. */
const writes = (usage: Usage): { fiveMinutes: number; oneHour: number } => {
  const oneHour = count(usage.cache_creation?.ephemeral_1h_input_tokens)
  const split5 = count(usage.cache_creation?.ephemeral_5m_input_tokens)
  const unsplit = count(usage.cache_creation_input_tokens) - oneHour - split5
  return { fiveMinutes: split5 + Math.max(unsplit, 0), oneHour }
}

const promptOf = (usage: Usage): number => {
  const { fiveMinutes, oneHour } = writes(usage)
  return count(usage.input_tokens) + count(usage.cache_read_input_tokens) + fiveMinutes + oneHour
}

/** A request's TTL: 1 hour if it wrote any 1-hour tokens, else 5 minutes if it wrote any; null if it only read. */
const ttlOf = (usage: Usage): number | null => {
  const { fiveMinutes, oneHour } = writes(usage)
  if (oneHour > 0) return HOUR
  if (fiveMinutes > 0) return FIVE_MINUTES
  return null
}

/** A main-conversation reply that is a priced request (not an error, not a synthetic message). */
const isRequest = (r: TranscriptRecord): boolean =>
  r.type === 'assistant' &&
  r.isSidechain !== true &&
  r.isApiErrorMessage !== true &&
  !!r.message?.id &&
  !!r.message.model &&
  r.message.model !== '<synthetic>' &&
  typeof r.message.usage === 'object'

/** Something typed in the main conversation: a prompt or a slash command, not a tool result. */
const isTyped = (r: TranscriptRecord): boolean => {
  if (r.type !== 'user' || r.isSidechain === true || r.isMeta === true) return false
  const content = r.message?.content
  if (typeof content === 'string') return true
  return Array.isArray(content) && !content.some(block => (block as { type?: string })?.type === 'tool_result')
}

const time = (r: TranscriptRecord | undefined): number | null => {
  const t = Date.parse(r?.timestamp ?? '')
  return Number.isNaN(t) ? null : t
}

/**
 * The main conversation's state from transcript `lines` (JSONL; the first may be cut), or null
 * before its first request.
 *
 * A request starts when its trigger (the prompt or the tool result) is written, which can be
 * minutes before its first reply record, so its start is the trigger's time: up the parent chain,
 * past the attachments written beside it (never later than the first reply). Recaps and
 * compactions read the cache back too, so they restart its clock.
 */
export const readTranscript = (lines: readonly string[]): TranscriptState | null => {
  const records = parse(lines)
  const byUuid = new Map<string, TranscriptRecord>()
  for (const record of records) if (record.uuid) byUuid.set(record.uuid, record)
  const up = (record: TranscriptRecord | undefined) => (record?.parentUuid ? byUuid.get(record.parentUuid) : undefined)

  let state: TranscriptState | null = null
  let lastId: string | undefined
  let ttl: number | null = null
  let ended = false

  for (const r of records) {
    if (isRequest(r)) {
      const usage = r.message!.usage!
      const id = r.message!.id
      if (id !== lastId) {
        // A new request: it starts at its trigger.
        let trigger = up(r)
        while (trigger?.type === 'attachment') trigger = up(trigger)
        const starts = [time(trigger), time(r)].filter((t): t is number => t !== null)
        lastId = id
        if (starts.length === 0) continue
        state = {
          since: Math.min(...starts),
          ttlMs: 0,
          prompt: 0,
          model: null,
          speed: null,
          geo: null,
          compacted: false,
          ended: false,
        }
      }
      if (state === null) continue
      // Later records of a request carry its fuller usage.
      ttl = ttlOf(usage) ?? ttl
      state.ttlMs = ttl ?? FIVE_MINUTES
      state.prompt = promptOf(usage)
      state.model = r.message!.model ?? null
      state.speed = usage.speed ?? null
      state.geo = usage.inference_geo ?? null
      ended = false
    } else if (r.type === 'cost-state') {
      ended = true
    } else if (isTyped(r)) {
      ended = false
    } else if (r.type === 'system' && r.isSidechain !== true && state !== null) {
      const at = time(r)
      if (r.subtype === 'compact_boundary') {
        state.compacted = true
        // The compaction's request isn't logged, but it read the cache back: it restarts the clock.
        const took = r.compactMetadata?.durationMs
        if (at !== null && typeof took === 'number') state.since = Math.max(state.since, at - took)
      } else if (r.subtype === 'away_summary' && at !== null) {
        // A recap re-sends the conversation, reading the cache or writing it again.
        state.since = Math.max(state.since, at - RECAP_LAG)
      }
    }
  }

  if (state !== null) state.ended = ended
  return state
}
