import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import BannerHero from './BannerHero'
import { campaigns } from '../../api'

vi.mock('../../api', () => ({
  campaigns: {
    bannerUrl: (id, updated) => `http://localhost/banner/${id}?v=${updated}`,
    uploadBanner: vi.fn(() => Promise.resolve()),
    deleteBanner: vi.fn(() => Promise.resolve()),
    setBannerFromSource: vi.fn(() => Promise.resolve()),
    setBannerFocus: vi.fn(() => Promise.resolve()),
    // The picker offers the campaign's own images first (issue #286).
    listResources: vi.fn(() => Promise.resolve([])),
    fileUrl: (id, fileId) => `http://localhost/files/${id}/${fileId}`,
  },
}))

// Stub the picker modal to expose its callbacks as buttons.
vi.mock('./BannerUploadModal', () => ({
  default: ({ onPick, onPickSource, onFocusChange, onRemove, onClose }) => (
    <div data-testid="banner-modal">
      <button onClick={() => onPick(new File(['x'], 'b.png'))}>pick</button>
      <button onClick={() => onPickSource({ source_type: 'map', source_id: 'm1' })}>
        pick-source
      </button>
      <button onClick={() => onFocusChange(25)}>focus</button>
      <button onClick={onRemove}>remove</button>
      <button onClick={onClose}>close</button>
    </div>
  ),
}))

const withBanner = { id: 'c1', has_banner: true, updated_at: '2026-01-01T00:00:00Z' }
const noBanner = { id: 'c1', has_banner: false, updated_at: null }

describe('BannerHero', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })
  afterEach(() => {
    if (vi.isFakeTimers()) vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('renders nothing when there is no banner and the viewer is not the owner', () => {
    const { container } = render(
      <BannerHero campaign={noBanner} isOwner={false} onChanged={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the banner image when a banner exists', () => {
    render(<BannerHero campaign={withBanner} isOwner={false} onChanged={vi.fn()} />)
    const img = document.querySelector('img')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toContain('/banner/c1')
  })

  it('shows the empty-state upload button to the owner and opens the modal', () => {
    render(<BannerHero campaign={noBanner} isOwner={true} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByTestId('banner-modal')).toBeInTheDocument()
  })

  it('reveals the edit control only after a >1s hover for owners', () => {
    render(<BannerHero campaign={withBanner} isOwner={true} onChanged={vi.fn()} />)
    const hero = document.querySelector('div[style]')
    fireEvent.mouseEnter(hero)
    // Before the timer fires, the edit control is hidden.
    expect(screen.queryByTestId('banner-modal')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1000))
    // Edit control appears; clicking it opens the modal.
    fireEvent.click(screen.getByText(/edit/i))
    expect(screen.getByTestId('banner-modal')).toBeInTheDocument()
  })

  it('does not start the hover timer for non-owners', () => {
    render(<BannerHero campaign={withBanner} isOwner={false} onChanged={vi.fn()} />)
    const hero = document.querySelector('div[style]')
    fireEvent.mouseEnter(hero)
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByText(/edit/i)).not.toBeInTheDocument()
  })

  it('clears controls on mouse leave', () => {
    render(<BannerHero campaign={withBanner} isOwner={true} onChanged={vi.fn()} />)
    const hero = document.querySelector('div[style]')
    fireEvent.mouseEnter(hero)
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText(/edit/i)).toBeInTheDocument()
    fireEvent.mouseLeave(hero)
    expect(screen.queryByText(/edit/i)).not.toBeInTheDocument()
  })

  it('uploads a picked file and notifies onChanged', async () => {
    // Async flow needs real timers so awaited promises resolve.
    vi.useRealTimers()
    const onChanged = vi.fn()
    render(<BannerHero campaign={noBanner} isOwner={true} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: /add|banner|upload/i })) // open modal
    fireEvent.click(screen.getByText('pick'))
    expect(campaigns.uploadBanner).toHaveBeenCalledWith('c1', expect.any(File))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('removes the banner and notifies onChanged', async () => {
    vi.useRealTimers()
    const onChanged = vi.fn()
    render(<BannerHero campaign={noBanner} isOwner={true} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: /add|banner|upload/i })) // open modal
    fireEvent.click(screen.getByText('remove'))
    expect(campaigns.deleteBanner).toHaveBeenCalledWith('c1')
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('closes the modal', () => {
    render(<BannerHero campaign={noBanner} isOwner={true} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('close'))
    expect(screen.queryByTestId('banner-modal')).not.toBeInTheDocument()
  })
})
