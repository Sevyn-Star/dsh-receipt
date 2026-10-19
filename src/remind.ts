import { randomUUID } from 'node:crypto'
import type { ProjectedCall } from './project.ts'
import { isBlindRetry } from './waste.ts'

export const REMINDER_TEXT = '上一次同样的调用已经失败，不要用同一组参数再试。'

/** 没写 remind 时默认开着。false、off、false 字符串都关掉。 */
export function remindEnabled(config: unknown): boolean {
  if (!config || typeof config !== 'object' || !('remind' in config)) return true
  const value = (config as { remind: unknown }).remind
  return value !== false && value !== 'off' && value !== 'false'
}

export function reminderMessage(): {
  role: 'user'
  id: string
  content: [{ type: 'text'; text: string }]
  source: { kind: 'dsh-receipt'; form: 'notice'; summary: string }
} {
  return {
    role: 'user',
    id: randomUUID(),
    content: [{ type: 'text', text: REMINDER_TEXT }],
    source: { kind: 'dsh-receipt', form: 'notice', summary: REMINDER_TEXT },
  }
}

/** 这次结算是盲重试时，返回这一组的键。同一组只提醒一次，由调用方记住。 */
export function blindGroupKey(calls: readonly ProjectedCall[], callId: string): string | null {
  const index = calls.findIndex(call => call.callId === callId)
  if (!isBlindRetry(calls, index)) return null
  const call = calls[index]
  if (!call) return null
  return `${call.barrier}\u0000${call.name}\u0000${call.argsHash}`
}

export function takeReminder(enabled: boolean, key: string | null, seen: Set<string>): boolean {
  if (!enabled || !key || seen.has(key)) return false
  seen.add(key)
  return true
}
