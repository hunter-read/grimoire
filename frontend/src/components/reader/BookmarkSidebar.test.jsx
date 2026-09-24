import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BookmarkSidebar from './BookmarkSidebar'
import api from '../../api'

vi.mock('../../api', () => ({
  default: { get: vi.fn(), delete: vi.fn(), patch: vi.fn() },
}))

const BOOKMARKS = [
  {
    id: 1,
    page_number: 12,
    label: 'Chapter opener',
    notes: 'worth re-reading',
    selected_text: null,
  },
  { id: 2, page_number: 40, label: '', notes: '', selected_text: 'a quoted passage' },
  { id: 3, page_number: 77, label: '', notes: '', selected_text: null },
]

function renderSidebar(overrides = {}) {
  const props = {
    bookId: 'book-1',
    currentPage: 12,
    onGoToPage: vi.fn(),
    onClose: vi.fn(),
    refreshKey: 0,
    ...overrides,
  }
  return { ...render(<BookmarkSidebar {...props} />), props }
}

/**
 * The label field and the pencil that opens it share an aria-label, so the
 * field is reached by its id instead.
 */
function labelInput(id = 1) {
  return document.getElementById(`bookmark-label-${id}`)
}

describe('BookmarkSidebar', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.get.mockResolvedValue(BOOKMARKS)
    api.delete.mockResolvedValue({})
    api.patch.mockResolvedValue({})
  })

  it('lists the book’s bookmarks once loaded', async () => {
    renderSidebar()
    expect(await screen.findByText('Chapter opener')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/bookmarks?book_id=book-1')
  })

  it('shows the empty state when there are none', async () => {
    api.get.mockResolvedValue([])
    renderSidebar()
    expect(await screen.findByText('No bookmarks yet.')).toBeInTheDocument()
  })

  // A failed fetch must still land on the empty state rather than spinning
  // forever behind a loader.
  it('falls back to the empty state when the fetch fails', async () => {
    api.get.mockRejectedValue(new Error('offline'))
    renderSidebar()
    expect(await screen.findByText('No bookmarks yet.')).toBeInTheDocument()
  })

  it('falls back to the selected text, then the page, for an unlabelled bookmark', async () => {
    renderSidebar()
    expect(await screen.findByText('a quoted passage')).toBeInTheDocument()
    expect(screen.getByText('Page 77')).toBeInTheDocument()
  })

  it('shows notes and the quoted passage alongside the label', async () => {
    renderSidebar()
    expect(await screen.findByText('worth re-reading')).toBeInTheDocument()
    expect(screen.getByText('"a quoted passage"')).toBeInTheDocument()
  })

  it('jumps to the bookmarked page, passing any quoted text to highlight', async () => {
    const { props } = renderSidebar()
    await userEvent.click(await screen.findByLabelText('Go to bookmark: Chapter opener'))
    expect(props.onGoToPage).toHaveBeenCalledWith(12, null)

    await userEvent.click(screen.getByLabelText('Go to bookmark: a quoted passage'))
    expect(props.onGoToPage).toHaveBeenCalledWith(40, 'a quoted passage')
  })

  it('closes when the close button is clicked', async () => {
    const { props } = renderSidebar()
    await userEvent.click(await screen.findByLabelText('Close bookmarks'))
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('deletes a bookmark and drops it from the list', async () => {
    renderSidebar()
    await screen.findByText('Chapter opener')

    await userEvent.click(screen.getAllByLabelText('Delete bookmark')[0])

    expect(api.delete).toHaveBeenCalledWith('/bookmarks/1')
    await waitFor(() => expect(screen.queryByText('Chapter opener')).not.toBeInTheDocument())
  })

  it('saves an edited label and notes', async () => {
    renderSidebar()
    await screen.findByText('Chapter opener')

    await userEvent.click(screen.getAllByLabelText('Edit bookmark')[0])
    const label = labelInput()
    await userEvent.clear(label)
    await userEvent.type(label, 'Renamed')
    await userEvent.click(screen.getByLabelText('Save bookmark'))

    expect(api.patch).toHaveBeenCalledWith('/bookmarks/1', {
      label: 'Renamed',
      notes: 'worth re-reading',
    })
    await waitFor(() => expect(screen.getByText('Renamed')).toBeInTheDocument())
  })

  it('saves on Enter from the label field', async () => {
    renderSidebar()
    await screen.findByText('Chapter opener')

    await userEvent.click(screen.getAllByLabelText('Edit bookmark')[0])
    await userEvent.type(labelInput(), '{Enter}')

    expect(api.patch).toHaveBeenCalled()
  })

  it('abandons the edit on Escape, leaving the bookmark untouched', async () => {
    renderSidebar()
    await screen.findByText('Chapter opener')

    await userEvent.click(screen.getAllByLabelText('Edit bookmark')[0])
    await userEvent.type(labelInput(), 'scrapped{Escape}')

    expect(api.patch).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('Chapter opener')).toBeInTheDocument())
  })

  it('abandons the edit on Escape from the notes field too', async () => {
    renderSidebar()
    await screen.findByText('Chapter opener')

    await userEvent.click(screen.getAllByLabelText('Edit bookmark')[0])
    await userEvent.type(screen.getByLabelText('Notes (optional)'), '{Escape}')

    expect(api.patch).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('Chapter opener')).toBeInTheDocument())
  })

  // Clicking the row while editing would otherwise navigate away mid-edit.
  it('does not navigate when the row is clicked during an edit', async () => {
    const { props } = renderSidebar()
    await screen.findByText('Chapter opener')

    await userEvent.click(screen.getAllByLabelText('Edit bookmark')[0])
    await userEvent.click(screen.getByLabelText('Go to bookmark: Chapter opener'))

    expect(props.onGoToPage).not.toHaveBeenCalled()
  })

  it('refetches when the refresh key changes', async () => {
    const { rerender, props } = renderSidebar()
    await screen.findByText('Chapter opener')
    expect(api.get).toHaveBeenCalledTimes(1)

    rerender(<BookmarkSidebar {...props} refreshKey={1} />)
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
  })
})
