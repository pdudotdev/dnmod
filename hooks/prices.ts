// What tokens cost, in USD, at Anthropic's list prices, and model ids as price keys. Ported from
// usdash (usdash/prices.py, usdash/models.py, usdash/pricing.yaml), which holds the same figures.
// Pure.

/** List prices, USD per million tokens. `cache_write` is the 5-minute write, `cache_write_1h` the 1-hour one. */
export type Price = {
  input: number
  output: number
  cache_read: number
  cache_write: number
  cache_write_1h: number
  /** Fast mode's input and output prices; the cache prices keep their ratio to input. */
  fast?: { input: number; output: number }
}

/** When the prices below were last checked against https://platform.claude.com/docs/en/about-claude/pricing. */
export const PRICES_VERIFIED = '2026-09-29'

export const PRICES: Readonly<Record<string, Price>> = {
  'claude-fable-5-1': { input: 10, output: 50, cache_read: 0.25, cache_write: 12.5, cache_write_1h: 20 },
  'claude-fable-5': { input: 10, output: 50, cache_read: 1, cache_write: 12.5, cache_write_1h: 20 },
  'claude-opus-5-5': { input: 4, output: 20, cache_read: 0.2, cache_write: 5, cache_write_1h: 8, fast: { input: 8, output: 40 } },
  'claude-opus-5': { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25, cache_write_1h: 10, fast: { input: 10, output: 50 } },
  'claude-opus-4-8': { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25, cache_write_1h: 10, fast: { input: 10, output: 50 } },
  'claude-opus-4-7': { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25, cache_write_1h: 10 },
  'claude-opus-4-6': { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25, cache_write_1h: 10 },
  'claude-opus-4-5': { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25, cache_write_1h: 10 },
  'claude-sonnet-5-5': { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5, cache_write_1h: 4 },
  'claude-sonnet-5': { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5, cache_write_1h: 4 },
  'claude-sonnet-4-6': { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75, cache_write_1h: 6 },
  'claude-sonnet-4-5': { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75, cache_write_1h: 6 },
  'claude-haiku-4-5': { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25, cache_write_1h: 2 },
}

const ONE_HOUR_MS = 3_600_000
const FIVE_MINUTES_MS = 300_000
// US-only inference (`inference_geo: "us"`) costs 1.1x on Claude 4.6 and later (the pricing page's Data residency).
const US_ONLY = 1.1
const US_ONLY_FROM: readonly [number, number] = [4, 6]

/**
 * Any spelling of a Claude model id -> its family, e.g. anthropic/claude-opus-5-5[1m],
 * claude-haiku-4-5-20251001, us.anthropic.claude-haiku-4-5-20251001-v1:0 and
 * claude-haiku-4-5@20251001 -> claude-opus-5-5 / claude-haiku-4-5.
 */
export const modelKey = (model: string | null | undefined): string | null => {
  if (!model) return null
  let name = (model.toLowerCase().split('/').pop() ?? '').replace('[1m]', '')
  name = name.replace(/^(?:[a-z-]+\.)?anthropic\./, '') // Bedrock: us.anthropic.claude-...
  name = name.replace(/-v\d+(?::\d+)?$/, '') // Bedrock: ...-v1:0
  name = name.replace(/@\d{8}$/, '') // Vertex: ...@20251001
  return name.replace(/-\d{8}$/, '') // dated snapshot: ...-20251001
}

/** A family key's version: claude-opus-4-6 -> [4, 6], claude-opus-5 -> [5, 0]; null if it has none. */
export const modelVersion = (family: string | null): [number, number] | null => {
  const match = /^claude-(?:[a-z]+-)?(\d+)(?:-(\d{1,2}))?(?:-[a-z]+)?$/.exec(family ?? '')
  return match ? [Number(match[1]), Number(match[2] ?? 0)] : null
}

/**
 * `model`'s price as a request paid it: fast mode's input and output prices if it ran fast (the
 * cache prices keep their ratio to input), and x1.1 for US-only inference on Claude 4.6 and later.
 * Null when the model's price isn't known, or it ran fast and its fast prices aren't: better no
 * amount than half of one.
 */
export const pricePaid = (model: string | null, speed: string | null, geo: string | null): Price | null => {
  const family = modelKey(model)
  const base = family === null ? undefined : PRICES[family]
  if (base === undefined) return null
  const paid: Price = { ...base }
  if (speed === 'fast') {
    if (!base.fast) return null
    const scale = base.fast.input / base.input
    paid.input = base.input * scale
    paid.cache_write = base.cache_write * scale
    paid.cache_write_1h = base.cache_write_1h * scale
    paid.cache_read = base.cache_read * scale
    paid.output = base.fast.output
  }
  const version = modelVersion(family)
  const isUsOnly =
    geo === 'us' &&
    version !== null &&
    (version[0] > US_ONLY_FROM[0] || (version[0] === US_ONLY_FROM[0] && version[1] >= US_ONLY_FROM[1]))
  if (isUsOnly) {
    paid.input *= US_ONLY
    paid.output *= US_ONLY
    paid.cache_read *= US_ONLY
    paid.cache_write *= US_ONLY
    paid.cache_write_1h *= US_ONLY
  }
  return paid
}

/** Per million tokens written to the cache with this lifetime. */
export const writePrice = (price: Price, ttlMs: number): number =>
  ttlMs >= ONE_HOUR_MS ? price.cache_write_1h : price.cache_write

/**
 * The input side of one request: `cached` tokens read back from the cache, the rest written to it
 * (Claude Code marks its prompts for caching).
 */
export const promptCost = (price: Price, tokens: number, cached: number, ttlMs: number = FIVE_MINUTES_MS): number => {
  const read = Math.min(Math.max(cached, 0), tokens)
  return (read * price.cache_read + (tokens - read) * writePrice(price, ttlMs)) / 1_000_000
}
