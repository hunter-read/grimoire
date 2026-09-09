import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import SoundboardPanel from './SoundboardPanel'
import { SoundboardProvider, useSoundboard } from '../../context/SoundboardContext'
import api from '../../api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => (opts?.name ? `${key}:${opts.name}` : key),
  }),
}))

vi.mock('../../api', () => ({
  default: {
    // `get` serves both the pad-title hydration and the saved-set list
    // (useAudioSets), so it answers with a shape that satisfies either.
    get: vi.fn(() => Promise.resolve({ sets: [] })),
    post: vi.fn(() => Promise.resolve({ id: 'new' })),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  mediaUrl: (path) => `http://test${path}`,
}))

class FakeAudio {
  constructor(src) {
    this.src = src
    this.loop = false
    this.volume = 1
    this.currentTime = 0
    this.paused = true
    this.playCount = 0
    FakeAudio.instances.push(this)
  }
  addEventListener() {}
  play() {
    this.playCount += 1
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
  static instances = []
}

let board
function Harness({ seed = [] }) {
  board = useSoundboard()
  return (
    <>
      <button onClick={() => board.addPads(seed)}>seed</button>
      <SoundboardPanel />
    </>
  )
}

const setup = async (seed = []) => {
  const user = userEvent.setup()
  render(
    <SoundboardProvider>
      <Harness seed={seed} />
    </SoundboardProvider>
  )
  if (seed.length) await user.click(screen.getByText('seed'))
  return user
}

describe('SoundboardPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    FakeAudio.instances = []
    global.Audio = FakeAudio
  })

  it('shows an empty state with no pads', async () => {
    await setup()
    expect(screen.getByText('soundboard.empty')).toBeInTheDocument()
  })

  it('renders a pad button per sound', async () => {
    await setup([
      { id: 'a', title: 'Thunder' },
      { id: 'b', title: 'Door' },
    ])
    expect(screen.getByRole('button', { name: 'Thunder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Door' })).toBeInTheDocument()
  })

  it('plays a sound when a pad is clicked', async () => {
    const user = await setup([{ id: 'a', title: 'Thunder' }])
    await user.click(screen.getByRole('button', { name: 'Thunder' }))
    expect(FakeAudio.instances).toHaveLength(1)
    expect(FakeAudio.instances[0].src).toBe('http://test/audio/a/file')
    expect(FakeAudio.instances[0].playCount).toBe(1)
  })

  it('applies the configured grid size', async () => {
    const user = await setup([{ id: 'a', title: 'Thunder' }])
    await user.click(screen.getByRole('button', { name: 'soundboard.edit' }))

    // Two number inputs: columns then rows.
    const inputs = screen.getAllByRole('spinbutton')
    expect(inputs).toHaveLength(2)
    fireEvent.change(inputs[0], { target: { value: '5' } })
    fireEvent.change(inputs[1], { target: { value: '5' } })

    const grid = screen.getByRole('button', { name: 'Thunder' }).closest('div').parentElement
    expect(grid).toHaveStyle({ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' })
  })

  it('clamps an out-of-range grid size', async () => {
    const user = await setup([{ id: 'a', title: 'Thunder' }])
    await user.click(screen.getByRole('button', { name: 'soundboard.edit' }))
    const inputs = screen.getAllByRole('spinbutton')
    fireEvent.change(inputs[0], { target: { value: '40' } })
    expect(inputs[0]).toHaveValue(8)
  })

  it('reveals remove buttons only in edit mode', async () => {
    const user = await setup([{ id: 'a', title: 'Thunder' }])
    expect(screen.queryByRole('button', { name: 'soundboard.remove:Thunder' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'soundboard.edit' }))
    expect(screen.getByRole('button', { name: 'soundboard.remove:Thunder' })).toBeInTheDocument()
    expect(screen.getByText('soundboard.editHint')).toBeInTheDocument()
  })

  it('removes a pad from edit mode', async () => {
    const user = await setup([
      { id: 'a', title: 'Thunder' },
      { id: 'b', title: 'Door' },
    ])
    await user.click(screen.getByRole('button', { name: 'soundboard.edit' }))
    await user.click(screen.getByRole('button', { name: 'soundboard.remove:Thunder' }))
    expect(screen.queryByRole('button', { name: 'Thunder' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Door' })).toBeInTheDocument()
  })

  it('does not fire a sound when a pad is clicked in edit mode', async () => {
    const user = await setup([{ id: 'a', title: 'Thunder' }])
    await user.click(screen.getByRole('button', { name: 'soundboard.edit' }))
    await user.click(screen.getByRole('button', { name: 'Thunder' }))
    expect(FakeAudio.instances).toHaveLength(0)
  })

  it('reorders pads by dragging in edit mode', async () => {
    const user = await setup([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C' },
    ])
    await user.click(screen.getByRole('button', { name: 'soundboard.edit' }))

    const wrapperOf = (name) => screen.getByRole('button', { name }).parentElement
    fireEvent.dragStart(wrapperOf('A'))
    fireEvent.dragOver(wrapperOf('C'))
    fireEvent.drop(wrapperOf('C'))

    expect(board.pads.map((p) => p.id)).toEqual(['b', 'c', 'a'])
  })

  it('toggles loop on a pad', async () => {
    const user = await setup([{ id: 'a', title: 'Thunder' }])
    await user.click(screen.getByRole('button', { name: 'soundboard.loopOff:Thunder' }))
    expect(screen.getByRole('button', { name: 'soundboard.loopOn:Thunder' })).toBeInTheDocument()
    expect(board.pads[0].loop).toBe(true)
  })

  it('stops every sound from the stop-all button', async () => {
    const user = await setup([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ])
    await user.click(screen.getByRole('button', { name: 'A' }))
    await user.click(screen.getByRole('button', { name: 'B' }))
    await user.click(screen.getByRole('button', { name: 'soundboard.stopAll' }))
    expect(FakeAudio.instances.every((el) => el.paused)).toBe(true)
  })

  // The title-bar buttons sit inside the drag handle. A pointerdown on one
  // bubbles to the handle, and if the handle captures the pointer there, the
  // button never gets the matching pointerup, so the browser never synthesizes
  // a click — and preventDefault suppresses it outright as well. jsdom
  // implements neither pointer capture nor that click suppression, so asserting
  // on a resulting click passes even when the handle does swallow the press
  // (which is exactly how this shipped broken). These assert the mechanism.
  it.each([['soundboard.stopAll'], ['soundboard.edit'], ['soundboard.close']])(
    'a press on header button %s is not hijacked by the drag handle',
    async (name) => {
      await setup([{ id: 'a', title: 'Thunder' }])
      const handle = screen.getByTestId('soundboard-handle')
      const button = within(handle).getByRole('button', { name })

      // jsdom ships no pointer-capture implementation, so install one to observe.
      const capture = vi.fn()
      handle.setPointerCapture = capture
      handle.releasePointerCapture = vi.fn()
      const event = new MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 400,
        clientY: 400,
      })
      button.dispatchEvent(event)

      expect(capture).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
      expect(board.position).toBeNull()
    }
  )

  // One toggle governs sizing, rearranging and removing, so entering it must
  // reveal all three at once — that is the whole point of merging the buttons.
  it('reveals grid size, rearranging and removing from one toggle', async () => {
    const user = await setup([{ id: 'a', title: 'Thunder' }])
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'soundboard.remove:Thunder' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'soundboard.edit' }))

    expect(screen.getAllByRole('spinbutton')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'soundboard.remove:Thunder' })).toBeInTheDocument()
    expect(screen.getByText('soundboard.editHint')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thunder' })).toHaveStyle({ cursor: 'grab' })
  })

  it('clears every pad from the clear button', async () => {
    const user = await setup([
      { id: 'a', title: 'Thunder' },
      { id: 'b', title: 'Door' },
    ])
    await user.click(screen.getByRole('button', { name: 'soundboard.edit' }))
    await user.click(screen.getByRole('button', { name: 'soundboard.clear' }))

    expect(board.pads).toEqual([])
    expect(screen.getByText('soundboard.empty')).toBeInTheDocument()
  })

  it('stops any playing sound when the board is cleared', async () => {
    const user = await setup([{ id: 'a', title: 'Thunder' }])
    await user.click(screen.getByRole('button', { name: 'Thunder' }))
    await user.click(screen.getByRole('button', { name: 'soundboard.edit' }))
    await user.click(screen.getByRole('button', { name: 'soundboard.clear' }))

    expect(FakeAudio.instances[0].paused).toBe(true)
  })

  it('offers clear only in edit mode, and only with pads to clear', async () => {
    const user = await setup([{ id: 'a', title: 'Thunder' }])
    expect(screen.queryByRole('button', { name: 'soundboard.clear' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'soundboard.edit' }))
    expect(screen.getByRole('button', { name: 'soundboard.clear' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'soundboard.clear' }))
    expect(screen.queryByRole('button', { name: 'soundboard.clear' })).toBeNull()
  })

  it('leaving edit mode hides the grid size and remove controls again', async () => {
    const user = await setup([{ id: 'a', title: 'Thunder' }])
    await user.click(screen.getByRole('button', { name: 'soundboard.edit' }))
    await user.click(screen.getByRole('button', { name: 'soundboard.doneEditing' }))

    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'soundboard.remove:Thunder' })).toBeNull()
  })

  it('has one control for configuring, not two', async () => {
    await setup([{ id: 'a', title: 'Thunder' }])
    const handle = screen.getByTestId('soundboard-handle')
    // Save, stop-all, configure, close — the grid-size button is folded into
    // edit rather than sitting beside it.
    expect(within(handle).getAllByRole('button')).toHaveLength(4)
    expect(within(handle).queryByRole('button', { name: 'soundboard.columns' })).toBeNull()
  })

  it('offers no save control on an empty board', async () => {
    await setup([])
    const handle = screen.getByTestId('soundboard-handle')
    expect(within(handle).queryByRole('button', { name: 'audioSets.saveBoard' })).toBeNull()
    expect(within(handle).getAllByRole('button')).toHaveLength(3)
  })

  it('closes the panel', async () => {
    const user = await setup([{ id: 'a', title: 'Thunder' }])
    await user.click(screen.getByRole('button', { name: 'soundboard.close' }))
    expect(board.open).toBe(false)
  })

  it('still drags from the empty part of the handle', async () => {
    await setup([{ id: 'a', title: 'Thunder' }])
    const title = screen.getByText('soundboard.title')
    fireEvent.pointerDown(title, { clientX: 400, clientY: 400, pointerId: 1 })
    fireEvent.pointerMove(title, { clientX: 250, clientY: 180, pointerId: 1 })
    fireEvent.pointerUp(title, { pointerId: 1 })
    expect(board.position).not.toBeNull()
  })

  it('sits in the bottom-right corner until it is moved', async () => {
    await setup([{ id: 'a', title: 'Thunder' }])
    const panel = screen.getByTestId('soundboard-panel')
    expect(panel).toHaveStyle({ right: '16px' })
  })

  it('moves to where it is dragged and remembers the position', async () => {
    await setup([{ id: 'a', title: 'Thunder' }])
    const handle = screen.getByTestId('soundboard-handle')

    fireEvent.pointerDown(handle, { clientX: 500, clientY: 500, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(handle, { pointerId: 1 })

    expect(board.position).not.toBeNull()
    const panel = screen.getByTestId('soundboard-panel')
    expect(panel.style.left).not.toBe('')
    expect(panel.style.right).toBe('')
  })

  it('ignores pointer movement that did not start on the handle', async () => {
    await setup([{ id: 'a', title: 'Thunder' }])
    const handle = screen.getByTestId('soundboard-handle')
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 200, pointerId: 1 })
    expect(board.position).toBeNull()
  })

  it('keeps a dragged panel inside the viewport', async () => {
    await setup([{ id: 'a', title: 'Thunder' }])
    const handle = screen.getByTestId('soundboard-handle')
    fireEvent.pointerDown(handle, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: -900, clientY: -900, pointerId: 1 })
    fireEvent.pointerUp(handle, { pointerId: 1 })

    expect(board.position.left).toBeGreaterThanOrEqual(16)
    expect(board.position.top).toBeGreaterThanOrEqual(16)
  })

  it('marks a playing pad as pressed', async () => {
    const user = await setup([{ id: 'a', title: 'Thunder' }])
    const pad = screen.getByRole('button', { name: 'Thunder' })
    expect(pad).toHaveAttribute('aria-pressed', 'false')
    await user.click(pad)
    expect(screen.getByRole('button', { name: 'Thunder' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('labels an untitled pad', async () => {
    await setup([{ id: 'a', title: '' }])
    const grid = screen.getByTestId('soundboard-panel')
    expect(within(grid).getAllByRole('button', { name: 'soundboard.untitled' }).length).toBe(1)
  })
})

describe('SoundboardPanel — saving the board', () => {
  it('saves the pads, their loop flags, and the grid size', async () => {
    const user = await setup([
      { id: 'a', title: 'Thunder' },
      { id: 'b', title: 'Door' },
    ])
    await user.click(screen.getByRole('button', { name: 'soundboard.loopOff:Thunder' }))

    await user.click(screen.getByRole('button', { name: 'audioSets.saveBoard' }))
    await user.type(screen.getByLabelText('audioSets.nameLabel'), 'Tavern')
    await user.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/audio-sets', {
        kind: 'soundboard',
        name: 'Tavern',
        entries: [
          { audio_id: 'a', loop: true },
          { audio_id: 'b', loop: false },
        ],
        layout: { cols: 4, rows: 4 },
      })
    )
  })
})
