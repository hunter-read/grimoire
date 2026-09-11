import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuBan, LuHeart, LuSearch } from 'react-icons/lu'

import { useFavorites } from '../../../context/FavoritesContext'
import ColorSwatchRow from './ColorSwatchRow'
import FrameGroup from './FrameGroup'
import FrameTile from './FrameTile'
import { frameIsRecolourable, frameLabel, frameUrl, groupFrames, matchesFrameQuery } from './frames'

// Height the colour row occupies, reserved whether or not it is showing. The
// row only applies to the recolourable generic shapes, and letting it appear
// and vanish as the selection moved shoved the whole frame list up and down
// under the pointer — so the space is always there and only its contents change.
const COLOR_ROW_HEIGHT = 58

/**
 * The frame gallery.
 *
 * Tiles sit on a checkerboard rather than the panel colour: a gold ring on a
 * dark panel and the same ring on white read completely differently, and the
 * checkerboard also says "the middle of this is transparent" without a caption.
 *
 * A library can hold hundreds of frames across many folders, so the list scrolls
 * inside its own box rather than growing the page, groups collapse, and a search
 * filters by name. The built-ins and the favourites stay outside the scroll box:
 * they are the short, always-relevant part of the list, and pushing them into a
 * scroller would hide the three frames every library has.
 */

export default function FramePicker({
  frames,
  value,
  onChange,
  color,
  onColorChange,
  scroll = true,
  loading = false,
}) {
  const { t } = useTranslation()
  const favorites = useFavorites()
  const isFavorite = favorites?.isFavorite
  const [query, setQuery] = useState('')
  // Collapsed groups by key. Absent means expanded — a fresh picker shows
  // everything, and only what the user has actually closed stays closed.
  const [collapsed, setCollapsed] = useState({})

  const groups = useMemo(() => groupFrames(frames || []), [frames])
  const builtins = useMemo(() => groups.filter((g) => g.builtin).flatMap((g) => g.frames), [groups])
  const userGroups = useMemo(() => groups.filter((g) => !g.builtin), [groups])

  // Favourites are shown *in addition to* their folder, not moved out of it:
  // a user who knows a frame lives in "Fantasy Frames" should still find it
  // there. A frame is favourited by starring its token in the gallery, so this
  // reads the same favourites the rest of the app uses (see `attach_token_ids`).
  const favoriteFrames = useMemo(() => {
    if (!isFavorite) return []
    return userGroups
      .flatMap((g) => g.frames)
      .filter((f) => f.token_id && isFavorite('token', f.token_id))
  }, [userGroups, isFavorite])

  const filter = (list) => list.filter((f) => matchesFrameQuery(f, query, t))
  const filteredFavorites = filter(favoriteFrames)
  const visibleGroups = userGroups
    .map((g) => ({ ...g, frames: filter(g.frames) }))
    .filter((g) => g.frames.length > 0)

  const hasUserFrames = userGroups.some((g) => g.frames.length > 0)
  const nothingMatched = query.trim() !== '' && visibleGroups.length === 0

  const toggle = (key) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))

  const renderTile = (frame) => (
    <FrameTile
      key={frame.id}
      selected={value === frame.id}
      label={frameLabel(frame, t)}
      onClick={() => onChange(frame.id)}
    >
      <img
        src={frameUrl(frame, color)}
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    </FrameTile>
  )

  return (
    // A flex column filling whatever the settings sidebar has left, so the frame
    // list below can take the remaining height instead of a fixed 320px. When
    // the layout is stacked the page scrolls instead, so this just grows.
    <div
      style={
        scroll ? { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } : undefined
      }
    >
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{t('tokenEditor.frame')}</div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <FrameTile
          selected={!value}
          label={t('tokenEditor.noFrame')}
          onClick={() => onChange(null)}
        >
          <LuBan size={18} aria-hidden="true" />
        </FrameTile>
        {builtins.map(renderTile)}
      </div>

      {/* Sits with the frames it recolours rather than up among the output
          controls, and holds its space when it does not apply — only the
          generic shapes respond to a colour, since the themed frames carry
          their own identity colour as part of telling them apart. Clearing the
          colour keeps the shape as the crop but draws no ring, which is how a
          plain circular or square token is made now that the redundant Shape
          control is gone. */}
      <div style={{ minHeight: COLOR_ROW_HEIGHT, marginBottom: 10 }}>
        {frameIsRecolourable(value) && onColorChange && (
          <ColorSwatchRow
            label={t('tokenEditor.frameColor')}
            value={color}
            onChange={onColorChange}
            allowNone
            noneLabel={t('tokenEditor.frameColorNone')}
          />
        )}
      </div>

      {/* The search only ever filters library frames, so it appears only once
          there are some to filter — on a stock library it would be a control
          that can do nothing. */}
      {hasUserFrames && (
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <LuSearch
            size={13}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('tokenEditor.searchFrames')}
            aria-label={t('tokenEditor.searchFrames')}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '6px 8px 6px 26px',
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--bg-deep)',
              color: 'var(--text)',
            }}
          />
        </div>
      )}

      {/* Scrolls internally rather than growing the page: a few hundred frames
          would otherwise run the settings column far past the canvas, and the
          page-level scrollbar appearing and disappearing as groups collapse
          reflowed the whole centred layout. */}
      {hasUserFrames && (
        <div
          style={
            scroll
              ? {
                  flex: 1,
                  minHeight: 160,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  paddingRight: 2,
                }
              : undefined
          }
        >
          {filteredFavorites.length > 0 && (
            <FrameGroup
              label={t('tokenEditor.favoriteFrames')}
              icon={<LuHeart size={11} aria-hidden="true" />}
              open={!collapsed.__favorites}
              onToggle={() => toggle('__favorites')}
            >
              {filteredFavorites.map((frame) => renderTile({ ...frame, id: frame.id }))}
            </FrameGroup>
          )}

          {visibleGroups.map((group) => (
            <FrameGroup
              key={group.key}
              label={group.label || t('tokenEditor.libraryFrames')}
              open={!collapsed[group.key]}
              onToggle={() => toggle(group.key)}
            >
              {group.frames.map(renderTile)}
            </FrameGroup>
          ))}

          {nothingMatched && (
            <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '4px 0 0' }}>
              {t('tokenEditor.noFramesMatch', { query: query.trim() })}
            </p>
          )}
        </div>
      )}

      {!loading && !hasUserFrames && (
        <p style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5, margin: 0 }}>
          {t('tokenEditor.customFramesHint')}
        </p>
      )}
    </div>
  )
}
