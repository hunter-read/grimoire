import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MaintenanceTab from './MaintenanceTab'

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
  settings: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}))

import api, { settings as settingsApi } from '../../api'

const idleStatus = {
  running: false,
  phase: null,
  total_books: 0,
  scanned_books: 0,
  total_maps: 0,
  scanned_maps: 0,
  total_tokens: 0,
  scanned_tokens: 0,
  indexed: 0,
  to_index: 0,
  new_books: 0,
  new_maps: 0,
  new_tokens: 0,
}

const scanningStatus = {
  ...idleStatus,
  running: true,
  phase: 'scanning',
  total_books: 10,
  scanned_books: 3,
}

const indexingStatus = {
  ...idleStatus,
  running: true,
  phase: 'indexing',
  to_index: 20,
  indexed: 5,
}

beforeEach(() => {
  vi.resetAllMocks()
  api.get.mockResolvedValue(idleStatus)
  api.post.mockResolvedValue({})
  settingsApi.get.mockResolvedValue({
    rescan_schedule_enabled: false,
    rescan_schedule_interval: 'daily',
    rescan_schedule_hour: 2,
    rescan_schedule_minute: 0,
    rescan_schedule_weekday: 0,
  })
})

describe('MaintenanceTab — RescanSection', () => {
  it('renders the Rescan Library button when idle', () => {
    render(<MaintenanceTab />)
    expect(screen.getByRole('button', { name: /rescan library/i })).toBeInTheDocument()
  })

  it('does not show Stop button when scan is not running', () => {
    render(<MaintenanceTab />)
    expect(screen.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument()
  })

  it('shows Stop button while a scan is running', async () => {
    api.get.mockResolvedValue(scanningStatus)
    render(<MaintenanceTab />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument()
    })
  })

  it('calls /cancel-scan when Stop is clicked', async () => {
    api.get.mockResolvedValue(scanningStatus)
    render(<MaintenanceTab />)
    const stopBtn = await screen.findByRole('button', { name: /stop/i })
    fireEvent.click(stopBtn)
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/cancel-scan')
    })
  })

  it('shows "Stopping…" after Stop is clicked', async () => {
    api.get.mockResolvedValue(scanningStatus)
    api.post.mockImplementation(() => new Promise(() => {})) // never resolves
    render(<MaintenanceTab />)
    const stopBtn = await screen.findByRole('button', { name: /stop/i })
    fireEvent.click(stopBtn)
    await waitFor(() => {
      expect(screen.getByText('Stopping…')).toBeInTheDocument()
    })
  })

  it('shows scanning phase label while scanning', async () => {
    api.get.mockResolvedValue(scanningStatus)
    render(<MaintenanceTab />)
    await waitFor(() => {
      expect(screen.getByText(/scanning/i)).toBeInTheDocument()
    })
  })

  it('shows indexing phase label while indexing', async () => {
    api.get.mockResolvedValue(indexingStatus)
    render(<MaintenanceTab />)
    await waitFor(() => {
      expect(screen.getByText(/indexing pdfs/i)).toBeInTheDocument()
    })
  })

  it('calls /rescan when Rescan Library is clicked', async () => {
    render(<MaintenanceTab />)
    fireEvent.click(screen.getByRole('button', { name: /rescan library/i }))
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/rescan')
    })
  })
})
