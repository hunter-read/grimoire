import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ReaderView from './ReaderView'
import api from '../api'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  // Mirrors the real signature's query params so tests can assert the render
  // width requested for a page.
  mediaUrl: (path, params) =>
    `/media${path}${params ? `?${new URLSearchParams(params).toString()}` : ''}`,
  // Mirrors the real helper: `v` is the book's content token, present only once
  // the scanner has hashed the file.
  bookPageUrl: (bookId, page, width, contentToken) =>
    `/media/books/${bookId}/page/${page}?${new URLSearchParams(
      contentToken ? { width, v: contentToken } : { width }
    ).toString()}`,
}))

vi.mock('../hooks/useReaderGestures', () => ({
  default: () => ({ handleTouchStart: vi.fn(), handleTouchMove: vi.fn(), handleTouchEnd: vi.fn() }),
}))

vi.mock('../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}))

vi.mock('../components/campaigns/AddToCampaignButton', () => ({
  default: () => null,
}))

// Capture setSearchParams and navigate calls so we can assert behaviour.
const mockSetSearchParams = vi.fn()
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useSearchParams: () => [new URLSearchParams(), mockSetSearchParams],
    useNavigate: () => mockNavigate,
  }
})

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BOOK = {
  id: 'book-1',
  title: 'Test Book',
  page_count: 100,
  mime_type: 'application/pdf',
  indexed: true,
  has_thumbnail: false,
}

const TOC = {
  toc: [
    { title: 'Chapter 1', page: 1, children: [] },
    { title: 'Chapter 5', page: 81, children: [] },
  ],
}

const BOOKMARKS = [{ id: 1, page_number: 55, label: 'My mark', notes: '', selected_text: null }]

function setupApiMocks() {
  api.get.mockImplementation((url) => {
    if (url.includes('/toc')) return Promise.resolve(TOC)
    if (url.includes('/bookmarks')) return Promise.resolve(BOOKMARKS)
    if (url.includes('/search')) return Promise.resolve({ total: 0, results: [] })
    if (url.includes('/text')) return Promise.resolve({ text: '' })
    if (url.includes('/words')) return Promise.resolve(null)
    // Default: book detail
    return Promise.resolve(BOOK)
  })
}

function renderReader(bookId = 'book-1', { locationState } = {}) {
  const entry = locationState
    ? { pathname: `/library/book/${bookId}`, state: locationState }
    : `/library/book/${bookId}`
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/library/book/:bookId" element={<ReaderView key={bookId} />} />
      </Routes>
    </MemoryRouter>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Wait until the reader has stopped re-rendering from its initial data loads.
 *
 * The view fires several independent fetches on mount (book, TOC, bookmarks,
 * text), and every resolution re-renders. Anything that depends on a stable
 * render — chiefly the keydown handler, which is re-registered each time
 * currentPage changes — must not run until those have all landed.
 *
 * Waits for setSearchParams to stay untouched across consecutive turns of the
 * microtask queue, which is the observable signal that the settling effects
 * have finished. Uses only microtasks, so no real timers and no fixed sleep.
 */
async function waitForReaderIdle() {
  let previous = -1
  // Three consecutive quiet turns: one to drain the current promise chain, and
  // two more to catch an effect that schedules another effect.
  let quietTurns = 0
  while (quietTurns < 3) {
    await act(async () => {
      await Promise.resolve()
    })
    const calls = mockSetSearchParams.mock.calls.length
    quietTurns = calls === previous ? quietTurns + 1 : 0
    previous = calls
  }
}

/** Returns the `replace` option from the most recent setSearchParams call. */
function lastReplaceOption() {
  const calls = mockSetSearchParams.mock.calls
  if (calls.length === 0) return undefined
  const opts = calls[calls.length - 1][1]
  return opts?.replace
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ReaderView — jump navigation history behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupApiMocks()
    // Stub rAF so effects that schedule frames run synchronously in jsdom.
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      cb()
      return 0
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  it('renders the book title after loading', async () => {
    renderReader()
    await waitFor(() => expect(screen.getByText('Test Book')).toBeInTheDocument())
  })

  it('navigates with the ArrowRight / ArrowLeft keys', async () => {
    renderReader()
    await waitFor(() => screen.getByText('Test Book'))

    // The title appearing only means the book detail resolved — the TOC,
    // bookmarks, and text fetches are still landing, and each one re-renders
    // the reader. The keydown handler closes over currentPage and so is torn
    // down and re-registered on every one of those renders, meaning a key
    // dispatched into that window can hit a detached listener and be lost.
    // Wait for the component to go quiet first, or this races (issue #157 CI
    // flake: the ArrowRight was dropped and the assertion below timed out).
    await waitForReaderIdle()

    mockSetSearchParams.mockClear()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    })

    // Assert the *specific* navigation, not merely that something called
    // setSearchParams — a stray settling effect would satisfy a bare
    // toHaveBeenCalled() and hide a dropped keypress.
    await waitFor(() =>
      expect(mockSetSearchParams).toHaveBeenCalledWith({ page: '2' }, { replace: true })
    )

    mockSetSearchParams.mockClear()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    })
    // Back to page 1, which drops the param entirely rather than writing page=1.
    await waitFor(() => expect(mockSetSearchParams).toHaveBeenCalledWith({}, { replace: true }))
  })

  it('the "?" key toggles the shortcuts overlay', async () => {
    renderReader()
    await waitFor(() => screen.getByText('Test Book'))
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))
    })
    // Toggling shortcuts on then off should not throw and keeps the reader mounted.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(screen.getByText('Test Book')).toBeInTheDocument()
  })

  it('the "f" key toggles the favorite without crashing', async () => {
    renderReader()
    await waitFor(() => screen.getByText('Test Book'))
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }))
    })
    expect(screen.getByText('Test Book')).toBeInTheDocument()
  })

  it('uses replace:true for the initial page sync (continuous reading)', async () => {
    renderReader()
    await waitFor(() => screen.getByText('Test Book'))
    // Any setSearchParams call from normal reading should use replace:true.
    // The effect fires after mount; all such calls must be replace.
    const calls = mockSetSearchParams.mock.calls
    for (const [, opts] of calls) {
      expect(opts?.replace).toBe(true)
    }
  })

  it('uses replace:false (push) when navigating via the ToC', async () => {
    renderReader()
    await waitFor(() => screen.getByText('Test Book'))
    mockSetSearchParams.mockClear()

    // Open the ToC panel.
    await userEvent.click(screen.getByTitle('Contents'))

    // Wait for ToC to load and click a chapter link.
    await waitFor(() => screen.getByText('Chapter 5'))
    await userEvent.click(screen.getByText('Chapter 5'))

    await waitFor(() => expect(mockSetSearchParams).toHaveBeenCalled())
    expect(lastReplaceOption()).toBe(false)
  })

  it('uses replace:false (push) when navigating via a bookmark', async () => {
    renderReader()
    await waitFor(() => screen.getByText('Test Book'))
    mockSetSearchParams.mockClear()

    // Open the bookmarks panel.
    await userEvent.click(screen.getByTitle('Bookmarks'))

    // Wait for bookmark list and click it.
    await waitFor(() => screen.getByText('My mark'))
    await userEvent.click(screen.getByText('My mark'))

    await waitFor(() => expect(mockSetSearchParams).toHaveBeenCalled())
    expect(lastReplaceOption()).toBe(false)
  })

  it('uses replace:true for navigation immediately after a jump (continuous reading resumes)', async () => {
    renderReader()
    await waitFor(() => screen.getByText('Test Book'))

    // Jump via ToC.
    await userEvent.click(screen.getByTitle('Contents'))
    await waitFor(() => screen.getByText('Chapter 5'))
    await userEvent.click(screen.getByText('Chapter 5'))
    await waitFor(() => expect(mockSetSearchParams).toHaveBeenCalled())

    mockSetSearchParams.mockClear()

    // Now navigate with the next-page arrow — should go back to replace.
    await userEvent.click(screen.getByLabelText('Next page'))

    await waitFor(() => expect(mockSetSearchParams).toHaveBeenCalled())
    expect(lastReplaceOption()).toBe(true)
  })

  it('resets pushNextRef after the first jump so consecutive arrow presses replace', async () => {
    renderReader()
    await waitFor(() => screen.getByText('Test Book'))

    // Jump via ToC to a page that is different from the current page (1).
    await userEvent.click(screen.getByTitle('Contents'))
    await waitFor(() => screen.getByText('Chapter 5'))
    await userEvent.click(screen.getByText('Chapter 5'))
    await waitFor(() => expect(mockSetSearchParams).toHaveBeenCalled())

    // Verify the flag was consumed: second setSearchParams call (arrow navigation)
    // must use replace:true.
    mockSetSearchParams.mockClear()
    await userEvent.click(screen.getByLabelText('Next page'))
    await waitFor(() => expect(mockSetSearchParams).toHaveBeenCalled())
    expect(lastReplaceOption()).toBe(true)

    // A third press still replaces.
    mockSetSearchParams.mockClear()
    await userEvent.click(screen.getByLabelText('Next page'))
    await waitFor(() => expect(mockSetSearchParams).toHaveBeenCalled())
    expect(lastReplaceOption()).toBe(true)
  })
})

describe('ReaderView — spread mode (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupApiMocks()
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      cb()
      return 0
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    localStorage.clear()
  })

  it('persists spreadOffset to localStorage when cover pairing is toggled', async () => {
    localStorage.setItem('grimoire:book:book-1', JSON.stringify({ mode: 'spread' }))
    renderReader()
    await waitFor(() => screen.getByText('Test Book'))

    await userEvent.click(screen.getByLabelText('More actions'))
    // The menu stays open across toggles, so both flips work in one pass.
    await userEvent.click(screen.getByRole('menuitemcheckbox'))
    expect(JSON.parse(localStorage.getItem('grimoire:book:book-1')).spreadOffset).toBe(1)

    await userEvent.click(screen.getByRole('menuitemcheckbox'))
    expect(JSON.parse(localStorage.getItem('grimoire:book:book-1')).spreadOffset).toBe(0)
  })

  it('restores spreadOffset from localStorage on mount', async () => {
    localStorage.setItem(
      'grimoire:book:book-1',
      JSON.stringify({ mode: 'spread', spreadOffset: 1 })
    )
    renderReader()
    await waitFor(() => screen.getByText('Test Book'))

    await userEvent.click(screen.getByLabelText('More actions'))
    expect(screen.getByRole('menuitemcheckbox')).toHaveAttribute('aria-checked', 'true')
  })
})

describe('ReaderView — back button navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupApiMocks()
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      cb()
      return 0
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  it('navigates to location.state.from when present', async () => {
    renderReader('book-1', { locationState: { from: '/library/system/system-1' } })
    await waitFor(() => screen.getByText('Test Book'))

    await userEvent.click(screen.getByLabelText('Back'))

    // Flagged as a return so the referring view restores its search/sort/filter.
    expect(mockNavigate).toHaveBeenCalledWith('/library/system/system-1', {
      state: { restoreView: true },
    })
    expect(mockNavigate).not.toHaveBeenCalledWith(-1)
  })

  it('falls back to navigate(-1) when no location.state.from', async () => {
    renderReader('book-1')
    await waitFor(() => screen.getByText('Test Book'))

    await userEvent.click(screen.getByLabelText('Back'))

    expect(mockNavigate).toHaveBeenCalledWith(-1)
  })
})

describe('ReaderView — archive files (issue #94)', () => {
  const ARCHIVE_BOOK = {
    id: 'arch-1',
    title: 'LANCER Bundle',
    filename: 'lancer.zip',
    page_count: 0,
    mime_type: 'application/zip',
    indexed: false,
    has_thumbnail: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    api.get.mockImplementation((url) => {
      if (url.includes('/toc')) return Promise.resolve({ toc: [] })
      if (url.includes('/bookmarks')) return Promise.resolve([])
      return Promise.resolve(ARCHIVE_BOOK)
    })
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      cb()
      return 0
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  it('shows a download panel instead of the page reader', async () => {
    renderReader('arch-1')
    await waitFor(() => expect(screen.getByText('LANCER Bundle')).toBeInTheDocument())
    // No page image / reader toolbar controls — just a download action.
    const link = screen.getByRole('link', { name: /download/i })
    expect(link).toHaveAttribute('href', '/media/books/arch-1/file')
    expect(link).toHaveAttribute('download', 'lancer.zip')
  })
})

describe('ReaderView — zoom (issue #249)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupApiMocks()
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      cb()
      return 0
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  const press = (key) =>
    act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key }))
    })

  it('zooms in and out with the +/- keys', async () => {
    renderReader()
    await waitFor(() => screen.getByText('Test Book'))
    expect(screen.getByText('100%')).toBeInTheDocument()

    await press('+')
    expect(screen.getByText('125%')).toBeInTheDocument()
    await press('-')
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('accepts "=" as zoom in, so Shift is not required', async () => {
    renderReader()
    await waitFor(() => screen.getByText('Test Book'))
    await press('=')
    expect(screen.getByText('125%')).toBeInTheDocument()
  })

  it('resets to 100% with the 0 key', async () => {
    renderReader()
    await waitFor(() => screen.getByText('Test Book'))
    await press('+')
    await press('+')
    expect(screen.getByText('150%')).toBeInTheDocument()

    await press('0')
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('does not zoom past the clamp', async () => {
    renderReader()
    await waitFor(() => screen.getByText('Test Book'))
    for (let i = 0; i < 8; i++) await press('+')
    // Ceiling is 2x: page images are pre-rendered and the render endpoint caps
    // width at 3000px, so beyond this the image would just be scaled up.
    expect(screen.getByText('200%')).toBeInTheDocument()
  })

  it('ignores the zoom keys while a text input has focus', async () => {
    renderReader()
    await waitFor(() => screen.getByText('Test Book'))
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }))
    })
    expect(screen.getByText('100%')).toBeInTheDocument()
    input.remove()
  })

  it('resets zoom when the page changes', async () => {
    renderReader()
    await waitFor(() => screen.getByText('Test Book'))
    await press('+')
    expect(screen.getByText('125%')).toBeInTheDocument()

    await press('ArrowRight')
    await waitFor(() => expect(screen.getByText('100%')).toBeInTheDocument())
  })

  it('requests a sharper page render once zoomed past the threshold', async () => {
    const { container } = renderReader()
    await waitFor(() => screen.getByText('Test Book'))
    const src = () => container.querySelector('img[src*="/page/"]')?.getAttribute('src') ?? ''
    expect(src()).toContain('width=1600')

    // 1.75x crosses the threshold, so the page is re-fetched at a higher width
    // instead of being scaled up as a bitmap.
    await press('+')
    await press('+')
    await press('+')
    await waitFor(() => expect(src()).toContain('width=2800'))
  })
})
