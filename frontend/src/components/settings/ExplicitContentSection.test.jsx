import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExplicitContentSection from './ExplicitContentSection'
import api from '../../api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))

const refreshUser = vi.fn()
let mockUser = { allow_explicit: true }
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, refreshUser }),
}))
vi.mock('../../api', () => ({ default: { patch: vi.fn(() => Promise.resolve({})) } }))

beforeEach(() => {
  vi.clearAllMocks()
  mockUser = { allow_explicit: true }
})

describe('ExplicitContentSection', () => {
  it('reflects the current allow_explicit state', () => {
    render(<ExplicitContentSection />)
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('toggles the preference off and refreshes the user', async () => {
    render(<ExplicitContentSection />)
    await userEvent.click(screen.getByRole('checkbox'))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/users/me/preferences', { allow_explicit: false })
    )
    expect(refreshUser).toHaveBeenCalled()
  })

  it('defaults to allowed when the flag is undefined', () => {
    mockUser = {}
    render(<ExplicitContentSection />)
    expect(screen.getByRole('checkbox')).toBeChecked()
  })
})
