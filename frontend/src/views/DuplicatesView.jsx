import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { LuArrowLeft, LuEyeOff, LuSearch, LuSquare, LuTriangleAlert } from 'react-icons/lu'

import { duplicates as dupesApi } from '../api'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import DuplicatePairRow from '../components/settings/DuplicatePairRow'
import DismissedPairRow from '../components/settings/DismissedPairRow'
import { groupsToPairs } from '../utils/duplicatePairs'
import useIsMobile from '../hooks/useIsMobile'

// Poll fast while a scan is running, slowly when idle — the same adaptive
// cadence useScanStatus uses for the library scan.
const POLL_ACTIVE = 1000
const POLL_IDLE = 30000

// The four collections detection can compare, in the order the rest of the app
// lists them. A map is never a duplicate of a book, so the scan runs each of
// these separately and skipping one is pure time saved.
const RESOURCE_TYPES = ['book', 'map', 'token', 'audio']
const ACCURACY_LEVELS = ['exact', 'high', 'medium', 'low']

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
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isMobile = useIsMobile()
  const [status, setStatus] = useState({ running: false })
  const [groups, setGroups] = useState(null)
  const [error, setError] = useState(null)
  // The last error reported by the scan status, so a successful group load
  // can clear a stale load failure without discarding a real scan failure.
  const scanErrorRef = useRef(null)
  const [starting, setStarting] = useState(false)
  // Search accuracy, chosen per scan. 'exact' is byte-identical only: fast and
  // certain. Looser levels take longer and return matches that need judging.
  // 'high' is the default: it catches the renamed-copy case that 'exact' misses
  // while still keeping false positives rare enough to review quickly.
  const [accuracy, setAccuracy] = useState('high')
  // Which collections to scan. Empty means all four - the API already treats an
  // empty list that way, so no translation is needed when nothing is ticked.
  const [resourceTypes, setResourceTypes] = useState([])
  // Dismissals are hidden by default: they are the answers the user has already
  // given, and the page is for the questions still open. Behind a toggle they
  // stay auditable without competing with the live list.
  const [showDismissed, setShowDismissed] = useState(false)
  const [dismissals, setDismissals] = useState(null)
  const [restoringId, setRestoringId] = useState(null)

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
      .catch((e) => {
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
      .catch((e) => {
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

  const restore = async (dismissal) => {
    setRestoringId(dismissal.id)
    try {
      await dupesApi.undismiss(dismissal.id)
      setDismissals((prev) => (prev || []).filter((d) => d.id !== dismissal.id))
      // The pair does not come back to the list here. Grouping applies
      // dismissals when it builds its edges, so what is on screen was computed
      // with this one still in force - only a rescan can surface it again, and
      // pretending otherwise would show a pair no action could resolve.
    } catch (e) {
      setError(e.message || t('maintenance.dupes.actionFailed'))
    } finally {
      setRestoringId(null)
    }
  }

  const toggleResourceType = (type) =>
    setResourceTypes((prev) =>
      prev.includes(type) ? prev.filter((r) => r !== type) : [...prev, type]
    )

  const startScan = async () => {
    setStarting(true)
    setError(null)
    // A new run supersedes the last one's failure.
    scanErrorRef.current = null
    try {
      await dupesApi.startScan(resourceTypes, accuracy)
      setStatus((s) => ({ ...s, running: true, phase: 'hashing' }))
    } catch (e) {
      setError(e.message || t('maintenance.dupes.scanFailed'))
    } finally {
      setStarting(false)
    }
  }

  const progress =
    status.total > 0 ? Math.min(100, Math.round((status.scanned / status.total) * 100)) : null

  // Groups are how detection stores its findings; pairs are how a person
  // reviews them. See `utils/duplicatePairs` for why the split happens here
  // rather than server-side.
  const pairs = useMemo(() => groupsToPairs(groups), [groups])

  const openCompare = useCallback(
    (pair) =>
      navigate(
        `/settings/duplicates/compare/${pair.resourceType}` +
          `?left=${encodeURIComponent(pair.parent.id)}&right=${encodeURIComponent(pair.child.id)}`
      ),
    [navigate]
  )

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
                onChange={(e) => setAccuracy(e.target.value)}
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
              onClick={() => dupesApi.cancelScan().catch(() => {})}
              style={{
                background: 'var(--bg-deep)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                borderRadius: 6,
                padding: '8px 16px',
                cursor: 'pointer',
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

      {groups !== null && !status.running && (
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12 }}>
          {pairs.length > 0
            ? t('maintenance.dupes.pairsFound', { count: pairs.length })
            : status.finished_at
              ? t('maintenance.dupes.noResults')
              : t('maintenance.dupes.notScanned')}
        </div>
      )}

      {pairs.map((pair) => (
        <DuplicatePairRow key={pair.pairKey} pair={pair} onCompare={openCompare} />
      ))}

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
const rowStyle = (isMobile) => ({
  display: 'grid',
  gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 120px) minmax(0, 1fr)',
  gap: isMobile ? 4 : 12,
  alignItems: 'start',
})

const labelStyle = (isMobile) => ({
  fontSize: 13,
  color: 'var(--text-dim)',
  paddingTop: isMobile ? 0 : 8,
})

const hintStyle = {
  fontSize: 12,
  color: 'var(--text-muted)',
  marginTop: 6,
  lineHeight: 1.5,
}

const ghostBtn = {
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
