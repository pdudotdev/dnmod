// Pure formatting, colours and bar drawing for the band and the pane; no `$` here, so tests can
// call it directly.

import type { CacheState } from '../types'
import { pricePaid, promptCost } from './prices'

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
 * `sub` dimmer), the value beside the bar, and an optional cap at the bar's far end (`end`). Both
 * bars fill toward trouble: context as it grows, the cache as it ages.
 */
export type BarModel = { fraction: number; severity: number | null; main: string; sub: string; side: string; end: string }

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
      end: '',
    }
  }
  if (f.percent === undefined || f.tokens === undefined) {
    return { fraction: 0, severity: null, main: '—', sub: window, side: '—', end: '' }
  }
  const fraction = f.percent / 100
  return { fraction, severity: contextSeverity(fraction), main: tokens(f.tokens), sub: window, side: `${f.percent}%`, end: '' }
}

/**
 * What the next message re-sends and what that costs (usdash's engine.py): `tokens` read back
 * from the cache while it's warm (`now`), or written to it again once it has expired (`upTo`, an
 * upper bound: Claude Code's tool list often stays cached). At the last request's model, speed
 * and region; `now` and `upTo` are null when its price isn't known. What the message itself adds
 * isn't known yet, so it's left out.
 */
export type Resend =
  | { kind: 'compacted' }
  | { kind: 'cost'; verb: 'next message' | 'continuing' | 'resuming'; tokens: number; now: number | null; upTo: number | null }

export const resend = (state: CacheState, now: number): Resend | null => {
  if (state.kind !== 'clock') return null
  if (state.compacted) return { kind: 'compacted' }
  const warm = now < state.since + state.ttlMs
  const verb = state.ended ? 'resuming' : warm ? 'next message' : 'continuing'
  const price = pricePaid(state.model, state.speed, state.geo)
  if (price === null) return { kind: 'cost', verb, tokens: state.prompt, now: null, upTo: null }
  return {
    kind: 'cost',
    verb,
    tokens: state.prompt,
    now: warm ? promptCost(price, state.prompt, state.prompt) : null,
    upTo: promptCost(price, state.prompt, 0, state.ttlMs),
  }
}

/** usdash's line, for the side panel and the plain-text reply. */
export const resendLine = (r: Resend | null): string | null => {
  if (r === null) return null
  if (r.kind === 'compacted') return 'compacted: the next message measures the new size'
  const head = `${r.verb} re-sends ${tokens(r.tokens)} tokens`
  if (r.upTo === null) return head
  if (r.now !== null) return `${head}: ${usd(r.now)} now · up to ${usd(r.upTo)} once the cache expires`
  return `${head}: up to ${usd(r.upTo)}`
}

/**
 * The cache bar, filling as the cache ages, with what the next message costs: its pill holds the
 * time left and the price now, and the cap at the bar's end the price once the cache runs out.
 * `demoAt` (0 to 1) runs a 1-hour cache to expiry.
 */
export const cacheModel = (state: CacheState, now: number, isWorking: boolean, demoAt: number | null): BarModel => {
  if (demoAt !== null) {
    const side = `${Math.round(demoAt * 100)}%`
    return { fraction: demoAt, severity: demoAt, main: `${mmss((1 - demoAt) * 3_600_000)} left`, sub: ' · demo', side, end: '' }
  }
  // Each request of a running turn refreshes the cache.
  if (isWorking) return { fraction: 0, severity: 0, main: 'in use', sub: '', side: '', end: '' }
  if (state.kind === 'none') return { fraction: 0, severity: null, main: 'no reply yet', sub: '', side: '', end: '' }
  if (state.kind === 'unknown') return { fraction: 0, severity: null, main: 'unknown', sub: '', side: '', end: '' }

  const r = resend(state, now)
  const age = now - state.since
  const to = state.ended ? 'resume' : 'continue'
  if (age >= state.ttlMs) {
    const cost =
      r?.kind === 'compacted' ? ' · compacted' : r?.kind === 'cost' && r.upTo !== null ? ` · up to ${usd(r.upTo)} to ${to}` : ''
    const ago = agoText(age - state.ttlMs)
    const when = ago === 'just now' ? '' : ` · ${ago}`
    return { fraction: 1, severity: 1, main: 'expired', sub: `${cost}${when}`, side: '100%', end: '' }
  }
  const fraction = Math.max(0, age) / state.ttlMs
  const side = `${Math.round(fraction * 100)}%`
  const main = `${mmss(state.ttlMs - age)} left`
  if (r?.kind === 'compacted') return { fraction, severity: fraction, main, sub: ' · compacted', side, end: '' }
  if (r?.kind !== 'cost' || r.now === null || r.upTo === null) return { fraction, severity: fraction, main, sub: '', side, end: '' }
  const sub = ` · ${usd(r.now)} ${state.ended ? 'to resume' : 'now'}`
  return { fraction, severity: fraction, main, sub, side, end: `then up to ${usd(r.upTo)}` }
}

// --- Drawing -------------------------------------------------------------------------------------

/**
 * A pill's text within `max` characters: drops `sub`'s trailing " · " parts (the least important
 * come last), then cuts what's left with an ellipsis.
 */
export const fitPill = (main: string, sub: string, max: number): { main: string; sub: string } => {
  const parts = sub.split(' · ')
  let kept = sub
  while ((main + kept).length > max && parts.length > 1) {
    parts.pop()
    kept = parts.join(' · ')
  }
  if ((main + kept).length <= max) return { main, sub: kept }
  const text = main + kept
  const cut = `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`
  return { main: cut.slice(0, main.length), sub: cut.slice(main.length) }
}

const TICKS = [0.25, 0.5, 0.75] as const

/** How many of `width` cells a fraction fills; any positive fraction shows at least one. */
export const filled = (fraction: number, width: number): number => {
  const clamped = Math.min(1, Math.max(0, fraction))
  return clamped === 0 ? 0 : Math.max(1, Math.round(clamped * width))
}

/**
 * Where a bar's pill goes, in the bar's units (cells, or SVG units): `fill` filled of `total`,
 * the pill `pill` long, an end cap `cap` long (0 for none), `gap` between neighbours.
 *
 * The pill rides inside the fill's leading edge once the fill holds it, else sits just past it.
 * It never runs into the end cap: it rests against it while the fill runs on underneath, so both
 * stay readable up to the end. The cap shows only when the bar holds both. `solid` when the pill
 * lies on the fill: drawn solid there, and as an outline past it, so only the fill reads as
 * progress.
 */
export const placePill = (
  fill: number,
  pill: number,
  total: number,
  cap: number,
  gap: number,
): { at: number; solid: boolean; cap: boolean } => {
  const hasCap = cap > 0 && total - cap - gap - pill >= 0
  const limit = hasCap ? total - cap - gap - pill : total - pill
  const rides = fill >= pill + gap
  const at = Math.max(0, Math.min(rides ? fill - pill : fill + (fill > 0 ? gap : 0), limit))
  return { at, solid: at + pill <= fill, cap: hasCap }
}

/**
 * A terminal bar `cells` wide, as segments to colour: the heavy line of the fill, a light gap,
 * the pill (`main` and `sub`; reverse video when `solid`, plain coloured text past the fill), the
 * fill's heavy line beyond a docked pill, the light line of the rest, and the end cap's text.
 * Heavy against light reads without colour too. (No tick marks: box-drawing notches join up
 * between the two rows into a grid.)
 */
export const terminalBar = (
  fraction: number,
  cells: number,
  pill: { main: string; sub: string },
  endCap = '',
): { fill: string; gap: string; main: string; sub: string; solid: boolean; heavy: string; track: string; end: string } => {
  const fitted = fitPill(pill.main, pill.sub, cells - 2)
  const main = ` ${fitted.main}`
  const sub = `${fitted.sub} `
  const length = main.length + sub.length
  const end = endCap === '' ? '' : ` ${endCap} `
  const n = filled(fraction, cells)
  const place = placePill(n, length, cells, end.length, 1)
  const stop = cells - (place.cap ? end.length : 0)
  const after = place.at + length
  const heavy = Math.max(0, Math.min(n, stop) - after)
  return {
    fill: '━'.repeat(Math.min(place.at, n)),
    gap: '─'.repeat(Math.max(0, place.at - n)),
    main,
    sub,
    solid: place.solid,
    heavy: '━'.repeat(heavy),
    track: '─'.repeat(Math.max(0, stop - after - heavy)),
    end: place.cap ? end : '',
  }
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
 * edge; notches at the quarters; the pill (see placePill: solid on the fill, outlined past it);
 * and, when there's room, an outlined cap at the far end (`end`).
 *
 * Drawn in a viewBox `width` units wide. Given no width, the desktop app draws an SVG at its own
 * width up to the room it has, scaling it down uniformly, so pass more than the room (cells × 9)
 * and the bar fills its box exactly, with nothing stretched.
 */
export const svgBar = (m: BarModel, width: number, id: string): string => {
  const W = Math.max(60, Math.round(width))
  const color = paint(m.severity, 'svg')
  const fx = Math.min(1, Math.max(0, m.fraction)) * W
  const { main, sub } = fitPill(m.main, m.sub, Math.floor((W - 24) / 7.1))
  const pillW = Math.round((main.length + sub.length) * 7.1 + 20)
  const capW = m.end === '' ? 0 : Math.round(m.end.length * 6.6 + 18)
  const place = placePill(fx, pillW, W, capW + 2, 6)
  const px = place.at
  const capX = W - capW - 2
  // Outlined pieces (the cap, and the pill past the fill) carry their own background, light or
  // dark as the app is, so they read on either theme.
  const style =
    `<style>.${id}-box{fill:#ffffff;fill-opacity:.88}.${id}-ink{fill:#3d3b37}` +
    `@media (prefers-color-scheme: dark){.${id}-box{fill:#2b2a28}.${id}-ink{fill:#e8e5df}}</style>`
  const cap = place.cap
    ? `<rect class="${id}-box" x="${capX}" y="2.5" width="${capW}" height="${HEIGHT - 5}" rx="${(HEIGHT - 5) / 2}" stroke="${SVG_TRACK}" stroke-opacity="0.55"/>` +
      `<text class="${id}-ink" x="${(capX + capW / 2).toFixed(1)}" y="${HEIGHT / 2 + 4.3}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="500" fill-opacity="0.8">${esc(m.end)}</text>`
    : ''
  const text = (attrs: string) =>
    `<text x="${(px + pillW / 2).toFixed(1)}" y="${HEIGHT / 2 + 4.5}" text-anchor="middle" font-family="${FONT}" font-size="12.5" font-weight="600" ${attrs}>${esc(main)}<tspan fill-opacity="0.72" font-weight="500">${esc(sub)}</tspan></text>`
  const pill = place.solid
    ? `<rect x="${px.toFixed(1)}" y="2" width="${pillW}" height="${HEIGHT - 4}" rx="${(HEIGHT - 4) / 2}" fill="${color}"/>` +
      text(`fill="${textOn(color)}"`)
    : `<rect class="${id}-box" x="${(px + 0.75).toFixed(1)}" y="2.75" width="${pillW - 1.5}" height="${HEIGHT - 5.5}" rx="${(HEIGHT - 5.5) / 2}" stroke="${color}" stroke-width="1.5"/>` +
      text(`class="${id}-ink"`)
  const ticks = TICKS.map(t => {
    const on = t * W < fx
    return `<rect x="${(t * W - 0.75).toFixed(1)}" y="6" width="1.5" height="${HEIGHT - 12}" rx="0.75" fill="${on ? '#ffffff' : SVG_TRACK}" fill-opacity="${on ? 0.6 : 0.45}"/>`
  }).join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${HEIGHT}" viewBox="0 0 ${W} ${HEIGHT}">` +
    style +
    `<defs>${dotTile(`${id}-dots`, color, 1)}${dotTile(`${id}-grain`, SVG_TRACK, 0.3)}` +
    `<linearGradient id="${id}-glow" x1="0" x2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.08"/><stop offset="1" stop-color="${color}" stop-opacity="0.5"/></linearGradient>` +
    `<clipPath id="${id}-track"><rect width="${W}" height="${HEIGHT}" rx="${HEIGHT / 2}"/></clipPath>` +
    `<clipPath id="${id}-fill"><rect width="${fx.toFixed(1)}" height="${HEIGHT}" rx="${HEIGHT / 2}"/></clipPath></defs>` +
    `<g clip-path="url(#${id}-track)"><rect width="${W}" height="${HEIGHT}" fill="${SVG_TRACK}" fill-opacity="0.14"/><rect width="${W}" height="${HEIGHT}" fill="url(#${id}-grain)"/></g>` +
    (fx > 0
      ? `<g clip-path="url(#${id}-fill)"><rect width="${W}" height="${HEIGHT}" fill="${color}" fill-opacity="0.2"/><rect width="${W}" height="${HEIGHT}" fill="url(#${id}-dots)"/><rect width="${fx.toFixed(1)}" height="${HEIGHT}" fill="url(#${id}-glow)"/></g>`
      : '') +
    ticks +
    cap +
    pill +
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
