import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { act } from 'react'
import useLibraryChanged from './useLibraryChanged'
import { LIBRARY_CHANGED } from './useFileActions'

function Host({ handler }) {
  useLibraryChanged(handler)
  return null
}

const fire = (detail) =>
  act(() => {
    window.dispatchEvent(new CustomEvent(LIBRARY_CHANGED, { detail }))
  })

describe('useLibraryChanged', () => {
  it('runs the handler with the change detail', () => {
    const handler = vi.fn()
    render(<Host handler={handler} />)

    fire({ action: 'delete', path: 'books/System/gone.pdf' })

    expect(handler).toHaveBeenCalledWith({ action: 'delete', path: 'books/System/gone.pdf' })
  })

  it('stops listening once unmounted', () => {
    const handler = vi.fn()
    const { unmount } = render(<Host handler={handler} />)
    unmount()

    fire({ action: 'move' })

    expect(handler).not.toHaveBeenCalled()
  })

  it('always calls the latest handler without re-subscribing', () => {
    // The ref is what lets a caller pass an inline arrow — the common shape —
    // without tearing down and re-adding the listener on every render.
    const first = vi.fn()
    const second = vi.fn()
    const addSpy = vi.spyOn(window, 'addEventListener')
    const { rerender } = render(<Host handler={first} />)
    const subscriptions = addSpy.mock.calls.filter(([name]) => name === LIBRARY_CHANGED).length

    rerender(<Host handler={second} />)
    fire({ action: 'rename' })

    expect(second).toHaveBeenCalled()
    expect(first).not.toHaveBeenCalled()
    expect(addSpy.mock.calls.filter(([name]) => name === LIBRARY_CHANGED)).toHaveLength(
      subscriptions
    )
    addSpy.mockRestore()
  })
})
