import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ChangePasswordSection from './ChangePasswordSection'
import api from '../../api'

vi.mock('../../api', () => ({
  default: { patch: vi.fn() },
}))

function fill({ current, next, confirm }) {
  if (current !== undefined)
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } })
  if (next !== undefined)
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } })
  if (confirm !== undefined)
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ChangePasswordSection', () => {
  it('submits the current and new password and shows a success hint', async () => {
    api.patch.mockResolvedValue({})
    render(<ChangePasswordSection />)
    fill({ current: 'oldpass12', next: 'newpass34', confirm: 'newpass34' })
    fireEvent.click(screen.getByText('Update Password'))

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/users/me/password', {
        current_password: 'oldpass12',
        new_password: 'newpass34',
      })
    )
    expect(await screen.findByText('Password updated')).toBeInTheDocument()
    // Fields reset after success.
    expect(screen.getByLabelText('New password')).toHaveValue('')
  })

  it('rejects mismatched new passwords without calling the API', async () => {
    render(<ChangePasswordSection />)
    fill({ current: 'oldpass12', next: 'newpass34', confirm: 'different5' })
    fireEvent.click(screen.getByText('Update Password'))

    expect(await screen.findByText('New passwords do not match.')).toBeInTheDocument()
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('rejects a too-short new password', async () => {
    render(<ChangePasswordSection />)
    fill({ current: 'oldpass12', next: 'short', confirm: 'short' })
    fireEvent.click(screen.getByText('Update Password'))

    expect(
      await screen.findByText('New password must be at least 8 characters.')
    ).toBeInTheDocument()
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('surfaces the API error message on failure', async () => {
    api.patch.mockRejectedValue(new Error('Current password is incorrect'))
    render(<ChangePasswordSection />)
    fill({ current: 'wrongpass', next: 'newpass34', confirm: 'newpass34' })
    fireEvent.click(screen.getByText('Update Password'))

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument()
  })

  it('falls back to a generic error when the failure has no message', async () => {
    api.patch.mockRejectedValue({})
    render(<ChangePasswordSection />)
    fill({ current: 'wrongpass', next: 'newpass34', confirm: 'newpass34' })
    fireEvent.click(screen.getByText('Update Password'))

    expect(await screen.findByText('Failed to change password.')).toBeInTheDocument()
  })
})
