import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import useHoverPrefetch, { HOVER_INTENT_MS } from './useHoverPrefetch'

const prefetchNow = vi.fn()
vi.mock('../components/reader/pagePrefetch', () => ({
  prefetchNow: (urls: string[]) => prefetchNow(urls),
}))

function Hit({ urls }: { urls: () => string[] }) {
  return <a {...useHoverPrefetch(urls)}>hit</a>
}

const renderHit = (urls = () => ['/page/1']) => {
  const view = render(<Hit urls={urls} />)
  return { link: screen.getByText('hit'), ...view }
}

const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms))

beforeEach(() => {
  vi.useFakeTimers()
  prefetchNow.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useHoverPrefetch', () => {
  it('loads the page once the mouse has rested on the link', () => {
    const { link } = renderHit()
    fireEvent.pointerEnter(link, { pointerType: 'mouse' })
    wait(HOVER_INTENT_MS - 1)
    expect(prefetchNow).not.toHaveBeenCalled()
    wait(1)
    expect(prefetchNow).toHaveBeenCalledWith(['/page/1'])
  })

  it('loads nothing when the mouse only passes over', () => {
    const { link } = renderHit()
    fireEvent.pointerEnter(link, { pointerType: 'mouse' })
    wait(HOVER_INTENT_MS / 2)
    fireEvent.pointerLeave(link, { pointerType: 'mouse' })
    wait(HOVER_INTENT_MS * 2)
    expect(prefetchNow).not.toHaveBeenCalled()
  })

  it('loads at once when a mouse button goes down', () => {
    const { link } = renderHit()
    fireEvent.pointerDown(link, { pointerType: 'mouse' })
    expect(prefetchNow).toHaveBeenCalledTimes(1)
    // The hover timer it may have cut short does not fire a second time.
    wait(HOVER_INTENT_MS * 2)
    expect(prefetchNow).toHaveBeenCalledTimes(1)
  })

  it('waits for a finger to lift, since a touch may be a scroll', () => {
    const { link } = renderHit()
    fireEvent.pointerEnter(link, { pointerType: 'touch' })
    fireEvent.pointerDown(link, { pointerType: 'touch' })
    wait(HOVER_INTENT_MS * 2)
    expect(prefetchNow).not.toHaveBeenCalled()
    fireEvent.pointerUp(link, { pointerType: 'touch' })
    expect(prefetchNow).toHaveBeenCalledWith(['/page/1'])
  })

  it('leaves a mouse release to the press that came before it', () => {
    const { link } = renderHit()
    fireEvent.pointerUp(link, { pointerType: 'mouse' })
    expect(prefetchNow).not.toHaveBeenCalled()
  })

  it('stops waiting when the browser takes the pointer for a scroll', () => {
    const { link } = renderHit()
    fireEvent.pointerEnter(link, { pointerType: 'pen' })
    fireEvent.pointerCancel(link, { pointerType: 'pen' })
    wait(HOVER_INTENT_MS * 2)
    expect(prefetchNow).not.toHaveBeenCalled()
  })

  it('loads the page when keyboard focus stays on the link', () => {
    const { link } = renderHit()
    fireEvent.focus(link)
    wait(HOVER_INTENT_MS)
    expect(prefetchNow).toHaveBeenCalledTimes(1)
  })

  it('loads nothing when focus moves straight on', () => {
    const { link } = renderHit()
    fireEvent.focus(link)
    fireEvent.blur(link)
    wait(HOVER_INTENT_MS * 2)
    expect(prefetchNow).not.toHaveBeenCalled()
  })

  it('asks for the URLs only when it loads them', () => {
    const urls = vi.fn(() => ['/page/9'])
    const { link } = renderHit(urls)
    expect(urls).not.toHaveBeenCalled()
    fireEvent.pointerDown(link, { pointerType: 'mouse' })
    expect(urls).toHaveBeenCalledTimes(1)
    expect(prefetchNow).toHaveBeenCalledWith(['/page/9'])
  })

  it('loads nothing after the link is gone', () => {
    const { link, unmount } = renderHit()
    fireEvent.pointerEnter(link, { pointerType: 'mouse' })
    unmount()
    wait(HOVER_INTENT_MS * 2)
    expect(prefetchNow).not.toHaveBeenCalled()
  })
})
