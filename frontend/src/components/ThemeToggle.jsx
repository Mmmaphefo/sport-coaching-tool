import { useState, useEffect } from 'react'
import { getInitialTheme, applyTheme } from '../lib/theme'
import './ThemeToggle.css'

function ThemeToggle() {
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const isDark = theme === 'dark'

  return (
    <label className="theme-toggle">
      <span className="theme-toggle-label">{isDark ? 'Dark mode' : 'Light mode'}</span>
      <span className="theme-toggle-switch">
        <input
          type="checkbox"
          checked={isDark}
          onChange={() => setTheme(isDark ? 'light' : 'dark')}
          aria-label="Toggle dark mode"
        />
        <span className="theme-toggle-track">
          <span className="theme-toggle-knob" />
        </span>
      </span>
    </label>
  )
}

export default ThemeToggle