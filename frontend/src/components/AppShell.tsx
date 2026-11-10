import { useState, useEffect, Suspense } from 'react'
import type { ComponentProps } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import useScrollRestoration from '../hooks/useScrollRestoration'
import { useAuth } from '../context/AuthContext'
import { UISettingsProvider } from '../context/UISettingsContext'
import { useAudioPlayer } from '../context/AudioPlayerContext'
import { useSoundboard } from '../context/SoundboardContext'
import GlobalAudioPlayer, { PLAYER_HEIGHT } from './audio/GlobalAudioPlayer'
import SoundboardPanel from './audio/SoundboardPanel'
import SoundboardLauncher from './audio/SoundboardLauncher'
import api, { settings as settingsApi } from '../api'
import type { Schema } from '../api'
import Sidebar from './Sidebar'
import MobileSidebar from './MobileSidebar'
import { homePath } from '../utils/armory'
import {
  BookReader,
  LibraryView,
  SystemDetailView,
  MapsView,
  MapDetailView,
  VttEditorView,
  TokensView,
  TokenDetailView,
  TokenEditorView,
  AudioView,
  ModelsView,
  ModelDetailView,
  AudioDetailView,
  SearchView,
  SettingsView,
  FavoritesView,
  TagsView,
  FileManagerView,
  DuplicatesView,
  DuplicateCompareView,
  CampaignsView,
  CharactersView,
  CharacterDetailView,
  CampaignDetailView,
  CampaignNotesView,
  GmScreenView,
  ArmiesView,
  ArmyDetailView,
  LeaguesView,
  LeagueDetailView,
} from './routeViews'
import RouteFallback from './RouteFallback'
import RouteAnnouncer from './RouteAnnouncer'
import ErrorBoundary from './ErrorBoundary'
import PendingInvitesBanner from './campaigns/PendingInvitesBanner'
import { guestScopeOf } from '../lib/guestScope'

const SIDEBAR_COLLAPSED_KEY = 'grimoire_sidebar_collapsed'

/** Authenticated app layout: sidebar(s) + routed main content. */
export default function AppShell() {
  const { t } = useTranslation()
  const auth = useAuth()
  const user = auth?.user ?? null
  const logout = auth?.logout
  const [stats, setStats] = useState<Schema<'StatsResponse'> | null>(null)
  // Build info (version/commit/python) lives on a login-only endpoint, kept off
  // the API-key-gated /stats so it isn't exposed to external integrations.
  const [about, setAbout] = useState<Schema<'AboutResponse'> | null>(null)
  const [uiSettings, setUiSettings] = useState<Partial<Schema<'UISettingsResponse'>>>({
    hide_library: false,
    hide_armory: false,
    hide_maps: false,
    hide_tokens: false,
    hide_audio: false,
    hide_models: false,
    hide_campaigns: false,
    hide_armies: false,
    hide_leagues: false,
    // Assumed read-only until the server says otherwise, so the destructive
    // file actions cannot flash into a menu during the first render and be
    // clicked before the real answer arrives.
    library_writable: false,
    // Likewise off until the server confirms API keys exist on this instance,
    // so a server with API_KEYS_ENABLED=false never sees the key views flash
    // in and fire requests it will refuse.
    api_keys_enabled: false,
    // And share links, for the same reason: no Share button until confirmed.
    share_links_enabled: false,
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
  const guestScope = guestScopeOf(user)
  const isReader =
    location.pathname.startsWith('/library/book/') ||
    location.pathname.startsWith('/maps/') ||
    location.pathname.startsWith('/tokens/')
  // The file manager sizes itself to the viewport and gives each tree its own
  // scrollbar, so the page must not scroll underneath them (issue #302). The
  // tags page does the same with its list/detail columns — without this the
  // panels have no bounded height and grow together on one page scrollbar
  // instead of scrolling independently.
  const isFullHeight =
    isReader ||
    location.pathname === '/settings/files' ||
    location.pathname === '/tags' ||
    // The VTT editor sizes its own canvas to the space left over, so it must
    // claim the full height rather than scroll inside `main`.
    location.pathname.endsWith('/vtt-editor')
  const mainRef = useScrollRestoration()
  const { queue } = useAudioPlayer()
  const playerActive = queue.length > 0
  const { open: soundboardOpen } = useSoundboard()
  // Keep the floating soundboard clear of the mobile nav bar and the player bar.
  const overlayOffset = (isMobile ? 64 : 0) + (playerActive ? PLAYER_HEIGHT : 0)

  // Whether /settings/ui has answered (or failed). `/` waits for it: with the
  // Library hidden it lands somewhere else, and redirecting on the defaults
  // would open the hidden Library first.
  const [uiSettingsLoaded, setUiSettingsLoaded] = useState(false)
  const refreshUiSettings = () =>
    settingsApi
      .getUi()
      .then(setUiSettings)
      .catch(() => {})
      .finally(() => setUiSettingsLoaded(true))

  useEffect(() => {
    api
      .get('/stats')
      .then(setStats)
      .catch(() => {})
    api
      .get('/about')
      .then(setAbout)
      .catch(() => {})
    void refreshUiSettings()
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    window.addEventListener('grimoire:settings-changed', refreshUiSettings)
    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('grimoire:settings-changed', refreshUiSettings)
    }
  }, [])

  // After a guest logs in via an invite code, drop them straight into the
  // campaign or league the code belongs to.
  useEffect(() => {
    const target = sessionStorage.getItem('grimoire:guest_campaign')
    const league = sessionStorage.getItem('grimoire:guest_league')
    if (target) {
      sessionStorage.removeItem('grimoire:guest_campaign')
      void navigate(`/campaigns/${target}/overview`, { replace: true })
    } else if (league !== null) {
      sessionStorage.removeItem('grimoire:guest_league')
      void navigate(league ? `/leagues/${league}` : '/armies', { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    // Until /settings/ui answers, consumers see these partial defaults; any key
    // still missing reads as undefined, which every consumer treats as off.
    <UISettingsProvider value={uiSettings as ComponentProps<typeof UISettingsProvider>['value']}>
      <div className="app-shell">
        {/* First in the tab order, so a keyboard or screen reader user can jump
            past the sidebar's links straight to the page. */}
        <a href="#main-content" className="skip-link">
          {t('a11y.skipToContent')}
        </a>
        <RouteAnnouncer mainRef={mainRef} />
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
          id="main-content"
          // Focusable by script only: the skip link and RouteAnnouncer land here.
          tabIndex={-1}
          className="focus-target"
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
          {/* A view that throws while rendering shows a recovery panel here
              rather than blanking the app; navigating anywhere clears it.
              Each view is fetched the first time its route renders (issue #708);
              the sidebar and banner stay put while it loads. */}
          <ErrorBoundary resetKey={location.key}>
            <Suspense fallback={<RouteFallback />}>
              {guestScope === 'wargame' ? (
                // A league's guest reaches leagues and their armies. The book
                // reader is here for the books a league shares with them, which
                // their armies' citations open; the backend authorises each read
                // against those shares, exactly as for a campaign's guest.
                <Routes>
                  <Route path="/leagues" element={<LeaguesView />} />
                  <Route path="/leagues/:leagueId" element={<LeagueDetailView />} />
                  <Route path="/armies" element={<ArmiesView />} />
                  <Route path="/armies/:armyId" element={<ArmyDetailView />} />
                  <Route path="/library/book/:bookId" element={<BookReader />} />
                  <Route path="*" element={<Navigate to="/leagues" replace />} />
                </Routes>
              ) : isGuest ? (
                // Guests are scoped to their campaign(s); everything else redirects.
                // The by-id detail routes are included because a campaign resource
                // row links straight to one (issue #361) — without them the link
                // fell through to the catch-all and bounced back to the campaign
                // list. Library *browsing* stays closed: there is no list route
                // here, and the backend authorises each by-id read against the
                // guest's campaign shares (`user_can_access_resource`).
                <Routes>
                  <Route path="/campaigns" element={<CampaignsView />} />
                  <Route
                    path="/campaigns/:campaignId"
                    element={<Navigate to="overview" replace />}
                  />
                  <Route path="/campaigns/:campaignId/notes" element={<CampaignNotesView />} />
                  <Route path="/campaigns/:campaignId/:tab" element={<CampaignDetailView />} />
                  <Route path="/characters" element={<CharactersView />} />
                  {/* Rulesets moved into the sheet manager. Kept as a redirect so
                  a bookmarked link still lands somewhere useful, and before
                  :characterId, which would otherwise swallow it. */}
                  <Route
                    path="/characters/rulesets"
                    element={<Navigate to="/characters?manage=rulesets" replace />}
                  />
                  <Route path="/characters/:characterId" element={<CharacterDetailView />} />
                  <Route path="/library/book/:bookId" element={<BookReader />} />
                  <Route path="/maps/:mapId" element={<MapDetailView />} />
                  <Route path="/tokens/:tokenId" element={<TokenDetailView />} />
                  <Route path="/audio/:audioId" element={<AudioDetailView />} />
                  <Route path="/models/:modelId" element={<ModelDetailView />} />
                  <Route path="*" element={<Navigate to="/campaigns" replace />} />
                </Routes>
              ) : (
                <Routes>
                  <Route
                    path="/"
                    element={
                      uiSettingsLoaded ? <Navigate to={homePath(uiSettings)} replace /> : null
                    }
                  />
                  <Route path="/library" element={<LibraryView gameType="ttrpg" />} />
                  <Route path="/library/system/:systemId" element={<SystemDetailView />} />
                  {/* The Armory: the same views over the wargame books in armory/. */}
                  <Route path="/armory" element={<LibraryView key="armory" gameType="wargame" />} />
                  <Route path="/armory/system/:systemId" element={<SystemDetailView />} />
                  <Route path="/library/book/:bookId" element={<BookReader />} />
                  <Route path="/maps" element={<MapsView />} />
                  <Route path="/maps/:mapId" element={<MapDetailView />} />
                  {/* Full-page: the Universal VTT editor needs the whole width for
                  a zoomable canvas plus its tool and property panels, and the
                  detail pane already competes with a sidebar and nav arrows. */}
                  {/* Standalone: upload a map image or a .uvtt and edit it without
                  anything being written to the library, as the token editor
                  does. Declared after :mapId for readability — React Router
                  already ranks the static segment higher. */}
                  <Route path="/maps/editor" element={<VttEditorView />} />
                  <Route path="/maps/:mapId/vtt-editor" element={<VttEditorView />} />
                  <Route path="/tokens" element={<TokensView />} />
                  {/* Full-page for the same reason as the VTT editor: the canvas,
                  the control column, and the frame gallery need to sit side by
                  side. Declared before the :tokenId route for readability —
                  React Router already ranks the static segment higher.
                  Registered only in this block, so guests (whose routes are the
                  branch above) cannot reach the editor at all. */}
                  <Route path="/tokens/editor" element={<TokenEditorView />} />
                  <Route path="/tokens/:tokenId/editor" element={<TokenEditorView />} />
                  <Route path="/tokens/:tokenId" element={<TokenDetailView />} />
                  <Route path="/audio" element={<AudioView />} />
                  <Route path="/audio/:audioId" element={<AudioDetailView />} />
                  <Route path="/models" element={<ModelsView />} />
                  <Route path="/models/:modelId" element={<ModelDetailView />} />
                  <Route path="/search" element={<SearchView />} />
                  <Route path="/favorites" element={<FavoritesView />} />
                  <Route path="/tags" element={<TagsView />} />
                  <Route path="/campaigns" element={<CampaignsView />} />
                  <Route
                    path="/campaigns/:campaignId"
                    element={<Navigate to="overview" replace />}
                  />
                  <Route path="/campaigns/:campaignId/notes" element={<CampaignNotesView />} />
                  <Route path="/campaigns/:campaignId/gm-screen" element={<GmScreenView />} />
                  <Route path="/campaigns/:campaignId/:tab" element={<CampaignDetailView />} />
                  <Route path="/characters" element={<CharactersView />} />
                  {/* Rulesets moved into the sheet manager. Kept as a redirect so
                  a bookmarked link still lands somewhere useful, and before
                  :characterId, which would otherwise swallow it. */}
                  <Route
                    path="/characters/rulesets"
                    element={<Navigate to="/characters?manage=rulesets" replace />}
                  />
                  <Route path="/characters/:characterId" element={<CharacterDetailView />} />
                  {/* Wargames: army lists and the leagues they are played in.
                  Not for guests, so only in this block. */}
                  <Route path="/armies" element={<ArmiesView />} />
                  <Route path="/armies/:armyId" element={<ArmyDetailView />} />
                  <Route path="/leagues" element={<LeaguesView />} />
                  <Route path="/leagues/:leagueId" element={<LeagueDetailView />} />
                  {/* Full-page, outside the settings tabs: bulk reorganisation needs
                  the whole width for two panes (issue #302). */}
                  <Route path="/settings/files" element={<FileManagerView />} />
                  {/* Full-page for the same reason: comparing copies wants the
                  width, and destructive actions stay off the settings tab. */}
                  <Route path="/settings/duplicates" element={<DuplicatesView />} />
                  <Route
                    path="/settings/duplicates/compare/:resourceType"
                    element={<DuplicateCompareView />}
                  />
                  {/* SettingsView picks the landing area: the admin overview, or
                  the account page for everyone else. */}
                  <Route
                    path="/settings"
                    element={<SettingsView user={user} onLogout={logout} />}
                  />
                  <Route
                    path="/settings/:tab"
                    element={<SettingsView user={user} onLogout={logout} />}
                  />
                </Routes>
              )}
            </Suspense>
          </ErrorBoundary>
        </main>

        {isMobile && (
          <MobileSidebar user={user} onLogout={logout} uiSettings={uiSettings} stats={stats} />
        )}

        <GlobalAudioPlayer isMobile={isMobile} sidebarWidth={sidebarCollapsed ? 64 : 220} />

        {soundboardOpen ? (
          <SoundboardPanel bottomOffset={overlayOffset} />
        ) : (
          <SoundboardLauncher bottomOffset={overlayOffset} />
        )}
      </div>
    </UISettingsProvider>
  )
}
