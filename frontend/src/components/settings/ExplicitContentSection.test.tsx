import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExplicitContentSection from './ExplicitContentSection'
import api from '../../api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))

const refreshUser = vi.fn()
let mockUser: { allow_explicit?: boolean; explicit_locked?: boolean } = { allow_explicit: true }
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

describe('ExplicitContentSection when an admin has locked it', () => {
  it('disables the toggle and says why', () => {
    mockUser = { allow_explicit: false, explicit_locked: true }
    render(<ExplicitContentSection />)
    const box = screen.getByRole('checkbox')
    expect(box).not.toBeChecked()
    expect(box).toBeDisabled()
    expect(screen.getByText('userSettings.contentPreferences.lockedHint')).toBeInTheDocument()
  })

  it('stays usable when the user turned it off themselves', () => {
    mockUser = { allow_explicit: false, explicit_locked: false }
    render(<ExplicitContentSection />)
    expect(screen.getByRole('checkbox')).toBeEnabled()
    expect(screen.queryByText('userSettings.contentPreferences.lockedHint')).toBeNull()
  })
})
