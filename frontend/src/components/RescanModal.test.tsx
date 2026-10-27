import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RescanModal from './RescanModal'

function renderModal(props = {}) {
  return render(<RescanModal scope={null} onConfirm={vi.fn()} onClose={vi.fn()} {...props} />)
}

describe('RescanModal', () => {
  it('defaults to "Find new files" and confirms with mode "new"', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    renderModal({ onConfirm, onClose })

    fireEvent.click(screen.getByText('Start rescan'))
    expect(onConfirm).toHaveBeenCalledWith('new')
    expect(onClose).toHaveBeenCalled()
  })

  it('confirms the selected mode', () => {
    const onConfirm = vi.fn()
    renderModal({ onConfirm })

    fireEvent.click(screen.getByText('Replace all metadata'))
    fireEvent.click(screen.getByText('Start rescan'))
    expect(onConfirm).toHaveBeenCalledWith('replace')
  })

  it('shows a destructive warning only for the replace mode', () => {
    renderModal()
    // Warning hidden until replace is selected.
    expect(screen.queryByText(/overwrites fields you've edited/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Replace all metadata'))
    expect(screen.getByText(/overwrites fields you've edited/i)).toBeInTheDocument()
  })

  it('shows the scope path when scoped', () => {
    renderModal({ scope: 'books/D&D 5e/adventure' })
    expect(screen.getByText(/books\/D&D 5e\/adventure/)).toBeInTheDocument()
  })

  it('shows whole-library copy when unscoped', () => {
    renderModal({ scope: null })
    expect(screen.getByText(/entire library/i)).toBeInTheDocument()
  })
})
