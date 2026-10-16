import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProjectedCall } from '../src/project.ts'
import { isBlindRetry } from '../src/waste.ts'

function call(patch: Partial<ProjectedCall> & Pick<ProjectedCall, 'name' | 'argsHash'>): ProjectedCall {
  return {
    callId: patch.callId ?? patch.argsHash,
    name: patch.name,
    argsHash: patch.argsHash,
    failed: patch.failed ?? false,
    empty: patch.empty ?? false,
    settled: patch.settled ?? true,
    barrier: patch.barrier ?? 1,
    turn: patch.turn ?? 1,
    step: patch.step ?? 1,
  }
}

test('失败后用同一路径再读，算盲重试', () => {
  const calls = [
    call({ name: 'read', argsHash: 'readme', failed: true }),
    call({ name: 'read', argsHash: 'readme', failed: true, step: 2 }),
  ]
  assert.equal(isBlindRetry(calls, 1), true)
  assert.equal(isBlindRetry(calls, 0), false)
})

test('搜索返回空文本后又原样再搜，算盲重试', () => {
  const calls = [
    call({ name: 'search', argsHash: 'q', empty: true }),
    call({ name: 'search', argsHash: 'q', step: 2 }),
  ]
  assert.equal(isBlindRetry(calls, 1), true)
})

test('失败后先跑了别的工具，再用同一参数重试，仍算盲重试', () => {
  const calls = [
    call({ name: 'read', argsHash: 'readme', failed: true }),
    call({ name: 'search', argsHash: 'other' }),
    call({ name: 'read', argsHash: 'readme', step: 3 }),
  ]
  assert.equal(isBlindRetry(calls, 2), true)
})

test('失败后换成另一个路径，不算盲重试', () => {
  const calls = [
    call({ name: 'read', argsHash: 'readme', failed: true }),
    call({ name: 'read', argsHash: 'other', step: 2 }),
  ]
  assert.equal(isBlindRetry(calls, 1), false)
})

test('上一次已经成功，再用同一参数，不算盲重试', () => {
  const calls = [
    call({ name: 'read', argsHash: 'readme' }),
    call({ name: 'read', argsHash: 'readme', step: 2 }),
  ]
  assert.equal(isBlindRetry(calls, 1), false)
})

test('中间有新的用户消息，不算盲重试', () => {
  const calls = [
    call({ name: 'read', argsHash: 'readme', failed: true, barrier: 1 }),
    call({ name: 'read', argsHash: 'readme', barrier: 2, step: 2 }),
  ]
  assert.equal(isBlindRetry(calls, 1), false)
})

test('上一次还没返回，先不算盲重试', () => {
  const calls = [
    call({ name: 'read', argsHash: 'readme', failed: true, settled: false }),
    call({ name: 'read', argsHash: 'readme', step: 2 }),
  ]
  assert.equal(isBlindRetry(calls, 1), false)
})
