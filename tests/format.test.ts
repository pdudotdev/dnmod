import { expect, test } from 'claude-code/testing'

import type { CacheState } from '../types'
import {
  agoText,
  cacheModel,
  contextModel,
  contextSeverity,
  fitPill,
  mmss,
  paint,
  resend,
  resendLine,
  rowLayout,
  svgBar,
  terminalBar,
  textBar,
  textOn,
  tokens,
} from '../hooks/format'

test('mmss counts minutes past 60 and rounds seconds up', () => {
  expect(mmss(3_600_000)).toBe('60:00')
  expect(mmss(2_832_000)).toBe('47:12')
  expect(mmss(1_500)).toBe('0:02')
  expect(mmss(-5)).toBe('0:00')
})

test('tokens drops a trailing .0', () => {
  expect(tokens(1_000_000)).toBe('1M')
  expect(tokens(1_500_000)).toBe('1.5M')
  expect(tokens(389_400)).toBe('389k')
})

test('the terminal gets 256-colour codes, green to red, and grey for an empty track', () => {
  expect(paint(0, 'terminal')).toBe('ansi256(71)')
  expect(paint(0.5, 'terminal')).toBe('ansi256(179)')
  expect(paint(1, 'terminal')).toBe('ansi256(167)')
  expect(paint(null, 'terminal')).toBe('ansi256(242)')
})

test('SVG gets brighter colours, blended between them', () => {
  expect(paint(0, 'svg')).toBe('#3fb950')
  expect(paint(1, 'svg')).toBe('#f85149')
  expect(paint(0.55, 'svg')).toBe('#e3b341')
  expect(paint(null, 'svg')).toBe('#8b8b8b')
})

test('pills on light colours get dark text', () => {
  expect(textOn('#e3b341')).toBe('#1f1e1d')
  expect(textOn('#3fb950')).toBe('#ffffff')
  expect(textOn('#f85149')).toBe('#ffffff')
})

test('context is fine to half full, then rises to red when full', () => {
  expect(contextSeverity(0.3)).toBe(0)
  expect(contextSeverity(0.75)).toBe(0.5)
  expect(contextSeverity(1)).toBe(1)
  expect(contextModel({ percent: 39, tokens: 390_000, window: 1_000_000 }, null)).toEqual({
    fraction: 0.39,
    severity: 0,
    main: '390k',
    sub: ' / 1M',
    side: '39%',
    end: '',
  })
  expect(contextModel({ window: 200_000 }, null)).toEqual({ fraction: 0, severity: null, main: '—', sub: ' / 200k', side: '—', end: '' })
})

// 34k tokens on Opus 5.5 with a 1-hour cache: $0.0068 to read back, $0.272 to write again.
const opus = (over: Partial<Extract<CacheState, { kind: 'clock' }>> = {}): CacheState => ({
  kind: 'clock',
  since: 0,
  ttlMs: 3_600_000,
  prompt: 34_000,
  model: 'claude-opus-5-5',
  speed: 'standard',
  geo: 'not_available',
  compacted: false,
  ended: false,
  ...over,
})

test('resend: read back now while warm, up to a full write once expired, as usdash', () => {
  expect(resend(opus(), 1_800_000)).toEqual({ kind: 'cost', verb: 'next message', tokens: 34_000, now: 0.0068, upTo: 0.272 })
  expect(resend(opus(), 3_700_000)).toEqual({ kind: 'cost', verb: 'continuing', tokens: 34_000, now: null, upTo: 0.272 })
  expect(resend(opus({ ended: true }), 9_000_000)?.kind === 'cost' && resend(opus({ ended: true }), 9_000_000)).toMatchObject({ verb: 'resuming' })
  expect(resend(opus({ compacted: true }), 0)).toEqual({ kind: 'compacted' })
  expect(resend(opus({ model: 'claude-unknown-9' }), 0)).toMatchObject({ now: null, upTo: null })
  expect(resend({ kind: 'none' }, 0)).toBeNull()
})

test("resendLine is usdash's sentence", () => {
  expect(resendLine(resend(opus(), 1_800_000))).toBe('next message re-sends 34k tokens: $0.01 now · up to $0.27 once the cache expires')
  expect(resendLine(resend(opus(), 3_700_000))).toBe('continuing re-sends 34k tokens: up to $0.27')
  expect(resendLine(resend(opus({ ended: true, prompt: 55_000 }), 9_000_000))).toBe('resuming re-sends 55k tokens: up to $0.44')
  expect(resendLine(resend(opus({ compacted: true }), 0))).toBe('compacted: the next message measures the new size')
})

test('the cache bar: time left and the price now in its pill, the price once expired at its end', () => {
  expect(cacheModel(opus(), 1_800_000, false, null)).toEqual({
    fraction: 0.5,
    severity: 0.5,
    main: '30:00 left',
    sub: ' · $0.01 now',
    side: '50%',
    end: 'then up to $0.27',
  })
  expect(cacheModel(opus(), 3_840_000, false, null)).toEqual({
    fraction: 1,
    severity: 1,
    main: 'expired',
    sub: ' · up to $0.27 to continue · 4m ago',
    side: '100%',
    end: '',
  })
  expect(cacheModel(opus({ ended: true, prompt: 55_000 }), 3_600_000 + 7_200_000, false, null).sub).toBe(
    ' · up to $0.44 to resume · 2h 0m ago',
  )
  expect(cacheModel(opus({ compacted: true }), 1_800_000, false, null)).toMatchObject({ sub: ' · compacted', end: '' })
  expect(cacheModel(opus(), 0, true, null).main).toBe('in use')
  expect(cacheModel({ kind: 'none' }, 0, false, null).severity).toBeNull()
  expect(cacheModel({ kind: 'unknown', reason: 'tail failed' }, 0, false, null).main).toBe('unknown')
})

test('the terminal bar puts the pill at the fill edge, or just past a short fill', () => {
  const pill = (main: string, sub = '') => ({ main, sub })
  expect(terminalBar(0.5, 20, pill('5k'))).toEqual({ fill: '━━━━━━', pill: ' 5k ', track: '──────────', end: '' })
  expect(terminalBar(0.1, 20, pill('5k'))).toEqual({ fill: '━━', pill: ' 5k ', track: '──────────────', end: '' })
  expect(terminalBar(1, 20, pill('expired'))).toEqual({ fill: '━━━━━━━━━━━', pill: ' expired ', track: '', end: '' })
  expect(terminalBar(0, 20, pill('no reply yet'))).toEqual({ fill: '', pill: ' no reply yet ', track: '──────', end: '' })
})

test('the terminal bar puts the end cap at the far end when there is room', () => {
  expect(terminalBar(0.1, 30, { main: '5k', sub: '' }, 'then $1')).toEqual({ fill: '━━━', pill: ' 5k ', track: '──────────────', end: ' then $1 ' })
  expect(terminalBar(0.5, 20, { main: '5k', sub: '' }, 'then up to $0.27')).toMatchObject({ end: '' })
})

test('a long pill drops its trailing parts before it is cut', () => {
  expect(fitPill('expired', ' · up to $0.44 to resume · 2h 1m ago', 60)).toEqual({ main: 'expired', sub: ' · up to $0.44 to resume · 2h 1m ago' })
  expect(fitPill('expired', ' · up to $0.44 to resume · 2h 1m ago', 32)).toEqual({ main: 'expired', sub: ' · up to $0.44 to resume' })
  // A cut-off price is useless, so the whole part goes: "expired" alone.
  expect(fitPill('expired', ' · up to $0.44 to resume', 20)).toEqual({ main: 'expired', sub: '' })
  expect(fitPill('a very long main text', '', 10)).toEqual({ main: 'a very lo…', sub: '' })
  expect(terminalBar(1, 34, { main: 'expired', sub: ' · up to $0.44 to resume · 2h 1m ago' }).pill).toBe(' expired · up to $0.44 to resume ')
})

test('textBar fills by fraction, heavy against light', () => {
  expect(textBar(0.45, 20)).toBe('━'.repeat(9) + '─'.repeat(11))
  expect(textBar(0.001, 4)).toBe('━───')
})

test('the SVG bar draws its end cap only where the pill leaves room', () => {
  const base = { severity: 0, main: '30:00 left', sub: ' · $0.01 now', side: '50%', end: 'then up to $0.27' }
  expect(svgBar({ ...base, fraction: 0.3 }, 900, 'k')).toContain('then up to $0.27')
  expect(svgBar({ ...base, fraction: 0.97 }, 900, 'k')).not.toContain('then up to $0.27')
})

test('the SVG bar is drawn in its viewBox width, with the pill text escaped', () => {
  const svg = svgBar({ fraction: 0.5, severity: 0, main: '<1k', sub: ' / 1M', side: '50%', end: '' }, 900, 'x')
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="24" viewBox="0 0 900 24">')).toBe(true)
  expect(svg).toContain('&lt;1k')
  expect(svg).toContain('id="x-dots"')
})

test('rowLayout gives the bar what the label, value and extra leave', () => {
  expect(rowLayout(120, 17)).toEqual({ label: 10, bar: 85, side: 5, extra: 17 })
  expect(rowLayout(30, 17)).toEqual({ label: 10, bar: 10, side: 5, extra: 17 })
})

test('agoText', () => {
  expect(agoText(30_000)).toBe('just now')
  expect(agoText(240_000)).toBe('4m ago')
  expect(agoText(7_500_000)).toBe('2h 5m ago')
})
