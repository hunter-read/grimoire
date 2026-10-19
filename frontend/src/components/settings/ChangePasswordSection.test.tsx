import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ChangePasswordSection from './ChangePasswordSection'
import api, { auth } from '../../api'
import { clearPasswordRulesCache } from '../../hooks/usePasswordRules'

vi.mock('../../api', () => ({
  default: { patch: vi.fn() },
  auth: { status: vi.fn() },
}))

interface Fields {
  current?: string
  next?: string
  confirm?: string
}

function fill({ current, next, confirm }: Fields) {
  if (current !== undefined)
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } })
  if (next !== undefined)
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } })
  if (confirm !== undefined)
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } })
}

const status = (passwordMin: number) => ({
  initialized: true,
  password_min_length: passwordMin,
  share_link_password_min_length: 8,
})

beforeEach(() => {
  vi.clearAllMocks()
  clearPasswordRulesCache()
  vi.mocked(auth.status).mockResolvedValue(status(12))
})

// Wait for the password minimums to arrive before submitting.
async function renderSection() {
  render(<ChangePasswordSection />)
  await waitFor(() => expect(auth.status).toHaveBeenCalled())
}

describe('ChangePasswordSection', () => {
  it('submits the current and new password and shows a success hint', async () => {
    vi.mocked(api.patch).mockResolvedValue({})
    await renderSection()
    fill({ current: 'oldpass12', next: 'newpassword34', confirm: 'newpassword34' })
    fireEvent.click(screen.getByText('Update Password'))

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/users/me/password', {
        current_password: 'oldpass12',
        new_password: 'newpassword34',
      })
    )
    expect(await screen.findByText('Password updated')).toBeInTheDocument()
    // Fields reset after success.
    expect(screen.getByLabelText('New password')).toHaveValue('')
  })

  it('rejects mismatched new passwords without calling the API', async () => {
    await renderSection()
    fill({ current: 'oldpass12', next: 'newpassword34', confirm: 'different567' })
    fireEvent.click(screen.getByText('Update Password'))

    expect(await screen.findByText('New passwords do not match.')).toBeInTheDocument()
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('requires 12 characters by default', async () => {
    await renderSection()
    fill({ current: 'oldpass12', next: 'elevenchars', confirm: 'elevenchars' })
    fireEvent.click(screen.getByText('Update Password'))

    expect(
      await screen.findByText('New password must be at least 12 characters.')
    ).toBeInTheDocument()
    expect(api.patch).not.toHaveBeenCalled()
  })

  it("uses the server's minimum when it has been changed", async () => {
    vi.mocked(auth.status).mockResolvedValue(status(20))
    vi.mocked(api.patch).mockResolvedValue({})
    await renderSection()

    // Too short under either minimum, so submitting again until the server's
    // number shows never reaches the API.
    fill({ current: 'oldpass12', next: 'short', confirm: 'short' })
    await waitFor(() => {
      fireEvent.click(screen.getByText('Update Password'))
      expect(screen.getByText('New password must be at least 20 characters.')).toBeInTheDocument()
    })

    // Long enough for the default, not for this server.
    fill({ next: 'fifteen-chars-x', confirm: 'fifteen-chars-x' })
    fireEvent.click(screen.getByText('Update Password'))
    expect(screen.getByText('New password must be at least 20 characters.')).toBeInTheDocument()
    expect(api.patch).not.toHaveBeenCalled()

    fill({ next: 'twenty-characters-ok', confirm: 'twenty-characters-ok' })
    fireEvent.click(screen.getByText('Update Password'))
    await waitFor(() => expect(api.patch).toHaveBeenCalled())
  })

  it('keeps the default minimum when the status cannot be read', async () => {
    vi.mocked(auth.status).mockRejectedValue(new Error('offline'))
    await renderSection()
    fill({ current: 'oldpass12', next: 'elevenchars', confirm: 'elevenchars' })
    fireEvent.click(screen.getByText('Update Password'))

    expect(
      await screen.findByText('New password must be at least 12 characters.')
    ).toBeInTheDocument()
  })

  it('surfaces the API error message on failure', async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error('Current password is incorrect'))
    await renderSection()
    fill({ current: 'wrongpass', next: 'newpassword34', confirm: 'newpassword34' })
    fireEvent.click(screen.getByText('Update Password'))

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument()
  })

  it("shows the server's reason when it refuses a password as too common", async () => {
    vi.mocked(api.patch).mockRejectedValue(
      Object.assign(new Error('That password is too common - choose one that is harder to guess'), {
        status: 422,
      })
    )
    await renderSection()
    fill({ current: 'oldpass12', next: 'password1234', confirm: 'password1234' })
    fireEvent.click(screen.getByText('Update Password'))

    expect(
      await screen.findByText('That password is too common - choose one that is harder to guess')
    ).toBeInTheDocument()
  })

  it('falls back to a generic error when the failure has no message', async () => {
    vi.mocked(api.patch).mockRejectedValue({})
    await renderSection()
    fill({ current: 'wrongpass', next: 'newpassword34', confirm: 'newpassword34' })
    fireEvent.click(screen.getByText('Update Password'))

    expect(await screen.findByText('Failed to change password.')).toBeInTheDocument()
  })
})
