import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuLibrary, LuChevronDown, LuChevronRight } from 'react-icons/lu'
import api, { mediaUrl } from '../api'
import Spinner from '../components/Spinner'
import useViewMode from '../hooks/useViewMode'
import ViewModeToggle from '../components/ViewModeToggle'
import { getUserPrefs, saveUserPref } from '../hooks/useUserPrefs'
import { getRecentBooks, getBookPrefs, removeRecentBook } from '../hooks/useBookPrefs'
import { useFavorites } from '../context/FavoritesContext'
import SystemCard from '../components/library/SystemCard'
import AgnosticChip from '../components/library/AgnosticChip'
import FavToggle from '../components/library/FavToggle'

export default function LibraryView() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isFavorite } = useFavorites()
  const [systems, setSystems] = useState(null)
  const [favOnly, setFavOnly] = useState(false)
  const [viewMode, cycleViewMode] = useViewMode('system')
  const [recentBooks, setRecentBooks] = useState(() => getRecentBooks())
  const [recentCollapsed, setRecentCollapsed] = useState(
    () => getUserPrefs().recentCollapsed === true
  )

  useEffect(() => {
    api.get('/systems').then(setSystems)
  }, [])

  if (!systems)
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spinner size={32} />
      </div>
    )

  const prefs = getUserPrefs()
  const sort = prefs.librarySort || 'az'

  const sortFn = (a, b) =>
    sort === 'za' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)

  const normalSystems = systems
    .filter(
      (s) => s.book_count > 0 && !s.is_system_agnostic && (!favOnly || isFavorite('system', s.id))
    )
    .sort(sortFn)

  const agnosticSystems = systems
    .filter(
      (s) => s.book_count > 0 && s.is_system_agnostic && (!favOnly || isFavorite('system', s.id))
    )
    .sort(sortFn)

  const compact = viewMode === 'compact'
  const list = viewMode === 'list'
  const minCard = compact ? '130px' : '220px'

  return (
    <div
      className="fade-in"
      style={{
        padding: '32px 40px',
        maxWidth: 1400,
        width: '100%',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}
    >
      {/* Recently Opened */}
      {recentBooks.length > 0 && (
        <div style={{ marginBottom: 40 }}>
          <button
            onClick={() => {
              const next = !recentCollapsed
              setRecentCollapsed(next)
              saveUserPref('recentCollapsed', next)
            }}
            aria-expanded={!recentCollapsed}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'none',
              border: 'none',
              padding: 0,
              marginBottom: recentCollapsed ? 0 : 12,
              cursor: 'pointer',
              fontSize: 16,
              color: 'var(--text-dim)',
              fontWeight: 500,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            {recentCollapsed ? <LuChevronRight size={16} /> : <LuChevronDown size={16} />}
            {t('library.recentlyOpened')}
          </button>
          <div
            style={{
              display: recentCollapsed ? 'none' : 'flex',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            {recentBooks.map((book) => {
              const lastPage = getBookPrefs(book.id).page || 1
              const progress = book.page_count > 0 ? Math.min(lastPage / book.page_count, 1) : 0
              return (
                <div
                  key={book.id}
                  onClick={() =>
                    navigate(`/library/book/${book.id}?page=${lastPage}`, {
                      state: { from: window.location.pathname },
                    })
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    cursor: 'pointer',
                    maxWidth: 260,
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeRecentBook(book.id)
                      setRecentBooks(getRecentBooks())
                    }}
                    title={t('library.removeFromRecent')}
                    aria-label={t('library.removeFromRecent')}
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      fontSize: 12,
                      lineHeight: 1,
                      padding: '1px 3px',
                      borderRadius: 3,
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--text)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--text-muted)'
                    }}
                  >
                    ✕
                  </button>
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
                  <div
                    style={{
                      width: 28,
                      height: 36,
                      borderRadius: 3,
                      overflow: 'hidden',
                      flexShrink: 0,
                      background: 'var(--bg-deep)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {book.has_thumbnail ? (
                      <img
                        src={mediaUrl(`/books/${book.id}/thumbnail`)}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>📄</span>
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 170,
                      }}
                    >
                      {book.title}
                    </div>
                    {progress > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--gold-dim)', marginTop: 2 }}>
                        {t('common.pageRange', {
                          page: lastPage,
                          total: book.page_count > 0 ? book.page_count : '?',
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* System-Agnostic Collections — kept at the top for quick access, shown as
          compact chips rather than full image cards. */}
      {agnosticSystems.length > 0 && (
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <LuLibrary size={18} color="var(--gold-dim)" />
            <h2 style={{ fontSize: 22, margin: 0 }}>{t('library.agnosticTitle')}</h2>
          </div>
          <p
            style={{
              color: 'var(--text-dim)',
              fontSize: 15,
              fontFamily: 'Alegreya, serif',
              fontStyle: 'italic',
              marginBottom: 16,
            }}
          >
            {t('library.agnosticSubtitle')}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {agnosticSystems.map((system) => (
              <AgnosticChip
                key={system.id}
                system={system}
                onClick={() => navigate(`/library/system/${system.id}`)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Game Systems */}
      {(normalSystems.length > 0 || favOnly) && (
        <>
          <div
            style={{
              marginBottom: 32,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div>
              <h2 style={{ fontSize: 28, marginBottom: 8 }}>{t('library.title')}</h2>
              <p
                style={{
                  color: 'var(--text-dim)',
                  fontSize: 17,
                  fontFamily: 'Alegreya, serif',
                  fontStyle: 'italic',
                }}
              >
                {t('library.subtitle', { count: normalSystems.length })}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ViewModeToggle mode={viewMode} onCycle={cycleViewMode} />
              <FavToggle active={favOnly} onClick={() => setFavOnly((v) => !v)} />
            </div>
          </div>
          {normalSystems.length > 0 ? (
            <div
              style={
                list
                  ? { display: 'flex', flexDirection: 'column', gap: 8 }
                  : {
                      display: 'grid',
                      gridTemplateColumns: `repeat(auto-fill, minmax(${minCard}, 1fr))`,
                      gap: compact ? 12 : 20,
                    }
              }
            >
              {normalSystems.map((system) => (
                <SystemCard
                  key={system.id}
                  system={system}
                  onClick={() => navigate(`/library/system/${system.id}`)}
                  compact={compact}
                  list={list}
                />
              ))}
            </div>
          ) : favOnly ? (
            <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 32 }}>
              {t('favorites.noFavoritesInView')}
            </p>
          ) : null}
        </>
      )}

      {/* Empty state when library has no systems at all (not filtered) */}
      {!favOnly && normalSystems.length === 0 && agnosticSystems.length === 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 28, marginBottom: 8 }}>{t('library.title')}</h2>
          <p
            style={{
              color: 'var(--text-dim)',
              fontSize: 17,
              fontFamily: 'Alegreya, serif',
              fontStyle: 'italic',
            }}
          >
            {t('library.subtitle', { count: 0 })}
          </p>
        </div>
      )}
    </div>
  )
}
