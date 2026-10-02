import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderSurface } from 'claude-code'

/** Answers everything /dnmod asks for, as a Mac with one project and a transcript with no reply yet. */
const machine = (on: On, surfaces: readonly RenderSurface[]) => {
  mock.clock(on, { now: 1_000 })
  mock.env(on, { HOME: '/Users/me' })
  on('session.surfaces', () => ({ value: surfaces }))
  on('session.version', () => ({ value: { version: '2.1.287' } }))
  on('session.id', () => ({ value: 'abc' }))
  on('session.cwd', () => ({ value: '/Users/me/repo' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 90_000, window: 200_000, percent: 45 },
      rateLimits: [],
      cost: { usd: 1.2 },
    },
  }))
  on('process.run', ($, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv[0] === 'tail' ? '{"type":"user"}\n' : 'mac\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('fs.exists', () => ({ value: true }))
  on('fs.list', () => ({ value: [{ name: '-Users-me-repo', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 5000, mtimeMs: 0, isLink: false } }))
  // VS Code's engine answers placed too, with nothing attached to draw it.
  on('ui.open', () => ({ value: { isPlaced: true } }))
}

const dnmod = (args: string) =>
  ({
    command: 'dnmod',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  }) as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/dnmod opens the pane and prints nothing on ${surface}`, async ($, on) => {
    machine(on, [surface])
    const ran = await $.command.run(dnmod(''))
    expect(ran.text).toBeUndefined()
  })
}

test('/dnmod prints the figures where nothing draws, as in VS Code', async ($, on) => {
  machine(on, [])
  const ran = await $.command.run(dnmod(''))
  expect((ran.text ?? '').split('\n')).toEqual([
    `context ${'━'.repeat(11)}${'─'.repeat(13)} 45% · 90k / 200k · total $1.20`,
    `cache   ${'─'.repeat(24)} no reply yet`,
    '30d · not computed yet',
    'mac · mac · Claude Code 2.1.287 · transcript read',
  ])
})

test('/dnmod check prints the machine check on any surface', async ($, on) => {
  machine(on, ['terminal'])
  const lines = ((await $.command.run(dnmod('check'))).text ?? '').split('\n')
  expect(lines).toContain('transcript: /Users/me/.claude/projects/-Users-me-repo/abc.jsonl (5000 bytes)')
  expect(lines).toContain('tail read: ok: read 16 chars of the end, last line is JSON')
})

test('/dnmod with an unknown argument says how to use it', async ($, on) => {
  machine(on, ['terminal'])
  expect((await $.command.run(dnmod('nope'))).text).toBe('Usage: /dnmod, /dnmod check or /dnmod demo')
})
