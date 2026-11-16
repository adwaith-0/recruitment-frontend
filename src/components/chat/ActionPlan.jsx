import { Check, ListChecks } from 'lucide-react'
import { Children, isValidElement, useContext } from 'react'
import { ActionPlanContext } from './actionPlanContext.js'

export function ActionPlan({ children, planId }) {
  const { progress, onProgress } = useContext(ActionPlanContext)
  const items = Children.toArray(children).filter(isValidElement)
  const checked = progress?.[planId]?.checked ?? []
  const finished = checked.length === items.length

  const toggle = (index) => {
    const next = checked.includes(index) ? checked.filter((step) => step !== index) : [...checked, index].sort((a, b) => a - b)
    onProgress(planId, { checked: next, total: items.length })
  }

  return (
    <section className={`response-plan${finished ? ' response-plan-finished' : ''}`} aria-label="Interactive preparation checklist">
      <header className="response-plan-header">
        <span className="response-plan-icon">{finished ? <Check size={16} /> : <ListChecks size={16} />}</span>
        <div><strong>Your checklist</strong><span>Tick off your preparation as you go.</span></div>
        <span className="response-plan-count" aria-live="polite">{checked.length}/{items.length}</span>
      </header>
      <progress className="response-plan-progress" value={checked.length} max={items.length} aria-label="Preparation checklist progress" />
      <ol className="response-plan-items">
        {items.map((item, index) => (
          <li key={index} className={checked.includes(index) ? 'response-step response-step-done' : 'response-step'} style={{ '--step-index': index }}>
            <label className="response-step-control">
              <input type="checkbox" checked={checked.includes(index)} onChange={() => toggle(index)} aria-label={`Mark step ${index + 1} as prepared`} />
              <span aria-hidden="true">{checked.includes(index) ? <Check size={13} strokeWidth={2.5} /> : index + 1}</span>
            </label>
            <div className="response-step-content">{item.props.children}</div>
          </li>
        ))}
      </ol>
      <footer role="status">{finished ? 'All steps marked. Your preparation is taking shape.' : 'Your progress stays in this chat.'}</footer>
    </section>
  )
}
