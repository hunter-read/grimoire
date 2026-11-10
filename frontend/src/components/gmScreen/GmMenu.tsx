import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { LuChevronDown } from 'react-icons/lu'
import useAnchoredMenu from '../../hooks/useAnchoredMenu'
import useMenuKeyboard from '../../hooks/useMenuKeyboard'

export interface GmMenuItem {
  key: string
  label: string
  icon?: ReactNode
  onSelect: () => void
  disabled?: boolean
}

interface GmMenuProps {
  label: ReactNode
  items: GmMenuItem[]
  buttonStyle: CSSProperties
  width?: number
}

/** A button that opens a short menu of actions - the board's toolbar menus. */
export default function GmMenu({ label, items, buttonStyle, width = 240 }: GmMenuProps) {
  const [open, setOpen] = useState(false)
  const { triggerRef, panelRef, style } = useAnchoredMenu<HTMLButtonElement, HTMLDivElement>(open, {
    width,
    align: 'left',
  })
  useMenuKeyboard(open, panelRef, triggerRef, () => setOpen(false))

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, triggerRef, panelRef])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={buttonStyle}
      >
        {label} <LuChevronDown size={13} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{
              ...style,
              zIndex: 2000,
              padding: '4px 0',
              borderRadius: 8,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              boxShadow: '0 6px 20px var(--shadow)',
            }}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '9px 12px',
                  fontSize: 13,
                  textAlign: 'left',
                  color: 'var(--text)',
                  background: 'none',
                  border: 'none',
                  cursor: item.disabled ? 'default' : 'pointer',
                  opacity: item.disabled ? 0.6 : 1,
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}
