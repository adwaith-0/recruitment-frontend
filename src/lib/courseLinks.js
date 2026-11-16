// Course names and destinations checked against the provider's course directory.
// Refresh procedure and source URLs: docs/course-links.md. Never generate slugs.
const origin = 'https://apprenticeshipconnect.co.uk'
export const COURSE_DIRECTORY_URL = `${origin}/apprenticeship-courses/`

export const COURSE_PAGES = [
  { title: 'Accounts or Finance Assistant', level: 2, path: '/level-2-accounts-or-finance-assistant/', aliases: ['Accounts or Finance Assistant', 'Accounts / Finance Assistant'] },
  { title: 'Assistant Accountant', level: 3, path: '/level-3-assistant-accountant/', aliases: ['Assistant Accountant', 'Assistant Accounting'] },
  { title: 'Business Administrator', level: 3, path: '/level-3-business-administrator/', aliases: ['Business Administrator', 'Business Administration'] },
  { title: 'Early Years Practitioner', level: 2, path: '/level-2-childcare-practitioner/', aliases: ['Early Years Practitioner', 'Childcare Practitioner'] },
  { title: 'Early Years Educator', level: 3, path: '/level-3-childcare-apprenticeship/', aliases: ['Early Years Educator'] },
  { title: 'HR Support', level: 3, path: '/hr-support-level-3/', aliases: ['HR Support', 'Human Resources Support'] },
  { title: 'Internal Recruiter', level: 3, path: '/level-3-internal-recruiter/', aliases: ['Internal Recruiter'] },
  { title: 'Multi-channel Marketer', level: 3, path: '/level-3-multi-channel-marketer/', aliases: ['Multi-channel Marketer', 'Multi channel Marketer', 'Multichannel Marketer', 'Multi-channel Marketing'] },
  { title: 'Recruiter', level: 3, path: '/level-3-recruiter/', aliases: ['Recruiter'] },
  { title: 'Teaching Assistant', level: 3, path: '/level-3-teaching-assistant-apprenticeship/', aliases: ['Teaching Assistant'] },
  { title: 'Team Leader / Supervisor', level: 3, path: '/level-3-team-leader-apprenticeship/', aliases: ['Team Leader/Supervisor', 'Team Leader / Supervisor', 'Team Leader', 'Team Leadership'] },
  { title: 'Professional Accounting Technician', level: 4, path: '/level-4-professional-accounting-technician/', aliases: ['Professional Accounting Technician', 'Accounting Technician'] },
  { title: 'Early Years Lead Practitioner', level: 5, path: '/level-5-early-years-lead-practitioner/', aliases: ['Early Years Lead Practitioner'] },
  { title: 'Specialist Teaching Assistant', level: 5, path: '/specialist-teaching-assistant-level-5/', aliases: ['Specialist Teaching Assistant'] },
].map((course) => ({ ...course, url: `${origin}${course.path}` }))

// Public links found in the site's older navigation can be resolved to the
// current page, rather than rendering duplicate buttons for the same course.
const urlAliases = new Map([
  ['/course/level-3-internal-recruiter/', '/level-3-internal-recruiter/'],
  ['/level-3-team-leader-supervisor-apprenticeship/', '/level-3-team-leader-apprenticeship/'],
])

export function courseForUrl(value) {
  try {
    const url = new URL(value, origin)
    if (!['https:', 'http:'].includes(url.protocol) || url.hostname.replace(/^www\./, '') !== 'apprenticeshipconnect.co.uk' || url.username || url.password) return null
    const path = `${url.pathname.replace(/\/+$/, '')}/`
    return COURSE_PAGES.find((course) => course.path === (urlAliases.get(path) ?? path)) ?? null
  } catch { return null }
}

export function isCourseQuestion(question) {
  return /\bcourses?\b|\b(?:study|curriculum|programmes?|training options)\b/i.test(question)
}

export function isCourseDirectoryQuestion(question) {
  if (/\b(?:recommend|best|suitable|right for|for me)\b/i.test(question)) return false
  return /\b(?:what|which)\s+(?:all\s+)?courses?\b|\b(?:list|show|browse)\b.{0,30}\bcourses\b|\ball\s+(?:your\s+)?courses\b|\bcourse\s+(?:list|directory|catalogue)\b/i.test(question)
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function visibleAnswerText(text) {
  return text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '').replace(/[*_`]/g, '')
}

export function courseActions(text, question = '', references = []) {
  const visible = visibleAnswerText(text)
  const courseContext = isCourseQuestion(question) || /\b(?:courses?|programmes?|curriculum)\b/i.test(visible)
  const candidates = []
  for (const course of COURSE_PAGES) {
    for (const alias of course.aliases) {
      const pattern = new RegExp(`\\b${escapeRegExp(alias).replace(/[ /-]+/g, '[ \\t/–-]+')}\\b`, 'gi')
      for (const match of visible.matchAll(pattern)) {
        const before = visible.slice(Math.max(0, match.index - 28), match.index)
        const after = visible.slice(match.index + match[0].length, match.index + match[0].length + 28)
        const beforeLevel = before.match(/\b(?:level|l)\s*([2-7])\s*[:(–-]?\s*$/i)
        const afterLevel = after.match(/^\s*[:(–-]?\s*(?:apprenticeship\s+)?(?:level|l)\s*([2-7])\b/i)
        const explicitLevel = beforeLevel?.[1] ?? afterLevel?.[1]
        const linePrefix = visible.slice(visible.lastIndexOf('\n', match.index - 1) + 1, match.index)
        const courseEntry = /^\s*(?:[-*]\s+|\d+[.)]\s+|#{1,6}\s+)$/.test(linePrefix) || /\bcourses?\s+(?:include|are)\s*$/i.test(before)
        const genericRole = course.title === 'Recruiter' && !explicitLevel && !courseEntry && !/^\s+(?:course|apprenticeship|programme)\b/i.test(after)
        const eligible = (!explicitLevel || Number(explicitLevel) === course.level) && (courseContext || Boolean(explicitLevel)) && !genericRole
        candidates.push({ course, start: match.index, end: match.index + match[0].length, eligible })
      }
    }
  }
  // A Specialist Teaching Assistant or Internal Recruiter is a distinct course;
  // its longer name must not create an extra button for the shorter course.
  const accepted = []
  for (const candidate of candidates.sort((a, b) => b.end - b.start - (a.end - a.start))) {
    if (!accepted.some((item) => candidate.start < item.end && candidate.end > item.start)) accepted.push(candidate)
  }
  const courses = []
  for (const { course, eligible } of accepted.sort((a, b) => a.start - b.start)) if (eligible && !courses.some((item) => item.url === course.url)) courses.push(course)

  const linkedCourses = new Set([...text.matchAll(/https?:\/\/[^\s<>)\]]+/g)].map((match) => courseForUrl(match[0])?.url).filter(Boolean))
  for (const reference of references) {
    if (!courseContext || (!reference.cited && reference.kind !== 'web')) continue
    const course = [reference.url, reference.document, reference.uri].map(courseForUrl).find(Boolean)
    if (course) linkedCourses.add(course.url)
  }
  for (const url of linkedCourses) {
    const course = courseForUrl(url)
    if (!courses.some((item) => item.url === url)) courses.push(course)
  }
  const fromDirectory = courses.length === 0 && isCourseDirectoryQuestion(question)
  if (fromDirectory) courses.push(...COURSE_PAGES)
  return { courses, fromDirectory, showDirectory: courseContext || courses.length > 0 }
}
