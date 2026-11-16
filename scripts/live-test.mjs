// Live end-to-end checks against a RUNNING bridge (npm run dev:api) and the real
// recruitment-source-agent. Requires `az login`. Prints a short report per test; message
// content is limited to the test prompts themselves.
//
//   node scripts/live-test.mjs                       # Tests A–H, J against http://127.0.0.1:8787
//   node scripts/live-test.mjs --outage              # Test K against a bridge started with the outage-sim agent
//   BRIDGE_URL=http://127.0.0.1:8788 node scripts/live-test.mjs --outage

const BASE = process.env.BRIDGE_URL || 'http://127.0.0.1:8787'
const outage = process.argv.includes('--outage')
// --only=F,H runs a subset (helps stay inside the deployment's tokens-per-minute quota).
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',')
const want = (id) => !only || only.includes(id)
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []

function client() {
  let cookie = null
  return async (message, threadId, role) => {
    const started = Date.now()
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ message, threadId, role }),
    })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0]
    const body = await res.json()
    return { status: res.status, body, ms: Date.now() - started }
  }
}

function record(name, pass, detail) {
  results.push({ name, pass })
  console.log(`\n[${pass ? 'PASS' : 'FAIL'}] ${name}`)
  if (detail) console.log(detail)
}

function show(r) {
  const b = r.body
  if (b.error) return `  HTTP ${r.status} ${b.error.code}: ${b.error.message} (${r.ms}ms)`
  const src = (b.sources ?? []).map((s, i) => `    [${i + 1}] ${s.title} · ${s.knowledgeSource ?? '-'} · ${s.publicUrl ?? 'no public URL'} · captured ${s.captured ?? '?'}`).join('\n')
  return `  HTTP ${r.status} routed=${b.routed} grounding=${JSON.stringify(b.grounding)} (${r.ms}ms)\n` +
    `  text: ${b.text.replace(/\s+/g, ' ').slice(0, 700)}${b.text.length > 700 ? '…' : ''}` + (src ? `\n  sources:\n${src}` : '')
}

const cited = (r) => r.status === 200 && r.body.grounding?.status === 'cited' && r.body.sources.length > 0

if (outage) {
  const send = client()
  const hi = await send('hi', 'k1')
  record('K1 greeting during knowledge-base outage', hi.status === 200 && hi.body.routed === 'greeting', show(hi))
  const q = await send('How does employer recruitment work?', 'k1')
  record('K2 factual question during outage -> safe service-unavailable', q.status === 503 && q.body.error?.code === 'knowledge_unavailable' && !q.body.text, show(q))
} else {
  if (want('J')) {
  const health = await (await fetch(`${BASE}/api/health`)).json()
  record('J0 bridge uses the new Prompt Agent', health.agent === 'recruitment-source-agent' && health.agentKind === 'prompt', `  ${JSON.stringify(health)}`)
  }

  const send = client()
  if (want('A')) {
  const a = await send('hi', 'a')
  record('A greeting "hi" (no Foundry call)', a.status === 200 && a.body.routed === 'greeting' && a.ms < 1000, show(a))
  const b = await send('hello', 'a')
  record('B greeting "hello" (no Foundry call)', b.status === 200 && b.body.routed === 'greeting', show(b))
  }

  if (want('C')) {
  const c = await send('Hi, how does employer recruitment work?', 'c')
  record('C greeting + factual question -> retrieval with citations', c.body.routed === 'prompt' && cited(c), show(c))
  }

  if (want('D')) {
  const d = await send("Explain the employer recruitment process according to Apprenticeship Connect's documents.", 'd', 'employer')
  record('D employer process grounded in employer source', cited(d) && d.body.sources.some((s) => s.knowledgeSource === 'Employer guidance'), show(d))
  }

  if (want('E')) {
  const e = await send('What do your documents say about applying for an apprenticeship?', 'e', 'apprentice')
  record('E apprentice application grounded with citations', cited(e), show(e))
  }

  if (want('F')) {
  const f = await send("What is your CEO's favourite food?", 'f')
  record('F unknown information -> not found, no fabricated answer', f.status === 200 && /couldn[’']t find verified information/i.test(f.body.text) && f.body.sources.length === 0, show(f))
  }

  if (want('G')) {
  const g = await send('Show currently available AI apprenticeships in London.', 'g', 'apprentice')
  record('G live vacancies -> cannot verify current vacancies', g.status === 200 && /can[’']t verify current vacancies|recruitment system/i.test(g.body.text), show(g))
  }

  if (want('H')) {
  const h = client()
  for (const m of ['I want an AI apprenticeship in London.', 'I have a BTech.', 'My skills are Python and machine learning.']) {
    const r = await h(m, 'h', 'apprentice')
    console.log(`  (H setup) ${m} -> HTTP ${r.status} ${r.body.grounding?.status ?? r.body.error?.code}`)
    await pause(Number(process.env.LIVE_TEST_PAUSE_MS ?? 8000))
  }
  const h4 = await h('What details have I told you?', 'h', 'apprentice')
  const t = h4.body.text ?? ''
  record('H conversation memory', h4.status === 200 && /london/i.test(t) && /btech/i.test(t) && /python/i.test(t) && /machine learning/i.test(t), show(h4))

  // Isolation: a different browser session using the same thread id must not see H's details.
  const other = client()
  const iso = await other('What details have I told you?', 'h', 'apprentice')
  record('H2 another user cannot see that conversation', iso.status === 200 && !/btech/i.test(iso.body.text ?? '') && !/machine learning/i.test(iso.body.text ?? ''), show(iso))
  }
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} live checks passed.`)
process.exitCode = failed.length ? 1 : 0
