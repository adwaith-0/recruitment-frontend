import { ArrowUpRight, BookOpen, BriefcaseBusiness, GraduationCap, Route } from 'lucide-react'
import { STARTER_QUESTIONS } from '../../lib/constants.js'

const icons = [GraduationCap, BriefcaseBusiness, BookOpen, Route]

export function WelcomeScreen({ children, onAsk, compact = false }) {
  return (
    <section className="welcome-screen" aria-labelledby="welcome-heading">
      <div className="welcome-heading">
        <h2 id="welcome-heading">{compact ? 'How can we help?' : 'Where should we begin?'}</h2>
        <p>Ask about apprenticeships, hiring, or your next step.</p>
      </div>
      {children}
      <div className="starter-prompts" aria-label="Suggested questions">
        {STARTER_QUESTIONS.map((question, index) => {
          const Icon = icons[index]
          return (
            <button type="button" key={question.label} onClick={() => onAsk(question.text, question.role)}>
              <Icon size={16} strokeWidth={1.6} aria-hidden="true" />
              <span>{question.label}</span>
              <ArrowUpRight className="starter-arrow" size={14} aria-hidden="true" />
            </button>
          )
        })}
      </div>
    </section>
  )
}
