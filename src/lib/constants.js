export const MAX_MESSAGE_CHARS = 8000

export const ASSISTANT_NAME = 'Recruitment Assistant'

/** Starter prompts shown on the empty screen. `role` tells the agent which journey the user chose. */
export const STARTER_QUESTIONS = [
  { label: 'Find an apprenticeship', text: 'I am looking for an apprenticeship. Where should I start?', role: 'apprentice' },
  { label: 'Plan a hire', text: 'I want to recruit apprentices. How do I get started?', role: 'employer' },
  { label: 'Explore courses', text: 'What apprenticeship courses are available?' },
  { label: 'How it works', text: 'How does the apprenticeship application process work?' },
]
