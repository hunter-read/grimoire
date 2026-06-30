import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCalendar } from 'react-icons/lu'
import { campaigns } from '../../api'
import Spinner from '../Spinner'
import ScheduleEditor from './ScheduleEditor'
import AvailabilityChart from './AvailabilityChart'
import ScheduleSummary from './ScheduleSummary'

export default function ScheduleTab({ campaign, isOwner, userId }) {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [availability, setAvailability] = useState(null)
  const [editingSchedule, setEditingSchedule] = useState(false)

  const loadSchedule = () => campaigns.getSchedule(campaign.id).then(setData)
  const loadAvailability = () =>
    campaigns
      .getAvailability(campaign.id)
      .then(setAvailability)
      .catch(() => {})

  useEffect(() => {
    loadSchedule()
    loadAvailability()
  }, [campaign.id])

  const handleSetAvailability = async (date, status, targetUserId) => {
    // Include user_id only when the GM is editing another member's row; the
    // backend defaults to the caller when it's absent.
    const body =
      targetUserId && targetUserId !== userId ? { status, user_id: targetUserId } : { status }
    await campaigns.setAvailability(campaign.id, date, body)
    loadAvailability()
  }

  const handleCancelDate = async (date) => {
    await campaigns.cancelDate(campaign.id, date)
    loadAvailability()
  }

  if (!data)
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spinner size={24} />
      </div>
    )

  const def = data.definition

  return (
    <div>
      {!def || editingSchedule ? (
        <ScheduleEditor
          campaign={campaign}
          existing={editingSchedule && def ? def : null}
          onSaved={(result) => {
            setData(result)
            setEditingSchedule(false)
            loadAvailability()
          }}
          onDeleted={() => {
            setData({ definition: null, next_sessions: [] })
            setEditingSchedule(false)
            loadAvailability()
          }}
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
