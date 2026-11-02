import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { LuHeart } from 'react-icons/lu'
import { useFavorites } from '../context/FavoritesContext'
import useAsyncAction from '../hooks/useAsyncAction'

export interface FavoriteButtonProps {
  type: string
  id: string
  style?: CSSProperties
  /** When given, the button only shows while the card is hovered or the item is a favorite. */
  cardHovered?: boolean
  /** The item's name, so a screen reader hears which item the heart is for. */
  name?: string
}

export default function FavoriteButton({
  type,
  id,
  style,
  cardHovered,
  name,
}: FavoriteButtonProps) {
  const { t } = useTranslation()
  const { isFavorite, toggleFavorite } = useFavorites()
  const { run, error } = useAsyncAction()
  const active = isFavorite(type, id)
  const visible = cardHovered === undefined ? true : active || cardHovered

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation()
          void run(() => toggleFavorite(type, id))
        }}
        // A failed toggle leaves the heart as it was; the tint and title say why.
        title={error || undefined}
        aria-label={
          name
            ? t(active ? 'a11y.removeFromFavorites' : 'a11y.addToFavorites', { name })
            : t(active ? 'common.removeFromFavorites' : 'common.addToFavorites')
        }
        // Hidden until the card is hovered, but it still takes Tab focus - and
        // must then show itself, or a keyboard user is on an invisible button.
        className="reveal-on-focus"
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
          stroke={error ? 'var(--danger)' : undefined}
        />
      </button>
      {error && (
        <span className="sr-only" role="alert">
          {error}
        </span>
      )}
    </>
  )
}
