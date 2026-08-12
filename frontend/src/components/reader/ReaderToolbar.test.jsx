import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ReaderToolbar from './ReaderToolbar'

vi.mock('../AddToCampaignModal', () => ({ default: () => null }))
vi.mock('../../context/UISettingsContext', () => ({ useUISettings: () => ({}) }))

/** Opens the overflow menu, where the less-frequent actions now live. */
async function openMoreMenu() {
  await userEvent.click(screen.getByLabelText('More actions'))
}

const BOOK_PDF = {
  id: 'book-1',
  title: 'Test Book',
  page_count: 100,
  mime_type: 'application/pdf',
  indexed: true,
}

function defaultProps(overrides = {}) {
  return {
    book: BOOK_PDF,
    bookId: 'book-1',
    mode: 'page',
    onModeChange: vi.fn(),
    spreadOffset: 0, // 0 = cover stands alone; 1 = cover pairs with page 2

    onSpreadOffsetChange: vi.fn(),
    currentPage: 1,
    totalPages: 100,
    step: 1,
    hasRight: false,
    rightPage: 2,
    pageInput: '1',
    onPageInputChange: vi.fn(),
    onPageInputCommit: vi.fn(),
    panel: null,
    onTogglePanel: vi.fn(),
    isMobilePhone: false,
    showShortcuts: false,
    onToggleShortcuts: vi.fn(),
    onBack: vi.fn(),
    isFavorite: false,
    onToggleFavorite: vi.fn(),
    onBookmarkPage: vi.fn(),
    onShowDetails: vi.fn(),
    zoom: 1,
    canZoomIn: true,
    canZoomOut: false,
    isZoomed: false,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onResetZoom: vi.fn(),
    ...overrides,
  }
}

function renderToolbar(overrides = {}) {
  return render(
    <MemoryRouter>
      <ReaderToolbar {...defaultProps(overrides)} />
    </MemoryRouter>
  )
}

describe('ReaderToolbar — navigation', () => {
  it('renders the book title', () => {
    renderToolbar()
    expect(screen.getByText('Test Book')).toBeInTheDocument()
  })

  it('calls onBack when back button is clicked', async () => {
    const onBack = vi.fn()
    renderToolbar({ onBack })
    await userEvent.click(screen.getByLabelText('Back'))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('calls onPageInputCommit with next page when next-page button is clicked', async () => {
    const onPageInputCommit = vi.fn()
    renderToolbar({ onPageInputCommit, currentPage: 4, step: 1 })
    await userEvent.click(screen.getByLabelText('Next page'))
    expect(onPageInputCommit).toHaveBeenCalledWith(5)
  })

  it('calls onPageInputCommit with previous page when prev-page button is clicked', async () => {
    const onPageInputCommit = vi.fn()
    renderToolbar({ onPageInputCommit, currentPage: 4, step: 1 })
    await userEvent.click(screen.getByLabelText('Previous page'))
    expect(onPageInputCommit).toHaveBeenCalledWith(3)
  })

  it('previous-page button is disabled on page 1', () => {
    renderToolbar({ currentPage: 1 })
    expect(screen.getByLabelText('Previous page')).toBeDisabled()
  })

  it('next-page button is disabled on last page', () => {
    renderToolbar({ currentPage: 100, totalPages: 100 })
    expect(screen.getByLabelText('Next page')).toBeDisabled()
  })
})

describe('ReaderToolbar — mode toggle', () => {
  it('marks the active mode in the overflow menu', async () => {
    renderToolbar({ mode: 'spread' })
    await openMoreMenu()
    expect(screen.getByRole('menuitemradio', { name: /Spread/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('calls onModeChange when a mode item is clicked', async () => {
    const onModeChange = vi.fn()
    renderToolbar({ onModeChange })
    await openMoreMenu()
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Spread/ }))
    expect(onModeChange).toHaveBeenCalledWith('spread')
  })

  it('omits the mode items on mobile, where the reader is single-page only', async () => {
    renderToolbar({ isMobilePhone: true })
    await openMoreMenu()
    expect(screen.queryByRole('menuitemradio', { name: /Spread/ })).not.toBeInTheDocument()
  })
})

describe('ReaderToolbar — spread offset', () => {
  it('keeps the cover pairing out of the toolbar itself', () => {
    renderToolbar({ mode: 'spread' })
    expect(screen.queryByText('Pair cover with page 2')).not.toBeInTheDocument()
  })

  it('offers cover pairing in the overflow menu in spread mode', async () => {
    renderToolbar({ mode: 'spread' })
    await openMoreMenu()
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Pair cover with page 2' })
    ).toBeInTheDocument()
  })

  it('omits cover pairing in page mode, where it does not apply', async () => {
    renderToolbar({ mode: 'page' })
    await openMoreMenu()
    expect(screen.queryByRole('menuitemcheckbox')).not.toBeInTheDocument()
  })

  it('calls onSpreadOffsetChange(1) when cover pairing is turned on', async () => {
    const onSpreadOffsetChange = vi.fn()
    renderToolbar({ mode: 'spread', spreadOffset: 0, onSpreadOffsetChange })
    await openMoreMenu()
    await userEvent.click(screen.getByRole('menuitemcheckbox'))
    expect(onSpreadOffsetChange).toHaveBeenCalledWith(1)
  })

  it('calls onSpreadOffsetChange(0) when cover pairing is turned off', async () => {
    const onSpreadOffsetChange = vi.fn()
    renderToolbar({ mode: 'spread', spreadOffset: 1, onSpreadOffsetChange })
    await openMoreMenu()
    await userEvent.click(screen.getByRole('menuitemcheckbox'))
    expect(onSpreadOffsetChange).toHaveBeenCalledWith(0)
  })

  it('shows right page number when hasRight is true in spread mode', () => {
    renderToolbar({ mode: 'spread', hasRight: true, currentPage: 2, rightPage: 3 })
    expect(screen.getByText('– 3')).toBeInTheDocument()
  })
})

describe('ReaderToolbar — panel selector', () => {
  it('shows Contents, Bookmarks, and Search for an indexed PDF', () => {
    renderToolbar()
    expect(screen.getByTitle('Contents')).toBeInTheDocument()
    expect(screen.getByTitle('Bookmarks')).toBeInTheDocument()
    expect(screen.getByTitle('Search')).toBeInTheDocument()
  })

  it('hides Contents in PDF mode', () => {
    renderToolbar({ mode: 'pdf' })
    expect(screen.queryByTitle('Contents')).not.toBeInTheDocument()
  })

  it('calls onTogglePanel when a panel button is clicked', async () => {
    const onTogglePanel = vi.fn()
    renderToolbar({ onTogglePanel })
    await userEvent.click(screen.getByTitle('Contents'))
    expect(onTogglePanel).toHaveBeenCalledWith('toc')
  })

  it('highlights the active panel button', () => {
    renderToolbar({ panel: 'toc' })
    expect(screen.getByTitle('Contents')).toHaveStyle({ color: 'var(--gold)' })
  })
})

describe('ReaderToolbar — actions', () => {
  it('calls onToggleFavorite from the overflow menu', async () => {
    const onToggleFavorite = vi.fn()
    renderToolbar({ onToggleFavorite })
    await openMoreMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add to favorites' }))
    expect(onToggleFavorite).toHaveBeenCalledOnce()
  })

  it('offers to remove the favorite when already favorited', async () => {
    renderToolbar({ isFavorite: true })
    await openMoreMenu()
    expect(screen.getByRole('menuitem', { name: 'Remove from favorites' })).toBeInTheDocument()
  })

  it('calls onShowDetails from the overflow menu', async () => {
    const onShowDetails = vi.fn()
    renderToolbar({ onShowDetails })
    await openMoreMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'View details' }))
    expect(onShowDetails).toHaveBeenCalledOnce()
  })

  it('offers a download link in the overflow menu', async () => {
    renderToolbar()
    await openMoreMenu()
    expect(screen.getByRole('menuitem', { name: 'Download' })).toHaveAttribute('download')
  })

  it('calls onBookmarkPage when bookmark button is clicked', async () => {
    const onBookmarkPage = vi.fn()
    renderToolbar({ onBookmarkPage })
    await userEvent.click(screen.getByTitle('Bookmark this page'))
    expect(onBookmarkPage).toHaveBeenCalledOnce()
  })

  it('hides bookmark button in PDF mode', () => {
    renderToolbar({ mode: 'pdf' })
    expect(screen.queryByTitle('Bookmark this page')).not.toBeInTheDocument()
  })

  it('calls onToggleShortcuts from the overflow menu', async () => {
    const onToggleShortcuts = vi.fn()
    renderToolbar({ onToggleShortcuts })
    await openMoreMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Keyboard Shortcuts' }))
    expect(onToggleShortcuts).toHaveBeenCalledOnce()
  })

  it('shows the shortcuts modal when showShortcuts is true', () => {
    renderToolbar({ showShortcuts: true })
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
  })

  it('calls onToggleShortcuts when the shortcuts backdrop is clicked', async () => {
    const onToggleShortcuts = vi.fn()
    renderToolbar({ showShortcuts: true, onToggleShortcuts })
    // The backdrop div contains the modal — click outside the inner card.
    const backdrop = screen.getByText('Keyboard Shortcuts').closest('[style*="inset"]')
    await userEvent.click(backdrop)
    expect(onToggleShortcuts).toHaveBeenCalledOnce()
  })
})

describe('ReaderToolbar — zoom controls', () => {
  it('shows the current zoom level and fires the zoom callbacks', async () => {
    const onZoomIn = vi.fn()
    const onZoomOut = vi.fn()
    renderToolbar({ zoom: 1.5, canZoomIn: true, canZoomOut: true, onZoomIn, onZoomOut })

    expect(screen.getByText('150%')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Zoom in'))
    expect(onZoomIn).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByLabelText('Zoom out'))
    expect(onZoomOut).toHaveBeenCalledOnce()
  })

  it('disables each button at its clamp bound', () => {
    renderToolbar({ zoom: 1, canZoomIn: true, canZoomOut: false })
    expect(screen.getByLabelText('Zoom out')).toBeDisabled()
    expect(screen.getByLabelText('Zoom in')).not.toBeDisabled()

    renderToolbar({ zoom: 2, canZoomIn: false, canZoomOut: true })
    expect(screen.getAllByLabelText('Zoom in').at(-1)).toBeDisabled()
  })

  it('offers reset only once zoomed', async () => {
    const onResetZoom = vi.fn()
    renderToolbar({ isZoomed: false })
    expect(screen.queryByLabelText('Reset zoom')).not.toBeInTheDocument()

    renderToolbar({ zoom: 1.75, isZoomed: true, canZoomOut: true, onResetZoom })
    await userEvent.click(screen.getByLabelText('Reset zoom'))
    expect(onResetZoom).toHaveBeenCalledOnce()
  })

  it('hides the cluster in pdf mode, where the native viewer zooms itself', () => {
    renderToolbar({ mode: 'pdf' })
    expect(screen.queryByLabelText('Zoom in')).not.toBeInTheDocument()
    expect(screen.queryByText('100%')).not.toBeInTheDocument()
  })

  it('hides the cluster on phones, where pinch-to-zoom already works', () => {
    renderToolbar({ isMobilePhone: true })
    expect(screen.queryByLabelText('Zoom in')).not.toBeInTheDocument()
  })

  it('lists the zoom shortcuts in the overlay', () => {
    renderToolbar({ showShortcuts: true })
    // Testing Library collapses the padding spaces in the key label.
    expect(screen.getByText('+ / -')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('omits the zoom shortcuts in pdf mode', () => {
    renderToolbar({ showShortcuts: true, mode: 'pdf' })
    expect(screen.queryByText('+ / -')).not.toBeInTheDocument()
  })
})

describe('ReaderToolbar — page input', () => {
  it('reports each keystroke in the page box', async () => {
    const onPageInputChange = vi.fn()
    renderToolbar({ onPageInputChange, pageInput: '' })
    await userEvent.type(screen.getByLabelText('Current page number'), '7')
    expect(onPageInputChange).toHaveBeenCalledWith('7')
  })

  it('commits the typed page on Enter', async () => {
    const onPageInputCommit = vi.fn()
    renderToolbar({ onPageInputCommit, pageInput: '42' })
    const input = screen.getByLabelText('Current page number')
    await userEvent.type(input, '{Enter}')
    expect(onPageInputCommit).toHaveBeenCalledWith(42)
  })

  it('commits on blur too, so clicking away is not lost', async () => {
    const onPageInputCommit = vi.fn()
    renderToolbar({ onPageInputCommit, pageInput: '13' })
    const input = screen.getByLabelText('Current page number')
    await userEvent.click(input)
    await userEvent.tab()
    expect(onPageInputCommit).toHaveBeenCalledWith(13)
  })

  it('falls back to page 1 when the box holds no number', async () => {
    const onPageInputCommit = vi.fn()
    renderToolbar({ onPageInputCommit, pageInput: 'abc' })
    await userEvent.type(screen.getByLabelText('Current page number'), '{Enter}')
    expect(onPageInputCommit).toHaveBeenCalledWith(1)
  })

  it('keeps the shortcuts modal open when the card itself is clicked', async () => {
    const onToggleShortcuts = vi.fn()
    renderToolbar({ showShortcuts: true, onToggleShortcuts })
    await userEvent.click(screen.getByText('Keyboard Shortcuts'))
    expect(onToggleShortcuts).not.toHaveBeenCalled()
  })
})
