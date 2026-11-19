import { useState, useEffect, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LuLibrary,
  LuMap,
  LuMusic,
  LuBox,
  LuSearch,
  LuSettings,
  LuLogOut,
  LuUser,
  LuHeart,
  LuTags,
  LuScroll,
  LuUsers,
  LuX,
  LuPanelLeftClose,
  LuPanelLeftOpen,
  LuSwords,
  LuShield,
  LuTrophy,
} from 'react-icons/lu'
import api, { type Schema } from '../api'
import AboutModal from './AboutModal'
import SidebarStats from './SidebarStats'
import { resolveLayout } from '../lib/sidebarStats'
import { preloadRoute } from './routeViews'
import NavGroupHeader from './NavGroupHeader'
import { showArmoryNav } from '../utils/armory'
import { guestScopeOf } from '../lib/guestScope'

const UPDATE_DISMISSED_KEY = 'grimoire_update_dismissed'

function useLatestRelease(): string | null {
  const [latest, setLatest] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Proxied through our backend (same-origin) so privacy browsers and
    // request blockers don't kill the update check. Returns null when version
    // checking is disabled or GitHub is unreachable.
    api
      .get('/latest-release')
      .then((data) => {
        if (!cancelled && data?.latest_version) {
          setLatest(data.latest_version)
        }
      })
      .catch(() => {
        /* silently ignore network errors */
      })
    return () => {
      cancelled = true
    }
  }, [])

  return latest
}

function isNewer(latestVersion: string | null, currentVersion?: string | null): boolean {
  if (!latestVersion || !currentVersion || currentVersion === 'dev') return false
  const parse = (v: string) => v.split('.').map(Number)
  const [lMaj, lMin, lPat] = parse(latestVersion)
  const [cMaj, cMin, cPat] = parse(currentVersion)
  if (lMaj !== cMaj) return lMaj > cMaj
  if (lMin !== cMin) return lMin > cMin
  return lPat > cPat
}

interface SidebarProps {
  stats?: Schema<'StatsResponse'> | null
  about?: Schema<'AboutResponse'> | null
  user?:
    | (Pick<Schema<'UserOut'>, 'username' | 'display_name' | 'role'> & {
        /** A guest's side of the app (see guestScopeOf). */
        guest_scope?: string | null
        /** Their own sidebar stats layout; null follows the admin's default. */
        sidebar_stats?: string[] | null
      })
    | null
  onLogout?: () => void
  // Partial: the shell renders with defaults before /settings/ui answers.
  uiSettings?: Partial<Schema<'UISettingsResponse'>>
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export default function Sidebar({
  stats,
  about,
  user,
  onLogout,
  uiSettings = {},
  collapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  const { t } = useTranslation()
  // Guests only see their campaign(s) or league(s) — no library, maps, tokens,
  // search, favorites, or settings.
  const isGuest = user?.role === 'guest'
  const scope = guestScopeOf(user)
  const showArmory = showArmoryNav({
    hidden: uiSettings.hide_armory,
    armoryBooks: stats?.armory_books,
    isAdmin: user?.role === 'admin',
  })
  const hide_library = uiSettings.hide_library
  const hide_maps = uiSettings.hide_maps
  const hide_tokens = uiSettings.hide_tokens
  const hide_audio = uiSettings.hide_audio
  const hide_models = uiSettings.hide_models
  const hide_campaigns = uiSettings.hide_campaigns
  const hide_armies = uiSettings.hide_armies
  const hide_leagues = uiSettings.hide_leagues
  // The table-top groups: role-playing (campaigns and the characters played in
  // them) and wargaming (leagues and the armies played in them). A guest is
  // invited to one side and sees only that group.
  const showRoleplaying = !hide_campaigns && scope !== 'wargame'
  const showWargaming = scope !== 'ttrpg' && (!hide_armies || !hide_leagues)
  const statsLayout = resolveLayout(user?.sidebar_stats, uiSettings)

  const [showAbout, setShowAbout] = useState(false)
  const latestVersion = useLatestRelease()
  const hasUpdate = isNewer(latestVersion, about?.version)

  // The release the user last dismissed the banner for. Derived against the
  // latest version on every render, not synced into state by an effect: an
  // effect runs after the paint, so the render where the release check lands
  // would flash the banner for a version already dismissed.
  const [dismissedVersion, setDismissedVersion] = useState(() =>
    localStorage.getItem(UPDATE_DISMISSED_KEY)
  )
  const updateDismissed = latestVersion !== null && dismissedVersion === latestVersion

  const dismissUpdate = (e: MouseEvent) => {
    e.stopPropagation()
    if (!latestVersion) return
    localStorage.setItem(UPDATE_DISMISSED_KEY, latestVersion)
    setDismissedVersion(latestVersion)
  }

  const showUpdateBanner = hasUpdate && !updateDismissed

  const navItem = (
    to: string,
    icon: ReactNode,
    label: string,
    { end = true }: { end?: boolean } = {}
  ) => (
    <NavLink
      to={to}
      end={end}
      onMouseEnter={() => preloadRoute(to)}
      onFocus={() => preloadRoute(to)}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      style={({ isActive }) => navLinkStyle(isActive, collapsed)}
    >
      {icon}
      {!collapsed && label}
    </NavLink>
  )

  return (
    <div
      style={{
        width: collapsed ? 64 : 220,
        minWidth: collapsed ? 64 : 220,
        background: 'var(--bg-panel)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        position: 'sticky',
        top: 0,
        transition: 'width 0.15s ease, min-width 0.15s ease',
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: collapsed ? '12px 0' : '12px 4px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: 12,
        }}
      >
        <img
          src="/grimoire-logo.svg"
          alt=""
          aria-hidden="true"
          width={collapsed ? 40 : 72}
          height={collapsed ? 40 : 72}
          style={{ borderRadius: 12, flexShrink: 0 }}
        />
        {!collapsed && (
          <div>
            {/* Not a heading: the page beside it carries the h1, and an app name
                repeated as the top heading of every page buries the real one. */}
            <p
              style={{
                fontFamily: 'Cinzel, serif',
                fontWeight: 600,
                color: 'var(--gold)',
                fontSize: 20,
                letterSpacing: '0.08em',
                margin: 0,
                lineHeight: 1.1,
              }}
            >
              {t('app.name')}
            </p>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                marginTop: 3,
                fontWeight: 300,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
              }}
            >
              {t('app.subtitle')}
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav aria-label={t('a11y.mainNavigation')} style={{ padding: '12px 8px', flex: 1 }}>
        {/* Group 1: library content (Library, Armory, Maps, Tokens, Audio) */}
        {!isGuest &&
          !hide_library &&
          navItem('/library', <LuLibrary size={16} />, t('nav.library'), { end: false })}
        {!isGuest &&
          showArmory &&
          navItem('/armory', <LuSwords size={16} />, t('nav.armory'), { end: false })}
        {!isGuest && !hide_maps && navItem('/maps', <LuMap size={16} />, t('nav.maps'))}
        {!isGuest && !hide_tokens && navItem('/tokens', <LuUser size={16} />, t('nav.tokens'))}
        {!isGuest && !hide_audio && navItem('/audio', <LuMusic size={16} />, t('nav.audio'))}
        {!isGuest && !hide_models && navItem('/models', <LuBox size={16} />, t('nav.models'))}

        {!isGuest && <div style={dividerStyle} />}

        {/* Group 2: discovery (Search, Tags, Favorites) */}
        {!isGuest && navItem('/search', <LuSearch size={16} />, t('nav.search'))}
        {!isGuest && navItem('/tags', <LuTags size={16} />, t('nav.tags'))}
        {!isGuest && navItem('/favorites', <LuHeart size={16} />, t('nav.favorites'))}

        {!isGuest && (showRoleplaying || showWargaming) && <div style={dividerStyle} />}

        {/* Group 3: campaigns and the characters played in them. Not gated on
            !isGuest: a campaign's guest exists to play in one campaign, so is
            exactly who wants a character sheet. */}
        {showRoleplaying && (
          <div role="group" aria-label={t('nav.roleplaying')}>
            {!collapsed && <NavGroupHeader label={t('nav.roleplaying')} />}
            {navItem('/campaigns', <LuScroll size={16} />, t('nav.campaigns'))}
            {navItem('/characters', <LuUsers size={16} />, t('nav.characters'))}
          </div>
        )}

        {/* Group 4: the wargame side of the table, leagues and the army lists
            played in them - in that order, as campaigns come before characters.
            A league's guest sees this group alone. */}
        {showRoleplaying && showWargaming && <div style={dividerStyle} />}
        {showWargaming && (
          <div role="group" aria-label={`${t('nav.wargaming')} (${t('nav.beta')})`}>
            {!collapsed && <NavGroupHeader label={t('nav.wargaming')} badge={t('nav.beta')} />}
            {!hide_leagues &&
              navItem('/leagues', <LuTrophy size={16} />, t('nav.leagues'), { end: false })}
            {!hide_armies &&
              navItem('/armies', <LuShield size={16} />, t('nav.armies'), { end: false })}
          </div>
        )}
      </nav>

      {/* Collapse toggle — bottom of the nav section, above the stats footer.
          No top border: it reads as part of the nav, not a separate section. */}
      <button
        onClick={onToggleCollapse}
        title={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
        aria-label={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
        aria-expanded={!collapsed}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-end',
          gap: 6,
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          padding: collapsed ? '8px 0' : '8px 16px',
          fontSize: 12,
        }}
      >
        {collapsed ? <LuPanelLeftOpen size={16} /> : <LuPanelLeftClose size={16} />}
      </button>

      {!collapsed && stats && <SidebarStats stats={stats} layout={statsLayout} />}

      {!collapsed && about && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => setShowAbout(true)}
            // No aria-label: the visible "Version v1.2.3" is the name a voice
            // control user will say, and the title still describes the action.
            title={t('about.openAbout')}
            style={{
              width: '100%',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '10px 20px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              color: 'var(--text-muted)',
              fontSize: 12,
            }}
          >
            <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {t('stats.version')}
            </span>
            {/* A flex row ignores this space; the button's spoken name needs it. */}{' '}
            <span style={{ color: 'var(--text-dim)', fontFamily: 'monospace' }}>
              v{about.version}
            </span>
          </button>

          {showUpdateBanner && (
            <div
              style={{
                padding: '8px 12px 8px 16px',
                background: 'color-mix(in srgb, var(--gold) 8%, transparent)',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--gold)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    marginBottom: 1,
                  }}
                >
                  {t('about.updateAvailable')}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>v{latestVersion}</div>
              </div>
              <button
                onClick={dismissUpdate}
                title={t('a11y.dismissUpdate')}
                aria-label={t('a11y.dismissUpdate')}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  padding: 2,
                  flexShrink: 0,
                }}
              >
                <LuX size={13} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* User + logout */}
      {user && (
        <div
          style={{
            padding: collapsed ? '12px 0' : '12px 20px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            flexDirection: collapsed ? 'column' : 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: collapsed ? 8 : 10,
          }}
        >
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {user.display_name || user.username}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {user.role}
              </div>
            </div>
          )}
          {!isGuest && (
            <NavLink
              to="/settings"
              onMouseEnter={() => preloadRoute('/settings')}
              onFocus={() => preloadRoute('/settings')}
              title={t('nav.settings')}
              aria-label={t('nav.settings')}
              style={({ isActive }) => ({
                background: 'none',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: isActive ? 'var(--gold)' : 'var(--text-muted)',
                padding: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                textDecoration: 'none',
              })}
            >
              <LuSettings size={14} />
            </NavLink>
          )}
          <button
            onClick={onLogout}
            title={t('nav.logOut')}
            aria-label={t('nav.logOut')}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-muted)',
              padding: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <LuLogOut size={14} />
          </button>
        </div>
      )}

      {showAbout && (
        <AboutModal
          about={about}
          latestVersion={latestVersion}
          hasUpdate={hasUpdate}
          onClose={() => setShowAbout(false)}
        />
      )}
    </div>
  )
}

const dividerStyle: CSSProperties = { margin: '12px 8px 8px', borderTop: '1px solid var(--border)' }

// A stat's figure; a <dd> carries a default indent, cleared here.

const navLinkStyle = (active: boolean, collapsed = false): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: collapsed ? 'center' : 'flex-start',
  gap: collapsed ? 0 : 12,
  width: '100%',
  padding: collapsed ? '10px 0' : '10px 14px',
  borderRadius: 8,
  marginBottom: 2,
  background: active ? 'var(--bg-card)' : 'transparent',
  border: active ? '1px solid var(--border)' : '1px solid transparent',
  color: active ? 'var(--gold)' : 'var(--text-dim)',
  fontSize: 16,
  fontWeight: active ? 500 : 400,
  textDecoration: 'none',
})
