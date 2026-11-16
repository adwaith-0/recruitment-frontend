// Non-secret configuration for the API bridge.
// Values come from recruitment-frontend/.env (loaded with `node --env-file`).
// No keys or tokens live here: authentication uses Microsoft Entra ID (your `az login`
// session locally, or a managed identity when AZURE_AUTH_MODE=default in Azure).

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    )
  }
  return value
}

function intFromEnv(name, fallback) {
  const raw = process.env[name]
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const projectEndpoint = required('FOUNDRY_PROJECT_ENDPOINT').replace(/\/+$/, '')
const agentName = required('FOUNDRY_AGENT_NAME')
// "prompt" (default): recruitment-source-agent via the Responses API with mandatory retrieval.
// "hosted": the previous hosted agent endpoint - kept only for rollback.
const agentKind = (process.env.FOUNDRY_AGENT_KIND?.trim() || 'prompt').toLowerCase()
if (!['prompt', 'hosted'].includes(agentKind)) {
  throw new Error('FOUNDRY_AGENT_KIND must be "prompt" or "hosted".')
}

if (!/^https:\/\/[^/]+\.services\.ai\.azure\.com\/api\/projects\/[^/]+$/i.test(projectEndpoint)) {
  console.warn(
    `[config] FOUNDRY_PROJECT_ENDPOINT does not look like a Foundry project endpoint: ${projectEndpoint}`,
  )
}

export const config = Object.freeze({
  projectEndpoint,
  agentName,
  agentKind,
  // Optional: pin a specific agent version; otherwise the latest version is used.
  agentVersion: process.env.FOUNDRY_AGENT_VERSION?.trim() || undefined,
  // Used only by the hosted (rollback) endpoint.
  apiVersion: process.env.FOUNDRY_API_VERSION?.trim() || 'v1',
  // The MCP tool the Prompt Agent must call before answering a substantive question.
  kbServerLabel: process.env.FOUNDRY_KB_SERVER_LABEL?.trim() || 'knowledge-base',
  kbToolName: 'knowledge_base_retrieve',
  knowledgeBase: process.env.AZURE_SEARCH_KNOWLEDGE_BASE?.trim() || 'knowledgebase606',
  // Entra ID scope for Foundry data-plane calls.
  tokenScope: 'https://ai.azure.com/.default',
  // "cli" (default) uses only your `az login` session; "default" uses DefaultAzureCredential
  // (managed identity, workload identity, environment, CLI...).
  authMode: (process.env.AZURE_AUTH_MODE?.trim() || 'cli').toLowerCase(),
  tenantId: process.env.AZURE_TENANT_ID?.trim() || undefined,
  host: process.env.API_HOST?.trim() || '127.0.0.1',
  // Azure App Service provides PORT; locally API_PORT is used.
  port: intFromEnv('PORT', intFromEnv('API_PORT', 8787)),
  // Hosted mode: serve the built React app (dist/) from the bridge itself.
  staticDir: process.env.SERVE_STATIC_DIR?.trim() || undefined,
  // Behind the App Service HTTPS front end: trust X-Forwarded-Proto so cookies get `Secure`.
  trustProxy: process.env.TRUST_PROXY === '1' || Boolean(process.env.WEBSITE_SITE_NAME),
  requestTimeoutMs: intFromEnv('AGENT_TIMEOUT_MS', 120_000),
  maxMessageChars: intFromEnv('MAX_MESSAGE_CHARS', 8_000),
  sessionTtlMs: intFromEnv('SESSION_TTL_MINUTES', 120) * 60_000,
  // Usage limits (greetings are free and never counted).
  dailyQuestionLimit: intFromEnv('DAILY_QUESTION_LIMIT', 1000), // per visitor (browser session) per UTC day
  dailyQuestionLimitPerIp: intFromEnv('DAILY_QUESTION_LIMIT_PER_IP', 3000), // backstop if cookies are cleared
  maxConcurrentRequests: intFromEnv('MAX_CONCURRENT_REQUESTS', 10),
  maxQueuedRequests: intFromEnv('MAX_QUEUED_REQUESTS', 20),
  queueTimeoutMs: intFromEnv('QUEUE_TIMEOUT_MS', 30_000),
})

export const responsesUrl =
  agentKind === 'prompt'
    ? `${config.projectEndpoint}/openai/v1/responses`
    : `${config.projectEndpoint}/agents/${encodeURIComponent(config.agentName)}/endpoint/protocols/openai/responses?api-version=${encodeURIComponent(config.apiVersion)}`
