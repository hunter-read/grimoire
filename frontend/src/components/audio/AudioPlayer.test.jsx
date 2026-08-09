import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AudioPlayer from './AudioPlayer'

const playQueue = vi.fn()
const playNext = vi.fn()
const togglePlay = vi.fn()
let isCurrentReturn = false
let isPlayingReturn = false
let currentTimeReturn = 0
let durationReturn = 0

vi.mock('../../context/AudioPlayerContext', () => ({
  useAudioPlayer: () => ({
    playQueue,
    playNext,
    togglePlay,
    isCurrent: () => isCurrentReturn,
    isPlayingId: () => isPlayingReturn,
    currentTime: currentTimeReturn,
    duration: durationReturn,
  }),
}))

describe('AudioPlayer (controller)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isCurrentReturn = false
    isPlayingReturn = false
    currentTimeReturn = 0
    durationReturn = 0
  })

  it('renders a play button for a track', () => {
    render(<AudioPlayer track={{ id: 'a1', title: 'Tavern' }} />)
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument()
  })

  it('starts a single-track queue when the track is not current', async () => {
    render(<AudioPlayer track={{ id: 'a1', title: 'Tavern' }} />)
    await userEvent.click(screen.getByRole('button', { name: /play/i }))
    expect(playQueue).toHaveBeenCalledWith([{ id: 'a1', title: 'Tavern' }])
  })

  it('toggles play/pause when the track is already current', async () => {
    isCurrentReturn = true
    render(<AudioPlayer track={{ id: 'a1', title: 'Tavern' }} />)
    await userEvent.click(screen.getByRole('button', { name: /play|pause/i }))
    expect(togglePlay).toHaveBeenCalled()
    expect(playQueue).not.toHaveBeenCalled()
  })

  it('renders a Play Next button and queues the track when clicked', async () => {
    render(<AudioPlayer track={{ id: 'a1', title: 'Tavern' }} showPlayNext />)
    await userEvent.click(screen.getByRole('button', { name: /play next/i }))
    expect(playNext).toHaveBeenCalledWith({ id: 'a1', title: 'Tavern' })
  })

  it('renders nothing without a valid track', () => {
    const { container } = render(<AudioPlayer track={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  describe('progress ring', () => {
    const ring = (container) => container.firstChild

    it('draws no ring for a track that is not current', () => {
      currentTimeReturn = 30
      durationReturn = 60
      const { container } = render(<AudioPlayer track={{ id: 'a1' }} />)
      expect(ring(container)).toHaveStyle({ background: 'transparent' })
    })

    it('sweeps the ring to the fraction of the track played', () => {
      isCurrentReturn = true
      currentTimeReturn = 30
      durationReturn = 120
      const { container } = render(<AudioPlayer track={{ id: 'a1' }} />)
      // 25% played → a quarter turn.
      expect(ring(container).style.background).toContain('90deg')
    })

    it('leaves the ring empty when the duration is not known yet', () => {
      isCurrentReturn = true
      currentTimeReturn = 5
      durationReturn = 0
      const { container } = render(<AudioPlayer track={{ id: 'a1' }} />)
      expect(ring(container).style.background).toContain('0deg')
    })

    it('clamps progress past the end of the track to a full ring', () => {
      isCurrentReturn = true
      currentTimeReturn = 130
      durationReturn = 120
      const { container } = render(<AudioPlayer track={{ id: 'a1' }} />)
      expect(ring(container).style.background).toContain('360deg')
    })

    it('insets the button so the ring stays visible around it', () => {
      isCurrentReturn = true
      durationReturn = 60
      const { container } = render(<AudioPlayer track={{ id: 'a1' }} size={44} />)
      // size 44 − 2×round(44×0.07) → 44 − 6.
      expect(screen.getByRole('button', { name: /play/i })).toHaveStyle({
        width: '38px',
        height: '38px',
      })
      expect(ring(container)).toHaveStyle({ width: '44px', height: '44px' })
    })
  })
})
