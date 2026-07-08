import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AuthenticationTab from './AuthenticationTab'
import { settings as settingsApi } from '../../api'

vi.mock('../../api', () => ({
  settings: { get: vi.fn(), patch: vi.fn() },
}))

// Nested sections do their own fetching — stub them out.
vi.mock('./OIDCSettingsSection', () => ({
  default: () => <div data-testid="oidc-section" />,
}))
vi.mock('./RichTextEditor', () => ({
  default: ({ value, onChange, ariaLabel }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

function mockSettings(overrides = {}) {
  settingsApi.get.mockResolvedValue({
    password_auth_enabled: true,
    guest_access_enabled: false,
    custom_login_message_enabled: false,
    password_auth_env_locked: false,
    guest_access_env_locked: false,
    custom_login_message: '',
    ...overrides,
  })
  settingsApi.patch.mockResolvedValue({})
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AuthenticationTab', () => {
  it('loads settings and renders the three sections', async () => {
    mockSettings()
    render(<AuthenticationTab />)
    expect(await screen.findByText('Password Authentication')).toBeInTheDocument()
    expect(screen.getByText('Guest Access')).toBeInTheDocument()
    expect(screen.getByText('Custom Login Message')).toBeInTheDocument()
    expect(screen.getByTestId('oidc-section')).toBeInTheDocument()
  })

  it('falls back to defaults when the settings request fails', async () => {
    settingsApi.get.mockRejectedValue(new Error('boom'))
    render(<AuthenticationTab />)
    // Password auth defaults to enabled/checked on error.
    const checkbox = await screen.findByLabelText('Enable password authentication')
    expect(checkbox).toBeChecked()
  })

  it('toggles password authentication and persists the new value', async () => {
    mockSettings()
    render(<AuthenticationTab />)
    const checkbox = await screen.findByLabelText('Enable password authentication')
    fireEvent.click(checkbox)
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({ password_auth_enabled: false })
    )
  })

  it('toggles guest access', async () => {
    mockSettings()
    render(<AuthenticationTab />)
    const checkbox = await screen.findByLabelText('Enable guest invite codes')
    fireEvent.click(checkbox)
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({ guest_access_enabled: true })
    )
  })

  it('disables the password toggle and shows a notice when env-locked', async () => {
    mockSettings({ password_auth_env_locked: true })
    render(<AuthenticationTab />)
    const checkbox = await screen.findByLabelText('Enable password authentication')
    expect(checkbox).toBeDisabled()
    expect(screen.getByText(/ALLOW_PASSWORD_AUTHENTICATION/)).toBeInTheDocument()
  })

  it('disables the guest toggle when guest access is env-locked', async () => {
    mockSettings({ guest_access_env_locked: true })
    render(<AuthenticationTab />)
    const checkbox = await screen.findByLabelText('Enable guest invite codes')
    expect(checkbox).toBeDisabled()
    expect(screen.getByText(/GUEST_ACCESS_ENABLED/)).toBeInTheDocument()
  })

  it('reveals the editor when the custom message is enabled and saves edits', async () => {
    mockSettings({ custom_login_message_enabled: true, custom_login_message: 'Welcome' })
    render(<AuthenticationTab />)

    const editor = await screen.findByLabelText('Custom login message')
    expect(editor).toHaveValue('Welcome')

    // Save is disabled until the draft becomes dirty.
    const saveBtn = screen.getByText('Save')
    expect(saveBtn).toBeDisabled()

    fireEvent.change(editor, { target: { value: 'Welcome, adventurers' } })
    expect(saveBtn).not.toBeDisabled()
    fireEvent.click(saveBtn)

    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({
        custom_login_message: 'Welcome, adventurers',
      })
    )
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('enabling the custom message toggle persists the flag', async () => {
    mockSettings()
    render(<AuthenticationTab />)
    const checkbox = await screen.findByLabelText('Show custom message on login')
    fireEvent.click(checkbox)
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({ custom_login_message_enabled: true })
    )
  })
})
