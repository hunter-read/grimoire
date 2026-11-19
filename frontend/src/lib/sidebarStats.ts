/**
 * The library stats the sidebar can show, and which ones it does.
 *
 * Mirrors backend/services/sidebar_stats.py: a layout is an ordered list of up
 * to {@link MAX_SIDEBAR_STATS} `/api/stats` fields. A user's own layout wins;
 * without one the sidebar follows the admin's default (`sidebar_stats` on
 * /settings/ui), and before that has loaded, the older `show_stat_*` flags.
 */
import type { TFunction } from 'i18next'
import type { Schema } from '../api'

export const MAX_SIDEBAR_STATS = 10

/** Every stat a layout may name, in the order the picker lists them. */
export const STAT_IDS = [
  'game_systems',
  'ttrpg_systems',
  'wargame_systems',
  'books',
  'ttrpg_books',
  'wargame_books',
  'total_pages',
  'ttrpg_pages',
  'wargame_pages',
  'indexed_books',
  'maps',
  'tokens',
  'audio',
  'models',
  'book_variants',
  'map_variants',
  'token_variants',
  'model_variants',
  'audio_variants',
  'total_size_mb',
  'ttrpg_size_mb',
  'wargame_size_mb',
  'maps_size_mb',
  'tokens_size_mb',
  'models_size_mb',
  'audio_size_mb',
  'library_size_mb',
] as const

export type StatId = (typeof STAT_IDS)[number]

export const STAT_LABEL_KEYS: Record<StatId, string> = {
  game_systems: 'stats.systems',
  ttrpg_systems: 'stats.ttrpgSystems',
  wargame_systems: 'stats.wargameSystems',
  books: 'stats.books',
  ttrpg_books: 'stats.ttrpgBooks',
  wargame_books: 'stats.wargameBooks',
  total_pages: 'stats.pages',
  ttrpg_pages: 'stats.ttrpgPages',
  wargame_pages: 'stats.wargamePages',
  indexed_books: 'stats.indexedBooks',
  maps: 'stats.maps',
  tokens: 'stats.tokens',
  audio: 'stats.audio',
  models: 'stats.models',
  book_variants: 'stats.bookVariants',
  map_variants: 'stats.mapVariants',
  token_variants: 'stats.tokenVariants',
  model_variants: 'stats.modelVariants',
  audio_variants: 'stats.audioVariants',
  total_size_mb: 'stats.booksSize',
  ttrpg_size_mb: 'stats.ttrpgSize',
  wargame_size_mb: 'stats.wargameSize',
  maps_size_mb: 'stats.mapsSize',
  tokens_size_mb: 'stats.tokensSize',
  models_size_mb: 'stats.modelsSize',
  audio_size_mb: 'stats.audioSize',
  library_size_mb: 'stats.librarySize',
}

/** The picker's groups, each a column of checkboxes. Every stat is in one. */
export const STAT_GROUPS: readonly { labelKey: string; stats: readonly StatId[] }[] = [
  { labelKey: 'stats.systems', stats: ['game_systems', 'ttrpg_systems', 'wargame_systems'] },
  { labelKey: 'stats.books', stats: ['books', 'ttrpg_books', 'wargame_books', 'indexed_books'] },
  { labelKey: 'stats.pages', stats: ['total_pages', 'ttrpg_pages', 'wargame_pages'] },
  { labelKey: 'stats.groupCollections', stats: ['maps', 'tokens', 'models', 'audio'] },
  {
    labelKey: 'stats.variants',
    stats: ['book_variants', 'map_variants', 'token_variants', 'model_variants', 'audio_variants'],
  },
  {
    labelKey: 'stats.groupSizes',
    stats: [
      'total_size_mb',
      'ttrpg_size_mb',
      'wargame_size_mb',
      'maps_size_mb',
      'tokens_size_mb',
      'models_size_mb',
      'audio_size_mb',
      'library_size_mb',
    ],
  },
]

/** The flags the sidebar used before layouts, in the order it drew them. */
const LEGACY_FLAGS = [
  ['show_stat_systems', 'game_systems', true],
  ['show_stat_books', 'books', false],
  ['show_stat_pages', 'total_pages', true],
  ['show_stat_maps', 'maps', false],
  ['show_stat_tokens', 'tokens', false],
  ['show_stat_audio', 'audio', false],
  ['show_stat_models', 'models', false],
  ['show_stat_size', 'total_size_mb', true],
  ['show_stat_library_size', 'library_size_mb', false],
] as const

export const isStatId = (value: unknown): value is StatId =>
  typeof value === 'string' && (STAT_IDS as readonly string[]).includes(value)

/** Keep only the stats this release knows, once each, up to the maximum. */
export function cleanLayout(layout: readonly unknown[]): StatId[] {
  return [...new Set(layout.filter(isStatId))].slice(0, MAX_SIDEBAR_STATS)
}

/** The admin's default layout, from /settings/ui. */
export function defaultLayout(uiSettings: Partial<Schema<'UISettingsResponse'>>): StatId[] {
  if (Array.isArray(uiSettings.sidebar_stats)) return cleanLayout(uiSettings.sidebar_stats)
  return LEGACY_FLAGS.filter(([flag, , fallback]) => uiSettings[flag] ?? fallback).map(
    ([, stat]) => stat
  )
}

/** What the sidebar shows: the user's own layout, else the default. */
export function resolveLayout(
  userLayout: readonly unknown[] | null | undefined,
  uiSettings: Partial<Schema<'UISettingsResponse'>>
): StatId[] {
  return Array.isArray(userLayout) ? cleanLayout(userLayout) : defaultLayout(uiSettings)
}

export const isSizeStat = (id: StatId) => id.endsWith('_size_mb')

/** Megabytes, rolled over to GB once the number stops reading well. */
export function formatSize(t: TFunction, raw?: number | null): string {
  const mb = raw || 0
  return mb >= 1024
    ? t('common.sizeGB', { size: (mb / 1024).toFixed(2) })
    : t('common.sizeMB', { size: mb })
}

/** One stat's value as the sidebar shows it. */
export function formatStat(t: TFunction, stats: Schema<'StatsResponse'>, id: StatId): string {
  const value = stats[id]
  if (isSizeStat(id)) return formatSize(t, value)
  return (value ?? 0).toLocaleString()
}
