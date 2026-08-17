import { useTranslation } from 'react-i18next'
import { LuCalendar, LuClock } from 'react-icons/lu'
import { formatScheduleTime, USER_TZ } from './_scheduleShared'

/** Read-only summary of a campaign's recurring schedule definition. */
export default function ScheduleSummary({ def, onEdit, isOwner }) {
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

  const freqLabel = FREQ_OPTIONS.find((f) => f.key === def.frequency)?.label ?? def.frequency

  let pattern = ''
  if (def.frequency === 'custom') {
    pattern = `${def.custom_dates?.length ?? 0} custom dates`
  } else if (def.frequency === 'monthly') {
    const week = MONTH_WEEKS.find((w) => w.value === def.monthly_week)?.label ?? ''
    const day = DAYS[def.days?.[0]] ?? ''
    pattern = t('schedule.monthlyPattern', { week, day })
  } else {
    pattern = def.days?.map((d) => DAYS[d]).join(' & ') ?? ''
  }

  const localTime = formatScheduleTime(def.time_local)

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '18px 22px',
        marginBottom: 20,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <LuCalendar size={14} /> {freqLabel} — {pattern}
          </div>
          {localTime && (
            <div
              style={{
                fontSize: 13,
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <LuClock size={12} /> {localTime} <span style={{ opacity: 0.6 }}>({USER_TZ})</span>
            </div>
          )}
        </div>
        {isOwner && (
          <button
            onClick={onEdit}
            style={{
              padding: '6px 12px',
              background: 'var(--bg-deep)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            {t('schedule.edit')}
          </button>
        )}
      </div>
    </div>
  )
}
