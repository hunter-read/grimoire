import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TextBookViewer from './TextBookViewer'
import api from '../../api'
import { useFavorites } from '../../context/FavoritesContext'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

vi.mock('../../api', () => ({
  default: { get: vi.fn() },
  mediaUrl: vi.fn((p) => `/api${p}`),
}))

vi.mock('../../context/FavoritesContext', () => ({ useFavorites: vi.fn() }))

vi.mock('../Spinner', () => ({ default: () => <div data-testid="spinner" /> }))

const toggleFavorite = vi.fn()

function setup({ favorite = false, book, ...props } = {}) {
  useFavorites.mockReturnValue({ isFavorite: () => favorite, toggleFavorite })
  const merged = {
    title: 'Homebrew Notes',
    filename: 'notes.md',
    page_count: 3,
    mime_type: 'text/markdown',
    ...book,
  }
  return render(
    <MemoryRouter>
      <TextBookViewer book={merged} bookId="b1" {...props} />
    </MemoryRouter>
  )
}

describe('TextBookViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.get.mockResolvedValue({ text: 'Page one text' })
  })

  it('fetches and renders the first page of text', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('Page one text')).toBeInTheDocument())
    expect(api.get).toHaveBeenCalledWith('/books/b1/page/1/text')
  })

  it('shows a spinner until the text arrives', async () => {
    let resolve
    api.get.mockReturnValue(new Promise((r) => (resolve = r)))
    setup()
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
    resolve({ text: 'Loaded' })
    await waitFor(() => expect(screen.getByText('Loaded')).toBeInTheDocument())
  })

  it('pages forward and fetches the next page', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('Page one text')).toBeInTheDocument())
    api.get.mockResolvedValue({ text: 'Page two text' })

    await userEvent.click(screen.getByLabelText('reader.nextPage'))
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/books/b1/page/2/text'))
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
  })

  it('does not page past the last page', async () => {
    setup({ book: { page_count: 1 } })
    await waitFor(() => expect(screen.getByText('Page one text')).toBeInTheDocument())
    // A single-page document shows no pager at all.
    expect(screen.queryByLabelText('reader.nextPage')).not.toBeInTheDocument()
  })

  it('disables the previous button on page one', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('Page one text')).toBeInTheDocument())
    expect(screen.getByLabelText('reader.previousPage')).toBeDisabled()
  })

  it('shows a fallback message when the text cannot be loaded', async () => {
    api.get.mockRejectedValue(new Error('nope'))
    setup()
    await waitFor(() => expect(screen.getByText('reader.textUnavailable')).toBeInTheDocument())
  })

  it('navigates back to the provided path', async () => {
    setup({ backPath: '/system/x' })
    await userEvent.click(screen.getByLabelText('reader.back'))
    expect(navigate).toHaveBeenCalledWith('/system/x')
  })

  it('falls back to history when no back path is given', async () => {
    setup()
    await userEvent.click(screen.getByLabelText('reader.back'))
    expect(navigate).toHaveBeenCalledWith(-1)
  })

  it('toggles favourite state', async () => {
    setup()
    await userEvent.click(screen.getByLabelText('reader.addToFavorites'))
    expect(toggleFavorite).toHaveBeenCalledWith('book', 'b1')
  })

  it('offers a download link for the original file', async () => {
    setup()
    const link = screen.getByLabelText('reader.downloadFile')
    expect(link).toHaveAttribute('href', '/api/books/b1/file')
    expect(link).toHaveAttribute('download', 'notes.md')
  })

  it('pages with the arrow keys', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('Page one text')).toBeInTheDocument())
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(screen.getByText('2 / 3')).toBeInTheDocument())
    await userEvent.keyboard('{ArrowLeft}')
    await waitFor(() => expect(screen.getByText('1 / 3')).toBeInTheDocument())
  })

  it('treats a missing page_count as a single page', async () => {
    setup({ book: { page_count: undefined } })
    await waitFor(() => expect(screen.getByText('Page one text')).toBeInTheDocument())
    expect(screen.queryByLabelText('reader.nextPage')).not.toBeInTheDocument()
  })
})
