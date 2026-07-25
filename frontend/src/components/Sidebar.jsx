import { useState, useEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LuLibrary,
  LuMap,
  LuMusic,
  LuSearch,
  LuSettings,
  LuLogOut,
  LuUser,
  LuHeart,
  LuScroll,
  LuX,
  LuPanelLeftClose,
  LuPanelLeftOpen,
  LuShield,
  LuSwords,
} from 'react-icons/lu'
import AboutModal from './AboutModal'
import { useCodexMode } from '../context/CodexModeContext'

const GITHUB_REPO = 'hunter-read/grimoire'
const UPDATE_DISMISSED_KEY = 'grimoire_update_dismissed'

function useLatestRelease() {
  const [latest, setLatest] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(5000),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.tag_name) {
          setLatest(data.tag_name.replace(/^v/, ''))
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

function isNewer(latestVersion, currentVersion) {
  if (!latestVersion || !currentVersion || currentVersion === 'dev') return false
  const parse = (v) => v.split('.').map(Number)
  const [lMaj, lMin, lPat] = parse(latestVersion)
  const [cMaj, cMin, cPat] = parse(currentVersion)
  if (lMaj !== cMaj) return lMaj > cMaj
  if (lMin !== cMin) return lMin > cMin
  return lPat > cPat
}

export default function Sidebar({
  stats,
  about,
  user,
  onLogout,
  uiSettings = {},
  collapsed = false,
  onToggleCollapse,
}) {
  const { t } = useTranslation()
  const { codex, toggleCodex } = useCodexMode()
  // Guests only see their campaign(s) — no library, maps, tokens, search,
  // favorites, or settings.
  const isGuest = user?.role === 'guest'
  const hide_maps = uiSettings.hide_maps
  const hide_tokens = uiSettings.hide_tokens
  const hide_audio = uiSettings.hide_audio
  const hide_campaigns = uiSettings.hide_campaigns
  const {
    show_stat_systems = true,
    show_stat_books = false,
    show_stat_pages = true,
    show_stat_maps = false,
    show_stat_tokens = false,
    show_stat_audio = false,
    show_stat_size = true,
  } = uiSettings

  const [showAbout, setShowAbout] = useState(false)
  const latestVersion = useLatestRelease()
  const hasUpdate = isNewer(latestVersion, about?.version)

  const [updateDismissed, setUpdateDismissed] = useState(() => {
    const stored = localStorage.getItem(UPDATE_DISMISSED_KEY)
    return stored === latestVersion
  })

  // Re-check dismissal if latestVersion changes (e.g. on first load)
  useEffect(() => {
    const stored = localStorage.getItem(UPDATE_DISMISSED_KEY)
    setUpdateDismissed(stored === latestVersion)
  }, [latestVersion])

  const dismissUpdate = (e) => {
    e.stopPropagation()
    localStorage.setItem(UPDATE_DISMISSED_KEY, latestVersion)
    setUpdateDismissed(true)
  }

  const showUpdateBanner = hasUpdate && !updateDismissed

  const anyStats =
    show_stat_systems ||
    show_stat_books ||
    show_stat_pages ||
    show_stat_maps ||
    show_stat_tokens ||
    show_stat_audio ||
    show_stat_size

  const navItem = (to, icon, label, { end = true } = {}) => (
    <NavLink
      to={to}
      end={end}
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
        height: '100vh',
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
          src={codex ? '/codex-logo.svg' : '/grimoire-logo.svg'}
          alt=""
          aria-hidden="true"
          width={collapsed ? 40 : 72}
          height={collapsed ? 40 : 72}
          style={{ borderRadius: 12, flexShrink: 0 }}
        />
        {!collapsed && (
          <div>
            <h1 style={{ fontSize: 20, letterSpacing: '0.08em', margin: 0, lineHeight: 1.1 }}>
              {codex ? t('codex.appName') : t('app.name')}
            </h1>
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
              {codex ? t('codex.appSubtitle') : t('app.subtitle')}
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav
        aria-label="Main navigation"
        style={{ padding: collapsed ? '12px 8px' : '12px 8px', flex: 1 }}
      >
        {!isGuest && navItem('/library', <LuLibrary size={16} />, t('nav.library'), { end: false })}
        {!isGuest && !hide_maps && navItem('/maps', <LuMap size={16} />, t('nav.maps'))}
        {!isGuest && !hide_tokens && navItem('/tokens', <LuUser size={16} />, t('nav.tokens'))}
        {!isGuest && !hide_audio && navItem('/audio', <LuMusic size={16} />, t('nav.audio'))}
        {!isGuest && navItem('/search', <LuSearch size={16} />, t('nav.search'))}

        {/* Codex mode surfaces wargaming-focused sections. */}
        {!isGuest && codex && (
          <>
            <div style={{ margin: '12px 8px 8px', borderTop: '1px solid var(--border)' }} />
            {navItem('/codex/rosters', <LuShield size={16} />, t('codex.nav.rosters'))}
            {navItem('/codex/battles', <LuSwords size={16} />, t('codex.nav.battles'))}
          </>
        )}

        {!isGuest && (
          <div style={{ margin: '12px 8px 8px', borderTop: '1px solid var(--border)' }} />
        )}

        {!isGuest && navItem('/favorites', <LuHeart size={16} />, t('nav.favorites'))}
        {!hide_campaigns && navItem('/campaigns', <LuScroll size={16} />, t('nav.campaigns'))}
      </nav>

      {/* Codex mode toggle — an experiment switch that reskins the app toward a
          wargaming focus. Front-end only; persists in localStorage. */}
      {!isGuest && (
        <button
          onClick={toggleCodex}
          title={codex ? t('codex.toggle.disable') : t('codex.toggle.enable')}
          aria-label={codex ? t('codex.toggle.disable') : t('codex.toggle.enable')}
          aria-pressed={codex}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: collapsed ? 0 : 10,
            margin: collapsed ? '0 8px 4px' : '0 8px 4px',
            padding: collapsed ? '9px 0' : '9px 14px',
            borderRadius: 8,
            background: codex ? 'var(--bg-card)' : 'transparent',
            border: codex ? '1px solid var(--gold)' : '1px solid var(--border)',
            color: codex ? 'var(--gold)' : 'var(--text-muted)',
            fontSize: 13,
            fontWeight: 500,
            width: 'calc(100% - 16px)',
          }}
        >
          <LuSwords size={16} />
          {!collapsed && (codex ? t('codex.toggle.on') : t('codex.toggle.off'))}
        </button>
      )}

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

      {/* Stats footer */}
      {!collapsed && stats && anyStats && (
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--border)',
            fontSize: 14,
            color: 'var(--text-muted)',
          }}
        >
          {show_stat_systems && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>{t('stats.systems')}</span>
              <span style={{ color: 'var(--text-dim)' }}>{stats.game_systems}</span>
            </div>
          )}
          {show_stat_books && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>{t('stats.books')}</span>
              <span style={{ color: 'var(--text-dim)' }}>{stats.books}</span>
            </div>
          )}
          {show_stat_pages && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>{t('stats.pages')}</span>
              <span style={{ color: 'var(--text-dim)' }}>
                {stats.total_pages?.toLocaleString()}
              </span>
            </div>
          )}
          {show_stat_maps && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>{t('stats.maps')}</span>
              <span style={{ color: 'var(--text-dim)' }}>{stats.maps}</span>
            </div>
          )}
          {show_stat_tokens && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>{t('stats.tokens')}</span>
              <span style={{ color: 'var(--text-dim)' }}>{stats.tokens}</span>
            </div>
          )}
          {show_stat_audio && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>{t('stats.audio')}</span>
              <span style={{ color: 'var(--text-dim)' }}>{stats.audio}</span>
            </div>
          )}
          {show_stat_size && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{t('stats.size')}</span>
              <span style={{ color: 'var(--text-dim)' }}>
                {stats.total_size_mb >= 1024
                  ? t('common.sizeGB', { size: (stats.total_size_mb / 1024).toFixed(2) })
                  : t('common.sizeMB', { size: stats.total_size_mb })}
              </span>
            </div>
          )}
        </div>
      )}

      {!collapsed && about && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => setShowAbout(true)}
            title={t('about.openAbout')}
            aria-label={t('about.openAbout')}
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
            <span style={{ color: 'var(--text-dim)', fontFamily: 'monospace' }}>
              v{about.version}
            </span>
          </button>

          {showUpdateBanner && (
            <div
              style={{
                padding: '8px 12px 8px 16px',
                background: 'rgba(201,168,76,0.08)',
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
                title={t('common.close')}
                aria-label={t('common.close')}
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

const navLinkStyle = (active, collapsed = false) => ({
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
