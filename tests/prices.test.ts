import { expect, test } from 'claude-code/testing'

import { modelKey, modelVersion, pricePaid, promptCost, PRICES } from '../hooks/prices'

/** Equal to within float rounding (the kit has no toBeCloseTo). */
const near = (actual: number | undefined, expected: number) =>
  expect(actual !== undefined && Math.abs(actual - expected) < 1e-9).toBe(true)

test('modelKey turns any spelling of a model id into its family', () => {
  expect(modelKey('anthropic/claude-opus-5-5[1m]')).toBe('claude-opus-5-5')
  expect(modelKey('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5')
  expect(modelKey('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('claude-haiku-4-5')
  expect(modelKey('claude-haiku-4-5@20251001')).toBe('claude-haiku-4-5')
  expect(modelKey(null)).toBeNull()
})

test('modelVersion', () => {
  expect(modelVersion('claude-opus-4-6')).toEqual([4, 6])
  expect(modelVersion('claude-opus-5')).toEqual([5, 0])
  expect(modelVersion('claude-3-5-haiku')).toEqual([3, 5])
  expect(modelVersion('gpt-4')).toBeNull()
})

test('pricePaid: list prices, fast mode, and US-only inference from Claude 4.6 on', () => {
  expect(pricePaid('claude-opus-5-5', 'standard', 'not_available')).toEqual(PRICES['claude-opus-5-5'])
  const fast = pricePaid('claude-opus-5-5', 'fast', null)
  expect(fast).toEqual({ ...PRICES['claude-opus-5-5']!, input: 8, output: 40, cache_read: 0.4, cache_write: 10, cache_write_1h: 16 })
  near(pricePaid('claude-opus-5-5', null, 'us')?.cache_write_1h, 8.8)
  expect(pricePaid('claude-opus-4-5', null, 'us')?.cache_write_1h).toBe(10)
  expect(pricePaid('claude-opus-4-7', 'fast', null)).toBeNull()
  expect(pricePaid('claude-unknown-9', null, null)).toBeNull()
})

test('promptCost: read back now, or written again with its TTL', () => {
  const opus = PRICES['claude-opus-5-5']!
  // usdash's figures: "next message re-sends 34k tokens: $0.01 now · up to $0.27", "resuming … 55k tokens: up to $0.44"
  near(promptCost(opus, 34_000, 34_000), 0.0068)
  near(promptCost(opus, 34_000, 0, 3_600_000), 0.272)
  near(promptCost(opus, 55_000, 0, 3_600_000), 0.44)
  near(promptCost(opus, 55_000, 0, 300_000), 0.275)
})
