import { useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { FavoritesProvider } from './context/FavoritesContext'
import { AudioPlayerProvider } from './context/AudioPlayerContext'
import { SoundboardProvider } from './context/SoundboardContext'
import { ThemeProvider } from './context/ThemeContext'
import SetupView from './views/SetupView'
import LoginView from './views/LoginView'
import LoadingScreen from './components/LoadingScreen'
import AppShell from './components/AppShell'
import ShareView from './views/ShareView'

export default function App() {
  // App is always rendered inside AuthProvider (see main.tsx).
  const { status, user, login } = useAuth()!
  const { pathname } = useLocation()

  // A share link's page is public (issue #541): it renders for anyone, signed
  // in or not, before any of the auth gates below.
  const share = /^\/share\/([^/]+)\/?$/.exec(pathname)
  if (share) return <ShareView token={decodeURIComponent(share[1])} />

  if (status === 'loading') return <LoadingScreen />
  if (status === 'uninitialized') return <SetupView onSetup={login} />
  if (status === 'unauthenticated') return <LoginView onLogin={login} />
  // Keyed by account: if a different user signs in without a page load, every
  // provider below starts over and reads that user's own stored state.
  return (
    <ThemeProvider key={user?.id}>
      <FavoritesProvider>
        <AudioPlayerProvider>
          <SoundboardProvider>
            <AppShell />
          </SoundboardProvider>
        </AudioPlayerProvider>
      </FavoritesProvider>
    </ThemeProvider>
  )
}
