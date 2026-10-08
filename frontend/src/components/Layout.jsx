import { Link, useLocation } from 'react-router-dom'
import { UserButton } from '@clerk/clerk-react'
import './Layout.css'

function Layout({ children }) {
  const location = useLocation()

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
          <span className="app-crest-mark">KS</span>
          <span className="app-crest-name">KickStat</span>
        </div>
        <nav className="app-nav">
          {navItem('/dashboard', 'Dashboard')}
          {navItem('/roster', 'Roster')}
          {navItem('/events', 'Events')}
          {navItem('/live', 'Live')}
          {navItem('/seasons', 'Seasons')}
          {navItem('/stats', 'Squad Stats')}
          {navItem('/friendlies', 'Friendlies')}
          {navItem('/leaderboard', 'Leaderboard')}
          {navItem('/settings', 'Settings')}
        </nav>
        <div className="app-sidebar-footer">
          <UserButton />
        </div>
      </aside>
      <main className="app-main">{children}</main>
    </div>
  )
}

export default Layout
