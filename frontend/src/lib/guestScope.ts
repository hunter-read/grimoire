/**
 * Which side of the app a guest reaches. A guest is invited to a campaign
 * (`ttrpg`: campaigns and characters) or to a league (`wargame`: leagues and
 * armies), never both. Full accounts have no scope. A guest from before leagues
 * had guests carries none and is a campaign's.
 */
export type GuestScope = 'ttrpg' | 'wargame'

interface MaybeGuest {
  role?: string | null
  guest_scope?: string | null
}

export function guestScopeOf(user: MaybeGuest | null | undefined): GuestScope | null {
  if (user?.role !== 'guest') return null
  return user.guest_scope === 'wargame' ? 'wargame' : 'ttrpg'
}
