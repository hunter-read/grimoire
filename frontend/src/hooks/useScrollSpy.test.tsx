import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import useScrollSpy, { SPY_OFFSET } from './useScrollSpy'

// Each section's top, as getBoundingClientRect reports it; tests move them.
let tops: Record<string, number> = {}

function Probe({
  enabled = true,
  onKey,
}: {
  enabled?: boolean
  onKey: (k: string | null) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  onKey(useScrollSpy(ref, enabled))
  return (
    <div ref={ref}>
      {['A', 'B', 'C'].map((k) => (
        <h3
          key={k}
          data-index-key={k}
          ref={(el) => {
            if (el) el.getBoundingClientRect = () => ({ top: tops[k] }) as DOMRect
          }}
        >
          {k}
        </h3>
      ))}
    </div>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useScrollSpy', () => {
  it('names the last section scrolled past the sticky toolbar', async () => {
    // A frame later, as the browser would.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      setTimeout(() => cb(0), 0)
      return 1
    })
    tops = { A: 500, B: 900, C: 1300 }
    let key: string | null = null
    render(<Probe onKey={(k) => (key = k)} />)
    // The list's top is still in view: its first section.
    expect(key).toBe('A')

    tops = { A: -800, B: SPY_OFFSET - 10, C: 600 }
    await act(async () => {
      window.dispatchEvent(new Event('scroll'))
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(key).toBe('B')

    tops = { A: -1600, B: -900, C: 20 }
    await act(async () => {
      window.dispatchEvent(new Event('scroll'))
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(key).toBe('C')
  })

  it('says nothing when switched off', () => {
    tops = { A: 0, B: 400, C: 800 }
    let key: string | null = 'x'
    render(<Probe enabled={false} onKey={(k) => (key = k)} />)
    expect(key).toBeNull()
  })
})
