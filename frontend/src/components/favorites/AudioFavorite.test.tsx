import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentProps } from 'react'
import AudioFavorite from './AudioFavorite'
import type { Schema } from '../../api'

vi.mock('../../api', () => ({ mediaUrl: (p: string) => `http://localhost${p}` }))
vi.mock('../FavoriteButton', () => ({ default: () => <button>fav</button> }))

beforeEach(() => vi.clearAllMocks())

// Only the fields the card reads.
const track = (over: Record<string, unknown> = {}) =>
  ({
    item_id: 'a1',
    title: 'Tavern Night',
    filename: 'tavern.mp3',
    has_artwork: false,
    ...over,
  }) as unknown as Schema<'FavoriteAudioItem'>

function renderAudio(props: ComponentProps<typeof AudioFavorite>) {
  return render(
    <MemoryRouter>
      <AudioFavorite {...props} />
    </MemoryRouter>
  )
}

describe('AudioFavorite', () => {
  it('renders the title in grid mode as a real link', () => {
    renderAudio({ item: track(), grid: true })
    expect(screen.getByText('Tavern Night')).toBeInTheDocument()
    // CardLink renders a real anchor; native browser handles navigation.
    const link = screen.getByRole('link', { name: 'Tavern Night' })
    expect(link).toHaveAttribute('href', '/audio/a1')
  })

  it('falls back to filename when title is empty', () => {
    renderAudio({ item: track({ title: '' }), grid: true })
    expect(screen.getByText('tavern.mp3')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'tavern.mp3' })
    expect(link).toHaveAttribute('href', '/audio/a1')
  })

  it('renders artwork image when has_artwork', () => {
    const { container } = renderAudio({ item: track({ has_artwork: true }), grid: true })
    const img = container.querySelector('img')
    expect(img).toBeTruthy()
    expect(img!.getAttribute('src')).toContain('/audio/a1/artwork')
  })

  it('renders in row mode (no grid) as a real link', () => {
    renderAudio({ item: track(), grid: false })
    expect(screen.getByText('Tavern Night')).toBeInTheDocument()
    // CardLink is still present; middle-click / ctrl-click works natively.
    const link = screen.getByRole('link', { name: 'Tavern Night' })
    expect(link).toHaveAttribute('href', '/audio/a1')
  })
})
