import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import SpreadPage from './SpreadPage'

const words = (width, height) => ({
  width,
  height,
  words: [{ x0: 10, y0: 10, x1: 50, y1: 20, text: 'dragon' }],
})

function renderSpread(props = {}) {
  return render(
    <SpreadPage
      bookId="b1"
      currentPage={2}
      rightPage={3}
      hasRight
      getAlt={(p) => `Page ${p}`}
      zoom={1}
      pan={{ x: 0, y: 0 }}
      axisRef={{ current: 'x' }}
      directionRef={{ current: 1 }}
      {...props}
    />
  )
}

const container = (c) => c.firstChild
const pageImages = (c) => [...c.querySelectorAll('img')]

describe('SpreadPage', () => {
  it('draws two separate pages with a gap by default', () => {
    const { container: c } = renderSpread({
      wordsCacheRef: { current: { 2: words(600, 800), 3: words(600, 800) } },
    })
    expect(container(c).style.gap).toBe('12px')
    expect(c.querySelector('[data-joined-spread]')).toBeNull()
    for (const img of pageImages(c)) {
      expect(img.style.borderRadius).toBe('4px')
      expect(img.style.boxShadow).not.toBe('')
    }
  })

  describe('joined (issue #588)', () => {
    it('draws the pair as one image: no gap, one shadow, outer corners only', () => {
      const { container: c } = renderSpread({
        joined: true,
        wordsCacheRef: { current: { 2: words(600, 800), 3: words(600, 800) } },
      })
      expect(container(c).style.gap).toBe('0px')
      const pair = c.querySelector('[data-joined-spread]')
      expect(pair.style.boxShadow).not.toBe('')
      expect(pair.style.borderRadius).toBe('4px')
      // The wrapper clips the corners, so each page is square and unshadowed.
      expect(pair.style.overflow).toBe('hidden')
      for (const img of pageImages(c)) {
        expect(img.style.borderRadius).toBe('')
        expect(img.style.boxShadow).toBe('')
      }
    })

    it('sizes each page by its share of the pair, at a shared height', () => {
      // A slightly wider right page: both scale to one height, widths follow.
      const { container: c } = renderSpread({
        joined: true,
        wordsCacheRef: { current: { 2: words(600, 800), 3: words(640, 800) } },
      })
      const pair = c.querySelector('[data-joined-spread]')
      expect(pair.dataset.aspect).toBe('1.5500')
      const [left, right] = [...pair.children]
      expect(Number(left.style.flexGrow)).toBeCloseTo(0.75)
      expect(Number(right.style.flexGrow)).toBeCloseTo(0.8)
      // Fitted with container-query units against the spread box.
      expect(container(c).style.containerType).toBe('size')
    })

    it('keeps each page its own text overlay', () => {
      const { container: c } = renderSpread({
        joined: true,
        activeSearchQuery: 'dragon',
        wordsCacheRef: { current: { 2: words(600, 800), 3: words(600, 800) } },
      })
      const pair = c.querySelector('[data-joined-spread]')
      for (const page of pair.children) {
        expect(page.querySelectorAll('[data-selectable]').length).toBe(1)
      }
    })

    it('fits a pair without page geometry once its images load (PDF maps)', () => {
      const { container: c } = renderSpread({ joined: true })
      const pair = c.querySelector('[data-joined-spread]')
      // Not known yet: the pages sit side by side at their natural size.
      expect(pair.dataset.aspect).toBeUndefined()
      for (const img of pageImages(c)) {
        Object.defineProperty(img, 'naturalWidth', { value: 1000 })
        Object.defineProperty(img, 'naturalHeight', { value: 2000 })
        fireEvent.load(img)
      }
      expect(c.querySelector('[data-joined-spread]').dataset.aspect).toBe('1.0000')
    })

    it('ignores an image that reports no size', () => {
      const { container: c } = renderSpread({ joined: true })
      const [img] = pageImages(c)
      fireEvent.load(img)
      expect(c.querySelector('[data-joined-spread]').dataset.aspect).toBeUndefined()
    })

    it('leaves a page shown on its own exactly as it was', () => {
      const { container: c } = renderSpread({
        joined: true,
        hasRight: false,
        wordsCacheRef: { current: { 2: words(600, 800) } },
      })
      expect(c.querySelector('[data-joined-spread]')).toBeNull()
      expect(container(c).style.gap).toBe('12px')
      expect(pageImages(c)[0].style.borderRadius).toBe('4px')
    })
  })
})
