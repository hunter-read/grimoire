import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import useScrollRestoration from './hooks/useScrollRestoration'
import { useTranslation } from 'react-i18next'
import { useAuth } from './context/AuthContext'
import { FavoritesProvider } from './context/FavoritesContext'
import { UISettingsProvider } from './context/UISettingsContext'
import api, { settings as settingsApi } from './api'
import Spinner from './components/Spinner'
import Sidebar from './components/Sidebar'
import MobileSidebar from './components/MobileSidebar'
import SetupView from './views/SetupView'
import LoginView from './views/LoginView'
import LibraryView from './views/LibraryView'
import SystemDetailView from './views/SystemDetailView'
import ReaderView from './views/ReaderView'
import MapsView from './views/MapsView'
import MapDetailView from './components/maps/MapDetailView'
import TokensView from './views/TokensView'
import TokenDetailView from './components/tokens/TokenDetailView'
import SearchView from './views/SearchView'
import SettingsView from './views/SettingsView'
import FavoritesView from './views/FavoritesView'
import CampaignsView from './views/CampaignsView'
import CampaignDetailView from './views/CampaignDetailView'

function LoadingScreen() {
  const { t } = useTranslation()
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-deep)',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 28, letterSpacing: '0.1em', marginBottom: 24 }}>{t('app.name')}</h1>
        <Spinner size={28} />
      </div>
    </div>
  )
}

// Wrapper that forces ReaderView to fully remount when bookId changes.
// Without this, React keeps the same component instance across book navigations,
// leaving currentPage/book/totalPages stale and rendering the wrong content.
function BookReader() {
  const { bookId } = useParams()
  return <ReaderView key={bookId} />
}

function AppShell() {
  const { user, logout } = useAuth()
  const [stats, setStats] = useState(null)
  const [uiSettings, setUiSettings] = useState({
    hide_maps: false,
    hide_tokens: false,
    hide_campaigns: false,
  })
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const location = useLocation()
  const isReader =
    location.pathname.startsWith('/library/book/') ||
    location.pathname.startsWith('/maps/') ||
    location.pathname.startsWith('/tokens/')
  const mainRef = useScrollRestoration()

  const refreshUiSettings = () =>
    settingsApi
      .getUi()
      .then(setUiSettings)
      .catch(() => {})

  useEffect(() => {
    api
      .get('/stats')
      .then(setStats)
      .catch(() => {})
    refreshUiSettings()
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    window.addEventListener('grimoire:settings-changed', refreshUiSettings)
    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('grimoire:settings-changed', refreshUiSettings)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <UISettingsProvider value={uiSettings}>
      <div style={{ display: 'flex', height: '100vh' }}>
        {!isMobile && (
          <Sidebar stats={stats} user={user} onLogout={logout} uiSettings={uiSettings} />
        )}

        <main
          ref={mainRef}
          style={{
            flex: 1,
            minWidth: 0,
            height: '100%',
            overflow: isReader ? 'hidden' : 'auto',
            paddingBottom: isMobile ? 64 : 0,
          }}
        >
          <Routes>
            <Route path="/" element={<Navigate to="/library" replace />} />
            <Route path="/library" element={<LibraryView />} />
            <Route path="/library/system/:systemId" element={<SystemDetailView />} />
            <Route path="/library/book/:bookId" element={<BookReader />} />
            <Route path="/maps" element={<MapsView />} />
            <Route path="/maps/:mapId" element={<MapDetailView />} />
            <Route path="/tokens" element={<TokensView />} />
            <Route path="/tokens/:tokenId" element={<TokenDetailView />} />
            <Route path="/search" element={<SearchView />} />
            <Route path="/favorites" element={<FavoritesView />} />
            <Route path="/campaigns" element={<CampaignsView />} />
            <Route path="/campaigns/:campaignId" element={<Navigate to="overview" replace />} />
            <Route
              path="/campaigns/:campaignId/sessions/:sessionId"
              element={<CampaignDetailView />}
            />
            <Route path="/campaigns/:campaignId/:tab" element={<CampaignDetailView />} />
            <Route path="/settings" element={<Navigate to="/settings/account" replace />} />
            <Route path="/settings/:tab" element={<SettingsView user={user} onLogout={logout} />} />
          </Routes>
        </main>

        {isMobile && <MobileSidebar user={user} onLogout={logout} uiSettings={uiSettings} />}
      </div>
    </UISettingsProvider>
  )
}

export default function App() {
  const { status, login } = useAuth()

  if (status === 'loading') return <LoadingScreen />
  if (status === 'uninitialized') return <SetupView onSetup={login} />
  if (status === 'unauthenticated') return <LoginView onLogin={login} />
  return (
    <FavoritesProvider>
      <AppShell />
    </FavoritesProvider>
  )
}
