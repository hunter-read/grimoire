import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuExternalLink, LuX } from 'react-icons/lu'
import { mediaUrl } from '../../api'
import { formatSize } from '../../utils'
import LazyImg from '../LazyImg'
import Tag from '../Tag'
import { publicationDate } from './bookDetails'

/**
 * Read-only view of everything Grimoire knows about a book.
 *
 * The row shows a title and little else, and the editor is a form rather than
 * something you'd read. This is the "what is this file, actually" view —
 * cover, the metadata that's set, and where it lives on disk.
 *
 * Fields with no value are omitted rather than rendered blank, so a sparsely
 * tagged book reads as short instead of mostly-empty.
 *
 * Props:
 *   book    – the book, in the serialized API shape
 *   onClose – () => void
 */
export default function BookDetailsModal({ book, onClose }) {
  const { t } = useTranslation()

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const date = publicationDate(book)

  // [label, value] pairs; anything falsy is dropped below.
  const rows = [
    [t('bookDetails.category'), book.category],
    [t('bookDetails.authors'), (book.authors || []).join(', ')],
    [t('bookDetails.artists'), (book.artists || []).join(', ')],
    [t('bookDetails.publisher'), book.publisher],
    [t('bookDetails.published'), date],
    [t('bookDetails.genres'), (book.genres || []).join(', ')],
    [t('bookDetails.license'), book.license],
    [t('bookDetails.isbn'), book.isbn],
    [t('bookDetails.version'), book.version],
    [t('bookDetails.language'), book.language],
    [t('bookDetails.pages'), book.page_count ? String(book.page_count) : ''],
    [t('bookDetails.fileSize'), book.file_size ? formatSize(book.file_size) : ''],
    [t('bookDetails.format'), book.mime_type],
    [t('bookDetails.path'), book.relative_path],
  ].filter(([, value]) => value)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="book-details-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--scrim)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 24,
          width: 620,
          maxWidth: '94vw',
          maxHeight: '88vh',
          overflowY: 'auto',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <span id="book-details-title" style={{ fontSize: 17, fontWeight: 600 }}>
            {book.title}
          </span>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              padding: 2,
              flexShrink: 0,
            }}
          >
            <LuX size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {book.has_thumbnail && (
            <LazyImg
              src={mediaUrl(`/books/${book.id}/thumbnail`)}
              alt={book.title}
              style={{
                width: 150,
                height: 'auto',
                borderRadius: 6,
                border: '1px solid var(--border)',
                flexShrink: 0,
                // Without this the cover is a stretched flex child: a long
                // description makes the text column taller, and the image is
                // pulled to match it, squashing the aspect ratio.
                alignSelf: 'flex-start',
              }}
            />
          )}

          <div style={{ flex: 1, minWidth: 240 }}>
            {book.description && (
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: 'var(--text-dim)',
                  margin: '0 0 14px',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {book.description}
              </p>
            )}

            <dl
              style={{
                margin: 0,
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '6px 14px',
              }}
            >
              {rows.map(([label, value]) => (
                <div key={label} style={{ display: 'contents' }}>
                  <dt style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {label}
                  </dt>
                  <dd style={{ fontSize: 13, margin: 0, wordBreak: 'break-word' }}>{value}</dd>
                </div>
              ))}
            </dl>

            {(book.tags || []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
                {book.tags.map((tag) => (
                  // Not linkable: navigating away from a modal the user opened
                  // to read is a dead end.
                  <Tag key={tag} label={tag} linkable={false} />
                ))}
              </div>
            )}

            {(book.urls || []).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 14 }}>
                {book.urls.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 13,
                      color: 'var(--gold-dim)',
                      wordBreak: 'break-all',
                    }}
                  >
                    {link.label || link.url}
                    <LuExternalLink size={11} style={{ flexShrink: 0 }} />
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
