import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronRight, LuFileText, LuHeart, LuPencil } from 'react-icons/lu'
import { mediaUrl } from '../../api'
import { CATEGORY_ICONS } from '../../constants'
import { useFavorites } from '../../context/FavoritesContext'
import { getBookPrefs } from '../../hooks/useBookPrefs'

export default function BookRow({ book, onOpen, onEdit, editing }) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const { isFavorite, toggleFavorite } = useFavorites()
  const CatIcon = CATEGORY_ICONS[book.category] || LuFileText

  const lastPage = getBookPrefs(book.id).page || 0
  const progress = book.page_count > 0 && lastPage > 1
    ? Math.min(lastPage / book.page_count, 1)
    : 0

  return (
    <div
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      role="button"
      tabIndex={0}
      aria-label={t('bookRow.openBook', { title: book.title })}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px',
        background: hovered ? 'var(--bg-card-hover)' : 'var(--bg-card)',
        border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer',
        transition: 'background 0.15s', position: 'relative', overflow: 'hidden',
      }}
    >
      {/* Reading progress bar at bottom of card */}
      {progress > 0 && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'var(--bg-deep)' }}>
          <div style={{ width: `${progress * 100}%`, height: '100%', background: 'var(--gold-dim)', transition: 'width 0.3s' }} />
        </div>
      )}

      <div style={{
        width: 36, height: 48, borderRadius: 4, overflow: 'hidden', flexShrink: 0,
        background: 'var(--bg-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {book.has_thumbnail
          ? <img src={mediaUrl(`/books/${book.id}/thumbnail`)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <CatIcon size={16} color="var(--text-muted)" />
        }
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {book.title}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4, alignItems: 'center' }}>
          {book.page_count > 0 && <span>{t('bookRow.pages', { count: book.page_count })}</span>}
          {progress > 0 && (
            <span style={{ color: 'var(--gold-dim)' }}>
              p. {lastPage}
            </span>
          )}
          {book.year && <span>{book.year}</span>}
          {book.publisher && <span>{book.publisher}</span>}
          {book.is_explicit && (
            <span title={t('bookRow.explicitTitle')} style={{ fontSize: 11, color: '#e07070', background: 'rgba(180,60,60,0.12)', padding: '1px 6px', borderRadius: 8, border: '1px solid rgba(180,60,60,0.35)' }}>
              {t('bookRow.explicit')}
            </span>
          )}
          {book.is_missing ? (
            <span title={t('bookRow.missingTitle')} style={{ fontSize: 11, color: '#c8860a', background: 'rgba(200,134,10,0.12)', padding: '1px 6px', borderRadius: 8, border: '1px solid rgba(200,134,10,0.4)' }}>
              {t('bookRow.missingFile')}
            </span>
          ) : (
            <>
              {book.indexed && (
                <span title={t('bookRow.indexedTitle')} style={{ fontSize: 11, color: 'var(--green)', background: 'rgba(90,154,90,0.1)', padding: '1px 6px', borderRadius: 8 }}>
                  {t('bookRow.indexed')}
                </span>
              )}
              {book.index_failed && (
                <span title={book.index_error ? t('bookRow.indexFailedWithError', { error: book.index_error }) : t('bookRow.indexFailedTitle')} style={{ fontSize: 11, color: '#e07070', background: 'rgba(180,60,60,0.12)', padding: '1px 6px', borderRadius: 8, border: '1px solid rgba(180,60,60,0.35)' }}>
                  {t('bookRow.indexFailed')}
                </span>
              )}
            </>
          )}
          {(book.tags || []).map(tag => (
            <span key={tag} style={{ fontSize: 11, padding: '1px 7px', borderRadius: 8, background: 'rgba(201,168,76,0.12)', border: '1px solid var(--gold-dim)', color: 'var(--gold)' }}>
              {tag.charAt(0).toUpperCase() + tag.slice(1)}
            </span>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        {onEdit && (
          <button
            onClick={e => { e.stopPropagation(); onEdit() }}
            aria-label={t('bookRow.editBook')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: '8px 4px', margin: '-8px 0', color: editing ? 'var(--gold)' : 'var(--text-muted)' }}
          >
            <LuPencil size={14} aria-hidden="true" />
          </button>
        )}
        <button
          onClick={e => { e.stopPropagation(); toggleFavorite('book', book.id) }}
          aria-label={isFavorite('book', book.id) ? t('common.removeFromFavorites') : t('common.addToFavorites')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: '8px 10px', margin: '-8px -4px' }}
        >
          <LuHeart
            size={16}
            aria-hidden="true"
            color={isFavorite('book', book.id) ? 'var(--gold)' : 'var(--text-muted)'}
            fill={isFavorite('book', book.id) ? 'var(--gold)' : 'none'}
          />
        </button>
        <LuChevronRight size={16} color="var(--text-muted)" aria-hidden="true" />
      </div>
    </div>
  )
}
