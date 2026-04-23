import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LuMinus, LuBan } from 'react-icons/lu'
import { AVAIL_OPTIONS, formatDate } from './_scheduleShared'

function AvailabilityCell({ status, isCancelled, isOwner, onSet, onCancel, availOptions }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })

  const openMenu = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, left: rect.left + rect.width / 2 })
    }
    setOpen(true)
  }

  if (isCancelled) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={isOwner ? onCancel : undefined}
          title={
            isOwner
              ? t('schedule.availability.uncancel')
              : t('schedule.availability.cancelledLabel')
          }
          aria-label={
            isOwner
              ? t('schedule.availability.uncancel')
              : t('schedule.availability.cancelledLabel')
          }
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            cursor: isOwner ? 'pointer' : 'default',
            border: '1px solid var(--border)',
            background: 'var(--bg-deep)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--red)',
          }}
        >
          <LuBan size={13} />
        </button>
      </div>
    )
  }

  const current = availOptions.find((o) => o.value === status)

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <button
        ref={btnRef}
        onClick={openMenu}
        title={current?.label ?? t('schedule.availability.setAvailability')}
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          cursor: 'pointer',
          border: '1px solid var(--border)',
          background: current ? 'var(--bg-deep)' : 'var(--bg-card)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: current?.color ?? 'var(--text-muted)',
        }}
      >
        {current ? <current.Icon size={13} /> : <LuMinus size={13} />}
      </button>

      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: 'fixed',
              top: menuPos.top,
              left: menuPos.left,
              transform: 'translateX(-50%)',
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 4,
              zIndex: 9999,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              minWidth: 140,
            }}
          >
            {availOptions.map((o) => (
              <button
                key={o.value}
                onClick={() => {
                  onSet(o.value)
                  setOpen(false)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  background: status === o.value ? 'var(--bg-card)' : 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: o.color,
                  fontSize: 13,
                  width: '100%',
                  textAlign: 'left',
                }}
              >
                <o.Icon size={13} /> {o.label}
              </button>
            ))}
            {isOwner && (
              <>
                <div style={{ height: 1, background: 'var(--border)', margin: '2px 4px' }} />
                <button
                  onClick={() => {
                    onCancel()
                    setOpen(false)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    color: 'var(--red)',
                    fontSize: 13,
                    width: '100%',
                    textAlign: 'left',
                  }}
                >
                  <LuBan size={13} /> {t('schedule.availability.cancelSession')}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function AvailabilityChart({
  availability,
  userId,
  isOwner,
  onSetAvailability,
  onCancelDate,
}) {
  const { t } = useTranslation()
  const AVAIL_LABELS = {
    available: t('schedule.availability.available'),
    tentative: t('schedule.availability.tentative'),
    unavailable: t('schedule.availability.unavailable'),
  }
  const translatedAvailOptions = AVAIL_OPTIONS.map((o) => ({
    ...o,
    label: AVAIL_LABELS[o.value] ?? o.label,
  }))

  if (!availability || availability.next_sessions.length === 0) return null

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '20px 22px',
        overflowX: 'auto',
        minHeight: 260,
      }}
    >
      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>
        {t('schedule.availability.title')}
      </h4>

      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 }}>
        <thead>
          <tr>
            <th
              style={{
                textAlign: 'left',
                padding: '6px 10px',
                color: 'var(--text-muted)',
                fontWeight: 500,
                borderBottom: '1px solid var(--border)',
                minWidth: 120,
              }}
            >
              {t('schedule.availability.player')}
            </th>
            {availability.next_sessions.map((date) => {
              const { short, weekday } = formatDate(date)
              const cancelled = availability.cancelled_dates.includes(date)
              return (
                <th
                  key={date}
                  style={{
                    textAlign: 'center',
                    padding: '6px 8px',
                    borderBottom: '1px solid var(--border)',
                    minWidth: 72,
                    color: cancelled ? 'var(--danger)' : 'var(--text-muted)',
                    fontWeight: 500,
                  }}
                >
                  <div style={{ fontSize: 11, opacity: 0.8 }}>{weekday}</div>
                  <div>{short}</div>
                  {cancelled && (
                    <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 700 }}>
                      {t('schedule.availability.cancelled')}
                    </div>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {availability.rows.map((row) => (
            <tr key={row.user_id}>
              <td
                style={{
                  padding: '10px 10px',
                  borderBottom: '1px solid var(--border)',
                  fontWeight: row.is_owner ? 600 : 400,
                }}
              >
                {row.username}
                {row.is_owner && (
                  <span style={{ marginLeft: 5, fontSize: 11, color: 'var(--gold)' }}>
                    {t('members.gm')}
                  </span>
                )}
                {row.user_id === userId && !row.is_owner && (
                  <span style={{ marginLeft: 5, fontSize: 11, color: 'var(--text-muted)' }}>
                    {t('members.you')}
                  </span>
                )}
              </td>
              {availability.next_sessions.map((date) => {
                const entry = row.dates[date] || {}
                const isCancelled =
                  availability.cancelled_dates.includes(date) || entry.is_cancelled
                const isMyRow = row.user_id === userId
                const canEdit = isMyRow || isOwner

                // GM row on a cancelled date: show the ban/uncancel control
                if (isCancelled && row.is_owner) {
                  return (
                    <td
                      key={date}
                      style={{
                        padding: '6px 8px',
                        borderBottom: '1px solid var(--border)',
                        textAlign: 'center',
                      }}
                    >
                      <AvailabilityCell
                        status={entry.status}
                        isCancelled={true}
                        isOwner={isOwner && isMyRow}
                        onSet={() => {}}
                        onCancel={() => onCancelDate(date)}
                        availOptions={translatedAvailOptions}
                      />
                    </td>
                  )
                }

                return (
                  <td
                    key={date}
                    style={{
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--border)',
                      textAlign: 'center',
                    }}
                  >
                    {canEdit ? (
                      <AvailabilityCell
                        status={entry.status}
                        isCancelled={false}
                        isOwner={isOwner && isMyRow}
                        onSet={(status) => onSetAvailability(date, status)}
                        onCancel={() => onCancelDate(date)}
                        availOptions={translatedAvailOptions}
                      />
                    ) : (
                      (() => {
                        const opt = translatedAvailOptions.find((o) => o.value === entry.status)
                        return opt ? (
                          <opt.Icon size={14} color={opt.color} />
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>—</span>
                        )
                      })()
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div
        style={{
          display: 'flex',
          gap: 16,
          marginTop: 14,
          paddingTop: 10,
          borderTop: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        {translatedAvailOptions.map((o) => (
          <span
            key={o.value}
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: o.color }}
          >
            <o.Icon size={12} aria-hidden="true" /> {o.label}
          </span>
        ))}
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 12,
            color: 'var(--danger)',
          }}
        >
          <LuBan size={12} aria-hidden="true" /> {t('schedule.availability.cancelledLabel')}
        </span>
      </div>
    </div>
  )
}
