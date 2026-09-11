import { useTranslation } from 'react-i18next'
import { LuHeart } from 'react-icons/lu'
import { useFavorites } from '../context/FavoritesContext'

/**
 * Favourite toggle for a media item's detail page. FavoriteButton is an
 * absolutely-positioned disc meant to float over card art, so it cannot sit in
 * a detail view's toolbar; this one is styled like AddToCampaignButton and its
 * neighbours there instead.
 */
export default function DetailFavoriteButton({ type, id, compact, style }) {
  const { t } = useTranslation()
  // `useFavorites()` is null outside a provider, so read through it rather than
  // destructuring — these detail views also render in contexts without one.
  const favorites = useFavorites()
  const isFavorite = favorites?.isFavorite
  const toggleFavorite = favorites?.toggleFavorite
  const active = isFavorite?.(type, id) ?? false
  const label = active ? t('common.removeFromFavorites') : t('common.addToFavorites')

  return (
    <button
      onClick={() => toggleFavorite?.(type, id)}
      title={label}
      aria-label={label}
      aria-pressed={active}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        color: active ? 'var(--gold)' : 'var(--text-dim)',
        borderRadius: 4,
        padding: '4px 10px',
        fontSize: 14,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        cursor: 'pointer',
        ...style,
      }}
    >
      <LuHeart size={13} fill={active ? 'var(--gold)' : 'none'} />
      {!compact && label}
    </button>
  )
}
