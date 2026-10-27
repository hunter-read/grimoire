import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentProps } from 'react'
import MapFavorite from './MapFavorite'
import type { Schema } from '../../api'

vi.mock('../../api', () => ({ mediaUrl: (p: string) => `http://localhost${p}` }))
vi.mock('../FavoriteButton', () => ({ default: () => <button>fav</button> }))

beforeEach(() => vi.clearAllMocks())

// Only the fields the card reads.
const item = (over: Record<string, unknown> = {}) =>
  ({
    item_id: 'm1',
    filename: 'cave.png',
    has_thumbnail: false,
    ...over,
  }) as unknown as Schema<'FavoriteMapItem'>

function renderMap(props: ComponentProps<typeof MapFavorite>) {
  return render(
    <MemoryRouter>
      <MapFavorite {...props} />
    </MemoryRouter>
  )
}

describe('MapFavorite', () => {
  it('renders the filename in grid mode as a real link', () => {
    renderMap({ item: item(), grid: true })
    expect(screen.getByText('cave.png')).toBeInTheDocument()
    // CardLink renders a real anchor; middle-click / ctrl-click works natively.
    const link = screen.getByRole('link', { name: 'cave.png' })
    expect(link).toHaveAttribute('href', '/maps/m1')
  })

  it('renders in row mode as a real link', () => {
    renderMap({ item: item(), grid: false })
    const link = screen.getByRole('link', { name: 'cave.png' })
    expect(link).toHaveAttribute('href', '/maps/m1')
  })

  it('renders the thumbnail (lazy) when has_thumbnail is set', () => {
    const { container } = renderMap({ item: item({ has_thumbnail: true }), grid: true })
    const img = container.querySelector('img')
    expect(img!.getAttribute('src')).toContain('/maps/m1/thumbnail')
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('renders the thumbnail in row mode too', () => {
    const { container } = renderMap({ item: item({ has_thumbnail: true }), grid: false })
    expect(container.querySelector('img')!.getAttribute('src')).toContain('/maps/m1/thumbnail')
  })

  it('falls back to an icon when no thumbnail', () => {
    const { container } = renderMap({ item: item(), grid: true })
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).toBeTruthy()
  })
})
