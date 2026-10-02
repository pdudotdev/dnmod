// Pure formatting and colours for the band and the pane; no `$` here, so tests can call it directly.

import type { CacheState } from '../types'

export type Figures = {
  percent?: number
  tokens?: number
  window: number
  usd?: number
}

export const usd = (value: number | undefined): string => {
  if (value === undefined) return '—'
  return value < 10 ? `$${value.toFixed(2)}` : `$${value.toFixed(1)}`
}

export const tokens = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}

/** `45%` and `90k of 200k`, or dashes before any response has reported the fill. */
export const contextParts = (f: Figures): { percent: string; amount: string } =>
  f.percent === undefined || f.tokens === undefined
    ? { percent: '—', amount: `— of ${tokens(f.window)}` }
    : { percent: `${f.percent}%`, amount: `${tokens(f.tokens)} of ${tokens(f.window)}` }

export const days30Line = (): string => '30d · not computed yet'

/** Claude Code's folder name for a project directory: every non-alphanumeric character becomes '-'. */
export const projectFolder = (dir: string): string => dir.replace(/[^a-zA-Z0-9]/g, '-')

/** `47:12` for time left, minutes past 60 included (`60:00` for a fresh 1-hour cache). */
export const mmss = (ms: number): string => {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** `ttl` as `1h` or `5m`. */
export const ttlText = (ms: number): string => (ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : `${Math.round(ms / 60_000)}m`)

/** How many of `width` cells a fraction fills; any positive fraction shows at least one. */
export const filled = (fraction: number, width: number): number => {
  const clamped = Math.min(1, Math.max(0, fraction))
  return clamped === 0 ? 0 : Math.max(1, Math.round(clamped * width))
}

export const FULL = '▰'
export const EMPTY = '▱'

/** A text bar, for surfaces that draw no SVG and for the plain-text reply. */
export const textBar = (fraction: number, width: number): string => {
  const n = filled(fraction, width)
  return FULL.repeat(n) + EMPTY.repeat(width - n)
}

/**
 * The bars' colours, green to red, as 256-colour codes for the terminal and the same colours
 * in hex for SVG. 256-colour codes show in every terminal; 24-bit colour doesn't (Apple's
 * Terminal drops it, and the renderer sends it whenever COLORTERM says truecolor).
 */
const STEPS = [
  { ansi: 71, hex: '#5faf5f' },
  { ansi: 107, hex: '#87af5f' },
  { ansi: 143, hex: '#afaf5f' },
  { ansi: 179, hex: '#d7af5f' },
  { ansi: 173, hex: '#d7875f' },
  { ansi: 167, hex: '#d75f5f' },
] as const
const TRACK = { ansi: 242, hex: '#6c6c6c' } as const

/** Where the colour is drawn: a terminal's text, or an SVG (the desktop app). */
export type Paint = 'terminal' | 'svg'

const channels = (hex: string): [number, number, number] =>
  [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

const mix = (from: string, to: string, t: number): string => {
  const a = channels(from)
  const b = channels(to)
  return `#${a.map((v, i) => Math.round(v + (b[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`
}

/**
 * The colour for `severity` (0 fine, green, to 1 bad, red), or the grey of an empty track for
 * null. The terminal steps through the six codes; SVG blends smoothly between them.
 */
export const paint = (severity: number | null, on: Paint): string => {
  if (severity === null) return on === 'terminal' ? `ansi256(${TRACK.ansi})` : TRACK.hex
  const t = Math.min(1, Math.max(0, severity)) * (STEPS.length - 1)
  if (on === 'terminal') return `ansi256(${STEPS[Math.round(t)]!.ansi})`
  const below = Math.floor(t)
  if (below >= STEPS.length - 1) return STEPS[STEPS.length - 1]!.hex
  return mix(STEPS[below]!.hex, STEPS[below + 1]!.hex, t - below)
}

/** Context fill as severity: fine to half full, then rising to red when full. */
export const contextSeverity = (fraction: number): number => Math.max(0, (fraction - 0.5) / 0.5)

/** A rounded SVG bar for surfaces that draw SVG (the desktop app). */
export const svgBar = (fraction: number, width: number, color: string): string => {
  const height = 8
  const fill = Math.round(Math.min(1, Math.max(0, fraction)) * width)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" rx="${height / 2}" fill="${TRACK.hex}" fill-opacity="0.35"/>` +
    (fill > 0 ? `<rect width="${Math.max(fill, height)}" height="${height}" rx="${height / 2}" fill="${color}"/>` : '') +
    `</svg>`
  )
}

/** `4m`, `2h 5m`: how long ago, for an expired cache. */
export const agoText = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`
}

/**
 * What one bar shows: how full, how bad (0 to 1, null for an empty grey track), its value and a
 * dim note after it. Both bars fill toward trouble: context as it grows, the cache as it ages.
 */
export type BarModel = { fraction: number; severity: number | null; value: string; note: string }

/** The context bar; `demoAt` (0 to 1) sweeps it from empty to full. */
export const contextModel = (f: Figures, demoAt: number | null): BarModel => {
  if (demoAt !== null) {
    return { fraction: demoAt, severity: contextSeverity(demoAt), value: `${Math.round(demoAt * 100)}%`, note: 'demo' }
  }
  const { percent, amount } = contextParts(f)
  if (f.percent === undefined) return { fraction: 0, severity: null, value: percent, note: amount }
  const fraction = f.percent / 100
  return { fraction, severity: contextSeverity(fraction), value: percent, note: amount }
}

/** The cache bar, filling as the cache ages; `demoAt` (0 to 1) runs a 1-hour cache to expiry. */
export const cacheModel = (state: CacheState, now: number, isWorking: boolean, demoAt: number | null): BarModel => {
  if (demoAt !== null) {
    return { fraction: demoAt, severity: demoAt, value: `expires in ${mmss((1 - demoAt) * 3_600_000)}`, note: 'demo' }
  }
  // Each request of a running turn refreshes the cache.
  if (isWorking) return { fraction: 0, severity: 0, value: 'in use', note: '' }
  if (state.kind === 'none') return { fraction: 0, severity: null, value: 'no reply yet', note: '' }
  if (state.kind === 'unknown') return { fraction: 0, severity: null, value: 'unknown', note: state.reason }
  const age = now - state.since
  if (age >= state.ttlMs) return { fraction: 1, severity: 1, value: 'expired', note: agoText(age - state.ttlMs) }
  const fraction = Math.max(0, age) / state.ttlMs
  return { fraction, severity: fraction, value: `expires in ${mmss(state.ttlMs - age)}`, note: '' }
}
