import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { CacheState, Probe, Spend, View } from '../types'
import { readTranscript } from './cache'
import type { Ledger } from './ledger'
import { addLines, costByDay, parseOffset } from './ledger'
import type { BarModel, Paint } from './format'
import {
  cacheModel,
  contextModel,
  days30Line,
  money,
  paint,
  projectFolder,
  resend,
  resendLine,
  rowLayout,
  spendFigures,
  svgBar,
  terminalBar,
  textBar,
  ttlText,
} from './format'

const PANE = 'dnmod'
const DEMO_MS = 60_000
const TAIL_BYTES = 262_144

const view = atom({ plugin: 'dnmod', key: 'view' } as const, 'session' as View)
const probe = atom({ plugin: 'dnmod', key: 'probe' } as const, null as Probe | null)
const cache = atom({ plugin: 'dnmod', key: 'cache' } as const, { kind: 'none' } as CacheState)
const demoFrom = atom({ plugin: 'dnmod', key: 'demoFrom' } as const, null as number | null)
const spend = atom({ plugin: 'dnmod', key: 'spend' } as const, null as Spend | null)

const failure = (error: unknown): string =>
  `failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 120)

const claudeDir = async ($: EngineInterface): Promise<string> =>
  (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`

/** This session's transcript: in the folder named after its directory, else found by name. */
const findTranscript = async ($: EngineInterface): Promise<string | null> => {
  const [id, cwd, dir] = await Promise.all([$.session.id(), $.session.cwd(), claudeDir($)])
  const projects = `${dir}/projects`
  const expected = `${projects}/${projectFolder(cwd)}/${id}.jsonl`
  if (await $.fs.exists(expected)) return expected
  for (const entry of await $.fs.list(projects).catch(() => [])) {
    const candidate = `${projects}/${entry.name}/${id}.jsonl`
    if (entry.kind === 'dir' && (await $.fs.exists(candidate))) return candidate
  }
  return null
}

/** The cache clock from the end of the transcript (the whole file can exceed what one read takes). */
const readCache = async ($: EngineInterface, path: string | null): Promise<CacheState> => {
  if (path === null) return { kind: 'none' }
  try {
    const { exitCode, stdout, stderr } = await $.process.run(['tail', '-c', String(TAIL_BYTES), path], {
      timeoutMs: 5000,
    })
    if (exitCode !== 0) return { kind: 'unknown', reason: stderr.trim().split('\n')[0] ?? `tail exit ${exitCode}` }
    const state = readTranscript(stdout.split('\n'))
    return state === null ? { kind: 'none' } : { kind: 'clock', ...state }
  } catch (error) {
    return { kind: 'unknown', reason: failure(error) }
  }
}

const firstLine = async ($: EngineInterface, argv: string[]): Promise<string> => {
  const { exitCode, stdout, stderr } = await $.process.run(argv, { timeoutMs: 5000 })
  if (exitCode !== 0) return `exit ${exitCode}: ${stderr.trim().split('\n')[0] ?? ''}`
  return stdout.trim().split('\n')[0] ?? ''
}

/** Checks what the engine can reach on the machine it runs on: host, ~/.claude, the transcript. */
const runProbe = async ($: EngineInterface, path: string | null): Promise<Probe> => {
  const [surfaces, version, sessionId, dir] = await Promise.all([
    $.session.surfaces(),
    $.session.version(),
    $.session.id(),
    claudeDir($),
  ])
  const host = await firstLine($, ['hostname']).catch(failure)
  const os = await firstLine($, ['uname', '-sm']).catch(failure)

  let projects: string
  try {
    const entries = await $.fs.list(`${dir}/projects`)
    projects = `${entries.filter(entry => entry.kind === 'dir').length} project folders`
  } catch (error) {
    projects = failure(error)
  }

  let transcript = 'not found'
  let tail = 'not read'
  if (path !== null) {
    try {
      const { size } = await $.fs.stat(path)
      transcript = `${path} (${size} bytes)`
      const last = await $.process.run(['tail', '-c', '+' + String(Math.max(1, size - 2047)), path], {
        timeoutMs: 5000,
      })
      const lines = last.stdout.split('\n').filter(line => line.trim() !== '')
      JSON.parse(lines[lines.length - 1] ?? '')
      tail = `ok: read ${last.stdout.length} chars of the end, last line is JSON`
    } catch (error) {
      tail = failure(error)
    }
  }

  return {
    at: await $.clock.now(),
    surfaces: [...surfaces],
    version: version.version,
    sessionId,
    host,
    os,
    claudeDir: dir,
    projects,
    transcript,
    tail,
  }
}

const probeText = (p: Probe): string[] => [
  `surfaces: ${p.surfaces.join(', ')} · Claude Code ${p.version}`,
  `host: ${p.host} (${p.os})`,
  `config: ${p.claudeDir} · ${p.projects}`,
  `transcript: ${p.transcript}`,
  `tail read: ${p.tail}`,
]

const footerText = (p: Probe): string =>
  `${p.host} · ${p.os} · Claude Code ${p.version} · transcript ${p.tail.startsWith('ok') ? 'read' : 'not read'}`

// Per load: the module starts over on each reload, and session.start runs again.
let transcriptPath: string | null | undefined
let ticks = 0
let countdownEnd = 0

/** The transcript's path, looked up until it exists (a new session writes it with its first prompt). */
const sessionTranscript = async ($: EngineInterface): Promise<string | null> =>
  (transcriptPath ??= await findTranscript($))

const refreshCache = async ($: EngineInterface): Promise<void> => {
  const state = await readCache($, await sessionTranscript($))
  countdownEnd = state.kind === 'clock' ? state.since + state.ttlMs : 0
  await update($, cache, () => state)
}

// The session's requests, read from its transcripts as they grow: one ledger, a byte offset per file.
const ledger: Ledger = new Map()
const cursors = new Map<string, { offset: number; skipLine: boolean }>()
let spendRun: Promise<void> | null = null

const utf8Length = (text: string): number => new TextEncoder().encode(text).length

/**
 * The complete lines written to `path` since its cursor. `tail -c +N` reads from a byte offset;
 * a run's output stops at 4 MiB, so a big file takes several. A half-written last line waits for
 * the next read; a single line longer than a run's output is skipped.
 */
const readNewLines = async ($: EngineInterface, path: string): Promise<string[]> => {
  const cursor = cursors.get(path) ?? { offset: 0, skipLine: false }
  cursors.set(path, cursor)
  const lines: string[] = []
  for (let run = 0; run < 64; run++) {
    const out = await $.process.run(['tail', '-c', `+${cursor.offset + 1}`, path], { timeoutMs: 15_000 })
    if (out.exitCode !== 0 || out.stdout === '') break
    const lastNewline = out.stdout.lastIndexOf('\n')
    if (lastNewline === -1) {
      if (!out.isStdoutTruncated) break
      cursor.offset += utf8Length(out.stdout)
      cursor.skipLine = true
      continue
    }
    const complete = out.stdout.slice(0, lastNewline + 1)
    cursor.offset += utf8Length(complete)
    const parts = complete.split('\n')
    lines.push(...(cursor.skipLine ? parts.slice(1) : parts))
    cursor.skipLine = false
    if (!out.isStdoutTruncated) break
  }
  return lines
}

/** This session's transcripts: the main one and its subagents' (`<session id>/subagents/*.jsonl`). */
const sessionFiles = async ($: EngineInterface): Promise<string[]> => {
  const main = await sessionTranscript($)
  if (main === null) return []
  const subagents = `${main.slice(0, -'.jsonl'.length)}/subagents`
  const entries = await $.fs.list(subagents).catch(() => [])
  return [main, ...entries.filter(f => f.kind === 'file' && f.name.endsWith('.jsonl')).map(f => `${subagents}/${f.name}`)]
}

/** Reads what the session's transcripts gained and sums the session's spend by local day. One run at a time. */
const refreshSpend = async ($: EngineInterface): Promise<void> => {
  spendRun ??= (async () => {
    for (const path of await sessionFiles($)) addLines(ledger, await readNewLines($, path))
    const zone = await firstLine($, ['date', '+%z']).catch(() => '')
    const offsetMinutes = parseOffset(zone) ?? 0
    const { days, unpriced } = costByDay(ledger, offsetMinutes)
    const all = Object.values(days).reduce((sum, cost) => sum + cost, 0)
    await update($, spend, () => ({ days, all, unpriced, offsetMinutes }))
  })().finally(() => {
    spendRun = null
  })
  return spendRun
}

/** How far into the demo (0 to 1), or null when none runs. */
const demoProgress = (from: number | null, now: number): number | null =>
  from !== null && now >= from && now - from < DEMO_MS ? (now - from) / DEMO_MS : null

// SVG units per cell: more than a desktop cell's pixels, so the bar is always scaled down (never
// up) to its box, uniformly. See svgBar.
const SVG_UNITS_PER_CELL = 9

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'dnmod',
      description: 'Show dnmod in a side panel; "check" checks this machine, "demo" previews the bars',
      argumentHint: '[check | demo]',
    })
    await refreshCache($)
    // A long transcript takes a few reads: don't hold the session's start for them.
    $.clock.after(0, () => void refreshSpend($))

    // Redraw for the countdown: each second while it runs, every half minute otherwise
    // (for "expired 4m ago"). Each minute, catch the spend up (subagents, a day rolling over).
    $.clock.every(1000, () => {
      ticks += 1
      if (ticks % 60 === 0) void refreshSpend($)
      void $.clock.now().then(now => {
        if (now < countdownEnd + 1000 || ticks % 30 === 0) $.ui.invalidate('ui.render')
      })
    })

    return next(e)
  })

  // A turn's requests moved the cache clock and the figures.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refreshCache($)
    void refreshSpend($)

    return done
  })

  on('session.measure', ($, e, next) => {
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('command.run', { command: 'dnmod' }, async ($, e) => {
    const arg = e.args.trim()

    if (arg === 'demo') {
      const now = await $.clock.now()
      await update($, demoFrom, () => now)
      const frames = $.clock.every(250, () => $.ui.invalidate('ui.render'))
      $.clock.after(DEMO_MS + 500, () => frames.cancel())

      return {}
    }
    if (arg !== '' && arg !== 'check') return { text: 'Usage: /dnmod, /dnmod check or /dnmod demo' }

    const path = await sessionTranscript($)
    const found = await runProbe($, path)
    await update($, probe, () => found)
    if (arg === 'check') return { text: probeText(found).join('\n') }

    await refreshCache($)
    await refreshSpend($)
    // The pane shows everything where a surface draws it. VS Code attaches none (its
    // engine runs headless, yet ui.open still answers placed), so print the figures there.
    const isDrawn = found.surfaces.length > 0 && (await $.ui.open({ id: PANE, title: 'dnmod' })).isPlaced
    if (isDrawn) return {}

    const now = await $.clock.now()
    const { context, cost } = await $.session.usage()
    const ctx = contextModel(context, null)
    const state = await read($, cache)
    const cached = cacheModel(state, now, false, null)
    const spent = spendFigures(await read($, spend), cost?.usd, now)

    return {
      text: [
        `context ${textBar(ctx.fraction, 24)} ${ctx.side} · ${ctx.main}${ctx.sub} · today ${money(spent.today)} · total ${money(spent.total)}`,
        `cache   ${textBar(cached.fraction, 24)} ${cached.side ? `${cached.side} · ` : ''}${cached.main}${cached.sub}`,
        ...[resendLine(resend(state, now))].filter((line): line is string => line !== null),
        days30Line(),
        footerText(found),
      ].join('\n'),
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const ink: Paint = e.surface === 'terminal' ? 'terminal' : 'svg'
    const shown = await read($, view)
    const now = await $.clock.now()
    const demoAt = demoProgress(await read($, demoFrom), now)
    const { context, cost } = await $.session.usage()
    const ctx = contextModel(context, demoAt)
    const cached = cacheModel(await read($, cache), now, e.props.isWorking, demoAt)
    // The engine draws the band's [-] marker at its top right on the terminal: keep clear of it.
    const cols = rowLayout(e.props.bodyColumns - (ink === 'terminal' ? 4 : 0), 26)
    const spent = spendFigures(await read($, spend), cost?.usd, now)

    const bar = (m: BarModel, id: string, alt: string) => {
      if (e.surface === 'terminal') {
        const parts = terminalBar(m.fraction, cols.bar, m, m.end)
        const color = paint(m.severity, ink)
        const grey = paint(null, ink)
        return (
          <Box flexDirection="row">
            <Text color={color}>{parts.fill}</Text>
            <Text color={grey}>{parts.gap}</Text>
            <Text inverse={parts.solid} bold color={color}>
              {parts.main}
            </Text>
            <Text inverse={parts.solid} color={color}>
              {parts.sub}
            </Text>
            <Text color={color}>{parts.heavy}</Text>
            <Text color={grey}>{parts.track}</Text>
            <Text dimColor>{parts.end}</Text>
          </Box>
        )
      }
      const { Svg } = $.ui.resolve(e)
      return <Svg source={svgBar(m, cols.bar * SVG_UNITS_PER_CELL, `dnmod-band-${id}`)} alt={alt} />
    }

    const row = (label: string, m: BarModel | null, middle: RenderChildren, extra: RenderChildren) => (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Box width={cols.label} flexDirection="row" gap={1}>
          <Text color={paint(m?.severity ?? null, ink)}>●</Text>
          <Text>{label}</Text>
        </Box>
        <Box width={cols.bar}>{middle}</Box>
        <Box width={cols.side} justifyContent="flex-end">
          <Text dimColor>{m?.side ?? ''}</Text>
        </Box>
        <Box width={cols.extra} justifyContent="flex-end">
          {extra}
        </Box>
      </Box>
    )

    const toggle = (
      <Box flexDirection="row" gap={1}>
        <Button
          key="show-session"
          plain
          dimColor={shown !== 'session'}
          label="session"
          onPress={() => update($, view, () => 'session')}
        />
        <Text dimColor>│</Text>
        <Button
          key="show-30d"
          plain
          dimColor={shown !== 'days30'}
          label="30d"
          onPress={() => update($, view, () => 'days30')}
        />
      </Box>
    )

    const total = (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>today</Text>
        <Text bold>{money(spent.today)}</Text>
        <Text dimColor>· total</Text>
        <Text bold>{money(spent.total)}</Text>
      </Box>
    )

    if (shown === 'days30') {
      return (
        <Box flexDirection="column">
          {row('30 days', null, <Text dimColor>not computed yet</Text>, total)}
          {row('', null, <Text dimColor>coming in a later version</Text>, toggle)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {row('Context', ctx, bar(ctx, 'context', `context ${ctx.side} full`), total)}
        {row('Cache', cached, bar(cached, 'cache', `cache ${cached.main}${cached.sub}`), toggle)}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const ink: Paint = e.surface === 'terminal' ? 'terminal' : 'svg'
    const now = await $.clock.now()
    const demoAt = demoProgress(await read($, demoFrom), now)
    const { context, cost } = await $.session.usage()
    const ctx = contextModel(context, demoAt)
    const state = await read($, cache)
    const cached = cacheModel(state, now, false, demoAt)
    const nextLine = demoAt === null ? resendLine(resend(state, now)) : null
    const found = await read($, probe)
    const cols = rowLayout(e.props.bodyColumns, 0)
    const spent = spendFigures(await read($, spend), cost?.usd, now)

    const bar = (m: BarModel, id: string, alt: string) => {
      if (e.surface === 'terminal') {
        const parts = terminalBar(m.fraction, cols.bar, m, m.end)
        const color = paint(m.severity, ink)
        const grey = paint(null, ink)
        return (
          <Box flexDirection="row">
            <Text color={color}>{parts.fill}</Text>
            <Text color={grey}>{parts.gap}</Text>
            <Text inverse={parts.solid} bold color={color}>
              {parts.main}
            </Text>
            <Text inverse={parts.solid} color={color}>
              {parts.sub}
            </Text>
            <Text color={color}>{parts.heavy}</Text>
            <Text color={grey}>{parts.track}</Text>
            <Text dimColor>{parts.end}</Text>
          </Box>
        )
      }
      const { Svg } = $.ui.resolve(e)
      return <Svg source={svgBar(m, cols.bar * SVG_UNITS_PER_CELL, `dnmod-pane-${id}`)} alt={alt} />
    }

    const row = (label: string, m: BarModel, middle: RenderChildren) => (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Box width={cols.label} flexDirection="row" gap={1}>
          <Text color={paint(m.severity, ink)}>●</Text>
          <Text>{label}</Text>
        </Box>
        <Box width={cols.bar}>{middle}</Box>
        <Box width={cols.side} justifyContent="flex-end">
          <Text dimColor>{m.side}</Text>
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Text bold>THIS SESSION</Text>
        {row('Context', ctx, bar(ctx, 'context', `context ${ctx.side} full`))}
        {row('Cache', cached, bar(cached, 'cache', `cache ${cached.main}${cached.sub}`))}
        {nextLine !== null && (
          <Box flexDirection="row" gap={1}>
            <Box width={cols.label}>
              <Text dimColor>Next</Text>
            </Box>
            <Text>{nextLine}</Text>
          </Box>
        )}
        <Box flexDirection="row" gap={1}>
          <Box width={cols.label}>
            <Text dimColor>Spend</Text>
          </Box>
          <Text dimColor>today</Text>
          <Text bold>{money(spent.today)}</Text>
          <Text dimColor>· total</Text>
          <Text bold>{money(spent.total)}</Text>
          {state.kind === 'clock' && <Text dimColor>{`· ${ttlText(state.ttlMs)} cache`}</Text>}
        </Box>
        <Text> </Text>
        <Text bold>LAST 30 DAYS</Text>
        <Text dimColor>not computed yet</Text>
        <Text> </Text>
        <Text dimColor>{found === null ? 'Run /dnmod check to check this machine.' : footerText(found)}</Text>
      </Box>
    )
  })
}
