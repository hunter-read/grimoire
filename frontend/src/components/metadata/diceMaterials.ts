// Default dice / materials options for a game system, grouped for the picker.
// Groups are display-only (unselectable); their items are selectable values.
// User-entered values that aren't in any default group are shown under "Custom".

export const DICE_MATERIAL_GROUPS = [
  {
    key: 'dice',
    label: 'Dice',
    items: ['D4', 'D6', 'D8', 'D10', 'D12', 'D20', 'D100', 'Custom (System specific)'],
  },
  {
    key: 'cards',
    label: 'Cards',
    items: ['Playing Cards', 'Tarot Cards', 'Custom Deck'],
  },
  {
    key: 'other',
    label: 'Other',
    items: ['Tumbling Tower (Jenga Tower)', 'Candles', 'Poker Chips', 'Timers', 'Phone'],
  },
]

// Flat set of all default item values (lowercased) for "is this custom?" checks.
const DEFAULT_VALUES = new Set(
  DICE_MATERIAL_GROUPS.flatMap((g) => g.items.map((i) => i.toLowerCase()))
)

export function isDefaultDiceMaterial(value) {
  return DEFAULT_VALUES.has(String(value).trim().toLowerCase())
}

// Canonical group ordering for managed items; unknown groups come after these.
const GROUP_ORDER = ['Dice', 'Cards', 'Other', 'Custom']

/**
 * Convert the managed dice/materials lookup rows ([{name, group}]) into the same
 * grouped shape as DICE_MATERIAL_GROUPS. Groups are ordered Dice → Cards → Other
 * → Custom, then any unexpected groups alphabetically.
 */
export function groupsFromManaged(items = []) {
  const byGroup = new Map()
  for (const item of items) {
    const group = (item.group || 'Custom').trim() || 'Custom'
    if (!byGroup.has(group)) byGroup.set(group, [])
    byGroup.get(group).push(item.name)
  }
  const groupNames = [...byGroup.keys()].sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a)
    const bi = GROUP_ORDER.indexOf(b)
    if (ai !== -1 || bi !== -1) return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi)
    return a.localeCompare(b)
  })
  return groupNames.map((name) => ({
    key: name.toLowerCase(),
    label: name,
    items: byGroup.get(name),
  }))
}

/**
 * Build the flat, group-ordered option list for the picker. Each entry is
 * either { type: 'group', label } (unselectable header) or
 * { type: 'item', value, groupKey }. Selected values not present in any group
 * are appended under a trailing "Custom" group so they can be seen/removed.
 *
 * @param selected currently selected values (to surface custom ones)
 * @param customGroupLabel localized label for the trailing custom group
 * @param groups group definitions to build from; defaults to the built-in list.
 *   Pass `groupsFromManaged(lookupRows)` to source from the managed table.
 */
export function buildDiceMaterialRows(
  selected = [],
  customGroupLabel = 'Custom',
  groups = DICE_MATERIAL_GROUPS
) {
  const rows = []
  const known = new Set()
  for (const g of groups) {
    rows.push({ type: 'group', label: g.label, key: g.key })
    for (const item of g.items) {
      rows.push({ type: 'item', value: item, groupKey: g.key })
      known.add(String(item).trim().toLowerCase())
    }
  }
  const customs = selected.filter((v) => !known.has(String(v).trim().toLowerCase()))
  if (customs.length) {
    rows.push({ type: 'group', label: customGroupLabel, key: '__custom__' })
    for (const value of customs) rows.push({ type: 'item', value, groupKey: '__custom__' })
  }
  return rows
}
