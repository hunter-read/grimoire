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
  api.get.mockResolvedValue({ running: false, phase: null })
  api.post.mockResolvedValue({})
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
    api.get.mockResolvedValue({
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

  it('swallows a failed rescan request and returns to idle', async () => {
    api.post.mockRejectedValue(new Error('busy'))
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: 'Rescan' }))
    fireEvent.click(await screen.findByText('Start rescan'))

    await waitFor(() => expect(api.post).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: 'Rescan' })).not.toBeDisabled()
  })
})
