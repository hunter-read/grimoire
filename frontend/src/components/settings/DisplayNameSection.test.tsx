import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DisplayNameSection from './DisplayNameSection'
import api from '../../api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))

const refreshUser = vi.fn()
let mockUser = { username: 'gm', display_name: 'Game Master' }
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, refreshUser }),
}))
vi.mock('../../api', () => ({ default: { patch: vi.fn(() => Promise.resolve({})) } }))

beforeEach(() => {
  vi.clearAllMocks()
  mockUser = { username: 'gm', display_name: 'Game Master' }
})

describe('DisplayNameSection', () => {
  it('seeds the input from the current display name', () => {
    render(<DisplayNameSection />)
    expect(screen.getByLabelText('userSettings.displayName.label').value).toBe('Game Master')
  })

  it('saves a trimmed display name and refreshes the user', async () => {
    render(<DisplayNameSection />)
    const input = screen.getByLabelText('userSettings.displayName.label')
    await userEvent.clear(input)
    await userEvent.type(input, '  New Name  ')
    await userEvent.click(screen.getByText('userSettings.displayName.save'))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/users/me/preferences', { display_name: 'New Name' })
    )
    expect(refreshUser).toHaveBeenCalled()
  })

  it('shows an error message when saving fails', async () => {
    api.patch.mockRejectedValueOnce(new Error('boom'))
    render(<DisplayNameSection />)
    await userEvent.click(screen.getByText('userSettings.displayName.save'))
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument())
  })
})
