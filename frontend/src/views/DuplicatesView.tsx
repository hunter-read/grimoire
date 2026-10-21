import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  LuArrowLeft,
  LuArrowRight,
  LuCombine,
  LuEyeOff,
  LuSearch,
  LuSquare,
  LuTriangleAlert,
} from 'react-icons/lu'

import { duplicates as dupesApi, type DuplicateType, type Schema } from '../api'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import DuplicateGroupRow from '../components/settings/DuplicateGroupRow'
import DismissedPairRow from '../components/settings/DismissedPairRow'
import MergeDialog from '../components/duplicates/MergeDialog'
import MergeExactDialog from '../components/duplicates/MergeExactDialog'
import {
  filterGroups,
  isExactGroup,
  pickKeeper,
  type DuplicateGroup,
  type MatchStrength,
} from '../utils/duplicateGroups'
import useIsMobile from '../hooks/useIsMobile'

type ScanStatus = Schema<'ScanStatus'>
type Dismissal = Schema<'DismissalOut'>
type Accuracy = NonNullable<Schema<'ScanRequest'>['accuracy']>

// Poll fast while a scan is running, slowly when idle — the same adaptive
// cadence useScanStatus uses for the library scan.
const POLL_ACTIVE = 1000
const POLL_IDLE = 30000

// The four collections detection can compare, in the order the rest of the app
// lists them. A map is never a duplicate of a book, so the scan runs each of
// these separately and skipping one is pure time saved.
const RESOURCE_TYPES: DuplicateType[] = ['book', 'map', 'token', 'audio']
const ACCURACY_LEVELS: Accuracy[] = ['exact', 'high', 'medium', 'low']
// How sure a group is, strongest first - the list's second filter.
const MATCH_LEVELS: MatchStrength[] = ['exact', 'text', 'metadata']

/**
 * Full-page duplicate detection, outside the settings tabs.
 *
 * A page rather than a settings section for the same reason as the file manager
 * (issue #302): reviewing groups means comparing copies side by side and acting
 * on them, which wants the whole width, and keeping destructive actions off the
 * settings tab means a stray click while changing an unrelated setting cannot
 * delete a file.
 */
export default function DuplicatesView() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isAdmin = useAuth()?.user?.role === 'admin'
  const isMobile = useIsMobile()
  const [status, setStatus] = useState<ScanStatus>({ running: false })
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The list's filters live in the URL, so the review queue walks exactly the
  // groups the list was showing, and Back returns to the same view.
  const [params, setParams] = useSearchParams()
  const filterType = params.get('type') || ''
  const filterMatch = (params.get('match') || '') as MatchStrength | ''
  const [quickMerge, setQuickMerge] = useState<DuplicateGroup | null>(null)
  const [exactOpen, setExactOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // The last error reported by the scan status, so a successful group load
  // can clear a stale load failure without discarding a real scan failure.
  const scanErrorRef = useRef<string | null>(null)
  // Set when Stop clears a scan the backend judged dead. Without Valkey the
  // status is per-process, so the very next poll may land on the *other* worker
  // - whose own dict still says running - and put the spinner straight back.
  // Held until a scan is deliberately started again, so the page stays usable.
  const clearedRef = useRef(false)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  // Search accuracy, chosen per scan. 'exact' is byte-identical only: fast and
  // certain. Looser levels take longer and return matches that need judging.
  // 'high' is the default: it catches the renamed-copy case that 'exact' misses
  // while still keeping false positives rare enough to review quickly.
  const [accuracy, setAccuracy] = useState<Accuracy>('high')
  // Which collections to scan. Empty means all four - the API already treats an
  // empty list that way, so no translation is needed when nothing is ticked.
  const [resourceTypes, setResourceTypes] = useState<DuplicateType[]>([])
  // Dismissals are hidden by default: they are the answers the user has already
  // given, and the page is for the questions still open. Behind a toggle they
  // stay auditable without competing with the live list.
  const [showDismissed, setShowDismissed] = useState(false)
  const [dismissals, setDismissals] = useState<Dismissal[] | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const loadGroups = useCallback(() => {
    // Deliberately dependency-free apart from the role gate: including `t`
    // would re-create this on every language change and restart the poll loop.
    if (!isAdmin) return Promise.resolve()
    return dupesApi
      .groups({ limit: 200 })
      .then((data) => {
        setGroups(data.groups || [])
        // Only a previous *load* failure is cleared here. A scan error comes
        // from the status poll and describes a run that really did fail, so a
        // successful list request is no reason to drop it.
        setError((prev) => (prev === scanErrorRef.current ? prev : null))
      })
      .catch((e: Error) => {
        // Surfaced rather than swallowed: an empty list and a failed request
        // look identical on screen, and reading "no duplicates found" when the
        // query actually errored is what makes this class of bug invisible.
        setGroups([])
        setError(e.message || t('maintenance.dupes.loadFailed'))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  useEffect(() => {
    if (!isAdmin) return undefined
    let cancelled = false
    const tick = () => {
      dupesApi
        .scanStatus()
        .then((next) => {
          if (cancelled) return
          // A worker that never ran the scan still reports it as running from
          // its own copy of the status. Once Stop has cleared it, that claim is
          // known to be stale and must not resurrect the spinner.
          if (next.running && clearedRef.current) return
          // The job records a crash in its status and returns normally, so
          // without this a scan that died mid-run is indistinguishable from one
          // that genuinely found nothing. Recorded before the reload below,
          // which consults the ref to decide what it may clear.
          scanErrorRef.current = next.error || null
          if (next.error) setError(next.error)
          setStatus((prev) => {
            // A run that just finished is the moment new results exist.
            if (prev.running && !next.running) loadGroups()
            return next
          })
        })
        .catch(() => {})
    }
    tick()
    const id = setInterval(tick, status.running ? POLL_ACTIVE : POLL_IDLE)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [status.running, loadGroups, isAdmin])

  useEffect(() => {
    loadGroups()
  }, [loadGroups])

  const loadDismissals = useCallback(() => {
    if (!isAdmin) return Promise.resolve()
    return dupesApi
      .dismissals()
      .then((data) => setDismissals(data.dismissals || []))
      .catch((e: Error) => {
        // Same reasoning as the group load: an empty list and a failed request
        // are indistinguishable on screen, and "nothing dismissed" is exactly
        // the wrong thing to tell someone looking for a dismissal they made.
        setDismissals([])
        setError(e.message || t('maintenance.dupes.loadFailed'))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  // Fetched on demand rather than alongside the groups: most visits never open
  // the panel, and the list is only needed once it is on screen.
  useEffect(() => {
    if (showDismissed) loadDismissals()
  }, [showDismissed, loadDismissals])

  const restore = async (dismissal: Dismissal) => {
    setRestoringId(dismissal.id)
    try {
      await dupesApi.undismiss(dismissal.id)
      setDismissals((prev) => (prev || []).filter((d) => d.id !== dismissal.id))
      // The pair does not come back to the list here. Grouping applies
      // dismissals when it builds its edges, so what is on screen was computed
      // with this one still in force - only a rescan can surface it again, and
      // pretending otherwise would show a pair no action could resolve.
    } catch (e) {
      setError((e as Error).message || t('maintenance.dupes.actionFailed'))
    } finally {
      setRestoringId(null)
    }
  }

  const toggleResourceType = (type: DuplicateType) =>
    setResourceTypes((prev) =>
      prev.includes(type) ? prev.filter((r) => r !== type) : [...prev, type]
    )

  const startScan = async () => {
    setStarting(true)
    setError(null)
    // A new run supersedes the last one's failure, and its progress is real
    // again - so stop suppressing the status poll's running flag.
    scanErrorRef.current = null
    clearedRef.current = false
    try {
      await dupesApi.startScan(resourceTypes, accuracy)
      setStatus((s) => ({ ...s, running: true, phase: 'hashing' }))
    } catch (e) {
      setError((e as Error).message || t('maintenance.dupes.scanFailed'))
    } finally {
      setStarting(false)
    }
  }

  // Stop used to discard its result entirely, which made the two ways it can
  // legitimately not stop the scan look identical to a broken button: the
  // request failing, and the scan already being gone. Both are reported now,
  // and a cleared-out stuck scan updates the status immediately rather than
  // waiting for the next poll.
  const cancelScan = async () => {
    setStopping(true)
    try {
      const result = await dupesApi.cancelScan()
      if (result?.status === 'cleared_stale' || result?.status === 'not_running') {
        clearedRef.current = true
        setStatus((s) => ({ ...s, running: false, phase: null }))
        loadGroups()
      }
    } catch (e) {
      setError((e as Error).message || t('maintenance.dupes.cancelFailed'))
    } finally {
      setStopping(false)
    }
  }

  const progress =
    status.total && status.total > 0
      ? Math.min(100, Math.round(((status.scanned || 0) / status.total) * 100))
      : null

  // A group is the unit of review now that a merge moves everything that
  // pointed at a copy (issue #589): one decision settles all of its copies.
  const shown = useMemo(
    () => filterGroups(groups, { type: filterType, match: filterMatch }),
    [groups, filterType, filterMatch]
  )
  const exactGroups = useMemo(() => shown.filter(isExactGroup), [shown])
  const typesPresent = useMemo(
    () => [...new Set((groups || []).map((g) => g.resource_type))],
    [groups]
  )

  const setFilter = (key: 'type' | 'match', value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true }
    )

  // Into the review queue at `group`, carrying the filters so it walks the
  // same list.
  const openReview = useCallback(
    (group: DuplicateGroup) => {
      const qs = new URLSearchParams({ group: group.id })
      if (filterType) qs.set('type', filterType)
      if (filterMatch) qs.set('match', filterMatch)
      navigate(`/settings/duplicates/compare/${group.resource_type}?${qs}`)
    },
    [navigate, filterType, filterMatch]
  )

  const dropGroup = (id: string) => setGroups((prev) => (prev || []).filter((g) => g.id !== id))

  if (!isAdmin) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)' }}>
        {t('maintenance.dupes.adminOnly')}
      </div>
    )
  }

  return (
    <div
      style={{
        padding: '16px 24px 40px',
        maxWidth: 1100,
        width: '100%',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <button onClick={() => navigate('/settings/maintenance')} style={ghostBtn}>
          <LuArrowLeft size={14} /> {t('files.backToSettings')}
        </button>
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 6px' }}>
        {t('maintenance.dupes.title')}
      </h2>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('maintenance.dupes.description')}
      </p>

      {/* One panel rather than a button, a loose label, a hint line and a
          bordered fieldset stacked down the page: the accuracy and the
          collections are two settings for the same action, and the button that
          consumes them belongs with them rather than floating above. */}
      <section
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 16,
          marginBottom: 20,
        }}
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={rowStyle(isMobile)}>
            <label htmlFor="dupes-accuracy" style={labelStyle(isMobile)}>
              {t('maintenance.dupes.accuracy')}
            </label>
            <div>
              <select
                id="dupes-accuracy"
                value={accuracy}
                onChange={(e) => setAccuracy(e.target.value as Accuracy)}
                disabled={status.running || starting}
                style={{
                  background: 'var(--bg-deep)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  borderRadius: 6,
                  padding: '7px 10px',
                  fontSize: 13,
                }}
              >
                {ACCURACY_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t(`maintenance.dupes.accuracyLevel.${level}`)}
                  </option>
                ))}
              </select>
              {/* Directly under the control it describes, so the hint reads as
                  part of the choice instead of a stray line of page text. */}
              <div style={hintStyle}>{t(`maintenance.dupes.accuracyHint.${accuracy}`)}</div>
            </div>
          </div>

          <div style={rowStyle(isMobile)}>
            <span id="dupes-collections" style={labelStyle(isMobile)}>
              {t('maintenance.dupes.collections')}
            </span>
            <div>
              <div
                role="group"
                aria-labelledby="dupes-collections"
                style={{ display: 'flex', flexWrap: 'wrap', gap: 14, paddingTop: 6 }}
              >
                {RESOURCE_TYPES.map((type) => (
                  <label
                    key={type}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
                  >
                    <input
                      type="checkbox"
                      checked={resourceTypes.includes(type)}
                      onChange={() => toggleResourceType(type)}
                      disabled={status.running || starting}
                    />
                    {t(`maintenance.dupes.collection.${type}`)}
                  </label>
                ))}
              </div>
              <div style={hintStyle}>
                {resourceTypes.length === 0
                  ? t('maintenance.dupes.collectionsAllHint')
                  : t('maintenance.dupes.collectionsSomeHint', { count: resourceTypes.length })}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginTop: 16,
            paddingTop: 14,
            borderTop: '1px solid var(--border)',
          }}
        >
          <button
            type="button"
            onClick={startScan}
            disabled={status.running || starting}
            style={{
              background: 'var(--gold-dim)',
              color: 'var(--bg-deep)',
              border: 'none',
              borderRadius: 6,
              padding: '8px 18px',
              cursor: status.running ? 'default' : 'pointer',
              fontSize: 14,
              opacity: status.running || starting ? 0.6 : 1,
            }}
          >
            {status.running || starting ? <Spinner size={13} /> : <LuSearch size={13} />}{' '}
            {status.running ? t('maintenance.dupes.scanning') : t('maintenance.dupes.scan')}
          </button>

          {status.running && (
            <button
              type="button"
              onClick={cancelScan}
              disabled={stopping}
              style={{
                background: 'var(--bg-deep)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                borderRadius: 6,
                padding: '8px 16px',
                cursor: stopping ? 'default' : 'pointer',
                opacity: stopping ? 0.6 : 1,
                fontSize: 14,
              }}
            >
              <LuSquare size={12} aria-hidden="true" /> {t('maintenance.dupes.cancel')}
            </button>
          )}

          {/* Progress sits on the same row as the button that started it, and
              takes the remaining width rather than pushing the results down. */}
          {status.running && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-dim)',
                  marginBottom: 5,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {status.resource_type ? `${status.resource_type} · ` : ''}
                {status.phase}
                {progress !== null ? ` · ${progress}%` : ''}
              </div>
              <div style={{ height: 4, background: 'var(--border)', borderRadius: 2 }}>
                <div
                  style={{
                    height: '100%',
                    width: `${progress ?? 100}%`,
                    background: 'var(--gold)',
                    borderRadius: 2,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {error && (
        <div style={{ fontSize: 14, color: 'var(--danger)', marginBottom: 12 }}>
          <LuTriangleAlert size={14} aria-hidden="true" /> {error}
        </div>
      )}

      {notice && (
        <div role="status" style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 12 }}>
          {notice}
        </div>
      )}

      {groups !== null && groups.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            marginBottom: 14,
          }}
        >
          <select
            aria-label={t('maintenance.dupes.filterType')}
            value={filterType}
            onChange={(e) => setFilter('type', e.target.value)}
            style={selectStyle}
          >
            <option value="">{t('maintenance.dupes.allTypes')}</option>
            {typesPresent.map((type) => (
              <option key={type} value={type}>
                {t(`maintenance.dupes.collection.${type}`, { defaultValue: type })}
              </option>
            ))}
          </select>
          <select
            aria-label={t('maintenance.dupes.filterMatch')}
            value={filterMatch}
            onChange={(e) => setFilter('match', e.target.value)}
            style={selectStyle}
          >
            <option value="">{t('maintenance.dupes.allMatches')}</option>
            {MATCH_LEVELS.map((level) => (
              <option key={level} value={level}>
                {t(`maintenance.dupes.match.${level}`)}
              </option>
            ))}
          </select>
          <span style={{ flex: 1 }} />
          {exactGroups.length > 0 && !status.running && (
            <button type="button" onClick={() => setExactOpen(true)} style={ghostBtn}>
              <LuCombine size={13} aria-hidden="true" />{' '}
              {t('maintenance.dupes.mergeExact.button', { count: exactGroups.length })}
            </button>
          )}
          {shown.length > 0 && !status.running && (
            <button
              type="button"
              onClick={() => openReview(shown[0])}
              style={{ ...ghostBtn, color: 'var(--text)' }}
            >
              {t('maintenance.dupes.review.start')} <LuArrowRight size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {groups !== null && !status.running && (
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12 }}>
          {shown.length > 0
            ? t('maintenance.dupes.groupsFound', { count: shown.length })
            : groups.length > 0
              ? t('maintenance.dupes.noneMatchFilters')
              : status.finished_at
                ? t('maintenance.dupes.noResults')
                : t('maintenance.dupes.notScanned')}
        </div>
      )}

      {shown.map((group) => (
        <DuplicateGroupRow
          key={group.id}
          group={group}
          onReview={openReview}
          onMerge={setQuickMerge}
        />
      ))}

      {quickMerge && (
        <MergeDialog
          resourceType={quickMerge.resource_type as DuplicateType}
          ids={(quickMerge.members || []).map((m) => m.id)}
          keepId={pickKeeper(quickMerge)?.id}
          onClose={() => setQuickMerge(null)}
          onDone={() => {
            dropGroup(quickMerge.id)
            setQuickMerge(null)
          }}
        />
      )}

      {exactOpen && (
        <MergeExactDialog
          groups={exactGroups}
          onClose={() => setExactOpen(false)}
          onDone={({ merged, failed }) => {
            setExactOpen(false)
            setNotice(t('maintenance.dupes.mergeExact.done', { count: merged, failed }))
            loadGroups()
          }}
        />
      )}

      <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <button
          type="button"
          onClick={() => setShowDismissed((v) => !v)}
          aria-expanded={showDismissed}
          style={ghostBtn}
        >
          <LuEyeOff size={13} aria-hidden="true" />{' '}
          {showDismissed
            ? t('maintenance.dupes.hideDismissed')
            : t('maintenance.dupes.showDismissed')}
        </button>

        {showDismissed && (
          <div style={{ marginTop: 14 }}>
            <p
              style={{
                fontSize: 13,
                color: 'var(--text-dim)',
                marginBottom: 12,
                lineHeight: 1.6,
              }}
            >
              {t('maintenance.dupes.dismissedHint')}
            </p>

            {dismissals === null ? (
              <Spinner size={16} />
            ) : dismissals.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                {t('maintenance.dupes.noDismissals')}
              </div>
            ) : (
              dismissals.map((d) => (
                <DismissedPairRow
                  key={d.id}
                  dismissal={d}
                  onRestore={restore}
                  busy={restoringId === d.id}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// The two option rows share a label column so the controls line up. On a phone
// that gutter is most of the width, so the label stacks above its control
// instead.
const rowStyle = (isMobile: boolean): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 120px) minmax(0, 1fr)',
  gap: isMobile ? 4 : 12,
  alignItems: 'start',
})

const labelStyle = (isMobile: boolean): CSSProperties => ({
  fontSize: 13,
  color: 'var(--text-dim)',
  paddingTop: isMobile ? 0 : 8,
})

const hintStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  marginTop: 6,
  lineHeight: 1.5,
}

const selectStyle: CSSProperties = {
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 13,
}

const ghostBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 12px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-dim)',
}
