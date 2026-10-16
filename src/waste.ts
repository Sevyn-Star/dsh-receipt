/**
 * 盲重试：三条同时成立才算。
 *
 * 1. 同一个工具
 * 2. 同一组参数（参数按 JSON 键排序后哈希，键的顺序不同仍算同一组）
 * 3. 上一次相同调用已经失败，或者返回是空的，而且中间没有新的用户消息
 *
 * 「上一次」指更早的、工具名和参数哈希都相同的最近一次已结束调用。
 * 第一次失败本身不算浪费。中间换了参数、上一次其实成功了、或者用户又说了一句话，都不算。
 * 还没返回的调用先不算，避免把进行中的一步提前记成浪费。
 *
 * 正例：
 * - 读文件失败，紧接着用同一路径再读一次
 * - 搜索返回空文本，紧接着用同一句话再搜一次
 * - 读文件失败，中间先跑了别的工具，又用同一路径再读一次
 *
 * 反例：
 * - 读文件失败，下一回换成另一个路径
 * - 读文件已经成功，再用同一路径读一次
 * - 读文件失败，用户又发了一条消息，然后才用同一路径再读
 */

import type { ProjectedCall } from './project.ts'

export function isBlindRetry(calls: readonly ProjectedCall[], index: number): boolean {
  const call = calls[index]
  if (!call || !call.settled) return false
  for (let i = index - 1; i >= 0; i--) {
    const previous = calls[i]
    if (!previous || previous.name !== call.name || previous.argsHash !== call.argsHash) continue
    if (!previous.settled) return false
    if (previous.barrier !== call.barrier) return false
    return previous.failed || previous.empty
  }
  return false
}

export function blindRetryIndexes(calls: readonly ProjectedCall[]): number[] {
  const indexes: number[] = []
  for (let index = 0; index < calls.length; index++) {
    if (isBlindRetry(calls, index)) indexes.push(index)
  }
  return indexes
}
