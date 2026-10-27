import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DeleteAccountSection from './DeleteAccountSection'
import api from '../../api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))
vi.mock('../../api', () => ({ default: { delete: vi.fn(() => Promise.resolve({})) } }))

beforeEach(() => vi.clearAllMocks())

describe('DeleteAccountSection', () => {
  it('disables the delete button for admins and shows the admin warning', () => {
    render(<DeleteAccountSection user={{ role: 'admin' }} onLogout={vi.fn()} />)
    expect(screen.getByText('userSettings.deleteAccount.deleteButton')).toBeDisabled()
    expect(screen.getByText('userSettings.deleteAccount.adminWarning')).toBeInTheDocument()
  })

  it('confirms then deletes the account and logs out', async () => {
    const onLogout = vi.fn()
    render(<DeleteAccountSection user={{ role: 'player' }} onLogout={onLogout} />)
    await userEvent.click(screen.getByText('userSettings.deleteAccount.deleteButton'))
    // Confirmation panel appears.
    await userEvent.click(screen.getByText('userSettings.deleteAccount.confirmDelete'))
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/users/me'))
    expect(onLogout).toHaveBeenCalled()
  })

  it('can back out of the confirmation', async () => {
    render(<DeleteAccountSection user={{ role: 'player' }} onLogout={vi.fn()} />)
    await userEvent.click(screen.getByText('userSettings.deleteAccount.deleteButton'))
    await userEvent.click(screen.getByText('common.cancel'))
    expect(screen.queryByText('userSettings.deleteAccount.confirmDelete')).not.toBeInTheDocument()
  })

  it('does not log out when the delete request fails', async () => {
    api.delete.mockRejectedValueOnce(new Error('nope'))
    const onLogout = vi.fn()
    render(<DeleteAccountSection user={{ role: 'player' }} onLogout={onLogout} />)
    await userEvent.click(screen.getByText('userSettings.deleteAccount.deleteButton'))
    await userEvent.click(screen.getByText('userSettings.deleteAccount.confirmDelete'))
    await waitFor(() => expect(api.delete).toHaveBeenCalled())
    // On failure it exits the confirming state and never logs out.
    expect(onLogout).not.toHaveBeenCalled()
    expect(screen.queryByText('userSettings.deleteAccount.confirmDelete')).not.toBeInTheDocument()
  })
})
