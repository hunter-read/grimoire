import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuLink, LuSearch, LuTriangleAlert, LuX } from 'react-icons/lu'
import api from '../../api'
import ItemCarouselNav from '../ItemCarouselNav'
import Spinner from '../Spinner'
import { defaultSelection } from './metadataFieldValue'
import MetadataFieldReview from './MetadataFieldReview'
import MetadataResultList from './MetadataResultList'
import useMetadataSources from './useMetadataSources'

/**
 * Review-and-merge dialog for fetching metadata from an add-on (issue #203).
 *
 * Three steps in one panel: pick a source, pick a match, then review a
 * per-field diff and apply only the fields you ticked. Fetching never writes —
 * applying is an ordinary PATCH of just the selected fields, so nothing can be
 * overwritten without an explicit choice. Fields the resource already has are
 * left unchecked by default.
 *
 * Serves both game systems and books; `resource` and `kind` decide which API
 * path is used and what the search defaults to.
 *
 * Bulk edit drives it as a loop over the selection (issue #466): it searches on
 * open, remembers the chosen source between items, and offers "Skip" and
 * "Apply & next" so a whole selection can be worked through without leaving
 * the dialog. Focus follows the flow — the first match after a search, then
 * the apply button — so each item can be Enter, Enter. "Previous" steps back,
 * and each item's search is handed out through `onRemember` and back in through
 * `remembered`, so returning to an item shows its results as they were (with
 * the match picked last time marked) instead of searching again.
 *
 * Props:
 *   resource        – the game system or book being edited
 *   kind            – 'systems' | 'books' (the API collection)
 *   onApply         – (fields) => void, called after a successful PATCH. The
 *                     caller owns merging them into its own form state.
 *   onClose         – () => void
 *   autoSearch      – search for the resource's name as soon as a source is known
 *   initialSourceId – the source to start on, when it is still installed
 *   onSourceChange  – (sourceId) => void, so a caller can carry the choice over
 *   position        – where this item sits in a batch, e.g. "3 of 40"; when
 *                     given, the bulk editor's item navigation bar is shown
 *   itemName        – the item's name, shown in that bar
 *   onNext          – () => void; skips forward, and offers "Apply & next"
 *   onPrev          – () => void; steps back to the previous item
 *   remembered      – { sourceId, query, results, picked } saved for this item
 *   onRemember      – (state) => void, called as that state changes
 *   applied         – fields an earlier fetch wrote to this item, which a new
 *                     match may replace without the usual "differs" caution
 */
export default function MetadataFetchDialog({
  resource,
  kind = 'systems',
  onApply,
  onClose,
  autoSearch = false,
  initialSourceId = '',
  onSourceChange,
  position,
  itemName,
  onNext,
  onPrev,
  remembered,
  onRemember,
  applied,
}) {
  const { t } = useTranslation()
  const {
    sources,
    loading: loadingSources,
    error: sourcesError,
  } = useMetadataSources(kind, resource.id)
  const [sourceId, setSourceId] = useState(remembered?.sourceId || initialSourceId)
  const [query, setQuery] = useState(remembered?.query ?? (resource.name || resource.title || ''))
  const [results, setResults] = useState(remembered?.results ?? null)
  // The match chosen last time on this item, marked in the list on return.
  const [picked, setPicked] = useState(remembered?.picked ?? null)
  const [detail, setDetail] = useState(null)
  const [selected, setSelected] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // "I already know exactly which one" — a pasted source URL or bare ID, which
  // skips searching entirely. Only offered by sources that can parse one.
  const [paste, setPaste] = useState('')
  const [pasting, setPasting] = useState(false)

  const searchRef = useRef(null)
  const primaryRef = useRef(null)
  const fallbackRef = useRef(null)
  // Returning to an item with results already in hand counts as searched.
  const autoSearched = useRef(!!remembered?.results)

  // Hand the search back to the caller as it changes. Kept in a ref so a new
  // callback identity each parent render does not re-fire the effect.
  const rememberRef = useRef(onRemember)
  rememberRef.current = onRemember
  useEffect(() => {
    rememberRef.current?.({ sourceId, query, results, picked })
  }, [sourceId, query, results, picked])

  const activeSource = sources.find((s) => s.id === sourceId)
  const supportsPaste = !!activeSource?.supports_paste

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Default to the first source once the list is known, without clobbering a
  // choice the user already made.
  useEffect(() => {
    if (sources.length && !sources.some((s) => s.id === sourceId)) setSourceId(sources[0].id)
  }, [sources, sourceId])

  const pickSource = (id) => {
    setSourceId(id)
    onSourceChange?.(id)
  }

  const runSearch = useCallback(() => {
    if (!sourceId) return
    setBusy(true)
    setError('')
    setDetail(null)
    api
      .post(`/${kind}/${resource.id}/metadata-search`, { source_id: sourceId, query })
      .then((data) => {
        const found = data.results || []
        setResults(found)
        // Nothing to pick, so the next useful keystroke is a better query.
        if (!found.length) searchRef.current?.focus()
      })
      .catch((e) => {
        setError(e.message)
        setResults(null)
        searchRef.current?.focus()
      })
      .finally(() => setBusy(false))
  }, [kind, sourceId, query, resource.id])

  // One search per open, and only once there is an installed source to ask —
  // the list may still be loading, and a remembered source may since have been
  // removed (the effect above then swaps in the first one).
  const hasActiveSource = !!activeSource
  useEffect(() => {
    if (!autoSearch || autoSearched.current || !hasActiveSource || !query.trim()) return
    autoSearched.current = true
    runSearch()
  }, [autoSearch, hasActiveSource, query, runSearch])

  // Land on the apply button once a match's fields are in, so Enter applies.
  // When there is nothing to apply it is disabled and cannot take focus, so
  // fall back to moving on (or back).
  useEffect(() => {
    if (!detail) return
    ;(primaryRef.current && !primaryRef.current.disabled
      ? primaryRef.current
      : fallbackRef.current
    )?.focus()
  }, [detail])

  // Both entry points — picking a search result, and pasting a link/ID — land
  // on the same review step, so they share one fetch.
  const fetchCandidate = (body) => {
    setBusy(true)
    setError('')
    api
      .post(`/${kind}/${resource.id}/metadata-fetch`, {
        source_id: sourceId,
        // Search-backed sources answer per query rather than serving a whole
        // catalogue, so echo back the query this candidate came from.
        query,
        ...body,
      })
      // `busy` is cleared alongside the result rather than in a `finally`, so
      // the review step's first render already has an enabled apply button
      // for the focus effect to land on.
      .then((data) => {
        setBusy(false)
        setSelected(defaultSelection(data.fields || [], applied))
        setDetail(data)
      })
      .catch((e) => {
        setBusy(false)
        setError(e.message)
      })
  }

  const choose = (identity) => {
    setPicked(identity)
    fetchCandidate({ identity })
  }

  const submitPaste = () => {
    if (!paste.trim()) return
    fetchCandidate({ paste })
  }

  const toggle = (field) =>
    setSelected((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    )

  const apply = (advance) => {
    const payload = {}
    for (const row of detail.fields) {
      if (selected.includes(row.field)) payload[row.field] = row.incoming
    }
    setBusy(true)
    api
      .patch(`/${kind}/${resource.id}`, payload)
      .then(() => {
        onApply(payload)
        if (advance) onNext()
        else onClose()
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false))
  }

  const canApply = !busy && selected.length > 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="metadata-fetch-title"
      style={overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div style={panel}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <span id="metadata-fetch-title" style={{ fontSize: 16, fontWeight: 600 }}>
            {t('metadataFetch.title')}
          </span>
          <button onClick={onClose} aria-label={t('common.close')} style={closeBtn}>
            <LuX size={16} />
          </button>
        </div>

        {/* Which item of the batch this is, and a way back or past it that
            works at every step — a search with no good match is the commonest
            reason to move on, a wrong match on a look-alike to go back. */}
        {position && (
          <div style={{ marginBottom: 12 }}>
            <ItemCarouselNav
              title={itemName}
              subtitle={position}
              onPrev={onPrev}
              onNext={onNext}
              prevLabel={t('bulkEdit.previous')}
              // Moving on from here applies nothing, so it says so.
              nextLabel={t('metadataFetch.skip')}
              nextRef={onNext ? fallbackRef : undefined}
            />
          </div>
        )}

        {/* Only claim there are no sources once we actually know — showing this
            while the list is still loading reads as "no scrapers installed"
            and then flips, which is worse than showing nothing. */}
        {loadingSources && <Spinner />}

        {!loadingSources && sources.length === 0 && !error && !sourcesError && (
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>{t('metadataFetch.noSources')}</p>
        )}

        {sources.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <select
              value={sourceId}
              onChange={(e) => pickSource(e.target.value)}
              aria-label={t('metadataFetch.source')}
              style={field}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runSearch()
              }}
              placeholder={t('metadataFetch.searchPlaceholder')}
              aria-label={t('metadataFetch.searchPlaceholder')}
              style={{ ...field, flex: 1, minWidth: 180 }}
            />
            <button
              onClick={runSearch}
              disabled={busy || !sourceId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 6,
                background: 'var(--gold-dim)',
                color: 'var(--bg-deep)',
                fontWeight: 600,
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              <LuSearch size={14} />
              {t('metadataFetch.search')}
            </button>
          </div>
        )}

        {sources.length > 0 && supportsPaste && !detail && (
          <div style={{ marginBottom: 12 }}>
            {!pasting ? (
              <button
                onClick={() => setPasting(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                <LuLink size={12} />
                {t('metadataFetch.pasteToggle')}
              </button>
            ) : (
              <div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitPaste()}
                    placeholder={t('metadataFetch.pastePlaceholder')}
                    aria-label={t('metadataFetch.pasteLabel')}
                    autoFocus
                    style={{ ...field, flex: 1, minWidth: 200 }}
                  />
                  <button
                    onClick={submitPaste}
                    disabled={busy || !paste.trim()}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'none',
                      color: paste.trim() ? 'var(--text)' : 'var(--text-muted)',
                      cursor: paste.trim() ? 'pointer' : 'default',
                    }}
                  >
                    {t('metadataFetch.pasteUse')}
                  </button>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>
                  {t('metadataFetch.pasteHint')}
                </p>
              </div>
            )}
          </div>
        )}

        {(error || sourcesError) && (
          <p
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: 'var(--danger, #c0392b)',
              marginBottom: 12,
            }}
          >
            <LuTriangleAlert size={14} />
            {error || sourcesError}
          </p>
        )}

        {busy && <Spinner />}

        {!detail && results !== null && results.length === 0 && !busy && (
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>{t('metadataFetch.noMatches')}</p>
        )}

        {!detail && results?.length > 0 && (
          <>
            <MetadataResultList
              results={results}
              picked={picked}
              onChoose={choose}
              onExitTop={() => searchRef.current?.focus()}
            />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 0' }}>
              {t('metadataFetch.keyboardHint')}
            </p>
          </>
        )}

        {detail && (
          <div>
            <MetadataFieldReview detail={detail} selected={selected} onToggle={toggle} />

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {onNext ? (
                <>
                  <button
                    ref={primaryRef}
                    onClick={() => apply(true)}
                    disabled={!canApply}
                    style={primaryBtn(canApply)}
                  >
                    {t('metadataFetch.applyAndNext', { count: selected.length })}
                  </button>
                  <button onClick={() => apply(false)} disabled={!canApply} style={secondaryBtn}>
                    {t('metadataFetch.apply', { count: selected.length })}
                  </button>
                </>
              ) : (
                <button
                  ref={primaryRef}
                  onClick={() => apply(false)}
                  disabled={!canApply}
                  style={primaryBtn(canApply)}
                >
                  {t('metadataFetch.apply', { count: selected.length })}
                </button>
              )}
              <button
                ref={onNext ? undefined : fallbackRef}
                onClick={() => setDetail(null)}
                style={secondaryBtn}
              >
                {t('metadataFetch.back')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const overlay = {
  position: 'fixed',
  inset: 0,
  zIndex: 1200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--scrim)',
}
const panel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: 24,
  width: 640,
  maxWidth: '94vw',
  maxHeight: '88vh',
  overflowY: 'auto',
  boxSizing: 'border-box',
}
const closeBtn = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  display: 'flex',
  padding: 2,
}
const field = {
  padding: '8px 10px',
  borderRadius: 6,
  background: 'var(--bg-deep)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
}
const primaryBtn = (enabled) => ({
  padding: '10px 24px',
  borderRadius: 6,
  background: enabled ? 'var(--gold-dim)' : 'var(--bg-deep)',
  color: enabled ? 'var(--bg-deep)' : 'var(--text-muted)',
  fontWeight: 600,
  cursor: enabled ? 'pointer' : 'default',
})
const secondaryBtn = {
  padding: '10px 16px',
  borderRadius: 6,
  background: 'none',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  cursor: 'pointer',
}
