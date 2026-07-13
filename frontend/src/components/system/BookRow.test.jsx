import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
    render(<BookRow book={makeBook()} onOpen={() => {}} />)
    expect(screen.getByText("Player's Handbook")).toBeInTheDocument()
  })

  it('renders page count when present', () => {
    render(<BookRow book={makeBook()} onOpen={() => {}} />)
    expect(screen.getByText('320 pages')).toBeInTheDocument()
  })

  it('does not render page count when zero', () => {
    render(<BookRow book={makeBook({ page_count: 0 })} onOpen={() => {}} />)
    expect(screen.queryByText(/pages/)).not.toBeInTheDocument()
  })

  // --- indexed badge ---

  it('shows "Indexed" badge when indexed is true', () => {
    render(<BookRow book={makeBook({ indexed: true })} onOpen={() => {}} />)
    expect(screen.getByText('Indexed')).toBeInTheDocument()
  })

  it('does not show "Indexed" badge when indexed is false', () => {
    render(<BookRow book={makeBook({ indexed: false })} onOpen={() => {}} />)
    expect(screen.queryByText('Indexed')).not.toBeInTheDocument()
  })

  it('does not show "Indexed" badge for image-only PDFs', () => {
    render(
      <BookRow book={makeBook({ indexed: true, index_error: 'image-only' })} onOpen={() => {}} />
    )
    expect(screen.queryByText('Indexed')).not.toBeInTheDocument()
  })

  // --- image-only badge ---

  it('shows "Image Only" badge when indexed and index_error is image-only', () => {
    render(
      <BookRow book={makeBook({ indexed: true, index_error: 'image-only' })} onOpen={() => {}} />
    )
    expect(screen.getByText('Image Only')).toBeInTheDocument()
  })

  it('does not show "Image Only" badge for normally indexed books', () => {
    render(<BookRow book={makeBook({ indexed: true, index_error: '' })} onOpen={() => {}} />)
    expect(screen.queryByText('Image Only')).not.toBeInTheDocument()
  })

  it('"Image Only" badge has the correct tooltip', () => {
    render(
      <BookRow book={makeBook({ indexed: true, index_error: 'image-only' })} onOpen={() => {}} />
    )
    const badge = screen.getByText('Image Only')
    expect(badge.title).toBe('This PDF contains only scanned images — no text layer to search')
  })

  // --- OCR badge ---

  it('shows "OCR" badge when indexed via OCR (index_error is ocr)', () => {
    render(<BookRow book={makeBook({ indexed: true, index_error: 'ocr' })} onOpen={() => {}} />)
    expect(screen.getByText('OCR')).toBeInTheDocument()
  })

  it('does not show the plain "Indexed" badge for OCR-indexed books', () => {
    render(<BookRow book={makeBook({ indexed: true, index_error: 'ocr' })} onOpen={() => {}} />)
    expect(screen.queryByText('Indexed')).not.toBeInTheDocument()
  })

  it('"OCR" badge has the correct tooltip', () => {
    render(<BookRow book={makeBook({ indexed: true, index_error: 'ocr' })} onOpen={() => {}} />)
    expect(screen.getByText('OCR').title).toBe('Full-text indexed via OCR (scanned pages)')
  })

  // --- index_failed badge ---

  it('shows "Index Failed" badge when index_failed is true', () => {
    render(<BookRow book={makeBook({ index_failed: true })} onOpen={() => {}} />)
    expect(screen.getByText('Index Failed')).toBeInTheDocument()
  })

  it('does not show "Index Failed" badge when index_failed is false', () => {
    render(<BookRow book={makeBook({ index_failed: false })} onOpen={() => {}} />)
    expect(screen.queryByText('Index Failed')).not.toBeInTheDocument()
  })

  it('"Index Failed" badge has a tooltip with the error message', () => {
    render(
      <BookRow
        book={makeBook({ index_failed: true, index_error: 'fitz timed out' })}
        onOpen={() => {}}
      />
    )
    const badge = screen.getByText('Index Failed')
    expect(badge.title).toBe('Index failed: fitz timed out')
  })

  it('"Index Failed" badge tooltip falls back gracefully when index_error is empty', () => {
    render(<BookRow book={makeBook({ index_failed: true, index_error: '' })} onOpen={() => {}} />)
    const badge = screen.getByText('Index Failed')
    expect(badge.title).toBe('Index failed')
  })

  it('does not show "Indexed" badge when index_failed is true', () => {
    // A failed book should not be marked indexed
    render(<BookRow book={makeBook({ indexed: false, index_failed: true })} onOpen={() => {}} />)
    expect(screen.queryByText('Indexed')).not.toBeInTheDocument()
    expect(screen.getByText('Index Failed')).toBeInTheDocument()
  })

  // --- is_missing badge ---

  it('shows "Missing" badge when is_missing is true', () => {
    render(<BookRow book={makeBook({ is_missing: true })} onOpen={() => {}} />)
    expect(screen.getByText('Missing')).toBeInTheDocument()
  })

  it('does not show "Missing" badge when is_missing is false', () => {
    render(<BookRow book={makeBook({ is_missing: false })} onOpen={() => {}} />)
    expect(screen.queryByText('Missing')).not.toBeInTheDocument()
  })

  it('"Missing" badge replaces "Indexed" badge', () => {
    render(<BookRow book={makeBook({ is_missing: true, indexed: true })} onOpen={() => {}} />)
    expect(screen.getByText('Missing')).toBeInTheDocument()
    expect(screen.queryByText('Indexed')).not.toBeInTheDocument()
  })

  it('"Missing" badge replaces "Index Failed" badge', () => {
    render(<BookRow book={makeBook({ is_missing: true, index_failed: true })} onOpen={() => {}} />)
    expect(screen.getByText('Missing')).toBeInTheDocument()
    expect(screen.queryByText('Index Failed')).not.toBeInTheDocument()
  })

  // --- explicit badge ---

  it('shows 18+ badge when is_explicit is true', () => {
    render(<BookRow book={makeBook({ is_explicit: true })} onOpen={() => {}} />)
    expect(screen.getByText('18+')).toBeInTheDocument()
  })

  it('does not show 18+ badge when is_explicit is false', () => {
    render(<BookRow book={makeBook({ is_explicit: false })} onOpen={() => {}} />)
    expect(screen.queryByText('18+')).not.toBeInTheDocument()
  })

  // --- download button ---

  it('renders a download link pointing at the book file', () => {
    render(<BookRow book={makeBook({ id: 'book-42' })} onOpen={() => {}} />)
    const link = screen.getByRole('link', { name: /download/i })
    expect(link).toHaveAttribute('href', 'http://localhost/books/book-42/file')
    expect(link).toHaveAttribute('download')
  })

  it('does not render the download link in bulk mode', () => {
    render(<BookRow book={makeBook()} onOpen={() => {}} bulkMode onToggle={() => {}} />)
    expect(screen.queryByRole('link', { name: /download/i })).not.toBeInTheDocument()
  })

  // --- card variant ---

  it('renders the edit button in the card body when card view is active', () => {
    render(<BookRow book={makeBook()} onOpen={() => {}} onEdit={() => {}} card />)
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
    // The download + favorite actions are overlaid on the thumbnail (like maps/tokens).
    expect(screen.getByRole('link', { name: /download/i })).toBeInTheDocument()
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

  it('clicking an archive downloads it instead of opening the reader', () => {
    const onOpen = vi.fn()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<BookRow book={archiveBook()} onOpen={onOpen} />)

    fireEvent.click(screen.getByRole('button', { name: /open lancer bundle/i }))

    expect(onOpen).not.toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  it('clicking a normal (pdf) book opens the reader', () => {
    const onOpen = vi.fn()
    render(<BookRow book={makeBook({ mime_type: 'application/pdf' })} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /open player's handbook/i }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('clicking an archive in card view downloads it', () => {
    const onOpen = vi.fn()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<BookRow book={archiveBook()} onOpen={onOpen} card />)
    fireEvent.click(screen.getByRole('button', { name: /open lancer bundle/i }))
    expect(onOpen).not.toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  // --- grid layouts (card / compact) ---

  it('renders a thumbnail image in card view when has_thumbnail is set', () => {
    render(<BookRow book={makeBook({ id: 'b9', has_thumbnail: true })} onOpen={() => {}} card />)
    const img = document.querySelector('img')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toContain('/books/b9/thumbnail')
  })

  it('renders in compact view with the title visible', () => {
    render(<BookRow book={makeBook()} onOpen={() => {}} compact />)
    expect(screen.getByText("Player's Handbook")).toBeInTheDocument()
  })

  it('keyboard Enter triggers open in card view', () => {
    const onOpen = vi.fn()
    render(<BookRow book={makeBook({ mime_type: 'application/pdf' })} onOpen={onOpen} card />)
    fireEvent.keyDown(screen.getByRole('button', { name: /open player's handbook/i }), {
      key: 'Enter',
    })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('card view shows the selection checkbox and toggles in bulk mode', () => {
    const onToggle = vi.fn()
    render(
      <BookRow
        book={makeBook()}
        onOpen={() => {}}
        card
        bulkMode
        selected={false}
        onToggle={onToggle}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /open player's handbook/i }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('shows the reading-progress marker in the list layout', () => {
    mockGetBookPrefs.mockReturnValueOnce({ page: 160 })
    render(<BookRow book={makeBook({ page_count: 320 })} onOpen={() => {}} />)
    expect(screen.getByText('p. 160')).toBeInTheDocument()
  })

  it('renders the progress bar in card view when partway through', () => {
    mockGetBookPrefs.mockReturnValueOnce({ page: 80 })
    render(<BookRow book={makeBook({ page_count: 320 })} onOpen={() => {}} card />)
    // The card still renders its title alongside the progress bar.
    expect(screen.getByText("Player's Handbook")).toBeInTheDocument()
  })

  it('reveals row actions on hover (mouse enter/leave)', () => {
    render(<BookRow book={makeBook()} onOpen={() => {}} />)
    const row = screen.getByRole('button', { name: /open player's handbook/i })
    fireEvent.mouseEnter(row)
    fireEvent.mouseOver(row)
    fireEvent.mouseOut(row)
    fireEvent.mouseLeave(row)
    expect(row).toBeInTheDocument()
  })

  it('Space key opens a normal book', () => {
    const onOpen = vi.fn()
    render(<BookRow book={makeBook({ mime_type: 'application/pdf' })} onOpen={onOpen} />)
    fireEvent.keyDown(screen.getByRole('button', { name: /open player's handbook/i }), {
      key: ' ',
    })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('renders the compact layout with a progress bar', () => {
    mockGetBookPrefs.mockReturnValueOnce({ page: 40 })
    render(
      <BookRow
        book={makeBook({ page_count: 320, has_thumbnail: true })}
        onOpen={() => {}}
        compact
      />
    )
    expect(screen.getByText("Player's Handbook")).toBeInTheDocument()
  })

  it('archive without a filename still triggers a download click', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<BookRow book={archiveBook({ filename: undefined })} onOpen={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /open lancer bundle/i }))
    expect(clickSpy).toHaveBeenCalled()
    clickSpy.mockRestore()
  })

  // --- inline actions (favorite / edit / download click) ---

  it('clicking the favorite button toggles favorite and stops propagation', () => {
    const toggleFavorite = vi.fn()
    FavCtx.useFavorites.mockReturnValue({ isFavorite: () => false, toggleFavorite })
    const onOpen = vi.fn()
    render(<BookRow book={makeBook()} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /add to favorites/i }))
    expect(toggleFavorite).toHaveBeenCalledWith('book', 'book-1')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('clicking the download link does not open the book', () => {
    const onOpen = vi.fn()
    render(<BookRow book={makeBook()} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('link', { name: /download/i }))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('clicking edit in the list layout calls onEdit and not onOpen', () => {
    const onEdit = vi.fn()
    const onOpen = vi.fn()
    render(<BookRow book={makeBook()} onOpen={onOpen} onEdit={onEdit} />)
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('clicking edit in card view calls onEdit and not onOpen', () => {
    const onEdit = vi.fn()
    const onOpen = vi.fn()
    render(<BookRow book={makeBook()} onOpen={onOpen} onEdit={onEdit} card />)
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('renders book tags in the list layout', () => {
    render(<BookRow book={makeBook({ tags: ['official', 'errata'] })} onOpen={() => {}} />)
    expect(screen.getByText('Official')).toBeInTheDocument()
    expect(screen.getByText('Errata')).toBeInTheDocument()
  })
})
