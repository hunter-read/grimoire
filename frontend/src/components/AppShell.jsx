import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import useScrollRestoration from '../hooks/useScrollRestoration'
import { useAuth } from '../context/AuthContext'
import { UISettingsProvider } from '../context/UISettingsContext'
import { useAudioPlayer } from '../context/AudioPlayerContext'
import GlobalAudioPlayer, { PLAYER_HEIGHT } from './audio/GlobalAudioPlayer'
import api, { settings as settingsApi } from '../api'
import Sidebar from './Sidebar'
import MobileSidebar from './MobileSidebar'
import BookReader from './BookReader'
import LibraryView from '../views/LibraryView'
import SystemDetailView from '../views/SystemDetailView'
import MapsView from '../views/MapsView'
import MapDetailView from './maps/MapDetailView'
import TokensView from '../views/TokensView'
import TokenDetailView from './tokens/TokenDetailView'
import AudioView from '../views/AudioView'
import AudioDetailView from './audio/AudioDetailView'
import SearchView from '../views/SearchView'
import SettingsView from '../views/SettingsView'
import FavoritesView from '../views/FavoritesView'
import TagsView from '../views/TagsView'
import FileManagerView from '../views/FileManagerView'
import CampaignsView from '../views/CampaignsView'
import CampaignDetailView from '../views/CampaignDetailView'
import CampaignNotesView from '../views/CampaignNotesView'
import PendingInvitesBanner from './campaigns/PendingInvitesBanner'

const SIDEBAR_COLLAPSED_KEY = 'grimoire_sidebar_collapsed'

/** Authenticated app layout: sidebar(s) + routed main content. */
export default function AppShell() {
  const { user, logout } = useAuth()
  const [stats, setStats] = useState(null)
  // Build info (version/commit/python) lives on a login-only endpoint, kept off
  // the API-key-gated /stats so it isn't exposed to external integrations.
  const [about, setAbout] = useState(null)
  const [uiSettings, setUiSettings] = useState({
    hide_maps: false,
    hide_tokens: false,
    hide_audio: false,
    hide_campaigns: false,
  })
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  )
  const toggleSidebar = () =>
    setSidebarCollapsed((c) => {
      const next = !c
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
      return next
    })
  const location = useLocation()
  const navigate = useNavigate()
  const isGuest = user?.role === 'guest'
  const isReader =
    location.pathname.startsWith('/library/book/') ||
    location.pathname.startsWith('/maps/') ||
    location.pathname.startsWith('/tokens/')
  // The file manager sizes itself to the viewport and gives each tree its own
  // scrollbar, so the page must not scroll underneath them (issue #302).
  const isFullHeight = isReader || location.pathname === '/settings/files'
  const mainRef = useScrollRestoration()
  const { queue } = useAudioPlayer()
  const playerActive = queue.length > 0

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
    api
      .get('/about')
      .then(setAbout)
      .catch(() => {})
    refreshUiSettings()
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    window.addEventListener('grimoire:settings-changed', refreshUiSettings)
    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('grimoire:settings-changed', refreshUiSettings)
    }
  }, [])

  // After a guest logs in via an invite code, drop them straight into the
  // campaign the code belongs to.
  useEffect(() => {
    const target = sessionStorage.getItem('grimoire:guest_campaign')
    if (target) {
      sessionStorage.removeItem('grimoire:guest_campaign')
      navigate(`/campaigns/${target}/overview`, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <UISettingsProvider value={uiSettings}>
      <div style={{ display: 'flex', height: '100vh' }}>
        {!isMobile && (
          <Sidebar
            stats={stats}
            about={about}
            user={user}
            onLogout={logout}
            uiSettings={uiSettings}
            collapsed={sidebarCollapsed}
            onToggleCollapse={toggleSidebar}
          />
        )}

        <main
          ref={mainRef}
          style={{
            flex: 1,
            minWidth: 0,
            height: '100%',
            overflow: isFullHeight ? 'hidden' : 'auto',
            paddingBottom: (isMobile ? 64 : 0) + (playerActive ? PLAYER_HEIGHT : 0),
            // Full-height routes size themselves to what's left after the
            // banner rather than to `main` itself, so a column layout here is
            // what lets them claim the remaining space exactly.
            ...(isFullHeight ? { display: 'flex', flexDirection: 'column', minHeight: 0 } : null),
          }}
        >
          {!isGuest && <PendingInvitesBanner />}
          {isGuest ? (
            // Guests are scoped to their campaign(s); everything else redirects.
            <Routes>
              <Route path="/campaigns" element={<CampaignsView />} />
              <Route path="/campaigns/:campaignId" element={<Navigate to="overview" replace />} />
              <Route path="/campaigns/:campaignId/notes" element={<CampaignNotesView />} />
              <Route path="/campaigns/:campaignId/:tab" element={<CampaignDetailView />} />
              <Route path="*" element={<Navigate to="/campaigns" replace />} />
            </Routes>
          ) : (
            <Routes>
              <Route path="/" element={<Navigate to="/library" replace />} />
              <Route path="/library" element={<LibraryView />} />
              <Route path="/library/system/:systemId" element={<SystemDetailView />} />
              <Route path="/library/book/:bookId" element={<BookReader />} />
              <Route path="/maps" element={<MapsView />} />
              <Route path="/maps/:mapId" element={<MapDetailView />} />
              <Route path="/tokens" element={<TokensView />} />
              <Route path="/tokens/:tokenId" element={<TokenDetailView />} />
              <Route path="/audio" element={<AudioView />} />
              <Route path="/audio/:audioId" element={<AudioDetailView />} />
              <Route path="/search" element={<SearchView />} />
              <Route path="/favorites" element={<FavoritesView />} />
              <Route path="/tags" element={<TagsView />} />
              <Route path="/campaigns" element={<CampaignsView />} />
              <Route path="/campaigns/:campaignId" element={<Navigate to="overview" replace />} />
              <Route path="/campaigns/:campaignId/notes" element={<CampaignNotesView />} />
              <Route path="/campaigns/:campaignId/:tab" element={<CampaignDetailView />} />
              {/* Full-page, outside the settings tabs: bulk reorganisation needs
                  the whole width for two panes (issue #302). */}
              <Route path="/settings/files" element={<FileManagerView />} />
              <Route path="/settings" element={<Navigate to="/settings/account" replace />} />
              <Route
                path="/settings/:tab"
                element={<SettingsView user={user} onLogout={logout} />}
              />
            </Routes>
          )}
        </main>

        {isMobile && <MobileSidebar user={user} onLogout={logout} uiSettings={uiSettings} />}

        <GlobalAudioPlayer isMobile={isMobile} sidebarWidth={sidebarCollapsed ? 64 : 220} />
      </div>
    </UISettingsProvider>
  )
}
