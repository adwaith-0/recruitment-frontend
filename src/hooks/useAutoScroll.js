import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/**
 * Chat scrolling:
 * - While the user is near the bottom (e.g. just sent a message), new content keeps the view at the
 *   bottom so their question and the typing indicator stay visible.
 * - When a new reply arrives (`revealId` changes), the view scrolls to the START of that reply,
 *   keeping the user's question just above it when it fits, so long answers are read from the top.
 * - Exposes whether a "jump to latest" affordance should be shown.
 */
export function useAutoScroll(deps, { threshold = 120, resetToTop = false, revealId = null } = {}) {
  const ref = useRef(null)
  const pinned = useRef(true)
  const lastRevealId = useRef(revealId)
  const [showJump, setShowJump] = useState(false)

  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    pinned.current = distance < threshold
    setShowJump(distance > threshold * 2)
  }, [threshold])

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    const el = ref.current
    if (!el) return
    pinned.current = true
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  /** Scroll so the given reply starts at the top of the view. Returns false if it isn't rendered. */
  const revealStart = useCallback((id) => {
    const container = ref.current
    const reply = container?.querySelector(`[data-message-id="${CSS.escape(id)}"]`)
    if (!reply) return false
    const containerTop = container.getBoundingClientRect().top
    const top = (node) => container.scrollTop + node.getBoundingClientRect().top - containerTop
    let target = top(reply)
    // Include the question that prompted this reply when it doesn't push the answer too far down.
    const question = reply.previousElementSibling
    if (question?.matches('.user-message') && target - top(question) < container.clientHeight * 0.35) {
      target = top(question)
    }
    pinned.current = false
    container.scrollTo({ top: Math.max(0, target - 12), behavior: 'smooth' })
    return true
  }, [])

  useLayoutEffect(() => {
    const previous = lastRevealId.current
    lastRevealId.current = revealId
    if (resetToTop) {
      pinned.current = true
      ref.current?.scrollTo({ top: 0, behavior: 'instant' })
      setShowJump(false)
      return
    }
    // Layout effect: the new reply is already in the DOM and measurable here, with no dependency on
    // animation frames (which browsers pause in background tabs).
    if (revealId && revealId !== previous) {
      if (!revealStart(revealId) && pinned.current) scrollToBottom('smooth')
      return
    }
    if (pinned.current) scrollToBottom('smooth')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, resetToTop, revealId])

  return { ref, onScroll, showJump, scrollToBottom, pin: () => (pinned.current = true) }
}
