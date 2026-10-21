/**
 * Working with duplicate groups as the unit of review (issue #589).
 *
 * Review used to split each group into parent-vs-child pairs, one decision per
 * pair, because a decision was a delete that threw away whatever pointed at the
 * dropped copy. A merge moves those references instead, so a whole group can be
 * settled in one step: the reviewer sees every copy at once, picks the keeper,
 * and unticks any member that turned out not to belong.
 */
import type { Schema } from '../api'

export type DuplicateGroup = Schema<'DuplicateGroupOut'>
export type GroupMember = Schema<'GroupMember'>

/** How sure detection is that a group is one item: the filter on the list. */
export type MatchStrength = 'exact' | 'text' | 'metadata'

/**
 * Rank a member as the copy to keep. Higher wins.
 *
 * Purely about the file: a present file beats a missing one, then more pages,
 * then more bytes. What points at a copy does not count any more - bookmarks,
 * favorites and campaign links move to the keeper in a merge - so the old
 * "keep whichever copy has the most references" rule would only keep a
 * truncated scan because someone bookmarked it first.
 */
export function keeperScore(member: GroupMember | null | undefined): number {
  if (!member) return -1
  const present = member.is_missing ? 0 : 1
  return present * 1e15 + (member.page_count || 0) * 1e10 + (member.file_size || 0)
}

/**
 * The member a group should be merged into. The best-scoring copy wins; the
 * scan's own suggestion breaks a tie, since it also weighed which row is
 * oldest.
 */
export function pickKeeper(group: DuplicateGroup | null | undefined): GroupMember | null {
  const members = group?.members || []
  if (members.length === 0) return null
  return members.reduce((best, m) => {
    const diff = keeperScore(m) - keeperScore(best)
    if (diff > 0) return m
    if (diff === 0 && m.id === group?.suggested_parent_id) return m
    return best
  }, members[0])
}

/** Every member byte-identical: the one case a merge needs no human judgement. */
export function isExactGroup(group: DuplicateGroup): boolean {
  const members = group.members || []
  const hash = members[0]?.content_hash
  return members.length >= 2 && !!hash && members.every((m) => m.content_hash === hash)
}

/**
 * The strongest claim a group makes. ``exact`` only when every file is
 * identical - a group the scan linked by hash for some members and by title for
 * the rest still needs looking at - then overlapping text, then everything
 * matched on names and metadata alone.
 */
export function matchStrength(group: DuplicateGroup): MatchStrength {
  if (isExactGroup(group)) return 'exact'
  if ((group.reasons || []).includes('text')) return 'text'
  return 'metadata'
}

export interface GroupFilters {
  type?: string
  match?: MatchStrength | ''
}

export function filterGroups(
  groups: DuplicateGroup[] | null | undefined,
  { type = '', match = '' }: GroupFilters = {}
): DuplicateGroup[] {
  return (groups || []).filter(
    (g) => (!type || g.resource_type === type) && (!match || matchStrength(g) === match)
  )
}

/** The merge request that settles a group into its suggested keeper. */
export function groupMerge(group: DuplicateGroup) {
  const keeper = pickKeeper(group)
  const keepId = keeper?.id || ''
  return {
    resource_type: group.resource_type as Schema<'MergeBatchEntry'>['resource_type'],
    keep_id: keepId,
    merge_ids: (group.members || []).map((m) => m.id).filter((id) => id !== keepId),
  }
}
