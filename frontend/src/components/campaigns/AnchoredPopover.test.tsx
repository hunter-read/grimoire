import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import AnchoredPopover from './AnchoredPopover'

/** Renders the popover anchored to a real button in the document. */
function setup(onClose = vi.fn()) {
  const ref = createRef()
  const utils = render(
    <div>
      <button ref={ref}>anchor</button>
      <AnchoredPopover anchorRef={ref} onClose={onClose}>
        <div>panel content</div>
      </AnchoredPopover>
    </div>
  )
  return { ...utils, onClose }
}

describe('AnchoredPopover', () => {
  it('renders its children', () => {
    setup()
    expect(screen.getByText('panel content')).toBeTruthy()
  })

  it('portals outside the anchor subtree so it is not clipped', () => {
    const { container } = setup()
    // The panel lives on document.body, not inside the rendered container.
    expect(container.textContent).not.toContain('panel content')
    expect(document.body.textContent).toContain('panel content')
  })

  it('closes on Escape', () => {
    const { onClose } = setup()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on an outside click', () => {
    const { onClose } = setup()
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalled()
  })

  it('stays open when clicking inside the panel', () => {
    const { onClose } = setup()
    fireEvent.mouseDown(screen.getByText('panel content'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stays open when clicking the anchor itself', () => {
    const { onClose } = setup()
    // The trigger owns its own toggle; the popover must not double-handle it.
    fireEvent.mouseDown(screen.getByText('anchor'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
