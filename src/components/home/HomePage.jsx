import { ChevronDown, Mail, Menu, Phone, X } from 'lucide-react'
import { useState } from 'react'

const site = 'https://apprenticeshipconnect.co.uk'
const navigation = [
  { label: 'Apprentices', href: '/apprenticeship-eligibility/', children: [
    ['Become an apprentice', '/apprenticeship-eligibility/'],
    ['Apprenticeship vacancies', '/apprenticeship-eligibility/apprenticeship-vacancies/'],
  ] },
  { label: 'Employers', href: '/apprenticeship-recruitment/', children: [
    ['Recruit an apprentice', '/apprenticeship-recruitment/'],
    ['Apprenticeship funding', '/apprenticeship-recruitment/apprenticeship-funding/'],
  ] },
  { label: 'Our Courses', href: '/apprenticeship-courses/', children: [
    ['Explore all courses', '/apprenticeship-courses/'],
  ] },
  { label: 'Our Story', href: '/about-apprenticeship-connect/', children: [
    ['About Apprenticeship Connect', '/about-apprenticeship-connect/'],
  ] },
  { label: 'Careers at AC', href: '/careers-at-ac-2/' },
  { label: 'News and updates', href: '/apprenticeship-connect-news-and-updates/' },
  { label: 'Get in touch', href: '/contact-apprenticeship-connect/' },
]

function SiteLink({ href, children, ...props }) {
  return <a href={`${site}${href}`} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
}

export function HomePage() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="home-page">
      <header>
        <div className="home-contact-bar">
          <div className="home-contact-inner">
            <div className="home-contact-links">
              <a href="tel:02031037033"><Phone size={14} fill="currentColor" aria-hidden="true" />020 3103 7033</a>
              <a href="mailto:callback@apprenticeshipconnect.co.uk"><Mail size={15} aria-hidden="true" /><span>callback@apprenticeshipconnect.co.uk</span></a>
            </div>
            <div className="home-social-links" aria-label="Social media">
              <a href="https://www.facebook.com/apprenticeshipconnect" target="_blank" rel="noopener noreferrer" aria-label="Facebook"><img src="/images/social-facebook-f.svg" alt="" width="17" height="17" /></a>
              <a href="https://www.linkedin.com/school/apprenticeship-connect/" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn"><img src="/images/social-linkedin-in.svg" alt="" width="17" height="17" /></a>
              <a href="https://www.instagram.com/apprenticeshipconnect/" target="_blank" rel="noopener noreferrer" aria-label="Instagram"><img src="/images/social-instagram.svg" alt="" width="17" height="17" /></a>
              <a href="https://www.tiktok.com/@apprenticeshipconnect" target="_blank" rel="noopener noreferrer" aria-label="TikTok"><img src="/images/social-tiktok.svg" alt="" width="18" height="18" /></a>
            </div>
          </div>
        </div>
        <div className="home-navigation">
          <a href="/" className="home-logo" aria-label="Apprenticeship Connect home"><img src="/images/apprenticeship-connect-logo.png" alt="Apprenticeship Connect" width="600" height="148" /></a>
          <button type="button" className="home-menu-toggle" aria-expanded={menuOpen} aria-controls="home-nav-links" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X size={23} /> : <Menu size={23} />}
          </button>
          <nav id="home-nav-links" aria-label="Main navigation" className={`home-nav-links${menuOpen ? ' home-nav-open' : ''}`}>
            {navigation.map((item) => item.children ? (
              <details key={item.label} className="home-nav-group">
                <summary>{item.label}<ChevronDown size={12} fill="currentColor" aria-hidden="true" /></summary>
                <div className="home-nav-dropdown">
                  {item.children.map(([label, href]) => <SiteLink key={href} href={href}>{label}</SiteLink>)}
                </div>
              </details>
            ) : <SiteLink key={item.label} href={item.href}>{item.label}</SiteLink>)}
          </nav>
          <a className="home-login" href="https://web.bud.co.uk/" target="_blank" rel="noopener noreferrer">Bud Login</a>
        </div>
      </header>

      <main className="home-hero">
        <div className="home-hero-copy">
          <div className="home-hero-content">
            <h1><span className="home-highlight">Elevate<svg aria-hidden="true" viewBox="0 0 170 20" preserveAspectRatio="none"><path d="M3 16C50 1 110 1 165 12" /></svg></span> your business with apprenticeships</h1>
            <p>Shape new talent to meet your specific needs, or upskill existing staff to stay ahead in a dynamic market. Investing in apprenticeships not only addresses skill gaps but also creates a loyal, innovative workforce, driving increased productivity and long-term success.</p>
            <SiteLink className="home-primary-button" href="/contact-apprenticeship-connect/">Register your interest</SiteLink>
          </div>
        </div>
        <div className="home-hero-image"><img src="/images/apprenticeship-team.png" alt="Two colleagues working together at a laptop" width="1024" height="1024" fetchPriority="high" /></div>
      </main>
    </div>
  )
}
