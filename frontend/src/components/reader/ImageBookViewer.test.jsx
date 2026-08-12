import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ImageBookViewer from './ImageBookViewer'
import { mediaUrl } from '../../api'
import { useFavorites } from '../../context/FavoritesContext'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

vi.mock('../../api', () => ({ mediaUrl: vi.fn((p) => `/api${p}`) }))

vi.mock('../../context/FavoritesContext', () => ({ useFavorites: vi.fn() }))

vi.mock('../campaigns/AddToCampaignButton', () => ({
  default: ({ resourceType, resourceId }) => (
    <button data-testid="add-to-campaign">{`${resourceType}:${resourceId}`}</button>
  ),
}))

const toggleFavorite = vi.fn()

function setup({ favorite = false, ...props } = {}) {
  useFavorites.mockReturnValue({ isFavorite: () => favorite, toggleFavorite })
  return render(
    <MemoryRouter>
      <ImageBookViewer book={{ title: 'Map of Barovia' }} bookId={7} {...props} />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ImageBookViewer', () => {
  it('renders the title and the full-size image from the book file URL', () => {
    setup()
    expect(screen.getByText('Map of Barovia')).toBeInTheDocument()
    const img = screen.getByAltText('Map of Barovia')
    expect(img).toHaveAttribute('src', '/api/books/7/file')
    expect(mediaUrl).toHaveBeenCalledWith('/books/7/file')
  })

  it('offers a download link for the underlying file', () => {
    setup()
    const link = screen.getByTitle('reader.downloadFile')
    expect(link).toHaveAttribute('href', '/api/books/7/file')
    expect(link).toHaveAttribute('download')
  })

  it('passes the book through to the add-to-campaign button', () => {
    setup()
    expect(screen.getByTestId('add-to-campaign')).toHaveTextContent('book:7')
  })

  it('navigates back in history when no backPath is given', async () => {
    setup()
    await userEvent.click(screen.getByLabelText('reader.back'))
    expect(navigate).toHaveBeenCalledWith(-1)
  })

  it('navigates to backPath when one is given', async () => {
    setup({ backPath: '/library/3' })
    await userEvent.click(screen.getByLabelText('reader.back'))
    expect(navigate).toHaveBeenCalledWith('/library/3')
  })

  it('shows the add-to-favorites affordance when the book is not a favorite', async () => {
    setup({ favorite: false })
    const btn = screen.getByTitle('reader.addToFavorites')
    await userEvent.click(btn)
    expect(toggleFavorite).toHaveBeenCalledWith('book', 7)
  })

  it('shows the remove-from-favorites affordance when the book is a favorite', () => {
    setup({ favorite: true })
    expect(screen.getByTitle('reader.removeFromFavorites')).toBeInTheDocument()
    expect(screen.queryByTitle('reader.addToFavorites')).not.toBeInTheDocument()
  })
})
