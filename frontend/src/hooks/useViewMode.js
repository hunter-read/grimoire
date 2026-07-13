import { useState } from 'react'
import { getUserPrefs, saveUserPref } from './useUserPrefs'

export const VIEW_MODES = ['card', 'compact', 'list']

// Content types that have an independent, remembered view mode. Each gets its
// own default and its own persisted Settings preference.
export const CONTENT_TYPES = ['system', 'book', 'map', 'token', 'audio']

// Per-content-type default view mode, used when the user has not chosen one.
export const DEFAULT_VIEW_MODES = {
  system: 'card',
  book: 'list',
  map: 'compact',
  token: 'compact',
  audio: 'list',
}

const sessionKey = (type) => `grimoire:view-mode:${type}`

/**
 * The persisted default view mode for a content type, read from user prefs.
 * Falls back to the legacy single `viewMode` / `cardSize` prefs (so existing
 * users keep a sensible setting) and finally to the per-type default.
 */
export function getDefaultViewMode(type) {
  const prefs = getUserPrefs()
  const byType = prefs.viewModes || {}
  if (VIEW_MODES.includes(byType[type])) return byType[type]
  // Legacy single shared pref (pre per-type) — honour it only for `system`,
  // which was the page that owned that setting; other types use their default.
  if (type === 'system') {
    if (VIEW_MODES.includes(prefs.viewMode)) return prefs.viewMode
    if (prefs.cardSize === 'compact') return 'compact'
  }
  return DEFAULT_VIEW_MODES[type] || 'card'
}

/**
 * Persist a content type's default view mode into user prefs.
 */
export function saveDefaultViewMode(type, mode) {
  const prefs = getUserPrefs()
  saveUserPref('viewModes', { ...(prefs.viewModes || {}), [type]: mode })
}

/**
 * Shared view-style selection for a content type's grid (systems, books, maps,
 * tokens). The cycle button writes to sessionStorage only — a temporary,
 * in-tab override that resets to the persisted default on reload or in a new
 * tab. Only the Settings preference persists permanently.
 *
 * @param {string} type one of CONTENT_TYPES
 * @returns [mode, cycle] where cycle() advances card → compact → list → card.
 */
export default function useViewMode(type = 'system') {
  const [mode, setMode] = useState(() => {
    try {
      const stored = sessionStorage.getItem(sessionKey(type))
      if (VIEW_MODES.includes(stored)) return stored
    } catch {}
    return getDefaultViewMode(type)
  })

  const cycle = () => {
    const next = VIEW_MODES[(VIEW_MODES.indexOf(mode) + 1) % VIEW_MODES.length]
    try {
      sessionStorage.setItem(sessionKey(type), next)
    } catch {}
    setMode(next)
  }

  return [mode, cycle]
}
