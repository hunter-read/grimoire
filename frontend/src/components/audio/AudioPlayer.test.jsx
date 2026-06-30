import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AudioPlayer from './AudioPlayer'

const playQueue = vi.fn()
const playNext = vi.fn()
const togglePlay = vi.fn()
let isCurrentReturn = false
let isPlayingReturn = false

vi.mock('../../context/AudioPlayerContext', () => ({
  useAudioPlayer: () => ({
    playQueue,
    playNext,
    togglePlay,
    isCurrent: () => isCurrentReturn,
    isPlayingId: () => isPlayingReturn,
  }),
}))

describe('AudioPlayer (controller)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isCurrentReturn = false
    isPlayingReturn = false
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
})
