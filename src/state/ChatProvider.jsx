import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { ChatApiError, resetThread, sendChatMessage } from '../api/chatApi.js'
import { uid } from '../lib/format.js'
import { ChatContext } from './chatContext.js'
import { chatReducer, initChatState } from './chatReducer.js'

export function ChatProvider({ children }) {
  const [state, dispatch] = useReducer(chatReducer, undefined, initChatState)
  const stateRef = useRef(state)
  const controllers = useRef(new Map()) // conversationId -> AbortController

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    const map = controllers.current
    return () => map.forEach((c) => c.abort())
  }, [])

  const abort = useCallback((id) => {
    controllers.current.get(id)?.abort()
    controllers.current.delete(id)
  }, [])

  const run = useCallback(async (convId, userMessage, { retryOf, role } = {}) => {
    const conv = stateRef.current.conversations[convId]
    if (!conv || conv.pending) return

    dispatch({ type: 'sendStart', id: convId, message: userMessage, retryOf, role })

    const controller = new AbortController()
    controllers.current.set(convId, controller)
    try {
      const result = await sendChatMessage({
        message: userMessage.text,
        threadId: conv.threadId,
        role: conv.role ?? role,
        signal: controller.signal,
      })
      dispatch({
        type: 'sendSuccess',
        id: convId,
        userMessageId: userMessage.id,
        reply: {
          id: uid('msg'),
          author: 'assistant',
          text: result.text,
          sources: result.sources ?? [],
          citations: result.citations ?? [],
          toolCalls: result.toolCalls ?? [],
          toolIssues: result.toolIssues ?? [],
          incompleteReason: result.incompleteReason ?? null,
          grounding: result.grounding ?? null,
          routed: result.routed ?? null,
          createdAt: Date.now(),
        },
      })
    } catch (err) {
      const error =
        err instanceof ChatApiError
          ? err.toPlain()
          : { code: 'client_error', message: 'Something went wrong in the app.', hint: err?.message, retryable: true }
      dispatch({ type: 'sendFailure', id: convId, userMessageId: userMessage.id, error })
    } finally {
      if (controllers.current.get(convId) === controller) controllers.current.delete(convId)
    }
  }, [])

  // `role` is optional: the employer/apprentice starter prompts pass it so the agent gets the journey context.
  const sendMessage = useCallback(
    (text, role) => {
      const trimmed = text.trim()
      if (!trimmed) return
      const id = stateRef.current.activeId
      run(id, { id: uid('msg'), author: 'user', text: trimmed, createdAt: Date.now(), status: 'sending' }, { role })
    },
    [run],
  )

  const retry = useCallback(
    (convId) => {
      const conv = stateRef.current.conversations[convId]
      const msg = conv?.messages.find((m) => m.id === conv.error?.userMessageId)
      if (msg) run(convId, msg, { retryOf: msg.id })
    },
    [run],
  )

  const actions = useMemo(
    () => ({
      sendMessage,
      retry,
      stop: (id) => abort(id),
      newChat: () => dispatch({ type: 'new' }),
      select: (id) => dispatch({ type: 'select', id }),
      dismissError: (id) => dispatch({ type: 'dismissError', id }),
      clear: (id) => {
        abort(id)
        resetThread(stateRef.current.conversations[id]?.threadId)
        dispatch({ type: 'clear', id })
      },
      remove: (id) => {
        abort(id)
        resetThread(stateRef.current.conversations[id]?.threadId)
        dispatch({ type: 'delete', id })
      },
    }),
    [abort, retry, sendMessage],
  )

  const value = useMemo(() => {
    const active = state.conversations[state.activeId]
    const conversations = state.order.map((id) => state.conversations[id])
    return { state, active, conversations, ...actions }
  }, [state, actions])

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}
