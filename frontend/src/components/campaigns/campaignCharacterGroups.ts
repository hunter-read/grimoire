import type { Schema } from '../../api'
import { isActive } from '../characters/characterStatus'

export type CampaignCharacter = Schema<'CharacterSummary'>

/** One player's characters in a campaign: who they play now, and who came before. */
export interface OwnerGroup {
  userId: string
  name: string
  isGm: boolean
  active: CampaignCharacter[]
  inactive: CampaignCharacter[]
}

const byName = (a: CampaignCharacter, b: CampaignCharacter) =>
  (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })

/**
 * A campaign's characters, grouped by the player who owns them.
 *
 * The GM comes first - their sheets are the table's NPCs, or a solo game's
 * whole party - then the viewer, then everyone else by name. Within a group the
 * characters being played are split from the retired and the dead, so a table
 * that has buried ten heroes still leads with the one still standing. The
 * fallen keep the server's order, most recently changed first, so the latest
 * loss is at the top of the list.
 */
export function groupByOwner(
  characters: CampaignCharacter[],
  { gmId, viewerId }: { gmId?: string | null; viewerId?: string | null }
): OwnerGroup[] {
  const groups = new Map<string, OwnerGroup>()
  for (const character of characters) {
    const userId = character.user_id || ''
    let group = groups.get(userId)
    if (!group) {
      group = {
        userId,
        name: character.owner_name || '',
        isGm: !!gmId && userId === gmId,
        active: [],
        inactive: [],
      }
      groups.set(userId, group)
    }
    ;(isActive(character) ? group.active : group.inactive).push(character)
  }
  const rank = (group: OwnerGroup) => (group.isGm ? 0 : group.userId === viewerId ? 1 : 2)
  const sorted = [...groups.values()].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
  for (const group of sorted) group.active.sort(byName)
  return sorted
}
