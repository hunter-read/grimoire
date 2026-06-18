import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import SettingsView from './SettingsView'
import { UISettingsProvider } from '../context/UISettingsContext'
import { useUnsavedChanges } from '../components/settings/settingsDirty'
import type { SettingsUser } from '../components/settings/areas/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

const codex = vi.hoisted(() => ({ status: { enabled: false, url: '' } as unknown }))
vi.mock('../components/codex/useCodexStatus', () => ({ default: () => codex.status }))

vi.mock('../components/settings/SettingsQuickActions', () => ({
  default: () => <div>quick-actions</div>,
}))
vi.mock('../components/settings/ConfirmModal', () => ({
  default: ({
    title,
    onConfirm,
    onClose,
  }: {
    title: ReactNode
    onConfirm: () => void
    onClose: () => void
  }) => (
    <div role="dialog" aria-label={String(title)}>
      <button onClick={onClose}>cancel</button>
      <button onClick={onConfirm}>confirm</button>
    </div>
  ),
}))

// Account holds a section with unsaved edits whenever a test asks for one.
const dirty = vi.hoisted(() => ({ on: false }))
function DirtySection() {
  useUnsavedChanges('stub', dirty.on)
  return <div>account-area</div>
}
vi.mock('../components/settings/areas/AccountArea', () => ({ default: () => <DirtySection /> }))
vi.mock('../components/settings/areas/PreferencesArea', () => ({
  default: () => <div>preferences-area</div>,
}))
vi.mock('../components/settings/areas/OverviewArea', () => ({
  default: () => <div>overview-area</div>,
}))
vi.mock('../components/settings/areas/PeopleArea', () => ({
  default: () => <div>people-area</div>,
}))
vi.mock('../components/settings/areas/AccessArea', () => ({
  default: () => <div>access-area</div>,
}))
vi.mock('../components/settings/areas/SignInArea', () => ({
  default: () => <div>sign-in-area</div>,
}))
vi.mock('../components/settings/areas/CatalogueArea', () => ({
  default: () => <div>catalogue-area</div>,
}))
vi.mock('../components/settings/areas/AddonsArea', () => ({
  default: () => <div>addons-area</div>,
}))
vi.mock('../components/settings/areas/SidebarArea', () => ({
  default: () => <div>sidebar-area</div>,
}))
vi.mock('../components/settings/areas/BackupsArea', () => ({
  default: () => <div>backups-area</div>,
}))
vi.mock('../components/settings/LogsTab', () => ({ default: () => <div>logs-area</div> }))

// Library and Connections are the real area pages, with their leaves stubbed,
// so deep links and the visibility rules run against what people see.
vi.mock('../components/settings/RescanSection', () => ({ default: () => <div>rescan</div> }))
vi.mock('../components/settings/WatchLibrarySection', () => ({ default: () => <div>watch</div> }))
vi.mock('../components/settings/ScheduledRescanSection', () => ({ default: () => null }))
vi.mock('../components/settings/FolderCategorySection', () => ({ default: () => null }))
vi.mock('../components/settings/FolderNamingSection', () => ({ default: () => null }))
vi.mock('../components/settings/VariantRulesSection', () => ({ default: () => null }))
vi.mock('../components/settings/FileManagerSection', () => ({ default: () => null }))
vi.mock('../components/settings/DuplicatesSection', () => ({ default: () => null }))
vi.mock('../components/settings/DatabaseCleanupSection', () => ({ default: () => null }))
vi.mock('../components/settings/OPDSSection', () => ({ default: () => <div>opds</div> }))
vi.mock('../components/settings/ApiKeySection', () => ({ default: () => <div>api-keys</div> }))
vi.mock('../components/settings/ShareLinksSection', () => ({
  default: ({ canShare }: { canShare: boolean }) => (
    <div>{canShare ? 'share-links:can' : 'share-links:cannot'}</div>
  ),
}))

function Location() {
  const loc = useLocation()
  return <output data-testid="location">{`${loc.pathname}${loc.search}${loc.hash}`}</output>
}

function renderAt(path: string, user: SettingsUser | null, ui: Record<string, unknown> = {}) {
  const view = <SettingsView user={user} onLogout={vi.fn()} />
  const settings = { api_keys_enabled: true, share_links_enabled: true, ...ui }
  return render(
    <UISettingsProvider value={settings as ComponentProps<typeof UISettingsProvider>['value']}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/settings" element={view} />
          <Route path="/settings/:tab" element={view} />
        </Routes>
        <Location />
      </MemoryRouter>
    </UISettingsProvider>
  )
}

const ADMIN = { id: 'a', username: 'root', role: 'admin', api_keys_allowed: true }
const PLAYER = { id: 'p', username: 'ada', role: 'player' }
const location = () => screen.getByTestId('location').textContent
const nav = () => screen.getByRole('navigation', { name: 'settings.nav.label' })
const railLink = (area: string) =>
  within(nav()).getByRole('link', { name: `settings.areas.${area}.title` })

beforeEach(() => {
  codex.status = { enabled: false, url: '' }
  dirty.on = false
})

describe('SettingsView rail', () => {
  it('shows an admin both scopes, labelled', () => {
    renderAt('/settings/account', ADMIN)
    expect(within(nav()).getByText('settings.scopes.you')).toBeInTheDocument()
    expect(within(nav()).getByText('settings.scopes.server')).toBeInTheDocument()
    expect(railLink('library')).toBeInTheDocument()
    expect(railLink('preferences')).toBeInTheDocument()
  })

  it('shows anyone else only their own areas, with no scope labels', () => {
    renderAt('/settings/account', PLAYER)
    expect(railLink('account')).toHaveAttribute('aria-current', 'page')
    expect(railLink('connections')).toBeInTheDocument()
    expect(within(nav()).queryByRole('link', { name: 'settings.areas.library.title' })).toBeNull()
    expect(within(nav()).queryByText('settings.scopes.you')).toBeNull()
    expect(within(nav()).queryByText('settings.scopes.server')).toBeNull()
  })

  it('titles the page after the current area', () => {
    renderAt('/settings/preferences', PLAYER)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'settings.areas.preferences.title'
    )
    expect(screen.getByText('preferences-area')).toBeInTheDocument()
  })

  it('renders each area page from its key', () => {
    const pages: Record<string, string> = {
      overview: 'overview-area',
      people: 'people-area',
      access: 'access-area',
      'sign-in': 'sign-in-area',
      catalogue: 'catalogue-area',
      addons: 'addons-area',
      sidebar: 'sidebar-area',
      backups: 'backups-area',
      logs: 'logs-area',
    }
    for (const [area, text] of Object.entries(pages)) {
      const { unmount } = renderAt(`/settings/${area}`, ADMIN)
      expect(screen.getByText(text)).toBeInTheDocument()
      unmount()
    }
  })
})

describe('SettingsView redirects', () => {
  it('lands an admin on the overview and anyone else on their account', () => {
    const { unmount } = renderAt('/settings', ADMIN)
    expect(location()).toBe('/settings/overview')
    unmount()
    renderAt('/settings', PLAYER)
    expect(location()).toBe('/settings/account')
  })

  it('sends an old tab key to its new area, keeping the query and hash', () => {
    renderAt('/settings/maintenance?from=docs#watch', ADMIN)
    expect(location()).toBe('/settings/library?from=docs#watch')
  })

  it('sends an unknown area to the default one', () => {
    renderAt('/settings/nope', ADMIN)
    expect(location()).toBe('/settings/overview')
  })

  it("keeps a non-admin out of the server's areas", () => {
    renderAt('/settings/library', PLAYER)
    expect(location()).toBe('/settings/account')
    expect(screen.getByText('account-area')).toBeInTheDocument()
  })

  it('treats a missing user as a non-admin', () => {
    renderAt('/settings/logs', null)
    expect(location()).toBe('/settings/account')
  })
})

describe('SettingsView quick actions', () => {
  it('pins them to the server areas for an admin', () => {
    renderAt('/settings/people', ADMIN)
    expect(screen.getByText('quick-actions')).toBeInTheDocument()
  })

  it("leaves them off an admin's own areas", () => {
    renderAt('/settings/account', ADMIN)
    expect(screen.queryByText('quick-actions')).toBeNull()
  })

  it('never shows them to anyone else', () => {
    renderAt('/settings/account', { role: 'gm' })
    expect(screen.queryByText('quick-actions')).toBeNull()
  })
})

describe('SettingsView visibility rules', () => {
  // Their links are suspended, not deleted, so someone who lost the right to
  // share still needs to see them.
  it('lists your share links whether or not you may still share', () => {
    const { unmount } = renderAt('/settings/connections', {
      ...PLAYER,
      share_links_allowed: true,
    })
    expect(screen.getByText('share-links:can')).toBeInTheDocument()
    unmount()
    renderAt('/settings/connections', { ...PLAYER, share_links_allowed: false })
    expect(screen.getByText('share-links:cannot')).toBeInTheDocument()
  })

  it('hides share links from guests and when the instance has them off', () => {
    const { unmount } = renderAt('/settings/connections', { role: 'guest' })
    expect(screen.queryByText(/share-links/)).toBeNull()
    unmount()
    renderAt('/settings/connections', ADMIN, { share_links_enabled: false })
    expect(screen.queryByText(/share-links/)).toBeNull()
    expect(screen.getByText('opds')).toBeInTheDocument()
  })

  it('offers API keys only to someone the server allows them', () => {
    const { unmount } = renderAt('/settings/connections', { ...PLAYER, api_keys_allowed: true })
    expect(screen.getByText('api-keys')).toBeInTheDocument()
    unmount()
    renderAt('/settings/connections', { ...PLAYER, api_keys_allowed: false })
    expect(screen.queryByText('api-keys')).toBeNull()
  })

  it('hides API keys from everyone when the instance has them off', () => {
    renderAt('/settings/connections', ADMIN, { api_keys_enabled: false })
    expect(screen.queryByText('api-keys')).toBeNull()
  })
})

describe('SettingsView deep links', () => {
  let scrollIntoView: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
    })
    scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView']
  })

  afterEach(() => {
    vi.useRealTimers()
    // jsdom has none of its own; leave it as we found it.
    delete (Element.prototype as Partial<Element>).scrollIntoView
  })

  it('opens the group holding the target, scrolls to it and flashes it', () => {
    // The person had closed Scanning; following a link into it opens it anyway.
    localStorage.setItem('grimoire:settings:maintenance:scanning', '0')
    renderAt('/settings/library#watch', ADMIN)

    expect(screen.getByRole('button', { name: 'settings.groups.scanning' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    const watch = document.getElementById('watch')!
    expect(watch).not.toHaveClass('settings-flash')

    act(() => {
      vi.advanceTimersByTime(20)
    })
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    expect(watch).toHaveClass('settings-flash')
    expect(document.activeElement).toBe(watch)
    // Arriving by link doesn't change how the person left the group.
    expect(localStorage.getItem('grimoire:settings:maintenance:scanning')).toBe('0')

    act(() => {
      vi.advanceTimersByTime(2500)
    })
    expect(watch).not.toHaveClass('settings-flash')
  })

  it('gives up quietly on a section that never appears', () => {
    renderAt('/settings/library#nowhere', ADMIN)
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('stops looking once the page goes away', () => {
    const { unmount } = renderAt('/settings/library#watch', ADMIN)
    unmount()
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})

describe('SettingsView unsaved changes', () => {
  it('asks before leaving an area with unsaved edits, and stays on cancel', () => {
    dirty.on = true
    renderAt('/settings/account', PLAYER)

    fireEvent.click(railLink('preferences'))
    expect(screen.getByRole('dialog', { name: 'settings.unsaved.title' })).toBeInTheDocument()
    expect(location()).toBe('/settings/account')

    fireEvent.click(screen.getByText('cancel'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(location()).toBe('/settings/account')
  })

  it('leaves once the person confirms', () => {
    dirty.on = true
    renderAt('/settings/account', PLAYER)

    fireEvent.click(railLink('preferences'))
    fireEvent.click(screen.getByText('confirm'))

    expect(location()).toBe('/settings/preferences')
    expect(screen.getByText('preferences-area')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('also asks when the mobile area picker is used', () => {
    dirty.on = true
    renderAt('/settings/account', PLAYER)
    fireEvent.change(within(nav()).getByRole('combobox'), { target: { value: 'connections' } })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('moves freely with no unsaved edits', () => {
    renderAt('/settings/account', PLAYER)
    fireEvent.click(railLink('preferences'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(location()).toBe('/settings/preferences')
  })

  it("doesn't ask when moving within the same area", () => {
    dirty.on = true
    renderAt('/settings/account', PLAYER)
    const search = screen.getByRole('combobox', { name: 'settings.search.label' })
    fireEvent.change(search, { target: { value: 'displayname' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(location()).toBe('/settings/account#display-name')
  })

  it('holds the tab open while edits are unsaved', () => {
    dirty.on = true
    const { unmount } = renderAt('/settings/account', PLAYER)
    const leaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leaving)
    expect(leaving.defaultPrevented).toBe(true)
    unmount()

    dirty.on = false
    renderAt('/settings/account', PLAYER)
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
  })
})

describe('SettingsView with Grimoire Codex DB', () => {
  it('searches its settings only when it is on', () => {
    codex.status = { enabled: true, url: 'https://db.example' }
    renderAt('/settings/overview', ADMIN)
    const search = screen.getByRole('combobox', { name: 'settings.search.label' })
    fireEvent.change(search, { target: { value: 'codex.settings' } })
    expect(screen.getByRole('option', { name: /codex\.settings\.title/ })).toBeInTheDocument()
  })
})

// Demo mode: a public demo instance freezes non-admin settings behind a
// disabled fieldset so visitors can look around without editing their account.
describe('SettingsView demo mode lockdown', () => {
  const GM = { id: 'g', username: 'gm', role: 'gm' }
  const lock = (container: HTMLElement) => container.querySelector('fieldset.settings-demo-lock')

  it('disables every setting for a non-admin when demo mode is on', () => {
    const { container } = renderAt('/settings/account', PLAYER, { demo_mode: true })
    expect(lock(container)).toBeDisabled()
    expect(screen.getByText('userSettings.demoMode.notice')).toBeInTheDocument()
  })

  it('locks gm accounts too', () => {
    const { container } = renderAt('/settings/connections', GM, { demo_mode: true })
    expect(lock(container)).toBeDisabled()
  })

  it('does not lock admin accounts in demo mode', () => {
    const { container } = renderAt('/settings/account', ADMIN, { demo_mode: true })
    expect(lock(container)).not.toBeDisabled()
    expect(screen.queryByText('userSettings.demoMode.notice')).not.toBeInTheDocument()
  })

  it('does not lock non-admins when demo mode is off', () => {
    const { container } = renderAt('/settings/account', PLAYER, { demo_mode: false })
    expect(lock(container)).not.toBeDisabled()
    expect(screen.queryByText('userSettings.demoMode.notice')).not.toBeInTheDocument()
  })
})
