import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { LuArrowLeft, LuSearch, LuSquare, LuTriangleAlert } from 'react-icons/lu'

import { duplicates as dupesApi } from '../api'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import DuplicatePairRow from '../components/settings/DuplicatePairRow'
import { groupsToPairs } from '../utils/duplicatePairs'

// Poll fast while a scan is running, slowly when idle — the same adaptive
// cadence useScanStatus uses for the library scan.
const POLL_ACTIVE = 1000
const POLL_IDLE = 30000

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
  const [status, setStatus] = useState({ running: false })
  const [groups, setGroups] = useState(null)
  const [error, setError] = useState(null)
  const [starting, setStarting] = useState(false)
  // Search accuracy, chosen per scan. 'exact' is byte-identical only: fast and
  // certain. Looser levels take longer and return matches that need judging.
  const [accuracy, setAccuracy] = useState('medium')

  const loadGroups = useCallback(() => {
    // Deliberately dependency-free apart from the role gate: including `t`
    // would re-create this on every language change and restart the poll loop.
    if (!isAdmin) return Promise.resolve()
    return dupesApi
      .groups({ limit: 200 })
      .then((data) => setGroups(data.groups || []))
      .catch(() => setGroups([]))
  }, [isAdmin])

  useEffect(() => {
    if (!isAdmin) return undefined
    let cancelled = false
    const tick = () => {
      dupesApi
        .scanStatus()
        .then((next) => {
          if (cancelled) return
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

  const startScan = async () => {
    setStarting(true)
    setError(null)
    try {
      await dupesApi.startScan([], accuracy)
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

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
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
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          {t('maintenance.dupes.accuracy')}
          <select
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
            {['exact', 'high', 'medium', 'low'].map((level) => (
              <option key={level} value={level}>
                {t(`maintenance.dupes.accuracyLevel.${level}`)}
              </option>
            ))}
          </select>
        </label>

        {status.running && (
          <button
            type="button"
            onClick={() => dupesApi.cancelScan().catch(() => {})}
            style={{
              background: 'var(--bg-card)',
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
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        {t(`maintenance.dupes.accuracyHint.${accuracy}`)}
      </div>

      {status.running && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 6 }}>
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
    </div>
  )
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
