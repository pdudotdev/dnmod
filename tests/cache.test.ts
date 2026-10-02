import { expect, test } from 'claude-code/testing'

import { readTranscript } from '../hooks/cache'

const at = (time: string) => Date.parse(`2026-10-02T${time}Z`)
const line = (record: object) => JSON.stringify(record)
const reply = (uuid: string, parentUuid: string, time: string, id: string, usage: object, model = 'claude-opus-5-5') =>
  line({ type: 'assistant', uuid, parentUuid, timestamp: `2026-10-02T${time}Z`, message: { id, model, usage } })
const wrote = (oneHour: number, fiveMinutes = 0, read = 0, fresh = 2) => ({
  input_tokens: fresh,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: oneHour + fiveMinutes,
  cache_creation: { ephemeral_1h_input_tokens: oneHour, ephemeral_5m_input_tokens: fiveMinutes },
  speed: 'standard',
  inference_geo: 'not_available',
})

// A prompt, an attachment written beside it, then a reply that thought for 100 s before its first record.
const turn = [
  '"cut short by the tail read", "type": "assistant"}',
  line({ type: 'user', uuid: 'u1', parentUuid: null, timestamp: '2026-10-02T06:00:00.000Z', message: { content: 'hi' } }),
  line({ type: 'attachment', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-10-02T06:00:00.010Z' }),
  reply('r1', 'a1', '06:01:40.000', 'm1', wrote(500, 0, 30_000)),
  reply('r2', 'r1', '06:01:45.000', 'm1', wrote(500, 0, 30_000)),
]

test('the clock runs from the trigger, and the prompt is everything the request sent', () => {
  expect(readTranscript(turn)).toEqual({
    since: at('06:00:00.000'),
    ttlMs: 3_600_000,
    prompt: 30_502,
    model: 'claude-opus-5-5',
    speed: 'standard',
    geo: 'not_available',
    compacted: false,
    ended: false,
  })
})

test("a subagent's requests don't move the main conversation", () => {
  const sidechain = line({
    type: 'assistant',
    uuid: 's1',
    parentUuid: 'x',
    isSidechain: true,
    timestamp: '2026-10-02T06:05:00.000Z',
    message: { id: 'm9', model: 'claude-haiku-4-5', usage: wrote(0, 100) },
  })
  expect(readTranscript([...turn, sidechain])?.since).toBe(at('06:00:00.000'))
  expect(readTranscript([...turn, sidechain])?.model).toBe('claude-opus-5-5')
})

test('a request that only read the cache keeps the TTL of the last write', () => {
  const next = [
    line({ type: 'user', uuid: 'u2', parentUuid: 'r2', timestamp: '2026-10-02T06:10:00.000Z', message: { content: 'go on' } }),
    reply('r3', 'u2', '06:10:03.000', 'm2', wrote(0, 0, 31_000)),
  ]
  const state = readTranscript([...turn, ...next])
  expect(state?.since).toBe(at('06:10:00.000'))
  expect(state?.ttlMs).toBe(3_600_000)
})

test('the TTL: 5 minutes for a 5-minute write, 1 hour when a write mixes both (as usdash)', () => {
  const user = line({ type: 'user', uuid: 'u1', parentUuid: null, timestamp: '2026-10-02T06:00:00.000Z', message: { content: 'hi' } })
  expect(readTranscript([user, reply('r1', 'u1', '06:00:02.000', 'm1', wrote(0, 300))])?.ttlMs).toBe(300_000)
  expect(readTranscript([user, reply('r1', 'u1', '06:00:02.000', 'm1', wrote(200, 300))])?.ttlMs).toBe(3_600_000)
})

test('without the trigger in the lines, the first reply record starts the clock', () => {
  expect(readTranscript([reply('r1', 'gone', '06:01:40.000', 'm1', wrote(500))])?.since).toBe(at('06:01:40.000'))
})

test('errors and synthetic messages are not requests', () => {
  const error = line({
    type: 'assistant',
    uuid: 'e1',
    parentUuid: 'r2',
    isApiErrorMessage: true,
    timestamp: '2026-10-02T06:20:00.000Z',
    message: { id: 'm5', model: '<synthetic>', usage: wrote(0) },
  })
  expect(readTranscript([...turn, error])?.since).toBe(at('06:00:00.000'))
})

test('/compact restarts the clock from when it started, and marks the size unknown until the next request', () => {
  const compact = line({
    type: 'system',
    subtype: 'compact_boundary',
    uuid: 'c1',
    timestamp: '2026-10-02T06:30:00.000Z',
    compactMetadata: { durationMs: 20_000 },
  })
  const state = readTranscript([...turn, compact])
  expect(state?.compacted).toBe(true)
  expect(state?.since).toBe(at('06:29:40.000'))
  const after = [
    line({ type: 'user', uuid: 'u3', parentUuid: 'c1', timestamp: '2026-10-02T06:31:00.000Z', message: { content: 'next' } }),
    reply('r4', 'u3', '06:31:02.000', 'm3', wrote(9_000)),
  ]
  expect(readTranscript([...turn, compact, ...after])?.compacted).toBe(false)
})

test('a recap restarts the clock a few seconds before it was logged', () => {
  const recap = line({ type: 'system', subtype: 'away_summary', uuid: 'w1', timestamp: '2026-10-02T07:30:05.000Z' })
  expect(readTranscript([...turn, recap])?.since).toBe(at('07:30:00.000'))
})

test('an exit (cost-state) ends the session until something is typed', () => {
  const exit = line({ type: 'cost-state', totalCostUSD: 1.2 })
  expect(readTranscript([...turn, exit])?.ended).toBe(true)
  const typed = line({ type: 'user', uuid: 'u4', parentUuid: 'r2', timestamp: '2026-10-02T08:00:00.000Z', message: { content: 'back' } })
  expect(readTranscript([...turn, exit, typed])?.ended).toBe(false)
  const toolResult = line({
    type: 'user',
    uuid: 'u5',
    parentUuid: 'r2',
    timestamp: '2026-10-02T08:00:00.000Z',
    message: { content: [{ type: 'tool_result', tool_use_id: 't' }] },
  })
  expect(readTranscript([...turn, exit, toolResult])?.ended).toBe(true)
})

test('no request yet', () => {
  expect(readTranscript([line({ type: 'user', uuid: 'u1', timestamp: '2026-10-02T06:00:00.000Z', message: { content: 'hi' } })])).toBeNull()
  expect(readTranscript([])).toBeNull()
})
