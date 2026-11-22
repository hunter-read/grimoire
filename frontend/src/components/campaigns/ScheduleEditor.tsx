import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCalendar, LuSave, LuTrash2, LuPlus, LuX } from 'react-icons/lu'
import { campaigns, type Schema } from '../../api'
import {
  inputStyle,
  submitBtn,
  dangerBtn,
  addBtn,
  USER_TZ,
  type ScheduleData,
  type ScheduleDef,
} from './_scheduleShared'
import TimePicker from './TimePicker'
import SegmentControl from './SegmentControl'

interface ScheduleEditorProps {
  campaign: Pick<Schema<'CampaignOut'>, 'id'>
  existing?: ScheduleDef | null
  onSaved: (result: ScheduleData) => void
  onDeleted: () => void
}

export default function ScheduleEditor({
  campaign,
  existing,
  onSaved,
  onDeleted,
}: ScheduleEditorProps) {
  const { t } = useTranslation()

  const FREQ_OPTIONS = [
    { key: 'weekly', label: t('schedule.frequency.weekly') },
    { key: 'biweekly', label: t('schedule.frequency.biweekly') },
    { key: 'monthly', label: t('schedule.frequency.monthly') },
    { key: 'rotation', label: t('schedule.frequency.rotation') },
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
  const [days, setDays] = useState<number[]>(existing?.days ?? [])
  const [timeLocal, setTimeLocal] = useState<string | null>(existing?.time_local ?? null)
  const [biweeklyRef, setBiweeklyRef] = useState(existing?.biweekly_reference ?? '')
  const [monthlyWeek, setMonthlyWeek] = useState(existing?.monthly_week ?? 1)
  const [customDates, setCustomDates] = useState<string[]>(existing?.custom_dates ?? [])
  // A rotating schedule: the session days of each week in a 2-4 week cycle.
  // A new one starts from the weekly days, alternating with a week to fill in.
  const [rotation, setRotation] = useState<number[][]>(
    existing?.rotation ?? [existing?.days ?? [], []]
  )
  const [rotationRef, setRotationRef] = useState(existing?.rotation_reference ?? '')
  const [newCustomDate, setNewCustomDate] = useState('')
  const [saving, setSaving] = useState(false)

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()))

  const toggleRotationDay = (week: number, d: number) =>
    setRotation((prev) =>
      prev.map((days, i) =>
        i !== week ? days : days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort()
      )
    )

  // Lengthening keeps the weeks already set and adds empty ones; shortening
  // drops the last weeks.
  const setRotationLength = (weeks: number) =>
    setRotation((prev) => Array.from({ length: weeks }, (_, i) => prev[i] ?? []))

  const today = () => new Date().toISOString().slice(0, 10)

  const addCustomDate = () => {
    if (!newCustomDate || customDates.includes(newCustomDate)) return
    setCustomDates((prev) => [...prev, newCustomDate].sort())
    setNewCustomDate('')
  }

  const removeCustomDate = (d: string) => setCustomDates((prev) => prev.filter((x) => x !== d))

  const save = async () => {
    const rotationDays = [...new Set(rotation.flat())].sort()
    if (
      frequency === 'rotation'
        ? rotationDays.length === 0
        : frequency !== 'custom' && days.length === 0
    ) {
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
        days: frequency === 'rotation' ? rotationDays : days,
        frequency,
        time_local: timeLocal,
        // Both the weekdays and the time above are local. The zone travels with
        // them so the feed can name it (TZID) rather than convert to a UTC
        // instant — converting is what dropped the day rollover and published
        // evening games a day early.
        timezone: USER_TZ,
        biweekly_reference: frequency === 'biweekly' ? biweeklyRef || today() : null,
        monthly_week: frequency === 'monthly' ? monthlyWeek : null,
        rotation: frequency === 'rotation' ? rotation : null,
        rotation_reference: frequency === 'rotation' ? rotationRef || today() : null,
        custom_dates: frequency === 'custom' ? customDates : null,
      }
      const result = await campaigns.setSchedule(campaign.id, payload)
      onSaved(result as ScheduleData)
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!confirm(t('schedule.removeConfirm'))) return
    try {
      await campaigns.deleteSchedule(campaign.id)
      onDeleted()
    } catch (err) {
      alert((err as Error | undefined)?.message || t('common.error'))
    }
  }

  const pillStyle = (selected: boolean) => ({
    padding: '5px 12px',
    borderRadius: 20,
    cursor: 'pointer',
    fontSize: 13,
    background: selected ? 'var(--gold)' : 'var(--bg-deep)',
    border: selected ? 'none' : '1px solid var(--border)',
    color: selected ? 'var(--on-accent)' : 'var(--text-dim)',
    fontWeight: selected ? 600 : 400,
  })

  // A row of weekday chips. Each shows "Mon"; the full name is read, and
  // whether it is one of the session days.
  const dayChips = (
    labelledBy: string,
    isSelected: (day: number) => boolean,
    onToggle: (day: number) => void
  ) => (
    <div
      role="group"
      aria-labelledby={labelledBy}
      style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
    >
      {DAYS.map((d, i) => {
        const selected = isSelected(i)
        return (
          <button
            key={i}
            type="button"
            aria-label={d}
            aria-pressed={selected}
            onClick={() => onToggle(i)}
            style={pillStyle(selected)}
          >
            {d.slice(0, 3)}
          </button>
        )
      })}
    </div>
  )

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

      {frequency !== 'custom' && frequency !== 'rotation' && (
        <div style={{ marginBottom: 16 }}>
          <div
            id="schedule-days-label"
            style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}
          >
            {frequency === 'monthly' ? t('schedule.dayOfWeek') : t('schedule.sessionDays')}
          </div>
          {dayChips(
            'schedule-days-label',
            (i) => (frequency === 'monthly' ? days[0] === i : days.includes(i)),
            (i) => (frequency === 'monthly' ? setDays([i]) : toggleDay(i))
          )}
        </div>
      )}

      {frequency === 'monthly' && (
        <div style={{ marginBottom: 16 }}>
          <div
            id="schedule-occurrence-label"
            style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}
          >
            {t('schedule.whichOccurrence')}
          </div>
          <div
            role="group"
            aria-labelledby="schedule-occurrence-label"
            style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
          >
            {MONTH_WEEKS.map((w) => (
              <button
                key={w.value}
                type="button"
                aria-pressed={monthlyWeek === w.value}
                onClick={() => setMonthlyWeek(w.value)}
                style={pillStyle(monthlyWeek === w.value)}
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

      {frequency === 'rotation' && (
        <div style={{ marginBottom: 16 }}>
          <div
            id="schedule-rotation-length-label"
            style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}
          >
            {t('schedule.rotationLength')}
          </div>
          <div
            role="group"
            aria-labelledby="schedule-rotation-length-label"
            style={{ display: 'flex', gap: 6, marginBottom: 14 }}
          >
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={rotation.length === n}
                onClick={() => setRotationLength(n)}
                style={pillStyle(rotation.length === n)}
              >
                {n}
              </button>
            ))}
          </div>
          {rotation.map((weekDays, week) => (
            <div key={week} style={{ marginBottom: 12 }}>
              <div
                id={`schedule-rotation-week-${week}`}
                style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}
              >
                {t('schedule.rotationWeek', { n: week + 1 })}
                {weekDays.length === 0 && ` - ${t('schedule.rotationOff')}`}
              </div>
              {dayChips(
                `schedule-rotation-week-${week}`,
                (i) => weekDays.includes(i),
                (i) => toggleRotationDay(week, i)
              )}
            </div>
          ))}
          <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 6px' }}>
            {t('schedule.rotationReference')}
          </div>
          <input
            id="schedule-rotation-ref"
            type="date"
            aria-label={t('schedule.rotationReference')}
            value={rotationRef}
            onChange={(e) => setRotationRef(e.target.value)}
            style={inputStyle}
          />
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
        <TimePicker value={timeLocal} onChange={setTimeLocal} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => void save()} disabled={saving} style={submitBtn}>
          <LuSave size={13} /> {saving ? t('schedule.saving') : t('schedule.saveSchedule')}
        </button>
        {existing && (
          <button onClick={() => void remove()} style={dangerBtn}>
            <LuTrash2 size={13} /> {t('schedule.remove')}
          </button>
        )}
      </div>
    </div>
  )
}
