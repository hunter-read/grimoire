// Shared helpers for the API key settings (issue #489).

// Expiry choices offered when creating or editing a key, in days; null = never.
export const EXPIRY_CHOICES = [30, 90, 365, null]

// Turn an expiry choice into the ISO timestamp the API takes (null = never).
export function expiryFromDays(days, now = new Date()) {
  if (days == null) return null
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

export function formatWhen(iso, locale) {
  if (!iso) return null
  // Mark a naive timestamp as UTC before formatting, or the browser reads it as
  // local time.
  const normalized = /(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(locale, { dateStyle: 'medium' })
}

// The permissions key for "every area, including future ones".
export const ALL = '*'

const RANK = { none: 0, read: 1, write: 2 }

export const rank = (level) => RANK[level] ?? 0

// The level a key effectively holds for one permission: the higher of its own
// entry and the All permissions floor, capped at what that permission offers.
export function effectiveLevel(levels, perm) {
  const explicit = levels[perm.id] || 'none'
  const floor = levels[ALL] || 'none'
  const wanted = rank(explicit) >= rank(floor) ? explicit : floor
  return [...perm.levels].reverse().find((l) => rank(l) <= rank(wanted)) || 'none'
}

// What a key holds, for its summary line: All permissions first, then any area
// raised above it, in the order the server lists them.
export function grantedPermissions(key, permissions) {
  const granted = key.permissions || {}
  const floor = granted[ALL] || 'none'
  const out = floor !== 'none' ? [{ id: ALL, level: floor }] : []
  return out.concat(
    permissions
      .filter((p) => rank(granted[p.id]) > rank(floor))
      .map((p) => ({ id: p.id, level: granted[p.id] }))
  )
}
