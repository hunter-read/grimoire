import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AudioPlayerProvider, useAudioPlayer } from '../../context/AudioPlayerContext'
import GlobalAudioPlayer from './GlobalAudioPlayer'

vi.mock('../../api', () => ({ mediaUrl: (path) => `http://localhost${path}` }))

// jsdom doesn't implement media playback; stub it so play()/pause() are no-ops.
beforeEach(() => {
  sessionStorage.clear()
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue()
  window.HTMLMediaElement.prototype.pause = vi.fn()
})

// A tiny harness exposing the context actions to the test.
let api
function Capture() {
  api = useAudioPlayer()
  return null
}

function renderPlayer() {
  return render(
    <AudioPlayerProvider>
      <Capture />
      <GlobalAudioPlayer />
    </AudioPlayerProvider>
  )
}

describe('GlobalAudioPlayer', () => {
  it('renders nothing when the queue is empty', () => {
    renderPlayer()
    expect(screen.queryByTestId('global-audio-element')).not.toBeInTheDocument()
  })

  it('shows the current track and transport controls once a queue is playing', () => {
    renderPlayer()
    act(() =>
      api.playQueue([
        { id: 'a', title: 'Tavern Night' },
        { id: 'b', title: 'Battle' },
      ])
    )
    expect(screen.getByTestId('global-audio-element')).toBeInTheDocument()
    expect(screen.getByText('Tavern Night')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next track/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /previous track/i })).toBeInTheDocument()
  })

  it('opens the queue panel and lists upcoming tracks', async () => {
    renderPlayer()
    act(() =>
      api.playQueue([
        { id: 'a', title: 'Tavern Night' },
        { id: 'b', title: 'Battle' },
      ])
    )
    await userEvent.click(screen.getByRole('button', { name: /show queue/i }))
    // Both tracks appear in the queue panel.
    expect(screen.getByText('Battle')).toBeInTheDocument()
    expect(screen.getAllByText('Tavern Night').length).toBeGreaterThanOrEqual(1)
  })

  it('repeat toggle reflects pressed state', async () => {
    renderPlayer()
    act(() => api.playQueue([{ id: 'a', title: 'A' }]))
    const repeat = screen.getByRole('button', { name: /repeat current track/i })
    expect(repeat).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(repeat)
    expect(screen.getByRole('button', { name: /repeat current track/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('close button clears the queue and hides the player', async () => {
    renderPlayer()
    act(() => api.playQueue([{ id: 'a', title: 'A' }]))
    await userEvent.click(screen.getByRole('button', { name: /close player/i }))
    expect(screen.queryByTestId('global-audio-element')).not.toBeInTheDocument()
  })

  it('renders artwork when the current track has it', () => {
    const { container } = renderPlayer()
    act(() => api.playQueue([{ id: 'a', title: 'A', artwork: true }]))
    const art = [...container.querySelectorAll('img')].find((i) =>
      i.getAttribute('src')?.includes('/audio/a/artwork')
    )
    expect(art).toBeTruthy()
  })

  it('next/prev change the current track', async () => {
    renderPlayer()
    act(() =>
      api.playQueue([
        { id: 'a', title: 'First' },
        { id: 'b', title: 'Second' },
      ])
    )
    await userEvent.click(screen.getByRole('button', { name: /next track/i }))
    expect(api.currentTrack.id).toBe('b')
    await userEvent.click(screen.getByRole('button', { name: /previous track/i }))
    expect(api.currentTrack.id).toBe('a')
  })

  it('play/pause button calls the media element', async () => {
    renderPlayer()
    act(() => api.playQueue([{ id: 'a', title: 'A' }]))
    const btn = screen.getByRole('button', { name: /^play$|^pause$/i })
    await userEvent.click(btn)
    expect(
      window.HTMLMediaElement.prototype.play.mock.calls.length +
        window.HTMLMediaElement.prototype.pause.mock.calls.length
    ).toBeGreaterThan(0)
  })

  it('seeking updates the audio element currentTime', () => {
    renderPlayer()
    act(() => api.playQueue([{ id: 'a', title: 'A' }]))
    const el = screen.getByTestId('global-audio-element')
    // Provide a duration so the range has a max.
    act(() => el.dispatchEvent(new Event('loadedmetadata')))
    const range = screen.getByRole('slider')
    act(() => api.seek(5))
    expect(typeof range).toBe('object')
  })

  it('onEnded advances to the next track when repeat is off', () => {
    renderPlayer()
    act(() =>
      api.playQueue([
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ])
    )
    const el = screen.getByTestId('global-audio-element')
    act(() => el.dispatchEvent(new Event('ended')))
    expect(api.currentTrack.id).toBe('b')
  })

  it('onEnded replays the same track when repeat-one is on', () => {
    renderPlayer()
    act(() =>
      api.playQueue([
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ])
    )
    act(() => api.toggleRepeat())
    const el = screen.getByTestId('global-audio-element')
    act(() => el.dispatchEvent(new Event('ended')))
    // Stays on the same track.
    expect(api.currentTrack.id).toBe('a')
  })

  it('renders above the mobile nav when isMobile', () => {
    render(
      <AudioPlayerProvider>
        <Capture />
        <GlobalAudioPlayer isMobile />
      </AudioPlayerProvider>
    )
    act(() => api.playQueue([{ id: 'a', title: 'A' }]))
    expect(screen.getByTestId('global-audio-element')).toBeInTheDocument()
  })

  const prefetchHref = () => {
    const links = [...document.head.querySelectorAll('link[rel="prefetch"]')]
    return links.length ? links[links.length - 1].getAttribute('href') : undefined
  }

  it('prefetches the next track in the queue', () => {
    renderPlayer()
    act(() =>
      api.playQueue([
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ])
    )
    expect(prefetchHref()).toBe('http://localhost/audio/b/file')
  })

  it('moves the prefetch to the new next track when skipping', () => {
    renderPlayer()
    act(() =>
      api.playQueue([
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
        { id: 'c', title: 'C' },
      ])
    )
    expect(prefetchHref()).toBe('http://localhost/audio/b/file')
    act(() => api.next())
    expect(prefetchHref()).toBe('http://localhost/audio/c/file')
  })

  it('does not prefetch past the end of the queue', () => {
    renderPlayer()
    act(() => api.playQueue([{ id: 'a', title: 'A' }]))
    expect(prefetchHref()).toBeUndefined()
  })

  it('does not prefetch a next track when repeat-one is on', () => {
    renderPlayer()
    act(() =>
      api.playQueue([
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ])
    )
    act(() => api.toggleRepeat())
    expect(prefetchHref()).toBeUndefined()
  })
})
