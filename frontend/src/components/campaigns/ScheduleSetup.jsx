import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { campaigns } from '../../api'
import Spinner from '../Spinner'
import { utcTimeToLocal, USER_TZ } from './_scheduleShared'
import ScheduleEditor from './ScheduleEditor'
import ToggleSwitch from './ToggleSwitch'
import { cancelBtn } from './campaignEditorShared'

// Schedule recurrence setup for the edit modal (no availability chart — that
// stays on the overview). A toggle enables/disables the schedule (disabling
// preserves the definition); when enabled, shows a summary with an Edit button
// or the editor itself.
export default function ScheduleSetup({ campaign, onChanged }) {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [editing, setEditing] = useState(false)
  const [togglingEnabled, setTogglingEnabled] = useState(false)

  useEffect(() => {
    campaigns
      .getSchedule(campaign.id)
      .then(setData)
      .catch(() => setData({ definition: null, enabled: false }))
  }, [campaign.id])

  if (!data)
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
        <Spinner size={18} />
      </div>
    )

  const def = data.definition
  const enabled = !!data.enabled

  // Flip the enabled flag while keeping the existing definition. With no
  // definition yet there's nothing to persist — just reveal the editor so the
  // GM can fill one in.
  const toggleEnabled = async (next) => {
    if (!def) {
      setData((d) => ({ ...d, enabled: next }))
      return
    }
    setTogglingEnabled(true)
    try {
      const result = await campaigns.setSchedule(campaign.id, { ...def, enabled: next })
      setData(result)
      onChanged?.()
    } catch {
      /* leave the toggle as-is on failure */
    } finally {
      setTogglingEnabled(false)
    }
  }

  const toggle = (
    <ToggleSwitch
      id="schedule-enabled"
      checked={enabled}
      onChange={togglingEnabled ? () => {} : toggleEnabled}
      label={
        <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
          {enabled ? t('campaignEditor.scheduleEnabled') : t('campaignEditor.scheduleDisabled')}
        </span>
      }
    />
  )

  // Disabled: keep the definition, but collapse the editor.
  if (!enabled) {
    return <div style={{ paddingTop: 2 }}>{toggle}</div>
  }

  if (!def || editing) {
    return (
      <div>
        <div style={{ marginBottom: 12 }}>{toggle}</div>
        <ScheduleEditor
          campaign={campaign}
          existing={editing && def ? def : null}
          onSaved={(result) => {
            setData(result)
            setEditing(false)
            onChanged?.()
          }}
          onDeleted={() => {
            setData({ definition: null, enabled: false })
            setEditing(false)
            onChanged?.()
          }}
        />
      </div>
    )
  }

  const FREQ = {
    weekly: t('schedule.frequency.weekly'),
    biweekly: t('schedule.frequency.biweekly'),
    monthly: t('schedule.frequency.monthly'),
    custom: t('schedule.frequency.custom'),
  }
  const DAY_NAMES = [
    t('schedule.days.monday'),
    t('schedule.days.tuesday'),
    t('schedule.days.wednesday'),
    t('schedule.days.thursday'),
    t('schedule.days.friday'),
    t('schedule.days.saturday'),
    t('schedule.days.sunday'),
  ]
  let pattern = ''
  if (def.frequency === 'custom') {
    pattern = t('campaignDetail.overview.customDates', { count: def.custom_dates?.length ?? 0 })
  } else if (def.frequency === 'monthly') {
    const WEEKS = {
      1: t('schedule.weeks.1st'),
      2: t('schedule.weeks.2nd'),
      3: t('schedule.weeks.3rd'),
      4: t('schedule.weeks.4th'),
      '-1': t('schedule.weeks.last'),
    }
    pattern = t('schedule.monthlyPattern', {
      week: WEEKS[String(def.monthly_week)] ?? '',
      day: DAY_NAMES[def.days?.[0]] ?? '',
    })
  } else {
    pattern = (def.days ?? []).map((d) => DAY_NAMES[d]).join(' & ')
  }
  const localTime = utcTimeToLocal(def.time_utc)

  return (
    <div>
      <div style={{ marginBottom: 12 }}>{toggle}</div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 14px',
          background: 'var(--bg-deep)',
          border: '1px solid var(--border)',
          borderRadius: 8,
        }}
      >
        <div style={{ fontSize: 13 }}>
          <div style={{ fontWeight: 600 }}>
            {FREQ[def.frequency] ?? def.frequency}
            {pattern ? ` — ${pattern}` : ''}
          </div>
          {localTime && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {localTime} ({USER_TZ})
            </div>
          )}
        </div>
        <button type="button" onClick={() => setEditing(true)} style={cancelBtn}>
          {t('schedule.edit')}
        </button>
      </div>
    </div>
  )
}
