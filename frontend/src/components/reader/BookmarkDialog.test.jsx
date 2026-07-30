import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BookmarkDialog from './BookmarkDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) =>
      ({
        'bookmark.bookmarkSelection': 'Bookmark selection',
        'bookmark.bookmarkPage': `Bookmark page ${o?.page}`,
        'bookmark.notes': 'Notes',
        'bookmark.notesPlaceholder': 'Notes…',
        'bookmark.cancel': 'Cancel',
        'bookmark.save': 'Save',
      })[k] || k,
  }),
}))

function baseProps(over = {}) {
  return {
    pendingBookmark: { page: 5 },
    pendingLabel: '',
    pendingNotes: '',
    onLabelChange: vi.fn(),
    onNotesChange: vi.fn(),
    onSave: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
}

describe('BookmarkDialog', () => {
  it('shows the page title and the selected-text preview', () => {
    render(
      <BookmarkDialog
        {...baseProps({ pendingBookmark: { page: 3, selectedText: 'a fireball' } })}
      />
    )
    expect(screen.getByText('Bookmark selection')).toBeInTheDocument()
    expect(screen.getByText('"a fireball"')).toBeInTheDocument()
  })

  it('shows a page-based title when no text is selected', () => {
    render(<BookmarkDialog {...baseProps()} />)
    expect(screen.getByText('Bookmark page 5')).toBeInTheDocument()
  })

  it('propagates label and notes edits', async () => {
    const onLabelChange = vi.fn()
    const onNotesChange = vi.fn()
    render(<BookmarkDialog {...baseProps({ onLabelChange, onNotesChange })} />)
    await userEvent.type(screen.getByLabelText('bookmark.label'), 'x')
    await userEvent.type(screen.getByLabelText('Notes'), 'y')
    expect(onLabelChange).toHaveBeenCalled()
    expect(onNotesChange).toHaveBeenCalled()
  })

  it('saves and closes via the buttons', async () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(<BookmarkDialog {...baseProps({ onSave, onClose })} />)
    await userEvent.click(screen.getByText('Save'))
    expect(onSave).toHaveBeenCalled()
    await userEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on backdrop click and on Escape in a field', () => {
    const onClose = vi.fn()
    render(<BookmarkDialog {...baseProps({ onClose })} />)
    fireEvent.keyDown(screen.getByLabelText('Notes'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
