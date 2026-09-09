import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ContextMenu from './ContextMenu'

// jsdom gives every element a zero-sized box, so the measuring layout effect
// has nothing to work with unless the height/width are stubbed. Each test sets
// the size the menu should believe it has.
const mockSize = (width, height) =>
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const top = parseFloat(this.style.top) || 0
    const left = parseFloat(this.style.left) || 0
    return {
      width,
      height,
      top,
      left,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => {},
    }
  })

const renderMenu = (x, y) =>
  render(
    <ContextMenu x={x} y={y} onClick={() => {}}>
      <button>Delete</button>
    </ContextMenu>
  )

const menu = () => screen.getByTestId('file-context-menu')

describe('ContextMenu', () => {
  beforeEach(() => {
    window.innerWidth = 1000
    window.innerHeight = 800
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens at the click point when the menu fits below it', () => {
    mockSize(220, 300)
    renderMenu(100, 100)
    expect(menu()).toHaveStyle({ top: '100px', left: '100px' })
  })

  it('flips above the cursor when the menu would run off the bottom', () => {
    // The regression this component exists for: a tall folder menu opened from
    // a row near the bottom of the pane used to push its lower entries —
    // delete, rename, move — past the bottom of the window.
    mockSize(220, 480)
    renderMenu(100, 700)
    // 700 - 480: the menu's bottom edge lands on the cursor, fully on screen.
    expect(menu()).toHaveStyle({ top: '220px' })
  })

  it('clamps to the bottom edge when it fits neither below nor above', () => {
    mockSize(220, 700)
    renderMenu(100, 400)
    // 800 - 700 - 8 margin.
    expect(menu()).toHaveStyle({ top: '92px' })
  })

  it('scrolls internally when taller than the whole viewport', () => {
    mockSize(220, 900)
    renderMenu(100, 400)
    expect(menu()).toHaveStyle({ top: '8px', overflowY: 'auto' })
    // Capped to the viewport minus both margins so both ends stay reachable.
    expect(menu()).toHaveStyle({ maxHeight: '784px' })
  })

  it('flips to the left of the cursor when it would run off the right edge', () => {
    mockSize(220, 300)
    renderMenu(900, 100)
    expect(menu()).toHaveStyle({ left: '680px' })
  })

  it('is visible once measured', () => {
    mockSize(220, 300)
    renderMenu(100, 100)
    expect(menu()).toHaveStyle({ visibility: 'visible' })
  })

  it('renders its children', () => {
    mockSize(220, 300)
    renderMenu(100, 100)
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })
})
