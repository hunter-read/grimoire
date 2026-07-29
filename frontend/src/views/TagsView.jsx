import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LuTags,
  LuSearch,
  LuHeart,
  LuArrowDownUp,
  LuArrowUp,
  LuArrowDown,
  LuChevronDown,
} from 'react-icons/lu'
import { tags as tagsApi } from '../api'
import { useAuth } from '../context/AuthContext'
import { useFavorites } from '../context/FavoritesContext'
import { getUserPrefs, saveUserPref } from '../hooks/useUserPrefs'
import Spinner from '../components/Spinner'
import TagDetail from '../components/tags/TagDetail'

const CATS_COLLAPSED_KEY = 'tagsCategoryCollapsed'

// Category order for the grouped tag list: Shared always on top, then the
// resource types in their canonical order.
const CATEGORY_ORDER = ['shared', 'system', 'book', 'map', 'token', 'audio']

/**
 * Tags management + tagged-items browser (issue #235).
 *
 * Left: a bordered panel listing every tag grouped by category (Shared first),
 * with a favorite heart, usage count, text filter, a favorites-only toggle, and
 * name/count sorting within each group. Right: the selected tag's items. The
 * layout collapses to a single column on narrow screens. The selected tag is
 * mirrored to ?tag= so tag chips elsewhere deep-link here.
 */
export default function TagsView() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { isFavorite, toggleFavorite } = useFavorites()
  const isEditor = user?.role === 'admin' || user?.role === 'gm'

  const [searchParams, setSearchParams] = useSearchParams()
  const activeTag = searchParams.get('tag') || null

  const [allTags, setAllTags] = useState(null)
  const [filter, setFilter] = useState('')
  const [favOnly, setFavOnly] = useState(false)
  const [sort, setSort] = useState('name') // 'name' | 'count'
  const [order, setOrder] = useState('asc')
  const [detail, setDetail] = useState(null) // { internal, display, category, items, folders }
  const [detailLoading, setDetailLoading] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  // Per-category collapse state for the left list, persisted in user prefs.
  const [collapsedCats, setCollapsedCats] = useState(
    () =>
      new Set(
        Object.keys(getUserPrefs()[CATS_COLLAPSED_KEY] || {}).filter(
          (c) => getUserPrefs()[CATS_COLLAPSED_KEY][c]
        )
      )
  )

  const toggleCat = (cat) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      const map = {}
      for (const c of next) map[c] = true
      saveUserPref(CATS_COLLAPSED_KEY, map)
      return next
    })
  }

  const loadTags = useCallback(() => {
    tagsApi.list().then((r) => setAllTags(r.tags))
  }, [])

  useEffect(() => {
    loadTags()
  }, [loadTags])

  const selectTag = useCallback(
    (internal) => {
      setSearchParams(internal ? { tag: internal } : {}, { replace: true })
    },
    [setSearchParams]
  )

  useEffect(() => {
    if (!activeTag) {
      setDetail(null)
      return
    }
    setDetailLoading(true)
    setRenaming(false)
    tagsApi
      .items(activeTag)
      .then((r) => setDetail(r))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false))
  }, [activeTag])

  // Whether a tag is favorited comes from the shared favorites context (so it
  // stays in sync with the favorites page); fall back to the list's is_favorite.
  const tagFavorited = useCallback(
    (tg) => isFavorite('tag', tg.internal) || tg.is_favorite,
    [isFavorite]
  )

  // Filter + sort, then bucket by category (Shared first). Groups with no
  // matching tags are dropped.
  const groups = useMemo(() => {
    if (!allTags) return []
    const q = filter.trim().toLowerCase()
    const list = allTags.filter((tg) => {
      if (favOnly && !tagFavorited(tg)) return false
      if (!q) return true
      return tg.internal.includes(q) || tg.display.toLowerCase().includes(q)
    })
    const dir = order === 'asc' ? 1 : -1
    const sorted = [...list].sort((a, b) => {
      if (sort === 'count') return (a.count - b.count) * dir || a.display.localeCompare(b.display)
      return a.display.localeCompare(b.display) * dir
    })
    const byCat = new Map()
    for (const tg of sorted) {
      const cat = CATEGORY_ORDER.includes(tg.category) ? tg.category : 'shared'
      if (!byCat.has(cat)) byCat.set(cat, [])
      byCat.get(cat).push(tg)
    }
    return CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => ({
      category: c,
      tags: byCat.get(c),
    }))
  }, [allTags, filter, favOnly, sort, order, tagFavorited])

  const totalVisible = useMemo(() => groups.reduce((n, g) => n + g.tags.length, 0), [groups])

  const toggleTagFavorite = (tg, e) => {
    e?.stopPropagation()
    toggleFavorite('tag', tg.internal)
    // Optimistically flip the flag in the local list.
    setAllTags((prev) =>
      prev
        ? prev.map((x) =>
            x.internal === tg.internal ? { ...x, is_favorite: !tagFavorited(tg) } : x
          )
        : prev
    )
  }

  const saveRename = () => {
    const next = renameValue.trim()
    if (!next || !detail) return
    tagsApi.rename(detail.internal, next).then((updated) => {
      setRenaming(false)
      loadTags()
      // The internal key can change (typo fix) or merge into an existing tag;
      // re-select by the returned internal so the URL + detail stay in sync.
      if (updated.internal !== detail.internal) selectTag(updated.internal)
      else setDetail((d) => ({ ...d, display: updated.display }))
    })
  }

  const deleteTag = () => {
    if (!detail) return
    if (!window.confirm(t('tags.confirmDelete', { tag: detail.display }))) return
    tagsApi.remove(detail.internal).then(() => {
      selectTag(null)
      loadTags()
    })
  }

  const byType = (type) => (detail?.items || []).filter((i) => i.item_type === type)

  if (allTags === null) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spinner size={32} />
      </div>
    )
  }

  return (
    <div
      className="fade-in"
      style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}
    >
      <div
        style={{
          padding: 24,
          maxWidth: 1200,
          width: '100%',
          margin: '0 auto',
          boxSizing: 'border-box',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <h2
          style={{
            fontSize: 28,
            fontWeight: 600,
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <LuTags size={24} color="var(--gold)" /> {t('tags.title')}
        </h2>

        {allTags.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>{t('tags.empty')}</div>
            <div style={{ fontSize: 14 }}>{t('tags.emptyHint')}</div>
          </div>
        ) : (
          <div className="tags-layout">
            {/* Tag list panel */}
            <div
              className="tags-list-panel"
              style={{
                display: 'flex',
                flexDirection: 'column',
                border: '1px solid var(--border)',
                borderRadius: 10,
                background: 'var(--bg-panel)',
                overflow: 'hidden',
              }}
            >
              {/* Filter + favorites toggle */}
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  padding: 10,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div style={{ position: 'relative', flex: 1 }}>
                  <LuSearch
                    size={13}
                    style={{
                      position: 'absolute',
                      left: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-muted)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    type="text"
                    aria-label={t('tags.searchPlaceholder')}
                    placeholder={t('tags.searchPlaceholder')}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    style={{
                      width: '100%',
                      fontSize: 13,
                      padding: '6px 10px 6px 30px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-card)',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <button
                  onClick={() => setFavOnly((v) => !v)}
                  aria-pressed={favOnly}
                  title={t('tags.favoritesOnly')}
                  aria-label={t('tags.favoritesOnly')}
                  style={{
                    ...ctrlBtn,
                    color: favOnly ? 'var(--gold)' : 'var(--text-dim)',
                    borderColor: favOnly ? 'var(--gold-dim)' : 'var(--border)',
                  }}
                >
                  <LuHeart size={14} fill={favOnly ? 'var(--gold)' : 'none'} />
                </button>
              </div>

              {/* Sort controls — connected select + order button (matches SortFilterBar) */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 12,
                  color: 'var(--text-muted)',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    fontWeight: 600,
                  }}
                >
                  <LuArrowDownUp size={12} />
                  {t('sortFilter.sort')}
                </span>
                <div style={{ display: 'flex' }}>
                  <select
                    aria-label={t('sortFilter.sort')}
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                    style={{
                      fontSize: 12,
                      padding: '4px 6px',
                      borderRadius: 6,
                      borderTopRightRadius: 0,
                      borderBottomRightRadius: 0,
                      border: '1px solid var(--border)',
                      borderRight: 'none',
                      background: 'var(--bg-card)',
                      color: 'var(--text)',
                    }}
                  >
                    <option value="name">{t('tags.sortName')}</option>
                    <option value="count">{t('tags.sortCount')}</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
                    aria-label={
                      order === 'asc' ? t('sortFilter.ascending') : t('sortFilter.descending')
                    }
                    title={order === 'asc' ? t('sortFilter.ascending') : t('sortFilter.descending')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '4px 7px',
                      borderRadius: 6,
                      borderTopLeftRadius: 0,
                      borderBottomLeftRadius: 0,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-card)',
                      color: 'var(--text)',
                      cursor: 'pointer',
                    }}
                  >
                    {order === 'asc' ? <LuArrowUp size={13} /> : <LuArrowDown size={13} />}
                  </button>
                </div>
              </div>

              {/* Tag list, grouped by category (scrolls within the panel) */}
              <div role="list" style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
                {groups.map((g) => {
                  const catCollapsed = collapsedCats.has(g.category)
                  return (
                    <div
                      key={g.category}
                      role="group"
                      aria-label={t(`tags.category_${g.category}`)}
                    >
                      <button
                        type="button"
                        onClick={() => toggleCat(g.category)}
                        aria-expanded={!catCollapsed}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          width: '100%',
                          padding: '8px 8px 4px',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: 'var(--text-muted)',
                          textAlign: 'left',
                        }}
                      >
                        <LuChevronDown
                          size={13}
                          aria-hidden="true"
                          style={{
                            transition: 'transform 0.15s',
                            transform: catCollapsed ? 'rotate(-90deg)' : 'none',
                            flexShrink: 0,
                          }}
                        />
                        {t(`tags.category_${g.category}`, { defaultValue: g.category })}
                        <span style={{ color: 'var(--text-muted)', opacity: 0.7 }}>
                          ({g.tags.length})
                        </span>
                      </button>
                      {!catCollapsed &&
                        g.tags.map((tg) => {
                          const fav = tagFavorited(tg)
                          return (
                            <div
                              key={tg.internal}
                              role="listitem"
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                borderRadius: 6,
                                background:
                                  tg.internal === activeTag ? 'var(--bg-card)' : 'transparent',
                              }}
                            >
                              <button
                                onClick={() => toggleTagFavorite(tg)}
                                title={fav ? t('tags.unfavorite') : t('tags.favorite')}
                                aria-label={fav ? t('tags.unfavorite') : t('tags.favorite')}
                                aria-pressed={fav}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  padding: '7px 2px 7px 8px',
                                  display: 'flex',
                                  color: fav ? 'var(--gold)' : 'var(--text-muted)',
                                }}
                              >
                                <LuHeart size={13} fill={fav ? 'var(--gold)' : 'none'} />
                              </button>
                              <button
                                onClick={() => selectTag(tg.internal)}
                                aria-current={tg.internal === activeTag}
                                style={{
                                  flex: 1,
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '7px 10px 7px 2px',
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: 'var(--text)',
                                  fontSize: 14,
                                  textAlign: 'left',
                                  minWidth: 0,
                                }}
                              >
                                <span
                                  style={{
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {tg.display}
                                </span>
                                <span
                                  style={{
                                    color: 'var(--text-muted)',
                                    fontSize: 12,
                                    flexShrink: 0,
                                  }}
                                >
                                  {tg.count}
                                </span>
                              </button>
                            </div>
                          )
                        })}
                    </div>
                  )
                })}
                {totalVisible === 0 && (
                  <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
                    {t('tags.noMatches')}
                  </div>
                )}
              </div>
            </div>

            {/* Selected tag detail */}
            <div className="tags-detail-panel" style={{ minWidth: 0, overflowY: 'auto' }}>
              {!activeTag && (
                <div style={{ color: 'var(--text-muted)', padding: 20 }}>{t('tags.allTags')}</div>
              )}
              {activeTag && detailLoading && (
                <div style={{ padding: 20 }}>
                  <Spinner size={24} />
                </div>
              )}
              {activeTag && !detailLoading && detail && (
                <TagDetail
                  detail={detail}
                  isEditor={isEditor}
                  renaming={renaming}
                  renameValue={renameValue}
                  setRenameValue={setRenameValue}
                  setRenaming={setRenaming}
                  saveRename={saveRename}
                  deleteTag={deleteTag}
                  favorited={isFavorite('tag', detail.internal)}
                  onToggleFavorite={() =>
                    toggleTagFavorite({ internal: detail.internal, is_favorite: false })
                  }
                  byType={byType}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const ctrlBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  borderRadius: 6,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  cursor: 'pointer',
  flexShrink: 0,
}
