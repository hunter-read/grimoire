import type { MouseEvent } from 'react'
import { gridStyle, hoverIn, hoverOut } from './favoriteStyles'

const hoverEvent = (el: HTMLElement) =>
  ({ currentTarget: el }) as unknown as MouseEvent<HTMLElement>

describe('favoriteStyles', () => {
  it('sizes grid columns per view mode', () => {
    expect(gridStyle('compact').gridTemplateColumns).toContain('minmax(140px')
    expect(gridStyle('grid').gridTemplateColumns).toContain('minmax(160px')
  })

  it('swaps the border colour on hover in and out', () => {
    const el = document.createElement('div')
    hoverIn(hoverEvent(el))
    expect(el.style.borderColor).toBe('var(--border-light)')
    hoverOut(hoverEvent(el))
    expect(el.style.borderColor).toBe('var(--border)')
  })
})
