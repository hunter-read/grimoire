// Groups embeddable campaign resources for the embed picker's category tabs.
//
// The grouping deliberately mirrors ResourcesPanel: the GM's custom resource
// categories come first (in their saved sort order), then the built-in type
// groups hold whatever is left over, and the campaign's saved
// `resource_group_order` reorders the whole set. A GM who has arranged their
// Resources panel sees the same tabs, in the same order, when embedding.

import type { Schema } from '../../api'
import { TYPE_ICONS } from './resourcesShared'

type EmbedResource = Pick<Schema<'LinkedResourceOut'>, 'resource_type' | 'category_id'>
type EmbedCategory = Pick<Schema<'CampaignCategoryOut'>, 'id' | 'name' | 'sort_order'>

export interface EmbedGroup<R> {
  key: string
  label: string
  items: R[]
}

/**
 * Build the tab groups for a resource list.
 *
 * @param {Array} resources   linked campaign resources
 * @param {Array} categories  the campaign's `resource`-kind categories
 * @param {Array} groupOrder  saved group keys, e.g. ['cat:abc', 'type:book']
 * @param {(type: string) => string} typeLabel  localized label for a type group
 * @returns {Array} `{ key, label, items }`, empty groups dropped
 */
export function buildEmbedGroups<R extends EmbedResource>(
  resources: readonly R[] | null | undefined,
  categories: readonly EmbedCategory[] | null | undefined,
  groupOrder: readonly string[] | null | undefined,
  typeLabel: (type: string) => string
): EmbedGroup<R>[] {
  const items = resources || []
  const cats = categories || []
  const catById = new Map(cats.map((c) => [c.id, c]))

  const groups: EmbedGroup<R>[] = [...cats]
    // Every category the API returns carries a sort_order.
    .sort((a, b) => (a.sort_order as number) - (b.sort_order as number))
    .map((cat) => ({
      key: `cat:${cat.id}`,
      label: cat.name,
      items: items.filter((r) => r.category_id === cat.id),
    }))

  // A resource whose category was deleted falls back to its type group, so
  // nothing can drop out of the picker entirely.
  for (const type of Object.keys(TYPE_ICONS)) {
    groups.push({
      key: `type:${type}`,
      label: typeLabel(type),
      items: items.filter(
        (r) => r.resource_type === type && (!r.category_id || !catById.has(r.category_id))
      ),
    })
  }

  // Groups the GM has explicitly ordered lead, in that order; the rest keep
  // their default relative order behind them.
  const order = groupOrder || []
  const orderIndex = (key: string) => {
    const i = order.indexOf(key)
    return i === -1 ? order.length + groups.findIndex((g) => g.key === key) : i
  }
  groups.sort((a, b) => orderIndex(a.key) - orderIndex(b.key))

  // Unlike the Resources panel, empty groups are dropped — a tab you can select
  // only to find nothing behind it is noise when you're picking something.
  return groups.filter((g) => g.items.length > 0)
}
