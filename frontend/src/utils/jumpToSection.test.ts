import { describe, it, expect, vi, afterEach } from 'vitest'
import jumpToSection from './jumpToSection'

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

const setup = () => {
  const container = document.createElement('div')
  container.innerHTML = `
    <ul>
      <li data-index-key="A"><a href="/a">Alpha</a></li>
      <li>Another</li>
      <li data-index-key="#~1"><button type="button">1st</button></li>
      <li data-index-key="Z">Zed, nothing to focus</li>
    </ul>`
  document.body.appendChild(container)
  const anchors = container.querySelectorAll<HTMLElement>('[data-index-key]')
  anchors.forEach((a) => {
    a.scrollIntoView = vi.fn()
  })
  return { container, anchors }
}

describe('jumpToSection', () => {
  it("scrolls the run's first row in and focuses its link", () => {
    const { container, anchors } = setup()
    expect(jumpToSection(container, 'A')).toBe(true)
    expect(anchors[0].scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    expect(document.activeElement).toBe(container.querySelector('a'))
  })

  it('focuses a button the same way', () => {
    const { container } = setup()
    jumpToSection(container, '#~1')
    expect(document.activeElement).toBe(container.querySelector('button'))
  })

  it('focuses the row itself when it holds nothing focusable', () => {
    const { container, anchors } = setup()
    jumpToSection(container, 'Z')
    expect(document.activeElement).toBe(anchors[2])
    expect(anchors[2].tabIndex).toBe(-1)
  })

  it('aligns the row again, instantly, once the scroll has settled', () => {
    vi.useFakeTimers()
    const { container, anchors } = setup()
    jumpToSection(container, 'A')
    vi.advanceTimersByTime(1000)
    expect(anchors[0].scrollIntoView).toHaveBeenLastCalledWith({
      block: 'start',
      behavior: 'auto',
    })
    // Settled once only, even if the scroll also reports its end.
    window.dispatchEvent(new Event('scrollend'))
    expect(anchors[0].scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('scrolls instantly under reduced motion', () => {
    const matchMedia = vi.fn(() => ({ matches: true }))
    vi.stubGlobal('matchMedia', matchMedia)
    const { container, anchors } = setup()
    jumpToSection(container, 'A')
    expect(anchors[0].scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
    vi.unstubAllGlobals()
  })

  it('reports a missing run', () => {
    const { container } = setup()
    expect(jumpToSection(container, 'Q')).toBe(false)
    expect(jumpToSection(null, 'A')).toBe(false)
  })
})
