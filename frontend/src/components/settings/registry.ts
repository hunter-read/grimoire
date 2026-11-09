/**
 * The map of every place a setting lives: which area page it is on, which
 * collapsible group (if any) holds it, and the words someone might search for
 * to find it.
 *
 * The settings rail, the search box and section deep links
 * (`/settings/<area>#<entry id>`) all read from here, so they cannot disagree
 * about where a setting is. Each entry's `id` is also the DOM id the area page
 * gives that section - SettingsView.test checks the two stay in step.
 */

export type SettingsScope = 'you' | 'server'

export type AreaId =
  | 'account'
  | 'preferences'
  | 'connections'
  | 'overview'
  | 'people'
  | 'access'
  | 'sign-in'
  | 'library'
  | 'catalogue'
  | 'addons'
  | 'sidebar'
  | 'backups'
  | 'logs'

export interface SettingsArea {
  id: AreaId
  /** "you" areas are everyone's own settings; "server" areas are admin-only. */
  scope: SettingsScope
}

/** Instance or account features an entry only exists with. */
export type SettingsRequirement = 'apiKeys' | 'shareLinks' | 'codex'

export interface SettingsEntry {
  /** DOM id of the section and the URL hash that reaches it. */
  id: string
  area: AreaId
  /** The id of the collapsible group the section sits in, opened on arrival. */
  group?: string
  /** i18n keys. */
  title: string
  description?: string
  requires?: SettingsRequirement
}

/** What decides which areas and entries the current person can see. */
export interface SettingsVisibility {
  isAdmin: boolean
  /** This person may hold API keys of their own. */
  apiKeys: boolean
  /** API keys exist on this instance at all. */
  apiKeysOnInstance: boolean
  shareLinks: boolean
  codex: boolean
}

export const SETTINGS_AREAS: readonly SettingsArea[] = [
  { id: 'account', scope: 'you' },
  { id: 'preferences', scope: 'you' },
  { id: 'connections', scope: 'you' },
  { id: 'overview', scope: 'server' },
  { id: 'people', scope: 'server' },
  { id: 'access', scope: 'server' },
  { id: 'sign-in', scope: 'server' },
  { id: 'library', scope: 'server' },
  { id: 'catalogue', scope: 'server' },
  { id: 'addons', scope: 'server' },
  { id: 'sidebar', scope: 'server' },
  { id: 'backups', scope: 'server' },
  { id: 'logs', scope: 'server' },
]

/**
 * The tab keys Settings used before it was split into areas, and where each
 * one's contents went. Bookmarks, docs and links elsewhere in the app still use
 * them.
 */
export const LEGACY_AREAS: Readonly<Record<string, AreaId>> = {
  users: 'people',
  authentication: 'sign-in',
  application: 'access',
  metadata: 'catalogue',
  maintenance: 'library',
}

export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  // Account
  {
    id: 'profile',
    area: 'account',
    title: 'settings.groups.profile',
    description: 'userSettings.groups.profileDesc',
  },
  {
    id: 'display-name',
    area: 'account',
    group: 'profile',
    title: 'userSettings.displayName.title',
    description: 'userSettings.displayName.description',
  },
  {
    id: 'email',
    area: 'account',
    group: 'profile',
    title: 'userSettings.email.title',
    description: 'userSettings.email.description',
  },
  {
    id: 'security',
    area: 'account',
    title: 'settings.groups.security',
    description: 'settings.groups.securityDesc',
  },
  {
    id: 'change-password',
    area: 'account',
    group: 'security',
    title: 'userSettings.changePassword.title',
    description: 'userSettings.changePassword.description',
  },
  {
    id: 'sessions',
    area: 'account',
    group: 'security',
    title: 'userSettings.sessions.title',
    description: 'userSettings.sessions.description',
  },
  {
    id: 'delete-account',
    area: 'account',
    group: 'account-danger',
    title: 'userSettings.deleteAccount.title',
    description: 'userSettings.deleteAccount.description',
  },

  // Preferences
  {
    id: 'language',
    area: 'preferences',
    group: 'look',
    title: 'userSettings.language.title',
    description: 'userSettings.language.description',
  },
  {
    id: 'theme',
    area: 'preferences',
    group: 'look',
    title: 'settings.entries.theme',
    description: 'settings.entries.themeDesc',
  },
  {
    id: 'reader',
    area: 'preferences',
    group: 'reading',
    title: 'userSettings.reader.title',
    description: 'userSettings.reader.description',
  },
  {
    id: 'library-browsing',
    area: 'preferences',
    group: 'reading',
    title: 'userSettings.library.title',
    description: 'userSettings.library.description',
  },
  {
    id: 'content-preferences',
    area: 'preferences',
    group: 'reading',
    title: 'userSettings.contentPreferences.title',
    description: 'userSettings.contentPreferences.description',
  },

  // Connections
  {
    id: 'opds',
    area: 'connections',
    title: 'userSettings.opds.title',
    description: 'userSettings.opds.description',
  },
  {
    id: 'api-keys',
    area: 'connections',
    title: 'appSettings.apiKeys.title',
    description: 'settings.entries.apiKeysDesc',
    requires: 'apiKeys',
  },
  {
    id: 'share-links',
    area: 'connections',
    title: 'userSettings.shareLinks.title',
    description: 'userSettings.shareLinks.description',
    requires: 'shareLinks',
  },

  // People
  {
    id: 'users',
    area: 'people',
    title: 'settings.entries.users',
    description: 'settings.entries.usersDesc',
  },
  {
    id: 'guests',
    area: 'people',
    title: 'guests.guests',
    description: 'settings.entries.guestsDesc',
  },

  // Access & sharing
  {
    id: 'share-link-roles',
    area: 'access',
    title: 'settings.entries.shareLinkRoles',
    description: 'users.shareLinks.rolesHint',
    requires: 'shareLinks',
  },
  {
    id: 'category-access',
    area: 'access',
    title: 'appSettings.categoryAccess.title',
    description: 'appSettings.categoryAccess.description',
  },
  {
    id: 'folder-access',
    area: 'access',
    title: 'appSettings.folderAccess.title',
    description: 'appSettings.folderAccess.description',
  },
  {
    id: 'campaign-uploads',
    area: 'access',
    title: 'appSettings.campaignUploads.title',
    description: 'appSettings.campaignUploads.description',
  },
  {
    id: 'all-api-keys',
    area: 'access',
    title: 'appSettings.apiKeys.allTitle',
    description: 'appSettings.apiKeys.allDescription',
    requires: 'apiKeys',
  },

  // Sign-in
  {
    id: 'password-sign-in',
    area: 'sign-in',
    title: 'authSettings.passwordAuth.title',
    description: 'authSettings.passwordAuth.description',
  },
  {
    id: 'oidc',
    area: 'sign-in',
    title: 'authSettings.oidc.title',
    description: 'authSettings.oidc.description',
  },
  {
    id: 'guest-access',
    area: 'sign-in',
    title: 'authSettings.guestAccess.title',
    description: 'authSettings.guestAccess.description',
  },
  {
    id: 'login-message',
    area: 'sign-in',
    title: 'authSettings.customMessage.title',
    description: 'authSettings.customMessage.description',
  },

  // Library
  {
    id: 'scanning',
    area: 'library',
    title: 'settings.groups.scanning',
    description: 'maintenance.groups.scanningDesc',
  },
  {
    id: 'rescan',
    area: 'library',
    group: 'scanning',
    title: 'maintenance.rescan.title',
    description: 'maintenance.rescan.description',
  },
  {
    id: 'watch',
    area: 'library',
    group: 'scanning',
    title: 'maintenance.watch.title',
    description: 'maintenance.watch.description',
  },
  {
    id: 'scheduled-rescan',
    area: 'library',
    group: 'scanning',
    title: 'maintenance.scheduledRescan.title',
    description: 'maintenance.scheduledRescan.description',
  },
  {
    id: 'files-and-folders',
    area: 'library',
    title: 'settings.groups.filesAndFolders',
    description: 'settings.groups.filesAndFoldersDesc',
  },
  {
    id: 'folder-category',
    area: 'library',
    group: 'files-and-folders',
    title: 'appSettings.folderCategory.title',
    description: 'appSettings.folderCategory.description',
  },
  {
    id: 'folder-naming',
    area: 'library',
    group: 'files-and-folders',
    title: 'filenameRules.folderTitle',
    description: 'filenameRules.folderDesc',
  },
  {
    id: 'variant-rules',
    area: 'library',
    group: 'files-and-folders',
    title: 'filenameRules.variantTitle',
    description: 'filenameRules.variantDesc',
  },
  {
    id: 'library-tools',
    area: 'library',
    title: 'settings.groups.tools',
    description: 'maintenance.groups.libraryDesc',
  },
  {
    id: 'file-manager',
    area: 'library',
    group: 'library-tools',
    title: 'settings.entries.fileManager',
    description: 'settings.entries.fileManagerDesc',
  },
  {
    id: 'duplicates',
    area: 'library',
    group: 'library-tools',
    title: 'maintenance.dupes.title',
    description: 'maintenance.dupes.description',
  },
  {
    id: 'cleanup',
    area: 'library',
    group: 'library-danger',
    title: 'maintenance.cleanup.title',
    description: 'maintenance.cleanup.description',
  },

  // Metadata & catalogue
  {
    id: 'genres',
    area: 'catalogue',
    title: 'lookupSettings.genresTitle',
    description: 'lookupSettings.genresDesc',
  },
  {
    id: 'system-families',
    area: 'catalogue',
    title: 'lookupSettings.familiesTitle',
    description: 'lookupSettings.familiesDesc',
  },
  {
    id: 'parent-systems',
    area: 'catalogue',
    title: 'lookupSettings.parentSystemsTitle',
    description: 'lookupSettings.parentSystemsDesc',
  },
  {
    id: 'licenses',
    area: 'catalogue',
    title: 'lookupSettings.licensesTitle',
    description: 'lookupSettings.licensesDesc',
  },
  {
    id: 'dice-materials',
    area: 'catalogue',
    title: 'lookupSettings.diceTitle',
    description: 'lookupSettings.diceDesc',
  },
  {
    id: 'sidecars',
    area: 'catalogue',
    group: 'sidecar-files',
    title: 'maintenance.sidecars.title',
    description: 'maintenance.sidecars.description',
  },
  {
    id: 'codex',
    area: 'catalogue',
    title: 'codex.settings.title',
    description: 'codex.settings.description',
    requires: 'codex',
  },

  // Add-ons & content
  {
    id: 'community-addons',
    area: 'addons',
    title: 'addons.title',
    description: 'addons.description',
  },
  {
    id: 'content-packs',
    area: 'addons',
    title: 'contentPacks.title',
    description: 'settings.entries.contentPacksDesc',
  },

  // Sidebar
  {
    id: 'sidebar-visibility',
    area: 'sidebar',
    title: 'appSettings.sidebarVisibility.title',
    description: 'appSettings.sidebarVisibility.description',
  },
  {
    id: 'sidebar-stats',
    area: 'sidebar',
    title: 'appSettings.sidebarStats.title',
    description: 'appSettings.sidebarStats.description',
  },

  // Backups
  {
    id: 'backup-list',
    area: 'backups',
    title: 'backups.list.title',
    description: 'backups.list.description',
  },
  {
    id: 'backup-schedule',
    area: 'backups',
    title: 'backups.schedule.title',
    description: 'backups.schedule.description',
  },
]

const AREA_BY_ID = new Map(SETTINGS_AREAS.map((a) => [a.id, a]))
const ENTRY_BY_ID = new Map(SETTINGS_ENTRIES.map((e) => [e.id, e]))

export function findArea(id: string | undefined): SettingsArea | undefined {
  return id ? AREA_BY_ID.get(id as AreaId) : undefined
}

export function findEntry(id: string | undefined): SettingsEntry | undefined {
  return id ? ENTRY_BY_ID.get(id) : undefined
}

export function isAreaVisible(area: SettingsArea, vis: SettingsVisibility): boolean {
  return area.scope === 'you' || vis.isAdmin
}

export function isEntryVisible(entry: SettingsEntry, vis: SettingsVisibility): boolean {
  const area = findArea(entry.area)
  if (!area || !isAreaVisible(area, vis)) return false
  switch (entry.requires) {
    case 'apiKeys':
      // The all-keys audit is the admin's, and exists whenever keys do; a
      // personal key needs this person to be allowed one.
      return entry.area === 'access' ? vis.apiKeysOnInstance : vis.apiKeys
    case 'shareLinks':
      return vis.shareLinks
    case 'codex':
      return vis.codex
    default:
      return true
  }
}

/** The area a signed-in person lands on at /settings. */
export function defaultArea(isAdmin: boolean): AreaId {
  return isAdmin ? 'overview' : 'account'
}

/**
 * Where a /settings/<key> URL should go: the area itself, the area an old tab
 * key moved to, or the person's default when the key is unknown or not theirs.
 * Returns the key unchanged when it is already right.
 */
export function resolveArea(key: string | undefined, vis: SettingsVisibility): AreaId {
  const id = key && LEGACY_AREAS[key] ? LEGACY_AREAS[key] : key
  const area = findArea(id)
  if (area && isAreaVisible(area, vis)) return area.id
  return defaultArea(vis.isAdmin)
}

/** Lower-cased and stripped of accents, so "theme" finds "Thème". */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export interface SearchableEntry {
  entry: SettingsEntry
  title: string
  description: string
  areaTitle: string
  /** Extra words people use for this setting that its title doesn't. */
  keywords: string
}

export interface SearchResult extends SearchableEntry {
  score: number
}

/** The words of a text, so a query matches the start of a word, never its middle. */
function wordsOf(text: string): string[] {
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

const startsAWord = (words: string[], query: string) => words.some((w) => w.startsWith(query))

/**
 * Rank entries for a query. Every query word must start a word somewhere
 * (title, keywords, area name or description) - "sso" finds "SSO", not
 * "associated". A hit in the title outranks one in the keywords, which
 * outranks one in the area name or description.
 */
export function searchEntries(
  query: string,
  entries: readonly SearchableEntry[],
  limit = 8
): SearchResult[] {
  const queryWords = wordsOf(query)
  if (queryWords.length === 0) return []
  const results: SearchResult[] = []
  for (const item of entries) {
    const title = wordsOf(item.title)
    const keywords = wordsOf(item.keywords)
    const area = wordsOf(item.areaTitle)
    const description = wordsOf(item.description)
    let score = 0
    let matched = true
    for (const [i, word] of queryWords.entries()) {
      if (i === 0 && title[0]?.startsWith(word)) score += 10
      else if (startsAWord(title, word)) score += 8
      else if (startsAWord(keywords, word)) score += 4
      else if (startsAWord(area, word)) score += 2
      else if (startsAWord(description, word)) score += 1
      else {
        matched = false
        break
      }
    }
    if (matched) results.push({ ...item, score })
  }
  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit)
}
