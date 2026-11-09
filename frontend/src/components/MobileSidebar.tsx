import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
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
  LuEllipsis,
  LuX,
  LuScroll,
  LuUsers,
  LuSwords,
  LuShield,
  LuTrophy,
} from 'react-icons/lu'
import MoreItem, { moreItemStyle } from './MoreItem'
import NavGroupHeader from './NavGroupHeader'
import type { Schema } from '../api'
import { showArmoryNav } from '../utils/armory'

export interface MobileSidebarProps {
  /** The signed-in user; only the role is read. */
  user: { role?: string | null } | null
  onLogout?: () => void
  uiSettings?: Partial<Schema<'UISettingsResponse'>>
  /** Library counts; whether the armory holds anything decides its entry. */
  stats?: Schema<'StatsResponse'> | null
}

export default function MobileSidebar({
  user,
  onLogout,
  uiSettings = {},
  stats = null,
}: MobileSidebarProps) {
  const { t } = useTranslation()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const location = useLocation()

  // Escape closes the drawer and hands focus back to the button that opened it.
  useEffect(() => {
    if (!moreOpen) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setMoreOpen(false)
      moreButtonRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [moreOpen])
  const isGuest = user?.role === 'guest'
  const {
    hide_library,
    hide_maps,
    hide_tokens,
    hide_audio,
    hide_models,
    hide_campaigns,
    hide_armies,
    hide_leagues,
  } = uiSettings
  const showArmory = showArmoryNav({
    hidden: uiSettings.hide_armory,
    armoryBooks: stats?.armory_books,
    isAdmin: user?.role === 'admin',
  })
  // The bar's first slot is the Library; with it hidden the Armory moves up
  // out of the drawer to take it.
  const armoryOnBar = hide_library && showArmory
  const armoryInDrawer = showArmory && !armoryOnBar
  const showWargaming = !hide_armies || !hide_leagues
  const moreRoutes = [
    '/settings',
    '/tags',
    ...(armoryInDrawer ? ['/armory'] : []),
    ...(!hide_maps ? ['/maps'] : []),
    ...(!hide_tokens ? ['/tokens'] : []),
    ...(!hide_audio ? ['/audio'] : []),
    ...(!hide_models ? ['/models'] : []),
    ...(!hide_armies ? ['/armies'] : []),
    ...(!hide_leagues ? ['/leagues'] : []),
  ]
  const moreActive = moreRoutes.some((r) => location.pathname.startsWith(r))

  if (isGuest) {
    // Guests only have their campaign(s); show a minimal bar.
    return (
      <nav
        aria-label={t('a11y.mainNavigation')}
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
        <NavLink to="/campaigns" end={false} style={({ isActive }) => mobileNavStyle(isActive)}>
          <LuScroll size={20} />
          {t('nav.campaigns')}
        </NavLink>
        <button onClick={onLogout} style={mobileNavStyle(false)}>
          <LuLogOut size={20} />
          {t('nav.logOut')}
        </button>
      </nav>
    )
  }

  return (
    <>
      {/* Bottom bar */}
      <nav
        aria-label={t('a11y.mainNavigation')}
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
        {!hide_library && (
          <NavLink to="/library" end={false} style={({ isActive }) => mobileNavStyle(isActive)}>
            <LuLibrary size={20} />
            {t('nav.library')}
          </NavLink>
        )}
        {armoryOnBar && (
          <NavLink to="/armory" end={false} style={({ isActive }) => mobileNavStyle(isActive)}>
            <LuSwords size={20} />
            {t('nav.armory')}
          </NavLink>
        )}
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
          ref={moreButtonRef}
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
          aria-controls={moreOpen ? 'mobile-more-menu' : undefined}
          style={mobileNavStyle(moreActive || moreOpen)}
        >
          {moreOpen ? <LuX size={20} /> : <LuEllipsis size={20} />}
          {t('nav.more')}
        </button>
      </nav>
      {/* More drawer. After the bar in the DOM (it is fixed, so this does not
          move it): swiping on from the More button reaches its items next. */}
      {moreOpen && (
        <>
          <div
            onClick={() => setMoreOpen(false)}
            aria-hidden="true"
            style={{ position: 'fixed', inset: 0, zIndex: 110 }}
          />
          <nav
            id="mobile-more-menu"
            aria-label={t('a11y.moreNavigation')}
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
            {armoryInDrawer && (
              <MoreItem
                to="/armory"
                Icon={LuSwords}
                label={t('nav.armory')}
                onClick={() => setMoreOpen(false)}
              />
            )}
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
            {!hide_audio && (
              <MoreItem
                to="/audio"
                Icon={LuMusic}
                label={t('nav.audio')}
                onClick={() => setMoreOpen(false)}
              />
            )}
            {!hide_models && (
              <MoreItem
                to="/models"
                Icon={LuBox}
                label={t('nav.models')}
                onClick={() => setMoreOpen(false)}
              />
            )}
            {/* Characters belongs with Campaigns, which is on the bar itself;
                the bar is full, so it lives here. Gated the same way. */}
            {!hide_campaigns && (
              <div role="group" aria-label={t('nav.roleplaying')} style={drawerGroupStyle}>
                <NavGroupHeader label={t('nav.roleplaying')} inset={24} />
                <MoreItem
                  to="/characters"
                  Icon={LuUsers}
                  label={t('nav.characters')}
                  onClick={() => setMoreOpen(false)}
                />
              </div>
            )}
            {showWargaming && (
              <div
                role="group"
                aria-label={`${t('nav.wargaming')} (${t('nav.beta')})`}
                style={drawerGroupStyle}
              >
                <NavGroupHeader label={t('nav.wargaming')} badge={t('nav.beta')} inset={24} />
                {!hide_armies && (
                  <MoreItem
                    to="/armies"
                    Icon={LuShield}
                    label={t('nav.armies')}
                    onClick={() => setMoreOpen(false)}
                  />
                )}
                {!hide_leagues && (
                  <MoreItem
                    to="/leagues"
                    Icon={LuTrophy}
                    label={t('nav.leagues')}
                    onClick={() => setMoreOpen(false)}
                  />
                )}
              </div>
            )}
            <MoreItem
              to="/tags"
              Icon={LuTags}
              label={t('nav.tags')}
              onClick={() => setMoreOpen(false)}
            />
            <MoreItem
              to="/settings"
              Icon={LuSettings}
              label={t('nav.settings')}
              onClick={() => setMoreOpen(false)}
            />
            <button
              onClick={() => {
                setMoreOpen(false)
                onLogout!()
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
          </nav>
        </>
      )}
    </>
  )
}

// A titled group in the drawer, set off from the rows above it by a rule.
const drawerGroupStyle: CSSProperties = {
  borderTop: '1px solid var(--border)',
  marginTop: 4,
  paddingTop: 10,
}

const mobileNavStyle = (active: boolean): CSSProperties => ({
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
