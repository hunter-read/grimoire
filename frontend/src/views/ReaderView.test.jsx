import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ReaderView from './ReaderView'
import api from '../api'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  mediaUrl: (path) => `/media${path}`,
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

// Capture setSearchParams calls so we can assert replace vs push behaviour.
const mockSetSearchParams = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useSearchParams: () => [new URLSearchParams(), mockSetSearchParams],
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
    { title: 'Chapter 1', page: 1,  children: [] },
    { title: 'Chapter 5', page: 81, children: [] },
  ],
}

const BOOKMARKS = [
  { id: 1, page_number: 55, label: 'My mark', notes: '', selected_text: null },
]

function setupApiMocks() {
  api.get.mockImplementation((url) => {
    if (url.includes('/toc'))       return Promise.resolve(TOC)
    if (url.includes('/bookmarks')) return Promise.resolve(BOOKMARKS)
    if (url.includes('/search'))    return Promise.resolve({ total: 0, results: [] })
    if (url.includes('/text'))      return Promise.resolve({ text: '' })
    if (url.includes('/words'))     return Promise.resolve(null)
    // Default: book detail
    return Promise.resolve(BOOK)
  })
}

function renderReader(bookId = 'book-1') {
  return render(
    <MemoryRouter initialEntries={[`/library/book/${bookId}`]}>
      <Routes>
        <Route path="/library/book/:bookId" element={<ReaderView key={bookId} />} />
      </Routes>
    </MemoryRouter>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    vi.stubGlobal('requestAnimationFrame', (cb) => { cb(); return 0 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  it('renders the book title after loading', async () => {
    renderReader()
    await waitFor(() => expect(screen.getByText('Test Book')).toBeInTheDocument())
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
