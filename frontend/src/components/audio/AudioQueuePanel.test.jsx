import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AudioQueuePanel from './AudioQueuePanel'

vi.mock('../../api', () => ({ mediaUrl: (p) => `http://localhost${p}` }))

const jumpTo = vi.fn()
const removeAt = vi.fn()
const moveTrack = vi.fn()
let queue = []
let currentIndex = 0

vi.mock('../../context/AudioPlayerContext', () => ({
  useAudioPlayer: () => ({ queue, currentIndex, jumpTo, removeAt, moveTrack }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  queue = []
  currentIndex = 0
})

describe('AudioQueuePanel', () => {
  it('shows an empty state when the queue is empty', () => {
    queue = []
    render(<AudioQueuePanel />)
    expect(screen.getByText(/queue is empty/i)).toBeInTheDocument()
  })

  it('lists tracks and highlights the current one', () => {
    queue = [
      { id: 'a', title: 'First' },
      { id: 'b', title: 'Second' },
    ]
    currentIndex = 1
    render(<AudioQueuePanel />)
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  it('falls back to a label for untitled tracks and renders artwork', () => {
    queue = [{ id: 'a', title: '', artwork: true }]
    const { container } = render(<AudioQueuePanel />)
    expect(screen.getByText(/untitled/i)).toBeInTheDocument()
    expect(container.querySelector('img')?.getAttribute('src')).toContain('/audio/a/artwork')
  })

  it('jumps to a track when its row is clicked', async () => {
    queue = [
      { id: 'a', title: 'First' },
      { id: 'b', title: 'Second' },
    ]
    render(<AudioQueuePanel />)
    await userEvent.click(screen.getByText('Second'))
    expect(jumpTo).toHaveBeenCalledWith(1)
  })

  it('removes a track when its remove button is clicked', async () => {
    queue = [{ id: 'a', title: 'First' }]
    render(<AudioQueuePanel />)
    await userEvent.click(screen.getByRole('button', { name: /remove from queue/i }))
    expect(removeAt).toHaveBeenCalledWith(0)
  })

  it('shows the artist when present', () => {
    queue = [{ id: 'a', title: 'First', artist: 'Bardcore' }]
    render(<AudioQueuePanel />)
    expect(screen.getByText('Bardcore')).toBeInTheDocument()
  })

  it('reorders the queue via drag and drop', () => {
    queue = [
      { id: 'a', title: 'First' },
      { id: 'b', title: 'Second' },
      { id: 'c', title: 'Third' },
    ]
    const { container } = render(<AudioQueuePanel />)
    const rows = [...container.querySelectorAll('[draggable="true"]')]
    expect(rows).toHaveLength(3)
    // Drag the third row's handle onto the first row.
    fireEvent.dragStart(rows[2])
    const firstRow = rows[0].closest('div')
    fireEvent.dragOver(firstRow)
    fireEvent.drop(firstRow)
    expect(moveTrack).toHaveBeenCalledWith(2, 0)
  })

  it('does not call moveTrack when dropped on its own row', () => {
    queue = [
      { id: 'a', title: 'First' },
      { id: 'b', title: 'Second' },
    ]
    const { container } = render(<AudioQueuePanel />)
    const rows = [...container.querySelectorAll('[draggable="true"]')]
    fireEvent.dragStart(rows[0])
    const ownRow = rows[0].closest('div')
    fireEvent.dragOver(ownRow)
    fireEvent.drop(ownRow)
    expect(moveTrack).not.toHaveBeenCalled()
  })
})
