import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Probe, View } from '../types'
import { days30Line, projectFolder, sessionLine } from './format'

const PANE = 'dnmod'
const view = atom({ plugin: 'dnmod', key: 'view' } as const, 'session' as View)
const probe = atom({ plugin: 'dnmod', key: 'probe' } as const, null as Probe | null)

const failure = (error: unknown): string =>
  `failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 120)

const firstLine = async ($: EngineInterface, argv: string[]): Promise<string> => {
  const { exitCode, stdout, stderr } = await $.process.run(argv, { timeoutMs: 5000 })
  if (exitCode !== 0) return `exit ${exitCode}: ${stderr.trim().split('\n')[0] ?? ''}`
  return stdout.trim().split('\n')[0] ?? ''
}

/** Checks what the engine can reach on the machine it runs on: host, ~/.claude, the transcript. */
const runProbe = async ($: EngineInterface): Promise<Probe> => {
  const [surfaces, version, sessionId, cwd] = await Promise.all([
    $.session.surfaces(),
    $.session.version(),
    $.session.id(),
    $.session.cwd(),
  ])
  const home = (await $.env.get('HOME')) ?? ''
  const claudeDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
  const projectsDir = `${claudeDir}/projects`

  const host = await firstLine($, ['hostname']).catch(failure)
  const os = await firstLine($, ['uname', '-sm']).catch(failure)

  let projects: string
  try {
    const entries = await $.fs.list(projectsDir)
    projects = `${entries.filter(entry => entry.kind === 'dir').length} project folders`
  } catch (error) {
    projects = failure(error)
  }

  const path = `${projectsDir}/${projectFolder(cwd)}/${sessionId}.jsonl`
  let transcript = path
  let tail: string
  try {
    const { size } = await $.fs.stat(path)
    transcript = `${path} (${size} bytes)`
    const last = await $.process.run(['tail', '-c', '+' + String(Math.max(1, size - 2047)), path], {
      timeoutMs: 5000,
    })
    const lines = last.stdout.split('\n').filter(line => line.trim() !== '')
    const lastLine = lines[lines.length - 1] ?? ''
    JSON.parse(lastLine)
    tail = `ok: read ${last.stdout.length} chars of the end, last line is JSON`
  } catch (error) {
    tail = failure(error)
  }

  return {
    at: await $.clock.now(),
    surfaces: [...surfaces],
    version: version.version,
    sessionId,
    host,
    os,
    claudeDir,
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'dnmod',
      description: 'Open the dnmod pane and check what it can read on this machine',
    })

    return next(e)
  })

  // New figures after each turn and on rate-limit moves: draw the band again.
  on('session.measure', ($, e, next) => {
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('command.run', { command: 'dnmod' }, async $ => {
    const found = await runProbe($)
    await update($, probe, () => found)
    await $.ui.open({ id: PANE, title: 'dnmod' })

    return { text: probeText(found).join('\n') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const shown = await read($, view)
    const { context, cost } = await $.session.usage()
    const line =
      shown === 'session'
        ? sessionLine({ ...context, usd: cost?.usd })
        : days30Line()

    return (
      <Box flexDirection="row" gap={1}>
        <Text dimColor wrap="truncate-end">
          {line}
        </Text>
        <Button
          key="toggle"
          plain
          dimColor
          label={shown === 'session' ? '30 days' : 'this session'}
          onPress={() => update($, view, current => (current === 'session' ? 'days30' : 'session'))}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const { context, cost } = await $.session.usage()
    const found = await read($, probe)

    return (
      <Box flexDirection="column">
        <Text>{sessionLine({ ...context, usd: cost?.usd })}</Text>
        <Text dimColor>{days30Line()}</Text>
        {found === null ? (
          <Text dimColor>Run /dnmod to check this machine.</Text>
        ) : (
          probeText(found).map(text => <Text dimColor>{text}</Text>)
        )}
      </Box>
    )
  })
}
