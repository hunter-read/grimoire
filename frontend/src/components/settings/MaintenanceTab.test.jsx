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
  mediaUrl: vi.fn((path, params = {}) => {
    const qs = new URLSearchParams({ ...params, token: 'test-token' }).toString()
    return `/api${path}?${qs}`
  }),
}))

import api, { settings as settingsApi, mediaUrl } from '../../api'

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

describe('MaintenanceTab — ExportTagsSection', () => {
  let appendedAnchors
  let origAppendChild
  let origRemoveChild

  beforeEach(() => {
    appendedAnchors = []
    origAppendChild = document.body.appendChild.bind(document.body)
    origRemoveChild = document.body.removeChild.bind(document.body)

    vi.spyOn(document.body, 'appendChild').mockImplementation((el) => {
      if (el && el.tagName === 'A') {
        appendedAnchors.push(el)
        el.click = vi.fn()
        return el
      }
      return origAppendChild(el)
    })
    vi.spyOn(document.body, 'removeChild').mockImplementation((el) => {
      if (el && el.tagName === 'A') return el
      return origRemoveChild(el)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the Export Tags button', () => {
    render(<MaintenanceTab />)
    expect(screen.getByRole('button', { name: /export tags/i })).toBeInTheDocument()
  })

  it('renders all three section checkboxes checked by default', () => {
    render(<MaintenanceTab />)
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(3)
    checkboxes.forEach((cb) => expect(cb).toBeChecked())
  })

  it('calls mediaUrl with all sections enabled by default on click', () => {
    render(<MaintenanceTab />)
    fireEvent.click(screen.getByRole('button', { name: /export tags/i }))
    expect(mediaUrl).toHaveBeenCalledWith('/export/tags', {
      include_library: true,
      include_maps: true,
      include_tokens: true,
    })
  })

  it('triggers a programmatic anchor click to download the file', () => {
    render(<MaintenanceTab />)
    fireEvent.click(screen.getByRole('button', { name: /export tags/i }))
    expect(appendedAnchors).toHaveLength(1)
    expect(appendedAnchors[0].click).toHaveBeenCalled()
  })

  it('passes include_library=false when Library checkbox is unchecked', () => {
    render(<MaintenanceTab />)
    const [libraryCheckbox] = screen.getAllByRole('checkbox')
    fireEvent.click(libraryCheckbox)
    fireEvent.click(screen.getByRole('button', { name: /export tags/i }))
    expect(mediaUrl).toHaveBeenCalledWith('/export/tags', {
      include_library: false,
      include_maps: true,
      include_tokens: true,
    })
  })

  it('passes include_maps=false when Maps checkbox is unchecked', () => {
    render(<MaintenanceTab />)
    const [, mapsCheckbox] = screen.getAllByRole('checkbox')
    fireEvent.click(mapsCheckbox)
    fireEvent.click(screen.getByRole('button', { name: /export tags/i }))
    expect(mediaUrl).toHaveBeenCalledWith('/export/tags', {
      include_library: true,
      include_maps: false,
      include_tokens: true,
    })
  })

  it('passes include_tokens=false when Tokens checkbox is unchecked', () => {
    render(<MaintenanceTab />)
    const [, , tokensCheckbox] = screen.getAllByRole('checkbox')
    fireEvent.click(tokensCheckbox)
    fireEvent.click(screen.getByRole('button', { name: /export tags/i }))
    expect(mediaUrl).toHaveBeenCalledWith('/export/tags', {
      include_library: true,
      include_maps: true,
      include_tokens: false,
    })
  })

  it('disables the button when all checkboxes are unchecked', () => {
    render(<MaintenanceTab />)
    screen.getAllByRole('checkbox').forEach((cb) => fireEvent.click(cb))
    expect(screen.getByRole('button', { name: /export tags/i })).toBeDisabled()
  })
})
