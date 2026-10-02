import { expect, test } from 'claude-code/testing'

import { cacheClock } from '../hooks/cache'

const at = (time: string) => Date.parse(`2026-10-02T${time}Z`)
const line = (record: object) => JSON.stringify(record)
const reply = (uuid: string, parentUuid: string, time: string, id: string, oneHour: number, fiveMinutes = 0) =>
  line({
    type: 'assistant',
    uuid,
    parentUuid,
    timestamp: `2026-10-02T${time}Z`,
    message: {
      id,
      usage: { cache_creation: { ephemeral_1h_input_tokens: oneHour, ephemeral_5m_input_tokens: fiveMinutes } },
    },
  })

// A prompt, an attachment written beside it, then a reply that thought for 100 s before its first record.
const turn = [
  '"cut short by the tail read", "type": "assistant"}',
  line({ type: 'user', uuid: 'u1', parentUuid: null, timestamp: '2026-10-02T06:00:00.000Z' }),
  line({ type: 'attachment', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-10-02T06:00:00.010Z' }),
  reply('r1', 'a1', '06:01:40.000', 'm1', 500),
  reply('r2', 'r1', '06:01:45.000', 'm1', 500),
]

test('the clock runs from the trigger, not the first reply record', () => {
  expect(cacheClock(turn)).toEqual({ since: at('06:00:00.000'), ttlMs: 3_600_000 })
})

test("a subagent's requests don't move the main conversation's clock", () => {
  const sidechain = line({
    type: 'assistant',
    uuid: 's1',
    parentUuid: 'x',
    isSidechain: true,
    timestamp: '2026-10-02T06:05:00.000Z',
    message: { id: 'm9', usage: { cache_creation: { ephemeral_5m_input_tokens: 100 } } },
  })
  expect(cacheClock([...turn, sidechain])).toEqual({ since: at('06:00:00.000'), ttlMs: 3_600_000 })
})

test('a request that only read the cache keeps the TTL of the last write', () => {
  const next = [
    line({ type: 'user', uuid: 'u2', parentUuid: 'r2', timestamp: '2026-10-02T06:10:00.000Z' }),
    reply('r3', 'u2', '06:10:03.000', 'm2', 0),
  ]
  expect(cacheClock([...turn, ...next])).toEqual({ since: at('06:10:00.000'), ttlMs: 3_600_000 })
})

test('a 5-minute write gives a 5-minute TTL', () => {
  const lines = [
    line({ type: 'user', uuid: 'u1', parentUuid: null, timestamp: '2026-10-02T06:00:00.000Z' }),
    reply('r1', 'u1', '06:00:02.000', 'm1', 0, 300),
  ]
  expect(cacheClock(lines)?.ttlMs).toBe(300_000)
})

test('without the trigger in the lines, the first reply record starts the clock', () => {
  expect(cacheClock([reply('r1', 'gone', '06:01:40.000', 'm1', 500)])).toEqual({
    since: at('06:01:40.000'),
    ttlMs: 3_600_000,
  })
})

test('no reply yet', () => {
  expect(cacheClock([line({ type: 'user', uuid: 'u1', timestamp: '2026-10-02T06:00:00.000Z' })])).toBeNull()
  expect(cacheClock([])).toBeNull()
})
