import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuLibrary, LuCheck } from 'react-icons/lu'
import { mediaUrl } from '../../api'
import Tag from '../Tag'
import FavoriteButton from '../FavoriteButton'
import LazyImg from '../LazyImg'

/**
 * Game-system card for the library grid. Renders one of three layouts —
 * list row, compact card, or full card — selected by the `list`/`compact` props.
 *
 * In bulk-select mode (`selectable`), clicking the card toggles its selection
 * (with shift / cmd-click modifiers) instead of navigating, and a checkbox is
 * shown. Tags on the full card are clickable to toggle a tag filter via
 * `onTagClick`; `activeTags` highlights the ones currently filtering.
 */
export default function SystemCard({
  system,
  onClick,
  compact,
  list,
  selectable = false,
  selected = false,
  onToggleSelect,
  onTagClick,
  activeTags,
}) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)

  const handleClick = (e) => {
    if (selectable) {
      e.stopPropagation()
      onToggleSelect?.({ shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })
      return
    }
    onClick()
  }

  const checkbox = (overlay) => (
    <div
      style={{
        ...(overlay
          ? { position: 'absolute', top: 8, left: 8, zIndex: 2 }
          : { position: 'static', flexShrink: 0 }),
        width: 20,
        height: 20,
        borderRadius: 4,
        background: selected ? 'var(--gold)' : overlay ? 'rgba(0,0,0,0.55)' : 'transparent',
        border: selected
          ? 'none'
          : overlay
            ? '2px solid rgba(255,255,255,0.45)'
            : '2px solid var(--border-light)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: overlay ? '0 1px 4px rgba(0,0,0,0.4)' : 'none',
      }}
    >
      {selected && <LuCheck size={12} color="var(--bg-deep)" strokeWidth={3} />}
    </div>
  )

  if (list) {
    return (
      <div
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '12px 16px',
          background: selected || hovered ? 'var(--bg-card-hover)' : 'var(--bg-card)',
          border: selected ? '1px solid var(--gold-dim)' : '1px solid var(--border)',
          borderRadius: 8,
          cursor: 'pointer',
          transition: 'background 0.15s',
          position: 'relative',
        }}
      >
        {selectable && checkbox(false)}
        <div
          style={{
            width: 36,
            height: 48,
            borderRadius: 4,
            overflow: 'hidden',
            flexShrink: 0,
            background: 'var(--bg-deep)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {system.cover_book_id ? (
            <LazyImg
              src={mediaUrl(`/books/${system.cover_book_id}/thumbnail`)}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <LuLibrary size={16} color="var(--text-muted)" />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {system.name}
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              display: 'flex',
              gap: 8,
              marginTop: 4,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span>{t('library.bookCount', { count: system.book_count })}</span>
            {system.system_family && <span>· {system.system_family}</span>}
            {(system.genres || []).length > 0 && (
              <span style={{ color: 'var(--green, #5a9a5a)' }}>
                · {(system.genres || []).slice(0, 3).join(', ')}
              </span>
            )}
            {system.is_explicit && <span style={{ color: '#e07070' }}>18+</span>}
          </div>
        </div>
        {!selectable && (
          <FavoriteButton
            type="system"
            id={system.id}
            style={{
              position: 'static',
              background: 'transparent',
              width: 28,
              height: 28,
              flexShrink: 0,
            }}
          />
        )}
      </div>
    )
  }

  if (compact) {
    return (
      <div
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: selected || hovered ? 'var(--bg-card-hover)' : 'var(--bg-card)',
          border: selected ? '1px solid var(--gold-dim)' : '1px solid var(--border)',
          borderRadius: 8,
          cursor: 'pointer',
          transition: 'background 0.15s',
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {selectable ? (
          checkbox(true)
        ) : (
          <FavoriteButton type="system" id={system.id} cardHovered={hovered} />
        )}
        <div
          style={{
            width: '100%',
            height: 110,
            background: 'var(--bg-deep)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {system.cover_book_id ? (
            <LazyImg
              src={mediaUrl(`/books/${system.cover_book_id}/thumbnail`)}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : null}
        </div>
        <div style={{ padding: '8px 10px' }}>
          <div
            style={{
              fontSize: 13,
              color: 'var(--text)',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {system.name}
          </div>
          {system.is_explicit && (
            <div style={{ fontSize: 10, color: '#e07070', marginTop: 2 }}>18+</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: selected || hovered ? 'var(--bg-card-hover)' : 'var(--bg-card)',
        border: selected ? '1px solid var(--gold-dim)' : '1px solid var(--border)',
        borderRadius: 12,
        cursor: 'pointer',
        transition: 'all 0.2s',
        transform: hovered && !selectable ? 'translateY(-2px)' : 'none',
        boxShadow: hovered && !selectable ? '0 8px 24px rgba(0,0,0,0.3)' : 'none',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {selectable && checkbox(true)}
      {system.cover_book_id && (
        <div
          style={{
            width: '100%',
            aspectRatio: '3/4',
            maxHeight: 240,
            background: 'var(--bg-deep)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <LazyImg
            src={mediaUrl(`/books/${system.cover_book_id}/thumbnail`)}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
          />
        </div>
      )}

      {!selectable && <FavoriteButton type="system" id={system.id} cardHovered={hovered} />}
      <div style={{ padding: 20, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 8,
          }}
        >
          <h3 style={{ fontSize: 18, lineHeight: 1.3, flex: 1 }}>{system.name}</h3>
          <div
            style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 10 }}
          >
            {system.is_explicit && (
              <span
                style={{
                  background: 'rgba(180,60,60,0.15)',
                  border: '1px solid rgba(180,60,60,0.4)',
                  borderRadius: 20,
                  padding: '2px 8px',
                  fontSize: 11,
                  color: '#e07070',
                  whiteSpace: 'nowrap',
                }}
              >
                18+
              </span>
            )}
            <span
              style={{
                background: 'var(--bg-deep)',
                borderRadius: 20,
                padding: '2px 10px',
                fontSize: 13,
                color: 'var(--text-dim)',
                whiteSpace: 'nowrap',
              }}
            >
              {t('library.bookCount', { count: system.book_count })}
            </span>
          </div>
        </div>

        {system.description && (
          <p
            style={{
              fontSize: 14,
              color: 'var(--text-dim)',
              marginBottom: 10,
              lineHeight: 1.5,
              fontFamily: 'Alegreya, serif',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {system.description}
          </p>
        )}

        {system.publishers?.length > 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
            {system.publishers.map((p) => p.name).join(', ')}
          </div>
        )}

        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 0, marginTop: 'auto', paddingTop: 8 }}
        >
          {/* Genres are shown before tags (issue #202), in the genre colour. */}
          {(system.genres || []).slice(0, 3).map((g) => (
            <Tag key={`genre-${g}`} label={g} color="rgba(90, 154, 90, 0.2)" />
          ))}
          {(system.tags || []).slice(0, 4).map((tag) =>
            onTagClick && !selectable ? (
              <button
                key={tag}
                onClick={(e) => {
                  e.stopPropagation()
                  onTagClick(tag.toLowerCase())
                }}
                aria-pressed={activeTags?.has(tag.toLowerCase())}
                aria-label={t('library.filterByTag', { tag })}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                <Tag
                  label={tag}
                  color={activeTags?.has(tag.toLowerCase()) ? 'rgba(201,168,76,0.25)' : undefined}
                />
              </button>
            ) : (
              <Tag key={tag} label={tag} />
            )
          )}
        </div>
      </div>
    </div>
  )
}
