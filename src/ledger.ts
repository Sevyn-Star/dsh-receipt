import { repeatText } from './phrase.ts'
import { findModelPrice, rate, type PriceTable, DEFAULT_PRICES } from './prices.ts'
import type { ProjectedStep, Projection, Usage } from './project.ts'
import { blindRetryIndexes } from './waste.ts'

/** 点开卡片后的一行：同一件事、次数、这笔浪费。micro 为 null 表示这组还没定价。 */
export interface RepeatLine {
  readonly text: string
  readonly count: number
  readonly micro: number | null
}

const REPEAT_LIMIT = 4

/** 1 单位 = 10^-6 美元。 */
export interface Receipt {
  /** 最近一步的金额。这一步没能定价时是 null，避免把「不知道」显示成 $0。 */
  readonly latestStepMicro: number | null
  readonly sessionMicro: number
  readonly wasteMicro: number
  readonly wasteCount: number
  readonly unpricedSteps: number
  readonly currency: PriceTable['currency']
  readonly period: PriceTable['period']
  readonly priceCheckedOn: string
  readonly repeats: readonly RepeatLine[]
}

export function tally(projection: Projection, prices: PriceTable = DEFAULT_PRICES): Receipt {
  const blind = new Set(blindRetryIndexes(projection.calls))
  let sessionMicro = 0
  let wasteMicro = 0
  let wasteCount = 0
  let unpricedSteps = 0
  let latestStepMicro: number | null = null

  projection.steps.forEach((step, index) => {
    const cost = stepCost(step, prices)
    const isLatest = index === projection.steps.length - 1
    if (cost === null) {
      unpricedSteps += 1
      if (isLatest) latestStepMicro = null
      return
    }
    sessionMicro += cost
    if (isLatest) latestStepMicro = cost
    const indexes = step.callIndexes.filter(callIndex => projection.calls[callIndex]?.settled)
    if (indexes.length === 0) return
    const blindCount = indexes.filter(callIndex => blind.has(callIndex)).length
    wasteCount += blindCount
    wasteMicro += Math.round((cost * blindCount) / indexes.length)
  })

  if (projection.steps.length === 0) latestStepMicro = 0

  return {
    latestStepMicro,
    sessionMicro,
    wasteMicro,
    wasteCount,
    unpricedSteps,
    currency: prices.currency,
    period: prices.period,
    priceCheckedOn: prices.checkedOn,
    repeats: repeatLines(projection, wasteShares(projection, prices, blind), blind),
  }
}

export function formatUsd(micro: number): string {
  const sign = micro < 0 ? '-' : ''
  const absolute = Math.abs(Math.round(micro))
  const dollars = Math.floor(absolute / 1_000_000)
  const fraction = String(absolute % 1_000_000).padStart(6, '0').replace(/0+$/, '')
  return fraction ? `${sign}$${dollars}.${fraction}` : `${sign}$${dollars}`
}

function wasteShares(
  projection: Projection,
  prices: PriceTable,
  blind: ReadonlySet<number>,
): readonly (number | null)[] {
  const shares: (number | null)[] = projection.calls.map(() => 0)
  for (const step of projection.steps) {
    const cost = stepCost(step, prices)
    const settled = step.callIndexes.filter(index => projection.calls[index]?.settled)
    const retries = settled.filter(index => blind.has(index))
    if (cost === null) {
      for (const index of retries) shares[index] = null
      continue
    }
    if (retries.length === 0 || settled.length === 0) continue
    const stepWaste = Math.round((cost * retries.length) / settled.length)
    let used = 0
    retries.forEach((index, nth) => {
      if (nth === retries.length - 1) {
        shares[index] = stepWaste - used
        return
      }
      const share = Math.round(stepWaste / retries.length)
      shares[index] = share
      used += share
    })
  }
  return shares
}

interface MutableRepeat {
  action: string
  verb: string
  count: number
  micro: number
  unpriced: boolean
  order: number
}

function repeatLines(
  projection: Projection,
  shares: readonly (number | null)[],
  blind: ReadonlySet<number>,
): RepeatLine[] {
  const groups = new Map<string, MutableRepeat>()
  projection.calls.forEach((call, index) => {
    if (!blind.has(index)) return
    const share = index < shares.length ? shares[index] : 0
    const key = `${call.barrier}\u0000${call.name}\u0000${call.argsHash}`
    let group = groups.get(key)
    if (!group) {
      group = { action: call.action, verb: call.verb, count: 0, micro: 0, unpriced: false, order: index }
      groups.set(key, group)
    }
    group.count += 1
    if (share === null) group.unpriced = true
    else group.micro += share
  })

  const ranked = [...groups.values()].sort((left, right) => {
    const money = (right.unpriced ? -1 : right.micro) - (left.unpriced ? -1 : left.micro)
    return money === 0 ? left.order - right.order : money
  })
  const shown = ranked.slice(0, REPEAT_LIMIT).map(toLine)
  const rest = ranked.slice(REPEAT_LIMIT)
  if (rest.length > 0) {
    const micro = rest.reduce((sum, group) => sum + group.micro, 0)
    shown.push({
      text: `还有 ${rest.length} 组`,
      count: rest.reduce((sum, group) => sum + group.count, 0),
      micro: rest.some(group => group.unpriced) && micro === 0 ? null : micro,
    })
  }
  return shown
}

function toLine(group: MutableRepeat): RepeatLine {
  return {
    text: repeatText(group.action, group.verb, group.count),
    count: group.count,
    micro: group.unpriced && group.micro === 0 ? null : group.micro,
  }
}

function stepCost(step: ProjectedStep, prices: PriceTable): number | null {
  if (usageTokens(step.usage) === 0) return 0
  if (!step.model) return null
  const model = findModelPrice(step.model, prices)
  if (!model) return null
  const period = prices.period
  return (
    tokensToMicro(step.usage.cacheReadTokens, rate(model.cacheHit, period))
    + tokensToMicro(step.usage.inputTokens, rate(model.cacheMiss, period))
    + tokensToMicro(step.usage.cacheWriteTokens, rate(model.cacheMiss, period))
    + tokensToMicro(step.usage.outputTokens, rate(model.output, period))
  )
}

function tokensToMicro(tokens: number, microPerMillion: number): number {
  return Math.round((tokens * microPerMillion) / 1_000_000)
}

function usageTokens(usage: Usage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}
