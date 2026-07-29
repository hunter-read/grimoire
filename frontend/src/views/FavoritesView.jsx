import { useTranslation } from 'react-i18next'
import { LuHeart } from 'react-icons/lu'
import { useFavorites } from '../context/FavoritesContext'
import FavoritesSection from '../components/favorites/FavoritesSection'
import BookFavorite from '../components/favorites/BookFavorite'
import MapFavorite from '../components/favorites/MapFavorite'
import TokenFavorite from '../components/favorites/TokenFavorite'
import AudioFavorite from '../components/favorites/AudioFavorite'
import SystemFavorite from '../components/favorites/SystemFavorite'
import Tag from '../components/Tag'

export default function FavoritesView() {
  const { t } = useTranslation()
  const { items } = useFavorites()

  const systems = items.filter((i) => i.item_type === 'system')
  const books = items.filter((i) => i.item_type === 'book')
  const maps = items.filter((i) => i.item_type === 'map')
  const tokens = items.filter((i) => i.item_type === 'token')
  const audio = items.filter((i) => i.item_type === 'audio')
  const tags = items.filter((i) => i.item_type === 'tag')

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
              <Tag key={tg.item_id} label={tg.display || tg.internal} />
            ))}
          </div>
        </section>
      )}

      {systems.length > 0 && (
        <FavoritesSection
          type="system"
          title={t('favorites.systems', { count: systems.length })}
          items={systems}
          renderItem={(item, grid) => <SystemFavorite key={item.item_id} item={item} grid={grid} />}
        />
      )}

      {books.length > 0 && (
        <FavoritesSection
          type="book"
          title={t('favorites.books', { count: books.length })}
          items={books}
          renderItem={(item, grid) => <BookFavorite key={item.item_id} item={item} grid={grid} />}
        />
      )}

      {maps.length > 0 && (
        <FavoritesSection
          type="map"
          title={t('favorites.maps', { count: maps.length })}
          items={maps}
          renderItem={(item, grid) => <MapFavorite key={item.item_id} item={item} grid={grid} />}
        />
      )}

      {tokens.length > 0 && (
        <FavoritesSection
          type="token"
          title={t('favorites.tokens', { count: tokens.length })}
          items={tokens}
          renderItem={(item, grid) => <TokenFavorite key={item.item_id} item={item} grid={grid} />}
        />
      )}

      {audio.length > 0 && (
        <FavoritesSection
          type="audio"
          title={t('favorites.audio', { count: audio.length })}
          items={audio}
          renderItem={(item, grid) => <AudioFavorite key={item.item_id} item={item} grid={grid} />}
        />
      )}
    </div>
  )
}
