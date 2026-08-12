import { useAuth } from './context/AuthContext'
import { FavoritesProvider } from './context/FavoritesContext'
import { AudioPlayerProvider } from './context/AudioPlayerContext'
import { ThemeProvider } from './context/ThemeContext'
import SetupView from './views/SetupView'
import LoginView from './views/LoginView'
import LoadingScreen from './components/LoadingScreen'
import AppShell from './components/AppShell'

export default function App() {
  const { status, login } = useAuth()

  if (status === 'loading') return <LoadingScreen />
  if (status === 'uninitialized') return <SetupView onSetup={login} />
  if (status === 'unauthenticated') return <LoginView onLogin={login} />
  return (
    <ThemeProvider>
      <FavoritesProvider>
        <AudioPlayerProvider>
          <AppShell />
        </AudioPlayerProvider>
      </FavoritesProvider>
    </ThemeProvider>
  )
}
