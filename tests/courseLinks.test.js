import assert from 'node:assert/strict'
import test from 'node:test'
import { COURSE_DIRECTORY_URL, COURSE_PAGES, courseActions, courseForUrl } from '../src/lib/courseLinks.js'

test('plain-text course lists get distinct real course destinations in answer order', () => {
  const result = courseActions('Courses include **Business Administration Level 3**, HR Support (Level 3) and Early Years Educator Level 3.', 'Which courses do you offer?')
  assert.deepEqual(result.courses.map((course) => course.title), ['Business Administrator', 'HR Support', 'Early Years Educator'])
  assert.equal(result.courses[2].url, 'https://apprenticeshipconnect.co.uk/level-3-childcare-apprenticeship/')
  assert.equal(result.showDirectory, true)
})

test('longer course names do not create buttons for different, shorter courses', () => {
  const result = courseActions('Specialist Teaching Assistant Level 5 and Internal Recruiter Level 3.', 'Explain these courses.')
  assert.deepEqual(result.courses.map((course) => course.title), ['Specialist Teaching Assistant', 'Internal Recruiter'])
  assert.equal(courseActions('Specialist Teaching Assistant Level 3.', 'Explain this course.').courses.length, 0)
  assert.equal(courseActions('Teaching Assistant Level 5.', 'Explain this course.').courses.length, 0)
})

test('links remain safe and normalize only documented course URL aliases', () => {
  assert.equal(courseForUrl('https://apprenticeshipconnect.co.uk/course/level-3-internal-recruiter/?campaign=chat')?.path, '/level-3-internal-recruiter/')
  assert.equal(courseForUrl('/level-3-business-administrator/')?.title, 'Business Administrator')
  assert.equal(courseForUrl('https://apprenticeshipconnect.co.uk.evil.example/level-3-business-administrator/'), null)
  assert.equal(courseForUrl('javascript:alert(1)'), null)
  assert.equal(courseForUrl('https://example.com/level-3-business-administrator/'), null)
})

test('unknown courses fall back to the directory instead of invented course slugs', () => {
  const result = courseActions('We can discuss a Quantum Robotics course.', 'Explain the Quantum Robotics course.')
  assert.deepEqual(result.courses, [])
  assert.equal(result.showDirectory, true)
  assert.equal(COURSE_DIRECTORY_URL, 'https://apprenticeshipconnect.co.uk/apprenticeship-courses/')
  assert.equal(COURSE_PAGES.length, 14)
})

test('broad course-list questions can browse the checked directory even if the agent omits names', () => {
  const result = courseActions('A human recruiter can discuss course options with you.', 'Which all courses do you offer?')
  assert.equal(result.fromDirectory, true)
  assert.equal(result.courses.length, 14)
  assert.equal(courseActions('Tell me about your interests first.', 'Which course is best for me?').courses.length, 0)
})

test('normal hiring replies and code samples do not turn generic job roles into course ads', () => {
  assert.equal(courseActions('A human recruiter will review the profile and discuss course options.', 'How does recruitment work?').courses.length, 0)
  assert.equal(courseActions('```\nBusiness Administrator Level 3\n```', 'How do I use this code?').courses.length, 0)
  assert.equal(courseActions('Hello! How can I help?', 'Hi').showDirectory, false)
})

test('known course URLs in answers and cited sources work even without a repeated course name', () => {
  const url = 'https://apprenticeshipconnect.co.uk/hr-support-level-3/'
  assert.equal(courseActions(`Read [the course page](${url}).`).courses[0].title, 'HR Support')
  const references = [{ kind: 'web', url, title: 'Programme details' }]
  assert.equal(courseActions('Read the programme details.', 'Explain this course.', references).courses[0].title, 'HR Support')
  assert.equal(courseActions('Consider the details.', 'Hi', [{ ...references[0], kind: 'document', cited: false }]).courses.length, 0)
})
