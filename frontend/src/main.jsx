import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import ClerkWithRouter from './components/ClerkWithRouter'
import { wakeBackend } from './lib/api'
import { registerSW } from './lib/registerSW'

if (!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env')
}

// Start waking the (free-tier, sleep-on-idle) API immediately.
wakeBackend()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ClerkWithRouter>
        <App />
      </ClerkWithRouter>
    </BrowserRouter>
  </StrictMode>,
)

// Offline shell, registered last so a failing registration can never stand
// between the user and the app. No-op in dev — see lib/registerSW.js.
registerSW()
