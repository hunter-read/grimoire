import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import useLongPress from './useLongPress'

// A touch list shaped like the one a real event carries — the hook reads
// `length` and the first touch's coordinates.
const touches = (...points) => points.map(([x, y]) => ({ clientX: x, clientY: y }))

function Probe({ onLongPress }) {
  const props = useLongPress(onLongPress)
  return (
    <div data-testid="target" {...props}>
      hold me
    </div>
  )
}

function renderProbe() {
  const onLongPress = vi.fn()
  const { unmount } = render(<Probe onLongPress={onLongPress} />)
  return { onLongPress, target: screen.getByTestId('target'), unmount }
}

/** Advance past the hold threshold. */
const hold = () => act(() => vi.advanceTimersByTime(600))

describe('useLongPress', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires with the touch coordinates once the hold completes', () => {
    const { onLongPress, target } = renderProbe()
    fireEvent.touchStart(target, { touches: touches([120, 340]) })
    hold()
    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(onLongPress.mock.calls[0][0]).toMatchObject({ clientX: 120, clientY: 340 })
  })

  it('does not fire before the threshold', () => {
    const { onLongPress, target } = renderProbe()
    fireEvent.touchStart(target, { touches: touches([10, 10]) })
    act(() => vi.advanceTimersByTime(300))
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('cancels when the finger drifts past the tolerance — that is a scroll', () => {
    const { onLongPress, target } = renderProbe()
    fireEvent.touchStart(target, { touches: touches([50, 50]) })
    fireEvent.touchMove(target, { touches: touches([50, 90]) })
    hold()
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('survives a small drift, so a steady finger still counts', () => {
    const { onLongPress, target } = renderProbe()
    fireEvent.touchStart(target, { touches: touches([50, 50]) })
    fireEvent.touchMove(target, { touches: touches([54, 53]) })
    hold()
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('cancels when the finger lifts early', () => {
    const { onLongPress, target } = renderProbe()
    fireEvent.touchStart(target, { touches: touches([50, 50]) })
    fireEvent.touchEnd(target)
    hold()
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('ignores a second finger — that is a pinch, not a press', () => {
    const { onLongPress, target } = renderProbe()
    fireEvent.touchStart(target, { touches: touches([50, 50], [90, 90]) })
    hold()
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('swallows the click that ends a completed press', () => {
    const onClick = vi.fn()
    const onLongPress = vi.fn()
    render(
      <Wrapper onClick={onClick}>
        <Probe onLongPress={onLongPress} />
      </Wrapper>
    )
    const target = screen.getByTestId('target')
    fireEvent.touchStart(target, { touches: touches([50, 50]) })
    hold()
    fireEvent.click(target)
    expect(onLongPress).toHaveBeenCalledTimes(1)
    // The tap that ends the hold must not also select the row behind the menu.
    expect(onClick).not.toHaveBeenCalled()
  })

  it('lets a plain tap through', () => {
    const onClick = vi.fn()
    render(
      <Wrapper onClick={onClick}>
        <Probe onLongPress={vi.fn()} />
      </Wrapper>
    )
    const target = screen.getByTestId('target')
    fireEvent.touchStart(target, { touches: touches([50, 50]) })
    fireEvent.touchEnd(target)
    fireEvent.click(target)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('only swallows one click, so the next tap works', () => {
    const onClick = vi.fn()
    render(
      <Wrapper onClick={onClick}>
        <Probe onLongPress={vi.fn()} />
      </Wrapper>
    )
    const target = screen.getByTestId('target')
    fireEvent.touchStart(target, { touches: touches([50, 50]) })
    hold()
    fireEvent.click(target)
    fireEvent.click(target)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('drops a pending timer on unmount rather than firing into a dead component', () => {
    const { onLongPress, target, unmount } = renderProbe()
    fireEvent.touchStart(target, { touches: touches([50, 50]) })
    unmount()
    hold()
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('reads the latest callback, so stale props are never called', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Probe onLongPress={first} />)
    rerender(<Probe onLongPress={second} />)
    fireEvent.touchStart(screen.getByTestId('target'), { touches: touches([1, 2]) })
    hold()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})

// A click listener above the hook's element, standing in for the row's own
// onClick and the menu's close-on-outside-click.
function Wrapper({ onClick, children }) {
  return <div onClick={onClick}>{children}</div>
}
