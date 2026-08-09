import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
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

function renderEmbed(props) {
  return render(
    <MemoryRouter>
      <EmbedCard {...props} />
    </MemoryRouter>
  )
}

describe('EmbedCard', () => {
  beforeEach(() => {
    get.mockReset()
    get.mockResolvedValue({ title: "Player's Handbook" })
  })

  it('renders a play control for audio embeds', () => {
    renderEmbed({ spec: 'audio:track123', campaignId: 'c1' })
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(screen.getByText('Audio')).toBeInTheDocument()
  })

  it('plays the embedded track in the global player', async () => {
    renderEmbed({ spec: 'audio:track123', campaignId: 'c1' })
    await userEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(playQueue).toHaveBeenCalledWith([{ id: 'track123' }])
  })

  // Audio label is a real Link to /audio/:id so middle/ctrl-click opens new tab natively.
  it('renders the audio label as a link to the detail page', () => {
    renderEmbed({ spec: 'audio:track123', campaignId: 'c1' })
    const link = screen.getByRole('link', { name: /audio/i })
    expect(link.getAttribute('href')).toBe('/audio/track123')
  })

  // Map embed is a real Link so middle/ctrl-click opens new tab natively.
  it('renders a link card for a map embed', () => {
    renderEmbed({ spec: 'map:m1', campaignId: 'c1' })
    const link = screen.getByRole('link', { name: /map/i })
    expect(link.getAttribute('href')).toBe('/maps/m1')
    // Only book embeds resolve a title.
    expect(get).not.toHaveBeenCalled()
  })

  it('names the book alongside the page for a page-anchored book embed', async () => {
    renderEmbed({ spec: 'book:b1:42', campaignId: 'c1' })
    expect(await screen.findByText("Player's Handbook — p. 42")).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/books/b1')
  })

  it('names the book for an embed without a page', async () => {
    renderEmbed({ spec: 'book:b1', campaignId: 'c1' })
    expect(await screen.findByText("Player's Handbook")).toBeInTheDocument()
  })

  it('book embed is a link to the book page anchor', async () => {
    renderEmbed({ spec: 'book:b1:42', campaignId: 'c1' })
    await screen.findByText("Player's Handbook — p. 42")
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/library/book/b1?page=42')
  })

  it('falls back to the generic label when the book cannot be resolved', async () => {
    get.mockRejectedValue(new Error('404'))
    renderEmbed({ spec: 'book:gone:42', campaignId: 'c1' })
    expect(await screen.findByText('Book — p. 42')).toBeInTheDocument()
  })

  it('falls back to the generic label when the book has no title', async () => {
    get.mockResolvedValue({ title: '' })
    renderEmbed({ spec: 'book:b1', campaignId: 'c1' })
    expect(await screen.findByText('Book')).toBeInTheDocument()
  })

  // File embeds are plain <a href> so they open in a new tab natively.
  it('renders a file embed as an anchor opening in a new tab', () => {
    renderEmbed({ spec: 'file:doc555', campaignId: 'camp1' })
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toContain('/campaigns/camp1/files/doc555')
    expect(link.getAttribute('target')).toBe('_blank')
  })
})
