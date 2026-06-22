import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuBan } from 'react-icons/lu'
import { AVAIL_OPTIONS, formatDate } from './_scheduleShared'
import AvailabilityCell from './AvailabilityCell'

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
    // Fill the parent card. The table region scrolls both ways with a pinned
    // header row; the legend stays fixed at the bottom.
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <table
          style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 }}
        >
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
                  // Pin the header on vertical scroll; the corner cell also pins
                  // left so the player column header stays put.
                  position: 'sticky',
                  top: 0,
                  left: 0,
                  zIndex: 2,
                  background: 'var(--bg-card)',
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
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                      background: 'var(--bg-card)',
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
                    // Keep the player name visible during horizontal scroll.
                    position: 'sticky',
                    left: 0,
                    zIndex: 1,
                    background: 'var(--bg-card)',
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
      </div>

      {/* Legend — pinned to the bottom of the card, outside the scroll region. */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          marginTop: 14,
          paddingTop: 10,
          borderTop: '1px solid var(--border)',
          flexWrap: 'wrap',
          flexShrink: 0,
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
