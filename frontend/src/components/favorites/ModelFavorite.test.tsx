import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentProps } from 'react'
import ModelFavorite from './ModelFavorite'
import type { Schema } from '../../api'

vi.mock('../../api', () => ({ mediaUrl: (p: string) => `http://localhost${p}` }))
vi.mock('../FavoriteButton', () => ({ default: () => <button>fav</button> }))

beforeEach(() => vi.clearAllMocks())

// Only the fields the card reads.
const item = (over: Record<string, unknown> = {}) =>
  ({
    item_id: 't1',
    filename: 'goblin.png',
    has_thumbnail: false,
    ...over,
  }) as unknown as Schema<'FavoriteModelItem'>

function renderModel(props: ComponentProps<typeof ModelFavorite>) {
  return render(
    <MemoryRouter>
      <ModelFavorite {...props} />
    </MemoryRouter>
  )
}

describe('ModelFavorite', () => {
  it('renders the filename in grid mode as a real link', () => {
    renderModel({ item: item(), grid: true })
    expect(screen.getByText('goblin.png')).toBeInTheDocument()
    // CardLink renders a real anchor; middle-click / ctrl-click works natively.
    const link = screen.getByRole('link', { name: 'goblin.png' })
    expect(link).toHaveAttribute('href', '/models/t1')
  })

  it('renders in row mode as a real link', () => {
    renderModel({ item: item(), grid: false })
    const link = screen.getByRole('link', { name: 'goblin.png' })
    expect(link).toHaveAttribute('href', '/models/t1')
  })

  it('renders the thumbnail (lazy) when has_thumbnail is set', () => {
    const { container } = renderModel({ item: item({ has_thumbnail: true }), grid: true })
    const img = container.querySelector('img')
    expect(img!.getAttribute('src')).toContain('/models/t1/thumbnail')
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('falls back to an icon when no thumbnail', () => {
    const { container } = renderModel({ item: item(), grid: true })
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).toBeTruthy()
  })
})
