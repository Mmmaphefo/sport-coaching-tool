import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth, UserButton } from '@clerk/clerk-react'
import ThemeToggle from './ThemeToggle'
import { apiRequest } from '../lib/api'
import './Layout.css'

function Layout({ children }) {
  const location = useLocation()
  const { getToken } = useAuth()
  const [me, setMe] = useState(null)

  useEffect(() => {
    let cancelled = false
    apiRequest('/api/account/me', { getToken })
      .then((account) => {
        if (!cancelled) setMe(account)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [getToken])

  // Players watch live scores from their dashboard instead — the live match
  // centre is a staff-only logging UI, so the nav item is hidden for them.
  // Players also get no team-wide pages at all: no Roster, Compare, Tactics
  // or Sessions. In their place sits "My Stats", which opens their own
  // profile card (/roster/:id) — the same page the coach sees for them.
  const isAthlete = me?.role === 'athlete'
  const athleteId = me?.athleteId ?? null

  const navItem = (to, label) => {
    const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`)
    return (
      <Link to={to} className={`nav-link ${isActive ? 'nav-link-active' : ''}`}>
        {label}
      </Link>
    )
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-crest">
          <img src="/logo-crest-reversed.svg" alt="" className="app-crest-mark" />
          <span className="app-crest-name">KickStat</span>
        </div>
        <nav className="app-nav">
          {navItem('/dashboard', 'Dashboard')}
          {!isAthlete && navItem('/roster', 'Roster')}
          {isAthlete && athleteId && navItem(`/roster/${athleteId}`, 'My Stats')}
          {!isAthlete && navItem('/compare', 'Compare')}
          {!isAthlete && navItem('/tactics', 'Tactics')}
          {!isAthlete && navItem('/sessions', 'Sessions')}
          {navItem('/events', 'Events')}
          {!isAthlete && navItem('/live', 'Live')}
          {navItem('/settings', 'Settings')}
        </nav>
        <div className="app-sidebar-footer">
          <ThemeToggle />
          <UserButton />
        </div>
      </aside>
      <main className="app-main">{children}</main>
    </div>
  )
}

export default Layout
