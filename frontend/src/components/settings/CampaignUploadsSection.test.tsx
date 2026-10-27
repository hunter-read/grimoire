import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CampaignUploadsSection from './CampaignUploadsSection'
import { settings as settingsApi } from '../../api'
import type { Schema } from '../../api'

type Settings = Schema<'SettingsResponse'>

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('../Spinner', () => ({ default: () => <span data-testid="spinner" /> }))
vi.mock('../../api', () => ({
  settings: { get: vi.fn(), patch: vi.fn() },
}))

const disableBox = () => screen.getByLabelText('appSettings.campaignUploads.disable')
const perFile = () => screen.getByLabelText<HTMLInputElement>('appSettings.campaignUploads.perFile')
const perCampaign = () =>
  screen.getByLabelText<HTMLInputElement>('appSettings.campaignUploads.perCampaign')

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(settingsApi.patch).mockResolvedValue({} as Settings)
})

describe('CampaignUploadsSection', () => {
  it('shows a spinner until the settings load', () => {
    vi.mocked(settingsApi.get).mockReturnValue(new Promise(() => {}))
    render(<CampaignUploadsSection />)
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('reflects the loaded settings', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({
      campaign_uploads_disabled: true,
      campaign_upload_max_file_mb: 25,
      campaign_upload_max_total_mb: 500,
    } as unknown as Settings)
    render(<CampaignUploadsSection />)
    expect(await screen.findByRole('checkbox')).toBeChecked()
    expect(perFile().value).toBe('25')
    expect(perCampaign().value).toBe('500')
  })

  it('falls back to uploads on with no limits when loading fails', async () => {
    vi.mocked(settingsApi.get).mockRejectedValue(new Error('offline'))
    render(<CampaignUploadsSection />)
    expect(await screen.findByRole('checkbox')).not.toBeChecked()
    expect(perFile().value).toBe('0')
    expect(perCampaign().value).toBe('0')
  })

  it('saves the switch at once and tells the rest of the app', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({} as Settings)
    const changed = vi.fn()
    window.addEventListener('grimoire:settings-changed', changed)
    render(<CampaignUploadsSection />)
    fireEvent.click(await screen.findByRole('checkbox'))

    expect(disableBox()).toBeChecked()
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({ campaign_uploads_disabled: true })
    )
    await waitFor(() => expect(changed).toHaveBeenCalled())
    window.removeEventListener('grimoire:settings-changed', changed)
  })

  it('saves a limit when the field loses focus, not on every keystroke', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({} as Settings)
    render(<CampaignUploadsSection />)
    await screen.findByRole('checkbox')

    fireEvent.change(perFile(), { target: { value: '40' } })
    expect(perFile().value).toBe('40')
    expect(settingsApi.patch).not.toHaveBeenCalled()

    fireEvent.blur(perFile())
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({ campaign_upload_max_file_mb: 40 })
    )
  })

  it('saves a cleared limit as no limit', async () => {
    vi.mocked(settingsApi.get).mockResolvedValue({
      campaign_upload_max_total_mb: 200,
    } as unknown as Settings)
    render(<CampaignUploadsSection />)
    await screen.findByRole('checkbox')

    fireEvent.change(perCampaign(), { target: { value: '' } })
    fireEvent.blur(perCampaign())
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({ campaign_upload_max_total_mb: 0 })
    )
    expect(perCampaign().value).toBe('0')
  })
})
