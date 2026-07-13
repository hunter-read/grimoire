import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import LazyGrid from './LazyGrid'

// Capture the IntersectionObserver callback so tests can drive intersection.
let ioCallback
let observed
let disconnected

beforeEach(() => {
  ioCallback = null
  observed = false
  disconnected = false
  global.IntersectionObserver = class {
    constructor(cb) {
      ioCallback = cb
    }
    observe() {
      observed = true
    }
    disconnect() {
      disconnected = true
    }
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

const Child = () => <div data-testid="child">grid content</div>

describe('LazyGrid', () => {
  it('renders a placeholder (not children) before it intersects', () => {
    render(
      <LazyGrid count={12} cardSize="comfortable">
        <Child />
      </LazyGrid>
    )
    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
    expect(observed).toBe(true)
  })

  it('renders children once the placeholder intersects', () => {
    render(
      <LazyGrid count={4} cardSize="compact">
        <Child />
      </LazyGrid>
    )
    act(() => ioCallback([{ isIntersecting: true }]))
    expect(screen.getByTestId('child')).toBeInTheDocument()
    expect(disconnected).toBe(true)
  })

  it('does not render children while not intersecting', () => {
    render(
      <LazyGrid count={4} cardSize="compact">
        <Child />
      </LazyGrid>
    )
    act(() => ioCallback([{ isIntersecting: false }]))
    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
  })

  it('estimates height for list mode', () => {
    const { container } = render(
      <LazyGrid count={5} list>
        <Child />
      </LazyGrid>
    )
    // list: count * 60 = 300
    expect(container.firstChild.style.minHeight).toBe('300px')
  })

  it('estimates height using desktop chrome on wide viewports', () => {
    window.innerWidth = 1400
    const { container } = render(
      <LazyGrid count={10} cardSize="comfortable">
        <Child />
      </LazyGrid>
    )
    // cols = floor((1400 - 120) / 216) = 5; rows = 2; height = 2 * (230 + 16) = 492
    expect(container.firstChild.style.minHeight).toBe('492px')
  })

  it('uses a smaller chrome budget on mobile viewports', () => {
    window.innerWidth = 375
    const { container } = render(
      <LazyGrid count={4} cardSize="comfortable">
        <Child />
      </LazyGrid>
    )
    // mobile chrome 32: cols = floor((375 - 32) / 216) = 1; rows = 4; height = 4 * 246 = 984
    expect(container.firstChild.style.minHeight).toBe('984px')
  })
})
