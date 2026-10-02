import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

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

const usage = (on: On) =>
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 90_000, window: 200_000, percent: 45 },
      rateLimits: [],
      cost: { usd: 1.2 },
    },
  }))

test('the band shows this session and toggles to 30 days, on terminal and desktop', async ($, on) => {
  usage(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /context/ }))?.text).toBe(
      'context 45% (90k of 200k) · total $1.20',
    )

    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: /^30d/ })).toBeDefined()

    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: /context 45%/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the band says so when no response has reported the context yet', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /context/ }))?.text).toBe('context — of 200k · total —')
  await ui.unmount()
})

test('the pane draws on every surface, vscode and mobile included', async ($, on) => {
  usage(on)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /context 45%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Run \/dnmod/ })).toBeDefined()
    await ui.unmount()
  }
})
