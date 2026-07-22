import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import BookActionsMenu from './BookActionsMenu'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

const mockPost = vi.fn(() => Promise.resolve({}))
vi.mock('../../api', () => ({
  default: { post: (...args) => mockPost(...args) },
  mediaUrl: (path) => `http://localhost${path}`,
}))

function makeBook(overrides = {}) {
  return { id: 'b1', mime_type: 'application/pdf', index_error: '', ...overrides }
}

function renderMenu(book = {}, props = {}) {
  return render(<BookActionsMenu book={makeBook(book)} onEdit={() => {}} {...props} />)
}

describe('BookActionsMenu', () => {
  beforeEach(() => {
    mockPost.mockClear()
    mockPost.mockResolvedValue({})
  })

  it('is collapsed until the trigger is clicked', () => {
    renderMenu()
    expect(screen.queryByRole('menuitem', { name: 'bookActions.edit' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('bookActions.menu'))
    expect(screen.getByRole('menuitem', { name: 'bookActions.edit' })).toBeInTheDocument()
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
})
