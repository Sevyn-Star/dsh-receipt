import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Book } from '../src/book.ts'
import { tally } from '../src/ledger.ts'
import { callPhrase } from '../src/phrase.ts'
import { DEFAULT_PRICES } from '../src/prices.ts'
import { project, type SessionEvent } from '../src/project.ts'
import { blindGroupKey, REMINDER_TEXT, reminderMessage, remindEnabled, takeReminder } from '../src/remind.ts'

test('读文件、搜索和命令都能收成一句', () => {
  assert.deepEqual(callPhrase('read', '{"file_path":"/tmp/dsh-receipt-missing.txt"}'), {
    verb: '读',
    action: '读 `/tmp/dsh-receipt-missing.txt`',
  })
  assert.equal(callPhrase('grep', '{"pattern":"收据"}').action, '搜 `收据`')
  assert.equal(callPhrase('search', '{"q":"收据"}').action, '搜 `收据`')
  assert.equal(callPhrase('bash', '{"command":"ls\\n-la"}').action, '跑 `ls`')
  const long = 'a'.repeat(80)
  assert.equal(callPhrase('read', JSON.stringify({ path: long })).action.endsWith('…`'), true)
  assert.equal(callPhrase('mystery', '{}').action, '调用 mystery')
})

test('同一条路径的盲重试收成一行，钱和浪费总额一致', () => {
  const events: SessionEvent[] = [
    { type: 'model/selection', data: { model: 'deepseek-flash' } },
    { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, outputTokens: 0 } } },
    { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"file_path":"/tmp/dsh-receipt-missing.txt"}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'c1', isError: true, content: [{ type: 'text', text: 'not found' }] } } },
    { type: 'assistant/message', data: { turn: 1, step: 2, usage: { inputTokens: 1_000_000, outputTokens: 0 } } },
    { type: 'tool/call', data: { turn: 1, step: 2, callId: 'c2', name: 'read', arguments: '{"file_path":"/tmp/dsh-receipt-missing.txt"}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'c2', isError: true, content: [{ type: 'text', text: 'not found' }] } } },
    { type: 'assistant/message', data: { turn: 1, step: 3, usage: { inputTokens: 1_000_000, outputTokens: 0 } } },
    { type: 'tool/call', data: { turn: 1, step: 3, callId: 'c3', name: 'read', arguments: '{"file_path":"/tmp/dsh-receipt-missing.txt"}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'c3', isError: true, content: [{ type: 'text', text: 'not found' }] } } },
  ]
  const receipt = tally(project(events))
  assert.equal(receipt.wasteCount, 2)
  assert.equal(receipt.repeats.length, 1)
  assert.equal(receipt.repeats[0]?.text, '读 `/tmp/dsh-receipt-missing.txt`，失败后又读了 2 次')
  assert.equal(receipt.repeats[0]?.count, 2)
  assert.equal(receipt.repeats[0]?.micro, receipt.wasteMicro)
})

test('同一步里只有一笔是盲重试，这一行只拿分摊到的钱', () => {
  const events: SessionEvent[] = [
    { type: 'model/selection', data: { model: 'deepseek-flash' } },
    { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, outputTokens: 0 } } },
    { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"path":"a"}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'c1', isError: true, content: [] } } },
    { type: 'assistant/message', data: { turn: 1, step: 2, usage: { inputTokens: 1_000_000, outputTokens: 0 } } },
    { type: 'tool/call', data: { turn: 1, step: 2, callId: 'c2', name: 'read', arguments: '{"path":"a"}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'c2', isError: true, content: [] } } },
    { type: 'tool/call', data: { turn: 1, step: 2, callId: 'c3', name: 'search', arguments: '{"q":"b"}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'c3', isError: false, content: [{ type: 'text', text: 'hit' }] } } },
  ]
  const receipt = tally(project(events))
  assert.equal(receipt.repeats.length, 1)
  assert.equal(receipt.repeats[0]?.text, '读 `a`，失败后又读了 1 次')
  assert.equal(receipt.repeats[0]?.micro, 75_000)
})

test('换了路径、用户又说了一句，都不出现在重复里', () => {
  const changed: SessionEvent[] = [
    { type: 'model/selection', data: { model: 'deepseek-flash' } },
    { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"path":"a"}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'c1', isError: true, content: [] } } },
    { type: 'tool/call', data: { turn: 1, step: 2, callId: 'c2', name: 'read', arguments: '{"path":"b"}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'c2', isError: true, content: [] } } },
  ]
  assert.deepEqual(tally(project(changed)).repeats, [])

  const userSpoke: SessionEvent[] = [
    { type: 'model/selection', data: { model: 'deepseek-flash' } },
    { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"path":"a"}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'c1', isError: true, content: [] } } },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '再试' }] } },
    { type: 'tool/call', data: { turn: 2, step: 1, callId: 'c2', name: 'read', arguments: '{"path":"a"}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'c2', isError: true, content: [] } } },
  ]
  assert.deepEqual(tally(project(userSpoke)).repeats, [])
})

test('提醒插在中间，不会把这次重试洗成新的需求', () => {
  const events: SessionEvent[] = [
    { type: 'model/selection', data: { model: 'deepseek-flash' } },
    { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, outputTokens: 0 } } },
    { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"path":"a"}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'c1', isError: true, content: [] } } },
    { type: 'user/message', data: { source: { kind: 'dsh-receipt', form: 'notice' }, content: [{ type: 'text', text: REMINDER_TEXT }] } },
    { type: 'assistant/message', data: { turn: 1, step: 2, usage: { inputTokens: 1_000_000, outputTokens: 0 } } },
    { type: 'tool/call', data: { turn: 1, step: 2, callId: 'c2', name: 'read', arguments: '{"path":"a"}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'c2', isError: true, content: [] } } },
  ]
  const receipt = tally(project(events))
  assert.equal(receipt.wasteCount, 1)
  assert.equal(receipt.repeats.length, 1)
})

test('没定价的重试写得出句子，但不编钱', () => {
  const events: SessionEvent[] = [
    { type: 'model/selection', data: { model: 'not-a-priced-model' } },
    { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 0 } } },
    { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"path":"a"}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'c1', isError: true, content: [] } } },
    { type: 'assistant/message', data: { turn: 1, step: 2, usage: { inputTokens: 10, outputTokens: 0 } } },
    { type: 'tool/call', data: { turn: 1, step: 2, callId: 'c2', name: 'read', arguments: '{"path":"a"}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'c2', isError: true, content: [] } } },
  ]
  const line = tally(project(events)).repeats[0]
  assert.equal(line?.text, '读 `a`，失败后又读了 1 次')
  assert.equal(line?.micro, null)
})

test('超过四组时只留最大的四组，剩下收成一句', () => {
  const events: SessionEvent[] = [{ type: 'model/selection', data: { model: 'deepseek-flash' } }]
  for (let i = 0; i < 5; i++) {
    const tokens = (i + 1) * 1_000_000
    events.push(
      { type: 'assistant/message', data: { turn: 1, step: i * 2 + 1, usage: { inputTokens: tokens, outputTokens: 0 } } },
      { type: 'tool/call', data: { turn: 1, step: i * 2 + 1, callId: `a${i}`, name: 'read', arguments: JSON.stringify({ path: `f${i}` }) } },
      { type: 'tool/result', data: { message: { toolCallId: `a${i}`, isError: true, content: [] } } },
      { type: 'assistant/message', data: { turn: 1, step: i * 2 + 2, usage: { inputTokens: tokens, outputTokens: 0 } } },
      { type: 'tool/call', data: { turn: 1, step: i * 2 + 2, callId: `b${i}`, name: 'read', arguments: JSON.stringify({ path: `f${i}` }) } },
      { type: 'tool/result', data: { message: { toolCallId: `b${i}`, isError: true, content: [] } } },
    )
  }
  const receipt = tally(project(events))
  assert.equal(receipt.repeats.length, 5)
  assert.equal(receipt.repeats[0]?.text, '读 `f4`，失败后又读了 1 次')
  assert.equal(receipt.repeats[4]?.text, '还有 1 组')
  const shown = receipt.repeats.reduce((sum, line) => sum + (line.micro ?? 0), 0)
  assert.equal(shown, receipt.wasteMicro)
})

test('第二次原样重试才提醒，同一组只提醒一次，关掉后不再记', () => {
  const book = new Book(DEFAULT_PRICES)
  const seen = new Set<string>()
  const fail: SessionEvent = { type: 'tool/result', data: { message: { toolCallId: 'c1', isError: true, content: [] } } }
  book.append('s1', { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"path":"a"}' } })
  book.append('s1', fail)
  assert.equal(blindGroupKey(book.calls('s1'), 'c1'), null)

  book.append('s1', { type: 'tool/call', data: { turn: 1, step: 2, callId: 'c2', name: 'read', arguments: '{"path":"a"}' } })
  book.append('s1', { type: 'tool/result', data: { message: { toolCallId: 'c2', isError: true, content: [] } } })
  const key = blindGroupKey(book.calls('s1'), 'c2')
  assert.equal(takeReminder(true, key, seen), true)
  assert.equal(takeReminder(true, key, seen), false)

  book.append('s1', { type: 'tool/call', data: { turn: 1, step: 3, callId: 'c3', name: 'read', arguments: '{"path":"a"}' } })
  book.append('s1', { type: 'tool/result', data: { message: { toolCallId: 'c3', isError: true, content: [] } } })
  assert.equal(blindGroupKey(book.calls('s1'), 'c3'), key)
  assert.equal(takeReminder(false, blindGroupKey(book.calls('s1'), 'c3'), new Set()), false)
  assert.equal(remindEnabled(undefined), true)
  assert.equal(remindEnabled({ remind: false }), false)
  assert.equal(remindEnabled({ remind: 'off' }), false)
  assert.equal(reminderMessage().content[0]?.text, REMINDER_TEXT)
  assert.equal(reminderMessage().source.kind, 'dsh-receipt')
  assert.equal(book.append('s1', { type: 'tool/result', seq: 4, data: { message: { toolCallId: 'c3', isError: true, content: [] } } }), true)
  assert.equal(book.append('s1', { type: 'tool/result', seq: 4, data: { message: { toolCallId: 'c9', isError: true, content: [] } } }), false)
})
