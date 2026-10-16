import { findModelPrice, rate, type PriceTable, DEFAULT_PRICES } from './prices.ts'
import type { ProjectedStep, Projection, Usage } from './project.ts'
import { blindRetryIndexes } from './waste.ts'

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
  }
}

export function formatUsd(micro: number): string {
  const sign = micro < 0 ? '-' : ''
  const absolute = Math.abs(Math.round(micro))
  const dollars = Math.floor(absolute / 1_000_000)
  const fraction = String(absolute % 1_000_000).padStart(6, '0').replace(/0+$/, '')
  return fraction ? `${sign}$${dollars}.${fraction}` : `${sign}$${dollars}`
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
