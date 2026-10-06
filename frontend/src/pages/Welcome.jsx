import { SignedIn, SignedOut } from '@clerk/clerk-react'
import { Navigate, Link } from 'react-router-dom'
import './Welcome.css'

function Welcome() {
  return (
    <>
      <SignedIn>
        <Navigate to="/role-select" replace />
      </SignedIn>
      <SignedOut>
        <div className="welcome-hero">
          <div className="welcome-overlay" />
          <div className="welcome-vignette" />

          <header className="welcome-topbar">
            <div className="welcome-brand">
              <img src="/logo-crest-reversed.svg" alt="KickStat" className="welcome-brand-logo" />
              <span className="welcome-brand-name">KICKSTAT</span>
            </div>
            <div className="welcome-badge">
              <span className="welcome-badge-dot" />
              BUILT FOR MATCHDAY
            </div>
          </header>

          <main className="welcome-content">
            <p className="welcome-eyebrow">
              THE COACH&rsquo;S <span className="welcome-eyebrow-hl">MATCHDAY</span> SYSTEM
            </p>
            <h1 className="welcome-title">
              <span className="welcome-title-line">OWN EVERY</span>
              <span className="welcome-title-line welcome-title-accent">MOMENT.</span>
            </h1>
            <p className="welcome-subtitle">
              Manage your squad, run live matchday logging, and keep every result on
              record. Coaches plan and track every session — players view their own
              analytics and match stats. One focused place to plan, play, and track
              your team.
            </p>
            <div className="welcome-actions">
              <Link to="/role-select" className="welcome-cta">
                GET STARTED <span className="welcome-cta-arrow">&rarr;</span>
              </Link>
              <Link to="/sign-in" className="welcome-cta-secondary">SIGN IN</Link>
            </div>
          </main>

          <footer className="welcome-bottombar">
            <span className="welcome-step">PLAN</span>
            <span className="welcome-step-divider" />
            <span className="welcome-step welcome-step-current">PLAY</span>
            <span className="welcome-step-divider" />
            <span className="welcome-step">TRACK</span>
          </footer>
        </div>
      </SignedOut>
    </>
  )
}

export default Welcome
