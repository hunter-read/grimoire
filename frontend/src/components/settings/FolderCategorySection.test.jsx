import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FolderCategorySection from './FolderCategorySection'
import { settings as settingsApi } from '../../api'

vi.mock('../../api', () => ({
  settings: { get: vi.fn(), patch: vi.fn() },
}))

function mockSettings(overrides = {}) {
  settingsApi.get.mockResolvedValue({
    disable_folder_category_inference: false,
    disable_folder_category_inference_env_locked: false,
    ...overrides,
  })
  settingsApi.patch.mockResolvedValue({})
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('FolderCategorySection', () => {
  it('loads the current setting and renders unchecked when inference is on', async () => {
    mockSettings()
    render(<FolderCategorySection />)
    const checkbox = await screen.findByLabelText('Disable folder-name category inference')
    expect(checkbox).not.toBeChecked()
    expect(checkbox).not.toBeDisabled()
  })

  it('reflects a persisted disabled=true value as checked', async () => {
    mockSettings({ disable_folder_category_inference: true })
    render(<FolderCategorySection />)
    const checkbox = await screen.findByLabelText('Disable folder-name category inference')
    expect(checkbox).toBeChecked()
  })

  it('toggles the setting and persists the new value', async () => {
    mockSettings()
    render(<FolderCategorySection />)
    const checkbox = await screen.findByLabelText('Disable folder-name category inference')
    fireEvent.click(checkbox)
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({
        disable_folder_category_inference: true,
      })
    )
  })

  it('disables the toggle and shows a notice when env-locked', async () => {
    mockSettings({
      disable_folder_category_inference: true,
      disable_folder_category_inference_env_locked: true,
    })
    render(<FolderCategorySection />)
    const checkbox = await screen.findByLabelText('Disable folder-name category inference')
    expect(checkbox).toBeDisabled()
    expect(screen.getByText(/DISABLE_FOLDER_CATEGORY_INFERENCE/)).toBeInTheDocument()
  })

  it('falls back to defaults when the settings request fails', async () => {
    settingsApi.get.mockRejectedValue(new Error('boom'))
    render(<FolderCategorySection />)
    const checkbox = await screen.findByLabelText('Disable folder-name category inference')
    expect(checkbox).not.toBeChecked()
    expect(checkbox).not.toBeDisabled()
  })
})
