import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronRight, LuFileArchive, LuFileText, LuHeart, LuCheck } from 'react-icons/lu'
import { mediaUrl } from '../../api'
import { CATEGORY_ICONS, isArchiveBook } from '../../constants'
import { useFavorites } from '../../context/FavoritesContext'
import { getBookPrefs } from '../../hooks/useBookPrefs'
import FavoriteButton from '../FavoriteButton'
import LazyImg from '../LazyImg'
import BookActionsMenu from './BookActionsMenu'

/**
 * A single book entry. Renders as a list row by default; pass `card` or
 * `compact` for the grid layouts used by the books page view-mode toggle.
 *
 * `bulkMode` shows a selection checkbox and suppresses the per-item actions.
 */
export default function BookRow({
  book,
  onOpen,
  onEdit,
  onDetails,
  editing,
  bulkMode,
  selected,
  onToggle,
  card,
  compact,
}) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const { isFavorite, toggleFavorite } = useFavorites()
  const isArchive = isArchiveBook(book)
  const CatIcon = isArchive ? LuFileArchive : CATEGORY_ICONS[book.category] || LuFileText

  const lastPage = getBookPrefs(book.id).page || 0
  const progress = book.page_count > 0 && lastPage > 1 ? Math.min(lastPage / book.page_count, 1) : 0
  const fav = isFavorite('book', book.id)

  const handleClick = (e) => {
    if (bulkMode) {
      e.stopPropagation()
      onToggle({ shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })
      return
    }
    // Archives have no reader view — open() downloads the file instead.
    if (isArchive) {
      const a = document.createElement('a')
      a.href = mediaUrl(`/books/${book.id}/file`)
      a.download = book.filename || ''
      document.body.appendChild(a)
      a.click()
      a.remove()
      return
    }
    onOpen()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick(e)
    }
  }

  // Overlaid checkbox shown over thumbnails in the grid layouts.
  const overlayCheckbox = bulkMode && (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 8,
        left: 8,
        zIndex: 2,
        width: 20,
        height: 20,
        borderRadius: 4,
        background: selected ? 'var(--gold)' : 'rgba(0,0,0,0.55)',
        border: selected ? 'none' : '2px solid rgba(255,255,255,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
      }}
    >
      {selected && <LuCheck size={12} color="var(--bg-deep)" strokeWidth={3} />}
    </div>
  )

  // List-layout end actions: the always-visible favorite heart, followed by the
  // consolidated actions menu (edit / download / re-scan · re-OCR). The favorite
  // is deliberately prominent; the rest live in the kebab menu (issue #217).
  const listActions = () => (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexShrink: 0 }}>
      <button
        onClick={(e) => {
          e.stopPropagation()
          toggleFavorite('book', book.id)
        }}
        aria-label={fav ? t('common.removeFromFavorites') : t('common.addToFavorites')}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          padding: '6px',
        }}
      >
        <LuHeart
          size={16}
          aria-hidden="true"
          color={fav ? 'var(--gold)' : 'var(--text-muted)'}
          fill={fav ? 'var(--gold)' : 'none'}
        />
      </button>
      <BookActionsMenu book={book} onEdit={onEdit} onDetails={onDetails} editing={editing} />
    </div>
  )

  // ----- Grid layouts (card / compact) -----
  if (card || compact) {
    const thumbHeight = compact ? 110 : 160
    return (
      <div
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-label={t('bookRow.openBook', { title: book.title })}
        aria-pressed={bulkMode ? selected : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: selected ? 'var(--bg-card-hover)' : 'var(--bg-card)',
          border: selected ? '1px solid var(--gold-dim)' : '1px solid var(--border)',
          borderRadius: 8,
          cursor: bulkMode ? 'default' : 'pointer',
          transition: 'border-color 0.15s, background 0.15s',
          position: 'relative',
          overflow: 'hidden',
        }}
        onMouseOver={(e) => {
          if (!bulkMode && !selected) e.currentTarget.style.borderColor = 'var(--border-light)'
        }}
        onMouseOut={(e) => {
          if (!selected) e.currentTarget.style.borderColor = 'var(--border)'
        }}
      >
        {overlayCheckbox}
        {!bulkMode && <FavoriteButton type="book" id={book.id} cardHovered={hovered} />}
        <div
          style={{
            width: '100%',
            height: thumbHeight,
            background: 'var(--bg-deep)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {book.has_thumbnail ? (
            <LazyImg
              src={mediaUrl(`/books/${book.id}/thumbnail`)}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <CatIcon size={28} color="var(--text-muted)" style={{ opacity: 0.4 }} />
          )}
          {progress > 0 && (
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 2,
                background: 'var(--bg-deep)',
              }}
            >
              <div
                style={{
                  width: `${progress * 100}%`,
                  height: '100%',
                  background: 'var(--gold-dim)',
                }}
              />
            </div>
          )}
        </div>
        <div style={{ padding: compact ? '8px 10px' : '10px 12px', minWidth: 0 }}>
          <div
            style={{
              fontSize: compact ? 13 : 15,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {book.title}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 4,
              gap: 6,
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {book.page_count > 0 ? t('bookRow.pages', { count: book.page_count }) : ' '}
            </span>
            {!bulkMode && (
              <BookActionsMenu
                book={book}
                onEdit={onEdit}
                onDetails={onDetails}
                editing={editing}
              />
            )}
          </div>
          {/* Genres on full cards only (not compact). */}
          {!compact && (book.genres || []).length > 0 && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--green, #5a9a5a)',
                marginTop: 3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {(book.genres || []).slice(0, 3).join(', ')}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ----- List layout (default) -----
  return (
    <div
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={t('bookRow.openBook', { title: book.title })}
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
        overflow: 'hidden',
      }}
    >
      {/* Reading progress bar at bottom of card */}
      {progress > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 2,
            background: 'var(--bg-deep)',
          }}
        >
          <div
            style={{
              width: `${progress * 100}%`,
              height: '100%',
              background: 'var(--gold-dim)',
              transition: 'width 0.3s',
            }}
          />
        </div>
      )}

      {bulkMode && (
        <div
          aria-hidden="true"
          style={{
            width: 20,
            height: 20,
            flexShrink: 0,
            borderRadius: 5,
            border: `2px solid ${selected ? 'var(--gold)' : 'var(--text-muted)'}`,
            background: selected ? 'var(--gold)' : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected && <LuCheck size={13} color="var(--bg-deep)" strokeWidth={3} />}
        </div>
      )}

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
        {book.has_thumbnail ? (
          <LazyImg
            src={mediaUrl(`/books/${book.id}/thumbnail`)}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <CatIcon size={16} color="var(--text-muted)" />
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
          {book.title}
        </div>
        <div
          style={{
            fontSize: 13,
            color: 'var(--text-muted)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 4,
            alignItems: 'center',
          }}
        >
          {book.page_count > 0 && <span>{t('bookRow.pages', { count: book.page_count })}</span>}
          {progress > 0 && <span style={{ color: 'var(--gold-dim)' }}>p. {lastPage}</span>}
          {book.year && <span>{book.year}</span>}
          {book.publisher && <span>{book.publisher}</span>}
          {(book.genres || []).length > 0 && (
            <span style={{ color: 'var(--green, #5a9a5a)' }}>
              {(book.genres || []).slice(0, 3).join(', ')}
            </span>
          )}
          {book.is_explicit && (
            <span
              title={t('bookRow.explicitTitle')}
              style={{
                fontSize: 11,
                color: '#e07070',
                background: 'rgba(180,60,60,0.12)',
                padding: '1px 6px',
                borderRadius: 8,
                border: '1px solid rgba(180,60,60,0.35)',
              }}
            >
              {t('bookRow.explicit')}
            </span>
          )}
          {book.is_missing ? (
            <span
              title={t('bookRow.missingTitle')}
              style={{
                fontSize: 11,
                color: '#c8860a',
                background: 'rgba(200,134,10,0.12)',
                padding: '1px 6px',
                borderRadius: 8,
                border: '1px solid rgba(200,134,10,0.4)',
              }}
            >
              {t('bookRow.missingFile')}
            </span>
          ) : (
            <>
              {book.indexed && book.index_error !== 'image-only' && book.index_error !== 'ocr' && (
                <span
                  title={t('bookRow.indexedTitle')}
                  style={{
                    fontSize: 11,
                    color: 'var(--green)',
                    background: 'rgba(90,154,90,0.1)',
                    padding: '1px 6px',
                    borderRadius: 8,
                  }}
                >
                  {t('bookRow.indexed')}
                </span>
              )}
              {book.indexed && book.index_error === 'ocr' && (
                <span
                  title={t('bookRow.ocrIndexedTitle')}
                  style={{
                    fontSize: 11,
                    color: 'var(--green)',
                    background: 'rgba(90,154,90,0.1)',
                    padding: '1px 6px',
                    borderRadius: 8,
                    border: '1px solid rgba(90,154,90,0.35)',
                  }}
                >
                  {t('bookRow.ocrIndexed')}
                </span>
              )}
              {book.indexed && book.index_error === 'image-only' && (
                <span
                  title={t('bookRow.imageOnlyTitle')}
                  style={{
                    fontSize: 11,
                    color: 'var(--muted, #888)',
                    background: 'rgba(128,128,128,0.1)',
                    padding: '1px 6px',
                    borderRadius: 8,
                    border: '1px solid rgba(128,128,128,0.25)',
                  }}
                >
                  {t('bookRow.imageOnly')}
                </span>
              )}
              {book.index_failed && (
                <span
                  title={
                    book.index_error
                      ? t('bookRow.indexFailedWithError', { error: book.index_error })
                      : t('bookRow.indexFailedTitle')
                  }
                  style={{
                    fontSize: 11,
                    color: '#e07070',
                    background: 'rgba(180,60,60,0.12)',
                    padding: '1px 6px',
                    borderRadius: 8,
                    border: '1px solid rgba(180,60,60,0.35)',
                  }}
                >
                  {t('bookRow.indexFailed')}
                </span>
              )}
            </>
          )}
          {(book.tags || []).map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: 11,
                padding: '1px 7px',
                borderRadius: 8,
                background: 'rgba(201,168,76,0.12)',
                border: '1px solid var(--gold-dim)',
                color: 'var(--gold)',
              }}
            >
              {tag.charAt(0).toUpperCase() + tag.slice(1)}
            </span>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
        {!bulkMode && listActions()}
        {!bulkMode && <LuChevronRight size={16} color="var(--text-muted)" aria-hidden="true" />}
      </div>
    </div>
  )
}
