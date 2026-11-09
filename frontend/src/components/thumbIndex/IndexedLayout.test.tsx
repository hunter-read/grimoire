import { describe, it, expect, vi, beforeAll } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import IndexedLayout, { MIN_INDEXED_ITEMS, type AnchorOf } from './IndexedLayout'
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
  const renderItems = vi.fn((items: string[], anchorOf: AnchorOf<string>) => (
    <ul>
      {items.map((n) => (
        <li key={n} {...anchorOf(n)}>
          <a href={`#${n}`}>{n}</a>
        </li>
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
      renderItems={renderItems}
      {...props}
    />
  )
  return { ...utils, renderItems }
}

describe('IndexedLayout', () => {
  it('keeps a long list in one piece, with the rail beside it and no headings', () => {
    const { container, renderItems } = renderLayout()
    expect(renderItems.mock.lastCall![0]).toEqual(NAMES)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(container.querySelectorAll('ul')).toHaveLength(2) // the list, and the rail's
    expect(screen.getByRole('navigation', { name: 'Jump to names by letter' })).toBeInTheDocument()
  })

  it('marks only the first row of each run as an anchor', () => {
    const { container } = renderLayout()
    const anchors = [...container.querySelectorAll<HTMLElement>('li[data-index-key]')]
    expect(anchors.map((a) => a.dataset.indexKey)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(anchors.map((a) => a.textContent)).toEqual(
      ['A', 'B', 'C', 'D', 'E'].map((l) => NAMES.find((n) => n.startsWith(l)))
    )
    // The rail's tabs link to the anchors' ids.
    const tab = screen.getByRole('link', { name: 'C, 6 names' })
    expect(container.querySelector(tab.getAttribute('href')!)).toBe(anchors[2])
  })

  it("jumps to a run and puts focus on its first row's link", () => {
    renderLayout()
    fireEvent.click(screen.getByRole('link', { name: 'D, 6 names' }))
    const first = NAMES.find((n) => n.startsWith('D'))!
    expect(document.activeElement).toBe(screen.getByRole('link', { name: first }))
  })

  it('renders a short list plainly, with no anchors', () => {
    const { container, renderItems } = renderLayout({ items: NAMES.slice(0, 5) })
    expect(renderItems.mock.calls[0][0]).toEqual(NAMES.slice(0, 5))
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(container.querySelector('[data-index-key]')).toBeNull()
  })

  it('renders plainly when the sort has no landmarks', () => {
    const { renderItems } = renderLayout({ enabled: false })
    expect(renderItems.mock.lastCall![0]).toEqual(NAMES)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('renders plainly with too few letters to be worth a rail', () => {
    renderLayout({ keyOf: (n) => (n < 'C' ? 'A' : 'B') })
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('shows formatted labels on the rail', () => {
    renderLayout({ formatLabel: (l) => `Letter ${l}` })
    expect(screen.getByRole('link', { name: 'Letter A, 6 names' })).toBeInTheDocument()
  })
})
