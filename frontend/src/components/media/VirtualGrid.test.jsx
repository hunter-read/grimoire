import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import VirtualGrid from './VirtualGrid'
import { columnsFor } from './VirtualGridRows'

// jsdom reports every element as zero-sized and never scrolls, so the real
// virtualizer would render no rows. These tests cover the parts that do not
// need layout: the column arithmetic, the row assignment it drives, and that
// only the rows the virtualizer asks for are rendered.
let virtualRows
// Every scroll element the virtualizer was constructed with, in order. A null
// in here is the bug: see the scroll-jump test below.
let scrollElementsSeen = []
// What the virtualizer was told its starting offset is. 0 while the page is
// scrolled elsewhere means it will yank the page to the top on attach.
let initialOffsetsSeen = []

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts) => {
    scrollElementsSeen.push(opts.getScrollElement())
    initialOffsetsSeen.push(
      typeof opts.initialOffset === 'function' ? opts.initialOffset() : opts.initialOffset
    )
    return {
      options: { scrollMargin: 0 },
      getTotalSize: () => virtualRows.length * 240,
      getVirtualItems: () =>
        virtualRows
          .filter((i) => i < opts.count)
          .map((index) => ({ index, key: index, start: index * 240 })),
      measure: () => {},
      measureElement: () => {},
    }
  },
}))

beforeEach(() => {
  virtualRows = [0, 1, 2]
  scrollElementsSeen = []
  initialOffsetsSeen = []
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
})

const items = (n) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, name: `item ${i}` }))
const renderItem = (item) => <span key={item.id} data-testid="cell" />

describe('columnsFor', () => {
  it('fits as many whole tracks as the width allows, counting gutters between them', () => {
    // 1320 wide, 130px tracks, 12px gutters: 9 tracks need 9*130 + 8*12 = 1266.
    expect(columnsFor(1320, 130, 12)).toBe(9)
    // A tenth track would need 1408.
    expect(columnsFor(1407, 130, 12)).toBe(9)
    expect(columnsFor(1408, 130, 12)).toBe(10)
  })

  it('never reports fewer than one column', () => {
    expect(columnsFor(50, 200, 16)).toBe(1)
    expect(columnsFor(0, 200, 16)).toBe(1)
  })

  it('falls back to one column when the width is not known yet', () => {
    // Before the first measurement there is no width to divide.
    expect(columnsFor(undefined, 130, 12)).toBe(1)
  })
})

describe('VirtualGrid', () => {
  it('renders only the rows the virtualizer asks for', () => {
    virtualRows = [0]
    render(<VirtualGrid items={items(100)} renderItem={renderItem} minColumn={130} gap={12} />)
    // One row, and with no measured width that row holds a single column.
    expect(screen.getAllByTestId('cell')).toHaveLength(1)
  })

  it('reserves the full scroll height even though most rows are unmounted', () => {
    virtualRows = [0]
    const { container } = render(
      <VirtualGrid items={items(100)} renderItem={renderItem} minColumn={130} gap={12} />
    )
    // The spacer carries the whole list's height so the scrollbar is honest.
    const spacer = container.firstChild.firstChild
    expect(spacer.style.height).toBe('240px')
    expect(spacer.style.position).toBe('relative')
  })

  it('gives every row the same explicit column count', () => {
    // auto-fill would stretch a short final row across the full width; explicit
    // tracks keep the last row's cards the same size as every other row's.
    virtualRows = [0, 1]
    const { container } = render(
      <VirtualGrid items={items(3)} renderItem={renderItem} minColumn={130} gap={12} />
    )
    const rows = [...container.querySelectorAll('[data-index]')]
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.style.gridTemplateColumns).toBe('repeat(1, minmax(0, 1fr))')
    }
  })

  it('stacks one item per row in list mode', () => {
    virtualRows = [0, 1]
    const { container } = render(
      <VirtualGrid items={items(2)} renderItem={renderItem} minColumn={130} gap={8} list />
    )
    const rows = [...container.querySelectorAll('[data-index]')]
    expect(rows).toHaveLength(2)
    // List rows are flex columns, not grids.
    expect(rows[0].style.display).toBe('flex')
    expect(rows[0].style.gridTemplateColumns).toBe('')
  })

  it('asks for no rows when there are no items', () => {
    render(<VirtualGrid items={[]} renderItem={renderItem} minColumn={130} gap={12} />)
    expect(screen.queryByTestId('cell')).not.toBeInTheDocument()
  })
})

describe('scroll offset seeding (issue #531: expanding a folder jumped to the top)', () => {
  // A scrollable ancestor, the way <main> is in AppShell.
  const inScroller = (ui) => render(<div style={{ overflowY: 'auto' }}>{ui}</div>)

  it('seeds the virtualizer with the live scroll position of the page', () => {
    // The regression. A virtualizer attaches to its scroll element on the first
    // _willUpdate and immediately re-applies the offset it believes it is at.
    // That comes from getScrollOffset(), which seeds from options.initialOffset
    // and defaults to 0 - so every grid that mounted asked the page to scroll
    // to the top. Expanding a folder mounts a grid; collapsing only unmounts
    // one, which is why the jump was one-way.
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    document.body.appendChild(scroller)
    Object.defineProperty(scroller, 'scrollTop', { value: 500, writable: true, configurable: true })

    render(<VirtualGrid items={items(6)} renderItem={renderItem} minColumn={130} />, {
      container: scroller,
    })

    expect(initialOffsetsSeen.at(-1)).toBe(500)
  })

  it('does not create the virtualizer before the scroll element is resolved', () => {
    // The virtualizer reads initialOffset on its first render (through
    // calculateRange) and caches it. Created too early it caches 0, then
    // re-applies that 0 on attach - a scrollTo({top: 0}) on the whole page.
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    document.body.appendChild(scroller)
    Object.defineProperty(scroller, 'scrollTop', { value: 500, writable: true, configurable: true })

    render(<VirtualGrid items={items(6)} renderItem={renderItem} minColumn={130} />, {
      container: scroller,
    })

    // Every construction saw a real offset; none saw the premature 0.
    expect(initialOffsetsSeen.length).toBeGreaterThan(0)
    expect(initialOffsetsSeen).not.toContain(0)
  })

  it('falls back to 0 when there is no scrolling ancestor', () => {
    // A page whose document scrolls has none. Seeding must not throw there, and
    // 0 is the honest answer rather than a guess.
    render(<VirtualGrid items={items(6)} renderItem={renderItem} minColumn={130} />)
    expect(initialOffsetsSeen.at(-1)).toBe(0)
  })

  it('still renders its rows', () => {
    inScroller(<VirtualGrid items={items(6)} renderItem={renderItem} minColumn={130} />)
    expect(screen.getAllByTestId('cell').length).toBeGreaterThan(0)
  })
})
