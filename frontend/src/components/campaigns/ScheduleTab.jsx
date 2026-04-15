import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCalendar, LuClock } from 'react-icons/lu'
import { campaigns } from '../../api'
import Spinner from '../Spinner'
import { utcTimeToLocal, USER_TZ } from './_scheduleShared'
import ScheduleEditor from './ScheduleEditor'
import AvailabilityChart from './AvailabilityChart'

function ScheduleSummary({ def, onEdit, isOwner }) {
  const { t } = useTranslation()
  const FREQ_OPTIONS = [
    { key: 'weekly',   label: t('schedule.frequency.weekly')   },
    { key: 'biweekly', label: t('schedule.frequency.biweekly') },
    { key: 'monthly',  label: t('schedule.frequency.monthly')  },
    { key: 'custom',   label: t('schedule.frequency.custom')   },
  ]
  const MONTH_WEEKS = [
    { value: 1,  label: t('schedule.weeks.1st')  },
    { value: 2,  label: t('schedule.weeks.2nd')  },
    { value: 3,  label: t('schedule.weeks.3rd')  },
    { value: 4,  label: t('schedule.weeks.4th')  },
    { value: -1, label: t('schedule.weeks.last') },
  ]
  const DAYS = [
    t('schedule.days.monday'), t('schedule.days.tuesday'), t('schedule.days.wednesday'),
    t('schedule.days.thursday'), t('schedule.days.friday'), t('schedule.days.saturday'), t('schedule.days.sunday'),
  ]

  const freqLabel = FREQ_OPTIONS.find(f => f.key === def.frequency)?.label ?? def.frequency

  let pattern = ''
  if (def.frequency === 'custom') {
    pattern = `${def.custom_dates?.length ?? 0} custom dates`
  } else if (def.frequency === 'monthly') {
    const week = MONTH_WEEKS.find(w => w.value === def.monthly_week)?.label ?? ''
    const day = DAYS[def.days?.[0]] ?? ''
    pattern = t('schedule.monthlyPattern', { week, day })
  } else {
    pattern = def.days?.map(d => DAYS[d]).join(' & ') ?? ''
  }

  const localTime = utcTimeToLocal(def.time_utc)

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 22px', marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <LuCalendar size={14} /> {freqLabel} — {pattern}
          </div>
          {localTime && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <LuClock size={12} /> {localTime} <span style={{ opacity: 0.6 }}>({USER_TZ})</span>
            </div>
          )}
        </div>
        {isOwner && (
          <button
            onClick={onEdit}
            style={{ padding: '6px 12px', background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}
          >
            {t('schedule.edit')}
          </button>
        )}
      </div>
    </div>
  )
}

export default function ScheduleTab({ campaign, isOwner, userId }) {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [availability, setAvailability] = useState(null)
  const [editingSchedule, setEditingSchedule] = useState(false)

  const loadSchedule = () => campaigns.getSchedule(campaign.id).then(setData)
  const loadAvailability = () => campaigns.getAvailability(campaign.id).then(setAvailability).catch(() => {})

  useEffect(() => { loadSchedule(); loadAvailability() }, [campaign.id])

  const handleSetAvailability = async (date, status) => {
    await campaigns.setAvailability(campaign.id, date, { status })
    loadAvailability()
  }

  const handleCancelDate = async (date) => {
    await campaigns.cancelDate(campaign.id, date)
    loadAvailability()
  }

  if (!data) return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner size={24} /></div>

  const def = data.definition

  return (
    <div>
      {(!def || editingSchedule) ? (
        <ScheduleEditor
          campaign={campaign}
          existing={editingSchedule && def ? def : null}
          onSaved={(result) => { setData(result); setEditingSchedule(false); loadAvailability() }}
          onDeleted={() => { setData({ definition: null, next_sessions: [] }); setEditingSchedule(false); loadAvailability() }}
        />
      ) : (
        <ScheduleSummary def={def} isOwner={isOwner} onEdit={() => setEditingSchedule(true)} />
      )}

      <AvailabilityChart
        availability={availability}
        userId={userId}
        isOwner={isOwner}
        onSetAvailability={handleSetAvailability}
        onCancelDate={handleCancelDate}
      />

      {!def && !editingSchedule && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
          <LuCalendar size={32} style={{ marginBottom: 10, opacity: 0.3 }} />
          <div style={{ fontSize: 14 }}>{t('schedule.noSchedule')}</div>
        </div>
      )}
    </div>
  )
}
