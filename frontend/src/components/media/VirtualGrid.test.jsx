import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import VirtualGrid, { columnsFor } from './VirtualGrid'

// jsdom reports every element as zero-sized and never scrolls, so the real
// virtualizer would render no rows. These tests cover the parts that do not
// need layout: the column arithmetic, the row assignment it drives, and that
// only the rows the virtualizer asks for are rendered.
let virtualRows

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts) => ({
    options: { scrollMargin: 0 },
    getTotalSize: () => virtualRows.length * 240,
    getVirtualItems: () =>
      virtualRows
        .filter((i) => i < opts.count)
        .map((index) => ({ index, key: index, start: index * 240 })),
    measure: () => {},
    measureElement: () => {},
  }),
}))

beforeEach(() => {
  virtualRows = [0, 1, 2]
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
