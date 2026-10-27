const KEY = 'grimoire:user-prefs'

/** What the scroll wheel does in the reader. */
export type WheelAction = 'page' | 'zoom' | 'none'

/** Where folders sit among the books beside them. */
export type FolderPlacement = 'first' | 'mixed'

/**
 * The per-browser preference bag in localStorage. The keys below are the ones
 * with a fixed meaning; anything else is a caller-owned key (collapsed-section
 * maps and the like), stored as JSON and read back unchecked.
 */
export interface UserPrefs {
  wheelAction?: string
  /** Legacy: replaced by `wheelAction`. */
  wheelNav?: boolean
  folderPlacement?: string
  librarySort?: string
  recentLimit?: number
  recentCollapsed?: boolean
  systemsGrouped?: boolean
  readerMode?: string
  viewModes?: Record<string, string>
  /** Legacy: replaced by `viewModes`. */
  viewMode?: string
  /** Legacy: replaced by `viewModes`. */
  cardSize?: string
  [key: string]: unknown
}

function read(): UserPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function write(updates: UserPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), ...updates }))
  } catch {}
}

export function getUserPrefs(): UserPrefs {
  return read()
}

export function saveUserPref(key: string, value: unknown): void {
  write({ [key]: value })
}

// What the scroll wheel does in the reader.
export const WHEEL_ACTIONS: WheelAction[] = ['page', 'zoom', 'none']

/**
 * Resolve the reader's wheel behaviour, honouring the older boolean pref.
 *
 * `wheelAction` replaced `wheelNav` when zoom was added (issue #249). A stored
 * `wheelNav: false` meant "don't page on scroll", which now reads as 'none';
 * anything else falls back to the paging default.
 */
export function getWheelAction(prefs: UserPrefs = read()): WheelAction {
  if ((WHEEL_ACTIONS as string[]).includes(prefs.wheelAction as string))
    return prefs.wheelAction as WheelAction
  return prefs.wheelNav === false ? 'none' : 'page'
}

// Where folders sit among the books beside them (issue #448).
export const FOLDER_PLACEMENTS: FolderPlacement[] = ['first', 'mixed']

/** The folder placement pref, defaulting to folders first like most file managers. */
export function getFolderPlacement(prefs: UserPrefs = read()): FolderPlacement {
  return (FOLDER_PLACEMENTS as string[]).includes(prefs.folderPlacement as string)
    ? (prefs.folderPlacement as FolderPlacement)
    : 'first'
}
