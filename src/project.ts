import { createHash } from 'node:crypto'

/** 一份已经从会话日志里拆出来的用量。四项互不重叠。 */
export interface Usage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

export interface ProjectedCall {
  readonly callId: string
  readonly name: string
  readonly argsHash: string
  readonly failed: boolean
  readonly empty: boolean
  readonly settled: boolean
  /** 每出现一条真人用户消息就加一。屏障不同，说明中间有人又说了话。 */
  readonly barrier: number
  readonly turn: number
  readonly step: number
}

export interface ProjectedStep {
  readonly turn: number
  readonly step: number
  readonly model: string | null
  readonly usage: Usage
  readonly callIndexes: readonly number[]
}

export interface Projection {
  readonly calls: readonly ProjectedCall[]
  readonly steps: readonly ProjectedStep[]
}

export interface SessionEvent {
  readonly type: string
  readonly data?: unknown
  readonly seq?: number
}

const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

interface MutableStep {
  turn: number
  step: number
  model: string | null
  usage: Usage
  callIndexes: number[]
}

export function argsHash(rawArguments: string): string {
  return createHash('sha256').update(canonicalArgs(rawArguments)).digest('hex')
}

export function canonicalArgs(rawArguments: string): string {
  try {
    return JSON.stringify(sortKeys(JSON.parse(rawArguments)))
  } catch {
    return rawArguments
  }
}

export function project(events: readonly SessionEvent[]): Projection {
  const calls: ProjectedCall[] = []
  const steps: MutableStep[] = []
  const callAt = new Map<string, number>()
  let barrier = 0
  let model: string | null = null

  for (const event of events) {
    const data = asRecord(event.data)
    if (event.type === 'model/selection' || event.type === 'request/context' || event.type === 'request/header') {
      const next = readModel(data)
      if (next) model = next
      continue
    }
    if (event.type === 'user/message') {
      if (userKind(data) === 'user') barrier += 1
      continue
    }
    if (event.type === 'assistant/message') {
      const step = ensureStep(steps, numberField(data, 'turn'), numberField(data, 'step'), model)
      step.model = model
      step.usage = addUsage(step.usage, usageOf(data.usage))
      continue
    }
    if (event.type === 'tool/call') {
      const callId = stringField(data, 'callId')
      const name = stringField(data, 'name')
      if (!callId || !name) continue
      const step = ensureStep(steps, numberField(data, 'turn'), numberField(data, 'step'), model)
      const index = calls.length
      calls.push({
        callId,
        name,
        argsHash: argsHash(stringField(data, 'arguments') ?? ''),
        failed: false,
        empty: false,
        settled: false,
        barrier,
        turn: step.turn,
        step: step.step,
      })
      callAt.set(callId, index)
      step.callIndexes.push(index)
      continue
    }
    if (event.type === 'tool/result') {
      const message = asRecord(data.message)
      const callId = stringField(message, 'toolCallId') ?? stringField(data, 'callId')
      if (!callId) continue
      const index = callAt.get(callId)
      const current = index === undefined ? undefined : calls[index]
      if (!current) continue
      const failed = message.isError === true || data.error != null
      calls[index] = {
        ...current,
        failed,
        empty: resultEmpty(message.content),
        settled: true,
      }
    }
  }

  return { calls, steps }
}

function ensureStep(steps: MutableStep[], turn: number, step: number, model: string | null): MutableStep {
  const found = steps.find(item => item.turn === turn && item.step === step)
  if (found) return found
  const created: MutableStep = { turn, step, model, usage: EMPTY_USAGE, callIndexes: [] }
  steps.push(created)
  return created
}

function usageOf(value: unknown): Usage {
  const usage = asRecord(value)
  return {
    inputTokens: numberField(usage, 'inputTokens'),
    outputTokens: numberField(usage, 'outputTokens'),
    cacheReadTokens: numberField(usage, 'cacheReadTokens'),
    cacheWriteTokens: numberField(usage, 'cacheWriteTokens'),
  }
}

function addUsage(left: Usage, right: Usage): Usage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
  }
}

function resultEmpty(content: unknown): boolean {
  if (content == null) return true
  if (typeof content === 'string') return content.trim() === ''
  if (!Array.isArray(content)) return false
  if (content.length === 0) return true
  return content.every(block => {
    const record = asRecord(block)
    if (record.type !== 'text') return false
    return typeof record.text !== 'string' || record.text.trim() === ''
  })
}

function userKind(data: Record<string, unknown>): string | null {
  const source = asRecord(data.source)
  return typeof source.kind === 'string' ? source.kind : null
}

/** 模型名可能在事件顶层，也可能在 request/header 的 header.config 里。 */
export function readModel(data: unknown): string | null {
  const record = asRecord(data)
  const direct = stringField(record, 'model')
  if (direct) return direct
  const config = asRecord(asRecord(record.header).config)
  return stringField(config, 'model')
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function stringField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberField(data: Record<string, unknown>, key: string): number {
  const value = data[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}
