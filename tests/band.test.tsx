import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { paint } from '../hooks/format'

const GREEN = paint(0, 'terminal')

const BAND = {
  plugin: 'dnmod',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const PANE = {
  plugin: 'dnmod',
  component: 'Pane',
  requestId: 'dnmod',
  props: {
    title: 'dnmod',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const DEMO = {
  command: 'dnmod',
  args: 'demo',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const

const usage = (on: On) =>
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 90_000, window: 200_000, percent: 45 },
      rateLimits: [],
      cost: { usd: 1.2 },
    },
  }))

test('the terminal band shows context, then the cache, and toggles to 30 days', async ($, on) => {
  usage(on)
  mock.clock(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: ' 90k' }))?.props.color).toBe(GREEN)
  expect(await ui.find({ type: 'Text', text: ' / 200k ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '45%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '$1.20' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'today' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' no reply yet' })).toBeDefined()

  await ui.press({ key: 'show-30d' })
  expect(await ui.find({ type: 'Text', text: '30 days' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '45%' })).toBeUndefined()

  await ui.press({ key: 'show-session' })
  expect(await ui.find({ type: 'Text', text: '45%' })).toBeDefined()
  await ui.unmount()
})

test('the desktop band draws its two bars as SVG', async ($, on) => {
  usage(on)
  mock.clock(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: '45%' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: '●' }))?.props.color).toBe(paint(0, 'svg'))
  await ui.unmount()
})

test('the cache shows as in use while a turn runs', async ($, on) => {
  usage(on)
  mock.clock(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, isWorking: true } })
  expect((await ui.find({ type: 'Text', text: ' in use' }))?.props.color).toBe(GREEN)
  await ui.unmount()
})

test('the band shows dashes before any response has reported the context', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  mock.clock(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '—' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' —' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' / 200k ' })).toBeDefined()
  await ui.unmount()
})

test('/dnmod demo ages the cache from green to amber at half time, then ends', async ($, on) => {
  usage(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  await $.command.run(DEMO)

  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: ' 60:00 left' }))?.props.color).toBe(GREEN)
  await ui.unmount()

  await clock.advance(30_000)
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: ' 30:00 left' }))?.props.color).toBe(paint(0.5, 'terminal'))
  expect(await ui.findAll({ type: 'Text', text: '50%' })).toHaveLength(2)
  await ui.unmount()

  await clock.advance(31_000)
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: ' no reply yet' })).toBeDefined()
  await ui.unmount()
})

test('the pane draws on every surface, vscode and mobile included', async ($, on) => {
  usage(on)
  mock.clock(on)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'THIS SESSION' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '45%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Run \/dnmod check/ })).toBeDefined()
    await ui.unmount()
  }
})
