import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import LogsTab from './LogsTab'
import api from '../../api'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))
vi.mock('../../api', () => ({ default: { get: vi.fn() } }))
vi.mock('./LogRow', () => ({
  default: ({ entry, onUserClick }) => (
    <div data-testid="log-row">
      {entry.message}
      {entry.user && onUserClick && (
        <button onClick={() => onUserClick(entry.user)}>{`chip:${entry.user}`}</button>
      )}
    </div>
  ),
}))

// Capture the IntersectionObserver callback so tests can drive "scrolled to the
// top" without a real layout engine.
let observerCallback = null

// Scroll to the top until the older page is actually requested. The component
// reads its entry counts from refs that an effect fills after each render, and
// that effect is scheduled apart from the test's own waits - so a single
// intersection fired straight after the first page renders can find nothing
// older to load, and the test would pass without ever loading it.
const scrollToTopUntilRequested = (url) =>
  waitFor(() => {
    observerCallback([{ isIntersecting: true }])
    expect(api.get).toHaveBeenCalledWith(url)
  })
class MockIntersectionObserver {
  constructor(cb) {
    observerCallback = cb
  }
  observe() {}
  disconnect() {}
}

const entry = (message, level = 'info') => ({
  timestamp: '2026-08-11T10:00:00.000000',
  level,
  message,
  logger: 'backend',
})

const page = (entries, over = {}) => ({
  entries,
  total: entries.length,
  max_seq: entries.length,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks keeps queued `mockResolvedValueOnce` values, so one a test
  // never consumed would answer the next test's first fetch instead.
  api.get.mockReset()
  observerCallback = null
  globalThis.IntersectionObserver = MockIntersectionObserver
})

afterEach(() => {
  vi.useRealTimers()
})

describe('LogsTab', () => {
  it('loads and renders the initial page of entries', async () => {
    api.get.mockResolvedValue(page([entry('server started'), entry('ready')]))
    render(<LogsTab />, { wrapper: MemoryRouter })
    expect(await screen.findByText('server started')).toBeInTheDocument()
    expect(screen.getByText('ready')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/logs?level=info&limit=1000&offset=0')
  })

  it('shows the empty state when there are no entries for the level', async () => {
    api.get.mockResolvedValue(page([]))
    render(<LogsTab />, { wrapper: MemoryRouter })
    expect(await screen.findByText('logs.noEntriesLevel')).toBeInTheDocument()
  })

  it('shows an error when the initial load fails', async () => {
    api.get.mockRejectedValue(new Error('logs unavailable'))
    render(<LogsTab />, { wrapper: MemoryRouter })
    expect(await screen.findByRole('alert')).toHaveTextContent('logs unavailable')
  })

  it('falls back to a default message when the error has none', async () => {
    api.get.mockRejectedValue({})
    render(<LogsTab />, { wrapper: MemoryRouter })
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load logs')
  })

  it('refetches when the level changes', async () => {
    api.get.mockResolvedValue(page([entry('boom', 'error')]))
    render(<LogsTab />, { wrapper: MemoryRouter })
    await screen.findByText('boom')

    await userEvent.click(screen.getByText('debug'))
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/logs?level=debug&limit=1000&offset=0')
    )
  })

  describe('user filter', () => {
    const at =
      (url) =>
      ({ children }) => <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>

    it('narrows to the user named in the URL and hides the per-line chips', async () => {
      api.get.mockResolvedValue(
        page([{ ...entry('signed in'), user: 'alice' }], { users: ['alice'] })
      )
      render(<LogsTab />, { wrapper: at('/settings/logs?user=alice') })
      await screen.findByText('signed in')
      expect(api.get).toHaveBeenCalledWith('/logs?level=info&limit=1000&offset=0&user=alice')
      expect(screen.queryByText('chip:alice')).not.toBeInTheDocument()
      expect(screen.getByLabelText('logs.userFilterAriaLabel')).toHaveValue('alice')
    })

    it("narrows to a line's user from its chip", async () => {
      api.get.mockResolvedValue(page([{ ...entry('opened map'), user: 'bob' }], { users: ['bob'] }))
      render(<LogsTab />, { wrapper: MemoryRouter })
      await userEvent.click(await screen.findByText('chip:bob'))
      await waitFor(() =>
        expect(api.get).toHaveBeenCalledWith('/logs?level=info&limit=1000&offset=0&user=bob')
      )
      expect(screen.getByLabelText('logs.userFilterAriaLabel')).toHaveValue('bob')
    })

    it('offers a way back to everyone when the user has no lines', async () => {
      api.get.mockResolvedValue(page([], { users: [] }))
      render(<LogsTab />, { wrapper: at('/settings/logs?user=carol') })
      await screen.findByText('logs.noEntriesUser')
      await userEvent.click(screen.getByText('logs.showAllUsers'))
      await waitFor(() =>
        expect(api.get).toHaveBeenLastCalledWith('/logs?level=info&limit=1000&offset=0')
      )
      expect(screen.getByLabelText('logs.userFilterAriaLabel')).toHaveValue('')
    })
  })

  it('marks the active level button as pressed', async () => {
    api.get.mockResolvedValue(page([]))
    render(<LogsTab />, { wrapper: MemoryRouter })
    await screen.findByText('logs.noEntriesLevel')
    const [debugBtn] = screen.getAllByLabelText('logs.showLevelAbove')
    expect(debugBtn).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(debugBtn)
    expect(debugBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('filters entries by the search box', async () => {
    api.get.mockResolvedValue(page([entry('alpha event'), entry('beta event')]))
    render(<LogsTab />, { wrapper: MemoryRouter })
    await screen.findByText('alpha event')

    await userEvent.type(screen.getByLabelText('logs.searchAriaLabel'), 'alpha')
    expect(screen.getByText('alpha event')).toBeInTheDocument()
    expect(screen.queryByText('beta event')).not.toBeInTheDocument()
  })

  it('shows the no-match empty state when the search excludes everything', async () => {
    api.get.mockResolvedValue(page([entry('alpha event')]))
    render(<LogsTab />, { wrapper: MemoryRouter })
    await screen.findByText('alpha event')

    await userEvent.type(screen.getByLabelText('logs.searchAriaLabel'), 'zzz')
    expect(screen.getByText('logs.noEntriesMatch')).toBeInTheDocument()
  })

  it('toggles live tailing off and on', async () => {
    api.get.mockResolvedValue(page([]))
    render(<LogsTab />, { wrapper: MemoryRouter })
    await screen.findByText('logs.noEntriesLevel')

    const liveBtn = screen.getByLabelText('logs.pauseAriaLabel')
    expect(liveBtn).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(liveBtn)

    const pausedBtn = screen.getByLabelText('logs.resumeAriaLabel')
    expect(pausedBtn).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('logs.pausedButton')).toBeInTheDocument()
  })

  it('appends new entries from the live poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.get.mockResolvedValueOnce(page([entry('first')]))
    render(<LogsTab />, { wrapper: MemoryRouter })
    await screen.findByText('first')

    api.get.mockResolvedValueOnce(page([entry('second')], { total: 2, max_seq: 2 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100)
    })
    expect(await screen.findByText('second')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/logs?level=info&limit=1000&after_seq=1')
  })

  it('ignores an empty live poll response', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.get.mockResolvedValueOnce(page([entry('only')]))
    render(<LogsTab />, { wrapper: MemoryRouter })
    await screen.findByText('only')

    api.get.mockResolvedValueOnce(page([], { total: 1, max_seq: 1 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100)
    })
    expect(screen.getAllByTestId('log-row')).toHaveLength(1)
  })

  it('swallows live poll failures without showing an error', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.get.mockResolvedValueOnce(page([entry('only')]))
    render(<LogsTab />, { wrapper: MemoryRouter })
    await screen.findByText('only')

    api.get.mockRejectedValueOnce(new Error('transient'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('only')).toBeInTheDocument()
  })

  it('does not poll while paused', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.get.mockResolvedValue(page([entry('only')]))
    render(<LogsTab />, { wrapper: MemoryRouter })
    await screen.findByText('only')
    await userEvent.click(screen.getByLabelText('logs.pauseAriaLabel'))

    const callsBefore = api.get.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(api.get.mock.calls.length).toBe(callsBefore)
  })

  it('shows the older-entries banner and loads older pages when the sentinel intersects', async () => {
    api.get.mockResolvedValueOnce(page([entry('recent')], { total: 3, max_seq: 1 }))
    render(<LogsTab />, { wrapper: MemoryRouter })
    await screen.findByText('recent')
    expect(screen.getByText('logs.olderEntries')).toBeInTheDocument()

    api.get.mockResolvedValueOnce(page([entry('older')], { total: 3, max_seq: 1 }))
    await scrollToTopUntilRequested('/logs?level=info&limit=2&offset=1')
    expect(await screen.findByText('older')).toBeInTheDocument()
  })

  it('does not load older entries when everything is already loaded', async () => {
    api.get.mockResolvedValue(page([entry('all of it')]))
    render(<LogsTab />, { wrapper: MemoryRouter })
    await screen.findByText('all of it')
    expect(screen.queryByText('logs.olderEntries')).not.toBeInTheDocument()

    const callsBefore = api.get.mock.calls.length
    await act(async () => {
      observerCallback([{ isIntersecting: true }])
    })
    expect(api.get.mock.calls.length).toBe(callsBefore)
  })

  it('ignores a non-intersecting sentinel callback', async () => {
    api.get.mockResolvedValueOnce(page([entry('recent')], { total: 5, max_seq: 1 }))
    render(<LogsTab />, { wrapper: MemoryRouter })
    await screen.findByText('recent')

    const callsBefore = api.get.mock.calls.length
    await act(async () => {
      observerCallback([{ isIntersecting: false }])
    })
    expect(api.get.mock.calls.length).toBe(callsBefore)
  })

  it('swallows a failure while loading older entries', async () => {
    api.get.mockResolvedValueOnce(page([entry('recent')], { total: 5, max_seq: 1 }))
    render(<LogsTab />, { wrapper: MemoryRouter })
    await screen.findByText('recent')

    api.get.mockRejectedValueOnce(new Error('older boom'))
    await scrollToTopUntilRequested('/logs?level=info&limit=4&offset=1')
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.getByText('recent')).toBeInTheDocument()
  })

  it('unpins on scroll away from the bottom and re-pins via the jump button', async () => {
    api.get.mockResolvedValue(page([entry('line')]))
    render(<LogsTab />, { wrapper: MemoryRouter })
    await screen.findByText('line')

    const log = screen.getByRole('log')
    // jsdom reports zero dimensions, so fake a tall, scrolled-up container.
    Object.defineProperty(log, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(log, 'clientHeight', { value: 400, configurable: true })
    log.scrollTop = 0

    await act(async () => {
      log.dispatchEvent(new Event('scroll'))
    })
    const jump = await screen.findByLabelText('logs.jumpToLatest')

    await userEvent.click(jump)
    await waitFor(() =>
      expect(screen.queryByLabelText('logs.jumpToLatest')).not.toBeInTheDocument()
    )
    expect(log.scrollTop).toBe(1000)
  })
})
