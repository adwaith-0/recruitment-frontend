// Adapter for the Foundry Prompt Agent `recruitment-source-agent` (Responses API).
//
// Every substantive turn is sent with tool_choice forcing the knowledge-base MCP tool
// (knowledge_base_retrieve on server_label "knowledge-base"), and the response then passes
// through the evidence gate in grounding.js before anything reaches the browser.
//
// Conversation continuity uses previous_response_id, held server-side per (session, thread).
// It only advances when a turn is accepted, so a withheld (unverified) answer never becomes
// part of the context the model sees on the next turn.

import { postFoundry } from './foundryHttp.js'
import { groundResponse, mergeDocuments } from './grounding.js'

const ROLE_CONTEXT = {
  employer:
    'Application context: the user selected the EMPLOYER journey. They represent an organisation that wants to recruit apprentices.',
  apprentice:
    'Application context: the user selected the APPRENTICE journey. They are an individual looking for an apprenticeship.',
}

export function buildPromptAgentRequest({ config, message, previousResponseId, role, roleAlreadySent }) {
  const input = []
  if (role && ROLE_CONTEXT[role] && role !== roleAlreadySent) {
    input.push({ type: 'message', role: 'developer', content: ROLE_CONTEXT[role] })
  }
  input.push({ type: 'message', role: 'user', content: message })

  const agentReference = { type: 'agent_reference', name: config.agentName }
  if (config.agentVersion) agentReference.version = config.agentVersion

  const body = {
    agent_reference: agentReference,
    input,
    // Mandatory retrieval: the model must call the knowledge-base tool on every substantive turn.
    tool_choice: { type: 'mcp', server_label: config.kbServerLabel, name: config.kbToolName },
  }
  if (previousResponseId) body.previous_response_id = previousResponseId
  return body
}

export function createPromptAgent({ config, url, getAccessToken, clearCachedToken, fetchImpl }) {
  return {
    kind: 'prompt',
    /**
     * @param {{ message: string, thread: object, role?: string, signal?: AbortSignal }} turn
     * @returns {Promise<{ payload: object, responseId: string|null, accept: boolean }>}
     */
    async respond({ message, thread, role, signal }) {
      const body = buildPromptAgentRequest({
        config,
        message,
        previousResponseId: thread.previousResponseId,
        role,
        roleAlreadySent: thread.roleSent,
      })
      const { data } = await postFoundry(url, body, {
        getAccessToken,
        clearCachedToken,
        timeoutMs: config.requestTimeoutMs,
        signal,
        fetchImpl,
      })
      const grounded = groundResponse(data, {
        serverLabel: config.kbServerLabel,
        toolName: config.kbToolName,
        knownDocuments: thread.documents,
      })
      if (grounded.accept) {
        thread.previousResponseId = data.id
        if (role) thread.roleSent = role
        mergeDocuments(thread.documents, grounded.documents)
      }
      return { payload: grounded.payload, responseId: data.id ?? null, accept: grounded.accept }
    },
  }
}
