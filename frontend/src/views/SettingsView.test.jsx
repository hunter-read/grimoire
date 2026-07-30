import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import SettingsView from './SettingsView'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

// Stub every tab so we only test SettingsView's routing/visibility logic.
vi.mock('../components/settings/UsersTab', () => ({ default: () => <div>users-tab</div> }))
vi.mock('../components/settings/MaintenanceTab', () => ({
  default: () => <div>maintenance-tab</div>,
}))
vi.mock('../components/settings/UserSettingsTab', () => ({ default: () => <div>account-tab</div> }))
vi.mock('../components/settings/AppSettingsTab', () => ({ default: () => <div>app-tab</div> }))
vi.mock('../components/settings/AuthenticationTab', () => ({ default: () => <div>auth-tab</div> }))
vi.mock('../components/settings/LogsTab', () => ({ default: () => <div>logs-tab</div> }))
vi.mock('../components/settings/MetadataTab', () => ({ default: () => <div>metadata-tab</div> }))

function renderAt(tab, user) {
  return render(
    <MemoryRouter initialEntries={[`/settings/${tab}`]}>
      <Routes>
        <Route path="/settings/:tab" element={<SettingsView user={user} onLogout={vi.fn()} />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('SettingsView', () => {
  it('shows the metadata tab link for admins', () => {
    renderAt('account', { role: 'admin' })
    expect(screen.getByText('settings.tabs.metadata')).toBeInTheDocument()
  })

  it('renders the metadata tab content when selected', () => {
    renderAt('metadata', { role: 'admin' })
    expect(screen.getByText('metadata-tab')).toBeInTheDocument()
  })

  it('hides admin tabs (incl. metadata) from non-admins', () => {
    renderAt('metadata', { role: 'player' })
    expect(screen.queryByText('settings.tabs.metadata')).not.toBeInTheDocument()
    expect(screen.queryByText('metadata-tab')).not.toBeInTheDocument()
    expect(screen.getByText('settings.tabs.account')).toBeInTheDocument()
  })
})
