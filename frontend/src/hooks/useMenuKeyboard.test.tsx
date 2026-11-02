import { describe, it, expect, vi } from 'vitest'
import { useRef, useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import useMenuKeyboard from './useMenuKeyboard'

/** A menu button whose popup has three items, the middle one disabled-free. */
function Menu({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useMenuKeyboard(open, menuRef, triggerRef, () => {
    setOpen(false)
    onClose()
  })
  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <div ref={menuRef} role="menu">
          <button role="menuitem">First</button>
          <button role="menuitem" disabled>
            Skipped
          </button>
          <button role="menuitem">Second</button>
          <input aria-label="DPI" role="menuitem" />
        </div>
      )}
    </>
  )
}

const item = (name: string) => screen.getByRole('menuitem', { name })

describe('useMenuKeyboard', () => {
  it('moves focus to the first item when the menu opens', () => {
    render(<Menu />)
    fireEvent.click(screen.getByText('Open'))
    expect(item('First')).toHaveFocus()
  })

  it('steps through the enabled items with the arrow keys, wrapping', () => {
    render(<Menu />)
    fireEvent.click(screen.getByText('Open'))
    fireEvent.keyDown(item('First'), { key: 'ArrowDown' })
    expect(item('Second')).toHaveFocus()
    fireEvent.keyDown(item('Second'), { key: 'ArrowDown' })
    expect(item('DPI')).toHaveFocus()
  })

  it('wraps from the first item back to the last', () => {
    render(<Menu />)
    fireEvent.click(screen.getByText('Open'))
    fireEvent.keyDown(item('First'), { key: 'ArrowUp' })
    expect(item('DPI')).toHaveFocus()
  })

  it('jumps to the ends with Home and End', () => {
    render(<Menu />)
    fireEvent.click(screen.getByText('Open'))
    fireEvent.keyDown(item('First'), { key: 'End' })
    expect(item('DPI')).toHaveFocus()
    item('Second').focus()
    fireEvent.keyDown(item('Second'), { key: 'Home' })
    expect(item('First')).toHaveFocus()
  })

  it('leaves a text field its own arrow keys', () => {
    render(<Menu />)
    fireEvent.click(screen.getByText('Open'))
    item('DPI').focus()
    fireEvent.keyDown(item('DPI'), { key: 'ArrowDown' })
    expect(item('DPI')).toHaveFocus()
  })

  it('closes on Escape and hands focus back to the trigger', () => {
    const onClose = vi.fn()
    render(<Menu onClose={onClose} />)
    fireEvent.click(screen.getByText('Open'))
    fireEvent.keyDown(item('First'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByText('Open')).toHaveFocus()
  })

  it('closes on Tab rather than letting focus fall off the end of the page', () => {
    const onClose = vi.fn()
    render(<Menu onClose={onClose} />)
    fireEvent.click(screen.getByText('Open'))
    fireEvent.keyDown(item('First'), { key: 'Tab' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Open')).toHaveFocus()
  })

  it('ignores other keys', () => {
    const onClose = vi.fn()
    render(<Menu onClose={onClose} />)
    fireEvent.click(screen.getByText('Open'))
    fireEvent.keyDown(item('First'), { key: 'a' })
    expect(item('First')).toHaveFocus()
    expect(onClose).not.toHaveBeenCalled()
  })
})
