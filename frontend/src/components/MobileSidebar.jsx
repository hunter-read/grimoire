import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LuLibrary,
  LuMap,
  LuSearch,
  LuSettings,
  LuLogOut,
  LuUser,
  LuHeart,
  LuEllipsis,
  LuX,
  LuScroll,
} from 'react-icons/lu'

export default function MobileSidebar({ onLogout, uiSettings = {} }) {
  const { t } = useTranslation()
  const [moreOpen, setMoreOpen] = useState(false)
  const location = useLocation()
  const { hide_maps, hide_tokens, hide_campaigns } = uiSettings
  const moreRoutes = [
    '/settings',
    ...(!hide_maps ? ['/maps'] : []),
    ...(!hide_tokens ? ['/tokens'] : []),
  ]
  const moreActive = moreRoutes.some((r) => location.pathname.startsWith(r))

  return (
    <>
      {/* More drawer */}
      {moreOpen && (
        <>
          <div
            onClick={() => setMoreOpen(false)}
            aria-hidden="true"
            style={{ position: 'fixed', inset: 0, zIndex: 110 }}
          />
          <div
            style={{
              position: 'fixed',
              bottom: 64,
              left: 0,
              right: 0,
              zIndex: 120,
              background: 'var(--bg-panel)',
              borderTop: '1px solid var(--border)',
              padding: '8px 0',
            }}
          >
            {!hide_maps && (
              <MoreItem
                to="/maps"
                Icon={LuMap}
                label={t('nav.maps')}
                onClick={() => setMoreOpen(false)}
              />
            )}
            {!hide_tokens && (
              <MoreItem
                to="/tokens"
                Icon={LuUser}
                label={t('nav.tokens')}
                onClick={() => setMoreOpen(false)}
              />
            )}
            <MoreItem
              to="/settings"
              Icon={LuSettings}
              label={t('nav.settings')}
              onClick={() => setMoreOpen(false)}
            />
            <button
              onClick={() => {
                setMoreOpen(false)
                onLogout()
              }}
              style={{
                ...moreItemStyle,
                width: '100%',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-dim)',
              }}
            >
              <LuLogOut size={18} />
              <span>{t('nav.logOut')}</span>
            </button>
          </div>
        </>
      )}

      {/* Bottom bar */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          background: 'var(--bg-panel)',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-around',
          padding: '8px 0',
        }}
      >
        <NavLink to="/library" end={false} style={({ isActive }) => mobileNavStyle(isActive)}>
          <LuLibrary size={20} />
          {t('nav.library')}
        </NavLink>
        <NavLink to="/search" end style={({ isActive }) => mobileNavStyle(isActive)}>
          <LuSearch size={20} />
          {t('nav.search')}
        </NavLink>
        <NavLink to="/favorites" end style={({ isActive }) => mobileNavStyle(isActive)}>
          <LuHeart size={20} />
          {t('nav.favorites')}
        </NavLink>
        {!hide_campaigns && (
          <NavLink to="/campaigns" end style={({ isActive }) => mobileNavStyle(isActive)}>
            <LuScroll size={20} />
            {t('nav.campaigns')}
          </NavLink>
        )}
        <button
          onClick={() => setMoreOpen((o) => !o)}
          style={mobileNavStyle(moreActive || moreOpen)}
        >
          {moreOpen ? <LuX size={20} /> : <LuEllipsis size={20} />}
          {t('nav.more')}
        </button>
      </div>
    </>
  )
}

function MoreItem({ to, Icon, label, onClick }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      style={({ isActive }) => ({
        ...moreItemStyle,
        color: isActive ? 'var(--gold)' : 'var(--text-dim)',
        textDecoration: 'none',
      })}
    >
      <Icon size={18} />
      <span>{label}</span>
    </NavLink>
  )
}

const mobileNavStyle = (active) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  background: 'none',
  border: 'none',
  textDecoration: 'none',
  color: active ? 'var(--gold)' : 'var(--text-muted)',
  fontSize: 13,
  padding: '4px 12px',
  cursor: 'pointer',
})

const moreItemStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '12px 24px',
  fontSize: 16,
  background: 'none',
}
