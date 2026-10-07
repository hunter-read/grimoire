// Where a character stands in their story. Mirrors the server's closed set
// (`CHARACTER_STATUSES` in backend/routers/characters/_helpers.py).
export const CHARACTER_STATUSES = ['active', 'retired', 'dead']

const STATUS_KEYS = {
  active: 'characters.statusActive',
  retired: 'characters.statusRetired',
  dead: 'characters.statusDead',
}

export function statusLabel(t, status) {
  return t(STATUS_KEYS[status] || STATUS_KEYS.active)
}

export function isActive(character) {
  return (character?.status || 'active') === 'active'
}
