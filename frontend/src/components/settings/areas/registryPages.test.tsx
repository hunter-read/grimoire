import { describe, it, expect, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { SETTINGS_ENTRIES, isEntryVisible } from '../registry'
import type { AreaId, SettingsVisibility } from '../registry'
import { SettingsTargetContext } from '../settingsTarget'
import AccountArea from './AccountArea'
import PreferencesArea from './PreferencesArea'
import ConnectionsArea from './ConnectionsArea'
import PeopleArea from './PeopleArea'
import AccessArea from './AccessArea'
import SignInArea from './SignInArea'
import LibraryArea from './LibraryArea'
import CatalogueArea from './CatalogueArea'
import AddonsArea from './AddonsArea'
import SidebarArea from './SidebarArea'
import BackupsArea from './BackupsArea'

// The guard that keeps the registry and the area pages in step: every entry
// the search can offer must be an element on its area's page, reachable by a
// deep link (which opens the group it sits in). The ids live on the
// SettingsSection / CollapsibleSection wrappers the areas draw, so the leaf
// sections themselves are stubbed - this is about where things are, not what
// they do.
vi.mock('../DisplayNameSection', () => ({ default: () => null }))
vi.mock('../EmailSection', () => ({ default: () => null }))
vi.mock('../ChangePasswordSection', () => ({ default: () => null }))
vi.mock('../ActiveSessionsSection', () => ({ default: () => null }))
vi.mock('../DeleteAccountSection', () => ({ default: () => null }))
vi.mock('../UserPreferenceSections', () => ({
  LanguageSection: () => null,
  LibrarySection: () => null,
  ReaderSection: () => null,
}))
vi.mock('../AppearanceSection', () => ({ default: () => null }))
vi.mock('../ExplicitContentSection', () => ({ default: () => null }))
vi.mock('../OPDSSection', () => ({ default: () => null }))
vi.mock('../ApiKeySection', () => ({ default: () => null }))
vi.mock('../ShareLinksSection', () => ({ default: () => null }))
vi.mock('../GuestsSection', () => ({ default: () => null }))
vi.mock('../ShareLinkRolesSection', () => ({ default: () => null }))
vi.mock('../CategoryAccessSection', () => ({ default: () => null }))
vi.mock('../FolderAccessSection', () => ({ default: () => null }))
vi.mock('../CampaignUploadsSection', () => ({ default: () => null }))
vi.mock('../PasswordAuthSection', () => ({ default: () => null }))
vi.mock('../OIDCSettingsSection', () => ({ default: () => null }))
vi.mock('../GuestAccessSection', () => ({ default: () => null }))
vi.mock('../LoginMessageSection', () => ({ default: () => null }))
vi.mock('../RescanSection', () => ({ default: () => null }))
vi.mock('../WatchLibrarySection', () => ({ default: () => null }))
vi.mock('../ScheduledRescanSection', () => ({ default: () => null }))
vi.mock('../FolderCategorySection', () => ({ default: () => null }))
vi.mock('../FolderNamingSection', () => ({ default: () => null }))
vi.mock('../VariantRulesSection', () => ({ default: () => null }))
vi.mock('../FileManagerSection', () => ({ default: () => null }))
vi.mock('../DuplicatesSection', () => ({ default: () => null }))
vi.mock('../DatabaseCleanupSection', () => ({ default: () => null }))
vi.mock('../CodexSection', () => ({ default: () => null }))
vi.mock('../GenreManagerSection', () => ({ default: () => null }))
vi.mock('../SystemFamilyManagerSection', () => ({ default: () => null }))
vi.mock('../ParentSystemManagerSection', () => ({ default: () => null }))
vi.mock('../LicenseManagerSection', () => ({ default: () => null }))
vi.mock('../DiceMaterialManagerSection', () => ({ default: () => null }))
vi.mock('../SidecarExportSection', () => ({ default: () => null }))
vi.mock('../AddonsSection', () => ({ default: () => null }))
vi.mock('../ContentPacksSection', () => ({ default: () => null }))
vi.mock('../SidebarVisibilitySection', () => ({ default: () => null }))
vi.mock('../StatsDisplaySection', () => ({ default: () => null }))
vi.mock('../BackupListSection', () => ({ default: () => null }))
vi.mock('../BackupScheduleSection', () => ({ default: () => null }))

// People renders the real users roster (the guests anchor lives inside it),
// which loads the user list before drawing.
vi.mock('../../../api', () => ({
  default: { get: vi.fn(() => Promise.resolve([])) },
  auth: { config: vi.fn(() => Promise.resolve({ password_auth_enabled: true })) },
}))

const ALL_ON: SettingsVisibility = {
  isAdmin: true,
  apiKeys: true,
  apiKeysOnInstance: true,
  shareLinks: true,
  codex: true,
}

const user = { id: 'u1', username: 'ada', role: 'admin', share_links_allowed: true }

const PAGES: Partial<Record<AreaId, (vis: SettingsVisibility) => ReactNode>> = {
  account: () => <AccountArea user={user} />,
  preferences: () => <PreferencesArea />,
  connections: (vis) => <ConnectionsArea user={user} visibility={vis} />,
  people: () => <PeopleArea />,
  access: (vis) => <AccessArea visibility={vis} />,
  'sign-in': () => <SignInArea />,
  library: () => <LibraryArea />,
  catalogue: (vis) => <CatalogueArea visibility={vis} />,
  addons: () => <AddonsArea />,
  sidebar: () => <SidebarArea />,
  backups: () => <BackupsArea />,
}

function renderLinkedTo(area: AreaId, id: string | null, group: string | null, vis = ALL_ON) {
  return render(
    <MemoryRouter>
      <SettingsTargetContext.Provider value={{ id, group, nonce: 'n' }}>
        {PAGES[area]!(vis)}
      </SettingsTargetContext.Provider>
    </MemoryRouter>
  )
}

describe('registry entries and area pages', () => {
  it('has a page for every area that holds entries', () => {
    for (const entry of SETTINGS_ENTRIES) expect(PAGES[entry.area], entry.area).toBeDefined()
  })

  for (const entry of SETTINGS_ENTRIES.filter((e) => isEntryVisible(e, ALL_ON))) {
    it(`${entry.area}#${entry.id} is on the page`, async () => {
      const { unmount } = renderLinkedTo(entry.area, entry.id, entry.group ?? null)
      await waitFor(() => expect(document.getElementById(entry.id)).not.toBeNull())
      unmount()
    })
  }

  it('leaves out the entries whose feature is off', () => {
    const off = {
      ...ALL_ON,
      apiKeys: false,
      apiKeysOnInstance: false,
      shareLinks: false,
      codex: false,
    }
    for (const entry of SETTINGS_ENTRIES.filter((e) => e.requires)) {
      const { unmount } = renderLinkedTo(entry.area, null, null, off)
      expect(document.getElementById(entry.id), entry.id).toBeNull()
      unmount()
    }
  })
})
