import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import ThumbIndex from './ThumbIndex'
import type { IndexEntry } from '../../utils/thumbIndex'

const entry = (label: string, count: number, preview: string[] = []): IndexEntry => ({
  key: label,
  label,
  count,
  preview,
})

const ENTRIES = [
  entry('A', 3, ['Abyssal Maps', 'Afternoon Maps', 'Atlas']),
  entry('M', 6, ['Mage', 'Mausritter', 'Mörk Borg', 'Mothership']),
  entry('T', 2, ['Tehox', 'Tom Cartos']),
]

const setup = (props: Partial<Parameters<typeof ThumbIndex>[0]> = {}) => {
  const onJump = vi.fn()
  render(
    <ThumbIndex
      entries={ENTRIES}
      current="M"
      onJump={onJump}
      label="Jump to systems by letter"
      describe={(tab) => `${tab.count} systems`}
      scope="systems"
      {...props}
    />
  )
  const nav = screen.getByRole('navigation', { name: 'Jump to systems by letter' })
  return { onJump, nav, tabs: within(nav).getAllByRole('link') }
}

// jsdom never matches :focus-visible; a browser does for keyboard focus, which
// is what these tests stand in for.
const keyboardFocus = () => {
  const matches = Element.prototype.matches
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, sel) {
    return sel === ':focus-visible' ? true : matches.call(this, sel)
  })
}

let height = 0
beforeEach(() => {
  height = window.innerHeight
})
afterEach(() => {
  window.innerHeight = height
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ThumbIndex', () => {
  it('lists only the letters it is given, each named with what it holds', () => {
    const { tabs } = setup()
    expect(tabs.map((t) => t.textContent)).toEqual(['A', 'M', 'T'])
    expect(screen.getByRole('link', { name: 'M, 6 systems' })).toHaveAttribute(
      'href',
      '#idx-systems-M'
    )
  })

  it('marks the letter the reader is in', () => {
    const { tabs } = setup()
    expect(tabs[1]).toHaveAttribute('aria-current', 'location')
    expect(tabs[0]).not.toHaveAttribute('aria-current')
  })

  it('is a single tab stop, on the current letter', () => {
    const { tabs } = setup()
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1])
  })

  it('jumps on click', () => {
    const { onJump, tabs } = setup()
    fireEvent.click(tabs[2])
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ key: 'T', keys: ['T'] }))
  })

  it('moves between letters with the arrow keys, Home, End and typing', () => {
    const { tabs } = setup()
    tabs[1].focus()
    fireEvent.keyDown(tabs[1], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(tabs[2])
    fireEvent.keyDown(tabs[2], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(tabs[2])
    fireEvent.keyDown(tabs[2], { key: 'Home' })
    expect(document.activeElement).toBe(tabs[0])
    fireEvent.keyDown(tabs[0], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(tabs[0])
    fireEvent.keyDown(tabs[0], { key: 'End' })
    expect(document.activeElement).toBe(tabs[2])
    fireEvent.keyDown(tabs[2], { key: 'm' })
    expect(document.activeElement).toBe(tabs[1])
    // A letter with no tab, or a modifier, changes nothing.
    fireEvent.keyDown(tabs[1], { key: 'q' })
    fireEvent.keyDown(tabs[1], { key: 'a', ctrlKey: true })
    expect(document.activeElement).toBe(tabs[1])
  })

  it('previews a letter on keyboard focus, and Escape closes it', () => {
    keyboardFocus()
    const { tabs } = setup()
    act(() => tabs[0].focus())
    expect(screen.getByText('Abyssal Maps')).toBeInTheDocument()
    expect(screen.getByText('Enter to jump')).toBeInTheDocument()
    fireEvent.keyDown(tabs[0], { key: 'Escape' })
    expect(screen.queryByText('Abyssal Maps')).not.toBeInTheDocument()
    // With nothing open, Escape is left for others.
    fireEvent.keyDown(tabs[0], { key: 'Escape' })
  })

  it('says how many more a letter holds than it previews', () => {
    keyboardFocus()
    const { tabs } = setup({ entries: [entry('M', 9, ['Mage', 'Mausritter'])], current: null })
    act(() => tabs[0].focus())
    expect(screen.getByText('+ 7 more')).toBeInTheDocument()
  })

  it('previews on hover after a moment, and closes once the pointer leaves', () => {
    vi.useFakeTimers()
    const { nav, tabs } = setup()
    fireEvent.pointerEnter(tabs[2], { pointerType: 'mouse' })
    expect(screen.queryByText('Tom Cartos')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByText('Tom Cartos')).toBeInTheDocument()
    // Moving onto the preview keeps it open.
    fireEvent.pointerLeave(within(nav).getByRole('list'))
    fireEvent.pointerEnter(screen.getByText('Tom Cartos').closest('div')!)
    act(() => vi.advanceTimersByTime(400))
    expect(screen.getByText('Tom Cartos')).toBeInTheDocument()
    fireEvent.pointerLeave(screen.getByText('Tom Cartos').closest('div')!)
    act(() => vi.advanceTimersByTime(400))
    expect(screen.queryByText('Tom Cartos')).not.toBeInTheDocument()
  })

  it('merges quiet letters into ranges when the rail is short', () => {
    window.innerHeight = 200
    const { tabs } = setup({
      entries: [
        entry('A', 20),
        entry('B', 20),
        entry('C', 20),
        entry('X', 1),
        entry('Y', 1),
        entry('Z', 1),
      ],
      current: 'Y',
    })
    expect(tabs.map((t) => t.textContent)).toEqual(['A', 'B', 'C', 'X–Z'])
    expect(tabs[3]).toHaveAttribute('aria-current', 'location')
    fireEvent.keyDown(tabs[3], { key: 'y' })
    expect(document.activeElement).toBe(tabs[3])
  })

  it('scrubs with a finger and jumps where it lifts', () => {
    const { onJump, nav, tabs } = setup()
    const list = within(nav).getByRole('list')
    const tab = parseFloat(tabs[0].style.height)
    fireEvent.pointerDown(list, { pointerType: 'touch', clientY: 4 + tab * 2 + 2 })
    expect(nav.querySelector('.thumb-index__bubble')).toHaveTextContent('T')
    fireEvent.pointerMove(list, { pointerType: 'touch', clientY: 4 + tab + 2 })
    expect(nav.querySelector('.thumb-index__bubble')).toHaveTextContent('M')
    fireEvent.pointerUp(list, { pointerType: 'touch', clientY: 4 + tab + 2 })
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ key: 'M' }))
    // The click a tap leaves behind does not jump a second time.
    fireEvent.click(tabs[1])
    expect(onJump).toHaveBeenCalledTimes(1)
  })

  it('leaves a mouse press to the links, and a cancelled touch to nothing', () => {
    const { onJump, nav } = setup()
    const list = within(nav).getByRole('list')
    fireEvent.pointerDown(list, { pointerType: 'mouse', clientY: 10 })
    fireEvent.pointerMove(list, { pointerType: 'mouse', clientY: 40 })
    fireEvent.pointerUp(list, { pointerType: 'mouse', clientY: 40 })
    expect(onJump).not.toHaveBeenCalled()
    fireEvent.pointerDown(list, { pointerType: 'touch', clientY: 10 })
    fireEvent.pointerCancel(list)
    expect(nav.querySelector('.thumb-index__bubble')).toBeNull()
  })

  it('shows labels through formatLabel', () => {
    setup({
      entries: [entry('2026-11', 4), entry('2026-10', 2)],
      current: null,
      formatLabel: (l) => (l === '2026-11' ? 'Nov 26' : 'Oct 26'),
    })
    expect(screen.getByRole('link', { name: 'Nov 26, 4 systems' })).toBeInTheDocument()
  })

  it('opens no preview when a pointer press focuses a letter', () => {
    const { tabs } = setup()
    act(() => tabs[0].focus())
    expect(screen.queryByText('Abyssal Maps')).not.toBeInTheDocument()
  })

  it('closes the preview when focus leaves the rail', () => {
    keyboardFocus()
    const { tabs } = setup()
    act(() => tabs[0].focus())
    expect(screen.getByText('Abyssal Maps')).toBeInTheDocument()
    act(() => tabs[0].blur())
    expect(screen.queryByText('Abyssal Maps')).not.toBeInTheDocument()
  })

  it('renders nothing for an empty index', () => {
    const { container } = render(
      <ThumbIndex
        entries={[]}
        current={null}
        onJump={vi.fn()}
        label="x"
        describe={() => ''}
        scope="s"
      />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
