import { SignUp, SignedIn } from '@clerk/clerk-react'
import { Navigate, useNavigate } from 'react-router-dom'
import './AuthLayout.css'

const clerkAppearance = {
  variables: {
    colorPrimary: '#0250B0',
    colorText: '#0B1B33',
    borderRadius: '8px',
  },
}

function SignUpPage() {
  const navigate = useNavigate()

  return (
    <>
      <SignedIn>
        <Navigate to="/dashboard" replace />
      </SignedIn>
      <div className="auth-shell">
        <button className="auth-back-button" onClick={() => navigate('/role-select')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
          Back
        </button>
        <div className="auth-brand-panel">
          <div className="auth-brand-overlay">
            <img src="/logo-crest-reversed.svg" alt="KickStat" className="auth-brand-logo" />
            <p className="auth-brand-tagline">Set up your squad in minutes.</p>
          </div>
        </div>
        <div className="auth-form-panel">
          <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" appearance={clerkAppearance} />
        </div>
      </div>
    </>
  )
}

export default SignUpPage