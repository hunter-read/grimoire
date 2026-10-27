import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'
import RetryingImage, { RETRY_DELAYS_MS } from './RetryingImage'

const img = (container: HTMLElement) => container.querySelector('img') as HTMLImageElement

describe('RetryingImage', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('asks again after a failed load, as a fresh element for the same URL', () => {
    const { container } = render(<RetryingImage src="/p/1" alt="Page 1" />)
    const first = img(container)
    fireEvent.error(first)
    // Not straight away: the server said it was busy.
    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[0] - 1))
    expect(img(container)).toBe(first)
    act(() => vi.advanceTimersByTime(1))
    const second = img(container)
    expect(second).not.toBe(first)
    expect(second.getAttribute('src')).toBe('/p/1')
    expect(second.alt).toBe('Page 1')
  })

  it('backs off further each time and then gives up', () => {
    const { container } = render(<RetryingImage src="/p/1" alt="" />)
    const seen = new Set<HTMLImageElement>()
    for (const delay of RETRY_DELAYS_MS) {
      seen.add(img(container))
      fireEvent.error(img(container))
      act(() => vi.advanceTimersByTime(delay))
    }
    expect(seen.size).toBe(RETRY_DELAYS_MS.length)
    const last = img(container)
    fireEvent.error(last)
    act(() => vi.advanceTimersByTime(60_000))
    expect(img(container)).toBe(last)
  })

  it('starts over for a new image, and drops a retry still waiting for the old one', () => {
    const { container, rerender } = render(<RetryingImage src="/p/1" alt="" />)
    fireEvent.error(img(container))
    rerender(<RetryingImage src="/p/2" alt="" />)
    const page2 = img(container)
    act(() => vi.advanceTimersByTime(RETRY_DELAYS_MS[0]))
    expect(img(container)).toBe(page2)
    expect(page2.getAttribute('src')).toBe('/p/2')
  })

  it("passes its own props through and still calls the caller's onError", () => {
    const onError = vi.fn()
    const onLoad = vi.fn()
    const { container } = render(
      <RetryingImage src="/p/1" alt="" data-page-image="" onError={onError} onLoad={onLoad} />
    )
    expect(img(container).hasAttribute('data-page-image')).toBe(true)
    fireEvent.load(img(container))
    fireEvent.error(img(container))
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
