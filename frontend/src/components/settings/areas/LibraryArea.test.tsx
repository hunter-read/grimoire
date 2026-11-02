import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LibraryArea from './LibraryArea'

// The scanning sections and folder category inference run for real against a
// mocked API; the tools and the clean-up (each with its own tests) are stubbed
// down to their headings, which is all the grouping tests need of them.
vi.mock('../FolderNamingSection', () => ({ default: () => <div>folder-naming</div> }))
vi.mock('../VariantRulesSection', () => ({ default: () => <div>variant-rules</div> }))
vi.mock('../FileManagerSection', () => ({ default: () => <h3>Library File Manager</h3> }))
vi.mock('../DuplicatesSection', () => ({ default: () => <h3>Duplicate Detection</h3> }))
vi.mock('../DatabaseCleanupSection', () => ({ default: () => <h3>Database Cleanup</h3> }))

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
  settings: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}))

import api, { settings as settingsApi } from '../../../api'

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

const schedule = (overrides = {}) => ({
  rescan_schedule_enabled: false,
  rescan_schedule_interval: 'daily',
  rescan_schedule_hour: 2,
  rescan_schedule_minute: 0,
  rescan_schedule_weekday: 0,
  cleanup_on_rescan: false,
  ...overrides,
})

const get = vi.mocked(api.get)
const post = vi.mocked(api.post)
const settingsGet = vi.mocked(settingsApi.get)
const settingsPatch = vi.mocked(settingsApi.patch)

beforeEach(() => {
  vi.resetAllMocks()
  get.mockResolvedValue(idleStatus)
  post.mockResolvedValue({})
  settingsGet.mockResolvedValue(schedule() as never)
  settingsPatch.mockResolvedValue(schedule() as never)
})

describe('LibraryArea - watching', () => {
  it('sits beside the scheduled rescan', async () => {
    render(<LibraryArea />)
    expect(await screen.findByText('Watch for Changes')).toBeInTheDocument()
    expect(screen.getByText('Scheduled Rescan')).toBeInTheDocument()
  })
})

describe('LibraryArea - rescan', () => {
  it('renders the Rescan Library button when idle', () => {
    render(<LibraryArea />)
    expect(screen.getByRole('button', { name: /rescan library/i })).toBeInTheDocument()
  })

  it('does not show Stop button when scan is not running', () => {
    render(<LibraryArea />)
    expect(screen.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument()
  })

  it('shows Stop button while a scan is running', async () => {
    get.mockResolvedValue(scanningStatus)
    render(<LibraryArea />)
    expect(await screen.findByRole('button', { name: /stop/i })).toBeInTheDocument()
  })

  it('calls /cancel-scan when Stop is clicked', async () => {
    get.mockResolvedValue(scanningStatus)
    render(<LibraryArea />)
    fireEvent.click(await screen.findByRole('button', { name: /stop/i }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/cancel-scan'))
  })

  it('shows "Stopping…" after Stop is clicked', async () => {
    get.mockResolvedValue(scanningStatus)
    post.mockImplementation(() => new Promise(() => {}))
    render(<LibraryArea />)
    fireEvent.click(await screen.findByRole('button', { name: /stop/i }))
    expect(await screen.findByText('Stopping…')).toBeInTheDocument()
  })

  it('shows scanning phase label while scanning', async () => {
    get.mockResolvedValue(scanningStatus)
    render(<LibraryArea />)
    expect(await screen.findByRole('button', { name: /scanning… 28%/i })).toBeInTheDocument()
  })

  it('shows audio progress in the per-category breakdown while scanning', async () => {
    get.mockResolvedValue(scanningStatus)
    render(<LibraryArea />)
    expect(await screen.findByText('2/8 audio')).toBeInTheDocument()
  })

  it('shows the new-audio count in the completion summary', async () => {
    get.mockResolvedValue({ ...idleStatus, new_audio: 3 })
    render(<LibraryArea />)
    expect(await screen.findByText('+3 audio tracks')).toBeInTheDocument()
  })

  it('shows indexing phase label while indexing', async () => {
    get.mockResolvedValue(indexingStatus)
    render(<LibraryArea />)
    // Shown on the bar, and said once by the rescan's phase status.
    await waitFor(() => expect(screen.getAllByText(/indexing pdfs/i)).toHaveLength(2))
    expect(
      screen.getAllByRole('status').some((el) => /indexing pdfs/i.test(el.textContent || ''))
    ).toBe(true)
  })

  it('opens the rescan modal and posts the selected mode/scope on confirm', async () => {
    render(<LibraryArea />)
    fireEvent.click(screen.getByRole('button', { name: /rescan library/i }))
    fireEvent.click(await screen.findByText('Start rescan'))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/rescan', { scope: null, metadata_mode: 'new' })
    )
  })

  it('shows the updated-metadata count in the completion summary', async () => {
    get.mockResolvedValue({ ...idleStatus, updated_books: 4 })
    render(<LibraryArea />)
    expect(await screen.findByText('4 updated')).toBeInTheDocument()
  })
})

describe('LibraryArea - scheduled rescan', () => {
  it('does not show the cleanup checkbox when schedule is Off', async () => {
    render(<LibraryArea />)
    await waitFor(() => expect(settingsGet).toHaveBeenCalled())
    expect(screen.queryByLabelText(/also run database cleanup/i)).not.toBeInTheDocument()
  })

  it('shows the cleanup checkbox when a schedule is active', async () => {
    settingsGet.mockResolvedValue(schedule({ rescan_schedule_enabled: true }) as never)
    render(<LibraryArea />)
    expect(await screen.findByText(/also run database cleanup/i)).toBeInTheDocument()
  })

  it('loads cleanup_on_rescan=true from settings as checked', async () => {
    settingsGet.mockResolvedValue(
      schedule({ rescan_schedule_enabled: true, cleanup_on_rescan: true }) as never
    )
    render(<LibraryArea />)
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /also run database cleanup/i })).toBeChecked()
    )
  })

  it('includes cleanup_on_rescan=true in patch when checkbox is checked and saved', async () => {
    settingsGet.mockResolvedValue(schedule({ rescan_schedule_enabled: true }) as never)
    settingsPatch.mockResolvedValue(
      schedule({ rescan_schedule_enabled: true, cleanup_on_rescan: true }) as never
    )
    render(<LibraryArea />)
    fireEvent.click(await screen.findByRole('checkbox', { name: /also run database cleanup/i }))
    fireEvent.click(screen.getByRole('button', { name: /save schedule/i }))
    await waitFor(() =>
      expect(settingsPatch).toHaveBeenCalledWith(
        expect.objectContaining({ cleanup_on_rescan: true })
      )
    )
  })

  it('includes cleanup_on_rescan=false in patch when checkbox is unchecked and saved', async () => {
    settingsGet.mockResolvedValue(
      schedule({ rescan_schedule_enabled: true, cleanup_on_rescan: true }) as never
    )
    settingsPatch.mockResolvedValue(schedule({ rescan_schedule_enabled: true }) as never)
    render(<LibraryArea />)
    const cb = await screen.findByRole('checkbox', { name: /also run database cleanup/i })
    await waitFor(() => expect(cb).toBeChecked())
    fireEvent.click(cb)
    fireEvent.click(screen.getByRole('button', { name: /save schedule/i }))
    await waitFor(() =>
      expect(settingsPatch).toHaveBeenCalledWith(
        expect.objectContaining({ cleanup_on_rescan: false })
      )
    )
  })
})

// Moved from the old Application tab: a persistent setting for how Grimoire
// reads the library, so it sits with the other files-and-folders rules.
describe('LibraryArea - folder category inference', () => {
  const box = () =>
    screen.findByRole('checkbox', {
      name: (_, el) => el.id === 'disable_folder_category_inference',
    })

  it('renders the folder category inference toggle', async () => {
    render(<LibraryArea />)
    expect(await box()).not.toBeChecked()
  })

  it('reflects the stored setting and saves a change', async () => {
    settingsGet.mockResolvedValue({
      ...schedule(),
      disable_folder_category_inference: true,
    } as never)
    render(<LibraryArea />)
    const toggle = await box()
    await waitFor(() => expect(toggle).toBeChecked())
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(settingsPatch).toHaveBeenCalledWith(
        expect.objectContaining({ disable_folder_category_inference: false })
      )
    )
  })
})

describe('LibraryArea - grouping', () => {
  it('renders the three collapsible groups, open', () => {
    render(<LibraryArea />)
    for (const name of ['Scanning', 'Files & folders', 'Library tools']) {
      expect(screen.getByRole('button', { name, expanded: true })).toBeInTheDocument()
    }
  })

  it('groups each section under its category', () => {
    render(<LibraryArea />)
    const group = (name: string) =>
      screen.getByRole('button', { name }).closest('.settings-group') as HTMLElement
    const scanning = within(group('Scanning'))
    expect(scanning.getByRole('heading', { name: /rescan library/i })).toBeInTheDocument()
    expect(scanning.getByRole('heading', { name: /scheduled rescan/i })).toBeInTheDocument()
    const files = within(group('Files & folders'))
    expect(files.getByText('folder-naming')).toBeInTheDocument()
    expect(files.getByText('variant-rules')).toBeInTheDocument()
    const tools = within(group('Library tools'))
    expect(tools.getByRole('heading', { name: /library file manager/i })).toBeInTheDocument()
    expect(tools.getByRole('heading', { name: /duplicate detection/i })).toBeInTheDocument()
  })

  // Removing records can't be undone, so it is never tucked into a group.
  it('keeps database cleanup in the danger zone at the bottom', () => {
    render(<LibraryArea />)
    const zone = screen.getByRole('region', { name: 'Danger zone' })
    expect(within(zone).getByRole('heading', { name: /database cleanup/i })).toBeInTheDocument()
    expect(zone.closest('.settings-group')).toBeNull()
  })

  it('collapsing a group hides its sections', async () => {
    render(<LibraryArea />)
    await userEvent.click(screen.getByRole('button', { name: 'Library tools' }))
    expect(screen.queryByRole('heading', { name: /library file manager/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /duplicate detection/i })).not.toBeInTheDocument()
  })

  it('remembers a collapsed group across remounts', async () => {
    const { unmount } = render(<LibraryArea />)
    await userEvent.click(screen.getByRole('button', { name: 'Files & folders' }))
    expect(localStorage.getItem('grimoire:settings:library:files-and-folders')).toBe('0')
    unmount()

    render(<LibraryArea />)
    expect(screen.getByRole('button', { name: 'Files & folders' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('collapsing the scanning group hides the rescan controls', async () => {
    render(<LibraryArea />)
    await userEvent.click(screen.getByRole('button', { name: 'Scanning' }))
    expect(screen.queryByRole('heading', { name: /rescan library/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /rescan library/i })).not.toBeInTheDocument()
  })
})
