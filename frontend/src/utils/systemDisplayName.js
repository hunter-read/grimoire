import { capitalizeWord } from './acronyms'

/**
 * Display name for a game system.
 *
 * Special collections (system-agnostic and one-page/small RPGs) are stored under
 * their raw slug-like folder name (e.g. "one-page-rpgs"). For those we present a
 * prettified label: dashes/underscores become spaces and each word is
 * capitalized ("One Page RPGs"), with well-known acronyms kept in canonical
 * casing. Normal systems keep their stored name untouched.
 */
export function prettifyCollectionName(name) {
  if (!name) return ''
  return name.replace(/[-_]+/g, ' ').trim().split(/\s+/).map(capitalizeWord).join(' ')
}

export function systemDisplayName(system) {
  if (!system) return ''
  if (system.is_system_agnostic || system.is_one_page) {
    return prettifyCollectionName(system.name)
  }
  return system.name
}
