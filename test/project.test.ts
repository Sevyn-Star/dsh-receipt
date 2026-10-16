import assert from 'node:assert/strict'
import { test } from 'node:test'
import { argsHash, project, type SessionEvent } from '../src/project.ts'

test('参数键的顺序不同，哈希相同', () => {
  assert.equal(argsHash('{"b":1,"a":2}'), argsHash('{"a":2,"b":1}'))
})

test('注入的用户消息不抬高屏障，真人消息会', () => {
  const events: SessionEvent[] = [
    { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"path":"a"}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'c1', isError: true, content: [] } } },
    { type: 'user/message', data: { source: { kind: 'schedule' }, content: [] } },
    { type: 'tool/call', data: { turn: 1, step: 2, callId: 'c2', name: 'read', arguments: '{"path":"a"}' } },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '停' }] } },
    { type: 'tool/call', data: { turn: 2, step: 1, callId: 'c3', name: 'read', arguments: '{"path":"a"}' } },
  ]
  const projection = project(events)
  assert.equal(projection.calls[0]?.barrier, 0)
  assert.equal(projection.calls[1]?.barrier, 0)
  assert.equal(projection.calls[2]?.barrier, 1)
  assert.equal(projection.calls[0]?.failed, true)
  assert.equal(projection.calls[1]?.settled, false)
})

test('键顺序不同的失败重试会被收成同一组参数', () => {
  const events: SessionEvent[] = [
    { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"b":1,"a":2}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'c1', isError: true, content: [{ type: 'text', text: 'no' }] } } },
    { type: 'tool/call', data: { turn: 1, step: 2, callId: 'c2', name: 'read', arguments: '{"a":2,"b":1}' } },
  ]
  const projection = project(events)
  assert.equal(projection.calls[0]?.argsHash, projection.calls[1]?.argsHash)
})
