import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EmailSection from './EmailSection'
import api from '../../api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))

const refreshUser = vi.fn()
let mockUser = { username: 'gm', email: 'gm@example.com' }
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, refreshUser }),
}))
vi.mock('../../api', () => ({ default: { patch: vi.fn(() => Promise.resolve({})) } }))

beforeEach(() => {
  vi.clearAllMocks()
  mockUser = { username: 'gm', email: 'gm@example.com' }
})

describe('EmailSection', () => {
  it('seeds the input from the current email', () => {
    render(<EmailSection />)
    expect(screen.getByLabelText('userSettings.email.label').value).toBe('gm@example.com')
  })

  it('saves the trimmed email and refreshes the user', async () => {
    render(<EmailSection />)
    const input = screen.getByLabelText('userSettings.email.label')
    await userEvent.clear(input)
    await userEvent.type(input, ' new@example.com ')
    await userEvent.click(screen.getByText('common.save'))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/users/me/preferences', {
        email: 'new@example.com',
      })
    )
    expect(refreshUser).toHaveBeenCalled()
  })

  it('surfaces an error when the save fails', async () => {
    api.patch.mockRejectedValueOnce(new Error('bad email'))
    render(<EmailSection />)
    await userEvent.click(screen.getByText('common.save'))
    await waitFor(() => expect(screen.getByText('bad email')).toBeInTheDocument())
  })
})
