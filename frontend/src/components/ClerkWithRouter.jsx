import { useNavigate } from 'react-router-dom'
import { ClerkProvider } from '@clerk/clerk-react'

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

// ClerkProvider must live inside the router so Clerk navigates with React
// Router (routerPush/routerReplace) instead of full page reloads, and it needs
// explicit post-auth destinations. Without them Clerk sent every user to "/"
// after signing in or up — the landing page, which looked like the sign-in
// had silently failed. /dashboard runs OnboardingGuard, which sends a new
// coach on to /setup and everyone else into the app.
export default function ClerkWithRouter({ children }) {
  const navigate = useNavigate()
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
      afterSignOutUrl="/"
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
      {children}
    </ClerkProvider>
  )
}
