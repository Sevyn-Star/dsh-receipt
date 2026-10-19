import { readFileSync } from 'node:fs'
import { Book, readStreamUsage } from './book.ts'
import { pricesFromConfig } from './prices.ts'
import type { SessionEvent } from './project.ts'
import { blindGroupKey, reminderMessage, remindEnabled, takeReminder } from './remind.ts'

const CARD_SOURCE = readFileSync(new URL('./card.js', import.meta.url), 'utf8')
const CARD_BOOT = 'var s=document.createElement("script");s.src="/dsh-receipt/card.js";s.onerror=function(){};document.body.appendChild(s);'

interface IndexRow {
  kind: string
  placement?: string
  text?: string
  src?: string
}

interface LiveSession {
  id?: unknown
  snapshotEvents?: () => readonly { type?: unknown; data?: unknown; seq?: unknown; time?: unknown }[]
}

interface SessionStore {
  list(): readonly LiveSession[]
}

interface PluginContext {
  on(event: string, listener: (...args: never[]) => void): void
  inject?(names: string[], callback: (ctx: PluginContext) => void): void
  get?(name: string): unknown
  sessions?: SessionStore
  webServer?: {
    register(route: { kind: 'exact'; path: string; handler: (req: IncomingRequest, res: ServerResult) => void }): void
    tapIndex(transform: (html: string) => string): void
  }
}

interface IncomingRequest {
  url?: string
}

interface ServerResult {
  writeHead(code: number, headers: Record<string, string>): void
  end(body: string): void
}

export const name = 'dsh-receipt'

export function apply(ctx: PluginContext, config?: unknown): void {
  const book = new Book(pricesFromConfig(config))
  const remind = remindEnabled(config)
  const reminded = new Set<string>()

  ctx.on('webserver/index-inject', ((table: IndexRow[]) => {
    const already = table.some(row => row.src === '/dsh-receipt/card.js' || (row.text ?? '').includes('/dsh-receipt/card.js'))
    if (!already) table.push({ kind: 'script', placement: 'body', text: CARD_BOOT })
  }) as (...args: never[]) => void)

  ctx.on('session/created', ((session: LiveSession) => {
    seedSession(book, session)
  }) as (...args: never[]) => void)

  ctx.on('session/event', ((session: { id?: unknown }, event: { type?: unknown; data?: unknown; seq?: unknown }) => {
    if (typeof session?.id !== 'string' || typeof event?.type !== 'string') return
    const next: SessionEvent = {
      type: event.type,
      data: event.data,
      seq: typeof event.seq === 'number' ? event.seq : undefined,
    }
    if (!book.append(session.id, next)) return
    remindSession(ctx, book, session.id, next, remind, reminded)
  }) as (...args: never[]) => void)

  try {
    ctx.on('agent/assistant-stream', ((payload: unknown) => {
      const usage = readStreamUsage(payload)
      if (usage) book.previewLatest(usage)
    }) as (...args: never[]) => void)
  } catch {
    // 旧宿主没有这条流时，卡片仍在每步结算后更新。
  }

  const mount = (context: PluginContext) => {
    const web = context.webServer
    if (!web) return
    web.register({
      kind: 'exact',
      path: '/dsh-receipt/card.js',
      handler: (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' })
        res.end(CARD_SOURCE)
      },
    })
    web.register({
      kind: 'exact',
      path: '/dsh-receipt/latest',
      handler: (req, res) => {
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        const sessionId = sessionQuery(req.url)
        res.end(JSON.stringify(sessionId ? book.receipt(sessionId) : book.latest()))
      },
    })
    web.tapIndex(insertCardTag)
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], mount)
    ctx.inject(['sessions'], (context) => {
      const sessions = context.sessions
      if (!sessions || typeof sessions.list !== 'function') return
      const live = [...sessions.list()].sort((left, right) => lastEventTime(left) - lastEventTime(right))
      for (const session of live) seedSession(book, session)
    })
  } else mount(ctx)
}

function remindSession(
  ctx: PluginContext,
  book: Book,
  sessionId: string,
  event: SessionEvent,
  enabled: boolean,
  reminded: Set<string>,
): void {
  const callId = settledCallId(event)
  if (!callId) return
  const key = blindGroupKey(book.calls(sessionId), callId)
  if (!takeReminder(enabled, key === null ? null : `${sessionId}\u0000${key}`, reminded)) return
  const agents = ctx.get?.('agents') as { get?: (id: string) => { inject?: (message: unknown) => void } | undefined } | undefined
  const agent = agents?.get?.(sessionId)
  if (typeof agent?.inject !== 'function') {
    reminded.delete(`${sessionId}\u0000${key}`)
    return
  }
  try {
    agent.inject(reminderMessage())
  } catch {
    reminded.delete(`${sessionId}\u0000${key}`)
  }
}

function settledCallId(event: SessionEvent): string | null {
  if (event.type !== 'tool/result') return null
  const data = event.data
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  const message = record.message
  if (message && typeof message === 'object') {
    const callId = (message as Record<string, unknown>).toolCallId
    if (typeof callId === 'string' && callId) return callId
  }
  return typeof record.callId === 'string' && record.callId ? record.callId : null
}

function sessionQuery(url: string | undefined): string | null {
  if (!url) return null
  const query = url.includes('?') ? url.slice(url.indexOf('?')) : ''
  const sessionId = new URLSearchParams(query).get('session')
  return sessionId && sessionId.length > 0 ? sessionId : null
}

function seedSession(book: Book, session: LiveSession): void {
  if (typeof session.id !== 'string' || typeof session.snapshotEvents !== 'function') return
  const events: SessionEvent[] = []
  for (const event of session.snapshotEvents()) {
    if (typeof event?.type !== 'string') continue
    events.push({
      type: event.type,
      data: event.data,
      seq: typeof event.seq === 'number' ? event.seq : undefined,
    })
  }
  book.seed(session.id, events)
}

function lastEventTime(session: LiveSession): number {
  if (typeof session.snapshotEvents !== 'function') return 0
  const events = session.snapshotEvents()
  const last = events.at(-1)
  return typeof last?.time === 'number' ? last.time : 0
}

export function insertCardTag(html: string): string {
  if (html.includes('/dsh-receipt/card.js')) return html
  const tag = '<script defer src="/dsh-receipt/card.js"></script>'
  const end = html.toLowerCase().lastIndexOf('</body>')
  if (end === -1) return `${html}${tag}`
  return `${html.slice(0, end)}${tag}${html.slice(end)}`
}
