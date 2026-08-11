import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BookDetailsModal from './BookDetailsModal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

vi.mock('../../api', () => ({ mediaUrl: (p) => `http://localhost${p}` }))
vi.mock('../LazyImg', () => ({ default: ({ alt, ...rest }) => <img alt={alt} {...rest} /> }))
vi.mock('../Tag', () => ({ default: ({ label }) => <span>{label}</span> }))

const BOOK = {
  id: 'b1',
  title: 'Blades in the Dark',
  category: 'core',
  description: 'Daring heists.',
  authors: ['John Harper'],
  artists: ['John Harper'],
  publisher: 'Evil Hat',
  year: 2017,
  month: 3,
  genres: ['Fantasy'],
  license: 'CC BY 3.0',
  isbn: '123',
  page_count: 328,
  file_size: 1024 * 1024,
  mime_type: 'application/pdf',
  relative_path: 'books/Blades/core/blades.pdf',
  tags: ['Heist'],
  urls: [{ label: 'DriveThruRPG', url: 'https://example.com/p/1' }],
  has_thumbnail: true,
}

describe('BookDetailsModal', () => {
  it('shows the title and description', () => {
    render(<BookDetailsModal book={BOOK} onClose={vi.fn()} />)
    expect(screen.getByText('Blades in the Dark')).toBeInTheDocument()
    expect(screen.getByText('Daring heists.')).toBeInTheDocument()
  })

  it('shows the metadata that is set', () => {
    render(<BookDetailsModal book={BOOK} onClose={vi.fn()} />)
    // Author and artist are the same person here, hence getAllBy.
    expect(screen.getAllByText('John Harper', { selector: 'dd' })).toHaveLength(2)
    expect(screen.getByText('Evil Hat')).toBeInTheDocument()
    expect(screen.getByText('328')).toBeInTheDocument()
    expect(screen.getByText('books/Blades/core/blades.pdf')).toBeInTheDocument()
  })

  it('formats the file size rather than showing raw bytes', () => {
    render(<BookDetailsModal book={BOOK} onClose={vi.fn()} />)
    expect(screen.queryByText('1048576')).toBeNull()
  })

  it('omits fields with no value instead of rendering them blank', () => {
    // A sparsely tagged book should read short, not mostly-empty.
    render(<BookDetailsModal book={{ id: 'b', title: 'Bare' }} onClose={vi.fn()} />)
    expect(screen.queryByText('bookDetails.publisher')).toBeNull()
    expect(screen.queryByText('bookDetails.isbn')).toBeNull()
  })

  it('shows tags and links', () => {
    render(<BookDetailsModal book={BOOK} onClose={vi.fn()} />)
    expect(screen.getByText('Heist')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /DriveThruRPG/ })).toHaveAttribute(
      'href',
      'https://example.com/p/1'
    )
  })

  it('opens links safely in a new tab', () => {
    render(<BookDetailsModal book={BOOK} onClose={vi.fn()} />)
    const link = screen.getByRole('link', { name: /DriveThruRPG/ })
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('shows the cover when there is one', () => {
    render(<BookDetailsModal book={BOOK} onClose={vi.fn()} />)
    expect(screen.getByAltText('Blades in the Dark')).toBeInTheDocument()
  })

  it('does not let a long description stretch the cover out of shape', () => {
    render(
      <BookDetailsModal book={{ ...BOOK, description: 'Long. '.repeat(400) }} onClose={vi.fn()} />
    )
    // The cover is a flex child next to the text column; without an explicit
    // alignment it would be stretched to match the taller description.
    expect(screen.getByAltText('Blades in the Dark')).toHaveStyle({ alignSelf: 'flex-start' })
  })

  it('copes with a book that has no cover', () => {
    render(<BookDetailsModal book={{ id: 'b', title: 'No Cover' }} onClose={vi.fn()} />)
    expect(screen.queryByAltText('No Cover')).toBeNull()
  })

  it('closes on the close button', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<BookDetailsModal book={BOOK} onClose={onClose} />)
    await user.click(screen.getByLabelText('common.close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<BookDetailsModal book={BOOK} onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('is announced as a dialog', () => {
    render(<BookDetailsModal book={BOOK} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })
})
