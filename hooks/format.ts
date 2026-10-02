// Pure formatting for the band's lines; no `$` here, so tests can call it directly.

export type Figures = {
  percent?: number
  tokens?: number
  window: number
  usd?: number
}

export const usd = (value: number | undefined): string => {
  if (value === undefined) return '—'
  return value < 10 ? `$${value.toFixed(2)}` : `$${value.toFixed(1)}`
}

export const tokens = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}

export const contextText = (f: Figures): string => {
  if (f.percent === undefined || f.tokens === undefined) return `context — of ${tokens(f.window)}`
  return `context ${f.percent}% (${tokens(f.tokens)} of ${tokens(f.window)})`
}

export const sessionLine = (f: Figures): string => [contextText(f), `total ${usd(f.usd)}`].join(' · ')

export const days30Line = (): string => '30d · not computed yet'

/** Claude Code's folder name for a project directory: every non-alphanumeric character becomes '-'. */
export const projectFolder = (dir: string): string => dir.replace(/[^a-zA-Z0-9]/g, '-')
