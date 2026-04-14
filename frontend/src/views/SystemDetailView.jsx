import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  LuArrowLeft, LuPencil, LuClipboard,
  LuFileText, LuFolderOpen, LuSearch, LuX,
  LuChevronDown, LuChevronRight, LuDownload,
} from 'react-icons/lu'
import api from '../api'
import DownloadArchiveModal from '../components/DownloadArchiveModal'

import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import Tag from '../components/Tag'
import BookRow from '../components/system/BookRow'
import BookEditor from '../components/system/BookEditor'
import SystemEditor from '../components/system/SystemEditor'
import FavoriteButton from '../components/FavoriteButton'
import { CATEGORY_LABELS, CATEGORY_ICONS, CATEGORY_ORDER } from '../constants'

export default function SystemDetailView() {
  const { systemId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isEditor = user?.role === 'admin' || user?.role === 'gm'
  const [system, setSystem] = useState(null)
  const [editing, setEditing] = useState(false)
  const [editingBookId, setEditingBookId] = useState(null)
  const [collapsedCats, setCollapsedCats] = useState(new Set())
  const [selectedTags, setSelectedTags] = useState(new Set())
  const [showAllTags, setShowAllTags] = useState(false)
  const [bookSort, setBookSort] = useState('title')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef(null)
  const [downloadModal, setDownloadModal] = useState(null) // { title, params }

  useEffect(() => { api.get(`/systems/${systemId}`).then(setSystem) }, [systemId])

  const doSearch = useCallback((q) => {
    if (q.length < 2) { setSearchResults(null); return }
    setSearching(true)
    api.get(`/search?q=${encodeURIComponent(q)}&system_id=${systemId}`)
      .then(r => { setSearchResults(r); setSearching(false) })
      .catch(() => setSearching(false))
  }, [systemId])

  const handleSearchInput = (e) => {
    const v = e.target.value
    setSearchQuery(v)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => doSearch(v), 350)
  }

  const clearSearch = () => {
    setSearchQuery('')
    setSearchResults(null)
  }

  if (!system) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={32} /></div>

  const allTags = [...new Set((system.books || []).flatMap(b => b.tags || []))].sort()

  const toggleTag = (t) => setSelectedTags(prev => {
    const next = new Set(prev)
    next.has(t) ? next.delete(t) : next.add(t)
    return next
  })

  const sortBooks = (books) => {
    const sorted = [...books]
    if (bookSort === 'title')     sorted.sort((a, b) => a.title.localeCompare(b.title))
    if (bookSort === 'year')      sorted.sort((a, b) => (b.year || 0) - (a.year || 0))
    if (bookSort === 'size')      sorted.sort((a, b) => (b.file_size || 0) - (a.file_size || 0))
    if (bookSort === 'pages')     sorted.sort((a, b) => (b.page_count || 0) - (a.page_count || 0))
    return sorted
  }

  const categories = {}
  ;(system.books || [])
    .filter(book => selectedTags.size === 0 || [...selectedTags].every(t => (book.tags || []).includes(t)))
    .forEach(book => {
      const cat = book.category || 'core'
      if (!categories[cat]) categories[cat] = []
      categories[cat].push(book)
    })

  const allCatKeys = Object.keys(categories)
  const collapseAll = () => setCollapsedCats(new Set(allCatKeys))
  const expandAll   = () => setCollapsedCats(new Set())
  return (
    <div className="fade-in" style={{ padding: '32px 40px', maxWidth: 1200, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <button onClick={() => navigate('/library')} style={{
          background: 'none', color: 'var(--text-dim)', fontSize: 15,
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16,
        }}>
          <LuArrowLeft size={15} /> Back to Library
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 32, marginBottom: 8 }}>{system.name}</h2>
            {system.publishers?.length > 0 && (
              <div style={{ fontSize: 16, color: 'var(--text-dim)', marginBottom: 8 }}>
                Published by {system.publishers.map((p, i) => (
                  <span key={i}>
                    {i > 0 && ', '}
                    {p.url ? <a href={p.url} target="_blank" rel="noopener">{p.name}</a> : p.name}
                  </span>
                ))}
              </div>
            )}
            {system.description && (
              <p style={{ fontSize: 16, color: 'var(--text-dim)', lineHeight: 1.6, fontFamily: 'Alegreya, serif', marginBottom: 12 }}>
                {system.description}
              </p>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0, marginBottom: 8 }}>
              {(system.tags || []).map(tag => <Tag key={tag} label={tag} />)}
              {system.genre && <Tag label={system.genre} color="rgba(90, 154, 90, 0.2)" />}
            </div>
          </div>

          <div className="system-header-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8, minWidth: 0 }}>
            {system.character_builder_url && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                <a href={system.character_builder_url} target="_blank" rel="noopener" style={{
                  padding: '8px 16px', borderRadius: 6, fontSize: 15,
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  color: 'var(--gold)', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>
                  <LuClipboard size={14} /> Character Builder
                </a>
              </div>
            )}
            {/* Search bar */}
            <div style={{ position: 'relative' }}>
              <LuSearch size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearchInput}
                placeholder={`Search within ${system.name}…`}
                style={{ width: '100%', fontSize: 13, padding: '6px 28px 6px 30px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', boxSizing: 'border-box' }}
              />
              {searching && <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}><Spinner size={14} /></div>}
              {searchQuery && !searching && (
                <button onClick={clearSearch} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 0 }}>
                  <LuX size={12} />
                </button>
              )}
            </div>
            {/* Row 1: Favorite, Edit, Download All */}
            <div className="system-btn-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FavoriteButton type="system" id={system.id} style={{ position: 'static', background: 'var(--bg-card)', border: '1px solid var(--border)', width: 32, height: 32, borderRadius: 6 }} />
              {isEditor && (
                <button
                  onClick={() => setEditing(!editing)}
                  style={{
                    ...toolBtnStyle,
                    color: editing ? 'var(--gold)' : 'var(--text-dim)',
                    outline: editing ? '1px solid var(--gold-dim)' : 'none',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <LuPencil size={13} />
                  {editing ? 'Done' : 'Edit'}
                </button>
              )}
              <button
                onClick={() => setDownloadModal({ title: `All books in ${system.name}`, params: { type: 'system', id: system.id } })}
                style={{ ...toolBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                title="Download all books in this system"
              >
                <LuDownload size={13} /> Download All
              </button>
            </div>
            {/* Row 2: Collapse / Expand */}
            <div className="system-btn-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={collapseAll} disabled={!!searchResults || collapsedCats.size === allCatKeys.length} style={{ ...toolBtnStyle, opacity: (!!searchResults || collapsedCats.size === allCatKeys.length) ? 0.4 : 1 }}>Collapse All</button>
              <button onClick={expandAll} disabled={!!searchResults || collapsedCats.size === 0} style={{ ...toolBtnStyle, opacity: (!!searchResults || collapsedCats.size === 0) ? 0.4 : 1 }}>Expand All</button>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Panel */}
      {editing && (
        <SystemEditor
          system={system}
          onSave={(updated) => { setSystem({ ...system, ...updated }); setEditing(false) }}
        />
      )}

      {/* Tag filter row */}
      {!searchResults && allTags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 24, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', marginRight: 4 }}>Tags:</span>
          {(showAllTags ? allTags : allTags.slice(0, 15)).map(t => (
            <button
              key={t}
              onClick={() => toggleTag(t)}
              style={{
                fontSize: 13, padding: '3px 10px', borderRadius: 10, cursor: 'pointer', border: 'none',
                background: selectedTags.has(t) ? 'rgba(201,168,76,0.2)' : 'var(--tag-bg)',
                color: selectedTags.has(t) ? 'var(--gold)' : 'var(--text-dim)',
                outline: selectedTags.has(t) ? '1px solid var(--gold-dim)' : '1px solid var(--tag-border)',
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
          {allTags.length > 15 && (
            <button
              onClick={() => setShowAllTags(v => !v)}
              style={{ fontSize: 12, padding: '3px 8px', borderRadius: 10, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            >
              {showAllTags ? 'Show less' : `+${allTags.length - 15} more`}
            </button>
          )}
          {selectedTags.size > 0 && (
            <button
              onClick={() => setSelectedTags(new Set())}
              style={{ fontSize: 12, padding: '3px 8px', borderRadius: 10, cursor: 'pointer', background: 'none', border: 'none', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}
            >
              <LuX size={11} /> Clear
            </button>
          )}
        </div>
      )}

      {/* Sort bar */}
      {!searchResults && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0 }}>Sort:</span>
          {[['title', 'A–Z'], ['year', 'Year'], ['pages', 'Pages'], ['size', 'Size']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setBookSort(val)}
              style={{
                fontSize: 12, padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
                background: bookSort === val ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                border: '1px solid var(--border)',
                color: bookSort === val ? 'var(--gold)' : 'var(--text-dim)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Search results */}
      {searchResults && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
            {searchResults.total} result{searchResults.total !== 1 ? 's' : ''} for "{searchResults.query}"
          </div>
          {searchResults.total === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No results found.</div>
          )}
          {searchResults.results.map((r, i) => (
            <div
              key={i}
              onClick={() => navigate(`/library/book/${r.id}?page=${r.page_number}`)}
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 8, cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-card)'}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{r.title}</span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0, marginLeft: 12 }}>p. {r.page_number}</span>
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: r.snippet }} />
            </div>
          ))}
        </div>
      )}

      {/* Books by category */}
      {!searchResults && [...CATEGORY_ORDER, ...Object.keys(categories).filter(c => !CATEGORY_ORDER.includes(c))]
        .filter(cat => categories[cat])
        .map(cat => {
          const books = sortBooks(categories[cat])
          const CatIcon = CATEGORY_ICONS[cat] || LuFileText
          const isCollapsed = collapsedCats.has(cat)
          const toggle = () => setCollapsedCats(prev => {
            const next = new Set(prev)
            next.has(cat) ? next.delete(cat) : next.add(cat)
            return next
          })
          return (
            <div key={cat} style={{ marginBottom: 32 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: isCollapsed ? 0 : 16 }}>
              <button
                onClick={toggle}
                aria-expanded={!isCollapsed}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                  background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
                  textAlign: 'left',
                }}
              >
                {isCollapsed
                  ? <LuChevronRight size={15} color="var(--gold-dim)" />
                  : <LuChevronDown size={15} color="var(--gold-dim)" />
                }
                <CatIcon size={15} color="var(--gold-dim)" />
                <span style={{ fontSize: 17, color: 'var(--gold-dim)', fontWeight: 600 }}>
                  {CATEGORY_LABELS[cat] || cat.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </span>
                <span style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: 'Alegreya Sans, sans-serif', fontWeight: 400 }}>
                  ({books.length})
                </span>
              </button>
              <button
                onClick={() => setDownloadModal({ title: `${CATEGORY_LABELS[cat] || cat} — ${system.name}`, params: { type: 'system_category', id: system.id, category: cat } })}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 5, fontSize: 12, color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'var(--bg-card)', cursor: 'pointer', flexShrink: 0 }}
                title={`Download ${CATEGORY_LABELS[cat] || cat}`}
              >
                <LuDownload size={11} /> Download
              </button>
            </div>
              {!isCollapsed && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {books.map(book => (
                    <div key={book.id}>
                      <BookRow
                        book={book}
                        onOpen={() => navigate(`/library/book/${book.id}`)}
                        onEdit={isEditor ? () => setEditingBookId(id => id === book.id ? null : book.id) : null}
                        editing={editingBookId === book.id}
                      />
                      {editingBookId === book.id && (
                        <BookEditor
                          book={book}
                          onSave={(updated) => {
                            setSystem(s => ({ ...s, books: s.books.map(b => b.id === book.id ? { ...b, ...updated } : b) }))
                            setEditingBookId(null)
                          }}
                          onClose={() => setEditingBookId(null)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

      {!searchResults && allCatKeys.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
          <LuFolderOpen size={48} style={{ marginBottom: 16, opacity: 0.4 }} />
          <p>No books found. Add PDFs to this system's directory and rescan.</p>
        </div>
      )}

      {downloadModal && (
        <DownloadArchiveModal
          title={downloadModal.title}
          params={downloadModal.params}
          onClose={() => setDownloadModal(null)}
        />
      )}
    </div>
  )
}

const toolBtnStyle = {
  padding: '6px 12px', borderRadius: 6, fontSize: 13,
  background: 'var(--bg-card)', color: 'var(--text-dim)',
  border: '1px solid var(--border)', cursor: 'pointer',
  flexShrink: 0,
}
