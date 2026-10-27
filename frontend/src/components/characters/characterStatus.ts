// Where a character stands in their story. Mirrors the server's closed set
// (`CHARACTER_STATUSES` in backend/routers/characters/_helpers.py).
import type { TFunction } from 'i18next'

export const CHARACTER_STATUSES = ['active', 'retired', 'dead']

const STATUS_KEYS: Record<string, string> = {
  active: 'characters.statusActive',
  retired: 'characters.statusRetired',
  dead: 'characters.statusDead',
}

export function statusLabel(t: TFunction, status: string | null | undefined): string {
  return t((status && STATUS_KEYS[status]) || STATUS_KEYS.active)
}

export function isActive(character: { status?: string | null } | null | undefined): boolean {
  return (character?.status || 'active') === 'active'
}
