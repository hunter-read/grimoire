import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BookActionsMenu from './BookActionsMenu'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

const mockPost = vi.fn(() => Promise.resolve({}))
const mockGet = vi.fn(() => Promise.resolve({}))
const mockCampaignList = vi.fn(() => Promise.resolve([]))
vi.mock('../../api', () => ({
  default: { post: (...args) => mockPost(...args), get: (...args) => mockGet(...args) },
  mediaUrl: (path) => `http://localhost${path}`,
  // Used by AddToCampaignModal, which the "add to campaign" item opens.
  campaigns: {
    list: (...args) => mockCampaignList(...args),
    bulkAddResources: vi.fn(() => Promise.resolve([])),
  },
}))

let mockHideCampaigns = false
// The file-action group is gated on both of these, so tests drive them.
let mockLibraryWritable = false
let mockRole = 'gm'
vi.mock('../../context/UISettingsContext', () => ({
  useUISettings: () => ({
    hide_campaigns: mockHideCampaigns,
    library_writable: mockLibraryWritable,
  }),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: mockRole } }),
}))

// Reading progress is per-user browser state; mocked so the reset item's
// visibility is driven by the test rather than by leftover localStorage.
const mockGetBookPrefs = vi.fn(() => ({}))
const mockSaveBookPrefs = vi.fn()
vi.mock('../../hooks/useBookPrefs', () => ({
  getBookPrefs: (...args) => mockGetBookPrefs(...args),
  saveBookPrefs: (...args) => mockSaveBookPrefs(...args),
}))

function makeBook(overrides = {}) {
  return {
    id: 'b1',
    mime_type: 'application/pdf',
    index_error: '',
    indexed: true,
    index_failed: false,
    ...overrides,
  }
}

function renderMenu(book = {}, props = {}) {
  return render(<BookActionsMenu book={makeBook(book)} onEdit={() => {}} {...props} />)
}

describe('BookActionsMenu', () => {
  beforeEach(() => {
    mockPost.mockClear()
    mockPost.mockResolvedValue({})
    mockCampaignList.mockClear()
    mockCampaignList.mockResolvedValue([])
    mockHideCampaigns = false
    mockLibraryWritable = false
    mockRole = 'gm'
    mockGetBookPrefs.mockReturnValue({})
    mockSaveBookPrefs.mockClear()
  })

  it('is collapsed until the trigger is clicked', () => {
    renderMenu()
    expect(screen.queryByRole('menuitem', { name: 'bookActions.edit' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    expect(screen.getByRole('menuitem', { name: 'bookActions.edit' })).toBeInTheDocument()
  })

  describe('reset reading progress', () => {
    it('is hidden when the book has no saved page', () => {
      renderMenu()
      fireEvent.click(screen.getByLabelText('bookActions.menu'))
      expect(screen.queryByTestId('book-reset-progress')).not.toBeInTheDocument()
    })

    it('clears the saved page and confirms in place', () => {
      mockGetBookPrefs.mockReturnValue({ page: 12 })
      renderMenu({ id: 'book-9' })
      fireEvent.click(screen.getByLabelText('bookActions.menu'))
      fireEvent.click(screen.getByTestId('book-reset-progress'))
      expect(mockSaveBookPrefs).toHaveBeenCalledWith('book-9', { page: null })
      expect(screen.getByTestId('book-reset-progress')).toHaveTextContent(
        'bookActions.progressReset'
      )
    })

    it('is offered to a player, who has no edit rights but owns their progress', () => {
      mockGetBookPrefs.mockReturnValue({ page: 3 })
      mockRole = 'player'
      renderMenu({}, { onEdit: undefined })
      fireEvent.click(screen.getByLabelText('bookActions.menu'))
      expect(screen.queryByRole('menuitem', { name: 'bookActions.edit' })).not.toBeInTheDocument()
      expect(screen.getByTestId('book-reset-progress')).toBeInTheDocument()
    })
  })

  it('portals the menu to document.body so it escapes the row clip', () => {
    const { container } = renderMenu()
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    // The menu renders outside the component subtree (into body).
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(screen.getByRole('menu')).not.toBeNull()
  })

  it('calls onEdit when the edit item is clicked', () => {
    const onEdit = vi.fn()
    renderMenu({}, { onEdit })
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'bookActions.edit' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('exposes a download link to the book file', () => {
    renderMenu({ id: 'b7' })
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    const link = screen.getByRole('menuitem', { name: 'bookActions.download' })
    expect(link).toHaveAttribute('href', 'http://localhost/books/b7/file')
    expect(link).toHaveAttribute('download')
  })

  // --- add to campaign ---

  it('opens the add-to-campaign modal for just this book', async () => {
    mockCampaignList.mockResolvedValue([{ id: 'c1', name: 'Curse of Strahd', owner_id: 'u1' }])
    renderMenu({ id: 'b9' })
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'resources.addToCampaign' }))
    // The modal loads the user's campaigns and offers this one book.
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await waitFor(() => expect(mockCampaignList).toHaveBeenCalled())
    expect(screen.getByRole('option', { name: 'Curse of Strahd' })).toBeInTheDocument()
  })

  it('keeps the modal open after the menu closes', async () => {
    mockCampaignList.mockResolvedValue([{ id: 'c1', name: 'Camp', owner_id: 'u1' }])
    renderMenu()
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'resources.addToCampaign' }))
    // The menu itself is dismissed, but the modal it opened stays up.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('does not let modal clicks reach the surrounding row', async () => {
    // The menu lives inside a book row whose click handler opens the reader.
    // React portals still bubble through the React tree, so without an explicit
    // stopPropagation every click in the modal would also open the book.
    mockCampaignList.mockResolvedValue([{ id: 'c1', name: 'Camp', owner_id: 'u1' }])
    const onRowClick = vi.fn()
    render(
      <div onClick={onRowClick}>
        <BookActionsMenu book={makeBook()} onEdit={() => {}} />
      </div>
    )
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'resources.addToCampaign' }))
    const dialog = await screen.findByRole('dialog')
    onRowClick.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(onRowClick).not.toHaveBeenCalled()
    expect(dialog).not.toBeInTheDocument()
  })

  it('is available to non-editors, unlike edit', () => {
    renderMenu({}, { onEdit: undefined })
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    expect(screen.queryByRole('menuitem', { name: 'bookActions.edit' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'resources.addToCampaign' })).toBeInTheDocument()
  })

  it('hides the item when campaigns are hidden in UI settings', () => {
    mockHideCampaigns = true
    renderMenu()
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    expect(
      screen.queryByRole('menuitem', { name: 'resources.addToCampaign' })
    ).not.toBeInTheDocument()
    // The rest of the menu is unaffected.
    expect(screen.getByRole('menuitem', { name: 'bookActions.download' })).toBeInTheDocument()
  })

  // --- text-layer PDF: re-scan ---

  it('shows a re-scan item for text-layer PDFs and posts to /rescan', async () => {
    renderMenu({ id: 'b2', index_error: '' })
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    expect(screen.queryByRole('menuitem', { name: 'bookActions.reocr' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'bookActions.rescan' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/books/b2/rescan'))
  })

  it('shows an error when the re-scan request fails', async () => {
    mockPost.mockRejectedValueOnce(new Error('boom'))
    renderMenu({ id: 'b3', index_error: '' })
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'bookActions.rescan' }))
    await waitFor(() => expect(screen.getByText('bookActions.rescanError')).toBeInTheDocument())
  })

  it('shows re-scan (not re-OCR) for an index-failed OCR book and posts to /rescan', async () => {
    // A failed OCR book keeps an error message in index_error, but index_failed
    // takes precedence: it must recover through the full re-scan flow.
    renderMenu({ id: 'b8', indexed: false, index_failed: true, index_error: 'ocr open failed: x' })
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    expect(screen.queryByRole('menuitem', { name: 'bookActions.reocr' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'bookActions.rescan' }))
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/books/b8/rescan'))
  })

  it('hides re-index items for a never-indexed / still-pending book', () => {
    renderMenu({ indexed: false, index_failed: false })
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    expect(screen.queryByRole('menuitem', { name: 'bookActions.rescan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'bookActions.reocr' })).not.toBeInTheDocument()
    // download stays available regardless
    expect(screen.getByRole('menuitem', { name: 'bookActions.download' })).toBeInTheDocument()
  })

  // --- image-only / OCR PDF: re-OCR with DPI ---

  it('shows a re-OCR item (not re-scan) for OCR books', () => {
    renderMenu({ index_error: 'ocr' })
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    expect(screen.getByRole('menuitem', { name: 'bookActions.reocr' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'bookActions.rescan' })).not.toBeInTheDocument()
  })

  it('re-OCR reveals a DPI field and posts to /reindex', async () => {
    renderMenu({ id: 'b4', index_error: 'image-only' })
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'bookActions.reocr' }))
    fireEvent.click(screen.getByText('reocr.run'))
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/books/b4/reindex'))
  })

  it('re-OCR posts the entered DPI as a query param', async () => {
    renderMenu({ id: 'b5', index_error: 'ocr' })
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'bookActions.reocr' }))
    fireEvent.change(screen.getByLabelText('reocr.dpiLabel'), { target: { value: '300' } })
    fireEvent.click(screen.getByText('reocr.run'))
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/books/b5/reindex?ocr_dpi=300'))
  })

  it('seeds the DPI field from an existing per-book override', () => {
    renderMenu({ index_error: 'ocr', ocr_dpi: 250 })
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'bookActions.reocr' }))
    expect(screen.getByLabelText('reocr.dpiLabel')).toHaveValue(250)
  })

  // --- permissions / type gating ---

  it('hides re-index items when onEdit is not provided (non-editor)', () => {
    render(<BookActionsMenu book={makeBook({ index_error: '' })} />)
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    expect(screen.queryByRole('menuitem', { name: 'bookActions.rescan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'bookActions.reocr' })).not.toBeInTheDocument()
    // download is still available to everyone
    expect(screen.getByRole('menuitem', { name: 'bookActions.download' })).toBeInTheDocument()
  })

  it('hides re-index items for non-PDF books', () => {
    renderMenu({ mime_type: 'application/zip' })
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    expect(screen.queryByRole('menuitem', { name: 'bookActions.rescan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'bookActions.reocr' })).not.toBeInTheDocument()
  })

  it('marks the trigger active when the book is being edited', () => {
    renderMenu({}, { editing: true })
    const trigger = screen.getByLabelText('bookActions.menu')
    expect(trigger).toHaveStyle({ color: 'var(--gold)' })
  })

  describe('file actions', () => {
    const withFile = { relative_path: 'books/System/core/tome.pdf', filename: 'tome.pdf' }

    it('offers move, rename and delete to an admin on a writable library', () => {
      mockRole = 'admin'
      mockLibraryWritable = true
      renderMenu(withFile)
      fireEvent.click(screen.getByLabelText('bookActions.menu'))

      expect(screen.getByTestId('book-move-file')).toBeInTheDocument()
      expect(screen.getByTestId('book-rename-file')).toBeInTheDocument()
      expect(screen.getByTestId('book-delete-file')).toBeInTheDocument()
    })

    it('groups them last, behind a divider', () => {
      mockRole = 'admin'
      mockLibraryWritable = true
      renderMenu(withFile)
      fireEvent.click(screen.getByLabelText('bookActions.menu'))

      // They act on the bytes rather than the record, and one cannot be undone,
      // so they must stay separated from the routine items above.
      const menu = screen.getByRole('menu')
      expect(menu.querySelector('[role="separator"]')).toBeInTheDocument()
      const items = [...menu.querySelectorAll('[role="menuitem"]')]
      expect(items.slice(-3).map((el) => el.dataset.testid)).toEqual([
        'book-move-file',
        'book-rename-file',
        'book-delete-file',
      ])
    })

    it('hides move and rename on a read-only library, but keeps remove', () => {
      // Remove survives because its default writes nothing to disk: it drops the
      // record and leaves the file. On a read-only mount that is the only
      // cleanup still possible, so hiding it would remove the one usable action.
      mockRole = 'admin'
      mockLibraryWritable = false
      renderMenu(withFile)
      fireEvent.click(screen.getByLabelText('bookActions.menu'))

      expect(screen.queryByTestId('book-move-file')).not.toBeInTheDocument()
      expect(screen.queryByTestId('book-rename-file')).not.toBeInTheDocument()
      expect(screen.getByTestId('book-delete-file')).toBeInTheDocument()
    })

    it('hides them from a gm', () => {
      mockRole = 'gm'
      mockLibraryWritable = true
      renderMenu(withFile)
      fireEvent.click(screen.getByLabelText('bookActions.menu'))

      expect(screen.queryByTestId('book-move-file')).not.toBeInTheDocument()
    })

    it('hides them for a book whose path is unknown', () => {
      mockRole = 'admin'
      mockLibraryWritable = true
      renderMenu()
      fireEvent.click(screen.getByLabelText('bookActions.menu'))

      // Nothing to act on without a path, so the group is not offered.
      expect(screen.queryByTestId('book-move-file')).not.toBeInTheDocument()
    })

    it('opens the delete confirmation', async () => {
      mockRole = 'admin'
      mockLibraryWritable = true
      renderMenu(withFile)
      fireEvent.click(screen.getByLabelText('bookActions.menu'))
      fireEvent.click(screen.getByTestId('book-delete-file'))

      // Deleting is never one click: the dialog is the guard.
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
    })
  })
})

// VariantMenuItems (the pre-existing "switch version" rows) calls useNavigate,
// so this group renders inside a Router; the base renderMenu above does not.
const renderVersionMenu = (book) =>
  render(
    <MemoryRouter>
      <BookActionsMenu book={makeBook(book)} onEdit={() => {}} />
    </MemoryRouter>
  )

describe('BookActionsMenu version actions', () => {
  beforeEach(() => {
    mockGet.mockClear()
    mockGet.mockResolvedValue({
      id: 'b1',
      variant_main_id: 'b1',
      variants: [{ id: 'b2', kind: 'printer-friendly', label: '' }],
    })
  })

  it('offers a plain download for a book with one version', () => {
    renderVersionMenu({ variant_count: 0 })
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('menuitem', { name: 'bookActions.download' })).toHaveAttribute(
      'href',
      'http://localhost/books/b1/file'
    )
    expect(
      screen.queryByRole('menuitem', { name: 'variants.downloadVersion' })
    ).not.toBeInTheDocument()
  })

  it('offers both switch-version and download-version for a book with two', () => {
    renderVersionMenu({ variant_count: 1 })
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('menuitem', { name: 'variants.switchLabel' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'variants.downloadVersion' })).toBeInTheDocument()
    // The single-version download row is replaced, not duplicated.
    expect(screen.queryByRole('menuitem', { name: 'bookActions.download' })).not.toBeInTheDocument()
  })

  it('lists a download link per version once expanded', async () => {
    renderVersionMenu({ variant_count: 1 })
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'variants.downloadVersion' }))
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'variants.mainVersion' })).toHaveAttribute(
        'href',
        'http://localhost/books/b1/file'
      )
    )
    expect(
      screen.getByRole('menuitem', { name: 'variants.kind.printer-friendly' })
    ).toHaveAttribute('href', 'http://localhost/books/b2/file')
  })
})
