import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyGreeting, normaliseGreeting } from '../server/greetings.js'

test('required greetings return the predefined replies', () => {
  assert.equal(classifyGreeting('hi')?.text, 'Hello! Are you looking for an apprenticeship or hoping to recruit apprentices?')
  assert.equal(classifyGreeting('hello')?.text, 'Hello! How can I help you today?')
  assert.equal(classifyGreeting('hey')?.text, 'Hi! Are you an employer or an apprentice?')
  assert.equal(classifyGreeting('thanks')?.text, "You're welcome! Is there anything else I can help with?")
  assert.equal(classifyGreeting('bye')?.text, 'Goodbye! Have a great day.')
})

test('case, surrounding whitespace and ordinary trailing punctuation are normalised', () => {
  for (const input of ['Hi', '  HI  ', 'hi!', 'Hi!!', 'hi.', 'hello?', 'Hey…', 'Thanks!', 'thank   you', 'Thank you so much!', 'Bye.', 'Good morning!']) {
    assert.ok(classifyGreeting(input), `expected greeting: ${JSON.stringify(input)}`)
  }
  assert.equal(normaliseGreeting('  Thank\tYou!! '), 'thank you')
})

test('greeting plus a question is NOT greeting-only', () => {
  for (const input of [
    'Hi, how does employer recruitment work?',
    'Hi, what are the apprenticeship eligibility requirements?',
    'Hello, can employers recruit apprentices without paying fees?',
    'hi what courses do you offer',
    'hello there, I want to hire',
    'thanks, and what about funding?',
    'Hey! Is there a fee?',
    'hi hi',
    'hiring',
    'Hellooo can you help',
  ]) {
    assert.equal(classifyGreeting(input), null, `must go to retrieval: ${JSON.stringify(input)}`)
  }
})

test('confirmations and short answers are never intercepted (they answer the agent)', () => {
  for (const input of ['ok', 'yes', 'no', 'sure', 'London', 'confirm', 'yes thanks', 'ok bye']) {
    assert.equal(classifyGreeting(input), null, input)
  }
})

test('non-string and oversized input is rejected safely', () => {
  assert.equal(classifyGreeting(undefined), null)
  assert.equal(classifyGreeting(42), null)
  assert.equal(classifyGreeting(`hi${' '.repeat(200)}`), null)
})
