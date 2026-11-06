import { describe, it, expect, vi, beforeAll } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import IndexedLayout, { MIN_INDEXED_ITEMS } from './IndexedLayout'
import { indexLetter } from '../../utils/thumbIndex'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

// Enough names, across enough letters, to be indexed.
const NAMES = Array.from(
  { length: MIN_INDEXED_ITEMS },
  (_, i) => `${'ABCDE'[i % 5]}name ${i}`
).sort()

const renderLayout = (props: Partial<Parameters<typeof IndexedLayout<string>>[0]> = {}) => {
  const renderItems = vi.fn((items: string[]) => (
    <ul>
      {items.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  ))
  const utils = render(
    <IndexedLayout
      items={NAMES}
      enabled
      keyOf={(n) => indexLetter(n)}
      nameOf={(n) => n}
      scope="test"
      railLabel="Jump to names by letter"
      describe={(run) => `${run.count} names`}
      headingLevel={3}
      renderItems={renderItems}
      {...props}
    />
  )
  return { ...utils, renderItems }
}

describe('IndexedLayout', () => {
  it('cuts a long list into lettered sections with the rail beside it', () => {
    const { renderItems } = renderLayout()
    const headings = screen.getAllByRole('heading', { level: 3 })
    expect(headings.map((h) => h.textContent)).toEqual([
      'A6 names',
      'B6 names',
      'C6 names',
      'D6 names',
      'E6 names',
    ])
    expect(renderItems).toHaveBeenCalledWith(expect.any(Array), true)
    expect(screen.getByRole('navigation', { name: 'Jump to names by letter' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'C6 names' })).toBeInTheDocument()
  })

  it('jumps to a section and puts focus on its heading', () => {
    renderLayout()
    fireEvent.click(screen.getByRole('link', { name: 'D, 6 names' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'D6 names' }))
  })

  it('draws section headings at the requested level, and can skip off-screen layout', () => {
    const { container } = renderLayout({ headingLevel: 2, lazySections: true })
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(5)
    expect(container.querySelector('.index-section--lazy')).not.toBeNull()
  })

  it('renders a short list plainly', () => {
    const { renderItems } = renderLayout({ items: NAMES.slice(0, 5) })
    expect(renderItems).toHaveBeenCalledWith(NAMES.slice(0, 5), false)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('renders plainly when the sort has no landmarks', () => {
    const { renderItems } = renderLayout({ enabled: false })
    expect(renderItems).toHaveBeenCalledWith(NAMES, false)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('renders plainly with too few letters to be worth a rail', () => {
    renderLayout({ keyOf: (n) => (n < 'C' ? 'A' : 'B') })
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('shows formatted labels on the headings', () => {
    renderLayout({ formatLabel: (l) => `Letter ${l}` })
    expect(screen.getByRole('heading', { name: 'Letter A6 names' })).toBeInTheDocument()
  })
})
