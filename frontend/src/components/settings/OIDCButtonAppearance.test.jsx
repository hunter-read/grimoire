import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OIDCButtonAppearance from './OIDCButtonAppearance'
import { settings as settingsApi } from '../../api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o?.field ? `${k}:${o.field}` : k) }),
}))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))
vi.mock('../../api', () => ({
  settings: {
    patch: vi.fn(),
    uploadOidcButtonIcon: vi.fn(),
    deleteOidcButtonIcon: vi.fn(),
  },
}))

const baseData = (over = {}) => ({
  oidc_button_bg_color: '',
  oidc_button_text_color: '',
  oidc_button_border_color: '',
  oidc_button_radius: '',
  oidc_button_icon_url: '',
  ...over,
})

const setup = (over = {}, label = 'Sign in with Google') => {
  const onSaved = vi.fn()
  const utils = render(
    <OIDCButtonAppearance data={baseData(over)} label={label} onSaved={onSaved} />
  )
  return { ...utils, onSaved }
}

const previewButton = () => screen.getByRole('button', { name: 'Sign in with Google' })

beforeEach(() => vi.clearAllMocks())

describe('OIDCButtonAppearance', () => {
  it('seeds the fields from the server and previews them', () => {
    setup({ oidc_button_bg_color: '#131314', oidc_button_radius: '20' })
    expect(screen.getByLabelText('authSettings.oidc.buttonBgColor').value).toBe('#131314')
    expect(screen.getByLabelText('authSettings.oidc.buttonRadius').value).toBe('20')
    expect(previewButton().style.background).toBe('rgb(19, 19, 20)')
    expect(previewButton().style.borderRadius).toBe('20px')
  })

  it('falls back to the default label in the preview', () => {
    setup({}, '')
    expect(screen.getByRole('button', { name: 'login.oidcDefault' })).toBeInTheDocument()
  })

  it('saves a valid color on blur and reports the saved settings', async () => {
    const updated = baseData({ oidc_button_bg_color: '#24292f' })
    settingsApi.patch.mockResolvedValue(updated)
    const { onSaved } = setup()
    const input = screen.getByLabelText('authSettings.oidc.buttonBgColor')
    await userEvent.type(input, '#24292f')
    expect(previewButton().style.background).toBe('rgb(36, 41, 47)') // live preview
    fireEvent.blur(input)
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated))
    expect(settingsApi.patch).toHaveBeenCalledWith({ oidc_button_bg_color: '#24292f' })
  })

  it('commits on Enter', async () => {
    settingsApi.patch.mockResolvedValue(baseData())
    setup()
    const input = screen.getByLabelText('authSettings.oidc.buttonRadius')
    input.focus()
    await userEvent.type(input, '6{Enter}')
    await waitFor(() => expect(settingsApi.patch).toHaveBeenCalledWith({ oidc_button_radius: '6' }))
  })

  it('does not save an unchanged field', () => {
    setup({ oidc_button_text_color: '#ffffff' })
    fireEvent.blur(screen.getByLabelText('authSettings.oidc.buttonTextColor'))
    expect(settingsApi.patch).not.toHaveBeenCalled()
  })

  it('rejects an invalid color or radius without calling the server', async () => {
    setup()
    const color = screen.getByLabelText('authSettings.oidc.buttonBorderColor')
    await userEvent.type(color, 'blue')
    fireEvent.blur(color)
    expect(screen.getByText('authSettings.oidc.buttonInvalidColor')).toBeInTheDocument()

    const radius = screen.getByLabelText('authSettings.oidc.buttonRadius')
    await userEvent.type(radius, '99')
    fireEvent.blur(radius)
    expect(screen.getByText('authSettings.oidc.buttonInvalidRadius')).toBeInTheDocument()
    expect(settingsApi.patch).not.toHaveBeenCalled()
  })

  it('clearing a color saves the empty value to reset it', async () => {
    settingsApi.patch.mockResolvedValue(baseData())
    setup({ oidc_button_bg_color: '#000000' })
    const input = screen.getByLabelText('authSettings.oidc.buttonBgColor')
    await userEvent.clear(input)
    fireEvent.blur(input)
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({ oidc_button_bg_color: '' })
    )
  })

  it('drives the color picker from the text value and saves picks on blur', async () => {
    settingsApi.patch.mockResolvedValue(baseData())
    setup({ oidc_button_bg_color: '#abc', oidc_button_text_color: '#5865f2cc' })
    const bgPicker = screen.getByLabelText(
      'authSettings.oidc.buttonColorPicker:authSettings.oidc.buttonBgColor'
    )
    const textPicker = screen.getByLabelText(
      'authSettings.oidc.buttonColorPicker:authSettings.oidc.buttonTextColor'
    )
    const borderPicker = screen.getByLabelText(
      'authSettings.oidc.buttonColorPicker:authSettings.oidc.buttonBorderColor'
    )
    expect(bgPicker.value).toBe('#aabbcc')
    expect(textPicker.value).toBe('#5865f2')
    expect(borderPicker.value).toBe('#000000')

    fireEvent.change(borderPicker, { target: { value: '#5865f2' } })
    expect(screen.getByLabelText('authSettings.oidc.buttonBorderColor').value).toBe('#5865f2')
    fireEvent.blur(borderPicker)
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({ oidc_button_border_color: '#5865f2' })
    )
  })

  it('shows the server error when a save fails', async () => {
    settingsApi.patch.mockRejectedValue(new Error('nope'))
    setup()
    const input = screen.getByLabelText('authSettings.oidc.buttonBgColor')
    await userEvent.type(input, '#fff')
    fireEvent.blur(input)
    expect(await screen.findByText('nope')).toBeInTheDocument()
  })

  it('falls back to a generic error message', async () => {
    settingsApi.patch.mockRejectedValue({})
    setup()
    const input = screen.getByLabelText('authSettings.oidc.buttonBgColor')
    await userEvent.type(input, '#fff')
    fireEvent.blur(input)
    expect(await screen.findByText('authSettings.oidc.saveFailed')).toBeInTheDocument()
  })

  it('uploads an icon', async () => {
    const updated = baseData({ oidc_button_icon_url: '/api/auth/openid/button-icon?v=1' })
    settingsApi.uploadOidcButtonIcon.mockResolvedValue(updated)
    const { onSaved } = setup()
    const file = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })
    await userEvent.click(screen.getByText('authSettings.oidc.buttonIconUpload'))
    await userEvent.upload(screen.getByTestId('oidc-button-icon-input'), file)
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated))
    expect(settingsApi.uploadOidcButtonIcon).toHaveBeenCalledWith(file)
  })

  it('ignores an empty file pick', () => {
    setup()
    fireEvent.change(screen.getByTestId('oidc-button-icon-input'), { target: { files: [] } })
    expect(settingsApi.uploadOidcButtonIcon).not.toHaveBeenCalled()
  })

  it('shows the current icon and removes it', async () => {
    settingsApi.deleteOidcButtonIcon.mockResolvedValue(baseData())
    const { container, onSaved } = setup({
      oidc_button_icon_url: '/api/auth/openid/button-icon?v=1',
    })
    expect(container.querySelector('img').getAttribute('src')).toBe(
      '/api/auth/openid/button-icon?v=1'
    )
    expect(screen.getByText('authSettings.oidc.buttonIconReplace')).toBeInTheDocument()
    await userEvent.click(screen.getByText('authSettings.oidc.buttonIconRemove'))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(baseData()))
    expect(settingsApi.deleteOidcButtonIcon).toHaveBeenCalled()
  })

  it('locks env-pinned fields', () => {
    setup({
      oidc_button_bg_color: '#000000',
      oidc_button_bg_color_env_locked: true,
      oidc_button_icon_url: '/icon?v=1',
      oidc_button_icon_env_locked: true,
    })
    // The lock tag sits inside the label, so match the label by prefix.
    const input = screen.getByLabelText(/^authSettings\.oidc\.buttonBgColor/, {
      selector: 'input[type=text]',
    })
    expect(input).toBeDisabled()
    expect(screen.getAllByText('authSettings.oidc.envLocked')).toHaveLength(2)
    expect(screen.getByText('authSettings.oidc.buttonIconReplace').closest('button')).toBeDisabled()
    expect(screen.queryByText('authSettings.oidc.buttonIconRemove')).toBeNull()
    fireEvent.blur(input)
    expect(settingsApi.patch).not.toHaveBeenCalled()
  })
})
