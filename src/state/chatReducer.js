import { makeTitle, uid } from '../lib/format.js'

/**
 * Conversations live in memory only (no localStorage) so personal recruitment
 * details are not persisted on the device. Each conversation has its own threadId;
 * the API bridge keeps the matching Foundry context server-side for this browser
 * session, so threads stay isolated and no Foundry IDs are handled here.
 * Greeting replies are answered by the bridge without Foundry and stay in this history.
 */

export function createConversation() {
  const now = Date.now()
  return {
    id: uid('chat'),
    title: 'New conversation',
    messages: [],
    threadId: uid('thread'),
    role: null,
    pending: false,
    pendingSince: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function initChatState() {
  const first = createConversation()
  return { conversations: { [first.id]: first }, order: [first.id], activeId: first.id }
}

function patch(state, id, fn) {
  const conv = state.conversations[id]
  if (!conv) return state
  return { ...state, conversations: { ...state.conversations, [id]: fn(conv) } }
}

function isBlank(conv) {
  return conv && conv.messages.length === 0 && !conv.pending
}

export function chatReducer(state, action) {
  switch (action.type) {
    case 'new': {
      // Reuse the active conversation if it's still empty, rather than piling up blank chats.
      const active = state.conversations[state.activeId]
      if (isBlank(active)) {
        return patch(state, active.id, (c) => ({ ...c, error: null }))
      }
      const conv = createConversation()
      return {
        conversations: { ...state.conversations, [conv.id]: conv },
        order: [conv.id, ...state.order],
        activeId: conv.id,
      }
    }

    case 'select': {
      if (!state.conversations[action.id]) return state
      // Drop an abandoned blank conversation when switching away from it.
      const prev = state.conversations[state.activeId]
      if (prev && prev.id !== action.id && isBlank(prev)) {
        const { [prev.id]: _removed, ...rest } = state.conversations
        return { conversations: rest, order: state.order.filter((x) => x !== prev.id), activeId: action.id }
      }
      return { ...state, activeId: action.id }
    }

    case 'sendStart':
      return patch(state, action.id, (c) => {
        const messages = action.retryOf
          ? c.messages.map((m) => (m.id === action.retryOf ? { ...m, status: 'sending' } : m))
          : [...c.messages, action.message]
        return {
          ...c,
          title: c.messages.length === 0 ? makeTitle(action.message.text) : c.title,
          role: c.role ?? action.role ?? null,
          messages,
          pending: true,
          pendingSince: Date.now(),
          error: null,
          updatedAt: Date.now(),
        }
      })

    case 'sendSuccess':
      return patch(state, action.id, (c) => ({
        ...c,
        messages: [
          ...c.messages.map((m) => (m.id === action.userMessageId ? { ...m, status: 'sent' } : m)),
          action.reply,
        ],
        pending: false,
        pendingSince: null,
        updatedAt: Date.now(),
      }))

    case 'sendFailure':
      return patch(state, action.id, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === action.userMessageId
            ? { ...m, status: action.error.code === 'cancelled' ? 'stopped' : 'failed' }
            : m,
        ),
        pending: false,
        pendingSince: null,
        error: { ...action.error, userMessageId: action.userMessageId },
        updatedAt: Date.now(),
      }))

    case 'dismissError':
      return patch(state, action.id, (c) => ({ ...c, error: null }))

    case 'clear':
      // Clearing also drops the agent context: a new threadId starts a fresh Foundry conversation.
      return patch(state, action.id, (c) => ({
        ...c,
        title: 'New conversation',
        messages: [],
        threadId: uid('thread'),
        role: null,
        pending: false,
        pendingSince: null,
        error: null,
        updatedAt: Date.now(),
      }))

    case 'delete': {
      const { [action.id]: _removed, ...rest } = state.conversations
      const order = state.order.filter((x) => x !== action.id)
      if (order.length === 0) {
        const conv = createConversation()
        return { conversations: { [conv.id]: conv }, order: [conv.id], activeId: conv.id }
      }
      return {
        conversations: rest,
        order,
        activeId: state.activeId === action.id ? order[0] : state.activeId,
      }
    }

    default:
      return state
  }
}
