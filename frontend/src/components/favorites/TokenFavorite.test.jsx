import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TokenFavorite from './TokenFavorite'

vi.mock('../../api', () => ({ mediaUrl: (p) => `http://localhost${p}` }))
vi.mock('../FavoriteButton', () => ({ default: () => <button>fav</button> }))

beforeEach(() => vi.clearAllMocks())

const item = (over = {}) => ({
  item_id: 't1',
  filename: 'goblin.png',
  has_thumbnail: false,
  ...over,
})

function renderToken(props) {
  return render(
    <MemoryRouter>
      <TokenFavorite {...props} />
    </MemoryRouter>
  )
}

describe('TokenFavorite', () => {
  it('renders the filename in grid mode as a real link', () => {
    renderToken({ item: item(), grid: true })
    expect(screen.getByText('goblin.png')).toBeInTheDocument()
    // CardLink renders a real anchor; middle-click / ctrl-click works natively.
    const link = screen.getByRole('link', { name: 'goblin.png' })
    expect(link).toHaveAttribute('href', '/tokens/t1')
  })

  it('renders in row mode as a real link', () => {
    renderToken({ item: item(), grid: false })
    const link = screen.getByRole('link', { name: 'goblin.png' })
    expect(link).toHaveAttribute('href', '/tokens/t1')
  })

  it('renders the thumbnail (lazy) when has_thumbnail is set', () => {
    const { container } = renderToken({ item: item({ has_thumbnail: true }), grid: true })
    const img = container.querySelector('img')
    expect(img.getAttribute('src')).toContain('/tokens/t1/thumbnail')
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('falls back to an icon when no thumbnail', () => {
    const { container } = renderToken({ item: item(), grid: true })
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).toBeTruthy()
  })
})
