import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck, LuRefreshCw } from 'react-icons/lu'
import { settings as settingsApi, type Schema } from '../../api'
import Spinner from '../Spinner'
import { utcToLocalTime, localTimeToUtc } from './rescanTime'
import { useUnsavedChanges } from './settingsDirty'

type Settings = Schema<'SettingsResponse'>

interface Schedule {
  schedule: string
  localTime: string
  weekday: number
  cleanupOnRescan: boolean
}

/** The form's values for what the server has saved. */
const fromSettings = (data: Settings): Schedule => ({
  schedule: data.rescan_schedule_enabled ? data.rescan_schedule_interval : 'off',
  localTime: utcToLocalTime(data.rescan_schedule_hour ?? 2, data.rescan_schedule_minute ?? 0),
  weekday: data.rescan_schedule_weekday ?? 0,
  cleanupOnRescan: data.cleanup_on_rescan ?? false,
})

export default function ScheduledRescanSection() {
  const { t } = useTranslation()
  const [schedule, setSchedule] = useState('off')
  const [localTime, setLocalTime] = useState('02:00')
  const [weekday, setWeekday] = useState(0)
  const [cleanupOnRescan, setCleanupOnRescan] = useState(false)
  // What the server last said, to tell an edit from the saved schedule.
  const [saved, setSavedValues] = useState<Schedule | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  const apply = (data: Settings) => {
    const values = fromSettings(data)
    setSchedule(values.schedule)
    setLocalTime(values.localTime)
    setWeekday(values.weekday)
    setCleanupOnRescan(values.cleanupOnRescan)
    setSavedValues(values)
  }

  const dirty =
    saved !== null &&
    (schedule !== saved.schedule ||
      localTime !== saved.localTime ||
      weekday !== saved.weekday ||
      cleanupOnRescan !== saved.cleanupOnRescan)
  useUnsavedChanges('scheduled-rescan', dirty)

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
      .then(apply)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setJustSaved(false)
    try {
      const { hour, minute } = localTimeToUtc(localTime)
      apply(
        await settingsApi.patch({
          rescan_schedule_enabled: schedule !== 'off',
          rescan_schedule_interval: schedule === 'off' ? 'daily' : schedule,
          rescan_schedule_hour: hour,
          rescan_schedule_minute: minute,
          rescan_schedule_weekday: weekday,
          cleanup_on_rescan: cleanupOnRescan,
        })
      )
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  const showTimePicker = schedule === 'daily' || schedule === 'weekly'

  return (
    <div>
      <h3 style={{ marginBottom: 6 }}>{t('maintenance.scheduledRescan.title')}</h3>
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
                type="button"
                aria-pressed={schedule === value}
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
                    type="button"
                    aria-pressed={weekday === value}
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
                id="rescan-time"
                type="time"
                value={localTime}
                onChange={(e) => setLocalTime(e.target.value)}
                aria-label={t('maintenance.scheduledRescan.at')}
                style={{
                  fontSize: 14,
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-control)',
                  color: 'var(--text)',
                  colorScheme: 'dark',
                }}
              />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {t('maintenance.scheduledRescan.localTime')}
              </span>
            </div>
          )}

          {/* Also run database cleanup toggle */}
          {schedule !== 'off' && (
            <label
              htmlFor="cleanup-on-rescan"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                fontSize: 14,
                color: 'var(--text)',
                userSelect: 'none',
              }}
            >
              <input
                id="cleanup-on-rescan"
                type="checkbox"
                checked={cleanupOnRescan}
                onChange={(e) => setCleanupOnRescan(e.target.checked)}
                style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--gold)' }}
              />
              {t('maintenance.scheduledRescan.alsoRunCleanup')}
            </label>
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
            <span
              role="status"
              style={{
                fontSize: 13,
                color: 'var(--green)',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              {justSaved && (
                <>
                  <LuCircleCheck size={14} aria-hidden="true" />{' '}
                  {t('maintenance.scheduledRescan.saved')}
                </>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
