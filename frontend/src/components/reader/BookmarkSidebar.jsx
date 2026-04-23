import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuBookmark, LuX, LuTrash2, LuPencil, LuCheck } from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'

export default function BookmarkSidebar({ bookId, currentPage, onGoToPage, onClose, refreshKey }) {
  const { t } = useTranslation()
  const [bookmarks, setBookmarks] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [editLabel, setEditLabel] = useState('')
  const [editNotes, setEditNotes] = useState('')

  useEffect(() => {
    setLoading(true)
    api
      .get(`/bookmarks?book_id=${bookId}`)
      .then((r) => {
        setBookmarks(r)
        setLoading(false)
      })
      .catch(() => {
        setBookmarks([])
        setLoading(false)
      })
  }, [bookId, refreshKey])

  const handleDelete = (id) => {
    api.delete(`/bookmarks/${id}`).then(() => setBookmarks((bms) => bms.filter((b) => b.id !== id)))
  }

  const startEdit = (bm) => {
    setEditingId(bm.id)
    setEditLabel(bm.label)
    setEditNotes(bm.notes || '')
  }

  const saveEdit = (bm) => {
    api.patch(`/bookmarks/${bm.id}`, { label: editLabel, notes: editNotes }).then(() => {
      setBookmarks((bms) =>
        bms.map((b) => (b.id === bm.id ? { ...b, label: editLabel, notes: editNotes } : b))
      )
      setEditingId(null)
    })
  }

  const cancelEdit = () => setEditingId(null)

  return (
    <div
      style={{
        width: 280,
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
        <LuBookmark size={14} color="var(--text-muted)" aria-hidden="true" />
        <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: 'var(--text-dim)' }}>
          {t('bookmark.sidebarTitle')}
        </span>
        <button
          onClick={onClose}
          aria-label={t('bookmark.closeBookmarks')}
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

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 4px' }}>
        {loading && (
          <div style={{ padding: 20, textAlign: 'center' }}>
            <Spinner size={20} />
          </div>
        )}

        {!loading && bookmarks?.length === 0 && (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 13,
            }}
          >
            {t('bookmark.noBookmarks')}
            <br />
            <span style={{ opacity: 0.7 }}>{t('bookmark.noBookmarksHint')}</span>
          </div>
        )}

        {!loading &&
          bookmarks?.map((bm) => {
            const isActive = currentPage === bm.page_number
            const isEditing = editingId === bm.id
            const displayLabel =
              bm.label ||
              (bm.selected_text ? bm.selected_text.slice(0, 40) : `Page ${bm.page_number}`)
            return (
              <div
                key={bm.id}
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  marginBottom: 2,
                  background: isActive ? 'var(--bg-card-hover)' : 'transparent',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 6,
                }}
              >
                <button
                  onClick={() => !isEditing && onGoToPage(bm.page_number, bm.selected_text || null)}
                  aria-label={t('bookmark.goToBookmark', { label: displayLabel })}
                  style={{
                    flex: 1,
                    background: 'none',
                    border: 'none',
                    cursor: isEditing ? 'default' : 'pointer',
                    textAlign: 'left',
                    padding: 0,
                  }}
                >
                  {isEditing ? (
                    <div onClick={(e) => e.stopPropagation()}>
                      <input
                        autoFocus
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit(bm)
                          if (e.key === 'Escape') cancelEdit()
                        }}
                        placeholder={
                          bm.selected_text
                            ? bm.selected_text.slice(0, 40)
                            : `Page ${bm.page_number}`
                        }
                        style={{
                          fontSize: 13,
                          width: '100%',
                          padding: '2px 4px',
                          marginBottom: 4,
                          boxSizing: 'border-box',
                        }}
                      />
                      <textarea
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') cancelEdit()
                        }}
                        placeholder={t('bookmark.notesPlaceholder')}
                        rows={3}
                        style={{
                          fontSize: 12,
                          width: '100%',
                          padding: '2px 4px',
                          resize: 'vertical',
                          fontFamily: 'inherit',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  ) : (
                    <>
                      <div
                        style={{
                          fontSize: 13,
                          color: isActive ? 'var(--gold)' : 'var(--text-dim)',
                          fontWeight: isActive ? 500 : 400,
                          lineHeight: 1.4,
                        }}
                      >
                        {displayLabel}
                      </div>
                      {bm.notes && (
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--text-dim)',
                            marginTop: 3,
                            lineHeight: 1.5,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          {bm.notes}
                        </div>
                      )}
                      {bm.selected_text && (
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--text-muted)',
                            marginTop: 2,
                            lineHeight: 1.4,
                            overflow: 'hidden',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                          }}
                        >
                          "{bm.selected_text}"
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        p. {bm.page_number}
                      </div>
                    </>
                  )}
                </button>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                  {isEditing ? (
                    <button
                      onClick={() => saveEdit(bm)}
                      aria-label={t('bookmark.saveBookmark')}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--gold)',
                        padding: '2px',
                        display: 'flex',
                      }}
                    >
                      <LuCheck size={12} aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      onClick={() => startEdit(bm)}
                      aria-label={t('bookmark.editBookmark')}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                        padding: '2px',
                        opacity: 0.6,
                        display: 'flex',
                      }}
                    >
                      <LuPencil size={12} aria-hidden="true" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(bm.id)}
                    aria-label={t('bookmark.deleteBookmark')}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      padding: '2px',
                      flexShrink: 0,
                      opacity: 0.6,
                      display: 'flex',
                    }}
                  >
                    <LuTrash2 size={12} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )
          })}
      </div>
    </div>
  )
}
