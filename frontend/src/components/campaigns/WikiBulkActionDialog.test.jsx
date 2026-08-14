import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WikiBulkActionDialog from './WikiBulkActionDialog'

const setup = (over = {}) => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <WikiBulkActionDialog
      deleteCount={0}
      hideCount={0}
      hiddenChildCount={0}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...over}
    />
  )
  return { onConfirm, onCancel }
}

describe('WikiBulkActionDialog', () => {
  // The mixed selection is the case this dialog exists for: some notes get
  // deleted, the rest can only be hidden, and both halves are stated up front.
  it('states the delete and hide halves separately', () => {
    setup({ deleteCount: 5, hideCount: 5 })
    expect(screen.getByText('Delete 5 notes you created.')).toBeTruthy()
    expect(screen.getByText(/Hide 5 notes you cannot delete\./)).toBeTruthy()
  })

  it('mentions the children a hide will sweep along', () => {
    setup({ hideCount: 2, hiddenChildCount: 3 })
    expect(screen.getByText(/This also hides 3 child notes\./)).toBeTruthy()
  })

  it('omits the child warning when there are none', () => {
    setup({ hideCount: 2, hiddenChildCount: 0 })
    expect(screen.queryByText(/also hides/)).toBeNull()
  })

  it('uses the singular wording for one note', () => {
    setup({ deleteCount: 1, hideCount: 1, hiddenChildCount: 1 })
    expect(screen.getByText('Delete 1 note you created.')).toBeTruthy()
    expect(screen.getByText(/Hide 1 note you cannot delete\./)).toBeTruthy()
    expect(screen.getByText(/This also hides 1 child note\./)).toBeTruthy()
  })

  // The confirm button names only the halves actually in play.
  it('labels the action for a delete-only selection', () => {
    setup({ deleteCount: 3 })
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
    expect(screen.queryByText(/cannot delete/)).toBeNull()
  })

  it('labels the action for a hide-only selection', () => {
    setup({ hideCount: 3 })
    expect(screen.getByRole('button', { name: 'Hide' })).toBeTruthy()
    // Nothing is destroyed, so the irreversibility warning stays away.
    expect(screen.queryByText('Deleting cannot be undone.')).toBeNull()
  })

  it('labels the action for a mixed selection', () => {
    setup({ deleteCount: 1, hideCount: 1 })
    expect(screen.getByRole('button', { name: 'Delete and hide' })).toBeTruthy()
  })

  it('warns that deleting is irreversible only when deleting', () => {
    setup({ deleteCount: 1 })
    expect(screen.getByText('Deleting cannot be undone.')).toBeTruthy()
  })

  it('confirms and cancels', () => {
    const { onConfirm, onCancel } = setup({ deleteCount: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('cancels on a backdrop click but not on a click inside the panel', () => {
    const { onCancel } = setup({ deleteCount: 1 })
    fireEvent.click(screen.getByRole('dialog'))
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('dialog').parentElement)
    expect(onCancel).toHaveBeenCalled()
  })
})
