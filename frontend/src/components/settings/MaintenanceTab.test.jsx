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
  sidecars: {
    get: vi.fn(),
    save: vi.fn(),
    export: vi.fn(),
  },
  backups: {
    list: vi.fn(() => Promise.resolve({ backups: [], directory: '/data/backups', total_bytes: 0 })),
    create: vi.fn(),
    remove: vi.fn(),
    download: vi.fn(),
    getSettings: vi.fn(() =>
      Promise.resolve({
        backup_schedule: 'off',
        backup_schedule_hour: 3,
        backup_schedule_minute: 0,
        backup_schedule_weekday: 0,
        backup_retention_count: 0,
        backup_retention_gb: 0,
        backup_dir: '/data/backups',
        schedule_env_locked: false,
        retention_count_env_locked: false,
        retention_gb_env_locked: false,
        dir_env_locked: false,
      })
    ),
    saveSettings: vi.fn(),
  },
}))

import api, { settings as settingsApi, sidecars as sidecarsApi } from '../../api'

const idleStatus = {
  running: false,
  phase: null,
  total_books: 0,
  scanned_books: 0,
  total_maps: 0,
  scanned_maps: 0,
  total_tokens: 0,
  scanned_tokens: 0,
  total_audio: 0,
  scanned_audio: 0,
  indexed: 0,
  to_index: 0,
  new_books: 0,
  new_maps: 0,
  new_tokens: 0,
  new_audio: 0,
}

const scanningStatus = {
  ...idleStatus,
  running: true,
  phase: 'scanning',
  total_books: 10,
  scanned_books: 3,
  total_audio: 8,
  scanned_audio: 2,
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
  // Sidecar export is off by default; the section only needs to mount quietly
  // here, it has its own test file.
  sidecarsApi.get.mockResolvedValue({ formats: [], covers: false, overwrite_foreign: false })
  settingsApi.get.mockResolvedValue({
    rescan_schedule_enabled: false,
    rescan_schedule_interval: 'daily',
    rescan_schedule_hour: 2,
    rescan_schedule_minute: 0,
    rescan_schedule_weekday: 0,
    cleanup_on_rescan: false,
  })
  settingsApi.patch.mockResolvedValue({
    rescan_schedule_enabled: false,
    rescan_schedule_interval: 'daily',
    rescan_schedule_hour: 2,
    rescan_schedule_minute: 0,
    rescan_schedule_weekday: 0,
    cleanup_on_rescan: false,
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

  it('shows audio progress in the per-category breakdown while scanning', async () => {
    api.get.mockResolvedValue(scanningStatus)
    render(<MaintenanceTab />)
    await waitFor(() => {
      expect(screen.getByText('2/8 audio')).toBeInTheDocument()
    })
  })

  it('shows the new-audio count in the completion summary', async () => {
    api.get.mockResolvedValue({ ...idleStatus, new_audio: 3 })
    render(<MaintenanceTab />)
    await waitFor(() => {
      expect(screen.getByText('+3 audio tracks')).toBeInTheDocument()
    })
  })

  it('shows indexing phase label while indexing', async () => {
    api.get.mockResolvedValue(indexingStatus)
    render(<MaintenanceTab />)
    await waitFor(() => {
      expect(screen.getByText(/indexing pdfs/i)).toBeInTheDocument()
    })
  })

  it('opens the rescan modal and posts the selected mode/scope on confirm', async () => {
    render(<MaintenanceTab />)
    fireEvent.click(screen.getByRole('button', { name: /rescan library/i }))
    // Modal opens; confirm with the default "Find new files" mode.
    const confirm = await screen.findByText('Start rescan')
    fireEvent.click(confirm)
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/rescan', { scope: null, metadata_mode: 'new' })
    })
  })

  it('shows the updated-metadata count in the completion summary', async () => {
    api.get.mockResolvedValue({ ...idleStatus, updated_books: 4 })
    render(<MaintenanceTab />)
    await waitFor(() => {
      expect(screen.getByText('4 updated')).toBeInTheDocument()
    })
  })
})

describe('MaintenanceTab — ScheduledRescanSection', () => {
  it('does not show the cleanup checkbox when schedule is Off', async () => {
    settingsApi.get.mockResolvedValue({
      rescan_schedule_enabled: false,
      rescan_schedule_interval: 'daily',
      rescan_schedule_hour: 2,
      rescan_schedule_minute: 0,
      rescan_schedule_weekday: 0,
      cleanup_on_rescan: false,
    })
    render(<MaintenanceTab />)
    await waitFor(() => expect(settingsApi.get).toHaveBeenCalled())
    expect(screen.queryByLabelText(/also run database cleanup/i)).not.toBeInTheDocument()
  })

  it('shows the cleanup checkbox when a schedule is active', async () => {
    settingsApi.get.mockResolvedValue({
      rescan_schedule_enabled: true,
      rescan_schedule_interval: 'daily',
      rescan_schedule_hour: 2,
      rescan_schedule_minute: 0,
      rescan_schedule_weekday: 0,
      cleanup_on_rescan: false,
    })
    render(<MaintenanceTab />)
    await waitFor(() => expect(screen.getByText(/also run database cleanup/i)).toBeInTheDocument())
  })

  it('loads cleanup_on_rescan=true from settings as checked', async () => {
    settingsApi.get.mockResolvedValue({
      rescan_schedule_enabled: true,
      rescan_schedule_interval: 'daily',
      rescan_schedule_hour: 2,
      rescan_schedule_minute: 0,
      rescan_schedule_weekday: 0,
      cleanup_on_rescan: true,
    })
    render(<MaintenanceTab />)
    await waitFor(() => {
      const cb = screen.getByRole('checkbox', { name: /also run database cleanup/i })
      expect(cb).toBeChecked()
    })
  })

  it('includes cleanup_on_rescan=true in patch when checkbox is checked and saved', async () => {
    settingsApi.get.mockResolvedValue({
      rescan_schedule_enabled: true,
      rescan_schedule_interval: 'daily',
      rescan_schedule_hour: 2,
      rescan_schedule_minute: 0,
      rescan_schedule_weekday: 0,
      cleanup_on_rescan: false,
    })
    settingsApi.patch.mockResolvedValue({
      rescan_schedule_enabled: true,
      rescan_schedule_interval: 'daily',
      rescan_schedule_hour: 2,
      rescan_schedule_minute: 0,
      rescan_schedule_weekday: 0,
      cleanup_on_rescan: true,
    })
    render(<MaintenanceTab />)
    const cb = await screen.findByRole('checkbox', { name: /also run database cleanup/i })
    fireEvent.click(cb)
    fireEvent.click(screen.getByRole('button', { name: /save schedule/i }))
    await waitFor(() => {
      expect(settingsApi.patch).toHaveBeenCalledWith(
        expect.objectContaining({ cleanup_on_rescan: true })
      )
    })
  })

  it('includes cleanup_on_rescan=false in patch when checkbox is unchecked and saved', async () => {
    settingsApi.get.mockResolvedValue({
      rescan_schedule_enabled: true,
      rescan_schedule_interval: 'daily',
      rescan_schedule_hour: 2,
      rescan_schedule_minute: 0,
      rescan_schedule_weekday: 0,
      cleanup_on_rescan: true,
    })
    settingsApi.patch.mockResolvedValue({
      rescan_schedule_enabled: true,
      rescan_schedule_interval: 'daily',
      rescan_schedule_hour: 2,
      rescan_schedule_minute: 0,
      rescan_schedule_weekday: 0,
      cleanup_on_rescan: false,
    })
    render(<MaintenanceTab />)
    const cb = await screen.findByRole('checkbox', { name: /also run database cleanup/i })
    fireEvent.click(cb) // uncheck
    fireEvent.click(screen.getByRole('button', { name: /save schedule/i }))
    await waitFor(() => {
      expect(settingsApi.patch).toHaveBeenCalledWith(
        expect.objectContaining({ cleanup_on_rescan: false })
      )
    })
  })
})
