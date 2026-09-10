import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VttToolbar from './VttToolbar'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}))

const props = {
  tool: 'wall',
  onTool: vi.fn(),
  snap: 'grid',
  onSnap: vi.fn(),
  showGrid: true,
  onToggleGrid: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  canUndo: false,
  canRedo: false,
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onFit: vi.fn(),
}

describe('VttToolbar', () => {
  it('marks the active tool', () => {
    render(<VttToolbar {...props} />)
    expect(screen.getByLabelText('maps.vtt.tools.wall')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('maps.vtt.tools.light')).toHaveAttribute('aria-pressed', 'false')
  })

  it('selects a tool', async () => {
    const onTool = vi.fn()
    render(<VttToolbar {...props} onTool={onTool} />)
    await userEvent.click(screen.getByLabelText('maps.vtt.tools.portal'))
    expect(onTool).toHaveBeenCalledWith('portal')
  })

  it('offers three snap modes rather than an on/off toggle', () => {
    // Grid intersections, half cells for a diagonal or a split doorway, and
    // free for an irregular cave wall — on/off would make one impossible.
    render(<VttToolbar {...props} />)
    expect(screen.getByRole('button', { name: 'maps.vtt.snap.grid' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'maps.vtt.snap.half' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'maps.vtt.snap.free' })).toBeInTheDocument()
  })

  it('changes the snap mode', async () => {
    const onSnap = vi.fn()
    render(<VttToolbar {...props} onSnap={onSnap} />)
    await userEvent.click(screen.getByRole('button', { name: 'maps.vtt.snap.free' }))
    expect(onSnap).toHaveBeenCalledWith('free')
  })

  it('disables undo and redo when there is no history', () => {
    render(<VttToolbar {...props} />)
    expect(screen.getByLabelText('maps.vtt.undo')).toBeDisabled()
    expect(screen.getByLabelText('maps.vtt.redo')).toBeDisabled()
  })

  it('drives undo when history exists', async () => {
    const onUndo = vi.fn()
    render(<VttToolbar {...props} canUndo onUndo={onUndo} />)
    await userEvent.click(screen.getByLabelText('maps.vtt.undo'))
    expect(onUndo).toHaveBeenCalled()
  })

  it('drives the view controls', async () => {
    const onZoomIn = vi.fn()
    const onFit = vi.fn()
    render(<VttToolbar {...props} onZoomIn={onZoomIn} onFit={onFit} />)
    await userEvent.click(screen.getByLabelText('maps.vtt.zoomIn'))
    await userEvent.click(screen.getByLabelText('maps.vtt.fit'))
    expect(onZoomIn).toHaveBeenCalled()
    expect(onFit).toHaveBeenCalled()
  })

  it('toggles the grid overlay', async () => {
    const onToggleGrid = vi.fn()
    render(<VttToolbar {...props} onToggleGrid={onToggleGrid} />)
    await userEvent.click(screen.getByLabelText('maps.vtt.toggleGrid'))
    expect(onToggleGrid).toHaveBeenCalled()
  })
})
