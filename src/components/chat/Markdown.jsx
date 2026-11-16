import { ArrowUpRight, FileText } from 'lucide-react'
import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { applyCitationAnnotations, citationLabel, remarkCollapseCitations, remarkSourceCitations, SOURCE_PREFIX } from '../../lib/citations.js'
import { remarkActionPlans } from '../../lib/responseExperience.js'
import { ActionPlan } from './ActionPlan.jsx'
import { ActionPlanContext } from './actionPlanContext.js'
import { courseForUrl } from '../../lib/courseLinks.js'

export const Markdown = memo(function Markdown({ text, references = [], interactive = false, progress, onProgress }) {
  const source = useMemo(() => applyCitationAnnotations(text, references), [text, references])
  const plugins = useMemo(() => [remarkGfm, ...(interactive ? [remarkActionPlans] : []), [remarkSourceCitations, { references }], [remarkCollapseCitations, { references }]], [references, interactive])
  const planContext = useMemo(() => ({ progress, onProgress }), [progress, onProgress])
  const components = useMemo(() => ({
    ol({ node, children, ...props }) {
      const planId = props['data-action-plan'] || node.properties?.dataActionPlan || node.properties?.['data-action-plan']
      return interactive && planId
        ? <ActionPlan planId={planId}>{children}</ActionPlan>
        : <ol {...props}>{children}</ol>
    },
    a({ href = '', children }) {
      if (href === '#source-unavailable') {
        return <span className="cite-chip cite-unavailable" title={`Source ${children} was cited, but its passage was not returned.`}><FileText size={11} aria-hidden="true" /> Source unavailable</span>
      }
      const course = courseForUrl(href)
      if (course) return <a className="inline-course-button" href={course.url} target="_blank" rel="noopener noreferrer" aria-label={`View ${course.title} course page (opens in a new tab)`}>{typeof children === 'string' && /^https?:\/\//.test(children) ? course.title : children}<ArrowUpRight size={13} aria-hidden="true" /></a>
      const reference = href.startsWith(SOURCE_PREFIX)
        ? references.find((item) => item.key === href.slice(SOURCE_PREFIX.length))
        : null
      if (reference) {
        // Citations show only which knowledge base the statement came from; they are not clickable.
        const label = citationLabel(reference)
        return (
          <span className="cite-chip cite-static" aria-label={`Source: ${label}`}>
            <FileText size={11} strokeWidth={1.7} aria-hidden="true" />
            <span>{label}</span>
          </span>
        )
      }
      const external = /^https?:\/\//i.test(href)
      return <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>
    },
  }), [references, interactive])

  return <ActionPlanContext.Provider value={planContext}><div className="prose-chat"><ReactMarkdown remarkPlugins={plugins} components={components}>{source}</ReactMarkdown></div></ActionPlanContext.Provider>
})
