/**
 * Contract checks for the wire protocol.
 *
 * Everything here is offline: the gateway is not contacted, so these assertions
 * describe what the plugin will send and how it will read a stream, not what
 * the gateway currently answers. They exist because the mapping has invariants
 * the harness enforces and a fake stream makes them cheap to prove:
 *
 * - `reasoning-end` arrives AFTER `text-start`, so the block to close is the
 *   last open block of *that* type, never the current index.
 * - the stream must finish with no block left open, even when the gateway skips
 *   an `-end` event.
 * - `usage` is emitted once, on `finish-step`, not again on `finish`.
 *
 * Requires `npm run build` first: the module under test is the compiled one.
 */

import { strict as assert } from 'node:assert'

import {
  buildRequest,
  chunkState,
  collectRequestImages,
  eventToChunks,
  parseEventStream,
} from '../lib/protocol.js'

/** Drive a scripted event sequence and collect the chunks. */
function run(events, toolSchemas) {
  const state = chunkState(toolSchemas)
  const chunks = []
  for (const event of events) {
    if (event.type === 'text-start' || event.type === 'reasoning-start' || event.type === 'tool-call') {
      state.blockIndex += 1
    }
    chunks.push(...eventToChunks(event, state))
  }
  return { chunks, state }
}

// --- reasoning closes its own block, not the text block that opened after it ---
{
  const { chunks, state } = run([
    { type: 'reasoning-start' },
    { type: 'reasoning-delta', text: 'thinking' },
    { type: 'text-start' },
    { type: 'reasoning-end' },
    { type: 'text-delta', text: 'answer' },
    { type: 'text-end' },
    { type: 'finish', finishReason: 'stop' },
  ])

  assert.deepEqual(chunks[0], { type: 'block-start', index: 1, blockType: 'reasoning' })
  const reasoningEnd = chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'reasoning')
  assert.ok(reasoningEnd, 'the reasoning block must be closed by reasoning-end')
  assert.equal(reasoningEnd.index, 1, 'reasoning-end closes the reasoning block, not the newer text block')
  assert.equal(reasoningEnd.block.text, 'thinking', 'the closing block carries the accumulated text')

  const textEnd = chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'text')
  assert.equal(textEnd.block.text, 'answer')

  assert.equal(state.openTextual.size, 0, 'nothing may stay open')
  assert.equal(chunks[chunks.length - 1].type, 'finish')
  assert.deepEqual(chunks[chunks.length - 1].reason, { kind: 'stop' })
}

// --- a truncated stream still finishes with every block closed ---
{
  const { chunks, state } = run([
    { type: 'text-start' },
    { type: 'text-delta', text: 'cut off' },
    { type: 'finish', finishReason: 'length' },
  ])
  assert.equal(state.openTextual.size, 0, 'finish closes whatever the gateway left open')
  assert.deepEqual(chunks[chunks.length - 1].reason, { kind: 'max-tokens' })
}

// --- usage is emitted once, and the finish reason maps onto the harness enum ---
{
  const usage = { inputTokens: 10, outputTokens: 4, inputTokenDetails: { cacheReadTokens: 6 } }
  const { chunks } = run([
    { type: 'finish-step', usage },
    { type: 'finish', totalUsage: usage, finishReason: 'tool_calls' },
  ])
  assert.equal(chunks.filter(chunk => chunk.type === 'usage').length, 1, 'usage is emitted once')
  assert.deepEqual(chunks[0].usage, { inputTokens: 4, outputTokens: 4, cacheReadTokens: 6 })
  assert.deepEqual(chunks[1].reason, { kind: 'tool-calls' })
}

// --- a tool call opens, streams and closes as one block, with wire nulls dropped ---
{
  const schema = {
    type: 'object',
    properties: { cmd: { type: 'string' }, workdir: { anyOf: [{ type: 'string' }] } },
    required: ['cmd'],
  }
  const { chunks, state } = run([
    { type: 'tool-call', toolCallId: 'call-1', toolName: 'bash', input: { cmd: 'ls', workdir: null } },
    { type: 'finish', finishReason: 'tool_calls' },
  ], new Map([['bash', schema]]))

  assert.equal(chunks[0].type, 'block-start')
  assert.equal(chunks[0].blockType, 'tool-call')
  const delta = chunks.find(chunk => chunk.type === 'tool-call-delta')
  assert.equal(delta.name, 'bash')
  assert.equal(delta.argumentsDelta, '{"cmd":"ls"}', 'an optional null means "not passed"')
  const end = chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
  assert.equal(end.block.arguments, '{"cmd":"ls"}')
  assert.equal(state.toolCalls.size, 0, 'the tool block is closed in the same event')
}

// --- the request envelope: system folding, tool-name lookup, developer refusal ---
{
  const request = buildRequest({
    provider: 'commandcode',
    model: 'deepseek/deepseek-v4-pro',
    reasoningEffort: 'high',
    temperature: 0.3,
    maxTokens: 1234,
    system: 'from the caller',
    messages: [
      { role: 'system', content: [{ type: 'text', text: 'first system' }] },
      { role: 'system', content: [{ type: 'text', text: 'second system' }] },
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'call-9', name: 'bash', arguments: '{"cmd":"ls"}' }],
      },
      { role: 'tool', toolCallId: 'call-9', content: [{ type: 'text', text: 'ok' }] },
    ],
  })

  assert.equal(
    request.params.system,
    'from the caller\n\nfirst system\n\nsecond system',
    'every system-role message folds into the single system slot',
  )
  assert.equal(request.params.reasoning_effort, 'high')
  assert.equal(request.params.temperature, 0.3)
  assert.equal(request.params.max_tokens, 1234)
  assert.equal(request.params.stream, true)

  const toolTurn = request.params.messages.find(message => message.role === 'tool')
  assert.equal(
    toolTurn.content[0].toolName,
    'bash',
    'toolName is read off the assistant tool-call, not stamped',
  )
  assert.deepEqual(request.params.messages[0], { role: 'user', content: 'hi' })

  // An effort the gateway has no value for is dropped, not sent.
  const off = buildRequest({
    provider: 'commandcode',
    model: 'm',
    reasoningEffort: 'off',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
  })
  assert.equal(off.params.reasoning_effort, undefined, 'the Off selector sends no effort field')

  assert.throws(() => buildRequest({
    provider: 'commandcode',
    model: 'm',
    messages: [{ role: 'developer', content: [{ type: 'text', text: 'tool changed' }] }],
  }), /developer/, 'a developer tool-change message is refused, not silently dropped')
}

// --- the byte stream is line-buffered, including a line split across reads ---
{
  const encoder = new TextEncoder()
  const lines = [
    JSON.stringify({ type: 'text-start' }),
    JSON.stringify({ type: 'text-delta', text: 'hello' }),
    JSON.stringify({ type: 'finish', finishReason: 'stop' }),
  ]
  const joined = `${lines.join('\n')}\n`
  // Split the payload mid-line to prove the reader buffers across reads.
  const chunksOf = [encoder.encode(joined.slice(0, 12)), encoder.encode(joined.slice(12, 40)), encoder.encode(joined.slice(40))]
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunksOf) controller.enqueue(chunk)
      controller.close()
    },
  })

  const seen = []
  for await (const event of parseEventStream(stream)) seen.push(event.type)
  assert.deepEqual(seen, ['text-start', 'text-delta', 'finish'], 'a line split across reads is reassembled')
}

// --- image collection: roles, de-duplication, offloaded occurrences ---
{
  const image = (id, offloaded) => ({
    type: 'image',
    attachment: { attachmentId: id, width: 8, height: 8 },
    ...offloaded === true ? { offloaded: true } : {},
  })

  // An image the gateway cannot replay is refused while it is still cheap,
  // instead of producing a history no later request can send.
  assert.throws(
    () => collectRequestImages([{ role: 'assistant', content: [image('att-1')] }]),
    /assistant/,
    'an image in assistant history must be refused',
  )

  assert.deepEqual(
    collectRequestImages([
      { role: 'user', content: [image('att-1')] },
      { role: 'user', content: [image('att-1'), image('att-2')] },
    ]).map(ref => ref.attachmentId),
    ['att-1', 'att-2'],
    'a shared attachment is resolved once, oldest first',
  )

  assert.deepEqual(
    collectRequestImages([{ role: 'user', content: [image('att-3', true)] }]),
    [],
    'an offloaded occurrence needs no bytes, so a caller cannot resolve one',
  )
}

// --- an image-only user turn split from a tool result never splits a tool run ---
{
  const version = {
    attachment: { attachmentId: 'att-1' },
    mediaType: 'image/png',
    data: new Uint8Array([1, 2, 3]),
    bytes: 3,
  }
  const images = new Map([['att-1', version]])
  const image = { type: 'image', attachment: { attachmentId: 'att-1', width: 8, height: 8 } }

  const request = buildRequest({
    provider: 'commandcode',
    model: 'm',
    messages: [
      // A tool that returned bytes: the gateway's tool output is text-only, so
      // the image follows as its own user turn.
      { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'read_image', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'bytes' }, image] },
      // A second call in the SAME tool run: the image turn must not land here.
      { role: 'assistant', content: [{ type: 'tool-call', id: 'c2', name: 'bash', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'c2', content: [{ type: 'text', text: 'ok' }] },
    ],
  }, images)

  const roles = request.params.messages.map(message => message.role)
  assert.deepEqual(
    roles,
    ['assistant', 'tool', 'assistant', 'tool', 'user'],
    'the image turn is held past the tool run instead of splitting it',
  )

  const held = request.params.messages[request.params.messages.length - 1]
  assert.ok(Array.isArray(held.content), 'the held turn carries parts')
  assert.equal(held.content[0].type, 'image')
  assert.match(
    held.content[0].image,
    /^data:image\/png;base64,/,
    'the image is inlined as a data URL, which is the only shape the gateway carries',
  )

  // A user turn WITH text keeps its position — only textless turns are deferred.
  const withText = buildRequest({
    provider: 'commandcode',
    model: 'm',
    messages: [
      { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'read_image', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'bytes' }, image] },
      { role: 'user', content: [{ type: 'text', text: 'what is this?' }, image] },
    ],
  }, images)
  assert.deepEqual(
    withText.params.messages.map(message => message.role),
    ['assistant', 'tool', 'user', 'user'],
    'a turn carrying text keeps its position',
  )
}

console.log('smoke-protocol: ok · block invariants, usage dedupe, tool-call, envelope, line buffering, images')
