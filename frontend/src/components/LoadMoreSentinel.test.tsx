import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import LoadMoreSentinel from './LoadMoreSentinel'

// Drive the observer by hand: record what it was built with and expose the
// callback, so a test can report the sentinel on or off screen.
const observers: RecordingObserver[] = []
class RecordingObserver {
  callback: (entries: Partial<IntersectionObserverEntry>[]) => void
  options: IntersectionObserverInit & { root?: HTMLElement | null }
  disconnected: boolean
  target?: Element

  constructor(callback: RecordingObserver['callback'], options: RecordingObserver['options']) {
    this.callback = callback
    this.options = options
    this.disconnected = false
    observers.push(this)
  }
  observe(target: Element) {
    this.target = target
  }
  disconnect() {
    this.disconnected = true
  }
}

const original = globalThis.IntersectionObserver
afterEach(() => {
  globalThis.IntersectionObserver = original
  observers.length = 0
})

describe('LoadMoreSentinel', () => {
  it('asks for more when it scrolls into view', () => {
    globalThis.IntersectionObserver = RecordingObserver as unknown as typeof IntersectionObserver
    const onVisible = vi.fn()
    render(<LoadMoreSentinel onVisible={onVisible} />)
    const [observer] = observers
    observer.callback([{ isIntersecting: false }])
    expect(onVisible).not.toHaveBeenCalled()
    observer.callback([{ isIntersecting: true }])
    expect(onVisible).toHaveBeenCalledTimes(1)
    expect(observer.options.rootMargin).toBe('800px')
  })

  it('watches the scrolling ancestor rather than the window', () => {
    globalThis.IntersectionObserver = RecordingObserver as unknown as typeof IntersectionObserver
    render(
      <div style={{ overflowY: 'auto' }} data-testid="scroller">
        <LoadMoreSentinel onVisible={() => {}} />
      </div>
    )
    expect(observers[0].options.root?.dataset.testid).toBe('scroller')
  })

  it('does not observe while inactive', () => {
    globalThis.IntersectionObserver = RecordingObserver as unknown as typeof IntersectionObserver
    render(<LoadMoreSentinel onVisible={() => {}} active={false} />)
    expect(observers).toHaveLength(0)
  })

  it('rebuilds the observer when more items load', () => {
    globalThis.IntersectionObserver = RecordingObserver as unknown as typeof IntersectionObserver
    const { rerender } = render(<LoadMoreSentinel onVisible={() => {}} count={1} />)
    rerender(<LoadMoreSentinel onVisible={() => {}} count={2} />)
    expect(observers).toHaveLength(2)
    expect(observers[0].disconnected).toBe(true)
  })

  it('renders without an IntersectionObserver', () => {
    globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver
    const { getByTestId } = render(<LoadMoreSentinel onVisible={() => {}} />)
    expect(getByTestId('load-more')).toBeInTheDocument()
  })
})
