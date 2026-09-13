import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ConfirmModal from './ConfirmModal'

describe('ConfirmModal', () => {
  it('renders title and message correctly', () => {
    render(
      <ConfirmModal
        title="Remove source?"
        message="Are you sure you want to remove this source?"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('Remove source?')).toBeInTheDocument()
    expect(screen.getByText('Are you sure you want to remove this source?')).toBeInTheDocument()
  })

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmModal
        title="Test Title"
        message="Test Message"
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when cancel button is clicked', () => {
    const onClose = vi.fn()
    render(
      <ConfirmModal
        title="Test Title"
        message="Test Message"
        onConfirm={vi.fn()}
        onClose={onClose}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when clicking overlay background', () => {
    const onClose = vi.fn()
    render(
      <ConfirmModal
        title="Test Title"
        message="Test Message"
        onConfirm={vi.fn()}
        onClose={onClose}
      />
    )

    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when pressing Escape key', () => {
    const onClose = vi.fn()
    render(
      <ConfirmModal
        title="Test Title"
        message="Test Message"
        onConfirm={vi.fn()}
        onClose={onClose}
      />
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
