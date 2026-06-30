import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AudioFavorite from './AudioFavorite'

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))
vi.mock('../../api', () => ({ mediaUrl: (p) => `http://localhost${p}` }))
vi.mock('../FavoriteButton', () => ({ default: () => <button>fav</button> }))

beforeEach(() => vi.clearAllMocks())

const track = (over = {}) => ({
  item_id: 'a1',
  title: 'Tavern Night',
  filename: 'tavern.mp3',
  has_artwork: false,
  ...over,
})

describe('AudioFavorite', () => {
  it('renders the title in grid mode and navigates on click', async () => {
    render(<AudioFavorite item={track()} grid />)
    expect(screen.getByText('Tavern Night')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Tavern Night'))
    expect(navigate).toHaveBeenCalledWith('/audio/a1')
  })

  it('falls back to filename when title is empty', () => {
    render(<AudioFavorite item={track({ title: '' })} grid />)
    expect(screen.getByText('tavern.mp3')).toBeInTheDocument()
  })

  it('renders artwork image when has_artwork', () => {
    const { container } = render(<AudioFavorite item={track({ has_artwork: true })} grid />)
    const img = container.querySelector('img')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toContain('/audio/a1/artwork')
  })

  it('renders in row mode (no grid)', async () => {
    render(<AudioFavorite item={track()} grid={false} />)
    expect(screen.getByText('Tavern Night')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Tavern Night'))
    expect(navigate).toHaveBeenCalledWith('/audio/a1')
  })
})
