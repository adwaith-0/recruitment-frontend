// API routing tests: the real Express app + Prompt Agent adapter, with Microsoft Foundry
// replaced by a counting fake `fetch` and a fake token provider. No Azure calls are made.

import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../server/app.js'
import { createPromptAgent } from '../server/promptAgent.js'
import { SessionStore } from '../server/sessions.js'
import { annotate, employerDocs, EMPLOYERS_URL, groundedEmployerResponse, mcpCall, message, response, toolUserError } from './fixtures/foundry.js'

const baseConfig = {
  projectEndpoint: 'https://test.services.ai.azure.com/api/projects/test',
  agentName: 'recruitment-source-agent',
  agentKind: 'prompt',
  kbServerLabel: 'knowledge-base',
  kbToolName: 'knowledge_base_retrieve',
  knowledgeBase: 'knowledgebase606',
  authMode: 'cli',
  requestTimeoutMs: 5_000,
  maxMessageChars: 8_000,
  sessionTtlMs: 60_000,
}

/** Starts the bridge with a scripted Foundry. `script` returns { status, body } or throws. */
async function startBridge(script, overrides = {}, now = Date.now) {
  const config = { ...baseConfig, ...overrides }
  const calls = { foundry: [], tokens: 0 }
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.foundry.push({ url, body, auth: init.headers.Authorization })
    const { status = 200, body: out, headers = {} } = await script(body, calls.foundry.length)
    return new Response(JSON.stringify(out), { status, headers: { 'content-type': 'application/json', ...headers } })
  }
  const getAccessToken = async () => {
    calls.tokens++
    return 'fake-token'
  }
  const agent = createPromptAgent({ config, url: `${config.projectEndpoint}/openai/v1/responses`, getAccessToken, clearCachedToken() {}, fetchImpl })
  const logs = []
  const app = createApp({ config, agent, getAccessToken, sessions: new SessionStore({ ttlMs: 60_000 }), logger: (l) => logs.push(l), now })
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}`

  const client = () => {
    let cookie = null
    return async (payload) => {
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify(payload),
      })
      const set = res.headers.get('set-cookie')
      if (set) cookie = set.split(';')[0]
      return { status: res.status, body: await res.json(), cookie: set }
    }
  }
  return { calls, logs, client, close: () => new Promise((r) => server.close(r)) }
}

const neverCalled = () => {
  throw new Error('Foundry must not be called')
}

test('Test A/B: "hi" and "hello" are answered with zero Foundry, token, MCP or retrieval calls', async () => {
  const bridge = await startBridge(neverCalled)
  const send = bridge.client()
  try {
    const hi = await send({ message: 'hi', threadId: 't1' })
    assert.equal(hi.status, 200)
    assert.equal(hi.body.routed, 'greeting')
    assert.equal(hi.body.text, 'Hello! Are you looking for an apprenticeship or hoping to recruit apprentices?')
    assert.deepEqual(hi.body.toolCalls, [])
    const hello = await send({ message: 'Hello!', threadId: 't1' })
    assert.equal(hello.body.text, 'Hello! How can I help you today?')
    assert.equal(bridge.calls.foundry.length, 0)
    assert.equal(bridge.calls.tokens, 0, 'not even an Azure token is requested')
    assert.ok(bridge.logs.every((l) => !/hello|hi\b/i.test(l.replace('route=greeting', ''))), 'message content is not logged')
  } finally {
    await bridge.close()
  }
})

test('Test C: "Hi, how does employer recruitment work?" goes through mandatory retrieval with citations', async () => {
  const bridge = await startBridge(() => ({ body: groundedEmployerResponse() }))
  const send = bridge.client()
  try {
    const res = await send({ message: 'Hi, how does employer recruitment work?', threadId: 't1', role: 'employer' })
    assert.equal(res.status, 200)
    assert.equal(res.body.routed, 'prompt')
    assert.equal(res.body.grounding.status, 'cited')
    assert.equal(res.body.sources[0].publicUrl, 'https://apprenticeshipconnect.co.uk/apprenticeship-recruitment/')
    assert.equal(bridge.calls.foundry.length, 1)
    const { body, auth, url } = bridge.calls.foundry[0]
    assert.equal(url, 'https://test.services.ai.azure.com/api/projects/test/openai/v1/responses')
    assert.equal(auth, 'Bearer fake-token')
    assert.deepEqual(body.agent_reference, { type: 'agent_reference', name: 'recruitment-source-agent' })
    assert.deepEqual(body.tool_choice, { type: 'mcp', server_label: 'knowledge-base', name: 'knowledge_base_retrieve' })
    assert.equal(body.input[0].role, 'developer')
    assert.match(body.input[0].content, /EMPLOYER/)
    assert.equal(body.input.at(-1).content, 'Hi, how does employer recruitment work?')
    assert.equal(body.previous_response_id, undefined)
    assert.ok(!JSON.stringify(res.body).includes('fake-token'))
  } finally {
    await bridge.close()
  }
})

test('Test H (mechanics): follow-ups continue the same Foundry conversation; greetings do not break the chain', async () => {
  const ids = []
  const bridge = await startBridge(() => {
    const r = groundedEmployerResponse()
    ids.push(r.id)
    return { body: r }
  })
  const send = bridge.client()
  try {
    await send({ message: 'I want an AI apprenticeship in London.', threadId: 'chat-a', role: 'apprentice' })
    await send({ message: 'thanks', threadId: 'chat-a' })
    await send({ message: 'I have a BTech.', threadId: 'chat-a', role: 'apprentice' })
    const sent = bridge.calls.foundry.map((c) => c.body)
    assert.equal(sent.length, 2, 'the greeting did not reach Foundry')
    assert.equal(sent[1].previous_response_id, ids[0])
    assert.ok(sent[1].input.every((m) => m.role !== 'developer'), 'role context is sent once per thread')
  } finally {
    await bridge.close()
  }
})

test('session isolation: another browser using the same threadId gets a fresh Foundry conversation', async () => {
  const bridge = await startBridge(() => ({ body: groundedEmployerResponse() }))
  const alice = bridge.client()
  const mallory = bridge.client()
  try {
    await alice({ message: 'I want to hire two apprentices in Leeds.', threadId: 'shared-id' })
    await mallory({ message: 'What details have I told you?', threadId: 'shared-id', previousResponseId: 'resp_stolen' })
    const [, second] = bridge.calls.foundry.map((c) => c.body)
    assert.equal(second.previous_response_id, undefined, 'no access to Alice’s conversation; client-supplied ids are ignored')
  } finally {
    await bridge.close()
  }
})

test('Test K: knowledge base outage -> greeting still works, factual question gets a safe 503, no invented answer', async () => {
  const bridge = await startBridge(() => ({ status: 400, body: toolUserError }))
  const send = bridge.client()
  try {
    const hi = await send({ message: 'hi', threadId: 't1' })
    assert.equal(hi.status, 200)
    assert.equal(bridge.calls.foundry.length, 0, 'no MCP initialisation for greetings')
    const q = await send({ message: 'How does employer recruitment work?', threadId: 't1' })
    assert.equal(q.status, 503)
    assert.equal(q.body.error.code, 'knowledge_unavailable')
    assert.equal(q.body.text, undefined)
    assert.ok(bridge.logs.some((l) => /knowledge_unavailable.*upstreamCode=tool_user_error.*requestId=req_test/.test(l)), 'developers get diagnostics in logs')
    assert.ok(bridge.logs.every((l) => !l.includes('fake-token')))
  } finally {
    await bridge.close()
  }
})

test('MCP authentication failure inside a completed response is not released', async () => {
  const bridge = await startBridge(() => ({
    body: response([mcpCall(null, { status: 'failed', error: { code: -32006, message: 'HTTP_401: Authentication failed when connecting to the MCP server' } }), message('Guess from memory.')]),
  }))
  const send = bridge.client()
  try {
    const res = await send({ message: 'Do employers pay fees?', threadId: 't1' })
    assert.equal(res.status, 503)
    assert.ok(!JSON.stringify(res.body).includes('Guess from memory'))
  } finally {
    await bridge.close()
  }
})

test('empty retrieval returns the fixed reply and the unverified turn is not chained', async () => {
  let n = 0
  const bridge = await startBridge(() => {
    n++
    return { body: n === 1 ? response([mcpCall([]), message('Made-up fact.')], { id: 'resp_empty' }) : groundedEmployerResponse() }
  })
  const send = bridge.client()
  try {
    const first = await send({ message: 'What is your CEO’s favourite food?', threadId: 't1' })
    assert.equal(first.body.grounding.status, 'no_evidence')
    assert.match(first.body.text, /couldn't find verified information/)
    await send({ message: 'How does recruitment work?', threadId: 't1' })
    assert.equal(bridge.calls.foundry[1].body.previous_response_id, undefined)
  } finally {
    await bridge.close()
  }
})

test('backend network error -> 502 network_error (retryable)', async () => {
  const bridge = await startBridge(() => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
  })
  const send = bridge.client()
  try {
    const res = await send({ message: 'Explain the employer process.', threadId: 't1' })
    assert.equal(res.status, 502)
    assert.equal(res.body.error.code, 'network_error')
    assert.equal(res.body.error.retryable, true)
  } finally {
    await bridge.close()
  }
})

test('expired previous response resets the thread so the next message starts cleanly', async () => {
  let n = 0
  const bridge = await startBridge(() => {
    n++
    if (n === 2) return { status: 400, body: { error: { code: 'invalid_request_error', message: 'Previous response with id resp_x not found.' } } }
    return { body: groundedEmployerResponse() }
  })
  const send = bridge.client()
  try {
    await send({ message: 'Explain the employer process.', threadId: 't1' })
    const expired = await send({ message: 'And then?', threadId: 't1' })
    assert.equal(expired.status, 409)
    assert.equal(expired.body.error.code, 'conversation_expired')
    await send({ message: 'Explain the employer process.', threadId: 't1' })
    assert.equal(bridge.calls.foundry[2].body.previous_response_id, undefined)
  } finally {
    await bridge.close()
  }
})

test('input validation: threadId and role are required/validated before any upstream call', async () => {
  const bridge = await startBridge(neverCalled)
  const send = bridge.client()
  try {
    assert.equal((await send({ message: 'Explain fees' })).body.error.code, 'invalid_thread_id')
    assert.equal((await send({ message: 'Explain fees', threadId: '../etc' })).body.error.code, 'invalid_thread_id')
    assert.equal((await send({ message: 'Explain fees', threadId: 't', role: 'admin' })).body.error.code, 'invalid_role')
    assert.equal((await send({ message: '   ', threadId: 't' })).body.error.code, 'invalid_message')
    assert.equal(bridge.calls.foundry.length, 0)
  } finally {
    await bridge.close()
  }
})

test('session cookie is HttpOnly and SameSite=Strict, scoped to /api', async () => {
  const bridge = await startBridge(neverCalled)
  try {
    const { cookie } = await bridge.client()({ message: 'hi', threadId: 't1' })
    assert.match(cookie, /^rai_sid=[A-Za-z0-9_-]{43}; Path=\/api; HttpOnly; SameSite=Strict/)
  } finally {
    await bridge.close()
  }
})

test('fabricated citation in a live-shaped response is stripped before reaching the browser', async () => {
  const fake = '【4:2†ac_0000000000000000dead】'
  const text = `Current vacancy: AI apprentice at Contoso, London. ${fake}`
  const bridge = await startBridge(() => ({ body: response([mcpCall(employerDocs), message(text, annotate(text, fake, 'https://made.up/vacancy'))]) }))
  try {
    const res = await bridge.client()({ message: 'Show currently available AI apprenticeships in London.', threadId: 't1' })
    assert.equal(res.body.sources.length, 0)
    assert.equal(res.body.grounding.removedCitations, 1)
    assert.ok(!res.body.text.includes('【'))
    assert.ok(!JSON.stringify(res.body).includes(EMPLOYERS_URL))
  } finally {
    await bridge.close()
  }
})

test('HTTP 429 is retried once after Retry-After, then succeeds', async () => {
  const bridge = await startBridge((_body, n) => (n === 1
    ? { status: 429, headers: { 'retry-after': '1' }, body: { error: { code: 'rate_limit_exceeded', message: 'Rate limit' } } }
    : { body: groundedEmployerResponse() }))
  try {
    const res = await bridge.client()({ message: 'Explain the employer process.', threadId: 't1' })
    assert.equal(res.status, 200)
    assert.equal(bridge.calls.foundry.length, 2)
  } finally {
    await bridge.close()
  }
})

test('persistent HTTP 429 is reported as retryable rate_limited', async () => {
  const bridge = await startBridge(() => ({ status: 429, headers: { 'retry-after': '1' }, body: { error: { code: 'rate_limit_exceeded', message: 'Rate limit' } } }))
  try {
    const res = await bridge.client()({ message: 'Explain the employer process.', threadId: 't1' })
    assert.equal(res.status, 429)
    assert.equal(res.body.error.code, 'rate_limited')
    assert.equal(res.body.error.retryable, true)
    assert.equal(bridge.calls.foundry.length, 2)
  } finally {
    await bridge.close()
  }
})

// ---------------------------------------------------------------------------
// Usage limits
// ---------------------------------------------------------------------------

test('daily limit: N questions per visitor, then 429 daily_limit_reached; greetings stay free', async () => {
  const bridge = await startBridge(() => ({ body: groundedEmployerResponse() }), { dailyQuestionLimit: 2 })
  const send = bridge.client()
  try {
    assert.equal((await send({ message: 'hi', threadId: 't1' })).status, 200)
    const first = await send({ message: 'Explain the employer process.', threadId: 't1' })
    assert.equal(first.status, 200)
    assert.equal((await send({ message: 'And funding?', threadId: 't1' })).status, 200)
    const blocked = await send({ message: 'And fees?', threadId: 't1' })
    assert.equal(blocked.status, 429)
    assert.equal(blocked.body.error.code, 'daily_limit_reached')
    assert.equal(blocked.body.error.retryable, false)
    assert.match(blocked.body.error.message, /limit of 2 questions/)
    assert.equal(bridge.calls.foundry.length, 2, 'the blocked question never reaches Foundry')
    assert.equal((await send({ message: 'thanks', threadId: 't1' })).status, 200, 'greetings are not limited')
    const other = bridge.client()
    assert.equal((await other({ message: 'Explain the employer process.', threadId: 'x' })).status, 200, 'another visitor is unaffected')
  } finally {
    await bridge.close()
  }
})

test('daily limit resets on the next UTC day', async () => {
  let clock = Date.parse('2026-11-15T23:59:00Z')
  const bridge = await startBridge(() => ({ body: groundedEmployerResponse() }), { dailyQuestionLimit: 1 }, () => clock)
  const send = bridge.client()
  try {
    assert.equal((await send({ message: 'Explain the employer process.', threadId: 't1' })).status, 200)
    assert.equal((await send({ message: 'And funding?', threadId: 't1' })).status, 429)
    clock = Date.parse('2026-11-16T00:01:00Z')
    assert.equal((await send({ message: 'And funding?', threadId: 't1' })).status, 200)
  } finally {
    await bridge.close()
  }
})

test('questions that fail upstream are refunded, not counted', async () => {
  let n = 0
  const bridge = await startBridge(() => (++n === 1 ? { status: 400, body: toolUserError } : { body: groundedEmployerResponse() }), { dailyQuestionLimit: 1 })
  const send = bridge.client()
  try {
    assert.equal((await send({ message: 'Explain the employer process.', threadId: 't1' })).status, 503)
    assert.equal((await send({ message: 'Explain the employer process.', threadId: 't1' })).status, 200)
  } finally {
    await bridge.close()
  }
})

test('per-IP backstop: clearing cookies (new sessions) cannot bypass the daily limit', async () => {
  const bridge = await startBridge(() => ({ body: groundedEmployerResponse() }), { dailyQuestionLimit: 100, dailyQuestionLimitPerIp: 2 })
  try {
    assert.equal((await bridge.client()({ message: 'Explain the employer process.', threadId: 'a' })).status, 200)
    assert.equal((await bridge.client()({ message: 'Explain the employer process.', threadId: 'b' })).status, 200)
    const third = await bridge.client()({ message: 'Explain the employer process.', threadId: 'c' })
    assert.equal(third.status, 429)
    assert.equal(third.body.error.code, 'daily_limit_reached')
  } finally {
    await bridge.close()
  }
})

test('concurrency cap: excess questions queue, and are rejected with server_busy when the queue is full', async () => {
  let releaseFirst
  const gate = new Promise((r) => (releaseFirst = r))
  let n = 0
  const bridge = await startBridge(async () => {
    if (++n === 1) await gate
    return { body: groundedEmployerResponse() }
  }, { maxConcurrentRequests: 1, maxQueuedRequests: 1, queueTimeoutMs: 5_000 })
  try {
    const first = bridge.client()({ message: 'Explain the employer process.', threadId: 'a' })
    await new Promise((r) => setTimeout(r, 100))
    const queued = bridge.client()({ message: 'Explain the employer process.', threadId: 'b' })
    await new Promise((r) => setTimeout(r, 100))
    const rejected = await bridge.client()({ message: 'Explain the employer process.', threadId: 'c' })
    assert.equal(rejected.status, 503)
    assert.equal(rejected.body.error.code, 'server_busy')
    assert.equal(rejected.body.error.retryable, true)
    releaseFirst()
    assert.equal((await first).status, 200)
    assert.equal((await queued).status, 200, 'the queued question is answered once a slot frees up')
    assert.equal(bridge.calls.foundry.length, 2)
  } finally {
    await bridge.close()
  }
})

test('queue wait timeout returns server_busy instead of hanging', async () => {
  let releaseFirst
  const gate = new Promise((r) => (releaseFirst = r))
  let n = 0
  const bridge = await startBridge(async () => {
    if (++n === 1) await gate
    return { body: groundedEmployerResponse() }
  }, { maxConcurrentRequests: 1, maxQueuedRequests: 5, queueTimeoutMs: 200 })
  try {
    const first = bridge.client()({ message: 'Explain the employer process.', threadId: 'a' })
    await new Promise((r) => setTimeout(r, 50))
    const waited = await bridge.client()({ message: 'Explain the employer process.', threadId: 'b' })
    assert.equal(waited.body.error.code, 'server_busy')
    releaseFirst()
    assert.equal((await first).status, 200)
  } finally {
    await bridge.close()
  }
})
