/** 把一次工具调用收成一句人话。只留路径、搜索词或命令，不留整段参数。 */
export interface CallPhrase {
  readonly verb: string
  readonly action: string
}

const VERB: Record<string, string> = {
  read: '读',
  write: '写',
  edit: '改',
  grep: '搜',
  glob: '找',
  search: '搜',
  bash: '跑',
}

export function callPhrase(name: string, rawArguments: string): CallPhrase {
  const verb = VERB[name] ?? '调用'
  const target = targetOf(name, argumentObject(rawArguments))
  if (!target) {
    return verb === '调用'
      ? { verb: '调用', action: `调用 ${name}` }
      : { verb, action: verb }
  }
  return { verb, action: `${verb} ${clip(target)}` }
}

export function repeatText(action: string, verb: string, count: number): string {
  return `${action}，失败后又${verb}了 ${count} 次`
}

function argumentObject(rawArguments: string): Record<string, unknown> {
  try {
    const value = JSON.parse(rawArguments) as unknown
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch {
    // 参数不是 JSON 时，句子里只留工具名。
  }
  return {}
}

function targetOf(name: string, args: Record<string, unknown>): string | null {
  if (name === 'bash') return firstLine(stringArg(args, 'command'))
  if (name === 'grep' || name === 'glob' || name === 'search') {
    return stringArg(args, 'pattern') ?? stringArg(args, 'query') ?? stringArg(args, 'q') ?? stringArg(args, 'path')
  }
  return stringArg(args, 'file_path')
    ?? stringArg(args, 'path')
    ?? stringArg(args, 'pattern')
    ?? stringArg(args, 'query')
    ?? stringArg(args, 'q')
    ?? firstLine(stringArg(args, 'command'))
}

function stringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function firstLine(value: string | null): string | null {
  if (!value) return null
  const line = value.split('\n')[0]?.trim() ?? ''
  return line || null
}

function clip(text: string): string {
  const clean = text.replace(/`/g, "'").replace(/\s+/g, ' ').trim()
  const limit = 72
  const shown = clean.length <= limit ? clean : `${clean.slice(0, limit)}…`
  return `\`${shown}\``
}
