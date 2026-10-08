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

  // Players get read-only access to team pages (Tactics, Compare, Sessions)
  // so they can study game plans and review performance. Staff-only features
  // (Roster management, Live match logging) remain hidden.
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
          {navItem('/compare', 'Compare')}
          {navItem('/tactics', 'Tactics')}
          {navItem('/sessions', 'Sessions')}
          {navItem('/events', 'Events')}
          {!isAthlete && navItem('/live', 'Live')}
          {!isAthlete && navItem('/seasons', 'Seasons')}
          {navItem('/stats', 'Squad Stats')}
          {!isAthlete && navItem('/friendlies', 'Friendlies')}
          {navItem('/leaderboard', 'Leaderboard')}
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
