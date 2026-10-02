// What a session's requests cost, by local day, from its transcripts (the main one and its
// subagents'), fed a few lines at a time as the files grow. The same accounting as usdash's
// Store._account and day_of. Pure.

import type { Usage } from './prices'
import { pricePaid, requestCost } from './prices'

/** Each request once, by its message id: when its last record was written, and its cost (null: no known price). */
export type Ledger = Map<string, { end: number; cost: number | null }>

type TranscriptRecord = {
  type?: string
  uuid?: string
  requestId?: string
  isApiErrorMessage?: boolean
  timestamp?: string
  message?: { id?: string; model?: string; usage?: Usage }
}

/**
 * Adds complete JSONL lines to `ledger`. A request's records share a message id; the latest
 * carries its fuller usage, so it replaces the earlier ones. Errors and synthetic messages aren't
 * requests. Adding the same lines twice changes nothing.
 */
export const addLines = (ledger: Ledger, lines: readonly string[]): void => {
  for (const line of lines) {
    if (line.trim() === '') continue
    let record: TranscriptRecord
    try {
      record = JSON.parse(line) as TranscriptRecord
    } catch {
      continue
    }
    const message = record.message
    const model = message?.model
    const usage = message?.usage
    if (record.type !== 'assistant' || record.isApiErrorMessage === true) continue
    if (!model || model === '<synthetic>' || typeof usage !== 'object' || usage === null) continue
    const key = message?.id ?? record.requestId ?? record.uuid
    if (!key) continue
    const end = Date.parse(record.timestamp ?? '')
    const price = pricePaid(model, usage.speed ?? null, usage.inference_geo ?? null)
    ledger.set(key, {
      end: Number.isNaN(end) ? (ledger.get(key)?.end ?? 0) : end,
      cost: price === null ? null : requestCost(usage, price),
    })
  }
}

/** The local date of `ms` in a time zone `offsetMinutes` east of UTC, e.g. "2026-10-02". */
export const dayKey = (ms: number, offsetMinutes: number): string =>
  new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10)

/** "+0300" -> 180, "-0530" -> -330 (what `date +%z` prints); null if it doesn't parse. */
export const parseOffset = (text: string): number | null => {
  const match = /^([+-])(\d{2})(\d{2})$/.exec(text.trim())
  if (!match) return null
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}

/** Cost per local day (a request counts on the day its last record was written), and the requests with no known price. */
export const costByDay = (ledger: Ledger, offsetMinutes: number): { days: Record<string, number>; unpriced: number } => {
  const days: Record<string, number> = {}
  let unpriced = 0
  for (const { end, cost } of ledger.values()) {
    if (cost === null) {
      unpriced += 1
      continue
    }
    const day = dayKey(end, offsetMinutes)
    days[day] = (days[day] ?? 0) + cost
  }
  return { days, unpriced }
}
