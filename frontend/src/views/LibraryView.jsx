import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuLibrary, LuHeart } from 'react-icons/lu'
import api, { mediaUrl } from '../api'
import Spinner from '../components/Spinner'
import Tag from '../components/Tag'
import FavoriteButton from '../components/FavoriteButton'
import { getUserPrefs } from '../hooks/useUserPrefs'
import { getRecentBooks, getBookPrefs } from '../hooks/useBookPrefs'
import { useFavorites } from '../context/FavoritesContext'

function SystemCard({ system, onClick, compact }) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)

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

export default function LibraryView() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isFavorite } = useFavorites()
  const [systems, setSystems] = useState(null)
  const [favOnly, setFavOnly] = useState(false)

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
  const cardSize = prefs.cardSize || 'comfortable'
  const sort = prefs.librarySort || 'az'

  const sortFn = (a, b) =>
    sort === 'za' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)

  const normalSystems = systems
    .filter((s) => s.book_count > 0 && !s.is_system_agnostic && (!favOnly || isFavorite('system', s.id)))
    .sort(sortFn)

  const agnosticSystems = systems
    .filter((s) => s.book_count > 0 && s.is_system_agnostic && (!favOnly || isFavorite('system', s.id)))
    .sort(sortFn)

  const compact = cardSize === 'compact'
  const minCard = compact ? '130px' : '220px'
  const recentBooks = getRecentBooks()

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
          <h3
            style={{
              fontSize: 16,
              color: 'var(--text-dim)',
              fontWeight: 500,
              marginBottom: 12,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            {t('library.recentlyOpened')}
          </h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {recentBooks.map((book) => {
              const lastPage = getBookPrefs(book.id).page || 1
              const progress = book.page_count > 0 ? Math.min(lastPage / book.page_count, 1) : 0
              return (
                <div
                  key={book.id}
                  onClick={() => navigate(`/library/book/${book.id}?page=${lastPage}`)}
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
                        maxWidth: 180,
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

      {/* Game Systems */}
      {(normalSystems.length > 0 || favOnly) && (
        <>
          <div style={{ marginBottom: 32, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
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
            <FavToggle active={favOnly} onClick={() => setFavOnly((v) => !v)} t={t} />
          </div>
          {normalSystems.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${minCard}, 1fr))`,
                gap: compact ? 12 : 20,
                marginBottom: agnosticSystems.length > 0 ? 56 : 0,
              }}
            >
              {normalSystems.map((system) => (
                <SystemCard
                  key={system.id}
                  system={system}
                  onClick={() => navigate(`/library/system/${system.id}`)}
                  compact={compact}
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

      {/* System-Agnostic Collections */}
      {agnosticSystems.length > 0 && (
        <>
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
              marginBottom: 24,
            }}
          >
            {t('library.agnosticSubtitle')}
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fill, minmax(${minCard}, 1fr))`,
              gap: compact ? 12 : 20,
            }}
          >
            {agnosticSystems.map((system) => (
              <SystemCard
                key={system.id}
                system={system}
                onClick={() => navigate(`/library/system/${system.id}`)}
                compact={compact}
              />
            ))}
          </div>
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

function FavToggle({ active, onClick, t }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={t('favorites.onlyFavorites')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: active ? 'rgba(180,120,60,0.15)' : 'var(--bg-card)',
        color: active ? 'var(--gold)' : 'var(--text-muted)',
        fontSize: 13,
        cursor: 'pointer',
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      <LuHeart size={14} fill={active ? 'var(--gold)' : 'none'} />
      {t('favorites.onlyFavorites')}
    </button>
  )
}
