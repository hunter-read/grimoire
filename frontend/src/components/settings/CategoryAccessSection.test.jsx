import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CategoryAccessSection from './CategoryAccessSection'
import { settings as settingsApi } from '../../api'

vi.mock('../../api', () => ({
  settings: { get: vi.fn(), patch: vi.fn() },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) => (opts?.category ? `${k}:${opts.category}` : k),
  }),
}))

// The accessible name, which disambiguates these selects from the identically
// labelled stat toggles elsewhere on the settings page.
const label = (category) => `appSettings.categoryAccess.selectLabel:${category}`

beforeEach(() => {
  vi.clearAllMocks()
  settingsApi.get.mockResolvedValue({ restricted_categories: {} })
  settingsApi.patch.mockResolvedValue({})
})

describe('CategoryAccessSection', () => {
  it('never offers the categories that cannot be restricted', async () => {
    render(<CategoryAccessSection />)
    await screen.findByLabelText(label('Adventures & Modules'))
    // Everyone at the table needs these two by definition.
    expect(screen.queryByLabelText(label('Core Rulebooks'))).toBeNull()
    expect(screen.queryByLabelText(/Character Sheet/i)).toBeNull()
  })

  it('reflects a stored restriction', async () => {
    settingsApi.get.mockResolvedValue({ restricted_categories: { adventure: 'gm' } })
    render(<CategoryAccessSection />)
    expect(await screen.findByLabelText(label('Adventures & Modules'))).toHaveValue('gm')
  })

  it('saves a new restriction', async () => {
    render(<CategoryAccessSection />)
    const select = await screen.findByLabelText(label('Adventures & Modules'))
    fireEvent.change(select, { target: { value: 'admin' } })
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({
        restricted_categories: { adventure: 'admin' },
      })
    )
  })

  it('removes the key entirely when set back to open', async () => {
    settingsApi.get.mockResolvedValue({ restricted_categories: { adventure: 'gm' } })
    render(<CategoryAccessSection />)
    const select = await screen.findByLabelText(label('Adventures & Modules'))
    fireEvent.change(select, { target: { value: '' } })
    // "Open" is the absence of an entry, not a stored value.
    await waitFor(() =>
      expect(settingsApi.patch).toHaveBeenCalledWith({ restricted_categories: {} })
    )
  })

  it('reverts the control when the server rejects the change', async () => {
    settingsApi.patch.mockRejectedValue(new Error('nope'))
    render(<CategoryAccessSection />)
    const select = await screen.findByLabelText(label('Adventures & Modules'))
    fireEvent.change(select, { target: { value: 'gm' } })
    // Leaving the UI showing a change that did not persist would be a lie about
    // who can see the category.
    await waitFor(() => expect(select).toHaveValue(''))
    expect(await screen.findByText('nope')).toBeInTheDocument()
  })

  it('survives a settings fetch failure', async () => {
    settingsApi.get.mockRejectedValue(new Error('down'))
    render(<CategoryAccessSection />)
    expect(await screen.findByLabelText(label('Adventures & Modules'))).toHaveValue('')
  })
})
