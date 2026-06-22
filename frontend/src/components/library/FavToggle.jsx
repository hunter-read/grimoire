import { useTranslation } from 'react-i18next'
import { LuHeart } from 'react-icons/lu'

/** "Favorites only" toggle button for the library header. */
export default function FavToggle({ active, onClick }) {
  const { t } = useTranslation()
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={t('favorites.onlyFavorites')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: active ? 'rgba(180,120,60,0.15)' : 'var(--bg-card)',
        color: active ? 'var(--gold)' : 'var(--text-muted)',
        fontSize: 13,
        cursor: 'pointer',
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      <LuHeart size={14} fill={active ? 'var(--gold)' : 'none'} />
      {t('favorites.onlyFavorites')}
    </button>
  )
}
