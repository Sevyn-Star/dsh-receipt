/**
 * 默认价目，抄自 DeepSeek 公开定价页，核对日期见 PRICE_CHECKED_ON。
 * 单位是微美元 / 每百万 token：1 微美元 = 10^-6 美元。
 * 按「分」取整会把这些单价全部变成 0，所以不用分。
 *
 * 来源：https://api-docs.deepseek.com/quick_start/pricing/
 * 忙时（peak）是 UTC 工作日 01:00–04:00 与 06:00–10:00，不含中国法定假日。
 * 其余时间、周末和中国法定假日全天都是闲时（off-peak），闲时是忙时的一半。
 * 默认按闲时估算，因为一天里大部分时间是闲时。
 *
 * cacheWriteTokens 在官方表上没有单独一行。DeepSeek Harness 把未缓存输入、
 * 缓存读取、缓存写入分成三份互不重叠的计数，写入按未命中单价估算。
 * reasoningTokens 通常已经含在 outputTokens 里，不再加一次。
 */

export const PRICE_SOURCE = 'https://api-docs.deepseek.com/quick_start/pricing/'
export const PRICE_CHECKED_ON = '2026-10-15'

export type PricePeriod = 'off-peak' | 'peak'

export interface RatePair {
  readonly offPeak: number
  readonly peak: number
}

/** 某模型每百万 token 的微美元单价。 */
export interface ModelPrice {
  readonly id: string
  readonly aliases: readonly string[]
  readonly cacheHit: RatePair
  readonly cacheMiss: RatePair
  readonly output: RatePair
}

export interface PriceTable {
  readonly currency: 'USD'
  readonly period: PricePeriod
  readonly checkedOn: string
  readonly source: string
  readonly models: readonly ModelPrice[]
}

const flash: ModelPrice = {
  id: 'deepseek-flash',
  aliases: ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'DeepSeek-V4.1-Flash'],
  cacheHit: { offPeak: 3_000, peak: 6_000 },
  cacheMiss: { offPeak: 150_000, peak: 300_000 },
  output: { offPeak: 600_000, peak: 1_200_000 },
}

const pro: ModelPrice = {
  id: 'deepseek-v4-pro',
  aliases: ['DeepSeek-V4-Pro-0813'],
  cacheHit: { offPeak: 22_000, peak: 44_000 },
  cacheMiss: { offPeak: 660_000, peak: 1_320_000 },
  output: { offPeak: 1_980_000, peak: 3_960_000 },
}

export const DEFAULT_PRICES: PriceTable = {
  currency: 'USD',
  period: 'off-peak',
  checkedOn: PRICE_CHECKED_ON,
  source: PRICE_SOURCE,
  models: [flash, pro],
}

export function findModelPrice(model: string, table: PriceTable = DEFAULT_PRICES): ModelPrice | null {
  const candidates = modelNames(model)
  for (const needle of candidates) {
    for (const entry of table.models) {
      if (entry.id.toLowerCase() === needle) return entry
      if (entry.aliases.some(alias => alias.toLowerCase() === needle)) return entry
    }
  }
  return null
}

function modelNames(model: string): string[] {
  const full = model.trim().toLowerCase()
  const slash = full.lastIndexOf('/')
  if (slash === -1 || slash === full.length - 1) return [full]
  return [full, full.slice(slash + 1)]
}

export function rate(pair: RatePair, period: PricePeriod): number {
  return period === 'peak' ? pair.peak : pair.offPeak
}

/** 插件配置目前只切换闲时 / 忙时。没写或写错都落回闲时价目。 */
export function pricesFromConfig(config: unknown): PriceTable {
  const period = config && typeof config === 'object' && 'period' in config && config.period === 'peak'
    ? 'peak'
    : 'off-peak'
  return { ...DEFAULT_PRICES, period }
}
