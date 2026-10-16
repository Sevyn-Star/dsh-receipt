import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { formatUsd, tally } from '../src/ledger.ts'
import { DEFAULT_PRICES, type PriceTable } from '../src/prices.ts'
import { project, type SessionEvent } from '../src/project.ts'

interface Fixture {
  readonly name: string
  readonly events: SessionEvent[]
  readonly expect: {
    readonly latestStepMicro: number | null
    readonly sessionMicro: number
    readonly wasteMicro: number
    readonly wasteCount: number
    readonly unpricedSteps: number
  }
}

const fixtures = readdirSync(new URL('../fixtures/', import.meta.url))
  .filter(name => name.endsWith('.json'))
  .map(name => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')) as Fixture)

for (const fixture of fixtures) {
  test(`${fixture.name} 和手算一致`, () => {
    const receipt = tally(project(fixture.events))
    assert.equal(receipt.latestStepMicro, fixture.expect.latestStepMicro)
    assert.equal(receipt.sessionMicro, fixture.expect.sessionMicro)
    assert.equal(receipt.wasteMicro, fixture.expect.wasteMicro)
    assert.equal(receipt.wasteCount, fixture.expect.wasteCount)
    assert.equal(receipt.unpricedSteps, fixture.expect.unpricedSteps)
    assert.equal(receipt.currency, 'USD')
    assert.equal(receipt.period, 'off-peak')
    assert.equal(receipt.priceCheckedOn, '2026-10-15')
  })
}

test('同一步里两笔调用只有一笔是盲重试，浪费按调用数分摊', () => {
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
  assert.equal(receipt.sessionMicro, 300_000)
  assert.equal(receipt.wasteMicro, 75_000)
  assert.equal(receipt.wasteCount, 1)
})

test('旧模型名按 flash 闲时单价计价', () => {
  const events: SessionEvent[] = [
    { type: 'model/selection', data: { model: 'deepseek-v4-flash' } },
    { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 } } },
  ]
  assert.equal(tally(project(events)).latestStepMicro, 3_000)
})

test('忙时单价是闲时的一倍', () => {
  const peak: PriceTable = { ...DEFAULT_PRICES, period: 'peak' }
  const events: SessionEvent[] = [
    { type: 'model/selection', data: { model: 'deepseek-flash' } },
    { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } } },
  ]
  assert.equal(tally(project(events), peak).latestStepMicro, 1_500_000)
})

test('硅基流动的模型前缀按 Flash 闲时单价计价', () => {
  const events: SessionEvent[] = [
    { type: 'request/context', data: { provider: 'siliconflow', model: 'deepseek-ai/DeepSeek-V4.1-Flash' } },
    { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, outputTokens: 0 } } },
  ]
  assert.equal(tally(project(events)).latestStepMicro, 150_000)
})

test('请求头里的模型名按 Flash 闲时单价计价', () => {
  const events: SessionEvent[] = [
    {
      type: 'request/header',
      data: { header: { config: { provider: 'siliconflow', model: 'deepseek-ai/DeepSeek-V4.1-Flash' } } },
    },
    { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, outputTokens: 0 } } },
  ]
  assert.equal(tally(project(events)).latestStepMicro, 150_000)
})

test('价目表里没有的模型不记成 $0', () => {
  const events: SessionEvent[] = [
    { type: 'model/selection', data: { model: 'some-other-model' } },
    { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 1_000_000, outputTokens: 0 } } },
  ]
  const receipt = tally(project(events))
  assert.equal(receipt.latestStepMicro, null)
  assert.equal(receipt.sessionMicro, 0)
  assert.equal(receipt.unpricedSteps, 1)
})

test('金额格式保留到有意义的小数', () => {
  assert.equal(formatUsd(150_000), '$0.15')
  assert.equal(formatUsd(660_000), '$0.66')
  assert.equal(formatUsd(3_000), '$0.003')
  assert.equal(formatUsd(0), '$0')
})
