import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { utcToLocalInputTime, localInputTimeToUtc, inputStyle, USER_TZ } from './_scheduleShared'

const TIME_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4)
  const m = (i % 4) * 15
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
})

/** Optional session-time picker (local time, stored as UTC) for the schedule editor. */
export default function TimePicker({ value, onChange }) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(!!value)

  return (
    <div>
      <label
        htmlFor="schedule-time-enabled"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          color: 'var(--text-muted)',
          marginBottom: 8,
          cursor: 'pointer',
        }}
      >
        <input
          id="schedule-time-enabled"
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked)
            if (!e.target.checked) onChange(null)
          }}
        />
        {t('schedule.setSessionTime', { tz: USER_TZ })}
      </label>
      {enabled && (
        <>
          <input
            id="schedule-session-time"
            type="time"
            list="schedule-time-options"
            aria-label={t('schedule.setSessionTime', { tz: USER_TZ })}
            value={utcToLocalInputTime(value)}
            onChange={(e) => onChange(localInputTimeToUtc(e.target.value))}
            style={{ ...inputStyle, colorScheme: 'dark', accentColor: 'var(--gold)' }}
          />
          <datalist id="schedule-time-options">
            {TIME_OPTIONS.map((time) => (
              <option key={time} value={time} />
            ))}
          </datalist>
        </>
      )}
    </div>
  )
}
