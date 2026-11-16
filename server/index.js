// Entry point for the API bridge between the React app and Microsoft Foundry.
// The browser never sees Azure credentials: tokens are acquired and used only here.

import { clearCachedToken, getAccessToken } from './auth.js'
import { createApp } from './app.js'
import { config, responsesUrl } from './config.js'
import { createHostedAgent } from './hostedAgent.js'
import { createPromptAgent } from './promptAgent.js'
import { SessionStore } from './sessions.js'

const deps = { config, url: responsesUrl, getAccessToken, clearCachedToken }
const agent = config.agentKind === 'hosted' ? createHostedAgent(deps) : createPromptAgent(deps)
const sessions = new SessionStore({ ttlMs: config.sessionTtlMs })
setInterval(() => sessions.sweep(), 10 * 60_000).unref()

const app = createApp({ config, agent, getAccessToken, sessions })

app.listen(config.port, config.host, () => {
  console.log(`[api] Recruitment AI bridge on http://${config.host}:${config.port}${config.staticDir ? ` (serving ${config.staticDir})` : ''}`)
  console.log(
    `[api] ${config.agentKind === 'prompt' ? 'Prompt agent' : 'Hosted agent (ROLLBACK MODE)'} "${config.agentName}"` +
      `${config.agentVersion ? ` v${config.agentVersion}` : ''} · auth=${config.authMode}` +
      (config.agentKind === 'prompt' ? ` · knowledge base=${config.knowledgeBase} (mandatory retrieval)` : ''),
  )
})
