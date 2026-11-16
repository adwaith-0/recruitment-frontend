import { ArrowUpRight, GraduationCap } from 'lucide-react'
import { COURSE_DIRECTORY_URL } from '../../lib/courseLinks.js'

export function CourseLinks({ courses, showDirectory, fromDirectory }) {
  if (!showDirectory) return null
  return (
    <section className="response-courses" aria-label="Course pages">
      {courses.length > 0 && <>
        <div className="response-courses-heading"><GraduationCap size={15} aria-hidden="true" /><span>{fromDirectory ? 'From the course directory' : courses.length === 1 ? 'Explore this course' : 'Explore the courses'}</span></div>
        <div className="response-course-grid">
          {courses.map((course) => <div key={course.url} className="response-course-card">
            <span className="response-course-level">Level {course.level}</span>
            <h3>{course.title}</h3>
            <a className="course-page-button" href={course.url} target="_blank" rel="noopener noreferrer" aria-label={`View ${course.title} course page (opens in a new tab)`}>View course<ArrowUpRight size={14} aria-hidden="true" /></a>
          </div>)}
        </div>
      </>}
      <a className="course-directory-button" href={COURSE_DIRECTORY_URL} target="_blank" rel="noopener noreferrer">Browse all courses<ArrowUpRight size={14} aria-hidden="true" /></a>
    </section>
  )
}
