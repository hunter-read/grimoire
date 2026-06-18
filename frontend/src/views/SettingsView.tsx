import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useUISettings } from '../context/UISettingsContext'
import useCodexStatus from '../components/codex/useCodexStatus'
import SettingsNav from '../components/settings/SettingsNav'
import SettingsSearch from '../components/settings/SettingsSearch'
import type { SettingsDestination } from '../components/settings/SettingsSearch'
import SettingsQuickActions from '../components/settings/SettingsQuickActions'
import ConfirmModal from '../components/settings/ConfirmModal'
import { findArea, findEntry, resolveArea } from '../components/settings/registry'
import type { AreaId, SettingsVisibility } from '../components/settings/registry'
import { SettingsTargetContext } from '../components/settings/settingsTarget'
import { SettingsDirtyContext } from '../components/settings/settingsDirty'
import type { DirtyRegistry } from '../components/settings/settingsDirty'
import type { SettingsUser } from '../components/settings/areas/types'
import AccountArea from '../components/settings/areas/AccountArea'
import PreferencesArea from '../components/settings/areas/PreferencesArea'
import ConnectionsArea from '../components/settings/areas/ConnectionsArea'
import OverviewArea from '../components/settings/areas/OverviewArea'
import PeopleArea from '../components/settings/areas/PeopleArea'
import AccessArea from '../components/settings/areas/AccessArea'
import SignInArea from '../components/settings/areas/SignInArea'
import LibraryArea from '../components/settings/areas/LibraryArea'
import CatalogueArea from '../components/settings/areas/CatalogueArea'
import AddonsArea from '../components/settings/areas/AddonsArea'
import SidebarArea from '../components/settings/areas/SidebarArea'
import BackupsArea from '../components/settings/areas/BackupsArea'
import LogsTab from '../components/settings/LogsTab'
import DemoModeBanner from '../components/settings/DemoModeBanner'
import '../components/settings/settings.css'

interface SettingsViewProps {
  user: SettingsUser | null
  onLogout?: () => void
}

const FLASH_MS = 2200
// Sections load their own data, so the target may not be in the page yet when
// the URL changes. Look for it for this long before giving up.
const FIND_TARGET_MS = 3000

function pathFor({ area, hash }: SettingsDestination): string {
  return `/settings/${area}${hash ? `#${hash}` : ''}`
}

/** Scroll a deep-linked section into view, focus it, and flash it once found. */
function revealWhenPresent(id: string): () => void {
  const started = performance.now()
  let frame = 0
  let flashTimer: ReturnType<typeof setTimeout> | undefined
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const look = () => {
    const el = document.getElementById(id)
    if (!el) {
      if (performance.now() - started < FIND_TARGET_MS) frame = requestAnimationFrame(look)
      return
    }
    el.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' })
    el.focus({ preventScroll: true })
    el.classList.remove('settings-flash')
    // Restart the animation when the same link is followed twice.
    void el.offsetWidth
    el.classList.add('settings-flash')
    flashTimer = setTimeout(() => el.classList.remove('settings-flash'), FLASH_MS)
  }
  frame = requestAnimationFrame(look)
  return () => {
    cancelAnimationFrame(frame)
    if (flashTimer) clearTimeout(flashTimer)
  }
}

/**
 * Settings: a rail of areas - "You" for everyone's own, "Server" for the
 * admin's - a search that finds any setting from any area, and section links
 * (`/settings/<area>#<section>`) that open, scroll to and flash the setting.
 *
 * Where each setting lives is defined once, in components/settings/registry.
 */
export default function SettingsView({ user, onLogout }: SettingsViewProps) {
  const { t } = useTranslation()
  const { tab } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const ui = useUISettings()
  const codex = useCodexStatus()
  const isAdmin = user?.role === 'admin'
  // In demo mode, non-admin accounts can view their settings but not change them.
  const locked = Boolean(ui.demo_mode) && !isAdmin

  const visibility = useMemo<SettingsVisibility>(
    () => ({
      isAdmin,
      // `api_keys_allowed` is the server's answer for this person: admins
      // always, anyone else once an admin grants it, never a guest - and never
      // with keys off on the instance.
      apiKeys: ui.api_keys_enabled !== false && Boolean(user?.api_keys_allowed),
      apiKeysOnInstance: ui.api_keys_enabled !== false,
      // Listed for every non-guest while the instance has share links, so
      // someone whose permission was withdrawn can still revoke what they made.
      shareLinks: ui.share_links_enabled !== false && user?.role !== 'guest',
      codex: Boolean(codex?.enabled),
    }),
    [isAdmin, ui.api_keys_enabled, ui.share_links_enabled, user, codex?.enabled]
  )

  const area = resolveArea(tab, visibility)
  const hash = decodeURIComponent(location.hash.replace(/^#/, ''))
  const target = useMemo(
    () => ({ id: hash || null, group: findEntry(hash)?.group ?? null, nonce: location.key }),
    [hash, location.key]
  )

  useEffect(() => {
    if (!hash || tab !== area) return undefined
    return revealWhenPresent(hash)
  }, [hash, area, tab, location.key])

  // Sections with a Save button report unsaved edits here; leaving the area
  // would unmount them and lose the edits, so that asks first.
  const dirty = useRef(new Set<string>())
  const dirtyRegistry = useMemo<DirtyRegistry>(
    () => ({
      set: (id, isDirty) => {
        if (isDirty) dirty.current.add(id)
        else dirty.current.delete(id)
      },
    }),
    []
  )
  const [pending, setPending] = useState<SettingsDestination | null>(null)

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current.size === 0) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  const go = useCallback(
    (dest: SettingsDestination) => {
      // Moving within the area keeps every section mounted, edits included.
      if (dest.area !== area && dirty.current.size > 0) {
        setPending(dest)
        return
      }
      navigate(pathFor(dest))
    },
    [area, navigate]
  )

  if (tab !== area) {
    return <Navigate to={`/settings/${area}${location.search}${location.hash}`} replace />
  }

  const scope = findArea(area)?.scope

  const pages: Record<AreaId, () => ReactNode> = {
    account: () => <AccountArea user={user ?? {}} onLogout={onLogout} />,
    preferences: () => <PreferencesArea />,
    connections: () => <ConnectionsArea user={user ?? {}} visibility={visibility} />,
    overview: () => <OverviewArea />,
    people: () => <PeopleArea />,
    access: () => <AccessArea visibility={visibility} />,
    'sign-in': () => <SignInArea />,
    library: () => <LibraryArea />,
    catalogue: () => <CatalogueArea visibility={visibility} />,
    addons: () => <AddonsArea />,
    sidebar: () => <SidebarArea />,
    backups: () => <BackupsArea />,
    logs: () => <LogsTab />,
  }

  return (
    <div className="settings-page fade-in">
      <aside className="settings-aside">
        <p className="settings-title">{t('settings.title')}</p>
        <SettingsSearch visibility={visibility} onNavigate={go} />
        <SettingsNav current={area} visibility={visibility} onNavigate={(a) => go({ area: a })} />
      </aside>

      <section className="settings-main" aria-labelledby="settings-area-title">
        <header className="settings-header">
          <div>
            <h1 id="settings-area-title">{t(`settings.areas.${area}.title`)}</h1>
            <p className="settings-header-description">{t(`settings.areas.${area}.description`)}</p>
          </div>
          {isAdmin && scope === 'server' && <SettingsQuickActions />}
        </header>

        <SettingsDirtyContext.Provider value={dirtyRegistry}>
          <SettingsTargetContext.Provider value={target}>
            {locked && <DemoModeBanner />}
            {/* A disabled fieldset natively disables every nested input and button. */}
            <fieldset disabled={locked} className="settings-demo-lock">
              <div key={area}>{pages[area]()}</div>
            </fieldset>
          </SettingsTargetContext.Provider>
        </SettingsDirtyContext.Provider>
      </section>

      {pending && (
        <ConfirmModal
          title={t('settings.unsaved.title')}
          message={t('settings.unsaved.message')}
          confirmLabel={t('settings.unsaved.leave')}
          onClose={() => setPending(null)}
          onConfirm={() => {
            dirty.current.clear()
            const dest = pending
            setPending(null)
            navigate(pathFor(dest))
          }}
        />
      )}
    </div>
  )
}
