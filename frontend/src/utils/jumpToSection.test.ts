import { describe, it, expect, vi, afterEach } from 'vitest'
import jumpToSection from './jumpToSection'

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

const setup = () => {
  const container = document.createElement('div')
  container.innerHTML = `
    <h3 data-index-key="A" tabindex="-1">A</h3>
    <h3 data-index-key="#~1" tabindex="-1">#</h3>`
  document.body.appendChild(container)
  const headings = container.querySelectorAll<HTMLElement>('h3')
  headings.forEach((h) => {
    h.scrollIntoView = vi.fn()
  })
  return { container, headings }
}

describe('jumpToSection', () => {
  it('scrolls the section in and focuses its heading', () => {
    const { container, headings } = setup()
    expect(jumpToSection(container, '#~1')).toBe(true)
    expect(headings[1].scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    expect(document.activeElement).toBe(headings[1])
  })

  it('aligns the heading again, instantly, once the scroll has settled', () => {
    vi.useFakeTimers()
    const { container, headings } = setup()
    jumpToSection(container, 'A')
    vi.advanceTimersByTime(1000)
    expect(headings[0].scrollIntoView).toHaveBeenLastCalledWith({
      block: 'start',
      behavior: 'auto',
    })
    // Settled once only, even if the scroll also reports its end.
    window.dispatchEvent(new Event('scrollend'))
    expect(headings[0].scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('scrolls instantly under reduced motion', () => {
    const matchMedia = vi.fn(() => ({ matches: true }))
    vi.stubGlobal('matchMedia', matchMedia)
    const { container, headings } = setup()
    jumpToSection(container, 'A')
    expect(headings[0].scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
    vi.unstubAllGlobals()
  })

  it('reports a missing section', () => {
    const { container } = setup()
    expect(jumpToSection(container, 'Z')).toBe(false)
    expect(jumpToSection(null, 'A')).toBe(false)
  })
})
