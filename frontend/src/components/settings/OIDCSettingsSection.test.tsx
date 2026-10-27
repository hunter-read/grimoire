import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OIDCSettingsSection from './OIDCSettingsSection'
import api, { settings as settingsApi } from '../../api'
import type { Schema } from '../../api'
import { SettingsDirtyContext } from './settingsDirty'

type Settings = Schema<'SettingsResponse'>

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))

vi.mock('../../api', () => ({
  default: { post: vi.fn() },
  settings: { get: vi.fn(), patch: vi.fn() },
}))

// Enabled by default: most of the form only shows once OIDC is turned on.
const baseSettings = (over: Partial<Settings> = {}) =>
  ({
    oidc_enabled: true,
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
  }) as Settings

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } })
})

describe('OIDCSettingsSection', () => {
  it('shows a spinner until the settings arrive', async () => {
    let resolve: (value: Settings) => void = () => {}
    vi.mocked(settingsApi.get).mockReturnValue(new Promise((r) => (resolve = r)))
    render(<OIDCSettingsSection />)
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
    resolve(baseSettings())
    expect(await screen.findByText('authSettings.oidc.title')).toBeInTheDocument()
  })

  it('renders the form seeded from the server values', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(
      baseSettings({ oidc_enabled: true, oidc_client_id: 'grimoire', oidc_match_by: 'email' })
    )
    render(<OIDCSettingsSection />)
    expect(await screen.findByText('authSettings.oidc.title')).toBeInTheDocument()
    await waitFor(() => {
      expect((screen.getByLabelText('authSettings.oidc.clientId') as HTMLInputElement).value).toBe(
        'grimoire'
      )
    })
    expect((screen.getByLabelText('authSettings.oidc.matchBy') as HTMLInputElement).value).toBe(
      'email'
    )
    // The enable checkbox mirrors oidc_enabled.
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true)
    expect(
      screen.getByText('https://grimoire.example.com/api/auth/openid/callback')
    ).toBeInTheDocument()
  })

  it('copies the redirect URI to the clipboard', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings())
    render(<OIDCSettingsSection />)
    await userEvent.click(await screen.findByTitle('authSettings.oidc.copy'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://grimoire.example.com/api/auth/openid/callback'
    )
  })

  it('saves a string field on blur when it changed', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings())
    vi.mocked(settingsApi.patch).mockResolvedValue(baseSettings({ oidc_client_id: 'app' }))
    render(<OIDCSettingsSection />)
    const input = await screen.findByLabelText('authSettings.oidc.clientId')
    await userEvent.type(input, 'app')
    await userEvent.tab()
    await waitFor(() => expect(settingsApi.patch).toHaveBeenCalledWith({ oidc_client_id: 'app' }))
  })

  // The "Saved" tick clears itself after a moment. Leaving the page before it
  // does must cancel that timer: a stray timer set state on a component (and,
  // in CI, a test environment) that was already gone.
  it('cancels the saved-tick timer when the page is left mid-tick', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings())
    vi.mocked(settingsApi.patch).mockResolvedValue(baseSettings({ oidc_client_id: 'app' }))
    const set = vi.spyOn(globalThis, 'setTimeout')
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    const { unmount } = render(<OIDCSettingsSection />)
    const input = await screen.findByLabelText('authSettings.oidc.clientId')
    await userEvent.type(input, 'app')
    await userEvent.tab()
    // The tick's timer is the 1.8s one the save schedules.
    await waitFor(() => expect(set.mock.calls.some(([, ms]) => ms === 1800)).toBe(true))
    const index = set.mock.calls.findIndex(([, ms]) => ms === 1800)
    const id = set.mock.results[index].value
    unmount()
    expect(clear).toHaveBeenCalledWith(id)
    set.mockRestore()
    clear.mockRestore()
  })

  it('does not save a string field when the value is unchanged', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings({ oidc_client_id: 'app' }))
    render(<OIDCSettingsSection />)
    const input = await screen.findByLabelText('authSettings.oidc.clientId')
    await userEvent.click(input)
    await userEvent.tab()
    expect(settingsApi.patch).not.toHaveBeenCalled()
  })

  it('blurs the field when Enter is pressed', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings())
    vi.mocked(settingsApi.patch).mockResolvedValue(
      baseSettings({ oidc_jwks_uri: 'https://idp/jwks' })
    )
    render(<OIDCSettingsSection />)
    const input = await screen.findByLabelText('authSettings.oidc.jwksUri')
    await userEvent.type(input, 'https://idp/jwks{Enter}')
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({ oidc_jwks_uri: 'https://idp/jwks' })
    )
  })

  it('surfaces an error when saving a field fails', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings())
    vi.mocked(settingsApi.patch).mockRejectedValue(new Error('nope'))
    render(<OIDCSettingsSection />)
    const input = await screen.findByLabelText('authSettings.oidc.clientId')
    await userEvent.type(input, 'x')
    await userEvent.tab()
    expect(await screen.findByText('nope')).toBeInTheDocument()
  })

  it('falls back to a translated message when the error has no message', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings())
    vi.mocked(settingsApi.patch).mockRejectedValue({})
    render(<OIDCSettingsSection />)
    const input = await screen.findByLabelText('authSettings.oidc.clientId')
    await userEvent.type(input, 'x')
    await userEvent.tab()
    expect(await screen.findByText('authSettings.oidc.saveFailed')).toBeInTheDocument()
  })

  it('toggles a boolean field and persists it', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings({ oidc_enabled: false }))
    vi.mocked(settingsApi.patch).mockResolvedValue(baseSettings({ oidc_enabled: true }))
    render(<OIDCSettingsSection />)
    await screen.findByText('authSettings.oidc.title')
    await userEvent.click(screen.getAllByRole('checkbox')[0])
    await waitFor(() => expect(settingsApi.patch).toHaveBeenCalledWith({ oidc_enabled: true }))
  })

  it('shows only the toggle and the redirect URI while OIDC is off', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings({ oidc_enabled: false }))
    vi.mocked(settingsApi.patch).mockResolvedValue(baseSettings({ oidc_enabled: true }))
    render(<OIDCSettingsSection />)
    await screen.findByText('authSettings.oidc.title')
    expect(screen.getByText('authSettings.oidc.description')).toBeInTheDocument()
    expect(
      screen.getByText('https://grimoire.example.com/api/auth/openid/callback')
    ).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.queryByLabelText('authSettings.oidc.issuerUrl')).toBeNull()
    expect(screen.queryByLabelText('authSettings.oidc.clientId')).toBeNull()
    expect(screen.queryByRole('heading', { level: 4 })).toBeNull()

    // Turning it on reveals the rest straight away, grouped under sub-headings.
    await userEvent.click(screen.getByLabelText('authSettings.oidc.enable'))
    expect(await screen.findByLabelText('authSettings.oidc.issuerUrl')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
      'authSettings.oidc.groups.provider',
      'authSettings.oidc.groups.client',
      'authSettings.oidc.groups.loginButton',
      'authSettings.oidc.groups.roles',
      'authSettings.oidc.groups.behaviour',
    ])
  })

  it('warns when OIDC is on but not configured enough to sign anyone in', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings({ oidc_configured: false }))
    render(<OIDCSettingsSection />)
    expect(await screen.findByText('authSettings.oidc.notConfigured')).toBeInTheDocument()
  })

  it('does not warn when configured, or when the server does not say', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings({ oidc_configured: true }))
    const { unmount } = render(<OIDCSettingsSection />)
    await screen.findByLabelText('authSettings.oidc.clientId')
    expect(screen.queryByText('authSettings.oidc.notConfigured')).toBeNull()
    unmount()

    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings())
    render(<OIDCSettingsSection />)
    await screen.findByLabelText('authSettings.oidc.clientId')
    expect(screen.queryByText('authSettings.oidc.notConfigured')).toBeNull()
  })

  it('does not warn about configuration while OIDC is off', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(
      baseSettings({ oidc_enabled: false, oidc_configured: false })
    )
    render(<OIDCSettingsSection />)
    await screen.findByText('authSettings.oidc.title')
    expect(screen.queryByText('authSettings.oidc.notConfigured')).toBeNull()
  })

  it('announces a saved field and the copied redirect URI', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings())
    vi.mocked(settingsApi.patch).mockResolvedValue(baseSettings({ oidc_client_id: 'app' }))
    render(<OIDCSettingsSection />)
    const input = await screen.findByLabelText('authSettings.oidc.clientId')
    await userEvent.type(input, 'app')
    await userEvent.tab()
    await waitFor(() =>
      expect(screen.getAllByRole('status').some((s) => s.textContent === 'common.saved')).toBe(true)
    )
    await userEvent.click(screen.getByRole('button', { name: 'authSettings.oidc.copy' }))
    await waitFor(() =>
      expect(
        screen.getAllByRole('status').some((s) => s.textContent === 'authSettings.oidc.copied')
      ).toBe(true)
    )
  })

  it('reports typed-but-unsaved fields and an unsaved secret', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings())
    vi.mocked(settingsApi.patch).mockResolvedValue(baseSettings({ oidc_client_id: 'app' }))
    const set = vi.fn()
    const dirty = () => set.mock.calls.filter(([id]) => id === 'oidc').at(-1)?.[1]
    const { unmount } = render(
      <SettingsDirtyContext.Provider value={{ set }}>
        <OIDCSettingsSection />
      </SettingsDirtyContext.Provider>
    )
    const input = await screen.findByLabelText('authSettings.oidc.clientId')
    expect(dirty()).toBe(false)
    await userEvent.type(input, 'app')
    expect(dirty()).toBe(true)
    await userEvent.tab()
    await waitFor(() => expect(dirty()).toBe(false))

    await userEvent.type(screen.getByLabelText('authSettings.oidc.clientSecret'), 's3cret')
    expect(dirty()).toBe(true)
    await userEvent.clear(screen.getByLabelText('authSettings.oidc.clientSecret'))
    expect(dirty()).toBe(false)

    // Leaving with an edit pending clears what this section reported.
    await userEvent.type(screen.getByLabelText('authSettings.oidc.jwksUri'), 'x')
    expect(dirty()).toBe(true)
    unmount()
    expect(dirty()).toBe(false)
  })

  it('persists a select change', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings())
    vi.mocked(settingsApi.patch).mockResolvedValue(baseSettings({ oidc_signing_alg: 'ES256' }))
    render(<OIDCSettingsSection />)
    const select = (await screen.findByLabelText(
      'authSettings.oidc.signingAlg'
    )) as HTMLSelectElement
    await userEvent.selectOptions(select, 'ES256')
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({ oidc_signing_alg: 'ES256' })
    )
  })

  it('offers only algorithms that can verify against the provider keys', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings())
    render(<OIDCSettingsSection />)
    const select = (await screen.findByLabelText(
      'authSettings.oidc.signingAlg'
    )) as HTMLSelectElement
    const options = [...select.options].map((o) => o.value)
    expect(options).toContain('RS256')
    expect(options).not.toContain('HS256')
    expect(screen.queryByText('authSettings.oidc.signingAlgUnsupportedHint')).toBeNull()
  })

  it('shows a stored HS256 as unsupported until another is chosen', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings({ oidc_signing_alg: 'HS256' }))
    vi.mocked(settingsApi.patch).mockResolvedValue(baseSettings({ oidc_signing_alg: 'RS256' }))
    render(<OIDCSettingsSection />)
    expect(
      await screen.findByText('authSettings.oidc.signingAlgUnsupportedHint')
    ).toBeInTheDocument()
    const select = screen.getByLabelText('authSettings.oidc.signingAlg') as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('HS256'))
    const stale = [...select.options].find((o) => o.value === 'HS256')
    expect(stale!.disabled).toBe(true)
    await userEvent.selectOptions(select, 'RS256')
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({ oidc_signing_alg: 'RS256' })
    )
    await waitFor(() =>
      expect(screen.queryByText('authSettings.oidc.signingAlgUnsupportedHint')).toBeNull()
    )
  })

  it('shows the role group names and saves a renamed one', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(
      baseSettings({ oidc_admin_group: 'admin', oidc_gm_group: 'gm', oidc_player_group: 'player' })
    )
    vi.mocked(settingsApi.patch).mockResolvedValue(
      baseSettings({ oidc_admin_group: 'grimoire-admin' })
    )
    render(<OIDCSettingsSection />)
    const admin = (await screen.findByLabelText('authSettings.oidc.adminGroup')) as HTMLInputElement
    await waitFor(() => expect(admin.value).toBe('admin'))
    expect((screen.getByLabelText('authSettings.oidc.gmGroup') as HTMLInputElement).value).toBe(
      'gm'
    )
    expect((screen.getByLabelText('authSettings.oidc.playerGroup') as HTMLInputElement).value).toBe(
      'player'
    )
    expect(screen.getByText('authSettings.oidc.roleGroupsHint')).toBeInTheDocument()
    await userEvent.clear(admin)
    await userEvent.type(admin, 'grimoire-admin')
    await userEvent.tab()
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({ oidc_admin_group: 'grimoire-admin' })
    )
  })

  it('marks env-locked fields as locked and refuses to save them', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(
      baseSettings({ oidc_client_id: 'from-env', oidc_client_id_env_locked: true })
    )
    render(<OIDCSettingsSection />)
    const input = await screen.findByLabelText(/authSettings.oidc.clientId/)
    expect(input).toBeDisabled()
    expect(screen.getAllByText('authSettings.oidc.envLocked').length).toBeGreaterThan(0)
  })

  it('rejects discovery when the issuer URL is empty', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings())
    render(<OIDCSettingsSection />)
    await screen.findByText('authSettings.oidc.title')
    // The button is disabled with no issuer, so drive the handler by typing one
    // in and clearing it is not possible; assert the disabled state instead.
    expect(screen.getByTitle('authSettings.oidc.autopopulateTitle')).toBeDisabled()
  })

  it('shows the needs-issuer error when the issuer is only whitespace', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings())
    render(<OIDCSettingsSection />)
    const issuer = await screen.findByLabelText('authSettings.oidc.issuerUrl')
    await userEvent.type(issuer, '   ')
    await userEvent.click(screen.getByTitle('authSettings.oidc.autopopulateTitle'))
    expect(await screen.findByText('authSettings.oidc.discoverNeedsIssuer')).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('autopopulates empty endpoints from the discovery document', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(
      baseSettings({ oidc_token_endpoint: 'https://kept/token' })
    )
    vi.mocked(api.post).mockResolvedValue({
      issuer: 'https://idp.example.com/',
      authorization_endpoint: 'https://idp/auth',
      token_endpoint: 'https://idp/token',
      userinfo_endpoint: 'https://idp/userinfo',
      jwks_uri: 'https://idp/jwks',
      end_session_endpoint: 'https://idp/logout',
    })
    vi.mocked(settingsApi.patch).mockResolvedValue(baseSettings())
    render(<OIDCSettingsSection />)
    const issuer = await screen.findByLabelText('authSettings.oidc.issuerUrl')
    await userEvent.type(issuer, 'https://idp.example.com')
    await userEvent.click(screen.getByTitle('authSettings.oidc.autopopulateTitle'))

    // The autopopulate patch is the one carrying the discovered endpoints; a
    // blur-save of the issuer field may land first.
    await waitFor(() =>
      expect(vi.mocked(settingsApi.patch).mock.calls.some(([p]) => 'oidc_jwks_uri' in p)).toBe(true)
    )
    const payload = vi.mocked(settingsApi.patch).mock.calls.find(([p]) => 'oidc_jwks_uri' in p)![0]
    expect(payload.oidc_issuer_url).toBe('https://idp.example.com/')
    expect(payload.oidc_jwks_uri).toBe('https://idp/jwks')
    expect(payload.oidc_end_session_endpoint).toBe('https://idp/logout')
    // A field the admin already filled in is left alone.
    expect(payload.oidc_token_endpoint).toBeUndefined()
  })

  it('skips the patch when discovery yields no new values', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(
      baseSettings({ oidc_issuer_url: 'https://idp/', oidc_issuer_url_env_locked: true })
    )
    vi.mocked(api.post).mockResolvedValue({})
    render(<OIDCSettingsSection />)
    await screen.findByText('authSettings.oidc.title')
    await userEvent.click(screen.getByTitle('authSettings.oidc.autopopulateTitle'))
    await waitFor(() => expect(api.post).toHaveBeenCalled())
    expect(settingsApi.patch).not.toHaveBeenCalled()
  })

  it('shows a discovery error when the lookup fails', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings({ oidc_issuer_url: 'https://idp' }))
    vi.mocked(api.post).mockRejectedValue(new Error('unreachable'))
    render(<OIDCSettingsSection />)
    await screen.findByText('authSettings.oidc.title')
    await userEvent.click(screen.getByTitle('authSettings.oidc.autopopulateTitle'))
    expect(await screen.findByText('unreachable')).toBeInTheDocument()
  })

  it('falls back to a translated discovery error', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings({ oidc_issuer_url: 'https://idp' }))
    vi.mocked(api.post).mockRejectedValue({})
    render(<OIDCSettingsSection />)
    await screen.findByText('authSettings.oidc.title')
    await userEvent.click(screen.getByTitle('authSettings.oidc.autopopulateTitle'))
    expect(await screen.findByText('authSettings.oidc.discoverFailed')).toBeInTheDocument()
  })

  it('saves a new client secret and clears the draft', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings())
    vi.mocked(settingsApi.patch).mockResolvedValue(
      baseSettings({ oidc_client_secret_set: true, oidc_client_secret_length: 6 })
    )
    render(<OIDCSettingsSection />)
    const secret = (await screen.findByLabelText(
      'authSettings.oidc.clientSecret'
    )) as HTMLInputElement
    await userEvent.type(secret, 'hunter2')
    await userEvent.click(screen.getByText('common.save'))
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({ oidc_client_secret: 'hunter2' })
    )
    await waitFor(() => expect(secret.value).toBe(''))
  })

  it('does nothing when saving an empty client secret', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings())
    render(<OIDCSettingsSection />)
    await screen.findByText('authSettings.oidc.title')
    await userEvent.click(screen.getByText('common.save'))
    expect(settingsApi.patch).not.toHaveBeenCalled()
  })

  it('reports a client secret save failure', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings())
    vi.mocked(settingsApi.patch).mockRejectedValue(new Error('secret boom'))
    render(<OIDCSettingsSection />)
    await userEvent.type(await screen.findByLabelText('authSettings.oidc.clientSecret'), 's')
    await userEvent.click(screen.getByText('common.save'))
    expect(await screen.findByText('secret boom')).toBeInTheDocument()
  })

  it('toggles client secret visibility', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(baseSettings())
    render(<OIDCSettingsSection />)
    const secret = (await screen.findByLabelText(
      'authSettings.oidc.clientSecret'
    )) as HTMLInputElement
    expect(secret.type).toBe('password')
    await userEvent.click(screen.getByTitle('authSettings.oidc.showSecret'))
    expect(secret.type).toBe('text')
    await userEvent.click(screen.getByTitle('authSettings.oidc.hideSecret'))
    expect(secret.type).toBe('password')
  })

  it('clears an existing client secret', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(
      baseSettings({ oidc_client_secret_set: true, oidc_client_secret_length: 8 })
    )
    vi.mocked(settingsApi.patch).mockResolvedValue(baseSettings({ oidc_client_secret_set: false }))
    render(<OIDCSettingsSection />)
    await userEvent.click(await screen.findByText('common.clear'))
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({ oidc_client_secret: '__CLEAR__' })
    )
  })

  it('reports a client secret clear failure', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(
      baseSettings({ oidc_client_secret_set: true, oidc_client_secret_length: 8 })
    )
    vi.mocked(settingsApi.patch).mockRejectedValue(new Error('clear boom'))
    render(<OIDCSettingsSection />)
    await userEvent.click(await screen.findByText('common.clear'))
    expect(await screen.findByText('clear boom')).toBeInTheDocument()
  })

  it('renders the masked secret read-only when it is env locked', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue(
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
