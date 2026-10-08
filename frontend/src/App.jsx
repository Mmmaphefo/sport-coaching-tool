import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import Roster from './pages/Roster'
import AthleteStats from './pages/AthleteStats'
import Setup from './pages/Setup'
import AccountSettings from './pages/AccountSettings'
import InviteAccept from './pages/InviteAccept'
import Events from './pages/Events'
import EventDetail from './pages/EventDetail'
import Live from './pages/Live'
import LiveMatch from './pages/LiveMatch'
import Seasons from './pages/Seasons'
import SquadStats from './pages/SquadStats'
import Friendlies from './pages/Friendlies'
import Leaderboard from './pages/Leaderboard'
import OnboardingGuard from './components/OnboardingGuard'
import './App.css'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route
        path="/dashboard"
        element={
          <OnboardingGuard>
            <Dashboard />
          </OnboardingGuard>
        }
      />
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
        path="/seasons"
        element={
          <OnboardingGuard>
            <Seasons />
          </OnboardingGuard>
        }
      />
      <Route
        path="/stats"
        element={
          <OnboardingGuard>
            <SquadStats />
          </OnboardingGuard>
        }
      />
      <Route
        path="/friendlies"
        element={
          <OnboardingGuard>
            <Friendlies />
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
      <Route path="/invite/:token" element={<InviteAccept />} />
      <Route path="/leaderboard" element={<Leaderboard />} />
    </Routes>
  )
}

export default App
