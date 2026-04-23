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
        border: 'none',
        background: active ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.4)',
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
        color={active ? 'var(--gold)' : 'rgba(255,255,255,0.7)'}
        fill={active ? 'var(--gold)' : 'none'}
      />
    </button>
  )
}
