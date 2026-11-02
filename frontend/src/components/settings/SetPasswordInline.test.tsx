import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SetPasswordInline from './SetPasswordInline'
import { auth } from '../../api'
import { clearPasswordRulesCache } from '../../hooks/usePasswordRules'

vi.mock('../../api', () => ({
  default: {},
  auth: { status: vi.fn() },
}))

beforeEach(() => {
  clearPasswordRulesCache()
  vi.mocked(auth.status).mockResolvedValue({
    initialized: true,
    password_min_length: 12,
    share_link_password_min_length: 8,
  } as never)
})

const field = () => screen.getByLabelText('New password (min 12)')

describe('SetPasswordInline', () => {
  it('asks for a new password, so a password manager offers to make one', async () => {
    render(<SetPasswordInline onSave={vi.fn()} onCancel={vi.fn()} />)
    await waitFor(() => expect(field()).toBeInTheDocument())
    expect(field()).toHaveAttribute('autocomplete', 'new-password')
    expect(field()).toHaveFocus()
  })

  it('ties a too-short password to an alert', async () => {
    const onSave = vi.fn()
    render(<SetPasswordInline onSave={onSave} onCancel={vi.fn()} />)
    await waitFor(() => expect(field()).toBeInTheDocument())
    fireEvent.change(field(), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set Password' }))
    const alert = await screen.findByRole('alert')
    expect(field()).toHaveAttribute('aria-invalid', 'true')
    expect(field()).toHaveAttribute('aria-describedby', alert.id)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves a long enough password and closes; Escape cancels', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onCancel = vi.fn()
    render(<SetPasswordInline onSave={onSave} onCancel={onCancel} />)
    await waitFor(() => expect(field()).toBeInTheDocument())
    fireEvent.change(field(), { target: { value: 'longenough12' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('longenough12'))
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('reports a failed save', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('x'))
    render(<SetPasswordInline onSave={onSave} onCancel={vi.fn()} />)
    await waitFor(() => expect(field()).toBeInTheDocument())
    fireEvent.change(field(), { target: { value: 'longenough12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set Password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to set password')
  })
})
