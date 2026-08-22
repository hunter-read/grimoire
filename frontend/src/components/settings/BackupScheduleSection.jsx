import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck, LuLock, LuSave } from 'react-icons/lu'
import { backups as backupsApi } from '../../api'
import Spinner from '../Spinner'
import { utcToLocalTime, localTimeToUtc } from './rescanTime'

const inputStyle = {
  fontSize: 14,
  padding: '6px 10px',
  borderRadius: 6,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  colorScheme: 'dark',
}

export default function BackupScheduleSection({ onSaved }) {
  const { t } = useTranslation()
  const [config, setConfig] = useState(null)
  const [schedule, setSchedule] = useState('off')
  const [localTime, setLocalTime] = useState('03:00')
  const [weekday, setWeekday] = useState(0)
  const [count, setCount] = useState(0)
  const [gb, setGb] = useState(0)
  const [dir, setDir] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  const SCHEDULE_OPTIONS = [
    { value: 'off', label: t('backups.schedule.off') },
    { value: 'hourly', label: t('backups.schedule.hourly') },
    { value: 'daily', label: t('backups.schedule.daily') },
    { value: 'weekly', label: t('backups.schedule.weekly') },
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

  const hydrate = (data) => {
    setConfig(data)
    setSchedule(data.backup_schedule)
    setLocalTime(utcToLocalTime(data.backup_schedule_hour ?? 3, data.backup_schedule_minute ?? 0))
    setWeekday(data.backup_schedule_weekday ?? 0)
    setCount(data.backup_retention_count ?? 0)
    setGb(data.backup_retention_gb ?? 0)
    setDir(data.dir_env_locked ? data.backup_dir : '')
  }

  useEffect(() => {
    backupsApi
      .getSettings()
      .then(hydrate)
      .catch(() => setError(t('backups.schedule.loadFailed')))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const { hour, minute } = localTimeToUtc(localTime)
      const payload = {
        backup_schedule_hour: hour,
        backup_schedule_minute: minute,
        backup_schedule_weekday: weekday,
      }
      // Env-locked fields are never sent: the API rejects writes to them, so
      // including one would fail the whole save over a field the user can't edit.
      if (!config.schedule_env_locked) payload.backup_schedule = schedule
      if (!config.retention_count_env_locked) payload.backup_retention_count = Number(count) || 0
      if (!config.retention_gb_env_locked) payload.backup_retention_gb = Number(gb) || 0
      if (!config.dir_env_locked) payload.backup_dir = dir

      const data = await backupsApi.saveSettings(payload)
      hydrate(data)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      onSaved?.(data)
    } catch (e) {
      setError(e.message || t('backups.schedule.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner size={20} />
  if (!config) {
    return <div style={{ fontSize: 14, color: 'var(--danger)' }}>{error}</div>
  }

  const showTimePicker = schedule === 'daily' || schedule === 'weekly'

  const lockNote = (locked, envVar) =>
    locked ? (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 12,
          color: 'var(--text-muted)',
        }}
      >
        <LuLock size={11} /> {t('backups.schedule.envLocked', { name: envVar })}
      </span>
    ) : null

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        {t('backups.schedule.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('backups.schedule.description')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Frequency */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            style={{
              display: 'flex',
              border: '1px solid var(--border)',
              borderRadius: 6,
              overflow: 'hidden',
              width: 'fit-content',
              opacity: config.schedule_env_locked ? 0.6 : 1,
            }}
          >
            {SCHEDULE_OPTIONS.map(({ value, label }, idx) => (
              <button
                key={value}
                onClick={() => setSchedule(value)}
                disabled={config.schedule_env_locked}
                style={{
                  padding: '7px 18px',
                  fontSize: 14,
                  cursor: config.schedule_env_locked ? 'not-allowed' : 'pointer',
                  border: 'none',
                  borderRight:
                    idx < SCHEDULE_OPTIONS.length - 1 ? '1px solid var(--border)' : 'none',
                  background: schedule === value ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                  color: schedule === value ? 'var(--gold)' : 'var(--text-dim)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {lockNote(config.schedule_env_locked, 'BACKUP_SCHEDULE')}
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
              id="backup-time"
              type="time"
              value={localTime}
              onChange={(e) => setLocalTime(e.target.value)}
              aria-label={t('maintenance.scheduledRescan.at')}
              style={inputStyle}
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t('maintenance.scheduledRescan.localTime')}
            </span>
          </div>
        )}

        {/* Retention */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{t('backups.retention.title')}</div>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0, lineHeight: 1.6 }}>
            {t('backups.retention.description')}
          </p>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <label
              htmlFor="backup-retention-count"
              style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}
            >
              <span style={{ color: 'var(--text-dim)' }}>{t('backups.retention.countLabel')}</span>
              <input
                id="backup-retention-count"
                type="number"
                min={0}
                value={count}
                disabled={config.retention_count_env_locked}
                onChange={(e) => setCount(e.target.value)}
                style={{ ...inputStyle, width: 110 }}
              />
              {lockNote(config.retention_count_env_locked, 'BACKUP_RETENTION_COUNT')}
            </label>
            <label
              htmlFor="backup-retention-gb"
              style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}
            >
              <span style={{ color: 'var(--text-dim)' }}>{t('backups.retention.sizeLabel')}</span>
              <input
                id="backup-retention-gb"
                type="number"
                min={0}
                value={gb}
                disabled={config.retention_gb_env_locked}
                onChange={(e) => setGb(e.target.value)}
                style={{ ...inputStyle, width: 110 }}
              />
              {lockNote(config.retention_gb_env_locked, 'BACKUP_RETENTION_GB')}
            </label>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
            {t('backups.retention.note')}
          </p>
        </div>

        {/* Storage location */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="backup-dir" style={{ fontSize: 14, fontWeight: 500 }}>
            {t('backups.location.title')}
          </label>
          <input
            id="backup-dir"
            type="text"
            value={dir}
            disabled={config.dir_env_locked}
            placeholder={config.backup_dir}
            onChange={(e) => setDir(e.target.value)}
            style={{ ...inputStyle, maxWidth: 520 }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {t('backups.location.hint', { path: config.backup_dir })}
          </span>
          {lockNote(config.dir_env_locked, 'BACKUP_DIR')}
        </div>

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
            {saving ? <Spinner size={13} /> : <LuSave size={13} />}
            {saving ? t('backups.schedule.saving') : t('backups.schedule.save')}
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
              <LuCircleCheck size={14} /> {t('backups.schedule.saved')}
            </span>
          )}
          {error && <span style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</span>}
        </div>
      </div>
    </div>
  )
}
