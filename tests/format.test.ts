import { expect, test } from 'claude-code/testing'

import { agoText, cacheModel, contextModel, contextSeverity, mmss, paint, textBar, tokens } from '../hooks/format'

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

test('textBar fills by fraction and shows any positive fraction', () => {
  expect(textBar(0.45, 20)).toBe('▰'.repeat(9) + '▱'.repeat(11))
  expect(textBar(0.001, 20)).toBe('▰' + '▱'.repeat(19))
  expect(textBar(0, 4)).toBe('▱▱▱▱')
  expect(textBar(1.5, 4)).toBe('▰▰▰▰')
})

test('the terminal gets 256-colour codes, green to red, and grey for an empty track', () => {
  expect(paint(0, 'terminal')).toBe('ansi256(71)')
  expect(paint(0.5, 'terminal')).toBe('ansi256(179)')
  expect(paint(1, 'terminal')).toBe('ansi256(167)')
  expect(paint(null, 'terminal')).toBe('ansi256(242)')
})

test('SVG gets the same colours in hex, blended between them', () => {
  expect(paint(0, 'svg')).toBe('#5faf5f')
  expect(paint(1, 'svg')).toBe('#d75f5f')
  expect(paint(0.1, 'svg')).toBe('#73af5f')
})

test('context is fine to half full, then rises to red when full', () => {
  expect(contextSeverity(0.3)).toBe(0)
  expect(contextSeverity(0.5)).toBe(0)
  expect(contextSeverity(0.75)).toBe(0.5)
  expect(contextSeverity(1)).toBe(1)
  expect(contextModel({ window: 200_000 }, null)).toEqual({ fraction: 0, severity: null, value: '—', note: '— of 200k' })
})

test('the cache bar fills as the cache ages, and is full and red once expired', () => {
  const hour = { kind: 'clock', since: 0, ttlMs: 3_600_000 } as const
  expect(cacheModel(hour, 1_800_000, false, null)).toEqual({
    fraction: 0.5,
    severity: 0.5,
    value: 'expires in 30:00',
    note: '',
  })
  expect(cacheModel(hour, 3_840_000, false, null)).toEqual({ fraction: 1, severity: 1, value: 'expired', note: '4m ago' })
  expect(cacheModel(hour, 3_840_000, true, null)).toEqual({ fraction: 0, severity: 0, value: 'in use', note: '' })
  expect(cacheModel({ kind: 'none' }, 0, false, null).severity).toBeNull()
  expect(cacheModel({ kind: 'unknown', reason: 'tail failed' }, 0, false, null).value).toBe('unknown')
})

test('agoText', () => {
  expect(agoText(30_000)).toBe('just now')
  expect(agoText(240_000)).toBe('4m ago')
  expect(agoText(7_500_000)).toBe('2h 5m ago')
})
