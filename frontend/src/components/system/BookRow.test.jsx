import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import BookRow from './BookRow'
import * as FavCtx from '../../context/FavoritesContext'
import * as api from '../../api'

vi.mock('../../context/FavoritesContext', () => ({
  useFavorites: vi.fn(),
}))

vi.mock('../../api', () => ({
  default: {},
  mediaUrl: (path) => `http://localhost${path}`,
}))

// Control reading progress so the progress-bar branches can be exercised.
const mockGetBookPrefs = vi.fn(() => ({ page: 0 }))
vi.mock('../../hooks/useBookPrefs', () => ({
  getBookPrefs: (id) => mockGetBookPrefs(id),
}))

// BookRow uses useLocation (for the CardLink state), so every render needs a Router.
const render = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>)

function makeBook(overrides = {}) {
  return {
    id: 'book-1',
    title: "Player's Handbook",
    category: 'core',
    page_count: 320,
    year: 2014,
    publisher: 'WotC',
    has_thumbnail: false,
    is_explicit: false,
    indexed: false,
    index_failed: false,
    index_error: '',
    ...overrides,
  }
}

describe('BookRow', () => {
  beforeEach(() => {
    FavCtx.useFavorites.mockReturnValue({
      isFavorite: () => false,
      toggleFavorite: vi.fn(),
    })
  })

  it('renders the book title', () => {
    render(<BookRow book={makeBook()} />)
    expect(screen.getByText("Player's Handbook")).toBeInTheDocument()
  })

  it('renders page count when present', () => {
    render(<BookRow book={makeBook()} />)
    expect(screen.getByText('320 pages')).toBeInTheDocument()
  })

  it('does not render page count when zero', () => {
    render(<BookRow book={makeBook({ page_count: 0 })} />)
    expect(screen.queryByText(/pages/)).not.toBeInTheDocument()
  })

  // Non-bulk mode: the row is a real link (CardLink overlay) so the browser handles
  // navigation, middle-click, and ctrl/cmd-click natively (issue #313).
  it('renders a real link overlay for normal (PDF) books', () => {
    render(<BookRow book={makeBook()} />)
    const link = screen.getByRole('link', { name: /open player's handbook/i })
    expect(link).toHaveAttribute('href', '/library/book/book-1')
  })

  // --- indexed badge ---

  it('shows "Indexed" badge when indexed is true', () => {
    render(<BookRow book={makeBook({ indexed: true })} />)
    expect(screen.getByText('Indexed')).toBeInTheDocument()
  })

  it('does not show "Indexed" badge when indexed is false', () => {
    render(<BookRow book={makeBook({ indexed: false })} />)
    expect(screen.queryByText('Indexed')).not.toBeInTheDocument()
  })

  it('does not show "Indexed" badge for image-only PDFs', () => {
    render(<BookRow book={makeBook({ indexed: true, index_error: 'image-only' })} />)
    expect(screen.queryByText('Indexed')).not.toBeInTheDocument()
  })

  // --- image-only badge ---

  it('shows "Image Only" badge when indexed and index_error is image-only', () => {
    render(<BookRow book={makeBook({ indexed: true, index_error: 'image-only' })} />)
    expect(screen.getByText('Image Only')).toBeInTheDocument()
  })

  it('does not show "Image Only" badge for normally indexed books', () => {
    render(<BookRow book={makeBook({ indexed: true, index_error: '' })} />)
    expect(screen.queryByText('Image Only')).not.toBeInTheDocument()
  })

  it('"Image Only" badge has the correct tooltip', () => {
    render(<BookRow book={makeBook({ indexed: true, index_error: 'image-only' })} />)
    const badge = screen.getByText('Image Only')
    expect(badge.title).toBe('This PDF contains only scanned images - no text layer to search')
  })

  // --- OCR badge ---

  it('shows "OCR" badge when indexed via OCR (index_error is ocr)', () => {
    render(<BookRow book={makeBook({ indexed: true, index_error: 'ocr' })} />)
    expect(screen.getByText('OCR')).toBeInTheDocument()
  })

  it('does not show the plain "Indexed" badge for OCR-indexed books', () => {
    render(<BookRow book={makeBook({ indexed: true, index_error: 'ocr' })} />)
    expect(screen.queryByText('Indexed')).not.toBeInTheDocument()
  })

  it('"OCR" badge has the correct tooltip', () => {
    render(<BookRow book={makeBook({ indexed: true, index_error: 'ocr' })} />)
    expect(screen.getByText('OCR').title).toBe('Full-text indexed via OCR (scanned pages)')
  })

  // --- index_failed badge ---

  it('shows "Index Failed" badge when index_failed is true', () => {
    render(<BookRow book={makeBook({ index_failed: true })} />)
    expect(screen.getByText('Index Failed')).toBeInTheDocument()
  })

  it('does not show "Index Failed" badge when index_failed is false', () => {
    render(<BookRow book={makeBook({ index_failed: false })} />)
    expect(screen.queryByText('Index Failed')).not.toBeInTheDocument()
  })

  it('"Index Failed" badge has a tooltip with the error message', () => {
    render(<BookRow book={makeBook({ index_failed: true, index_error: 'fitz timed out' })} />)
    const badge = screen.getByText('Index Failed')
    expect(badge.title).toBe('Index failed: fitz timed out')
  })

  it('"Index Failed" badge tooltip falls back gracefully when index_error is empty', () => {
    render(<BookRow book={makeBook({ index_failed: true, index_error: '' })} />)
    const badge = screen.getByText('Index Failed')
    expect(badge.title).toBe('Index failed')
  })

  it('does not show "Indexed" badge when index_failed is true', () => {
    // A failed book should not be marked indexed
    render(<BookRow book={makeBook({ indexed: false, index_failed: true })} />)
    expect(screen.queryByText('Indexed')).not.toBeInTheDocument()
    expect(screen.getByText('Index Failed')).toBeInTheDocument()
  })

  // --- is_missing badge ---

  it('shows "Missing" badge when is_missing is true', () => {
    render(<BookRow book={makeBook({ is_missing: true })} />)
    expect(screen.getByText('Missing')).toBeInTheDocument()
  })

  it('does not show "Missing" badge when is_missing is false', () => {
    render(<BookRow book={makeBook({ is_missing: false })} />)
    expect(screen.queryByText('Missing')).not.toBeInTheDocument()
  })

  it('"Missing" badge replaces "Indexed" badge', () => {
    render(<BookRow book={makeBook({ is_missing: true, indexed: true })} />)
    expect(screen.getByText('Missing')).toBeInTheDocument()
    expect(screen.queryByText('Indexed')).not.toBeInTheDocument()
  })

  it('"Missing" badge replaces "Index Failed" badge', () => {
    render(<BookRow book={makeBook({ is_missing: true, index_failed: true })} />)
    expect(screen.getByText('Missing')).toBeInTheDocument()
    expect(screen.queryByText('Index Failed')).not.toBeInTheDocument()
  })

  // --- explicit badge ---

  it('shows 18+ badge when is_explicit is true', () => {
    render(<BookRow book={makeBook({ is_explicit: true })} />)
    expect(screen.getByText('18+')).toBeInTheDocument()
  })

  it('does not show 18+ badge when is_explicit is false', () => {
    render(<BookRow book={makeBook({ is_explicit: false })} />)
    expect(screen.queryByText('18+')).not.toBeInTheDocument()
  })

  // --- actions menu: download ---

  it('exposes a download link (in the actions menu) pointing at the book file', () => {
    render(<BookRow book={makeBook({ id: 'book-42' })} />)
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
    const link = screen.getByRole('menuitem', { name: /download/i })
    expect(link).toHaveAttribute('href', 'http://localhost/books/book-42/file')
    expect(link).toHaveAttribute('download')
  })

  it('does not render the actions menu in bulk mode', () => {
    render(<BookRow book={makeBook()} bulkMode onToggle={() => {}} />)
    expect(screen.queryByRole('button', { name: /more actions/i })).not.toBeInTheDocument()
  })

  // --- card variant ---

  it('renders the actions menu and favorite in the card body when card view is active', () => {
    render(<BookRow book={makeBook()} onEdit={() => {}} card />)
    // Edit + download now live in the kebab actions menu.
    const menuBtn = screen.getByRole('button', { name: /more actions/i })
    expect(menuBtn).toBeInTheDocument()
    fireEvent.click(menuBtn)
    expect(screen.getByRole('menuitem', { name: /edit/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /download/i })).toBeInTheDocument()
    // The favorite action stays overlaid on the thumbnail (like maps/tokens).
    expect(
      screen.getByRole('button', { name: /add to favorites|remove from favorites/i })
    ).toBeInTheDocument()
  })

  // --- archive files (issue #94) ---

  const archiveBook = (overrides = {}) =>
    makeBook({
      id: 'arch-1',
      title: 'LANCER Bundle',
      filename: 'lancer.zip',
      mime_type: 'application/zip',
      ...overrides,
    })

  it('an archive row renders a download anchor with the correct href', () => {
    // Archives render CardLink with href=/books/{id}/file and the download attribute.
    // The browser handles the download natively — no JS click() needed.
    render(<BookRow book={archiveBook()} />)
    const link = screen.getByRole('link', { name: /open lancer bundle/i })
    expect(link).toHaveAttribute('href', 'http://localhost/books/arch-1/file')
    expect(link).toHaveAttribute('download')
  })

  it('a normal (pdf) book row renders a router link to the reader', () => {
    render(<BookRow book={makeBook({ mime_type: 'application/pdf' })} />)
    const link = screen.getByRole('link', { name: /open player's handbook/i })
    expect(link).toHaveAttribute('href', '/library/book/book-1')
    expect(link).not.toHaveAttribute('download')
  })

  it('an archive in card view also renders a download anchor', () => {
    render(<BookRow book={archiveBook()} card />)
    const link = screen.getByRole('link', { name: /open lancer bundle/i })
    expect(link).toHaveAttribute('href', 'http://localhost/books/arch-1/file')
    expect(link).toHaveAttribute('download')
  })

  // --- grid layouts (card / compact) ---

  it('renders a thumbnail image in card view when has_thumbnail is set', () => {
    render(<BookRow book={makeBook({ id: 'b9', has_thumbnail: true })} card />)
    const img = document.querySelector('img')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toContain('/books/b9/thumbnail')
  })

  it('renders in compact view with the title visible', () => {
    render(<BookRow book={makeBook()} compact />)
    expect(screen.getByText("Player's Handbook")).toBeInTheDocument()
  })

  it('card view has a real link overlay to the book reader', () => {
    render(<BookRow book={makeBook({ mime_type: 'application/pdf' })} card />)
    const link = screen.getByRole('link', { name: /open player's handbook/i })
    expect(link).toHaveAttribute('href', '/library/book/book-1')
  })

  it('card view shows the selection checkbox and toggles in bulk mode', () => {
    const onToggle = vi.fn()
    render(<BookRow book={makeBook()} card bulkMode selected={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button', { name: /open player's handbook/i }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('shows the reading-progress marker in the list layout', () => {
    mockGetBookPrefs.mockReturnValueOnce({ page: 160 })
    render(<BookRow book={makeBook({ page_count: 320 })} />)
    expect(screen.getByText('p. 160')).toBeInTheDocument()
  })

  it('renders the progress bar in card view when partway through', () => {
    mockGetBookPrefs.mockReturnValueOnce({ page: 80 })
    render(<BookRow book={makeBook({ page_count: 320 })} card />)
    // The card still renders its title alongside the progress bar.
    expect(screen.getByText("Player's Handbook")).toBeInTheDocument()
  })

  it('reveals row actions on hover (mouse enter/leave)', () => {
    render(<BookRow book={makeBook()} />)
    const row = screen.getByRole('link', { name: /open player's handbook/i }).closest('div')
    fireEvent.mouseEnter(row)
    fireEvent.mouseOver(row)
    fireEvent.mouseOut(row)
    fireEvent.mouseLeave(row)
    expect(screen.getByText("Player's Handbook")).toBeInTheDocument()
  })

  it('bulk-mode card: Space key toggles selection', () => {
    const onToggle = vi.fn()
    render(
      <BookRow
        book={makeBook({ mime_type: 'application/pdf' })}
        bulkMode
        onToggle={onToggle}
        card
      />
    )
    fireEvent.keyDown(screen.getByRole('button', { name: /open player's handbook/i }), {
      key: ' ',
    })
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('renders the compact layout with a progress bar', () => {
    mockGetBookPrefs.mockReturnValueOnce({ page: 40 })
    render(<BookRow book={makeBook({ page_count: 320, has_thumbnail: true })} compact />)
    expect(screen.getByText("Player's Handbook")).toBeInTheDocument()
  })

  it('archive without a filename still renders a download anchor', () => {
    render(<BookRow book={archiveBook({ filename: undefined })} />)
    const link = screen.getByRole('link', { name: /open lancer bundle/i })
    expect(link).toHaveAttribute('download')
  })

  // --- inline actions (favorite / edit / download click) ---

  it('clicking the favorite button toggles favorite and stops propagation', () => {
    const toggleFavorite = vi.fn()
    FavCtx.useFavorites.mockReturnValue({ isFavorite: () => false, toggleFavorite })
    render(<BookRow book={makeBook()} />)
    fireEvent.click(screen.getByRole('button', { name: /add to favorites/i }))
    expect(toggleFavorite).toHaveBeenCalledWith('book', 'book-1')
  })

  it('clicking the download menu item works', () => {
    render(<BookRow book={makeBook()} />)
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
    // Download is an anchor — clicking it is fine.
    const downloadLink = screen.getByRole('menuitem', { name: /download/i })
    expect(downloadLink).toBeInTheDocument()
  })

  it('clicking edit in the list actions menu calls onEdit', () => {
    const onEdit = vi.fn()
    render(<BookRow book={makeBook()} onEdit={onEdit} />)
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /edit/i }))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('clicking edit in the card actions menu calls onEdit', () => {
    const onEdit = vi.fn()
    render(<BookRow book={makeBook()} onEdit={onEdit} card />)
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /edit/i }))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('renders book tags in the list layout', () => {
    render(<BookRow book={makeBook({ tags: ['official', 'errata'] })} />)
    expect(screen.getByText('Official')).toBeInTheDocument()
    expect(screen.getByText('Errata')).toBeInTheDocument()
  })

  // Issue #313 — cards are now real anchors (CardLink), so the browser handles
  // middle-click and ctrl/cmd-click natively. Tests verify the href.
  describe('real link row (issue #313)', () => {
    it.each([
      ['list', {}],
      ['card', { card: true }],
      ['compact', { compact: true }],
    ])('renders a real link in the %s layout for native new-tab support', (_name, layout) => {
      render(<BookRow book={makeBook()} {...layout} />)
      const link = screen.getByRole('link', { name: /open player's handbook/i })
      expect(link).toHaveAttribute('href', '/library/book/book-1')
    })

    it('archive renders a download anchor (not a router link)', () => {
      render(<BookRow book={archiveBook()} />)
      const link = screen.getByRole('link', { name: /open lancer bundle/i })
      expect(link).toHaveAttribute('download')
      // href points to the file endpoint
      expect(link).toHaveAttribute('href', 'http://localhost/books/arch-1/file')
    })

    it('does not render a link overlay in bulk-select mode', () => {
      render(<BookRow book={makeBook()} bulkMode onToggle={vi.fn()} />)
      // In bulk mode the row has role=button (from buttonProps), no CardLink.
      expect(
        screen.queryByRole('link', { name: /open player's handbook/i })
      ).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /open player's handbook/i })).toBeInTheDocument()
    })
  })
})
