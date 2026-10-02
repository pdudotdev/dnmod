import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderSurface } from 'claude-code'

/** Answers everything /dnmod asks for, as a Mac with one project and a transcript with no reply yet. */
const machine = (on: On, surfaces: readonly RenderSurface[]) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
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
    `context ${'━'.repeat(11)}${'─'.repeat(13)} 45% · 90k / 200k · today — · total $1.20`,
    `cache   ${'─'.repeat(24)} no reply yet`,
    '30d · no requests in the last 30 days',
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

test("today's spend comes from the transcript, read in pieces as a big file needs", async ($, on) => {
  const usage = { input_tokens: 10, cache_read_input_tokens: 1_000_000, output_tokens: 1_000, cache_creation: {} }
  const reply = (id: string) =>
    JSON.stringify({ type: 'assistant', timestamp: '1970-01-01T00:00:00.500Z', message: { id, model: 'claude-opus-5-5', usage } })
  const file = `${reply('m1')}\n${reply('m2')}\n`
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  mock.env(on, { HOME: '/Users/me' })
  on('session.surfaces', () => ({ value: [] }))
  on('session.version', () => ({ value: { version: '2.1.287' } }))
  on('session.id', () => ({ value: 'abc' }))
  on('session.cwd', () => ({ value: '/Users/me/repo' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 90_000, window: 200_000, percent: 45 }, rateLimits: [], cost: { usd: 1.2 } },
  }))
  // `tail -c +N` serves a piece longer than a line but shorter than the file, as a run cut at its
  // output limit would: the second line is split across two reads.
  const piece = Math.round(file.length * 0.7)
  on('process.run', ($, e) => {
    const from = e.argv[0] === 'tail' && e.argv[2]?.startsWith('+') ? Number(e.argv[2].slice(1)) - 1 : -1
    const stdout = from >= 0 ? file.slice(from, from + piece) : e.argv[0] === 'tail' ? file.slice(-2048) : '+0000\n'
    const isStdoutTruncated = from >= 0 && from + piece < file.length
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated, isStderrTruncated: false } }
  })
  on('fs.exists', () => ({ value: true }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', () => ({ value: { kind: 'file', size: file.length, mtimeMs: 0, isLink: false } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const text = (await $.command.run(dnmod(''))).text ?? ''
  expect(text.split('\n')[0]).toContain('today $0.44 · total $1.20')
})

test('the 30 days come out with a 250-character path, keyed short in the store', async ($, on) => {
  const usage = { input_tokens: 10, cache_read_input_tokens: 1_000_000, output_tokens: 1_000, cache_creation: {} }
  const reply = (id: string) =>
    JSON.stringify({ type: 'assistant', timestamp: '1970-01-01T00:00:00.500Z', message: { id, model: 'claude-opus-5-5', usage } })
  const long = `/Users/me/.claude/projects/-Users-me-Library-Application-Support-Claude-scratch-workspaces-${'x'.repeat(150)}/s1.jsonl`
  const files: Record<string, string> = { [long]: `${reply('m1')}\n`, '/Users/me/.claude/projects/-a/s2.jsonl': `${reply('m2')}\n` }
  const store = new Map<string, unknown>()
  mock.clock(on, { now: 1_000 })
  mock.env(on, { HOME: '/Users/me' })
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('session.surfaces', () => ({ value: [] }))
  on('session.version', () => ({ value: { version: '2.1.287' } }))
  on('session.id', () => ({ value: 'abc' }))
  on('session.cwd', () => ({ value: '/Users/me/repo' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost: { usd: 1 } } }))
  on('process.run', ($, e) => {
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'find') return out(`${Object.keys(files).join('\n')}\n`)
    if (e.argv[0] === 'tail') return out(files[e.argv[e.argv.length - 1]!] ?? '')
    return out('+0000\n')
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 100, mtimeMs: 5, isLink: false } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const text = (await $.command.run(dnmod(''))).text ?? ''
  expect(text).toContain('30d · spend $0.44 · 2 requests')
  expect([...store.keys()].every(key => key.length <= 21)).toBe(true)
  expect([...store.keys()].filter(key => key.startsWith('file:'))).toHaveLength(2)
})
