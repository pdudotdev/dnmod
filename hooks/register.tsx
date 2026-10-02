import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { CacheState, Probe, View } from '../types'
import { cacheClock } from './cache'
import type { BarModel, Paint } from './format'
import {
  cacheModel,
  contextModel,
  days30Line,
  EMPTY,
  filled,
  FULL,
  paint,
  projectFolder,
  svgBar,
  textBar,
  ttlText,
  usd,
} from './format'

const PANE = 'dnmod'
const DEMO_MS = 60_000
const TAIL_BYTES = 262_144

const view = atom({ plugin: 'dnmod', key: 'view' } as const, 'session' as View)
const probe = atom({ plugin: 'dnmod', key: 'probe' } as const, null as Probe | null)
const cache = atom({ plugin: 'dnmod', key: 'cache' } as const, { kind: 'none' } as CacheState)
const demoFrom = atom({ plugin: 'dnmod', key: 'demoFrom' } as const, null as number | null)

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
    const clock = cacheClock(stdout.split('\n'))
    return clock === null ? { kind: 'none' } : { kind: 'clock', ...clock }
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

/** How far into the demo (0 to 1), or null when none runs. */
const demoProgress = (from: number | null, now: number): number | null =>
  from !== null && now >= from && now - from < DEMO_MS ? (now - from) / DEMO_MS : null

const BAR_CELLS = (columns: number) => Math.min(28, Math.max(10, Math.floor(columns * 0.22)))
const PANE_CELLS = (columns: number) => Math.min(40, Math.max(10, columns - 32))
const PX_PER_CELL = 7

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'dnmod',
      description: 'Show dnmod in a side panel; "check" checks this machine, "demo" previews the bars',
      argumentHint: '[check | demo]',
    })
    await refreshCache($)

    // Redraw for the countdown: each second while it runs, every half minute otherwise
    // (for "expired 4m ago").
    $.clock.every(1000, () => {
      ticks += 1
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
    // The pane shows everything where a surface draws it. VS Code attaches none (its
    // engine runs headless, yet ui.open still answers placed), so print the figures there.
    const isDrawn = found.surfaces.length > 0 && (await $.ui.open({ id: PANE, title: 'dnmod' })).isPlaced
    if (isDrawn) return {}

    const now = await $.clock.now()
    const { context, cost } = await $.session.usage()
    const ctx = contextModel(context, null)
    const cached = cacheModel(await read($, cache), now, false, null)

    return {
      text: [
        `context ${textBar(ctx.fraction, 20)} ${ctx.value} · ${ctx.note} · total ${usd(cost?.usd)}`,
        `cache   ${textBar(cached.fraction, 20)} ${cached.value}${cached.note ? ` ${cached.note}` : ''}`,
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
    const cells = BAR_CELLS(e.props.bodyColumns)

    const bar = (m: BarModel, alt: string) => {
      if (e.surface === 'terminal') {
        const n = filled(m.fraction, cells)
        return (
          <Box flexDirection="row">
            <Text color={paint(m.severity, ink)}>{FULL.repeat(n)}</Text>
            <Text color={paint(null, ink)}>{EMPTY.repeat(cells - n)}</Text>
          </Box>
        )
      }
      const { Svg } = $.ui.resolve(e)
      const width = cells * PX_PER_CELL
      return <Svg source={svgBar(m.fraction, width, paint(m.severity, ink))} alt={alt} width={width} height={8} />
    }

    const toggle = (
      <Box flexDirection="row">
        <Button
          key="show-session"
          plain
          dimColor={shown !== 'session'}
          label="session"
          onPress={() => update($, view, () => 'session')}
        />
        <Text color={paint(null, ink)}>│</Text>
        <Button
          key="show-30d"
          plain
          dimColor={shown !== 'days30'}
          label="30d"
          onPress={() => update($, view, () => 'days30')}
        />
      </Box>
    )

    // The engine draws the band's [-] marker at its top right: keep clear of it.
    const frame = { flexDirection: 'column', width: '100%', paddingRight: ink === 'terminal' ? 4 : 0 } as const

    if (shown === 'days30') {
      return (
        <Box {...frame}>
          <Text dimColor>last 30 days</Text>
          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor>not computed yet</Text>
            {toggle}
          </Box>
        </Box>
      )
    }

    return (
      <Box {...frame}>
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" gap={1}>
            <Text dimColor>context</Text>
            {bar(ctx, `context ${ctx.value} full`)}
            <Text color={paint(ctx.severity, ink)}>{ctx.value}</Text>
            <Text dimColor>{`· ${ctx.note}`}</Text>
          </Box>
          <Box flexDirection="row" gap={1}>
            <Text dimColor>total</Text>
            <Text bold>{usd(cost?.usd)}</Text>
          </Box>
        </Box>
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" gap={1}>
            <Text dimColor>{'cache  '}</Text>
            {bar(cached, `cache ${cached.value}`)}
            <Text color={paint(cached.severity, ink)}>{cached.value}</Text>
            {cached.note !== '' && <Text dimColor>{cached.note}</Text>}
          </Box>
          {toggle}
        </Box>
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
    const found = await read($, probe)
    const cells = PANE_CELLS(e.props.bodyColumns)

    const bar = (m: BarModel, alt: string) => {
      if (e.surface === 'terminal') {
        const n = filled(m.fraction, cells)
        return (
          <Box flexDirection="row">
            <Text color={paint(m.severity, ink)}>{FULL.repeat(n)}</Text>
            <Text color={paint(null, ink)}>{EMPTY.repeat(cells - n)}</Text>
          </Box>
        )
      }
      const { Svg } = $.ui.resolve(e)
      const width = cells * PX_PER_CELL
      return <Svg source={svgBar(m.fraction, width, paint(m.severity, ink))} alt={alt} width={width} height={8} />
    }

    const row = (label: string, ...rest: RenderChildren[]) => (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{label.padEnd(8)}</Text>
        {rest}
      </Box>
    )
    const cacheNote = [cached.note, state.kind === 'clock' && demoAt === null ? `${ttlText(state.ttlMs)} cache` : '']
      .filter(note => note !== '')
      .join(' · ')

    return (
      <Box flexDirection="column">
        <Text bold>THIS SESSION</Text>
        {row(
          'Context',
          bar(ctx, `context ${ctx.value} full`),
          <Text color={paint(ctx.severity, ink)}>{ctx.value}</Text>,
          <Text dimColor>{`· ${ctx.note}`}</Text>,
        )}
        {row(
          'Cache',
          bar(cached, `cache ${cached.value}`),
          <Text color={paint(cached.severity, ink)}>{cached.value}</Text>,
          cacheNote !== '' && <Text dimColor>{`· ${cacheNote}`}</Text>,
        )}
        {row('Spend', <Text dimColor>total</Text>, <Text bold>{usd(cost?.usd)}</Text>)}
        <Text> </Text>
        <Text bold>LAST 30 DAYS</Text>
        <Text dimColor>not computed yet</Text>
        <Text> </Text>
        <Text dimColor>{found === null ? 'Run /dnmod check to check this machine.' : footerText(found)}</Text>
      </Box>
    )
  })
}
