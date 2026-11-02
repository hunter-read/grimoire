import { useState, useRef } from 'react'
import useMenuKeyboard from '../../hooks/useMenuKeyboard'
import { useTranslation } from 'react-i18next'
import { LuMinus, LuBan } from 'react-icons/lu'
import type { AvailOption } from './_scheduleShared'

/** A single availability cell: shows current status and opens a status-picker menu. */
interface AvailabilityCellProps {
  /**
   * Who and when this cell is for ("Ana, Tue 4 Mar"). The cell is an icon in a
   * grid, so without it a screen reader hears only "Available, button" with no
   * way to tell which player or session it answers for.
   */
  context?: string
  status?: string | null
  isCancelled: boolean
  isOwner: boolean
  onSet: (status: string) => void
  onCancel: () => void
  availOptions: readonly AvailOption[]
}

export default function AvailabilityCell({
  context,
  status,
  isCancelled,
  isOwner,
  onSet,
  onCancel,
  availOptions,
}: AvailabilityCellProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  // Arrow keys through the statuses; Esc or Tab closes back onto the cell.
  useMenuKeyboard(open, menuRef, btnRef, () => setOpen(false))
  const named = (text: string) => (context ? `${context}: ${text}` : text)

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
          aria-label={named(
            isOwner
              ? t('schedule.availability.uncancel')
              : t('schedule.availability.cancelledLabel')
          )}
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
        aria-label={named(current?.label ?? t('a11y.campaignNotes.availabilityNotSet'))}
        aria-haspopup="menu"
        aria-expanded={open}
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
            ref={menuRef}
            role="menu"
            aria-label={context ?? t('schedule.availability.setAvailability')}
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
              boxShadow: '0 8px 24px var(--shadow)',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              minWidth: 140,
            }}
          >
            {availOptions.map((o) => (
              <button
                key={o.value}
                role="menuitemradio"
                aria-checked={status === o.value}
                onClick={() => {
                  onSet(o.value)
                  setOpen(false)
                  btnRef.current?.focus()
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
                <div
                  role="separator"
                  style={{ height: 1, background: 'var(--border)', margin: '2px 4px' }}
                />
                <button
                  role="menuitem"
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
