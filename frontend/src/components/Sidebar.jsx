import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LuLibrary, LuMap, LuSearch, LuSettings,
  LuLogOut, LuUser, LuHeart, LuScroll,
} from 'react-icons/lu'

export default function Sidebar({ stats, user, onLogout, uiSettings = {} }) {
  const { t } = useTranslation()
  const hide_maps      = uiSettings.hide_maps
  const hide_tokens    = uiSettings.hide_tokens
  const hide_campaigns = uiSettings.hide_campaigns
  const {
    show_stat_systems = true,
    show_stat_books   = false,
    show_stat_pages   = true,
    show_stat_maps    = false,
    show_stat_tokens  = false,
    show_stat_size    = true,
    show_stat_version = true,
  } = uiSettings
  return (
    <div style={{
      width: 220, minWidth: 220, background: 'var(--bg-panel)',
      borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
      height: '100vh', position: 'sticky', top: 0,
    }}>
      {/* Logo */}
      <div style={{ padding: '12px 4px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src="/android-chrome-192x192.png" alt="" aria-hidden="true" width={72} height={72} style={{ borderRadius: 12, flexShrink: 0 }} />
        <div>
          <h1 style={{ fontSize: 20, letterSpacing: '0.08em', margin: 0, lineHeight: 1.1 }}>{t('app.name')}</h1>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, fontWeight: 300, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            {t('app.subtitle')}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav aria-label="Main navigation" style={{ padding: '12px 8px', flex: 1 }}>
        <NavLink to="/library" end={false} style={({ isActive }) => navLinkStyle(isActive)}>
          <LuLibrary size={16} /> {t('nav.library')}
        </NavLink>
        {!hide_maps && (
          <NavLink to="/maps" end style={({ isActive }) => navLinkStyle(isActive)}>
            <LuMap size={16} /> {t('nav.maps')}
          </NavLink>
        )}
        {!hide_tokens && (
          <NavLink to="/tokens" end style={({ isActive }) => navLinkStyle(isActive)}>
            <LuUser size={16} /> {t('nav.tokens')}
          </NavLink>
        )}
        <NavLink to="/search" end style={({ isActive }) => navLinkStyle(isActive)}>
          <LuSearch size={16} /> {t('nav.search')}
        </NavLink>

        <div style={{ margin: '12px 8px 8px', borderTop: '1px solid var(--border)' }} />

        <NavLink to="/favorites" end style={({ isActive }) => navLinkStyle(isActive)}>
          <LuHeart size={16} /> {t('nav.favorites')}
        </NavLink>
        {!hide_campaigns && (
          <NavLink to="/campaigns" end style={({ isActive }) => navLinkStyle(isActive)}>
            <LuScroll size={16} /> {t('nav.campaigns')}
          </NavLink>
        )}
      </nav>

      {/* Stats footer */}
      {stats && (show_stat_systems || show_stat_books || show_stat_pages || show_stat_maps || show_stat_tokens || show_stat_size || show_stat_version) && (
        <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)', fontSize: 14, color: 'var(--text-muted)' }}>
          {show_stat_systems && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>{t('stats.systems')}</span><span style={{ color: 'var(--text-dim)' }}>{stats.game_systems}</span>
          </div>}
          {show_stat_books && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>{t('stats.books')}</span><span style={{ color: 'var(--text-dim)' }}>{stats.books}</span>
          </div>}
          {show_stat_pages && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>{t('stats.pages')}</span><span style={{ color: 'var(--text-dim)' }}>{stats.total_pages?.toLocaleString()}</span>
          </div>}
          {show_stat_maps && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>{t('stats.maps')}</span><span style={{ color: 'var(--text-dim)' }}>{stats.maps}</span>
          </div>}
          {show_stat_tokens && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>{t('stats.tokens')}</span><span style={{ color: 'var(--text-dim)' }}>{stats.tokens}</span>
          </div>}
          {show_stat_size && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>{t('stats.size')}</span><span style={{ color: 'var(--text-dim)' }}>{stats.total_size_mb >= 1024 ? t('common.sizeGB', { size: (stats.total_size_mb / 1024).toFixed(2) }) : t('common.sizeMB', { size: stats.total_size_mb })}</span>
          </div>}
          {show_stat_version && <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{t('stats.version')}</span><span style={{ color: 'var(--text-dim)' }}>v{stats.version}</span>
          </div>}
        </div>
      )}

      {/* User + logout */}
      {user && (
        <div style={{
          padding: '12px 20px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.display_name || user.username}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {user.role}
            </div>
          </div>
          <NavLink
            to="/settings"
            title={t('nav.settings')}
            aria-label={t('nav.settings')}
            style={({ isActive }) => ({
              background: 'none', border: '1px solid var(--border)', borderRadius: 6,
              color: isActive ? 'var(--gold)' : 'var(--text-muted)', padding: '6px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', textDecoration: 'none',
            })}
          >
            <LuSettings size={14} />
          </NavLink>
          <button
            onClick={onLogout}
            title={t('nav.logOut')}
            aria-label={t('nav.logOut')}
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 6,
              color: 'var(--text-muted)', padding: '6px', cursor: 'pointer',
              display: 'flex', alignItems: 'center',
            }}
          >
            <LuLogOut size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

const navLinkStyle = (active) => ({
  display: 'flex', alignItems: 'center', gap: 12, width: '100%',
  padding: '10px 14px', borderRadius: 8, marginBottom: 2,
  background: active ? 'var(--bg-card)' : 'transparent',
  border: active ? '1px solid var(--border)' : '1px solid transparent',
  color: active ? 'var(--gold)' : 'var(--text-dim)',
  fontSize: 16, fontWeight: active ? 500 : 400,
  textDecoration: 'none',
})
