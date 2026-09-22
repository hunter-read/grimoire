const KEY = 'grimoire:user-prefs'

function read() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function write(updates) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), ...updates }))
  } catch {}
}

export function getUserPrefs() {
  return read()
}

export function saveUserPref(key, value) {
  write({ [key]: value })
}

// What the scroll wheel does in the reader.
export const WHEEL_ACTIONS = ['page', 'zoom', 'none']

/**
 * Resolve the reader's wheel behaviour, honouring the older boolean pref.
 *
 * `wheelAction` replaced `wheelNav` when zoom was added (issue #249). A stored
 * `wheelNav: false` meant "don't page on scroll", which now reads as 'none';
 * anything else falls back to the paging default.
 */
export function getWheelAction(prefs = read()) {
  if (WHEEL_ACTIONS.includes(prefs.wheelAction)) return prefs.wheelAction
  return prefs.wheelNav === false ? 'none' : 'page'
}

// Where folders sit among the books beside them (issue #448).
export const FOLDER_PLACEMENTS = ['first', 'mixed']

/** The folder placement pref, defaulting to folders first like most file managers. */
export function getFolderPlacement(prefs = read()) {
  return FOLDER_PLACEMENTS.includes(prefs.folderPlacement) ? prefs.folderPlacement : 'first'
}
