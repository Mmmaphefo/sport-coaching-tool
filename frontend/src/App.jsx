import { Routes, Route } from 'react-router-dom'
import Welcome from './pages/Welcome'
import SignInPage from './pages/SignInPage'
import SignUpPage from './pages/SignUpPage'
import RoleSelect from './pages/RoleSelect'
import Dashboard from './pages/Dashboard'
import Roster from './pages/Roster'
import AthleteStats from './pages/AthleteStats'
import Compare from './pages/Compare'
import SeasonReport from './pages/SeasonReport'
import MatchReport from './pages/MatchReport'
import TacticsBoard from './pages/TacticsBoard'
import Sessions from './pages/Sessions'
import Setup from './pages/Setup'
import AccountSettings from './pages/AccountSettings'
import InviteAccept from './pages/InviteAccept'
import Events from './pages/Events'
import EventDetail from './pages/EventDetail'
import Live from './pages/Live'
import LiveMatch from './pages/LiveMatch'
import PublicLanding from './pages/PublicLanding'
import PublicSquad from './pages/PublicSquad'
import PublicSquadLink from './pages/PublicSquadLink'
import OnboardingGuard from './components/OnboardingGuard'
import ConfirmProvider from './components/ConfirmProvider'
import './App.css'

function App() {
  return (
    <ConfirmProvider>
      <Routes>
        <Route path="/" element={<Welcome />} />
        <Route path="/role-select" element={<RoleSelect />} />
        <Route
          path="/dashboard"
          element={
            <OnboardingGuard>
              <Dashboard />
            </OnboardingGuard>
          }
        />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/sign-in/*" element={<SignInPage />} />
        <Route path="/sign-up/*" element={<SignUpPage />} />
        <Route
          path="/setup"
          element={
            <OnboardingGuard>
              <Setup />
            </OnboardingGuard>
          }
        />
        <Route
          path="/roster"
          element={
            <OnboardingGuard>
              <Roster />
            </OnboardingGuard>
          }
        />
        <Route
          path="/roster/:id"
          element={
            <OnboardingGuard>
              <AthleteStats />
            </OnboardingGuard>
          }
        />
        <Route
          path="/compare"
          element={
            <OnboardingGuard>
              <Compare />
            </OnboardingGuard>
          }
        />
        <Route
          path="/tactics"
          element={
            <OnboardingGuard>
              <TacticsBoard />
            </OnboardingGuard>
          }
        />
        <Route
          path="/sessions"
          element={
            <OnboardingGuard>
              <Sessions />
            </OnboardingGuard>
          }
        />
        <Route
          path="/events"
          element={
            <OnboardingGuard>
              <Events />
            </OnboardingGuard>
          }
        />
        <Route
          path="/events/:id"
          element={
            <OnboardingGuard>
              <EventDetail />
            </OnboardingGuard>
          }
        />
        <Route
          path="/live"
          element={
            <OnboardingGuard>
              <Live />
            </OnboardingGuard>
          }
        />
        <Route
          path="/live/:id"
          element={
            <OnboardingGuard>
              <LiveMatch />
            </OnboardingGuard>
          }
        />
        <Route
          path="/live/fixture/:fixtureId"
          element={
            <OnboardingGuard>
              <LiveMatch />
            </OnboardingGuard>
          }
        />
        <Route
          path="/settings"
          element={
            <OnboardingGuard>
              <AccountSettings />
            </OnboardingGuard>
          }
        />
        <Route
          path="/reports"
          element={
            <OnboardingGuard>
              <SeasonReport />
            </OnboardingGuard>
          }
        />
        <Route
          path="/reports/match/:kind/:id"
          element={
            <OnboardingGuard>
              <MatchReport />
            </OnboardingGuard>
          }
        />
        <Route path="/invite/:token" element={<InviteAccept />} />

        {/* No OnboardingGuard, no auth — genuinely public */}
        <Route path="/public" element={<PublicLanding />} />
        <Route path="/public/:id" element={<PublicSquad />} />
        <Route path="/public/link/:token" element={<PublicSquadLink />} />
      </Routes>
    </ConfirmProvider>
  )
}

export default App