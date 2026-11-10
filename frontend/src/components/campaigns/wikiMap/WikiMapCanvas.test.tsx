import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import WikiMapCanvas from './WikiMapCanvas'
import type { WikiPin } from './mapPages'

const pin: WikiPin = {
  id: 'p1',
  x: 0.2,
  y: 0.4,
  label: 'Tower',
  target_page_id: 't1',
  target_title: 'Tower of Ash',
  visibility: 'page',
  sort_order: 0,
  can_edit: true,
}

function mount(editing = false) {
  const props = {
    onSelectPin: vi.fn(),
    onAddPin: vi.fn(),
    onMovePin: vi.fn(),
  }
  render(
    <MemoryRouter>
      <WikiMapCanvas
        src="/map.png"
        alt="Region"
        pins={[pin]}
        editing={editing}
        selectedPinId={null}
        hrefFor={(p) => `/notes?note=${p.target_page_id}`}
        {...props}
      />
    </MemoryRouter>
  )
  fireEvent.load(screen.getByRole('img', { name: 'Region' }))
  return props
}

const wrapper = () => screen.getByRole('img', { name: 'Region' }).parentElement!

describe('WikiMapCanvas', () => {
  it('places pins at their fractions of the map', () => {
    mount()
    const marker = screen.getByRole('link', { name: 'Tower - Tower of Ash' })
    expect(marker.style.left).toBe('20%')
    expect(marker.style.top).toBe('40%')
  })

  it('names a pin when hovered', () => {
    mount()
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Tower - Tower of Ash' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Tower - Tower of Ash')
  })

  it('zooms with the buttons and the wheel, and fits back', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(wrapper().style.transform).toContain('scale(1.4)')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(wrapper().style.transform).toContain('scale(1)')
    fireEvent.wheel(screen.getByTestId('wiki-map-canvas'), { deltaY: -300 })
    expect(wrapper().style.transform).not.toContain('scale(1)')
    fireEvent.click(screen.getByRole('button', { name: 'Fit the map' }))
    expect(wrapper().style.transform).toMatch(/scale\(1\)$/)
  })

  it('pans a zoomed map by dragging', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    const canvas = screen.getByTestId('wiki-map-canvas')
    const before = wrapper().style.transform
    fireEvent.pointerDown(canvas, { button: 0, clientX: 50, clientY: 50 })
    fireEvent.pointerMove(canvas, { clientX: 90, clientY: 70 })
    fireEvent.pointerUp(canvas, { clientX: 90, clientY: 70 })
    expect(wrapper().style.transform).not.toBe(before)
  })

  it('reads a pin as a button while editing, and drags it', () => {
    const { onMovePin, onAddPin } = mount(true)
    const marker = screen.getByRole('button', { name: 'Tower - Tower of Ash' })
    const canvas = screen.getByTestId('wiki-map-canvas')
    fireEvent.pointerDown(marker, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 40 })
    fireEvent.pointerUp(canvas, { clientX: 40, clientY: 40 })
    // jsdom measures every box as empty, which reads as the middle.
    expect(onMovePin).toHaveBeenCalledWith('p1', 0.5, 0.5)
    expect(onAddPin).not.toHaveBeenCalled()
  })

  it('selects a pin clicked while editing rather than adding one', () => {
    const { onSelectPin, onAddPin } = mount(true)
    const marker = screen.getByRole('button', { name: 'Tower - Tower of Ash' })
    fireEvent.pointerDown(marker, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(marker, { clientX: 10, clientY: 10 })
    fireEvent.click(marker)
    expect(onSelectPin).toHaveBeenCalledWith('p1')
    expect(onAddPin).not.toHaveBeenCalled()
  })

  it("doesn't add pins when only reading", () => {
    const { onAddPin } = mount(false)
    const canvas = screen.getByTestId('wiki-map-canvas')
    fireEvent.pointerDown(canvas, { button: 0, clientX: 5, clientY: 5 })
    fireEvent.pointerUp(canvas, { clientX: 5, clientY: 5 })
    expect(onAddPin).not.toHaveBeenCalled()
  })

  it('says when the map cannot be drawn', () => {
    render(
      <MemoryRouter>
        <WikiMapCanvas
          src="/broken.png"
          alt="Broken"
          pins={[]}
          editing={false}
          selectedPinId={null}
          hrefFor={() => null}
          onSelectPin={vi.fn()}
          onAddPin={vi.fn()}
          onMovePin={vi.fn()}
        />
      </MemoryRouter>
    )
    fireEvent.error(screen.getByRole('img', { name: 'Broken' }))
    expect(screen.getByRole('alert')).toHaveTextContent('The map could not be loaded.')
  })
})

describe('WikiMapCanvas after a drag', () => {
  it("doesn't follow a pin's link at the end of a pan", () => {
    const { onSelectPin } = mount(false)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    const marker = screen.getByRole('link', { name: 'Tower - Tower of Ash' })
    const canvas = screen.getByTestId('wiki-map-canvas')
    fireEvent.pointerDown(marker, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(canvas, { clientX: 60, clientY: 60 })
    fireEvent.pointerUp(canvas, { clientX: 60, clientY: 60 })
    const click = fireEvent.click(marker)
    expect(click).toBe(false) // default prevented
    expect(onSelectPin).not.toHaveBeenCalled()
  })

  it('lets a finger scroll the page past an unzoomed map', () => {
    mount(false)
    expect(screen.getByTestId('wiki-map-canvas').style.touchAction).toBe('pan-y')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByTestId('wiki-map-canvas').style.touchAction).toBe('none')
  })
})
