import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import GmBoard from './GmBoard'
import GmPanel from './GmPanel'
import { COLUMNS, GAP, ROW_HEIGHT } from './gridLayout'
import type { Panel } from './types'

let mockMobile = false
vi.mock('../../hooks/useIsMobile', () => ({ default: () => mockMobile }))
vi.mock('../../api', () => ({ campaigns: { wikiTitles: vi.fn().mockResolvedValue([]) } }))

const panel = (
  id: string,
  kind: string,
  x: number,
  y: number,
  w = 4,
  h = 3,
  title = ''
): Panel => ({
  id,
  kind,
  title,
  x,
  y,
  w,
  h,
  config: {},
  state: kind === 'counter' ? { value: 1 } : {},
})

const renderBoard = (panels: Panel[], onMove = vi.fn(), onSave = vi.fn(), onRemove = vi.fn()) => ({
  onMove,
  onSave,
  onRemove,
  ...render(
    <GmBoard
      panels={panels}
      onMove={onMove}
      renderPanel={(one, handles) => (
        <GmPanel
          panel={one}
          handles={handles}
          onSave={(patch) => onSave(one.id, patch)}
          onRemove={() => onRemove(one.id)}
        />
      )}
    />
  ),
})

// jsdom lays nothing out, so the board reads as the fallback width.
const step = (1200 - GAP * (COLUMNS - 1)) / COLUMNS + GAP

beforeEach(() => {
  mockMobile = false
  vi.restoreAllMocks()
})

describe('GmBoard', () => {
  it('puts each panel on its cells', () => {
    renderBoard([panel('a', 'counter', 2, 1, 3, 2, 'Fear')])
    const cell = document.querySelector<HTMLElement>('[data-panel-id="a"]')!
    expect(cell.style.gridColumn).toBe('3 / span 3')
    expect(cell.style.gridRow).toBe('2 / span 2')
    expect(screen.getByRole('heading', { name: 'Fear' })).toBeInTheDocument()
  })

  it('drags a panel, showing the drop before it is let go', () => {
    const { onMove } = renderBoard([panel('a', 'counter', 0, 0), panel('b', 'counter', 4, 0)])
    const handle = screen.getAllByRole('button', { name: /^Move/ })[0]
    const board = document.querySelector<HTMLElement>('.gm-board')!
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(board, { clientX: step * 4, clientY: 0, pointerId: 1 })
    // Previewed: a sits on b's cells, and b has been pushed below it.
    expect(document.querySelector<HTMLElement>('[data-panel-id="a"]')!.style.gridColumn).toBe(
      '5 / span 4'
    )
    expect(document.querySelector<HTMLElement>('[data-panel-id="b"]')!.style.gridRow).toBe(
      '4 / span 3'
    )
    expect(onMove).not.toHaveBeenCalled()
    fireEvent.pointerUp(board, { pointerId: 1 })
    const cells = onMove.mock.calls[0][0]
    expect(cells).toContainEqual({ id: 'a', x: 4, y: 0, w: 4, h: 3 })
    expect(cells).toContainEqual({ id: 'b', x: 4, y: 3, w: 4, h: 3 })
  })

  it('resizes from the corner', () => {
    const { onMove } = renderBoard([panel('a', 'counter', 0, 0)])
    const corner = document.querySelector<HTMLElement>('.gm-panel-resize')!
    const board = document.querySelector<HTMLElement>('.gm-board')!
    fireEvent.pointerDown(corner, { button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(board, { clientX: step * 2, clientY: (ROW_HEIGHT + GAP) * 2 })
    fireEvent.pointerUp(board)
    expect(onMove.mock.calls[0][0]).toEqual([{ id: 'a', x: 0, y: 0, w: 6, h: 5 }])
  })

  it('ignores a right-click and a move with no drag', () => {
    const { onMove } = renderBoard([panel('a', 'counter', 0, 0)])
    const board = document.querySelector<HTMLElement>('.gm-board')!
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Move/ }), { button: 2 })
    fireEvent.pointerMove(board, { clientX: 500 })
    fireEvent.pointerUp(board)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('moves with arrow keys and resizes with Shift', () => {
    const { onMove } = renderBoard([panel('a', 'counter', 1, 1)])
    const handle = screen.getByRole('button', { name: /^Move/ })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onMove.mock.lastCall![0]).toEqual([{ id: 'a', x: 2, y: 1, w: 4, h: 3 }])
    fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true })
    expect(onMove.mock.lastCall![0]).toEqual([{ id: 'a', x: 1, y: 1, w: 4, h: 4 }])
    fireEvent.keyDown(handle, { key: 'Enter' })
    expect(onMove).toHaveBeenCalledTimes(2)
  })

  it('stacks the panels in reading order on a phone, without moving them', () => {
    mockMobile = true
    renderBoard([
      panel('b', 'counter', 6, 0, 4, 3, 'Second'),
      panel('a', 'counter', 0, 0, 4, 3, 'First'),
    ])
    const titles = screen.getAllByRole('heading').map((heading) => heading.textContent)
    expect(titles).toEqual(['First', 'Second'])
    expect(screen.queryByRole('button', { name: /^Move/ })).not.toBeInTheDocument()
    expect(document.querySelector('.gm-panel-resize')).toBeNull()
  })
})

describe('GmPanelFrame', () => {
  it('opens settings on a draft and saves the title and config together', () => {
    const { onSave } = renderBoard([panel('a', 'counter', 0, 0)])
    fireEvent.click(screen.getByRole('button', { name: 'Settings for Counter' }))
    expect(screen.queryByRole('button', { name: 'Increase Counter' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Fear' } })
    fireEvent.change(screen.getByLabelText('Highest'), { target: { value: '12' } })
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Done/ }))
    expect(onSave).toHaveBeenCalledWith('a', {
      title: 'Fear',
      config: expect.objectContaining({ max: 12 }),
    })
  })

  it('throws a draft away on cancel, and saves a panel without settings', () => {
    const { onSave } = renderBoard([panel('a', 'counter', 0, 0), panel('s', 'scratch', 4, 0)])
    fireEvent.click(screen.getByRole('button', { name: 'Settings for Counter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Settings for Scratch note' }))
    fireEvent.click(screen.getByRole('button', { name: /Done/ }))
    expect(onSave).toHaveBeenCalledWith('s', { title: '', config: {} })
  })

  it('asks before removing a panel', () => {
    const { onRemove } = renderBoard([panel('a', 'counter', 0, 0, 3, 3, 'Fear')])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Fear' }))
    expect(onRemove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Fear' }))
    expect(onRemove).toHaveBeenCalledWith('a')
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('saves what a tool changes', () => {
    const { onSave } = renderBoard([panel('a', 'counter', 0, 0, 3, 3, 'Fear')])
    fireEvent.click(screen.getByRole('button', { name: 'Increase Fear' }))
    expect(onSave).toHaveBeenCalledWith('a', { state: { value: 2 } })
  })

  it('draws nothing for a kind this version does not know', () => {
    renderBoard([panel('a', 'macro', 0, 0)])
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })
})
