import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ReaderView from './ReaderView'
import api from '../api'
import type { PdfDocumentViewerProps } from '../components/reader/PdfDocumentViewer'

// PDF mode on phones and tablets (issue #890): the in-app viewer stands in for
// the browser's own, which those devices can't embed.

const mockGet = vi.mocked(api.get) as unknown as Mock

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  mediaUrl: (path: string) => `/media${path}`,
  bookPageUrl: (bookId: string, page: number) => `/media/books/${bookId}/page/${page}`,
}))

vi.mock('../hooks/useReaderGestures', () => ({
  default: () => ({ handleTouchStart: vi.fn(), handleTouchMove: vi.fn(), handleTouchEnd: vi.fn() }),
}))

vi.mock('../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn(() => Promise.resolve()) }),
}))

vi.mock('../components/campaigns/AddToCampaignButton', () => ({ default: () => null }))

const mockIsMobile = { value: false }
vi.mock('../hooks/useIsMobile', () => ({ default: () => mockIsMobile.value }))

const mockEmbeds = { value: true }
vi.mock('../utils/pdfEmbed', () => ({ browserEmbedsPdf: () => mockEmbeds.value }))

// The viewer itself is tested on its own; here it only has to show what it was
// handed and let a test play the reader scrolling and annotating.
const viewerProps = { current: null as PdfDocumentViewerProps | null }
vi.mock('../components/reader/PdfDocumentViewer', () => ({
  default: (props: PdfDocumentViewerProps) => {
    viewerProps.current = props
    return (
      <div data-testid="in-app-pdf" data-url={props.url} data-page={props.page}>
        <button onClick={() => props.onPageChange?.(9)}>scroll to 9</button>
        <button onClick={() => props.onDirtyChange?.(true)}>annotate</button>
      </div>
    )
  },
}))

const mockNavigate = vi.fn()
const mockSearchParams = { value: new URLSearchParams() }
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useSearchParams: () => [mockSearchParams.value, vi.fn()],
    useNavigate: () => mockNavigate,
  }
})

const PDF_BOOK = {
  id: 'book-1',
  title: 'Core Rules',
  filename: 'core-rules.pdf',
  page_count: 100,
  mime_type: 'application/pdf',
  indexed: false,
  has_thumbnail: false,
}

function openBook(book: Record<string, unknown> = PDF_BOOK, view?: string) {
  mockSearchParams.value = new URLSearchParams(view ? { view } : {})
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/toc')) return Promise.resolve({ toc: [] })
    if (url.includes('/bookmarks')) return Promise.resolve([])
    if (url.includes('/text')) return Promise.resolve({ text: '' })
    if (url.includes('/words')) return Promise.resolve(null)
    return Promise.resolve(book)
  })
  return render(
    <MemoryRouter initialEntries={['/library/book/book-1']}>
      <Routes>
        <Route path="/library/book/:bookId" element={<ReaderView />} />
      </Routes>
    </MemoryRouter>
  )
}

/** The kebab's view modes, by name. */
async function modesOnOffer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More actions' }))
  const menu = await screen.findByRole('menu')
  return within(menu)
    .queryAllByRole('menuitemradio')
    .map((item) => item.textContent)
}

beforeEach(() => {
  localStorage.clear()
  mockIsMobile.value = false
  mockEmbeds.value = true
  viewerProps.current = null
  mockNavigate.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ReaderView — PDF mode where the browser cannot embed a PDF', () => {
  it('shows the in-app viewer instead of a frame', async () => {
    mockEmbeds.value = false
    const { container } = openBook(PDF_BOOK, 'pdf')
    const pdf = await screen.findByTestId('in-app-pdf')
    expect(pdf).toHaveAttribute('data-url', '/media/books/book-1/file')
    expect(viewerProps.current!.filename).toBe('core-rules.pdf')
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('keeps the browser’s own viewer on a desktop', async () => {
    const { container } = openBook(PDF_BOOK, 'pdf')
    await screen.findByRole('heading', { name: 'Core Rules' })
    expect(container.querySelector('iframe')).toHaveAttribute(
      'src',
      '/media/books/book-1/file#page=1'
    )
    expect(screen.queryByTestId('in-app-pdf')).not.toBeInTheDocument()
    // The frame keeps its page to itself, so nothing that needs one is offered.
    expect(screen.queryByRole('button', { name: 'Contents' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bookmark this page' })).not.toBeInTheDocument()
  })

  it('follows the page the viewer scrolls to, and offers contents and bookmarks', async () => {
    const user = userEvent.setup()
    mockEmbeds.value = false
    openBook(PDF_BOOK, 'pdf')
    await user.click(await screen.findByRole('button', { name: 'scroll to 9' }))
    expect(screen.getByRole('textbox', { name: 'Current page number' })).toHaveValue('9')
    expect(screen.getByTestId('in-app-pdf')).toHaveAttribute('data-page', '9')
    expect(screen.getByRole('button', { name: 'Contents' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bookmark this page' })).toBeInTheDocument()
    // And the page box drives the viewer.
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByTestId('in-app-pdf')).toHaveAttribute('data-page', '10')
  })

  it('falls back to page view for a book that is not a PDF', async () => {
    const user = userEvent.setup()
    mockEmbeds.value = false
    const { container } = openBook({ ...PDF_BOOK, mime_type: 'image/vnd.djvu' }, 'pdf')
    // Never handed to pdf.js, not even for the render before the switch.
    await screen.findByRole('heading', { name: 'Core Rules' })
    expect(screen.queryByTestId('in-app-pdf')).not.toBeInTheDocument()
    expect(container.querySelector('iframe')).toBeNull()
    expect(await screen.findByAltText(/^Page 1/)).toBeInTheDocument()
    expect(viewerProps.current).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
    expect(await modesOnOffer(user)).toEqual(['Page', 'Spread'])
  })
})

describe('ReaderView — PDF mode on a phone', () => {
  beforeEach(() => {
    mockIsMobile.value = true
    mockEmbeds.value = false
  })

  it('opens in PDF mode when asked, where it used to be held to page view', async () => {
    openBook(PDF_BOOK, 'pdf')
    expect(await screen.findByTestId('in-app-pdf')).toBeInTheDocument()
  })

  it('has no room for a spread, so opens one as a page', async () => {
    openBook(PDF_BOOK, 'spread')
    await screen.findByRole('heading', { name: 'Core Rules' })
    expect(await screen.findByAltText(/^Page 1/)).toBeInTheDocument()
    expect(screen.queryByAltText(/^Page 2/)).not.toBeInTheDocument()
  })

  it('offers page and PDF views, but not spread', async () => {
    const user = userEvent.setup()
    openBook(PDF_BOOK)
    await screen.findByRole('heading', { name: 'Core Rules' })
    expect(await modesOnOffer(user)).toEqual(['Page', 'PDF'])
    await user.click(screen.getByRole('menuitemradio', { name: 'PDF' }))
    expect(await screen.findByTestId('in-app-pdf')).toBeInTheDocument()
  })
})

describe('ReaderView — unsaved annotations', () => {
  beforeEach(() => {
    mockEmbeds.value = false
  })

  it('asks before Back throws them away, and stays if told to', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    openBook(PDF_BOOK, 'pdf')
    await user.click(await screen.findByRole('button', { name: 'annotate' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(confirm).toHaveBeenCalledWith(
      "Your annotations haven't been saved and will be lost. Leave anyway?"
    )
    expect(mockNavigate).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(mockNavigate).toHaveBeenCalled()
  })

  it('asks before switching view mode throws them away', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    openBook(PDF_BOOK, 'pdf')
    await user.click(await screen.findByRole('button', { name: 'annotate' }))
    await modesOnOffer(user)
    await user.click(screen.getByRole('menuitemradio', { name: 'Page' }))
    expect(confirm).toHaveBeenCalled()
    expect(screen.getByTestId('in-app-pdf')).toBeInTheDocument()

    confirm.mockReturnValue(true)
    await modesOnOffer(user)
    await user.click(screen.getByRole('menuitemradio', { name: 'Page' }))
    expect(screen.queryByTestId('in-app-pdf')).not.toBeInTheDocument()
  })

  it('leaves without asking when there is nothing to lose', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm')
    openBook(PDF_BOOK, 'pdf')
    await screen.findByTestId('in-app-pdf')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(confirm).not.toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenCalled()
  })
})
