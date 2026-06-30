import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EmbedCard from './EmbedCard'

vi.mock('../../api', () => ({
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
  })
})
