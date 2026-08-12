import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuInfo, LuX, LuPencil } from 'react-icons/lu'
import { useAuth } from '../../context/AuthContext'
import { formatSize } from '../../utils'
import Tag from '../Tag'
import { publicationDate } from '../system/bookDetails'
import DetailsSidebarEditor from './DetailsSidebarEditor'

/**
 * The book's metadata, shown in the same right-hand sidebar as contents,
 * bookmarks, and search rather than a modal — so it can stay open while you
 * read and page through the book.
 *
 * Read-only by default for everyone; gm/admin get an Edit button that swaps the
 * body for the editable form. Fields with no value are omitted rather than
 * rendered blank, so a sparsely tagged book reads as short instead of
 * mostly-empty.
 */
export default function DetailsSidebar({ book, onClose, onSave }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [editing, setEditing] = useState(false)

  const canEdit = user?.role === 'admin' || user?.role === 'gm'
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
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <LuInfo size={14} color="var(--text-muted)" aria-hidden="true" />
        <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: 'var(--text-dim)' }}>
          {t('bookActions.details')}
        </span>
        {canEdit && !editing && (
          <button
            onClick={() => setEditing(true)}
            aria-label={t('bookActions.edit')}
            title={t('bookActions.edit')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
            }}
          >
            <LuPencil size={14} aria-hidden="true" />
          </button>
        )}
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            display: 'flex',
          }}
        >
          <LuX size={15} aria-hidden="true" />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        {editing ? (
          <DetailsSidebarEditor
            book={book}
            onSaved={(updated) => {
              onSave?.(updated)
              setEditing(false)
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>{book.title}</div>

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
                gap: '6px 12px',
              }}
            >
              {rows.map(([label, value]) => (
                <div key={label} style={{ display: 'contents' }}>
                  <dt style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</dt>
                  <dd style={{ fontSize: 13, margin: 0, wordBreak: 'break-word' }}>{value}</dd>
                </div>
              ))}
            </dl>

            {(book.tags || []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
                {book.tags.map((tag) => (
                  // Not linkable: navigating away would close the book the user
                  // is reading.
                  <Tag key={tag} label={tag} linkable={false} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
