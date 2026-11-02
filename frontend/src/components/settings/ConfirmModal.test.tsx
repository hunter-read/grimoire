import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import ConfirmModal from './ConfirmModal'

function renderModal(props: Partial<Parameters<typeof ConfirmModal>[0]> = {}) {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  render(
    <ConfirmModal
      title="Remove source?"
      message="Are you sure you want to remove this source?"
      onConfirm={onConfirm}
      onClose={onClose}
      {...props}
    />
  )
  return { onConfirm, onClose }
}

describe('ConfirmModal', () => {
  it('renders title and message correctly', () => {
    renderModal()
    expect(screen.getByText('Remove source?')).toBeInTheDocument()
    expect(screen.getByText('Are you sure you want to remove this source?')).toBeInTheDocument()
  })

  it('is named by its title and described by its message', () => {
    renderModal()
    const dialog = screen.getByRole('dialog', { name: 'Remove source?' })
    expect(dialog).toHaveAccessibleDescription('Are you sure you want to remove this source?')
  })

  it('calls onConfirm when confirm button is clicked', () => {
    const { onConfirm } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when cancel button is clicked', () => {
    const { onClose } = renderModal()
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when clicking overlay background', () => {
    const { onClose } = renderModal()
    // The dialog is the panel; the overlay is its parent.
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when clicking inside the panel', () => {
    const { onClose } = renderModal()
    fireEvent.click(screen.getByText('Remove source?'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose when pressing Escape key', () => {
    const { onClose } = renderModal()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // A stray Enter on a destructive dialog should back out, not go ahead.
  it('starts with focus on Cancel', () => {
    renderModal()
    expect(screen.getByRole('button', { name: /cancel/i })).toHaveFocus()
  })

  it('uses the given confirm label', () => {
    renderModal({ confirmLabel: 'Remove 3 records' })
    expect(screen.getByRole('button', { name: 'Remove 3 records' })).toBeInTheDocument()
  })

  it('paints the confirm button in the danger tokens by default', () => {
    renderModal()
    const button = screen.getByRole('button', { name: /confirm/i })
    expect(button.style.background).toBe('var(--danger-fill)')
    expect(button.style.color).toBe('var(--on-danger)')
  })

  it('paints the confirm button gold for the default tone', () => {
    renderModal({ tone: 'default' })
    const button = screen.getByRole('button', { name: /confirm/i })
    expect(button.style.background).toBe('var(--gold)')
    expect(button.style.color).toBe('var(--on-accent)')
  })

  it('can hold the confirm button disabled', () => {
    const { onConfirm } = renderModal({ confirmDisabled: true })
    const button = screen.getByRole('button', { name: /confirm/i })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('renders children between the message and the buttons', () => {
    renderModal({ children: <ul aria-label="affected" /> })
    expect(screen.getByRole('list', { name: 'affected' })).toBeInTheDocument()
  })

  it('keeps Tab and Shift+Tab inside the dialog', () => {
    renderModal()
    const cancel = screen.getByRole('button', { name: /cancel/i })
    const confirm = screen.getByRole('button', { name: /confirm/i })

    // From the last control, Tab wraps to the first.
    confirm.focus()
    fireEvent.keyDown(confirm, { key: 'Tab' })
    expect(cancel).toHaveFocus()

    // From the first, Shift+Tab wraps to the last.
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
    expect(confirm).toHaveFocus()

    // Anything else is left alone.
    fireEvent.keyDown(confirm, { key: 'Tab', shiftKey: true })
    expect(confirm).toHaveFocus()
    fireEvent.keyDown(confirm, { key: 'a' })
    expect(confirm).toHaveFocus()
  })

  it('returns focus to whatever opened it', () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          {open && (
            <ConfirmModal
              title="T"
              message="M"
              onConfirm={() => setOpen(false)}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      )
    }
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open' })
    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByRole('button', { name: /cancel/i })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(opener).toHaveFocus()
  })
})
