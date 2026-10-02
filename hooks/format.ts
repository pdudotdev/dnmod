// Pure formatting, colours and bar drawing for the band and the pane; no `$` here, so tests can
// call it directly.

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

/** `4m ago`, `2h 5m ago`: how long ago, for an expired cache. */
export const agoText = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`
}

// --- Colours -------------------------------------------------------------------------------------

/** Where a colour is drawn: a terminal's text, or an SVG (the desktop app). */
export type Paint = 'terminal' | 'svg'

/**
 * Green to red. The terminal gets 256-colour codes, which every terminal shows (24-bit colour
 * isn't safe: Apple's Terminal drops it, and the renderer sends it whenever COLORTERM says
 * truecolor). SVG gets brighter hex colours, blended smoothly.
 */
const ANSI_STEPS = [71, 107, 143, 179, 173, 167] as const
const ANSI_TRACK = 242
const SVG_STOPS: readonly (readonly [number, string])[] = [
  [0, '#3fb950'],
  [0.35, '#9fc243'],
  [0.55, '#e3b341'],
  [0.78, '#f0883e'],
  [1, '#f85149'],
]
const SVG_TRACK = '#8b8b8b'

const channels = (hex: string): [number, number, number] =>
  [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

const mix = (from: string, to: string, t: number): string => {
  const a = channels(from)
  const b = channels(to)
  return `#${a.map((v, i) => Math.round(v + (b[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`
}

/** The colour for `severity`, 0 (fine, green) to 1 (bad, red); null is the grey of an empty track. */
export const paint = (severity: number | null, on: Paint): string => {
  if (severity === null) return on === 'terminal' ? `ansi256(${ANSI_TRACK})` : SVG_TRACK
  const s = Math.min(1, Math.max(0, severity))
  if (on === 'terminal') return `ansi256(${ANSI_STEPS[Math.round(s * (ANSI_STEPS.length - 1))]})`
  for (let i = 1; i < SVG_STOPS.length; i++) {
    const [at, color] = SVG_STOPS[i]!
    const [prevAt, prevColor] = SVG_STOPS[i - 1]!
    if (s <= at) return mix(prevColor, color, (s - prevAt) / (at - prevAt))
  }
  return SVG_STOPS[SVG_STOPS.length - 1]![1]
}

/** Dark text on a light pill, white on a dark one. */
export const textOn = (hex: string): string => {
  const [r, g, b] = channels(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.64 ? '#1f1e1d' : '#ffffff'
}

/** Context fill as severity: fine to half full, then rising to red when full. */
export const contextSeverity = (fraction: number): number => Math.max(0, (fraction - 0.5) / 0.5)

// --- What a bar shows ----------------------------------------------------------------------------

/**
 * One bar: how full, how bad (0 to 1; null for grey), the pill at the fill's edge (`main` bright,
 * `sub` dimmer) and the value beside the bar. Both bars fill toward trouble: context as it grows,
 * the cache as it ages.
 */
export type BarModel = { fraction: number; severity: number | null; main: string; sub: string; side: string }

/** The context bar; `demoAt` (0 to 1) sweeps it from empty to full. */
export const contextModel = (f: Figures, demoAt: number | null): BarModel => {
  const window = ` / ${tokens(f.window)}`
  if (demoAt !== null) {
    return {
      fraction: demoAt,
      severity: contextSeverity(demoAt),
      main: tokens(Math.round(demoAt * f.window)),
      sub: `${window} · demo`,
      side: `${Math.round(demoAt * 100)}%`,
    }
  }
  if (f.percent === undefined || f.tokens === undefined) {
    return { fraction: 0, severity: null, main: '—', sub: window, side: '—' }
  }
  const fraction = f.percent / 100
  return { fraction, severity: contextSeverity(fraction), main: tokens(f.tokens), sub: window, side: `${f.percent}%` }
}

/** The cache bar, filling as the cache ages; `demoAt` (0 to 1) runs a 1-hour cache to expiry. */
export const cacheModel = (state: CacheState, now: number, isWorking: boolean, demoAt: number | null): BarModel => {
  if (demoAt !== null) {
    const side = `${Math.round(demoAt * 100)}%`
    return { fraction: demoAt, severity: demoAt, main: mmss((1 - demoAt) * 3_600_000), sub: ' left · demo', side }
  }
  // Each request of a running turn refreshes the cache.
  if (isWorking) return { fraction: 0, severity: 0, main: 'in use', sub: '', side: '' }
  if (state.kind === 'none') return { fraction: 0, severity: null, main: 'no reply yet', sub: '', side: '' }
  if (state.kind === 'unknown') return { fraction: 0, severity: null, main: 'unknown', sub: '', side: '' }
  const age = now - state.since
  if (age >= state.ttlMs) {
    return { fraction: 1, severity: 1, main: 'expired', sub: ` ${agoText(age - state.ttlMs)}`, side: '100%' }
  }
  const fraction = Math.max(0, age) / state.ttlMs
  return { fraction, severity: fraction, main: mmss(state.ttlMs - age), sub: ' left', side: `${Math.round(fraction * 100)}%` }
}

// --- Drawing -------------------------------------------------------------------------------------

const TICKS = [0.25, 0.5, 0.75] as const

/** How many of `width` cells a fraction fills; any positive fraction shows at least one. */
export const filled = (fraction: number, width: number): number => {
  const clamped = Math.min(1, Math.max(0, fraction))
  return clamped === 0 ? 0 : Math.max(1, Math.round(clamped * width))
}

/**
 * A terminal bar `cells` wide: a heavy line for the fill, the pill in reverse video at its leading
 * edge (inside the fill, or just past it when the fill is short), and a light line for the rest.
 * Heavy against light reads without colour too. (No tick marks: box-drawing notches join up
 * between the two rows into a grid.)
 */
export const terminalBar = (fraction: number, cells: number, pill: string): { fill: string; pill: string; track: string } => {
  const label = ` ${pill} `.slice(0, cells)
  const n = filled(fraction, cells)
  const start = Math.min(cells - label.length, n >= label.length ? n - label.length : n)
  const end = start + label.length
  return { fill: '━'.repeat(start), pill: label, track: '━'.repeat(Math.max(0, n - end)) + '─'.repeat(cells - Math.max(n, end)) }
}

/** A plain-text bar for the chat reply (VS Code), where nothing is coloured. */
export const textBar = (fraction: number, width: number): string => {
  const n = filled(fraction, width)
  return '━'.repeat(n) + '─'.repeat(width - n)
}

const esc = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`
const HEIGHT = 24

// The fill's dot matrix: a 24x12 tile of 2x2 dots on a 3px grid, at fixed pseudo-random strengths.
const DOTS = ((): number[] => {
  let x = 7
  return Array.from({ length: 32 }, () => {
    x = (x * 1103515245 + 12345) % 2147483648
    const r = x / 2147483648
    return r > 0.9 ? 1 : 0.15 + r * 0.6
  })
})()

const dotTile = (id: string, color: string, strength: number): string =>
  `<pattern id="${id}" width="24" height="12" patternUnits="userSpaceOnUse">` +
  DOTS.map(
    (o, i) =>
      `<rect x="${(i % 8) * 3}" y="${Math.floor(i / 8) * 3}" width="2" height="2" fill="${color}" fill-opacity="${(o * strength).toFixed(2)}"/>`,
  ).join('') +
  '</pattern>'

/**
 * The desktop bar: a rounded, faintly grained track; a dot-matrix fill that brightens toward its
 * edge; notches at the quarters; and the pill riding the fill's leading edge.
 *
 * Drawn in a viewBox `width` units wide. Given no width, the desktop app draws an SVG at its own
 * width up to the room it has, scaling it down uniformly, so pass more than the room (cells × 9)
 * and the bar fills its box exactly, with nothing stretched.
 */
export const svgBar = (m: BarModel, width: number, id: string): string => {
  const W = Math.max(60, Math.round(width))
  const color = paint(m.severity, 'svg')
  const fx = Math.min(1, Math.max(0, m.fraction)) * W
  const pillW = Math.round((m.main.length + m.sub.length) * 7.1 + 20)
  const px = Math.max(0, Math.min(W - pillW, m.fraction >= 0.15 ? fx - pillW : fx + 4))
  const ink = textOn(color)
  const ticks = TICKS.map(t => {
    const on = t * W < fx
    return `<rect x="${(t * W - 0.75).toFixed(1)}" y="6" width="1.5" height="${HEIGHT - 12}" rx="0.75" fill="${on ? '#ffffff' : SVG_TRACK}" fill-opacity="${on ? 0.6 : 0.45}"/>`
  }).join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${HEIGHT}" viewBox="0 0 ${W} ${HEIGHT}">` +
    `<defs>${dotTile(`${id}-dots`, color, 1)}${dotTile(`${id}-grain`, SVG_TRACK, 0.3)}` +
    `<linearGradient id="${id}-glow" x1="0" x2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.08"/><stop offset="1" stop-color="${color}" stop-opacity="0.5"/></linearGradient>` +
    `<clipPath id="${id}-track"><rect width="${W}" height="${HEIGHT}" rx="${HEIGHT / 2}"/></clipPath>` +
    `<clipPath id="${id}-fill"><rect width="${fx.toFixed(1)}" height="${HEIGHT}" rx="${HEIGHT / 2}"/></clipPath></defs>` +
    `<g clip-path="url(#${id}-track)"><rect width="${W}" height="${HEIGHT}" fill="${SVG_TRACK}" fill-opacity="0.14"/><rect width="${W}" height="${HEIGHT}" fill="url(#${id}-grain)"/></g>` +
    (fx > 0
      ? `<g clip-path="url(#${id}-fill)"><rect width="${W}" height="${HEIGHT}" fill="${color}" fill-opacity="0.2"/><rect width="${W}" height="${HEIGHT}" fill="url(#${id}-dots)"/><rect width="${fx.toFixed(1)}" height="${HEIGHT}" fill="url(#${id}-glow)"/></g>`
      : '') +
    ticks +
    `<rect x="${px.toFixed(1)}" y="2" width="${pillW}" height="${HEIGHT - 4}" rx="${(HEIGHT - 4) / 2}" fill="${color}"/>` +
    `<text x="${(px + pillW / 2).toFixed(1)}" y="${HEIGHT / 2 + 4.5}" text-anchor="middle" font-family="${FONT}" font-size="12.5" font-weight="600" fill="${ink}">${esc(m.main)}<tspan fill-opacity="0.72" font-weight="500">${esc(m.sub)}</tspan></text>` +
    `</svg>`
  )
}

// --- Layout --------------------------------------------------------------------------------------

/** Column widths, in cells, for a row of `columns`: label, bar, the value beside it, and the extra. */
export const rowLayout = (columns: number, extra: number): { label: number; bar: number; side: number; extra: number } => {
  const label = 10
  const side = 5
  const gaps = extra > 0 ? 3 : 2
  return { label, bar: Math.max(10, columns - label - side - extra - gaps), side, extra }
}
