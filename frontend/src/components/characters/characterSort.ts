// How the Characters page orders its list (issue #686).
import type { Schema } from '../../api'
import { getUserPrefs, saveUserPref, type UserPrefs } from '../../hooks/useUserPrefs'
import { isActive } from './characterStatus'

type CharacterSummary = Schema<'CharacterSummary'>

export type CharacterSort = 'updated' | 'name' | 'name-desc' | 'system' | 'sheet'

export const CHARACTER_SORTS: CharacterSort[] = ['updated', 'name', 'name-desc', 'system', 'sheet']

export const CHARACTER_SORT_LABELS: Record<CharacterSort, string> = {
  updated: 'characters.sortUpdated',
  name: 'characters.sortNameAsc',
  'name-desc': 'characters.sortNameDesc',
  system: 'characters.sortSystem',
  sheet: 'characters.sortSheet',
}

const PREF_KEY = 'characterSort'

/** The remembered sort, defaulting to most recently updated as the list always was. */
export function getCharacterSort(prefs: UserPrefs = getUserPrefs()): CharacterSort {
  const stored = prefs[PREF_KEY]
  return (CHARACTER_SORTS as unknown[]).includes(stored) ? (stored as CharacterSort) : 'updated'
}

export function saveCharacterSort(sort: CharacterSort): void {
  saveUserPref(PREF_KEY, sort)
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

// Blank sorts last whichever way the list runs: an untitled character or one
// with no system is the least useful thing to lead with.
function blanksLast(a: string, b: string): number {
  return Number(!a) - Number(!b)
}

function byText(a: string, b: string): number {
  return blanksLast(a, b) || collator.compare(a, b)
}

/**
 * Dotted versions compared part by part as numbers, so 1.10.0 is newer than
 * 1.9.0. A part that isn't a number (a pre-release tag) compares as text.
 */
export function compareVersions(a: string, b: string): number {
  const left = a.split(/[.+-]/)
  const right = b.split(/[.+-]/)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const [x = '0', y = '0'] = [left[i], right[i]]
    const nx = Number(x)
    const ny = Number(y)
    const diff = Number.isNaN(nx) || Number.isNaN(ny) ? collator.compare(x, y) : nx - ny
    if (diff) return diff
  }
  return 0
}

const sheetName = (c: CharacterSummary) => c.schema_name || c.schema_ref
const byActive = (a: CharacterSummary, b: CharacterSummary) =>
  Number(!isActive(a)) - Number(!isActive(b))
const byName = (a: CharacterSummary, b: CharacterSummary) => byText(a.name, b.name)

const COMPARATORS: Record<CharacterSort, (a: CharacterSummary, b: CharacterSummary) => number> = {
  // The server sends the list most recently updated first; the sort is stable,
  // so that order survives within each group.
  updated: byActive,
  name: (a, b) => byActive(a, b) || byName(a, b),
  'name-desc': (a, b) => byActive(a, b) || blanksLast(a.name, b.name) || byName(b, a),
  // System leads, so each system's characters sit together under one heading;
  // within it the ones being played still come first.
  system: (a, b) => byText(a.system ?? '', b.system ?? '') || byActive(a, b) || byName(a, b),
  // Newest sheet version first, so the characters left on an older one gather
  // at the end of their sheet's run.
  sheet: (a, b) =>
    byActive(a, b) ||
    byText(sheetName(a), sheetName(b)) ||
    blanksLast(a.schema_version ?? '', b.schema_version ?? '') ||
    compareVersions(b.schema_version ?? '', a.schema_version ?? '') ||
    byName(a, b),
}

/**
 * The list in `sort` order. Characters still being played lead and retired or
 * fallen ones follow, whatever the sort - except by system, where that holds
 * within each system.
 */
export function sortCharacters(list: CharacterSummary[], sort: CharacterSort): CharacterSummary[] {
  return [...list].sort(COMPARATORS[sort])
}

/** Runs of characters sharing a system, in list order: the "System" sort's headings. */
export function groupBySystem(
  list: CharacterSummary[]
): { system: string; characters: CharacterSummary[] }[] {
  const groups: { system: string; characters: CharacterSummary[] }[] = []
  for (const character of list) {
    const system = character.system ?? ''
    const last = groups[groups.length - 1]
    if (last && last.system === system) last.characters.push(character)
    else groups.push({ system, characters: [character] })
  }
  return groups
}
