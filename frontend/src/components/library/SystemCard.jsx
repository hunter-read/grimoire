import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuLibrary } from 'react-icons/lu'
import { mediaUrl } from '../../api'
import Tag from '../Tag'
import FavoriteButton from '../FavoriteButton'

/**
 * Game-system card for the library grid. Renders one of three layouts —
 * list row, compact card, or full card — selected by the `list`/`compact` props.
 */
export default function SystemCard({ system, onClick, compact, list }) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)

  if (list) {
    return (
      <div
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '12px 16px',
          background: hovered ? 'var(--bg-card-hover)' : 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          cursor: 'pointer',
          transition: 'background 0.15s',
          position: 'relative',
        }}
      >
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
            <img
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
            }}
          >
            <span>{t('library.bookCount', { count: system.book_count })}</span>
            {system.is_explicit && <span style={{ color: '#e07070' }}>18+</span>}
          </div>
        </div>
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
      </div>
    )
  }

  if (compact) {
    return (
      <div
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: hovered ? 'var(--bg-card-hover)' : 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          cursor: 'pointer',
          transition: 'background 0.15s',
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <FavoriteButton type="system" id={system.id} cardHovered={hovered} />
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
            <img
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
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'var(--bg-card-hover)' : 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        cursor: 'pointer',
        transition: 'all 0.2s',
        transform: hovered ? 'translateY(-2px)' : 'none',
        boxShadow: hovered ? '0 8px 24px rgba(0,0,0,0.3)' : 'none',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
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
          <img
            src={mediaUrl(`/books/${system.cover_book_id}/thumbnail`)}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
          />
        </div>
      )}

      <FavoriteButton type="system" id={system.id} cardHovered={hovered} />
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
          {(system.tags || []).slice(0, 4).map((tag) => (
            <Tag key={tag} label={tag} />
          ))}
        </div>
      </div>
    </div>
  )
}
