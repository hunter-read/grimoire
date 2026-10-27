import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VttSidebar from './VttSidebar'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}))

const wall = [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
]

const doc = {
  line_of_sight: [wall],
  objects_line_of_sight: [],
  portals: [{ bounds: wall, closed: true, freestanding: false }],
  lights: [{ position: { x: 1, y: 1 }, range: 4, intensity: 1, color: 'ffffffff', shadows: true }],
  environment: { baked_lighting: false, ambient_light: '00000000' },
}

const props = {
  doc,
  counts: { line_of_sight: 1, objects_line_of_sight: 0, portals: 1, lights: 1 },
  dims: { width: 10, height: 14 },
  cellPx: 140,
  selection: null,
  onSelect: vi.fn(),
  onUpdateFeature: vi.fn(),
  onDeleteFeature: vi.fn(),
  onEnvironment: vi.fn(),
  onRecalibrate: vi.fn(),
}

/**
 * Expand a collapsed section by clicking its header.
 *
 * Layers, grid, player view and environment start folded so the panel opens on
 * the selection rather than on six stacked blocks, so a test that reads their
 * contents has to open them first — the same click a user makes.
 */
const expand = async (title) => {
  const header = screen.getByRole('button', { name: new RegExp(title) })
  if (header.getAttribute('aria-expanded') === 'false') await userEvent.click(header)
}

describe('VttSidebar', () => {
  it('counts every layer', async () => {
    render(<VttSidebar {...props} />)
    await expand('maps.vtt.layers.title')
    expect(screen.getByTestId('count-line_of_sight')).toHaveTextContent('1')
    expect(screen.getByTestId('count-objects_line_of_sight')).toHaveTextContent('0')
    expect(screen.getByTestId('count-lights')).toHaveTextContent('1')
  })

  it('prompts when nothing is selected', () => {
    render(<VttSidebar {...props} />)
    expect(screen.getByText('maps.vtt.selection.none')).toBeInTheDocument()
  })

  it('shows light properties for a selected light', () => {
    render(<VttSidebar {...props} selection={{ key: 'lights', index: 0 }} />)
    expect(screen.getByRole('spinbutton', { name: 'maps.vtt.light.range' })).toBeInTheDocument()
  })

  it('shows portal properties for a selected portal', () => {
    render(<VttSidebar {...props} selection={{ key: 'portals', index: 0 }} />)
    expect(screen.getByRole('button', { name: 'maps.vtt.portal.door' })).toBeInTheDocument()
  })

  it('shows only a vertex count and delete for a wall', () => {
    // The format gives a wall no properties at all beyond its points.
    render(<VttSidebar {...props} selection={{ key: 'line_of_sight', index: 0 }} />)
    expect(screen.getByText(/selection.wall:/)).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: 'maps.vtt.light.range' })).toBeNull()
  })

  it('deletes the selected wall', async () => {
    const onDeleteFeature = vi.fn()
    render(
      <VttSidebar
        {...props}
        selection={{ key: 'line_of_sight', index: 0 }}
        onDeleteFeature={onDeleteFeature}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'maps.vtt.deleteSelected' }))
    expect(onDeleteFeature).toHaveBeenCalledWith('line_of_sight', 0)
  })

  it('edits a selected light through the panel', async () => {
    const onUpdateFeature = vi.fn()
    render(
      <VttSidebar
        {...props}
        selection={{ key: 'lights', index: 0 }}
        onUpdateFeature={onUpdateFeature}
      />
    )
    await userEvent.click(screen.getByLabelText('maps.vtt.light.range +0.5'))
    expect(onUpdateFeature).toHaveBeenCalledWith(
      'lights',
      0,
      expect.objectContaining({ range: 4.5 })
    )
  })

  it('reports the grid and offers recalibration', async () => {
    const onRecalibrate = vi.fn()
    render(<VttSidebar {...props} onRecalibrate={onRecalibrate} />)
    await expand('maps.vtt.grid.title')
    expect(screen.getByText(/grid.dimensions:/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /grid.recalibrate/ }))
    expect(onRecalibrate).toHaveBeenCalled()
  })

  it('renders the environment panel with the light count', async () => {
    render(<VttSidebar {...props} />)
    await expand('maps.vtt.environment.title')
    expect(screen.getByText('maps.vtt.environment.baked')).toBeInTheDocument()
  })

  it('edits a selected portal through the panel', async () => {
    const onUpdateFeature = vi.fn()
    render(
      <VttSidebar
        {...props}
        selection={{ key: 'portals', index: 0 }}
        onUpdateFeature={onUpdateFeature}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'maps.vtt.portal.window' }))
    expect(onUpdateFeature).toHaveBeenCalledWith(
      'portals',
      0,
      expect.objectContaining({ closed: false })
    )
  })

  it('deletes a selected portal', async () => {
    const onDeleteFeature = vi.fn()
    render(
      <VttSidebar
        {...props}
        selection={{ key: 'portals', index: 0 }}
        onDeleteFeature={onDeleteFeature}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'maps.vtt.deleteSelected' }))
    expect(onDeleteFeature).toHaveBeenCalledWith('portals', 0)
  })

  it('deletes a selected light', async () => {
    const onDeleteFeature = vi.fn()
    render(
      <VttSidebar
        {...props}
        selection={{ key: 'lights', index: 0 }}
        onDeleteFeature={onDeleteFeature}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /deleteSelected/ }))
    expect(onDeleteFeature).toHaveBeenCalledWith('lights', 0)
  })

  it('passes environment edits up', async () => {
    const onEnvironment = vi.fn()
    render(<VttSidebar {...props} onEnvironment={onEnvironment} />)
    await expand('maps.vtt.environment.title')
    await userEvent.click(screen.getByRole('checkbox'))
    expect(onEnvironment).toHaveBeenCalledWith(expect.objectContaining({ baked_lighting: true }))
  })

  it('shows object walls as a wall selection, not a portal', () => {
    render(<VttSidebar {...props} selection={{ key: 'objects_line_of_sight', index: 0 }} />)
    expect(screen.getByText('maps.vtt.selection.none')).toBeInTheDocument()
  })

  it('falls back gracefully when the selection index is stale', () => {
    render(<VttSidebar {...props} selection={{ key: 'lights', index: 99 }} />)
    expect(screen.getByText('maps.vtt.selection.none')).toBeInTheDocument()
  })

  describe('section layout', () => {
    it('opens on the selection rather than on every section at once', () => {
      render(<VttSidebar {...props} />)
      // Selection and tool help lead; the reference sections start folded so
      // the panel does not open as six stacked blocks.
      expect(screen.getByRole('button', { name: /selection.title/ })).toHaveAttribute(
        'aria-expanded',
        'true'
      )
      expect(screen.getByRole('button', { name: /layers.title/ })).toHaveAttribute(
        'aria-expanded',
        'false'
      )
      expect(screen.getByRole('button', { name: /environment.title/ })).toHaveAttribute(
        'aria-expanded',
        'false'
      )
    })

    it('puts the selection above the sections that do not change size', () => {
      // Selection is the one block that grows by a whole property form, so it
      // has to sit where growing pushes only static content down.
      const { container } = render(<VttSidebar {...props} />)
      const order = [...container.querySelectorAll('[data-testid^="section-"]')].map((el) =>
        el.getAttribute('data-testid')
      )
      expect(order[0]).toBe('section-selection')
      expect(order.indexOf('section-preview')).toBeGreaterThan(order.indexOf('section-selection'))
      expect(order.indexOf('section-environment')).toBe(order.length - 1)
    })

    it('collapses a section that is open', async () => {
      render(<VttSidebar {...props} />)
      await userEvent.click(screen.getByRole('button', { name: /selection.title/ }))
      expect(screen.queryByText('maps.vtt.selection.none')).toBeNull()
    })

    it('reopens the selection when something is selected', async () => {
      // Placing a light auto-selects it, which is worthless if the panel it
      // lands in is folded shut — the click would appear to do nothing.
      const { rerender } = render(<VttSidebar {...props} />)
      await userEvent.click(screen.getByRole('button', { name: /selection.title/ }))
      expect(screen.queryByText('maps.vtt.selection.none')).toBeNull()

      rerender(<VttSidebar {...props} selection={{ key: 'lights', index: 0 }} />)
      expect(screen.getByRole('spinbutton', { name: 'maps.vtt.light.range' })).toBeInTheDocument()
    })

    it('leaves a collapsed section alone when the selection is cleared', async () => {
      const { rerender } = render(<VttSidebar {...props} selection={{ key: 'lights', index: 0 }} />)
      await userEvent.click(screen.getByRole('button', { name: /layers.title/ }))
      rerender(<VttSidebar {...props} selection={null} />)
      // Clearing a selection is not a reason to re-open anything.
      expect(screen.getByRole('button', { name: /layers.title/ })).toHaveAttribute(
        'aria-expanded',
        'true'
      )
    })

    it('shows the total on the collapsed layers header', () => {
      render(<VttSidebar {...props} />)
      // 1 wall + 0 objects + 1 portal + 1 light.
      expect(screen.getByRole('button', { name: /layers.title/ })).toHaveTextContent('3')
    })
  })
})
