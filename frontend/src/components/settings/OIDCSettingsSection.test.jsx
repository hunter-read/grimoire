import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OIDCSettingsSection from './OIDCSettingsSection'
import api, { settings as settingsApi } from '../../api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))

vi.mock('../../api', () => ({
  default: { post: vi.fn() },
  settings: { get: vi.fn(), patch: vi.fn() },
}))

const baseSettings = (over = {}) => ({
  oidc_enabled: false,
  oidc_issuer_url: '',
  oidc_token_issuer: '',
  oidc_authorization_endpoint: '',
  oidc_token_endpoint: '',
  oidc_userinfo_endpoint: '',
  oidc_jwks_uri: '',
  oidc_end_session_endpoint: '',
  oidc_client_id: '',
  oidc_signing_alg: 'RS256',
  oidc_button_text: '',
  oidc_groups_claim: '',
  oidc_permissions_claim: '',
  oidc_match_by: 'none',
  oidc_auto_launch: false,
  oidc_auto_register: false,
  oidc_client_secret_set: false,
  oidc_client_secret_length: 0,
  oidc_redirect_uri: 'https://grimoire.example.com/api/auth/openid/callback',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } })
})

describe('OIDCSettingsSection', () => {
  it('shows a spinner until the settings arrive', async () => {
    let resolve
    settingsApi.get.mockReturnValue(new Promise((r) => (resolve = r)))
    render(<OIDCSettingsSection />)
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
    resolve(baseSettings())
    expect(await screen.findByText('authSettings.oidc.title')).toBeInTheDocument()
  })

  it('renders the form seeded from the server values', async () => {
    settingsApi.get.mockResolvedValue(
      baseSettings({ oidc_enabled: true, oidc_client_id: 'grimoire', oidc_match_by: 'email' })
    )
    render(<OIDCSettingsSection />)
    expect(await screen.findByText('authSettings.oidc.title')).toBeInTheDocument()
    expect(screen.getByLabelText('authSettings.oidc.clientId').value).toBe('grimoire')
    expect(screen.getByLabelText('authSettings.oidc.matchBy').value).toBe('email')
    // The enable checkbox mirrors oidc_enabled.
    expect(screen.getAllByRole('checkbox')[0].checked).toBe(true)
    expect(
      screen.getByText('https://grimoire.example.com/api/auth/openid/callback')
    ).toBeInTheDocument()
  })

  it('copies the redirect URI to the clipboard', async () => {
    settingsApi.get.mockResolvedValue(baseSettings())
    render(<OIDCSettingsSection />)
    await userEvent.click(await screen.findByTitle('authSettings.oidc.copy'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://grimoire.example.com/api/auth/openid/callback'
    )
  })

  it('saves a string field on blur when it changed', async () => {
    settingsApi.get.mockResolvedValue(baseSettings())
    settingsApi.patch.mockResolvedValue(baseSettings({ oidc_client_id: 'app' }))
    render(<OIDCSettingsSection />)
    const input = await screen.findByLabelText('authSettings.oidc.clientId')
    await userEvent.type(input, 'app')
    await userEvent.tab()
    await waitFor(() => expect(settingsApi.patch).toHaveBeenCalledWith({ oidc_client_id: 'app' }))
  })

  it('does not save a string field when the value is unchanged', async () => {
    settingsApi.get.mockResolvedValue(baseSettings({ oidc_client_id: 'app' }))
    render(<OIDCSettingsSection />)
    const input = await screen.findByLabelText('authSettings.oidc.clientId')
    await userEvent.click(input)
    await userEvent.tab()
    expect(settingsApi.patch).not.toHaveBeenCalled()
  })

  it('blurs the field when Enter is pressed', async () => {
    settingsApi.get.mockResolvedValue(baseSettings())
    settingsApi.patch.mockResolvedValue(baseSettings({ oidc_jwks_uri: 'https://idp/jwks' }))
    render(<OIDCSettingsSection />)
    const input = await screen.findByLabelText('authSettings.oidc.jwksUri')
    await userEvent.type(input, 'https://idp/jwks{Enter}')
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({ oidc_jwks_uri: 'https://idp/jwks' })
    )
  })

  it('surfaces an error when saving a field fails', async () => {
    settingsApi.get.mockResolvedValue(baseSettings())
    settingsApi.patch.mockRejectedValue(new Error('nope'))
    render(<OIDCSettingsSection />)
    const input = await screen.findByLabelText('authSettings.oidc.clientId')
    await userEvent.type(input, 'x')
    await userEvent.tab()
    expect(await screen.findByText('nope')).toBeInTheDocument()
  })

  it('falls back to a translated message when the error has no message', async () => {
    settingsApi.get.mockResolvedValue(baseSettings())
    settingsApi.patch.mockRejectedValue({})
    render(<OIDCSettingsSection />)
    const input = await screen.findByLabelText('authSettings.oidc.clientId')
    await userEvent.type(input, 'x')
    await userEvent.tab()
    expect(await screen.findByText('authSettings.oidc.saveFailed')).toBeInTheDocument()
  })

  it('toggles a boolean field and persists it', async () => {
    settingsApi.get.mockResolvedValue(baseSettings())
    settingsApi.patch.mockResolvedValue(baseSettings({ oidc_enabled: true }))
    render(<OIDCSettingsSection />)
    await screen.findByText('authSettings.oidc.title')
    await userEvent.click(screen.getAllByRole('checkbox')[0])
    await waitFor(() => expect(settingsApi.patch).toHaveBeenCalledWith({ oidc_enabled: true }))
  })

  it('persists a select change', async () => {
    settingsApi.get.mockResolvedValue(baseSettings())
    settingsApi.patch.mockResolvedValue(baseSettings({ oidc_signing_alg: 'ES256' }))
    render(<OIDCSettingsSection />)
    const select = await screen.findByLabelText('authSettings.oidc.signingAlg')
    await userEvent.selectOptions(select, 'ES256')
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({ oidc_signing_alg: 'ES256' })
    )
  })

  it('marks env-locked fields as locked and refuses to save them', async () => {
    settingsApi.get.mockResolvedValue(
      baseSettings({ oidc_client_id: 'from-env', oidc_client_id_env_locked: true })
    )
    render(<OIDCSettingsSection />)
    const input = await screen.findByLabelText(/authSettings.oidc.clientId/)
    expect(input).toBeDisabled()
    expect(screen.getAllByText('authSettings.oidc.envLocked').length).toBeGreaterThan(0)
  })

  it('rejects discovery when the issuer URL is empty', async () => {
    settingsApi.get.mockResolvedValue(baseSettings())
    render(<OIDCSettingsSection />)
    await screen.findByText('authSettings.oidc.title')
    // The button is disabled with no issuer, so drive the handler by typing one
    // in and clearing it is not possible; assert the disabled state instead.
    expect(screen.getByTitle('authSettings.oidc.autopopulateTitle')).toBeDisabled()
  })

  it('shows the needs-issuer error when the issuer is only whitespace', async () => {
    settingsApi.get.mockResolvedValue(baseSettings())
    render(<OIDCSettingsSection />)
    const issuer = await screen.findByLabelText('authSettings.oidc.issuerUrl')
    await userEvent.type(issuer, '   ')
    await userEvent.click(screen.getByTitle('authSettings.oidc.autopopulateTitle'))
    expect(await screen.findByText('authSettings.oidc.discoverNeedsIssuer')).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('autopopulates empty endpoints from the discovery document', async () => {
    settingsApi.get.mockResolvedValue(baseSettings({ oidc_token_endpoint: 'https://kept/token' }))
    api.post.mockResolvedValue({
      issuer: 'https://idp.example.com/',
      authorization_endpoint: 'https://idp/auth',
      token_endpoint: 'https://idp/token',
      userinfo_endpoint: 'https://idp/userinfo',
      jwks_uri: 'https://idp/jwks',
      end_session_endpoint: 'https://idp/logout',
    })
    settingsApi.patch.mockResolvedValue(baseSettings())
    render(<OIDCSettingsSection />)
    const issuer = await screen.findByLabelText('authSettings.oidc.issuerUrl')
    await userEvent.type(issuer, 'https://idp.example.com')
    await userEvent.click(screen.getByTitle('authSettings.oidc.autopopulateTitle'))

    // The autopopulate patch is the one carrying the discovered endpoints; a
    // blur-save of the issuer field may land first.
    await waitFor(() =>
      expect(settingsApi.patch.mock.calls.some(([p]) => 'oidc_jwks_uri' in p)).toBe(true)
    )
    const payload = settingsApi.patch.mock.calls.find(([p]) => 'oidc_jwks_uri' in p)[0]
    expect(payload.oidc_issuer_url).toBe('https://idp.example.com/')
    expect(payload.oidc_jwks_uri).toBe('https://idp/jwks')
    expect(payload.oidc_end_session_endpoint).toBe('https://idp/logout')
    // A field the admin already filled in is left alone.
    expect(payload.oidc_token_endpoint).toBeUndefined()
  })

  it('skips the patch when discovery yields no new values', async () => {
    settingsApi.get.mockResolvedValue(
      baseSettings({ oidc_issuer_url: 'https://idp/', oidc_issuer_url_env_locked: true })
    )
    api.post.mockResolvedValue({})
    render(<OIDCSettingsSection />)
    await screen.findByText('authSettings.oidc.title')
    await userEvent.click(screen.getByTitle('authSettings.oidc.autopopulateTitle'))
    await waitFor(() => expect(api.post).toHaveBeenCalled())
    expect(settingsApi.patch).not.toHaveBeenCalled()
  })

  it('shows a discovery error when the lookup fails', async () => {
    settingsApi.get.mockResolvedValue(baseSettings({ oidc_issuer_url: 'https://idp' }))
    api.post.mockRejectedValue(new Error('unreachable'))
    render(<OIDCSettingsSection />)
    await screen.findByText('authSettings.oidc.title')
    await userEvent.click(screen.getByTitle('authSettings.oidc.autopopulateTitle'))
    expect(await screen.findByText('unreachable')).toBeInTheDocument()
  })

  it('falls back to a translated discovery error', async () => {
    settingsApi.get.mockResolvedValue(baseSettings({ oidc_issuer_url: 'https://idp' }))
    api.post.mockRejectedValue({})
    render(<OIDCSettingsSection />)
    await screen.findByText('authSettings.oidc.title')
    await userEvent.click(screen.getByTitle('authSettings.oidc.autopopulateTitle'))
    expect(await screen.findByText('authSettings.oidc.discoverFailed')).toBeInTheDocument()
  })

  it('saves a new client secret and clears the draft', async () => {
    settingsApi.get.mockResolvedValue(baseSettings())
    settingsApi.patch.mockResolvedValue(
      baseSettings({ oidc_client_secret_set: true, oidc_client_secret_length: 6 })
    )
    render(<OIDCSettingsSection />)
    const secret = await screen.findByLabelText('authSettings.oidc.clientSecret')
    await userEvent.type(secret, 'hunter2')
    await userEvent.click(screen.getByText('common.save'))
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({ oidc_client_secret: 'hunter2' })
    )
    await waitFor(() => expect(secret.value).toBe(''))
  })

  it('does nothing when saving an empty client secret', async () => {
    settingsApi.get.mockResolvedValue(baseSettings())
    render(<OIDCSettingsSection />)
    await screen.findByText('authSettings.oidc.title')
    await userEvent.click(screen.getByText('common.save'))
    expect(settingsApi.patch).not.toHaveBeenCalled()
  })

  it('reports a client secret save failure', async () => {
    settingsApi.get.mockResolvedValue(baseSettings())
    settingsApi.patch.mockRejectedValue(new Error('secret boom'))
    render(<OIDCSettingsSection />)
    await userEvent.type(await screen.findByLabelText('authSettings.oidc.clientSecret'), 's')
    await userEvent.click(screen.getByText('common.save'))
    expect(await screen.findByText('secret boom')).toBeInTheDocument()
  })

  it('toggles client secret visibility', async () => {
    settingsApi.get.mockResolvedValue(baseSettings())
    render(<OIDCSettingsSection />)
    const secret = await screen.findByLabelText('authSettings.oidc.clientSecret')
    expect(secret.type).toBe('password')
    await userEvent.click(screen.getByTitle('authSettings.oidc.showSecret'))
    expect(secret.type).toBe('text')
    await userEvent.click(screen.getByTitle('authSettings.oidc.hideSecret'))
    expect(secret.type).toBe('password')
  })

  it('clears an existing client secret', async () => {
    settingsApi.get.mockResolvedValue(
      baseSettings({ oidc_client_secret_set: true, oidc_client_secret_length: 8 })
    )
    settingsApi.patch.mockResolvedValue(baseSettings({ oidc_client_secret_set: false }))
    render(<OIDCSettingsSection />)
    await userEvent.click(await screen.findByText('common.clear'))
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({ oidc_client_secret: '__CLEAR__' })
    )
  })

  it('reports a client secret clear failure', async () => {
    settingsApi.get.mockResolvedValue(
      baseSettings({ oidc_client_secret_set: true, oidc_client_secret_length: 8 })
    )
    settingsApi.patch.mockRejectedValue(new Error('clear boom'))
    render(<OIDCSettingsSection />)
    await userEvent.click(await screen.findByText('common.clear'))
    expect(await screen.findByText('clear boom')).toBeInTheDocument()
  })

  it('renders the masked secret read-only when it is env locked', async () => {
    settingsApi.get.mockResolvedValue(
      baseSettings({
        oidc_client_secret_set: true,
        oidc_client_secret_length: 5,
        oidc_client_secret_env_locked: true,
      })
    )
    render(<OIDCSettingsSection />)
    await screen.findByText('authSettings.oidc.title')
    expect(screen.queryByLabelText('authSettings.oidc.clientSecret')).not.toBeInTheDocument()
    expect(screen.getByText('•••••')).toBeInTheDocument()
  })
})
