import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCalendar, LuSave, LuTrash2, LuPlus, LuX } from 'react-icons/lu'
import { campaigns } from '../../api'
import { inputStyle, submitBtn, dangerBtn, addBtn } from './_scheduleShared'
import TimePicker from './TimePicker'
import SegmentControl from './SegmentControl'

export default function ScheduleEditor({ campaign, existing, onSaved, onDeleted }) {
  const { t } = useTranslation()

  const FREQ_OPTIONS = [
    { key: 'weekly', label: t('schedule.frequency.weekly') },
    { key: 'biweekly', label: t('schedule.frequency.biweekly') },
    { key: 'monthly', label: t('schedule.frequency.monthly') },
    { key: 'custom', label: t('schedule.frequency.custom') },
  ]

  const MONTH_WEEKS = [
    { value: 1, label: t('schedule.weeks.1st') },
    { value: 2, label: t('schedule.weeks.2nd') },
    { value: 3, label: t('schedule.weeks.3rd') },
    { value: 4, label: t('schedule.weeks.4th') },
    { value: -1, label: t('schedule.weeks.last') },
  ]

  const DAYS = [
    t('schedule.days.monday'),
    t('schedule.days.tuesday'),
    t('schedule.days.wednesday'),
    t('schedule.days.thursday'),
    t('schedule.days.friday'),
    t('schedule.days.saturday'),
    t('schedule.days.sunday'),
  ]

  const [frequency, setFrequency] = useState(existing?.frequency ?? 'weekly')
  const [days, setDays] = useState(existing?.days ?? [])
  const [timeUtc, setTimeUtc] = useState(existing?.time_utc ?? null)
  const [biweeklyRef, setBiweeklyRef] = useState(existing?.biweekly_reference ?? '')
  const [monthlyWeek, setMonthlyWeek] = useState(existing?.monthly_week ?? 1)
  const [customDates, setCustomDates] = useState(existing?.custom_dates ?? [])
  const [newCustomDate, setNewCustomDate] = useState('')
  const [saving, setSaving] = useState(false)

  const toggleDay = (d) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()))

  const addCustomDate = () => {
    if (!newCustomDate || customDates.includes(newCustomDate)) return
    setCustomDates((prev) => [...prev, newCustomDate].sort())
    setNewCustomDate('')
  }

  const removeCustomDate = (d) => setCustomDates((prev) => prev.filter((x) => x !== d))

  const save = async () => {
    if (frequency !== 'custom' && days.length === 0) {
      alert(t('schedule.selectDay'))
      return
    }
    if (frequency === 'custom' && customDates.length === 0) {
      alert(t('schedule.addDate'))
      return
    }
    setSaving(true)
    try {
      const payload = {
        days,
        frequency,
        time_utc: timeUtc,
        biweekly_reference:
          frequency === 'biweekly' ? biweeklyRef || new Date().toISOString().slice(0, 10) : null,
        monthly_week: frequency === 'monthly' ? monthlyWeek : null,
        custom_dates: frequency === 'custom' ? customDates : null,
      }
      const result = await campaigns.setSchedule(campaign.id, payload)
      onSaved(result)
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!confirm(t('schedule.removeConfirm'))) return
    await campaigns.deleteSchedule(campaign.id)
    onDeleted()
  }

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '20px 22px',
        marginBottom: 20,
      }}
    >
      <div style={{ marginBottom: 18 }}>
        <SegmentControl value={frequency} options={FREQ_OPTIONS} onChange={setFrequency} />
      </div>

      {frequency !== 'custom' && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            {frequency === 'monthly' ? t('schedule.dayOfWeek') : t('schedule.sessionDays')}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {DAYS.map((d, i) => {
              const selected = frequency === 'monthly' ? days[0] === i : days.includes(i)
              return (
                <button
                  key={i}
                  onClick={() => (frequency === 'monthly' ? setDays([i]) : toggleDay(i))}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 20,
                    cursor: 'pointer',
                    fontSize: 13,
                    background: selected ? 'var(--gold)' : 'var(--bg-deep)',
                    border: selected ? 'none' : '1px solid var(--border)',
                    color: selected ? '#1a1209' : 'var(--text-dim)',
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  {d.slice(0, 3)}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {frequency === 'monthly' && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            {t('schedule.whichOccurrence')}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {MONTH_WEEKS.map((w) => (
              <button
                key={w.value}
                onClick={() => setMonthlyWeek(w.value)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 20,
                  cursor: 'pointer',
                  fontSize: 13,
                  background: monthlyWeek === w.value ? 'var(--gold)' : 'var(--bg-deep)',
                  border: monthlyWeek === w.value ? 'none' : '1px solid var(--border)',
                  color: monthlyWeek === w.value ? '#1a1209' : 'var(--text-dim)',
                  fontWeight: monthlyWeek === w.value ? 600 : 400,
                }}
              >
                {w.label}
              </button>
            ))}
          </div>
          {days.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--gold)', marginTop: 8 }}>
              {t('schedule.monthlyPattern', {
                week: MONTH_WEEKS.find((w) => w.value === monthlyWeek)?.label,
                day: DAYS[days[0]],
              })}
            </div>
          )}
        </div>
      )}

      {frequency === 'biweekly' && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
            {t('schedule.referenceDate')}
          </div>
          <input
            id="schedule-biweekly-ref"
            type="date"
            aria-label={t('schedule.referenceDate')}
            value={biweeklyRef}
            onChange={(e) => setBiweeklyRef(e.target.value)}
            style={inputStyle}
          />
        </div>
      )}

      {frequency === 'custom' && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            {t('schedule.customDates')}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              id="schedule-custom-date"
              type="date"
              aria-label={t('schedule.customDates')}
              value={newCustomDate}
              onChange={(e) => setNewCustomDate(e.target.value)}
              style={inputStyle}
            />
            <button
              onClick={addCustomDate}
              aria-label={t('schedule.addDateAriaLabel')}
              style={addBtn}
            >
              <LuPlus size={14} aria-hidden="true" />
            </button>
          </div>
          {customDates.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t('schedule.noDatesYet')}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {customDates.map((d) => (
              <div
                key={d}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 10px',
                  background: 'var(--bg-deep)',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  fontSize: 13,
                }}
              >
                <LuCalendar size={12} style={{ color: 'var(--text-muted)' }} />
                <span style={{ flex: 1 }}>
                  {new Date(d + 'T00:00:00').toLocaleDateString(undefined, {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                <button
                  onClick={() => removeCustomDate(d)}
                  aria-label={`${t('schedule.remove')} ${new Date(d + 'T00:00:00').toLocaleDateString()}`}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-muted)',
                    padding: 2,
                  }}
                >
                  <LuX size={12} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 18 }}>
        <TimePicker value={timeUtc} onChange={setTimeUtc} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={save} disabled={saving} style={submitBtn}>
          <LuSave size={13} /> {saving ? t('schedule.saving') : t('schedule.saveSchedule')}
        </button>
        {existing && (
          <button onClick={remove} style={dangerBtn}>
            <LuTrash2 size={13} /> {t('schedule.remove')}
          </button>
        )}
      </div>
    </div>
  )
}
