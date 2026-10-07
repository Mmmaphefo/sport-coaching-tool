import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ClerkProvider } from '@clerk/clerk-react'
import './index.css'
import App from './App.jsx'

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env')
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ClerkProvider
        publishableKey={clerkPubKey}
        localization={{
          signIn: {
            start: {
              title: 'Sign in to KickStat',
              subtitle: 'Welcome back! Please sign in to continue',
            },
          },
          signUp: {
            start: {
              title: 'Create your KickStat account',
            },
          },
        }}
      >
        <App />
      </ClerkProvider>
    </BrowserRouter>
  </StrictMode>,
)
// Trigger redeploy for Clerk production keys
