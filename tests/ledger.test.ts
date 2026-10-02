import { expect, test } from 'claude-code/testing'

import type { Ledger } from '../hooks/ledger'
import { addLines, costByDay, dayKey, parseOffset } from '../hooks/ledger'
import { requestCost, PRICES } from '../hooks/prices'
import { spendFigures } from '../hooks/format'

const reply = (id: string, time: string, usage: object, model = 'claude-opus-5-5') =>
  JSON.stringify({ type: 'assistant', timestamp: time, message: { id, model, usage } })

const usage = { input_tokens: 10, cache_read_input_tokens: 1_000_000, output_tokens: 1_000, cache_creation: {} }
// Opus 5.5: 10 x $4 + 1M x $0.20 + 1k x $20, per million = $0.22004
const COST = 0.22004

test('requestCost: tokens at their prices, plus web searches', () => {
  const opus = PRICES['claude-opus-5-5']!
  expect(Math.abs(requestCost(usage, opus) - COST) < 1e-12).toBe(true)
  const searched = { ...usage, server_tool_use: { web_search_requests: 2 } }
  expect(Math.abs(requestCost(searched, opus) - (COST + 0.02)) < 1e-12).toBe(true)
})

test('a request counts once, at its last record, on the local day that record was written', () => {
  const ledger: Ledger = new Map()
  addLines(ledger, [
    reply('m1', '2026-10-01T20:59:00.000Z', { ...usage, output_tokens: 10 }),
    reply('m1', '2026-10-01T21:01:00.000Z', usage), // 00:01 on Oct 2 at +03:00
    '{"half a line',
    JSON.stringify({ type: 'assistant', isApiErrorMessage: true, timestamp: '2026-10-02T08:00:00.000Z', message: { id: 'e', model: 'claude-opus-5-5', usage } }),
    reply('s1', '2026-10-02T08:00:00.000Z', usage, '<synthetic>'),
  ])
  addLines(ledger, [reply('m1', '2026-10-01T21:01:00.000Z', usage)]) // read again: no change
  const { days, unpriced } = costByDay(ledger, 180)
  expect(Object.keys(days)).toEqual(['2026-10-02'])
  expect(Math.abs(days['2026-10-02']! - COST) < 1e-12).toBe(true)
  expect(unpriced).toBe(0)
  expect(Object.keys(costByDay(ledger, 0).days)).toEqual(['2026-10-01'])
})

test('a model with no known price is counted apart', () => {
  const ledger: Ledger = new Map()
  addLines(ledger, [reply('m1', '2026-10-02T08:00:00.000Z', usage, 'claude-unknown-9')])
  expect(costByDay(ledger, 0)).toEqual({ days: {}, unpriced: 1 })
})

test('dayKey and parseOffset', () => {
  expect(dayKey(Date.parse('2026-10-01T22:30:00Z'), 180)).toBe('2026-10-02')
  expect(dayKey(Date.parse('2026-10-02T02:00:00Z'), -330)).toBe('2026-10-01')
  expect(parseOffset('+0300\n')).toBe(180)
  expect(parseOffset('-0530')).toBe(-330)
  expect(parseOffset('UTC')).toBeNull()
})

test("the total is Claude Code's, unless the transcripts already show more", () => {
  const spend = { days: { '2026-10-02': 1.5, '2026-10-01': 0.5 }, all: 2, unpriced: 0, offsetMinutes: 0 }
  const now = Date.parse('2026-10-02T12:00:00Z')
  expect(spendFigures(spend, 2.4, now)).toEqual({ today: 1.5, total: 2.4 })
  expect(spendFigures(spend, 0.3, now)).toEqual({ today: 1.5, total: 2 })
  expect(spendFigures(null, 0.3, now)).toEqual({ today: null, total: 0.3 })
  expect(spendFigures(null, undefined, now)).toEqual({ today: null, total: null })
})
