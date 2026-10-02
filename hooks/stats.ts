// The 30-day figures. Each transcript file is summed into hourly buckets, the way usdash's Store
// accounts its requests (usdash/sessions.py: requests, their start, the chain each continues,
// cache misses and their causes), and the buckets are merged over the period (usdash/stats.py).
// Pure: register.tsx reads the files and keeps the summaries.

import type { Stats30 } from '../types'
import type { Usage } from './prices'
import {
  convertTokens,
  effortKeepsCache,
  modelKey,
  pricePaid,
  prettyModel,
  requestCost,
  usageParts,
  writePrice,
} from './prices'

const HOUR = 3_600_000
const FIVE_MINUTES = 300_000
const DAY = 86_400_000
// A request that wrote again at least this share of what it could have read (and at least this
// many tokens) missed the cache (usdash's REWRITE_SHARE, REWRITE_MIN_TOKENS).
const REWRITE_SHARE = 0.3
const REWRITE_MIN_TOKENS = 5_000
// Recaps are logged a few seconds after their request started (usdash's RECAP_LAG).
const RECAP_LAG = 5_000

/**
 * One hour's requests (by when each ended): spend, input tokens, misses' extra cost by cause, and
 * spend by model (`claude-opus-5-5`, `claude-opus-5-5 fast`) and by context size (BANDS).
 */
export type Bucket = {
  spend: number
  requests: number
  read: number
  prompt: number
  misses: number
  causes: Record<string, number>
  models: Record<string, number>
  bands: Record<string, number>
}

/** One transcript file: its earliest record, the folder its session ran in, and its priced requests by the hour they ended (epoch hour). */
export type FileSummary = { first: number | null; cwd: string | null; hours: Record<string, Bucket> }

/** Bumped whenever FileSummary changes shape, so summaries kept in the store are worked out again. */
export const SUMMARY_VERSION = 2

/** Context-size bands, by the prompt a request sent: (upper bound, label), as usdash's BANDS. */
export const BANDS: readonly (readonly [number, string])[] = [
  [50_000, 'under 50k'],
  [100_000, '50–100k'],
  [200_000, '100–200k'],
  [500_000, '200–500k'],
  [Infinity, '500k+'],
]

const bandOf = (prompt: number): string => BANDS.find(([upper]) => prompt < upper)![1]

type TranscriptRecord = {
  type?: string
  subtype?: string
  uuid?: string
  parentUuid?: string | null
  requestId?: string
  isApiErrorMessage?: boolean
  timestamp?: string
  version?: string
  effort?: string
  cwd?: string
  compactMetadata?: { durationMs?: number }
  message?: { id?: string; model?: string; usage?: Usage }
}

/** What a conversation (the main one, or a subagent's) last sent: the next request compares with it. */
type Chain = {
  key: string | null
  prompt: number
  model: string | null
  effort: string | null
  version: string | null
  touched: number | null
  ttl: number | null
  compacted: boolean
  resumed: boolean
  speed: string | null
}

type Request = {
  model: string
  effort: string | null
  version: string | null
  start: number
  end: number
  usage: Usage
  prev: Chain
  rewriteCost: number
  cause: string | null
}

const time = (r: TranscriptRecord | undefined): number | null => {
  const t = Date.parse(r?.timestamp ?? '')
  return Number.isNaN(t) ? null : t
}

const promptOf = (usage: Usage): number => {
  const p = usageParts(usage)
  return p.fresh + p.read + p.write5m + p.write1h
}

const ttlOf = (usage: Usage): number | null => {
  const p = usageParts(usage)
  if (p.write1h > 0) return HOUR
  if (p.write5m > 0) return FIVE_MINUTES
  return null
}

/** Why a request missed, grouped as usdash's reason_group: what changed since the chain's last request. */
const causeOf = (request: Request, prev: Chain): string => {
  if (modelKey(request.model) !== modelKey(prev.model)) return 'model switch'
  if (prev.touched !== null && request.start - prev.touched >= (prev.ttl ?? FIVE_MINUTES)) return 'cache expired'
  if (request.version && prev.version && request.version !== prev.version) return 'Claude Code upgraded'
  if (prev.resumed) return 'resumed'
  if (request.usage.speed === 'fast' && prev.speed && prev.speed !== 'fast') return 'speed change'
  if (request.effort !== prev.effort && prev.effort && !effortKeepsCache(request.model)) return 'effort change'
  return 'cause unknown'
}

/**
 * One transcript file's priced requests, summed by the hour they ended. `isSubagent` for a
 * subagent's file (`<session>/subagents/agent-*.jsonl`): its chain has no tool list to count and
 * no compactions. `lines` may hold a cut first line; it's skipped.
 */
export const summarizeFile = (lines: readonly string[], isSubagent: boolean): FileSummary => {
  const records: TranscriptRecord[] = []
  for (const line of lines) {
    if (line.trim() === '') continue
    try {
      records.push(JSON.parse(line) as TranscriptRecord)
    } catch {
      // half a line
    }
  }
  const byUuid = new Map<string, TranscriptRecord>()
  for (const r of records) if (r.uuid) byUuid.set(r.uuid, r)
  const up = (r: TranscriptRecord | undefined) => (r?.parentUuid ? byUuid.get(r.parentUuid) : undefined)

  let first: number | null = null
  let cwd: string | null = null
  let chain: Chain = {
    key: null,
    prompt: 0,
    model: null,
    effort: null,
    version: null,
    touched: null,
    ttl: null,
    compacted: false,
    resumed: false,
    speed: null,
  }
  // The first main request's prompt (mostly Claude Code's tool list and system prompt), and the
  // tool list as measured by a request that could only read that much back.
  let prefix: { tokens: number; model: string } | null = null
  let toolList: { tokens: number; model: string } | null = null
  const requests = new Map<string, Request>()

  const classify = (request: Request): void => {
    request.rewriteCost = 0
    request.cause = null
    const prev = request.prev
    if (!prev.key || !prev.prompt) return
    const prompt = promptOf(request.usage)
    const read = usageParts(request.usage).read
    const tools = isSubagent || toolList === null ? 0 : convertTokens(toolList.tokens, toolList.model, request.model)
    let couldRead = Math.min(prompt, Math.round(convertTokens(prev.prompt, prev.model, request.model)))
    if (prev.compacted && !isSubagent) {
      if (!tools) return // no telling what was still cached
      couldRead = Math.min(couldRead, Math.round(tools))
    }
    const missed = Math.max(0, couldRead - read)
    if (missed < Math.max(REWRITE_MIN_TOKENS, REWRITE_SHARE * Math.max(couldRead - tools, 0))) return
    request.cause = causeOf(request, prev)
    const price = pricePaid(request.model, request.usage.speed ?? null, request.usage.inference_geo ?? null)
    if (price) {
      const ttl = ttlOf(request.usage) ?? prev.ttl ?? FIVE_MINUTES
      request.rewriteCost = (missed * (writePrice(price, ttl) - price.cache_read)) / 1_000_000
    }
  }

  const measureToolList = (request: Request): void => {
    const prompt = promptOf(request.usage)
    if (!prefix && prompt) prefix = { tokens: prompt, model: request.model }
    const read = usageParts(request.usage).read
    const prev = request.prev
    let cold: boolean
    let couldRead: number
    if (!prev.key || !prev.prompt) {
      cold = true
      couldRead = prompt
    } else {
      const expired = prev.touched !== null && request.start - prev.touched >= (prev.ttl ?? FIVE_MINUTES)
      const switched = modelKey(request.model) !== modelKey(prev.model)
      cold = prev.compacted || prev.resumed || expired || switched
      couldRead = Math.min(prompt, Math.round(convertTokens(prev.prompt, prev.model, request.model)))
    }
    // Not more than the first prompt: a forked conversation reads back more than the tool list.
    const firstPrompt = prefix ? convertTokens(prefix.tokens, prefix.model, request.model) : 0
    if (cold && read > 0 && read < couldRead && read <= firstPrompt) toolList = { tokens: read, model: request.model }
  }

  for (const r of records) {
    const at = time(r)
    if (at !== null && (first === null || at < first)) first = at
    if (r.cwd) cwd = r.cwd
    const message = r.message
    const model = message?.model
    const usage = message?.usage
    if (r.type === 'assistant' && r.isApiErrorMessage !== true && model && model !== '<synthetic>' && typeof usage === 'object' && usage !== null) {
      const key = message?.id ?? r.requestId ?? r.uuid
      if (!key) continue
      let request = requests.get(key)
      const isNew = request === undefined
      if (request === undefined) {
        // It started when its trigger was written: up past the attachments beside it.
        let trigger = up(r)
        while (trigger?.type === 'attachment') trigger = up(trigger)
        const starts = [time(trigger), at].filter((t): t is number => t !== null)
        if (starts.length === 0) continue
        const start = Math.min(...starts)
        request = { model, effort: r.effort ?? null, version: r.version ?? null, start, end: at ?? start, usage, prev: { ...chain }, rewriteCost: 0, cause: null }
        requests.set(key, request)
        if (!isSubagent) measureToolList(request)
      } else {
        request.end = at ?? request.end
        request.usage = usage
      }
      classify(request)
      if (chain.key === null || chain.key === key || isNew) {
        chain = {
          key,
          prompt: promptOf(usage),
          model,
          effort: request.effort,
          version: request.version,
          touched: request.start,
          ttl: ttlOf(usage) ?? chain.ttl,
          compacted: isNew ? false : chain.compacted,
          resumed: isNew ? false : chain.resumed,
          speed: usage.speed ?? null,
        }
      }
    } else if (!isSubagent && r.type === 'cost-state') {
      chain.resumed = true
    } else if (!isSubagent && r.type === 'system' && at !== null) {
      if (r.subtype === 'compact_boundary') {
        chain.compacted = true
        const took = r.compactMetadata?.durationMs
        if (chain.touched !== null && typeof took === 'number') chain.touched = Math.max(chain.touched, at - took)
      } else if (r.subtype === 'away_summary' && chain.touched !== null) {
        chain.touched = Math.max(chain.touched, at - RECAP_LAG)
      }
    }
  }

  const hours: Record<string, Bucket> = {}
  for (const request of requests.values()) {
    const price = pricePaid(request.model, request.usage.speed ?? null, request.usage.inference_geo ?? null)
    if (price === null) continue
    const cost = requestCost(request.usage, price)
    const hour = String(Math.floor(request.end / HOUR))
    const bucket = (hours[hour] ??= { spend: 0, requests: 0, read: 0, prompt: 0, misses: 0, causes: {}, models: {}, bands: {} })
    bucket.spend += cost
    bucket.requests += 1
    bucket.read += usageParts(request.usage).read
    bucket.prompt += promptOf(request.usage)
    bucket.misses += request.rewriteCost
    if (request.cause) bucket.causes[request.cause] = (bucket.causes[request.cause] ?? 0) + request.rewriteCost
    const model = `${modelKey(request.model) ?? request.model}${request.usage.speed === 'fast' ? ' fast' : ''}`
    bucket.models[model] = (bucket.models[model] ?? 0) + cost
    const band = bandOf(promptOf(request.usage))
    bucket.bands[band] = (bucket.bands[band] ?? 0) + cost
  }
  return { first, cwd, hours }
}

/**
 * Merges file summaries over the `period` up to `now` (to the hour). `offsetMinutes` is the
 * machine's time zone, for "the first day the transcripts cover" (usdash's covered_from).
 */
/** Where a session ran, as usdash groups them: its folder's path, "no folder" for a Desktop session started without one. */
const folderKey = (cwd: string | null): string =>
  cwd === null ? '?' : cwd.includes('/Library/Application Support/Claude/') ? 'no folder' : cwd

/** Each folder's name, with as much of the path before it as tells it apart: "api", or "work/api" and "personal/api". */
export const folderNames = (keys: readonly string[]): Record<string, string> => {
  const parts: Record<string, string[]> = {}
  const depth: Record<string, number> = {}
  for (const key of keys) {
    parts[key] = key.startsWith('/') ? key.split('/').filter(p => p !== '') : [key]
    depth[key] = 1
  }
  for (;;) {
    const names: Record<string, string> = {}
    for (const key of keys) names[key] = parts[key]!.slice(-depth[key]!).join('/')
    const seen: Record<string, string[]> = {}
    for (const key of keys) (seen[names[key]!] ??= []).push(key)
    const clashes = Object.values(seen).filter(same => same.length > 1).flat().filter(key => depth[key]! < parts[key]!.length)
    if (clashes.length === 0) return names
    for (const key of clashes) depth[key]! += 1
  }
}

/** The biggest `top` of `values` by spend, the rest folded into "others". */
const ranked = (values: Record<string, number>, top: number, name: (key: string) => string = k => k) => {
  const sorted = Object.entries(values)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
  const shares = sorted.slice(0, top).map(([k, v]) => ({ name: name(k), spend: v }))
  const rest = sorted.slice(top).reduce((sum, [, v]) => sum + v, 0)
  return rest > 0 ? [...shares, { name: 'others', spend: rest }] : shares
}

/** A model key as the screen shows it: "Opus 5.5", "Opus 5.5 fast". */
const modelName = (key: string): string =>
  key.endsWith(' fast') ? `${prettyModel(key.slice(0, -' fast'.length))} fast` : prettyModel(key)

/**
 * Merges file summaries over the `period` up to `now` (to the hour). `offsetMinutes` is the
 * machine's time zone, for the days (the chart's, and usdash's covered_from).
 */
export const mergeStats = (files: readonly FileSummary[], now: number, period: number, offsetMinutes: number): Stats30 => {
  const start = now - period
  const fromHour = Math.floor(start / HOUR)
  let spend = 0
  let requests = 0
  let read = 0
  let prompt = 0
  let misses = 0
  let history: number | null = null
  const causes: Record<string, number> = {}
  const models: Record<string, number> = {}
  const families: Record<string, number> = {}
  const bands: Record<string, number> = {}
  const folders: Record<string, number> = {}
  for (const file of files) {
    if (file.first !== null && (history === null || file.first < history)) history = file.first
    const folder = folderKey(file.cwd)
    for (const [hour, b] of Object.entries(file.hours)) {
      if (Number(hour) < fromHour) continue
      spend += b.spend
      requests += b.requests
      read += b.read
      prompt += b.prompt
      misses += b.misses
      folders[folder] = (folders[folder] ?? 0) + b.spend
      for (const [k, v] of Object.entries(b.causes)) causes[k] = (causes[k] ?? 0) + v
      for (const [k, v] of Object.entries(b.models)) {
        models[k] = (models[k] ?? 0) + v
        const family = k.replace(/ fast$/, '')
        families[family] = (families[family] ?? 0) + v
      }
      for (const [k, v] of Object.entries(b.bands ?? {})) bands[k] = (bands[k] ?? 0) + v
    }
  }
  const offset = offsetMinutes * 60_000
  // Spend on each of the last 30 local days, today last.
  const today = Math.floor((now + offset) / DAY)
  const days = Array.from({ length: 30 }, () => 0)
  for (const file of files) {
    for (const [hour, b] of Object.entries(file.hours)) {
      const index = 29 - (today - Math.floor((Number(hour) * HOUR + offset) / DAY))
      if (index >= 0 && index < 30) days[index]! += b.spend
    }
  }
  const firstDay = history === null ? start : Math.floor((history + offset) / DAY) * DAY - offset
  const coveredFrom = history === null || history <= start ? start : Math.max(start, firstDay)
  const covered = (now - coveredFrom) / DAY
  const top = Object.entries(families).sort((a, b) => b[1] - a[1])[0]
  const cause = Object.entries(causes).sort((a, b) => b[1] - a[1])[0]
  const names = folderNames(Object.keys(folders))
  return {
    spend,
    requests,
    perDay: covered > 1 ? spend / covered : null,
    cached: prompt ? read / prompt : null,
    misses,
    topCause: cause ? cause[0] : null,
    topModel: top && spend > 0 ? { name: prettyModel(top[0]), share: top[1] / spend } : null,
    coveredFrom,
    days,
    at: now,
    byModel: ranked(models, 4, modelName),
    byProject: ranked(folders, 5, key => names[key] ?? key),
    byCause: ranked(causes, 5),
    byContext: BANDS.map(([, label]) => ({ name: label, spend: bands[label] ?? 0 })).filter(b => b.spend > 0),
  }
}
