import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TokenFavorite from './TokenFavorite'

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))
vi.mock('../../api', () => ({ mediaUrl: (p) => `http://localhost${p}` }))
vi.mock('../FavoriteButton', () => ({ default: () => <button>fav</button> }))

beforeEach(() => vi.clearAllMocks())

const item = (over = {}) => ({
  item_id: 't1',
  filename: 'goblin.png',
  has_thumbnail: false,
  ...over,
})

describe('TokenFavorite', () => {
  it('renders the filename in grid mode and navigates on click', async () => {
    render(<TokenFavorite item={item()} grid />)
    expect(screen.getByText('goblin.png')).toBeInTheDocument()
    await userEvent.click(screen.getByText('goblin.png'))
    expect(navigate).toHaveBeenCalledWith('/tokens/t1')
  })

  it('renders in row mode and navigates on click', async () => {
    render(<TokenFavorite item={item()} grid={false} />)
    await userEvent.click(screen.getByText('goblin.png'))
    expect(navigate).toHaveBeenCalledWith('/tokens/t1')
  })

  it('renders the thumbnail (lazy) when has_thumbnail is set', () => {
    const { container } = render(<TokenFavorite item={item({ has_thumbnail: true })} grid />)
    const img = container.querySelector('img')
    expect(img.getAttribute('src')).toContain('/tokens/t1/thumbnail')
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('falls back to an icon when no thumbnail', () => {
    const { container } = render(<TokenFavorite item={item()} grid />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).toBeTruthy()
  })
})
