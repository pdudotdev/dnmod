import { expect, test } from 'claude-code/testing'

import { missesModel, statsLines, terminalChart } from '../hooks/format'
import { mergeStats, summarizeFile } from '../hooks/stats'

const H = 3_600_000
const t0 = Date.parse('2026-10-02T06:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()
const line = (record: object) => JSON.stringify(record)
const opus = 'claude-opus-5-5'
const near = (a: number | null | undefined, b: number) => expect(a !== null && a !== undefined && Math.abs(a - b) < 1e-9).toBe(true)

// Two requests two hours apart on a 1-hour cache: the second writes again all it could have read.
const expired = [
  line({ type: 'user', uuid: 'u1', parentUuid: null, timestamp: iso(t0), message: { content: 'hi' } }),
  line({
    type: 'assistant',
    uuid: 'r1',
    parentUuid: 'u1',
    timestamp: iso(t0 + 2_000),
    message: { id: 'm1', model: opus, usage: { input_tokens: 0, cache_creation_input_tokens: 100_000, cache_creation: { ephemeral_1h_input_tokens: 100_000 }, output_tokens: 0 } },
  }),
  line({ type: 'user', uuid: 'u2', parentUuid: 'r1', timestamp: iso(t0 + 2 * H), message: { content: 'back' } }),
  line({
    type: 'assistant',
    uuid: 'r2',
    parentUuid: 'u2',
    timestamp: iso(t0 + 2 * H + 3_000),
    message: { id: 'm2', model: opus, usage: { input_tokens: 0, cache_creation_input_tokens: 101_000, cache_creation: { ephemeral_1h_input_tokens: 101_000 }, output_tokens: 0 } },
  }),
]

test('a file is summed by hour, and a request after the cache expired is a miss with its extra cost', () => {
  const summary = summarizeFile(expired, false)
  expect(summary.first).toBe(t0)
  const second = summary.hours[String(Math.floor((t0 + 2 * H) / H))]!
  // 100k it could have read back, written again at $8 instead of read at $0.20 per million
  near(second.misses, 0.78)
  expect(Object.keys(second.causes)).toEqual(['cache expired'])
  near(second.spend, 101_000 * 8 / 1e6)
  expect(second.requests).toBe(1)
  expect(summary.hours[String(Math.floor(t0 / H))]!.misses).toBe(0)
})

test('the same requests in a subagent file count the same, without the tool-list rule', () => {
  expect(Object.keys(summarizeFile(expired, true).hours)).toHaveLength(2)
})

test('mergeStats: the period to the hour, per day over the days covered, cached share, misses, top model', () => {
  const summary = summarizeFile(expired, false)
  const now = t0 + 3 * H
  const stats = mergeStats([summary], now, 30 * 86_400_000, 0)
  near(stats.spend, (100_000 + 101_000) * 8 / 1e6)
  expect(stats.requests).toBe(2)
  near(stats.misses, 0.78)
  expect(stats.topCause).toBe('cache expired')
  expect(stats.topModel).toEqual({ name: 'Opus 5.5', share: 1 })
  expect(stats.cached).toBe(0)
  // History begins today: the data covers from midnight, under a day, so no per-day figure.
  expect(stats.coveredFrom).toBe(Date.parse('2026-10-02T00:00:00.000Z'))
  expect(stats.perDay).toBeNull()
  expect(stats.days).toHaveLength(30)
  near(stats.days[29], stats.spend)
  // Outside the period: nothing.
  expect(mergeStats([summary], now + 40 * 86_400_000, 30 * 86_400_000, 0).requests).toBe(0)
})

test('the misses bar, the chart and the lines', () => {
  const stats = mergeStats([summarizeFile(expired, false)], t0 + 3 * H, 30 * 86_400_000, 0)
  const misses = missesModel(stats)
  expect(misses.main).toBe('$0.78')
  expect(misses.sub).toBe(' added by cache misses · mostly cache expired')
  expect(misses.side).toBe('49%')
  expect(misses.severity).toBe(1)
  expect(terminalChart([0, 1, 2], 6)).toBe('··▅▅██')
  expect(statsLines(stats)[0]).toBe('spend $1.61 · 2 requests (transcripts begin 2026-10-02)')
  expect(statsLines({ ...stats, requests: 0 })).toEqual(['no requests in the last 30 days'])
})
