import { expect, test } from 'claude-code/testing'

import {
  agoText,
  cacheModel,
  contextModel,
  contextSeverity,
  mmss,
  paint,
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
  })
  expect(contextModel({ window: 200_000 }, null)).toEqual({ fraction: 0, severity: null, main: '—', sub: ' / 200k', side: '—' })
})

test('the cache bar fills as the cache ages, and is full and red once expired', () => {
  const hour = { kind: 'clock', since: 0, ttlMs: 3_600_000 } as const
  expect(cacheModel(hour, 1_800_000, false, null)).toEqual({
    fraction: 0.5,
    severity: 0.5,
    main: '30:00',
    sub: ' left',
    side: '50%',
  })
  expect(cacheModel(hour, 3_840_000, false, null)).toEqual({
    fraction: 1,
    severity: 1,
    main: 'expired',
    sub: ' 4m ago',
    side: '100%',
  })
  expect(cacheModel(hour, 3_840_000, true, null).main).toBe('in use')
  expect(cacheModel({ kind: 'none' }, 0, false, null).severity).toBeNull()
  expect(cacheModel({ kind: 'unknown', reason: 'tail failed' }, 0, false, null).main).toBe('unknown')
})

test('the terminal bar puts the pill at the fill edge, or just past a short fill', () => {
  expect(terminalBar(0.5, 20, '5k')).toEqual({ fill: '━━━━━━', pill: ' 5k ', track: '──────────' })
  expect(terminalBar(0.1, 20, '5k')).toEqual({ fill: '━━', pill: ' 5k ', track: '──────────────' })
  expect(terminalBar(1, 20, 'expired')).toEqual({ fill: '━━━━━━━━━━━', pill: ' expired ', track: '' })
  expect(terminalBar(0, 20, 'no reply yet')).toEqual({ fill: '', pill: ' no reply yet ', track: '──────' })
})

test('textBar fills by fraction, heavy against light', () => {
  expect(textBar(0.45, 20)).toBe('━'.repeat(9) + '─'.repeat(11))
  expect(textBar(0.001, 4)).toBe('━───')
})

test('the SVG bar is drawn in its viewBox width, with the pill text escaped', () => {
  const svg = svgBar({ fraction: 0.5, severity: 0, main: '<1k', sub: ' / 1M', side: '50%' }, 900, 'x')
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
