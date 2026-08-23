/**
 * Turning a duplicate group into the pairs a user actually reviews.
 *
 * Detection works in pairwise edges but stores *groups*, because a group is the
 * natural unit for "these three are all the same book". Review is the opposite:
 * five copies on one card is more than a person can hold in their head, and a
 * single verdict over five files cannot express "these four match but that
 * fifth one is a different book" (issue #304 follow-up).
 *
 * So a group is decomposed against its parent: the suggested parent (or the
 * best available stand-in) is compared with each other member in turn. A group
 * of five becomes four pairs rather than the ten every-combination would give,
 * and each pair carries its own verdict — dismissing one leaves the rest
 * standing.
 */

/**
 * Rank a member as a parent candidate. Higher wins.
 *
 * The parent should be the copy worth keeping, so this prefers the one carrying
 * the user's own work (bookmarks, favorites, tags, campaign links) over any
 * property of the file itself. Between copies that tie, more pages then more
 * bytes break it: a truncated scan loses to the complete one.
 */
export function parentScore(member) {
  if (!member) return -1
  const refs = member.reference_counts || {}
  const refTotal = Object.values(refs).reduce((sum, n) => sum + (n || 0), 0)
  // A missing file can still be the record worth keeping, but never over a
  // present one — you cannot compare pages of a file that is not there.
  const present = member.is_missing ? 0 : 1
  return present * 1e12 + refTotal * 1e9 + (member.page_count || 0) * 1e4 + (member.file_size || 0)
}

/**
 * The member a group should be reviewed against.
 *
 * The scan's own suggestion wins when it is still present in the group, since it
 * saw signals (hash class, filename shape) the client does not have. Otherwise
 * the best-scoring member stands in.
 */
export function pickParent(group) {
  const members = group?.members || []
  if (members.length === 0) return null
  const suggested = members.find((m) => m.id === group.suggested_parent_id)
  if (suggested) return suggested
  return members.reduce((best, m) => (parentScore(m) > parentScore(best) ? m : best), members[0])
}

/**
 * Decompose one group into parent-vs-child pairs.
 *
 * Each pair keeps the group's id, reason, and confidence: those describe the
 * cluster the pair came from, and a pair with no provenance would leave the user
 * guessing why the two files were put in front of them. `pairKey` is stable
 * across reloads so a resolved pair can be tracked without server state.
 */
export function groupToPairs(group) {
  const members = group?.members || []
  if (members.length < 2) return []
  const byId = new Map(members.map((m) => [m.id, m]))

  // Prefer the pairs detection actually found. Union-find clusters
  // transitively, so a group is not a set of mutual duplicates: if D resembles
  // A, B and C while the real duplicate is A-B, reviewing "D versus everything"
  // would invent three pairs that never matched and hide the one that did.
  const edges = (group.edges || []).filter((e) => byId.has(e.a) && byId.has(e.b))

  if (edges.length > 0) {
    return edges.map((edge) => {
      // Orient each pair so the better candidate is the proposed main version;
      // the user can still flip it in the compare view.
      const [a, b] = [byId.get(edge.a), byId.get(edge.b)]
      const parent = parentScore(a) >= parentScore(b) ? a : b
      const child = parent === a ? b : a
      return {
        pairKey: `${group.id}:${parent.id}:${child.id}`,
        groupId: group.id,
        resourceType: group.resource_type,
        reasonText: describeReason(edge.reason) || group.reason_text,
        reasons: edge.reason ? [edge.reason] : group.reasons || [],
        confidence: edge.score ?? group.confidence ?? 0,
        parent,
        child,
      }
    })
  }

  // No edges recorded (a group written before they were persisted): fall back
  // to comparing everything against the best parent, which is still better than
  // showing five files under one verdict.
  const parent = pickParent(group)
  if (!parent) return []
  return members
    .filter((m) => m.id !== parent.id)
    .map((child) => ({
      pairKey: `${group.id}:${parent.id}:${child.id}`,
      groupId: group.id,
      resourceType: group.resource_type,
      reasonText: group.reason_text,
      reasons: group.reasons || [],
      confidence: group.confidence || 0,
      parent,
      child,
    }))
}

// Signal names as the scan records them, for a pair whose own reason is known.
const REASON_TEXT = {
  hash: 'identical files',
  metadata: 'similar title',
  text: 'overlapping text',
  grid: 'gridded/gridless pair',
}

function describeReason(reason) {
  return REASON_TEXT[reason] || ''
}

/** Every group flattened into pairs, in group order. */
export function groupsToPairs(groups) {
  return (groups || []).flatMap(groupToPairs)
}
