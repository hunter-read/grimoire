import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTrash2, LuCircleCheck, LuRefreshCw, LuSquare, LuDownload } from 'react-icons/lu'
import api, { settings as settingsApi, mediaUrl } from '../../api'
import Spinner from '../Spinner'

// ---------------------------------------------------------------------------
// Manual Rescan section
// ---------------------------------------------------------------------------

function RescanSection() {
  const { t } = useTranslation()
  const [status, setStatus] = useState({
    running: false,
    phase: null,
    total_books: 0,
    scanned_books: 0,
    total_maps: 0,
    scanned_maps: 0,
    total_tokens: 0,
    scanned_tokens: 0,
    indexed: 0,
    to_index: 0,
    new_books: 0,
    new_maps: 0,
    new_tokens: 0,
  })
  const [lastResult, setLastResult] = useState(null)
  const [stopping, setStopping] = useState(false)

  useEffect(() => {
    const poll = () => {
      api
        .get('/scan-status')
        .then((s) => {
          setStatus(s)
          if (!s.running) {
            const total = s.new_books + s.new_maps + s.new_tokens
            if (total > 0 || s.indexed > 0) setLastResult(s)
          }
        })
        .catch(() => {})
    }

    poll()
    const id = setInterval(poll, status.running ? 1000 : 30000)
    return () => clearInterval(id)
  }, [status.running])

  const handleRescan = async () => {
    if (status.running) return
    setLastResult(null)
    setStopping(false)
    setStatus((s) => ({ ...s, running: true, phase: 'scanning' }))
    try {
      await api.post('/rescan')
    } catch (_) {
      setStatus((s) => ({ ...s, running: false, phase: null }))
    }
  }

  const handleStop = async () => {
    setStopping(true)
    try {
      await api.post('/cancel-scan')
    } catch (_) {}
  }

  const {
    running,
    phase,
    indexed,
    to_index,
    total_books,
    scanned_books,
    total_maps,
    scanned_maps,
    total_tokens,
    scanned_tokens,
  } = status

  const totalScan = total_books + total_maps + total_tokens
  const scannedScan = scanned_books + scanned_maps + scanned_tokens
  const scanPct = totalScan > 0 ? Math.round((scannedScan / totalScan) * 100) : null
  const indexPct = to_index > 0 ? Math.round((indexed / to_index) * 100) : 0

  const phaseLabel =
    phase === 'scanning'
      ? scanPct !== null
        ? t('maintenance.rescan.scanningPercent', { pct: scanPct })
        : t('maintenance.rescan.scanning')
      : phase === 'indexing'
        ? t('maintenance.rescan.indexing', { indexed, total: to_index })
        : t('maintenance.rescan.scanning')

  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        {t('maintenance.rescan.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('maintenance.rescan.description')}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={handleRescan}
          disabled={running}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 18px',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            color: running ? 'var(--gold)' : 'var(--text-dim)',
            cursor: running ? 'default' : 'pointer',
          }}
        >
          {running ? <Spinner size={13} /> : <LuRefreshCw size={13} />}
          {running ? phaseLabel : t('maintenance.rescan.button')}
        </button>
        {running && (
          <button
            onClick={handleStop}
            disabled={stopping}
            title={t('maintenance.rescan.stop')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              background: 'rgba(180,60,60,0.12)',
              border: '1px solid rgba(180,60,60,0.35)',
              color: stopping ? 'var(--text-muted)' : '#e07070',
              cursor: stopping ? 'default' : 'pointer',
            }}
          >
            <LuSquare size={13} />
            {stopping ? t('maintenance.rescan.stopping') : t('maintenance.rescan.stop')}
          </button>
        )}
      </div>

      {/* Progress bar — scanning phase */}
      {running && phase === 'scanning' && (
        <div style={{ marginTop: 12, maxWidth: 360 }}>
          <div
            style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}
          >
            {scanPct !== null ? (
              <div
                style={{
                  height: '100%',
                  borderRadius: 2,
                  background: 'var(--gold)',
                  width: `${scanPct}%`,
                  transition: 'width 0.4s ease',
                }}
              />
            ) : (
              <div
                style={{
                  height: '100%',
                  borderRadius: 2,
                  background: 'var(--gold)',
                  width: '40%',
                  animation: 'grimoire-scan-slide 1.4s ease-in-out infinite',
                }}
              />
            )}
          </div>
          {scanPct !== null && (
            <div
              style={{
                marginTop: 5,
                fontSize: 12,
                color: 'var(--text-muted)',
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <span>
                {t('maintenance.rescan.scanProgress', {
                  pct: scanPct,
                  scanned: scannedScan,
                  total: totalScan,
                })}
              </span>
              <span>
                {t('maintenance.rescan.booksProgress', {
                  scanned: scanned_books,
                  total: total_books,
                })}
              </span>
              <span>
                {t('maintenance.rescan.mapsProgress', { scanned: scanned_maps, total: total_maps })}
              </span>
              <span>
                {t('maintenance.rescan.tokensProgress', {
                  scanned: scanned_tokens,
                  total: total_tokens,
                })}
              </span>
            </div>
          )}
          <style>{`
            @keyframes grimoire-scan-slide {
              0%   { margin-left: -40%; }
              100% { margin-left: 100%; }
            }
          `}</style>
        </div>
      )}

      {/* Progress bar — PDF indexing phase */}
      {running && phase === 'indexing' && to_index > 0 && (
        <div style={{ marginTop: 12, maxWidth: 360 }}>
          <div
            style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}
          >
            <div
              style={{
                height: '100%',
                borderRadius: 2,
                background: 'var(--gold)',
                width: `${indexPct}%`,
                transition: 'width 0.4s ease',
              }}
            />
          </div>
          <div style={{ marginTop: 5, fontSize: 12, color: 'var(--text-muted)' }}>
            {t('maintenance.rescan.indexProgress', { pct: indexPct, indexed, total: to_index })}
          </div>
        </div>
      )}

      {/* Completion summary */}
      {lastResult && !running && (
        <div
          style={{
            marginTop: 16,
            padding: '12px 16px',
            borderRadius: 8,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <LuCircleCheck size={16} color="var(--green)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>
              {t('maintenance.rescan.complete')}
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                display: 'flex',
                gap: 14,
                flexWrap: 'wrap',
              }}
            >
              {lastResult.new_books > 0 && (
                <span>{t('maintenance.rescan.books', { count: lastResult.new_books })}</span>
              )}
              {lastResult.new_maps > 0 && (
                <span>{t('maintenance.rescan.maps', { count: lastResult.new_maps })}</span>
              )}
              {lastResult.new_tokens > 0 && (
                <span>{t('maintenance.rescan.tokens', { count: lastResult.new_tokens })}</span>
              )}
              {lastResult.indexed > 0 && (
                <span>{t('maintenance.rescan.indexed', { count: lastResult.indexed })}</span>
              )}
              {lastResult.new_books +
                lastResult.new_maps +
                lastResult.new_tokens +
                lastResult.indexed ===
                0 && <span>{t('maintenance.rescan.noNewFiles')}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Convert UTC hour+minute to a local "HH:MM" string for display
function utcToLocalTime(utcHour, utcMinute) {
  const d = new Date()
  d.setUTCHours(utcHour, utcMinute, 0, 0)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Parse a local "HH:MM" string and return { hour, minute } in UTC
function localTimeToUtc(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}

// ---------------------------------------------------------------------------
// Scheduled Rescan section
// ---------------------------------------------------------------------------

function ScheduledRescanSection() {
  const { t } = useTranslation()
  const [schedule, setSchedule] = useState('off')
  const [localTime, setLocalTime] = useState('02:00')
  const [weekday, setWeekday] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const SCHEDULE_OPTIONS = [
    { value: 'off', label: t('maintenance.scheduledRescan.off') },
    { value: 'hourly', label: t('maintenance.scheduledRescan.hourly') },
    { value: 'daily', label: t('maintenance.scheduledRescan.daily') },
    { value: 'weekly', label: t('maintenance.scheduledRescan.weekly') },
  ]

  const WEEKDAY_OPTIONS = [
    { value: 0, label: t('maintenance.scheduledRescan.weekdays.mon') },
    { value: 1, label: t('maintenance.scheduledRescan.weekdays.tue') },
    { value: 2, label: t('maintenance.scheduledRescan.weekdays.wed') },
    { value: 3, label: t('maintenance.scheduledRescan.weekdays.thu') },
    { value: 4, label: t('maintenance.scheduledRescan.weekdays.fri') },
    { value: 5, label: t('maintenance.scheduledRescan.weekdays.sat') },
    { value: 6, label: t('maintenance.scheduledRescan.weekdays.sun') },
  ]

  useEffect(() => {
    settingsApi
      .get()
      .then((data) => {
        setSchedule(data.rescan_schedule_enabled ? data.rescan_schedule_interval : 'off')
        setLocalTime(
          utcToLocalTime(data.rescan_schedule_hour ?? 2, data.rescan_schedule_minute ?? 0)
        )
        setWeekday(data.rescan_schedule_weekday ?? 0)
      })
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const { hour, minute } = localTimeToUtc(localTime)
      const data = await settingsApi.patch({
        rescan_schedule_enabled: schedule !== 'off',
        rescan_schedule_interval: schedule === 'off' ? 'daily' : schedule,
        rescan_schedule_hour: hour,
        rescan_schedule_minute: minute,
        rescan_schedule_weekday: weekday,
      })
      setSchedule(data.rescan_schedule_enabled ? data.rescan_schedule_interval : 'off')
      setLocalTime(utcToLocalTime(data.rescan_schedule_hour, data.rescan_schedule_minute))
      setWeekday(data.rescan_schedule_weekday)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  const showTimePicker = schedule === 'daily' || schedule === 'weekly'

  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        {t('maintenance.scheduledRescan.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('maintenance.scheduledRescan.description')}
      </p>

      {loading ? (
        <Spinner size={20} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Frequency */}
          <div
            style={{
              display: 'flex',
              border: '1px solid var(--border)',
              borderRadius: 6,
              overflow: 'hidden',
              width: 'fit-content',
            }}
          >
            {SCHEDULE_OPTIONS.map(({ value, label }, idx) => (
              <button
                key={value}
                onClick={() => setSchedule(value)}
                style={{
                  padding: '7px 18px',
                  fontSize: 14,
                  cursor: 'pointer',
                  border: 'none',
                  borderRight:
                    idx < SCHEDULE_OPTIONS.length - 1 ? '1px solid var(--border)' : 'none',
                  background: schedule === value ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                  color: schedule === value ? 'var(--gold)' : 'var(--text-dim)',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Day picker (weekly only) */}
          {schedule === 'weekly' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--text-dim)', minWidth: 28 }}>
                {t('maintenance.scheduledRescan.on')}
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {WEEKDAY_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setWeekday(value)}
                    style={{
                      padding: '6px 12px',
                      fontSize: 13,
                      cursor: 'pointer',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      background: weekday === value ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                      color: weekday === value ? 'var(--gold)' : 'var(--text-dim)',
                      transition: 'background 0.15s, color 0.15s',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Time picker (daily + weekly) */}
          {showTimePicker && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--text-dim)', minWidth: 28 }}>
                {t('maintenance.scheduledRescan.at')}
              </span>
              <input
                type="time"
                value={localTime}
                onChange={(e) => setLocalTime(e.target.value)}
                style={{
                  fontSize: 14,
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  colorScheme: 'dark',
                }}
              />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {t('maintenance.scheduledRescan.localTime')}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 18px',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                background: 'var(--gold-dim)',
                border: 'none',
                color: 'var(--bg-deep)',
                cursor: saving ? 'default' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? <Spinner size={13} /> : <LuRefreshCw size={13} />}
              {saving
                ? t('maintenance.scheduledRescan.saving')
                : t('maintenance.scheduledRescan.saveSchedule')}
            </button>
            {saved && (
              <span
                style={{
                  fontSize: 13,
                  color: 'var(--green)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <LuCircleCheck size={14} /> {t('maintenance.scheduledRescan.saved')}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Database Cleanup section
// ---------------------------------------------------------------------------

function DatabaseCleanupSection() {
  const { t } = useTranslation()
  const [cleaning, setCleaning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const handleCleanup = async () => {
    setCleaning(true)
    setResult(null)
    setError(null)
    try {
      const data = await api.post('/maintenance/cleanup-missing')
      setResult(data.removed)
    } catch {
      setError(t('maintenance.cleanup.failed'))
    } finally {
      setCleaning(false)
    }
  }

  const total = result ? result.books + result.maps + result.tokens : 0

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        {t('maintenance.cleanup.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('maintenance.cleanup.description')}
      </p>

      <button
        onClick={handleCleanup}
        disabled={cleaning}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 18px',
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 500,
          background: cleaning ? 'rgba(180,60,60,0.5)' : 'rgba(180,60,60,0.15)',
          border: '1px solid rgba(180,60,60,0.5)',
          color: cleaning ? 'var(--text-muted)' : '#e07070',
          cursor: cleaning ? 'default' : 'pointer',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => {
          if (!cleaning) e.currentTarget.style.background = 'rgba(180,60,60,0.25)'
        }}
        onMouseLeave={(e) => {
          if (!cleaning) e.currentTarget.style.background = 'rgba(180,60,60,0.15)'
        }}
      >
        {cleaning ? <Spinner size={14} /> : <LuTrash2 size={14} />}
        {cleaning ? t('maintenance.cleanup.cleaning') : t('maintenance.cleanup.button')}
      </button>

      {result !== null && (
        <div
          style={{
            marginTop: 20,
            padding: '14px 18px',
            borderRadius: 8,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <LuCircleCheck size={18} color="var(--green)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
              {total === 0
                ? t('maintenance.cleanup.nothingToRemove')
                : t('maintenance.cleanup.removed', { count: total })}
            </div>
            {total > 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', gap: 16 }}>
                {result.books > 0 && (
                  <span>{t('maintenance.cleanup.books', { count: result.books })}</span>
                )}
                {result.maps > 0 && (
                  <span>{t('maintenance.cleanup.maps', { count: result.maps })}</span>
                )}
                {result.tokens > 0 && (
                  <span>{t('maintenance.cleanup.tokens', { count: result.tokens })}</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {error && <div style={{ marginTop: 16, fontSize: 14, color: '#e07070' }}>{error}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Export Tags section
// ---------------------------------------------------------------------------

function ExportTagsSection() {
  const { t } = useTranslation()
  const [exporting, setExporting] = useState(false)
  const [includeLibrary, setIncludeLibrary] = useState(true)
  const [includeMaps, setIncludeMaps] = useState(true)
  const [includeTokens, setIncludeTokens] = useState(true)

  const handleExport = () => {
    setExporting(true)
    const params = {
      include_library: includeLibrary,
      include_maps: includeMaps,
      include_tokens: includeTokens,
    }
    const url = mediaUrl('/export/tags', params)
    const a = document.createElement('a')
    a.href = url
    a.download = ''
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => setExporting(false), 800)
  }

  const checkboxStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    color: 'var(--text-dim)',
    cursor: 'pointer',
    userSelect: 'none',
  }

  return (
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        {t('maintenance.tagExport.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('maintenance.tagExport.description')}
      </p>

      <div style={{ display: 'flex', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={checkboxStyle}>
          <input
            type="checkbox"
            checked={includeLibrary}
            onChange={(e) => setIncludeLibrary(e.target.checked)}
          />
          {t('maintenance.tagExport.library')}
        </label>
        <label style={checkboxStyle}>
          <input
            type="checkbox"
            checked={includeMaps}
            onChange={(e) => setIncludeMaps(e.target.checked)}
          />
          {t('maintenance.tagExport.maps')}
        </label>
        <label style={checkboxStyle}>
          <input
            type="checkbox"
            checked={includeTokens}
            onChange={(e) => setIncludeTokens(e.target.checked)}
          />
          {t('maintenance.tagExport.tokens')}
        </label>
      </div>

      <button
        onClick={handleExport}
        disabled={exporting || (!includeLibrary && !includeMaps && !includeTokens)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 18px',
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 500,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          color: exporting ? 'var(--gold)' : 'var(--text-dim)',
          cursor: exporting || (!includeLibrary && !includeMaps && !includeTokens) ? 'default' : 'pointer',
          opacity: (!includeLibrary && !includeMaps && !includeTokens) ? 0.5 : 1,
        }}
      >
        {exporting ? <Spinner size={13} /> : <LuDownload size={13} />}
        {exporting ? t('maintenance.tagExport.exporting') : t('maintenance.tagExport.button')}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab root
// ---------------------------------------------------------------------------

export default function MaintenanceTab() {
  return (
    <div>
      <RescanSection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <ScheduledRescanSection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <ExportTagsSection />
      <div style={{ borderTop: '1px solid var(--border)', marginBottom: 40 }} />
      <DatabaseCleanupSection />
    </div>
  )
}
