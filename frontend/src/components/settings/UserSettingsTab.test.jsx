import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import UserSettingsTab from './UserSettingsTab'
import { UISettingsProvider } from '../../context/UISettingsContext'

// The account sections call api and opds on mount; stub them out.
vi.mock('../../api', () => ({
  default: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  opds: { getStatus: vi.fn(() => Promise.resolve({ opds_enabled: false })) },
}))

// Child sections read the current user via useAuth; provide a stub.
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'u' }, refreshUser: vi.fn() }),
}))

function renderTab(uiSettings, user) {
  return render(
    <UISettingsProvider value={uiSettings}>
      <UserSettingsTab user={user} onLogout={() => {}} />
    </UISettingsProvider>
  )
}

describe('UserSettingsTab — demo mode lockdown', () => {
  it('disables all account actions for a non-admin when demo mode is on', () => {
    const { container } = renderTab({ demo_mode: true }, { role: 'player', username: 'p' })
    const fieldset = container.querySelector('fieldset')
    expect(fieldset).toBeDisabled()
    expect(screen.getByText(/demo server/i)).toBeInTheDocument()
  })

  it('locks gm accounts too', () => {
    const { container } = renderTab({ demo_mode: true }, { role: 'gm', username: 'g' })
    expect(container.querySelector('fieldset')).toBeDisabled()
  })

  it('does not lock admin accounts in demo mode', () => {
    const { container } = renderTab({ demo_mode: true }, { role: 'admin', username: 'a' })
    expect(container.querySelector('fieldset')).not.toBeDisabled()
    expect(screen.queryByText(/demo server/i)).not.toBeInTheDocument()
  })

  it('does not lock non-admins when demo mode is off', () => {
    const { container } = renderTab({ demo_mode: false }, { role: 'player', username: 'p' })
    expect(container.querySelector('fieldset')).not.toBeDisabled()
    expect(screen.queryByText(/demo server/i)).not.toBeInTheDocument()
  })
})
