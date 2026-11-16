// Deterministic greeting / acknowledgement handler.
//
// Runs in the bridge BEFORE any Foundry, LLM, MCP or Azure AI Search call. Only an exact,
// standalone greeting or acknowledgement (after normalising case, whitespace and ordinary
// trailing punctuation) is answered here. Anything else - including "Hi, how does employer
// recruitment work?" - goes through the source-grounded agent workflow.
//
// Deliberately NOT included: "ok", "yes", "sure", "no" and similar words. In the employer and
// apprentice journeys those are answers to the assistant's questions (for example confirming
// details before a handoff), so they must reach the agent with the conversation context.

const WELCOME = 'Hello! Are you looking for an apprenticeship or hoping to recruit apprentices?'
const THANKS = "You're welcome! Is there anything else I can help with?"
const GOODBYE = 'Goodbye! Have a great day.'

const REPLIES = new Map([
  // Required by the specification.
  ['hi', WELCOME],
  ['hello', 'Hello! How can I help you today?'],
  ['hey', 'Hi! Are you an employer or an apprentice?'],
  ['thanks', THANKS],
  ['bye', GOODBYE],
  // Common equivalents with no substantive content.
  ['hi there', WELCOME],
  ['hello there', 'Hello! How can I help you today?'],
  ['hey there', 'Hi! Are you an employer or an apprentice?'],
  ['hiya', WELCOME],
  ['good morning', WELCOME],
  ['good afternoon', WELCOME],
  ['good evening', WELCOME],
  ['thank you', THANKS],
  ['thanks a lot', THANKS],
  ['thanks so much', THANKS],
  ['thank you so much', THANKS],
  ['thank you very much', THANKS],
  ['many thanks', THANKS],
  ['cheers', THANKS],
  ['goodbye', GOODBYE],
  ['good bye', GOODBYE],
  ['bye bye', GOODBYE],
])

// Longest entry is well under this; anything longer cannot be a standalone greeting.
const MAX_GREETING_CHARS = 40

/** Lower-case, collapse whitespace, and drop ordinary trailing punctuation. */
export function normaliseGreeting(message) {
  if (typeof message !== 'string' || message.length > MAX_GREETING_CHARS * 2) return ''
  return message
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.!?,;:~…]+$/u, '')
    .trim()
}

/**
 * @returns {{ kind: 'greeting', text: string } | null}
 *   The predefined reply for a standalone greeting/acknowledgement, otherwise null.
 */
export function classifyGreeting(message) {
  const key = normaliseGreeting(message)
  if (!key || key.length > MAX_GREETING_CHARS) return null
  const text = REPLIES.get(key)
  return text ? { kind: 'greeting', text } : null
}
