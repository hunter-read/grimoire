import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuSearch, LuImageOff } from 'react-icons/lu'
import { imageSources } from '../../api'
import ImageSourceFolder from './ImageSourceFolder'
import LazyImg from '../LazyImg'
import Spinner from '../Spinner'
import { TYPE_ICONS } from '../campaigns/resourcesShared'

// Trailing delay after the last keystroke before querying, matching the
// resource picker so the two feel the same.
const DEBOUNCE_MS = 250

// Every type that can supply an image, and the default set. Books contribute
// their cover thumbnail and audio its artwork; maps and tokens are images
// outright. Callers that only want the real images pass a narrower `types`.
const TYPES = ['map', 'token', 'book', 'audio']

/**
 * What the token editor browses: the token library, and nothing else.
 *
 * A book's thumbnail is a cover and a track's is album art, so neither is ever
 * the character picture someone came to crop. Maps are excluded for the same
 * reason despite being real artwork — a battlemap is scenery, not a portrait,
 * and tokens are already the collection of character images. Anything that
 * lives elsewhere is still one upload away.
 */
export const TOKEN_SOURCE_TYPES = ['token']

// A grid of thumbnails is far heavier than the resource picker's text rows, so
// this asks for a smaller slice and pages through it client-side.
const SEARCH_LIMIT = 2000
const PAGE = 60

/**
 * Browse images Grimoire already holds, for the shared image picker (issue #286).
 *
 * Searching runs server-side against the whole library (the campaign resource
 * search, which the picker reuses rather than adding a second search path), and
 * results are filtered to the items that can actually produce an image: a book
 * without a cover thumbnail or a track without artwork is dropped, since
 * choosing it would only 404 server-side.
 *
 * `campaignImages` is an optional list of images already attached to a campaign
 * ({ id, name }). When given they lead the list under their own tab, because a
 * campaign's own art is the common case for its banner.
 *
 * `types` narrows which source tabs are offered. It defaults to all four, but a
 * caller wanting only real artwork — the token editor, whose output is a picture
 * of a character — passes just the image types, so a book cover or an album
 * thumbnail is never presented as token art.
 *
 * `fill` makes the results box grow into whatever height its parent gives it,
 * instead of stopping at a fixed 300px. The default suits the image-picker
 * modal, which is a short dialog; the token editor hands this a full-height
 * column, where a 300px box would waste most of the screen.
 */
export default function ImageSourceBrowser({
  campaignImages = null,
  types = TYPES,
  fill = false,
  value,
  onChange,
}) {
  const { t } = useTranslation()
  const hasCampaign = Array.isArray(campaignImages) && campaignImages.length > 0
  // Narrowing `types` must not leave the browser on a tab it no longer offers.
  const allowed = TYPES.filter((type) => types.includes(type))
  const [tab, setTab] = useState(hasCampaign ? 'campaign_file' : allowed[0] || 'map')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [shown, setShown] = useState(PAGE)
  // Folders the user has collapsed. Absent means open, so a fresh browse shows
  // everything rather than making the user expand to find anything.
  const [closed, setClosed] = useState(() => new Set())
  // Guards against a slow earlier request landing after a newer one.
  const reqId = useRef(0)
  // Latest `t` without making it a dependency of the search effect.
  const tRef = useRef(t)
  tRef.current = t

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query])

  // Reset paging whenever the result set changes underneath it.
  useEffect(() => setShown(PAGE), [debounced, tab])

  useEffect(() => {
    if (tab === 'campaign_file') return undefined
    const mine = ++reqId.current
    setRows(null)
    setError('')
    let cancelled = false
    imageSources
      .search(debounced, tab, SEARCH_LIMIT)
      .then((res) => {
        if (cancelled || mine !== reqId.current) return
        // Only items that can actually yield an image; anything else would
        // resolve to a 404 the moment it was chosen.
        setRows((res || []).filter((r) => r.has_thumbnail))
      })
      .catch((err) => {
        if (cancelled || mine !== reqId.current) return
        // `t` is deliberately not a dependency: i18next hands back a new
        // function identity on some renders, and depending on it would re-run
        // this fetch in a loop. The message is read at rejection time anyway.
        setError(err?.message || tRef.current('imagePicker.searchFailed'))
        setRows([])
      })
    return () => {
      cancelled = true
    }
  }, [debounced, tab])

  // The campaign's own images are already in hand; filter them locally.
  const campaignRows = useMemo(() => {
    if (!hasCampaign) return []
    const q = debounced.toLowerCase()
    return campaignImages
      .filter((f) => !q || (f.name || '').toLowerCase().includes(q))
      .map((f) => ({
        resource_type: 'campaign_file',
        resource_id: f.id,
        name: f.name,
        subtitle: '',
        thumb: f.url || null,
      }))
  }, [campaignImages, debounced, hasCampaign])

  const items = tab === 'campaign_file' ? campaignRows : rows
  const loading = items === null
  const visible = (items || []).slice(0, shown)
  const remaining = (items || []).length - visible.length

  // Group the visible slice by the folder each item came from — `subtitle` is
  // the item's folder path, which is what turns a flat wall of thumbnails into
  // the library structure the user actually filed them under. Grouping is off
  // for a campaign's own files, which have no folders, and while searching,
  // where matches from many folders should read as one result list.
  const grouped = tab !== 'campaign_file' && !debounced
  const groups = useMemo(() => {
    if (!grouped) return [{ path: '', items: visible }]
    const byPath = new Map()
    for (const item of visible) {
      const path = item.subtitle || ''
      if (!byPath.has(path)) byPath.set(path, [])
      byPath.get(path).push(item)
    }
    // Loose items (no folder) last: a named folder is more useful to land on.
    return [...byPath.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([path, list]) => ({ path, items: list }))
    // `visible` is a fresh slice each render; key the memo on what shapes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, shown, grouped])

  const toggleFolder = (path) =>
    setClosed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const tabs = hasCampaign ? ['campaign_file', ...allowed] : allowed

  return (
    // When filling, this is a flex column so the results box below can take the
    // leftover height; minHeight 0 is what lets it shrink and scroll rather
    // than overflow its parent.
    <div
      style={fill ? { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } : undefined}
    >
      {/* A lone tab is a chooser with nothing to choose — the token editor
          browses only the token library, so the row would be one permanently
          selected pill above its own results. */}
      {tabs.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {tabs.map((type) => {
            const active = tab === type
            const Icon = TYPE_ICONS[type === 'campaign_file' ? 'file' : type]?.Icon
            return (
              <button
                key={type}
                type="button"
                onClick={() => setTab(type)}
                aria-pressed={active}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '5px 11px',
                  borderRadius: 999,
                  fontSize: 12,
                  cursor: 'pointer',
                  background: active ? 'var(--gold)' : 'var(--bg-deep)',
                  border: `1px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
                  color: active ? 'var(--on-accent)' : 'var(--text-dim)',
                }}
              >
                {Icon && <Icon size={12} />} {t(`imagePicker.tab.${type}`)}
              </button>
            )
          })}
        </div>
      )}

      <div style={{ position: 'relative', marginBottom: 10 }}>
        <LuSearch
          size={14}
          style={{
            position: 'absolute',
            left: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
          }}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('imagePicker.searchPlaceholder')}
          aria-label={t('imagePicker.searchPlaceholder')}
          style={{
            width: '100%',
            padding: '8px 12px 8px 30px',
            background: 'var(--bg-deep)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            color: 'var(--text)',
            fontSize: 13,
            boxSizing: 'border-box',
          }}
        />
      </div>

      {error && (
        <div style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 8 }} role="alert">
          {error}
        </div>
      )}

      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--bg-deep)',
          overflowY: 'auto',
          padding: 10,
          // Filling: take the leftover height and scroll inside it. Otherwise a
          // short, self-sizing box, which is what a dialog wants.
          ...(fill ? { flex: 1, minHeight: 0 } : { minHeight: 150, maxHeight: 300 }),
        }}
      >
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <Spinner />
          </div>
        ) : visible.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              color: 'var(--text-muted)',
              fontSize: 13,
              padding: 24,
            }}
          >
            <LuImageOff size={22} style={{ opacity: 0.5 }} />
            {t('imagePicker.noResults')}
          </div>
        ) : (
          <>
            {groups.map((group) => (
              <ImageSourceFolder
                key={group.path}
                label={group.path || t('imagePicker.ungrouped')}
                count={group.items.length}
                open={!closed.has(group.path)}
                onToggle={() => toggleFolder(group.path)}
                showHeading={grouped}
              >
                {group.items.map((r) => {
                  const selected =
                    value?.source_type === r.resource_type && value?.source_id === r.resource_id
                  const src = r.thumb || imageSources.thumbUrl(r.resource_type, r.resource_id)
                  return (
                    <button
                      key={`${r.resource_type}:${r.resource_id}`}
                      type="button"
                      title={r.subtitle ? `${r.name} — ${r.subtitle}` : r.name}
                      aria-pressed={selected}
                      onClick={() =>
                        onChange(
                          selected
                            ? null
                            : {
                                source_type: r.resource_type,
                                source_id: r.resource_id,
                                name: r.name,
                                preview: src,
                              }
                        )
                      }
                      style={{
                        padding: 0,
                        background: 'var(--bg-card)',
                        border: `2px solid ${selected ? 'var(--gold)' : 'var(--border)'}`,
                        borderRadius: 8,
                        overflow: 'hidden',
                        cursor: 'pointer',
                        display: 'block',
                      }}
                    >
                      <LazyImg
                        src={src}
                        alt=""
                        placeholder
                        style={{
                          width: '100%',
                          height: 72,
                          objectFit: 'cover',
                          display: 'block',
                        }}
                      />
                      <span
                        style={{
                          display: 'block',
                          fontSize: 10,
                          color: selected ? 'var(--text)' : 'var(--text-muted)',
                          padding: '4px 5px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {r.name}
                      </span>
                    </button>
                  )
                })}
              </ImageSourceFolder>
            ))}
            {remaining > 0 && (
              <button
                type="button"
                onClick={() => setShown((n) => n + PAGE)}
                style={{
                  marginTop: 10,
                  width: '100%',
                  padding: '7px 0',
                  background: 'none',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--text-dim)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {t('imagePicker.loadMore', { count: remaining })}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
