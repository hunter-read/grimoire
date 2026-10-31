import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BookCoverUpload from './BookCoverUpload'
import { imageSources } from '../../api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

vi.mock('../../api', () => ({
  bookThumbUrl: (id: string, v?: string | null) =>
    `/api/books/${id}/thumbnail${v ? `?v=${v}` : ''}`,
  imageSources: {
    uploadBookCover: vi.fn(),
    setBookCover: vi.fn(),
    deleteBookCover: vi.fn(),
    // The picker's browse tab searches the library and builds thumbnail URLs.
    search: vi.fn(() =>
      Promise.resolve([
        { resource_type: 'map', resource_id: 'm1', name: 'map-1.png', has_thumbnail: true },
      ])
    ),
    thumbUrl: (type: string, id: string) => `/api/${type}s/${id}/thumbnail`,
  },
}))

const mocked = imageSources as unknown as Record<
  'uploadBookCover' | 'setBookCover' | 'deleteBookCover',
  Mock
>

const makeBook = (over: Record<string, unknown> = {}) => ({
  id: 'book-1',
  has_thumbnail: true,
  has_custom_cover: false,
  cover_version: null,
  ...over,
})

const customResponse = (version = 'abc123') => ({
  cover_image: `book-1_${version}.webp`,
  has_custom_cover: true,
  cover_version: version,
  has_thumbnail: true,
})

const pngFile = () =>
  new File([new Uint8Array([137, 80, 78, 71])], 'cover.png', {
    type: 'image/png',
  })

const openPickerAndUpload = async (label = 'bookEditor.uploadCover') => {
  await userEvent.click(screen.getByText(label))
  await userEvent.upload(screen.getByTestId('image-picker-input'), pngFile())
  await userEvent.click(screen.getByText('imagePicker.save'))
}

describe('BookCoverUpload', () => {
  beforeEach(() => vi.clearAllMocks())

  it('previews the generated cover and offers an upload', () => {
    render(<BookCoverUpload book={makeBook()} />)
    expect(screen.getByTestId('book-cover-preview')).toHaveAttribute(
      'src',
      '/api/books/book-1/thumbnail'
    )
    expect(screen.getByText('bookEditor.uploadCover')).toBeInTheDocument()
    expect(screen.getByText('bookEditor.coverHint')).toBeInTheDocument()
    expect(screen.queryByText('bookEditor.removeCustomCover')).not.toBeInTheDocument()
  })

  it('shows no preview for a book with no cover at all', () => {
    render(<BookCoverUpload book={makeBook({ has_thumbnail: false })} />)
    expect(screen.queryByTestId('book-cover-preview')).not.toBeInTheDocument()
  })

  it('previews a custom cover at its version and offers to replace or remove it', () => {
    render(<BookCoverUpload book={makeBook({ has_custom_cover: true, cover_version: 'v1' })} />)
    expect(screen.getByTestId('book-cover-preview')).toHaveAttribute(
      'src',
      '/api/books/book-1/thumbnail?v=v1'
    )
    expect(screen.getByText('bookEditor.replaceCover')).toBeInTheDocument()
    expect(screen.getByText('bookEditor.removeCustomCover')).toBeInTheDocument()
    expect(screen.getByText('bookEditor.customCoverInUse')).toBeInTheDocument()
  })

  it('uploads the chosen file and reports the new cover', async () => {
    mocked.uploadBookCover.mockResolvedValue(customResponse())
    const onChange = vi.fn()
    render(<BookCoverUpload book={makeBook()} onChange={onChange} />)

    await openPickerAndUpload()

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        has_custom_cover: true,
        cover_version: 'abc123',
        has_thumbnail: true,
      })
    )
    expect(mocked.uploadBookCover.mock.calls[0][0]).toBe('book-1')
    await waitFor(() =>
      expect(screen.getByTestId('book-cover-preview')).toHaveAttribute(
        'src',
        '/api/books/book-1/thumbnail?v=abc123'
      )
    )
    expect(screen.getByText('bookEditor.removeCustomCover')).toBeInTheDocument()
  })

  it('surfaces an upload failure in the picker', async () => {
    mocked.uploadBookCover.mockRejectedValue(new Error('too big'))
    render(<BookCoverUpload book={makeBook()} />)

    await openPickerAndUpload()

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('too big'))
  })

  it('sets the cover from a library asset', async () => {
    mocked.setBookCover.mockResolvedValue(customResponse('fromsrc'))
    const onChange = vi.fn()
    render(<BookCoverUpload book={makeBook()} onChange={onChange} />)

    await userEvent.click(screen.getByText('bookEditor.uploadCover'))
    await userEvent.click(screen.getByText('imagePicker.mode.browse'))
    await waitFor(() => expect(screen.getByText('map-1.png')).toBeInTheDocument())
    await userEvent.click(screen.getByText('map-1.png'))
    await userEvent.click(screen.getByText('imagePicker.save'))

    await waitFor(() => expect(mocked.setBookCover).toHaveBeenCalledWith('book-1', 'map', 'm1'))
    expect(mocked.uploadBookCover).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cover_version: 'fromsrc' }))
    )
  })

  it('removes the custom cover and falls back to the generated one', async () => {
    mocked.deleteBookCover.mockResolvedValue({
      cover_image: '',
      has_custom_cover: false,
      cover_version: null,
      has_thumbnail: true,
    })
    const onChange = vi.fn()
    render(
      <BookCoverUpload
        book={makeBook({ has_custom_cover: true, cover_version: 'v1' })}
        onChange={onChange}
      />
    )
    await userEvent.click(screen.getByText('bookEditor.removeCustomCover'))

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        has_custom_cover: false,
        cover_version: null,
        has_thumbnail: true,
      })
    )
    expect(mocked.deleteBookCover).toHaveBeenCalledWith('book-1')
    await waitFor(() =>
      expect(screen.getByTestId('book-cover-preview')).toHaveAttribute(
        'src',
        '/api/books/book-1/thumbnail'
      )
    )
    expect(screen.queryByText('bookEditor.removeCustomCover')).not.toBeInTheDocument()
  })

  it('removes the cover from inside the picker', async () => {
    mocked.deleteBookCover.mockResolvedValue({
      cover_image: '',
      has_custom_cover: false,
      cover_version: null,
      has_thumbnail: false,
    })
    render(<BookCoverUpload book={makeBook({ has_custom_cover: true, cover_version: 'v1' })} />)
    await userEvent.click(screen.getByText('bookEditor.replaceCover'))
    await userEvent.click(screen.getByText('imagePicker.remove'))

    await waitFor(() => expect(mocked.deleteBookCover).toHaveBeenCalledWith('book-1'))
    await waitFor(() => expect(screen.queryByTestId('book-cover-preview')).not.toBeInTheDocument())
  })

  it('reports a failed removal', async () => {
    mocked.deleteBookCover.mockRejectedValue({})
    render(<BookCoverUpload book={makeBook({ has_custom_cover: true, cover_version: 'v1' })} />)
    await userEvent.click(screen.getByText('bookEditor.removeCustomCover'))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('bookEditor.coverUpdateFailed')
    )
    expect(screen.getByText('bookEditor.removeCustomCover')).toBeInTheDocument()
  })
})
