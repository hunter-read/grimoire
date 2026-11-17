import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SettingsQuickActions from './SettingsQuickActions'

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

import api from '../../api'

function renderActions() {
  return render(
    <MemoryRouter>
      <SettingsQuickActions />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.get).mockResolvedValue({ running: false, phase: null })
  vi.mocked(api.post).mockResolvedValue({})
})

describe('SettingsQuickActions', () => {
  it('links to the file manager', () => {
    renderActions()
    expect(screen.getByRole('link', { name: 'File manager' })).toHaveAttribute(
      'href',
      '/settings/files'
    )
  })

  it('opens the rescan modal and posts a whole-library rescan on confirm', async () => {
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: 'Rescan' }))
    fireEvent.click(await screen.findByText('Start rescan'))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/rescan', { scope: null, metadata_mode: 'new' })
    })
  })

  it('shows the live scan phase and a stop control while a scan runs', async () => {
    vi.mocked(api.get).mockResolvedValue({
      running: true,
      phase: 'scanning',
      total_books: 4,
      scanned_books: 1,
    })
    renderActions()

    const rescan = await screen.findByRole('button', { name: /25%/ })
    expect(rescan).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/cancel-scan'))
    expect(await screen.findByRole('button', { name: 'Stopping…' })).toBeDisabled()
  })

  it('says why a rescan did not start and returns to idle', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('busy'))
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: 'Rescan' }))
    fireEvent.click(await screen.findByText('Start rescan'))

    expect(await screen.findByRole('alert')).toHaveTextContent('busy')
    expect(await screen.findByRole('button', { name: 'Rescan' })).not.toBeDisabled()
  })

  it('says why a scan did not stop and offers Stop again', async () => {
    vi.mocked(api.get).mockResolvedValue({ running: true, phase: 'scanning' })
    vi.mocked(api.post).mockRejectedValue(new Error('offline'))
    renderActions()
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
    expect(screen.getByRole('button', { name: 'Stop' })).not.toBeDisabled()
  })
})
