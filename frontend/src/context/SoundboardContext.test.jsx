import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SoundboardProvider, useSoundboard, clampLayout, DEFAULT_LAYOUT } from './SoundboardContext'

vi.mock('../api', () => ({
  default: { get: vi.fn(() => Promise.resolve({})) },
  mediaUrl: (path) => `http://test${path}`,
}))

import api from '../api'

// A fake <audio> good enough for the pad behaviour we assert on: play/pause,
// loop, currentTime, and the 'ended' listener the context attaches.
class FakeAudio {
  constructor(src) {
    this.src = src
    this.loop = false
    this.volume = 1
    this.currentTime = 0
    this.ended = false
    this.paused = true
    this.playCount = 0
    this.listeners = {}
    FakeAudio.instances.push(this)
  }
  addEventListener(type, fn) {
    this.listeners[type] = fn
  }
  play() {
    this.playCount += 1
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
  emit(type) {
    this.listeners[type]?.()
  }
  static instances = []
  static reset() {
    FakeAudio.instances = []
  }
}

let board
function Probe() {
  board = useSoundboard()
  return (
    <div>
      <span data-testid="count">{board.pads.length}</span>
      <span data-testid="layout">{`${board.layout.cols}x${board.layout.rows}`}</span>
      <span data-testid="open">{String(board.open)}</span>
      {board.pads.map((p) => (
        <span key={p.id} data-testid={`pad-${p.id}`}>
          {p.title}
          {board.isPadPlaying(p.id) ? ' playing' : ''}
          {p.loop ? ' loop' : ''}
        </span>
      ))}
    </div>
  )
}

const renderBoard = () =>
  render(
    <SoundboardProvider>
      <Probe />
    </SoundboardProvider>
  )

describe('SoundboardContext', () => {
  beforeEach(() => {
    localStorage.clear()
    FakeAudio.reset()
    global.Audio = FakeAudio
    api.get.mockReset()
    api.get.mockResolvedValue({})
  })

  it('starts empty with the default layout and closed panel', () => {
    renderBoard()
    expect(screen.getByTestId('count')).toHaveTextContent('0')
    expect(screen.getByTestId('layout')).toHaveTextContent(
      `${DEFAULT_LAYOUT.cols}x${DEFAULT_LAYOUT.rows}`
    )
    expect(screen.getByTestId('open')).toHaveTextContent('false')
  })

  it('adds pads, skips duplicates, and opens the panel', () => {
    renderBoard()
    act(() => {
      board.addPads([
        { id: 'a', title: 'Thunder' },
        { id: 'b', title: 'Door' },
      ])
    })
    expect(screen.getByTestId('count')).toHaveTextContent('2')
    expect(screen.getByTestId('open')).toHaveTextContent('true')

    let added
    act(() => {
      added = board.addPads([
        { id: 'a', title: 'Thunder' },
        { id: 'c', title: 'Bell' },
      ])
    })
    expect(added).toBe(1)
    expect(screen.getByTestId('count')).toHaveTextContent('3')
  })

  it('ignores tracks with no id', () => {
    renderBoard()
    act(() => {
      expect(board.addPads([null, {}, { title: 'no id' }])).toBe(0)
    })
    expect(screen.getByTestId('count')).toHaveTextContent('0')
  })

  it('plays a pad on its own element and marks it playing', async () => {
    renderBoard()
    act(() => board.addPads({ id: 'a', title: 'Thunder' }))
    await act(async () => board.trigger({ id: 'a', title: 'Thunder' }))

    expect(FakeAudio.instances).toHaveLength(1)
    expect(FakeAudio.instances[0].src).toBe('http://test/audio/a/file')
    await waitFor(() => expect(screen.getByTestId('pad-a')).toHaveTextContent('playing'))
  })

  it('restarts a one-shot pad instead of stopping it', async () => {
    renderBoard()
    act(() => board.addPads({ id: 'a', title: 'Thunder' }))
    const pad = { id: 'a', title: 'Thunder' }
    await act(async () => board.toggle(pad))
    const el = FakeAudio.instances[0]
    el.currentTime = 3
    await act(async () => board.toggle(pad))

    expect(FakeAudio.instances).toHaveLength(1)
    expect(el.playCount).toBe(2)
    expect(el.currentTime).toBe(0)
  })

  it('toggles a looping pad off on the second tap', async () => {
    renderBoard()
    act(() => board.addPads({ id: 'a', title: 'Thunder' }))
    act(() => board.setPadLoop('a', true))
    const pad = { id: 'a', title: 'Thunder', loop: true }

    await act(async () => board.toggle(pad))
    expect(FakeAudio.instances[0].loop).toBe(true)
    await waitFor(() => expect(screen.getByTestId('pad-a')).toHaveTextContent('playing'))

    await act(async () => board.toggle(pad))
    expect(FakeAudio.instances[0].paused).toBe(true)
    expect(screen.getByTestId('pad-a')).not.toHaveTextContent('playing')
  })

  it('layers pads: two sounds get two elements, both playing', async () => {
    renderBoard()
    act(() =>
      board.addPads([
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ])
    )
    await act(async () => {
      board.trigger({ id: 'a' })
      board.trigger({ id: 'b' })
    })
    expect(FakeAudio.instances).toHaveLength(2)
    await waitFor(() => {
      expect(screen.getByTestId('pad-a')).toHaveTextContent('playing')
      expect(screen.getByTestId('pad-b')).toHaveTextContent('playing')
    })
  })

  it('clears the playing flag when a one-shot ends', async () => {
    renderBoard()
    act(() => board.addPads({ id: 'a', title: 'A' }))
    await act(async () => board.trigger({ id: 'a' }))
    await waitFor(() => expect(screen.getByTestId('pad-a')).toHaveTextContent('playing'))

    act(() => FakeAudio.instances[0].emit('ended'))
    expect(screen.getByTestId('pad-a')).not.toHaveTextContent('playing')
  })

  it('stopAll silences every pad', async () => {
    renderBoard()
    act(() =>
      board.addPads([
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ])
    )
    await act(async () => {
      board.trigger({ id: 'a' })
      board.trigger({ id: 'b' })
    })
    act(() => board.stopAll())
    expect(FakeAudio.instances.every((el) => el.paused)).toBe(true)
    expect(screen.getByTestId('pad-a')).not.toHaveTextContent('playing')
  })

  it('removes a pad and stops its sound', async () => {
    renderBoard()
    act(() => board.addPads({ id: 'a', title: 'A' }))
    await act(async () => board.trigger({ id: 'a' }))
    act(() => board.removePad('a'))
    expect(screen.getByTestId('count')).toHaveTextContent('0')
    expect(FakeAudio.instances[0].paused).toBe(true)
  })

  it('reorders pads with movePad and ignores out-of-range moves', () => {
    renderBoard()
    act(() =>
      board.addPads([
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
        { id: 'c', title: 'C' },
      ])
    )
    act(() => board.movePad(0, 2))
    expect(board.pads.map((p) => p.id)).toEqual(['b', 'c', 'a'])
    act(() => board.movePad(0, 9))
    expect(board.pads.map((p) => p.id)).toEqual(['b', 'c', 'a'])
  })

  it('clearPads empties the board', async () => {
    renderBoard()
    act(() =>
      board.addPads([
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ])
    )
    await act(async () => board.trigger({ id: 'a' }))
    act(() => board.clearPads())
    expect(screen.getByTestId('count')).toHaveTextContent('0')
  })

  it('clamps the grid size to the supported range', () => {
    renderBoard()
    act(() => board.updateLayout({ cols: 99, rows: 99 }))
    expect(screen.getByTestId('layout')).toHaveTextContent('8x15')
    act(() => board.updateLayout({ cols: 0, rows: 0 }))
    expect(screen.getByTestId('layout')).toHaveTextContent('4x4')
    act(() => board.updateLayout({ cols: 5, rows: 5 }))
    expect(screen.getByTestId('layout')).toHaveTextContent('5x5')
  })

  it('persists pads, layout and position to localStorage', async () => {
    const { unmount } = renderBoard()
    act(() => board.addPads({ id: 'a', title: 'Thunder' }))
    act(() => board.updateLayout({ cols: 3, rows: 8 }))
    act(() => board.setPosition({ left: 40, top: 60 }))

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('grimoire:soundboard:pads'))).toHaveLength(1)
    )
    unmount()

    renderBoard()
    expect(screen.getByTestId('count')).toHaveTextContent('1')
    expect(screen.getByTestId('layout')).toHaveTextContent('3x8')
    expect(board.position).toEqual({ left: 40, top: 60 })
  })

  it('survives corrupt stored state', () => {
    localStorage.setItem('grimoire:soundboard:pads', 'not json')
    localStorage.setItem('grimoire:soundboard:layout', '{"cols":"x"}')
    renderBoard()
    expect(screen.getByTestId('count')).toHaveTextContent('0')
    expect(screen.getByTestId('layout')).toHaveTextContent('4x4')
  })

  it('resetPosition returns the panel to the corner', () => {
    renderBoard()
    act(() => board.setPosition({ left: 10, top: 10 }))
    act(() => board.resetPosition())
    expect(board.position).toBeNull()
  })

  it('hydrates a pad added with only an id', async () => {
    api.get.mockResolvedValue({ title: 'Fetched Title' })
    renderBoard()
    act(() => board.addPads({ id: 'a' }))
    await waitFor(() => expect(screen.getByTestId('pad-a')).toHaveTextContent('Fetched Title'))
    expect(api.get).toHaveBeenCalledWith('/audio/a')
  })

  it('stops retrying a pad whose lookup fails', async () => {
    api.get.mockRejectedValue(new Error('nope'))
    renderBoard()
    act(() => board.addPads({ id: 'a' }))
    await waitFor(() => expect(board.pads[0]._hydrated).toBe(true))
    const calls = api.get.mock.calls.length
    act(() => board.updateLayout({ cols: 2 }))
    expect(api.get.mock.calls.length).toBe(calls)
  })

  it('does not fetch metadata for a pad that already has a title', async () => {
    renderBoard()
    act(() => board.addPads({ id: 'a', title: 'Thunder' }))
    await waitFor(() => expect(screen.getByTestId('pad-a')).toHaveTextContent('Thunder'))
    expect(api.get).not.toHaveBeenCalled()
  })

  it('toggleOpen flips panel visibility', async () => {
    renderBoard()
    act(() => board.toggleOpen())
    expect(screen.getByTestId('open')).toHaveTextContent('true')
    act(() => board.toggleOpen())
    expect(screen.getByTestId('open')).toHaveTextContent('false')
  })

  it('hasPad reports membership', () => {
    renderBoard()
    act(() => board.addPads({ id: 'a', title: 'A' }))
    expect(board.hasPad('a')).toBe(true)
    expect(board.hasPad('zzz')).toBe(false)
  })

  it('falls back to a no-op board outside the provider', async () => {
    const user = userEvent.setup()
    function Outside() {
      const b = useSoundboard()
      return <button onClick={() => b.addPads({ id: 'a' })}>{`pads:${b.pads.length}`}</button>
    }
    render(<Outside />)
    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('button')).toHaveTextContent('pads:0')
  })

  describe('replacePads', () => {
    it('swaps the whole board and keeps each pad’s loop flag', () => {
      renderBoard()
      act(() => board.addPads([{ id: 'a', title: 'A' }]))

      let count
      act(() => {
        count = board.replacePads([
          { id: 'x', title: 'X', loop: true },
          { id: 'y', title: 'Y' },
        ])
      })

      expect(count).toBe(2)
      expect(screen.getByTestId('count')).toHaveTextContent('2')
      expect(screen.queryByTestId('pad-a')).toBeNull()
      expect(screen.getByTestId('pad-x')).toHaveTextContent('loop')
      expect(screen.getByTestId('pad-y')).not.toHaveTextContent('loop')
      expect(screen.getByTestId('open')).toHaveTextContent('true')
    })

    it('keeps pads the outgoing board also had', () => {
      // Regression: clearPads() + addPads() in one handler both read the same
      // committed pad list, so a track on both boards looked like a duplicate
      // and was dropped. A replace must carry it through.
      renderBoard()
      act(() =>
        board.addPads([
          { id: 'shared', title: 'Shared' },
          { id: 'old', title: 'Old' },
        ])
      )
      act(() => {
        board.replacePads([
          { id: 'shared', title: 'Shared' },
          { id: 'new', title: 'New' },
        ])
      })
      expect(screen.getByTestId('count')).toHaveTextContent('2')
      expect(screen.getByTestId('pad-shared')).toBeInTheDocument()
      expect(screen.getByTestId('pad-new')).toBeInTheDocument()
      expect(screen.queryByTestId('pad-old')).toBeNull()
    })

    it('drops entries with no id and de-dupes within the incoming list', () => {
      renderBoard()
      act(() => {
        board.replacePads([{ id: 'a', title: 'A' }, null, {}, { id: 'a', title: 'dupe' }])
      })
      expect(screen.getByTestId('count')).toHaveTextContent('1')
      expect(screen.getByTestId('pad-a')).toHaveTextContent('A')
    })

    it('accepts a single pad and empties the board for an empty list', () => {
      renderBoard()
      act(() => board.replacePads({ id: 'solo', title: 'Solo' }))
      expect(screen.getByTestId('count')).toHaveTextContent('1')
      act(() => board.replacePads([]))
      expect(screen.getByTestId('count')).toHaveTextContent('0')
    })

    it('stops any sound the outgoing board was playing', () => {
      renderBoard()
      act(() => board.addPads([{ id: 'a', title: 'A' }]))
      act(() => board.trigger({ id: 'a' }))
      const el = FakeAudio.instances.at(-1)
      act(() => board.replacePads([{ id: 'b', title: 'B' }]))
      expect(el.paused).toBe(true)
    })
  })

  it('clampLayout normalises arbitrary input', () => {
    expect(clampLayout({ cols: 5, rows: 5 })).toEqual({ cols: 5, rows: 5 })
    expect(clampLayout({ cols: 1, rows: 15 })).toEqual({ cols: 1, rows: 15 })
    expect(clampLayout({})).toEqual(DEFAULT_LAYOUT)
    expect(clampLayout(null)).toEqual(DEFAULT_LAYOUT)
    expect(clampLayout({ cols: 3.6, rows: 7.2 })).toEqual({ cols: 4, rows: 7 })
  })
})
