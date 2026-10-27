import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LuHeart } from 'react-icons/lu'
import { useFavorites } from '../context/FavoritesContext'
import FavoritesSection from '../components/favorites/FavoritesSection'
import BulkActionBar from '../components/BulkActionBar'
import BulkToggleButton from '../components/BulkToggleButton'
import SelectableCard from '../components/SelectableCard'
import { useAuth } from '../context/AuthContext'
import useBulkMerge from '../hooks/useBulkMerge'
import useMixedSelection from '../hooks/useMixedSelection'
import BookFavorite from '../components/favorites/BookFavorite'
import MapFavorite from '../components/favorites/MapFavorite'
import TokenFavorite from '../components/favorites/TokenFavorite'
import AudioFavorite from '../components/favorites/AudioFavorite'
import ModelFavorite from '../components/favorites/ModelFavorite'
import SystemFavorite from '../components/favorites/SystemFavorite'
import Tag from '../components/Tag'
import { shouldAutoCollapse } from '../utils/autoCollapse'

type FavoriteItem = NonNullable<ReturnType<typeof useFavorites>>['items'][number]
type FavoriteOf<K extends FavoriteItem['item_type']> = Extract<FavoriteItem, { item_type: K }>

// A filter predicate that also narrows the favorite to its own item shape.
const ofType =
  <K extends FavoriteItem['item_type']>(type: K) =>
  (item: FavoriteItem): item is FavoriteOf<K> =>
    item.item_type === type

const nameOf = (item: FavoriteItem): string => {
  const named = item as { title?: string | null; filename?: string | null }
  return named.title || named.filename || item.item_id
}

// Library items a merge can act on; systems and tags are not.
const SELECTABLE = new Set(['book', 'map', 'token', 'audio', 'model'])

export default function FavoritesView() {
  const { t } = useTranslation()
  const favorites = useFavorites()
  const items = favorites?.items ?? []
  const isAdmin = useAuth()?.user?.role === 'admin'
  // Select mode exists for Merge (issue #589), which is admin-only - so do
  // duplicates noticed while browsing favorites have a way to be resolved.
  const selection = useMixedSelection(
    items
      .filter((i) => SELECTABLE.has(i.item_type))
      .map((i) => ({ type: i.item_type, id: i.item_id }))
  )
  const { bulk } = selection
  const merge = useBulkMerge(selection.selected, (outcome) => {
    selection.forget(outcome.removedIds)
    favorites?.reload()
  })

  // Wraps a section's card so it can be selected in bulk mode.
  const selectable = (item: FavoriteItem, card: ReactNode) => (
    <SelectableCard
      key={item.item_id}
      active={bulk.bulkMode}
      selected={selection.isSelected(item.item_type, item.item_id)}
      label={nameOf(item)}
      onToggle={(mods) => selection.toggle(item.item_type, item.item_id, mods)}
    >
      {card}
    </SelectableCard>
  )

  const systems = items.filter(ofType('system'))
  const books = items.filter(ofType('book'))
  const maps = items.filter(ofType('map'))
  const tokens = items.filter(ofType('token'))
  const audio = items.filter(ofType('audio'))
  const models = items.filter(ofType('model'))
  const tags = items.filter((i) => i.item_type === 'tag')
  // Tags render as a chip row rather than a collapsible section, so only the
  // other sections count towards a long page.
  const sections = [systems, books, maps, tokens, audio, models].filter((l) => l.length > 0)
  const autoCollapse = shouldAutoCollapse(
    sections.reduce((n, l) => n + l.length, 0),
    sections.length
  )

  if (items.length === 0) {
    return (
      <div
        className="fade-in"
        style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}
      >
        <LuHeart size={40} style={{ marginBottom: 16, opacity: 0.3 }} />
        <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>{t('favorites.empty')}</div>
        <div style={{ fontSize: 14 }}>{t('favorites.emptyHint')}</div>
      </div>
    )
  }

  return (
    <div className="fade-in" style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <h2
        style={{
          fontSize: 22,
          fontWeight: 600,
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <LuHeart size={20} fill="var(--gold)" color="var(--gold)" /> {t('favorites.title')}
        {isAdmin && (
          <BulkToggleButton
            active={bulk.bulkMode}
            onToggle={bulk.bulkMode ? bulk.exit : bulk.enter}
            style={{ marginLeft: 'auto' }}
          />
        )}
      </h2>

      {tags.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--text-muted)',
              marginBottom: 12,
            }}
          >
            {t('favorites.tags', { count: tags.length })}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {tags.map((tg) => (
              <Tag key={tg.item_id} label={String(tg.display || tg.internal)} color={undefined} />
            ))}
          </div>
        </section>
      )}

      {systems.length > 0 && (
        <FavoritesSection
          defaultCollapsed={autoCollapse}
          type="system"
          title={t('favorites.systems', { count: systems.length })}
          items={systems}
          renderItem={(item: FavoriteOf<'system'>, grid: boolean) => (
            <SystemFavorite key={item.item_id} item={item} grid={grid} />
          )}
        />
      )}

      {books.length > 0 && (
        <FavoritesSection
          defaultCollapsed={autoCollapse}
          type="book"
          title={t('favorites.books', { count: books.length })}
          items={books}
          renderItem={(item: FavoriteOf<'book'>, grid: boolean) =>
            selectable(item, <BookFavorite item={item} grid={grid} />)
          }
        />
      )}

      {maps.length > 0 && (
        <FavoritesSection
          defaultCollapsed={autoCollapse}
          type="map"
          title={t('favorites.maps', { count: maps.length })}
          items={maps}
          renderItem={(item: FavoriteOf<'map'>, grid: boolean) =>
            selectable(item, <MapFavorite item={item} grid={grid} />)
          }
        />
      )}

      {tokens.length > 0 && (
        <FavoritesSection
          defaultCollapsed={autoCollapse}
          type="token"
          title={t('favorites.tokens', { count: tokens.length })}
          items={tokens}
          renderItem={(item: FavoriteOf<'token'>, grid: boolean) =>
            selectable(item, <TokenFavorite item={item} grid={grid} />)
          }
        />
      )}

      {audio.length > 0 && (
        <FavoritesSection
          defaultCollapsed={autoCollapse}
          type="audio"
          title={t('favorites.audio', { count: audio.length })}
          items={audio}
          renderItem={(item: FavoriteOf<'audio'>, grid: boolean) =>
            selectable(item, <AudioFavorite item={item} grid={grid} />)
          }
        />
      )}

      {models.length > 0 && (
        <FavoritesSection
          defaultCollapsed={autoCollapse}
          type="models"
          title={t('favorites.models', { count: models.length })}
          items={models}
          renderItem={(item: FavoriteOf<'model'>, grid: boolean) =>
            selectable(item, <ModelFavorite item={item} grid={grid} />)
          }
        />
      )}

      {bulk.bulkMode && <BulkActionBar count={bulk.count} {...merge.barProps} onDone={bulk.exit} />}
      {merge.dialog}
    </div>
  )
}
