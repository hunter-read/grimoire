import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import WatchLibrarySection from './WatchLibrarySection'
import { settings as settingsApi, type Schema } from '../../api'

vi.mock('../../api', () => ({
  settings: { get: vi.fn(), patch: vi.fn() },
}))

type Settings = Schema<'SettingsResponse'>

const settings = (overrides: Partial<Settings> = {}) =>
  ({
    library_watch_enabled: true,
    library_watch_env_locked: false,
    library_watch_mode: 'auto',
    library_watch_mode_env_locked: false,
    library_watch_state: { state: 'watching', detail: '' },
    library_watch_poll_interval: 120,
    ...overrides,
  }) as Settings

const get = vi.mocked(settingsApi.get)
const patch = vi.mocked(settingsApi.patch)

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('WatchLibrarySection', () => {
  it('shows the saved settings and what the watcher is doing', async () => {
    get.mockResolvedValue(settings() as never)
    render(<WatchLibrarySection />)

    const toggle = await screen.findByLabelText('Watch the library folder for changes')
    expect(toggle).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Automatic' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('library-watch-state')).toHaveTextContent('Watching for changes.')
  })

  it('explains each mode, with the poll interval', async () => {
    get.mockResolvedValue(settings({ library_watch_poll_interval: 300 }) as never)
    render(<WatchLibrarySection />)

    fireEvent.click(await screen.findByRole('radio', { name: 'Check regularly' }))
    expect(screen.getByText(/every 300 seconds/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'File system events' }))
    expect(screen.getByText(/only hears about changes made on this machine/)).toBeInTheDocument()
  })

  it('saves the toggle and the mode', async () => {
    get.mockResolvedValue(settings() as never)
    patch.mockResolvedValue(
      settings({
        library_watch_mode: 'poll',
        library_watch_state: { state: 'polling', detail: '' },
      }) as never
    )
    render(<WatchLibrarySection />)

    fireEvent.click(await screen.findByRole('radio', { name: 'Check regularly' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await screen.findByText('Saved')
    expect(patch).toHaveBeenCalledWith({ library_watch_enabled: true, library_watch_mode: 'poll' })
    expect(screen.getByTestId('library-watch-state')).toHaveTextContent(
      'Checking for changes every 120 seconds.'
    )
  })

  it('refreshes the status a moment after saving', async () => {
    get.mockResolvedValue(settings() as never)
    patch.mockResolvedValue(settings({ library_watch_enabled: false }) as never)
    render(<WatchLibrarySection />)

    const toggle = await screen.findByLabelText('Watch the library folder for changes')
    fireEvent.click(toggle)
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()

    get.mockResolvedValue(
      settings({
        library_watch_enabled: false,
        library_watch_state: { state: 'off', detail: '' },
      }) as never
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    expect(patch).toHaveBeenCalledWith({ library_watch_enabled: false, library_watch_mode: 'auto' })

    await waitFor(
      () =>
        expect(screen.getByTestId('library-watch-state')).toHaveTextContent(
          'Not watching. New files appear after a manual or scheduled rescan.'
        ),
      { timeout: 4000 }
    )
  })

  it('says why the library cannot be watched', async () => {
    get.mockResolvedValue(
      settings({
        library_watch_state: { state: 'unavailable', detail: 'The library folder does not exist.' },
      }) as never
    )
    render(<WatchLibrarySection />)

    expect(await screen.findByTestId('library-watch-state')).toHaveTextContent(
      "Can't watch the library: The library folder does not exist."
    )
  })

  it('shows env-pinned settings read-only and sends only what is free', async () => {
    get.mockResolvedValue(
      settings({ library_watch_env_locked: true, library_watch_mode: 'events' }) as never
    )
    patch.mockResolvedValue(settings({ library_watch_env_locked: true }) as never)
    render(<WatchLibrarySection />)

    const toggle = await screen.findByLabelText('Watch the library folder for changes')
    expect(toggle).toBeDisabled()
    expect(screen.getByText('Set by LIBRARY_WATCH')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved')
    expect(patch).toHaveBeenCalledWith({ library_watch_mode: 'events' })
  })

  it('hides Save when both settings are pinned', async () => {
    get.mockResolvedValue(
      settings({ library_watch_env_locked: true, library_watch_mode_env_locked: true }) as never
    )
    render(<WatchLibrarySection />)

    await screen.findByText('Set by LIBRARY_WATCH_MODE')
    expect(screen.getByRole('radio', { name: 'Automatic' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('falls back to defaults for a partial response', async () => {
    get.mockResolvedValue({ library_watch_mode: 'nonsense' } as never)
    render(<WatchLibrarySection />)

    expect(await screen.findByLabelText('Watch the library folder for changes')).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Automatic' })).toHaveAttribute('aria-checked', 'true')
  })
})
