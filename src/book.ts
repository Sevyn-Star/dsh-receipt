import { tally, type Receipt } from './ledger.ts'
import { findModelPrice, rate, type PriceTable } from './prices.ts'
import { project, readModel, type ProjectedCall, type SessionEvent, type Usage } from './project.ts'

const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

/** 每个会话一份事件，外加还没结算的那一步用量。 */
export class Book {
  private readonly events = new Map<string, SessionEvent[]>()
  private readonly pending = new Map<string, Usage>()
  private readonly seen: string[] = []
  private readonly watermark = new Map<string, number>()
  private readonly prices: PriceTable

  constructor(prices: PriceTable) {
    this.prices = prices
  }

  /** 用会话里已经存在的日志整份替换。宿主恢复旧会话时不会重放这些事件。 */
  seed(sessionId: string, events: readonly SessionEvent[]): void {
    this.events.set(sessionId, events.map(event => ({ type: event.type, data: event.data })))
    let watermark = -1
    for (const event of events) {
      if (typeof event.seq === 'number' && event.seq > watermark) watermark = event.seq
    }
    if (watermark >= 0) this.watermark.set(sessionId, watermark)
    this.pending.delete(sessionId)
    this.touch(sessionId)
  }

  /** 同一序号已经记过时返回 false，避免提醒插第二次。 */
  append(sessionId: string, event: SessionEvent): boolean {
    if (typeof event.seq === 'number') {
      const watermark = this.watermark.get(sessionId) ?? -1
      if (event.seq <= watermark) return false
      this.watermark.set(sessionId, event.seq)
    }
    const list = this.events.get(sessionId) ?? []
    list.push({ type: event.type, data: event.data })
    this.events.set(sessionId, list)
    this.touch(sessionId)
    if (event.type === 'assistant/message') this.pending.delete(sessionId)
    return true
  }

  calls(sessionId: string): readonly ProjectedCall[] {
    return project(this.events.get(sessionId) ?? []).calls
  }

  /** 进行中的模型调用。只改这一步和这场的金额，不算进浪费。 */
  preview(sessionId: string, usage: Usage): void {
    this.pending.set(sessionId, usage)
    this.touch(sessionId)
  }

  previewLatest(usage: Usage): void {
    const sessionId = this.seen.at(-1)
    if (!sessionId) return
    this.preview(sessionId, usage)
  }

  latest(): Receipt {
    const sessionId = this.seen.at(-1)
    if (!sessionId) return tally(project([]), this.prices)
    return this.receipt(sessionId)
  }

  receipt(sessionId: string): Receipt {
    const base = tally(project(this.events.get(sessionId) ?? []), this.prices)
    const extra = this.pending.get(sessionId)
    if (!extra) return base
    return addOpenStep(base, extra, modelOf(this.events.get(sessionId) ?? []), this.prices)
  }

  private touch(sessionId: string): void {
    const at = this.seen.indexOf(sessionId)
    if (at !== -1) this.seen.splice(at, 1)
    this.seen.push(sessionId)
  }
}

export function addOpenStep(receipt: Receipt, usage: Usage, model: string | null, prices: PriceTable): Receipt {
  const cost = priceUsage(usage, model, prices)
  if (cost === null) {
    return { ...receipt, latestStepMicro: null, unpricedSteps: receipt.unpricedSteps + 1 }
  }
  return {
    ...receipt,
    latestStepMicro: cost,
    sessionMicro: receipt.sessionMicro + cost,
  }
}

export function readStreamUsage(payload: unknown): Usage | null {
  const usage = firstUsage([
    readPath(payload, ['usage']),
    readPath(payload, ['frame', 'usage']),
    readPath(payload, ['frame', 'chunk', 'usage']),
    readPath(payload, ['chunk', 'usage']),
  ])
  if (!usage) return null
  return {
    inputTokens: numberField(usage, 'inputTokens'),
    outputTokens: numberField(usage, 'outputTokens'),
    cacheReadTokens: numberField(usage, 'cacheReadTokens'),
    cacheWriteTokens: numberField(usage, 'cacheWriteTokens'),
  }
}

function priceUsage(usage: Usage, model: string | null, prices: PriceTable): number | null {
  const tokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  if (tokens === 0) return 0
  if (!model) return null
  const found = findModelPrice(model, prices)
  if (!found) return null
  const period = prices.period
  return Math.round((usage.cacheReadTokens * rate(found.cacheHit, period)) / 1_000_000)
    + Math.round((usage.inputTokens * rate(found.cacheMiss, period)) / 1_000_000)
    + Math.round((usage.cacheWriteTokens * rate(found.cacheMiss, period)) / 1_000_000)
    + Math.round((usage.outputTokens * rate(found.output, period)) / 1_000_000)
}

function modelOf(events: readonly SessionEvent[]): string | null {
  let model: string | null = null
  for (const event of events) {
    if (event.type !== 'model/selection' && event.type !== 'request/context' && event.type !== 'request/header') continue
    const next = readModel(event.data)
    if (next) model = next
  }
  return model
}

function firstUsage(values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    if (value && typeof value === 'object' && 'inputTokens' in value) return value as Record<string, unknown>
  }
  return null
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const key of path) {
    if (!current || typeof current !== 'object' || !(key in current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function numberField(data: Record<string, unknown>, key: string): number {
  const value = data[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export { EMPTY_USAGE }
