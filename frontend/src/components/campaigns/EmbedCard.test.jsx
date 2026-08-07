import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EmbedCard from './EmbedCard'

const get = vi.fn()
vi.mock('../../api', () => ({
  default: { get: (...args) => get(...args) },
  campaigns: { fileUrl: (cid, id) => `http://localhost/campaigns/${cid}/files/${id}` },
  mediaUrl: (path) => `http://localhost${path}`,
}))

const playQueue = vi.fn()
vi.mock('../../context/AudioPlayerContext', () => ({
  useAudioPlayer: () => ({
    playQueue,
    playNext: vi.fn(),
    togglePlay: vi.fn(),
    isCurrent: () => false,
    isPlayingId: () => false,
  }),
}))

describe('EmbedCard', () => {
  beforeEach(() => {
    get.mockReset()
    get.mockResolvedValue({ title: "Player's Handbook" })
  })

  it('renders a play control for audio embeds', () => {
    render(<EmbedCard spec="audio:track123" campaignId="c1" onNavigate={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(screen.getByText('Audio')).toBeInTheDocument()
  })

  it('plays the embedded track in the global player', async () => {
    render(<EmbedCard spec="audio:track123" campaignId="c1" onNavigate={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(playQueue).toHaveBeenCalledWith([{ id: 'track123' }])
  })

  it('navigates to the audio detail page when the label is clicked', async () => {
    const onNavigate = vi.fn()
    render(<EmbedCard spec="audio:track123" campaignId="c1" onNavigate={onNavigate} />)
    await userEvent.click(screen.getByText('Audio'))
    expect(onNavigate).toHaveBeenCalledWith('/audio/track123')
  })

  it('renders a navigate card for a map embed', async () => {
    const onNavigate = vi.fn()
    render(<EmbedCard spec="map:m1" campaignId="c1" onNavigate={onNavigate} />)
    await userEvent.click(screen.getByText('Map'))
    expect(onNavigate).toHaveBeenCalledWith('/maps/m1')
    // Only book embeds resolve a title.
    expect(get).not.toHaveBeenCalled()
  })

  it('names the book alongside the page for a page-anchored book embed', async () => {
    render(<EmbedCard spec="book:b1:42" campaignId="c1" onNavigate={vi.fn()} />)
    expect(await screen.findByText("Player's Handbook — p. 42")).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/books/b1')
  })

  it('names the book for an embed without a page', async () => {
    render(<EmbedCard spec="book:b1" campaignId="c1" onNavigate={vi.fn()} />)
    expect(await screen.findByText("Player's Handbook")).toBeInTheDocument()
  })

  it('navigates to the book page anchor when clicked', async () => {
    const onNavigate = vi.fn()
    render(<EmbedCard spec="book:b1:42" campaignId="c1" onNavigate={onNavigate} />)
    await userEvent.click(await screen.findByText("Player's Handbook — p. 42"))
    expect(onNavigate).toHaveBeenCalledWith('/library/book/b1?page=42')
  })

  it('falls back to the generic label when the book cannot be resolved', async () => {
    get.mockRejectedValue(new Error('404'))
    render(<EmbedCard spec="book:gone:42" campaignId="c1" onNavigate={vi.fn()} />)
    expect(await screen.findByText('Book — p. 42')).toBeInTheDocument()
  })

  it('falls back to the generic label when the book has no title', async () => {
    get.mockResolvedValue({ title: '' })
    render(<EmbedCard spec="book:b1" campaignId="c1" onNavigate={vi.fn()} />)
    expect(await screen.findByText('Book')).toBeInTheDocument()
  })
})
