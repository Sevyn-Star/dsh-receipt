import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Book, readStreamUsage } from '../src/book.ts'
import { insertCardTag } from '../src/index.ts'
import { DEFAULT_PRICES, pricesFromConfig } from '../src/prices.ts'
import type { SessionEvent } from '../src/project.ts'

const settled: SessionEvent[] = [
  { type: 'model/selection', data: { model: 'deepseek-flash' } },
  { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, outputTokens: 0 } } },
  { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"path":"a"}' } },
  { type: 'tool/result', data: { message: { toolCallId: 'c1', isError: true, content: [] } } },
]

test('进行中的用量只加在这一步上，结算后改回日志里的金额', () => {
  const book = new Book(DEFAULT_PRICES)
  for (const event of settled) book.append('s1', event)
  assert.equal(book.latest().sessionMicro, 150_000)
  book.preview('s1', { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
  assert.equal(book.latest().latestStepMicro, 150_000)
  assert.equal(book.latest().sessionMicro, 300_000)
  assert.equal(book.latest().wasteMicro, 0)
  book.append('s1', {
    type: 'assistant/message',
    data: { turn: 1, step: 2, usage: { inputTokens: 2_000_000, outputTokens: 0 } },
  })
  assert.equal(book.latest().sessionMicro, 450_000)
  assert.equal(book.latest().latestStepMicro, 300_000)
})

test('恢复会话时补上已经写完的日志，同一序号不记第二次', () => {
  const book = new Book(DEFAULT_PRICES)
  book.seed('s1', [
    { type: 'request/header', seq: 1, data: { header: { config: { model: 'deepseek-ai/DeepSeek-V4.1-Flash' } } } },
    { type: 'assistant/message', seq: 2, data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, outputTokens: 0 } } },
  ])
  assert.equal(book.latest().latestStepMicro, 150_000)
  book.append('s1', {
    type: 'assistant/message',
    seq: 2,
    data: { turn: 1, step: 2, usage: { inputTokens: 1_000_000, outputTokens: 0 } },
  })
  assert.equal(book.latest().sessionMicro, 150_000)
  book.append('s1', {
    type: 'assistant/message',
    seq: 3,
    data: { turn: 1, step: 2, usage: { inputTokens: 1_000_000, outputTokens: 0 } },
  })
  assert.equal(book.latest().sessionMicro, 300_000)
})

test('还没有会话时，流式用量不记到别人头上', () => {
  const book = new Book(DEFAULT_PRICES)
  book.previewLatest({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
  assert.equal(book.latest().sessionMicro, 0)
})

test('从流帧里读出用量', () => {
  const usage = readStreamUsage({ frame: { chunk: { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } } } })
  assert.deepEqual(usage, { inputTokens: 5, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 })
  assert.equal(readStreamUsage({ frame: { chunk: { type: 'text-delta', text: 'hi' } } }), null)
})

test('忙时配置覆盖默认闲时', () => {
  assert.equal(pricesFromConfig({ period: 'peak' }).period, 'peak')
  assert.equal(pricesFromConfig({ period: 'nope' }).period, 'off-peak')
  assert.equal(pricesFromConfig(undefined).period, 'off-peak')
})

test('页面里只插入一次卡片脚本', () => {
  const once = insertCardTag('<html><body><div></div></body></html>')
  assert.equal(once.includes('<script defer src="/dsh-receipt/card.js"></script></body>'), true)
  assert.equal(insertCardTag(once), once)
})
