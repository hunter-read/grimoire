import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import EmbedCard from './EmbedCard'

const get = vi.fn()
vi.mock('../../api', () => ({
  client: { get: (...args: unknown[]) => get(...args) },
  campaigns: {
    fileUrl: (cid: string, id: string) => `http://localhost/campaigns/${cid}/files/${id}`,
  },
  mediaUrl: (path: string) => `http://localhost${path}`,
}))

const openingPageUrls = vi.fn((book: { id: string }, page?: number | null) => [
  `/pages/${book.id}/${page ?? 'saved'}`,
])
const prefetchInBackground = vi.fn()
const prefetchNow = vi.fn()
vi.mock('../reader/pagePrefetch', () => ({
  openingPageUrls: (...args: Parameters<typeof openingPageUrls>) => openingPageUrls(...args),
  prefetchInBackground: (...args: unknown[]) => prefetchInBackground(...args),
  prefetchNow: (...args: unknown[]) => prefetchNow(...args),
}))

const playQueue = vi.fn()
vi.mock('../../context/AudioPlayerContext', () => ({
  useAudioPlayer: () => ({
    playQueue,
    playNext: vi.fn(),
    togglePlay: vi.fn(),
    isCurrent: () => false,
    isPlayingId: () => false,
    inQueue: () => false,
  }),
}))

function renderEmbed(props: ComponentProps<typeof EmbedCard>) {
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
    openingPageUrls.mockClear()
    prefetchInBackground.mockReset()
    prefetchNow.mockReset()
  })

  it('renders a play control for audio embeds', () => {
    get.mockReturnValue(new Promise(() => {}))
    renderEmbed({ spec: 'audio:track123', campaignId: 'c1' })
    // Until the track has loaded the card has no name to give it.
    expect(screen.getByRole('button', { name: 'Play Untitled track' })).toBeInTheDocument()
    expect(screen.getByText('Audio')).toBeInTheDocument()
  })

  it('names the embedded track once it has loaded', async () => {
    get.mockResolvedValue({ title: 'Tavern Ambience', filename: 'tavern.mp3' })
    renderEmbed({ spec: 'audio:track123', campaignId: 'c1' })
    expect(await screen.findByRole('button', { name: 'Play Tavern Ambience' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /tavern ambience/i })).toHaveAttribute(
      'href',
      '/audio/track123'
    )
  })

  it('plays the embedded track in the global player', async () => {
    get.mockResolvedValue({ title: 'Tavern Ambience', filename: 'tavern.mp3' })
    renderEmbed({ spec: 'audio:track123', campaignId: 'c1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Play Tavern Ambience' }))
    expect(playQueue).toHaveBeenCalledWith([{ id: 'track123', title: 'Tavern Ambience' }])
  })

  // Audio label is a real Link to /audio/:id so middle/ctrl-click opens new tab natively.
  it('renders the audio label as a link to the detail page', () => {
    get.mockReturnValue(new Promise(() => {}))
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
    expect(await screen.findByText("Player's Handbook - p. 42")).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/books/{book_id}', { path: { book_id: 'b1' } })
  })

  it('names the book for an embed without a page', async () => {
    renderEmbed({ spec: 'book:b1', campaignId: 'c1' })
    expect(await screen.findByText("Player's Handbook")).toBeInTheDocument()
  })

  it('book embed is a link to the book page anchor', async () => {
    renderEmbed({ spec: 'book:b1:42', campaignId: 'c1' })
    await screen.findByText("Player's Handbook - p. 42")
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/library/book/b1?page=42')
  })

  it('falls back to the generic label when the book cannot be resolved', async () => {
    get.mockRejectedValue(new Error('404'))
    renderEmbed({ spec: 'book:gone:42', campaignId: 'c1' })
    expect(await screen.findByText('Book - p. 42')).toBeInTheDocument()
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

  it('fetches a book title through the typed client', async () => {
    renderEmbed({ spec: 'book:b-1', campaignId: 'c1' })
    expect(await screen.findByText("Player's Handbook")).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/books/{book_id}', { path: { book_id: 'b-1' } })
  })

  it.each(['book:../users', 'book:x?y=1', 'map:a/b', 'book:abc:2x', 'token:'])(
    'renders nothing and fetches nothing for a malformed spec (%s)',
    (spec) => {
      const { container } = renderEmbed({ spec, campaignId: 'c1' })
      expect(container).toBeEmptyDOMElement()
      expect(get).not.toHaveBeenCalled()
    }
  )

  // Issue #640: a book-page link warms its page while the note is open.
  describe('page prefetch', () => {
    const BOOK = { id: 'b1', title: "Player's Handbook", content_token: 'tok' }

    beforeEach(() => {
      get.mockResolvedValue(BOOK)
    })

    it('warms the linked page in the background once the book has loaded', async () => {
      renderEmbed({ spec: 'book:b1:42', campaignId: 'c1', prefetch: true })
      await waitFor(() => expect(prefetchInBackground).toHaveBeenCalledWith(['/pages/b1/42']))
      expect(openingPageUrls).toHaveBeenCalledWith(BOOK, 42)
    })

    it('drops the queued page when the note is closed', async () => {
      const cancel = vi.fn()
      prefetchInBackground.mockReturnValue(cancel)
      const { unmount } = renderEmbed({ spec: 'book:b1:42', campaignId: 'c1', prefetch: true })
      await waitFor(() => expect(prefetchInBackground).toHaveBeenCalled())
      unmount()
      expect(cancel).toHaveBeenCalled()
    })

    it('leaves it to the note to choose which embeds prefetch', async () => {
      renderEmbed({ spec: 'book:b1:42', campaignId: 'c1' })
      await screen.findByText("Player's Handbook - p. 42")
      expect(prefetchInBackground).not.toHaveBeenCalled()
    })

    it('does not prefetch a book link without a page', async () => {
      renderEmbed({ spec: 'book:b1', campaignId: 'c1', prefetch: true })
      await screen.findByText("Player's Handbook")
      expect(prefetchInBackground).not.toHaveBeenCalled()
    })

    it('prefetches nothing for a book the viewer cannot open', async () => {
      get.mockRejectedValue(new Error('404'))
      renderEmbed({ spec: 'book:gone:42', campaignId: 'c1', prefetch: true })
      await screen.findByText('Book - p. 42')
      expect(prefetchInBackground).not.toHaveBeenCalled()
    })

    it('loads the page as soon as the link is pressed', async () => {
      renderEmbed({ spec: 'book:b1:42', campaignId: 'c1' })
      fireEvent.pointerDown(await screen.findByRole('link'), { pointerType: 'mouse' })
      expect(prefetchNow).toHaveBeenCalledWith(['/pages/b1/42'])
    })

    it('loads where the reader left off for a link without a page', async () => {
      renderEmbed({ spec: 'book:b1', campaignId: 'c1' })
      await screen.findByText("Player's Handbook")
      fireEvent.pointerDown(screen.getByRole('link'), { pointerType: 'mouse' })
      expect(prefetchNow).toHaveBeenCalledWith(['/pages/b1/saved'])
    })

    it('has nothing to load before the book has', () => {
      get.mockReturnValue(new Promise(() => {}))
      renderEmbed({ spec: 'book:b1:42', campaignId: 'c1' })
      fireEvent.pointerDown(screen.getByRole('link'), { pointerType: 'mouse' })
      expect(prefetchNow).toHaveBeenCalledWith([])
    })

    it('does not prefetch for other embeds', () => {
      renderEmbed({ spec: 'map:m1', campaignId: 'c1', prefetch: true })
      fireEvent.pointerDown(screen.getByRole('link'), { pointerType: 'mouse' })
      expect(prefetchNow).not.toHaveBeenCalled()
    })
  })

  describe('image embeds', () => {
    const src = 'http://localhost/campaigns/c1/files/img1'

    it('shows the image inline, without a dialog', () => {
      const { container } = renderEmbed({ spec: 'image:img1', campaignId: 'c1' })
      expect(container.querySelector('img')).toHaveAttribute('src', src)
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('opens the image full screen on a click, and closes it with Escape', async () => {
      const user = userEvent.setup()
      renderEmbed({ spec: 'image:img1', campaignId: 'c1' })
      await user.click(screen.getByRole('button', { name: 'Open the image full screen' }))
      const dialog = screen.getByRole('dialog')
      expect(dialog.querySelector('img')).toHaveAttribute('src', src)
      expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('closes from the close button and from the backdrop, not from the image', async () => {
      const user = userEvent.setup()
      renderEmbed({ spec: 'image:img1', campaignId: 'c1' })
      const open = screen.getByRole('button', { name: 'Open the image full screen' })
      await user.click(open)
      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('dialog')).toBeNull()

      await user.click(open)
      const dialog = screen.getByRole('dialog')
      const img = dialog.querySelector('img') as HTMLImageElement
      await user.click(img)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(img.style.cursor).toBe('zoom-out')
      await user.click(dialog)
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('renders nothing without a campaign', () => {
      const { container } = renderEmbed({ spec: 'image:img1' })
      expect(container).toBeEmptyDOMElement()
    })
  })
})
