import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PreviewModal from './PreviewModal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}))
vi.mock('../../api', () => ({
  mediaUrl: (path) => `/api${path}`,
  bookPageUrl: (id, page, width) => `/api/books/${id}/page/${page}?width=${width}`,
}))

const book = (over = {}) => ({ id: 'b1', title: 'Bestiary', page_count: 3, ...over })

const renderBook = (over = {}, onClose = vi.fn()) =>
  render(<PreviewModal type="book" item={book(over)} onClose={onClose} />)

describe('PreviewModal', () => {
  it('shows the first page of a book', () => {
    renderBook()
    expect(screen.getByTestId('preview-page')).toHaveAttribute(
      'src',
      expect.stringContaining('/page/1')
    )
    expect(screen.getByText('Bestiary')).toBeInTheDocument()
  })

  it('pages forward and back within the book', async () => {
    renderBook()
    await userEvent.click(screen.getByTestId('preview-next'))
    expect(screen.getByTestId('preview-page')).toHaveAttribute(
      'src',
      expect.stringContaining('/page/2')
    )

    await userEvent.click(screen.getByTestId('preview-prev'))
    expect(screen.getByTestId('preview-page')).toHaveAttribute(
      'src',
      expect.stringContaining('/page/1')
    )
  })

  it('stops at the first and last page', async () => {
    renderBook({ page_count: 2 })
    expect(screen.getByTestId('preview-prev')).toBeDisabled()

    await userEvent.click(screen.getByTestId('preview-next'))
    expect(screen.getByTestId('preview-next')).toBeDisabled()
  })

  it('pages with the arrow keys and closes on Escape', async () => {
    const onClose = vi.fn()
    renderBook({}, onClose)

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByTestId('preview-page')).toHaveAttribute(
      'src',
      expect.stringContaining('/page/2')
    )
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByTestId('preview-page')).toHaveAttribute(
      'src',
      expect.stringContaining('/page/1')
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('hides the pager for a single-page book', () => {
    renderBook({ page_count: 1 })
    expect(screen.queryByTestId('preview-next')).not.toBeInTheDocument()
  })

  it('says so when a book has no rendered pages', () => {
    renderBook({ page_count: 0 })
    expect(screen.getByText('files.previewNoPages')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-page')).not.toBeInTheDocument()
  })

  it('reports a page that fails to render', () => {
    renderBook()
    fireEvent.error(screen.getByTestId('preview-page'))
    expect(screen.getByText('files.previewFailed')).toBeInTheDocument()
  })

  it('reuses a cached page URL rather than rebuilding it', async () => {
    renderBook()
    const first = screen.getByTestId('preview-page').getAttribute('src')
    await userEvent.click(screen.getByTestId('preview-next'))
    await userEvent.click(screen.getByTestId('preview-prev'))
    expect(screen.getByTestId('preview-page')).toHaveAttribute('src', first)
  })

  it.each([
    ['map', 'preview-image', '/api/maps/m1/file'],
    ['token', 'preview-image', '/api/tokens/m1/file'],
  ])('renders a %s as a single image', (type, testId, src) => {
    render(<PreviewModal type={type} item={{ id: 'm1', title: 'Tavern' }} onClose={vi.fn()} />)
    expect(screen.getByTestId(testId)).toHaveAttribute('src', src)
    // Images are whole files, so they carry no pager.
    expect(screen.queryByTestId('preview-next')).not.toBeInTheDocument()
  })

  it('renders audio as a player', () => {
    render(<PreviewModal type="audio" item={{ id: 'a1', title: 'Tavern' }} onClose={vi.fn()} />)
    expect(screen.getByTestId('preview-audio')).toHaveAttribute('src', '/api/audio/a1/file')
  })

  it('reports an image that fails to load', () => {
    render(<PreviewModal type="map" item={{ id: 'm1', title: 'Tavern' }} onClose={vi.fn()} />)
    fireEvent.error(screen.getByTestId('preview-image'))
    expect(screen.getByText('files.previewFailed')).toBeInTheDocument()
  })

  it('closes from the button and the backdrop', async () => {
    const onClose = vi.fn()
    const { rerender } = renderBook({}, onClose)
    await userEvent.click(screen.getByTestId('close-preview'))
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(<PreviewModal type="book" item={book()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('falls back to a filename when the record has no title', () => {
    render(
      <PreviewModal type="map" item={{ id: 'm1', filename: 'tavern.png' }} onClose={vi.fn()} />
    )
    expect(screen.getByText('tavern.png')).toBeInTheDocument()
  })
})
