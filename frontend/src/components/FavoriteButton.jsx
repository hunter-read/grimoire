import { useTranslation } from 'react-i18next'
import { LuHeart } from 'react-icons/lu'
import { useFavorites } from '../context/FavoritesContext'

export default function FavoriteButton({ type, id, style, cardHovered }) {
  const { t } = useTranslation()
  const { isFavorite, toggleFavorite } = useFavorites()
  const active = isFavorite(type, id)
  const visible = cardHovered === undefined ? true : active || cardHovered

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        toggleFavorite(type, id)
      }}
      aria-label={active ? t('common.removeFromFavorites') : t('common.addToFavorites')}
      style={{
        position: 'absolute',
        top: 6,
        right: 6,
        zIndex: 3,
        width: 28,
        height: 28,
        borderRadius: '50%',
        // A themed disc, not a fixed dark scrim: the button sits on cover art
        // so it needs its own backing, but a dark one puts the gold heart at
        // 1.5:1 on a light theme. Panel-coloured with a border reads on both.
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        boxShadow: `0 1px 3px var(--shadow)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'background 0.15s, opacity 0.15s',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        ...style,
      }}
    >
      <LuHeart
        size={16}
        color={active ? 'var(--gold)' : 'var(--text-dim)'}
        fill={active ? 'var(--gold)' : 'none'}
      />
    </button>
  )
}
