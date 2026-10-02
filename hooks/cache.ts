// The main conversation's prompt-cache clock, read from the end of a session transcript. Pure.

const HOUR = 3_600_000
const FIVE_MINUTES = 300_000

/** When the last main-thread request started (ms since the epoch), and how long its cache lives. */
export type CacheClock = { since: number; ttlMs: number }

type CacheCreation = { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number }

type TranscriptRecord = {
  type?: string
  uuid?: string
  parentUuid?: string | null
  isSidechain?: boolean
  timestamp?: string
  message?: { id?: string; usage?: { cache_creation?: CacheCreation } }
}

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

/** The TTL of the last cache write: a cache hit keeps the entry's TTL. Mixed writes count as the shorter. */
const ttlOf = (replies: readonly TranscriptRecord[]): number => {
  for (let i = replies.length - 1; i >= 0; i--) {
    const written = replies[i]!.message?.usage?.cache_creation
    if ((written?.ephemeral_5m_input_tokens ?? 0) > 0) return FIVE_MINUTES
    if ((written?.ephemeral_1h_input_tokens ?? 0) > 0) return HOUR
  }
  return FIVE_MINUTES
}

/**
 * The cache clock of the last main-thread request in `lines`, or null when there is none.
 *
 * A request starts when its trigger (the prompt or the tool result) is written, which can be
 * minutes before its first reply record, so the clock runs from the trigger: up the parent chain,
 * past the attachments written beside it. Without the trigger in `lines`, the first reply's time.
 */
export const cacheClock = (lines: readonly string[]): CacheClock | null => {
  const records = parse(lines)
  const byUuid = new Map<string, TranscriptRecord>()
  for (const record of records) if (record.uuid) byUuid.set(record.uuid, record)

  const replies = records.filter(r => r.type === 'assistant' && r.isSidechain !== true && r.message?.id)
  const last = replies[replies.length - 1]
  if (!last) return null
  const first = replies.find(r => r.message?.id === last.message?.id) ?? last

  const up = (record: TranscriptRecord | undefined) => (record?.parentUuid ? byUuid.get(record.parentUuid) : undefined)
  let trigger = up(first)
  while (trigger?.type === 'attachment') trigger = up(trigger)

  // A request can't start after its first reply was written.
  const times = [trigger?.timestamp, first.timestamp].map(t => Date.parse(t ?? '')).filter(t => !Number.isNaN(t))
  if (times.length === 0) return null

  return { since: Math.min(...times), ttlMs: ttlOf(replies) }
}
