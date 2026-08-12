import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuArrowLeft, LuDownload, LuHeart } from 'react-icons/lu'
import { mediaUrl } from '../../api'
import { useFavorites } from '../../context/FavoritesContext'
import AddToCampaignButton from '../campaigns/AddToCampaignButton'

const btnStyle = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  borderRadius: 4,
  padding: '4px 8px',
  display: 'flex',
  alignItems: 'center',
  cursor: 'pointer',
}

/** Viewer for single-image "books" (e.g. a one-page handout) — no paging. */
export default function ImageBookViewer({ book, bookId, backPath }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isFavorite, toggleFavorite } = useFavorites()

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 20px',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        <button
          onClick={() => (backPath ? navigate(backPath) : navigate(-1))}
          aria-label={t('reader.back')}
          style={{
            background: 'none',
            color: 'var(--text-dim)',
            fontSize: 15,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <LuArrowLeft size={15} /> {t('reader.back')}
        </button>
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <span
          style={{
            fontSize: 16,
            fontWeight: 500,
            color: 'var(--text)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {book.title}
        </span>
        <button
          onClick={() => toggleFavorite('book', bookId)}
          title={
            isFavorite('book', bookId)
              ? t('reader.removeFromFavorites')
              : t('reader.addToFavorites')
          }
          style={{
            ...btnStyle,
            color: isFavorite('book', bookId) ? 'var(--gold)' : 'var(--text-muted)',
          }}
        >
          <LuHeart size={14} fill={isFavorite('book', bookId) ? 'var(--gold)' : 'none'} />
        </button>
        <AddToCampaignButton resourceType="book" resourceId={bookId} />
        <a
          href={mediaUrl(`/books/${bookId}/file`)}
          download
          title={t('reader.downloadFile')}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            color: 'var(--text-dim)',
            borderRadius: 4,
            padding: '4px 12px',
            fontSize: 14,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <LuDownload size={13} />
        </a>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-deep)',
          padding: 20,
        }}
      >
        <img
          src={mediaUrl(`/books/${bookId}/file`)}
          alt={book.title}
          style={{
            maxHeight: '100%',
            maxWidth: '100%',
            width: 'auto',
            borderRadius: 4,
            boxShadow: '0 4px 20px var(--shadow)',
          }}
        />
      </div>
    </div>
  )
}
