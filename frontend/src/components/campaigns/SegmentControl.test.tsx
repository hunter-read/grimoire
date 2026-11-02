import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import SegmentControl from './SegmentControl'

const OPTIONS = [
  { key: 'a', label: 'Alpha' },
  { key: 'b', label: 'Beta' },
  { key: 'c', label: 'Gamma' },
] as const

function Tabs({ start = 'a' }: { start?: 'a' | 'b' | 'c' | null }) {
  const [value, setValue] = useState<'a' | 'b' | 'c' | null>(start)
  return <SegmentControl value={value} options={OPTIONS} onChange={setValue} asTabs label="Kind" />
}

describe('SegmentControl', () => {
  it('as plain choices, marks the chosen one pressed and reports a click', () => {
    const onChange = vi.fn()
    render(<SegmentControl value="b" options={OPTIONS} onChange={onChange} label="Kind" />)
    expect(screen.getByRole('group', { name: 'Kind' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Gamma' }))
    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('has no group role without a label', () => {
    render(<SegmentControl value="a" options={OPTIONS} onChange={vi.fn()} />)
    expect(screen.queryByRole('group')).toBeNull()
  })

  it('as tabs, only the chosen tab takes Tab focus', () => {
    render(<Tabs start="b" />)
    expect(screen.getByRole('tablist', { name: 'Kind' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('tabindex', '-1')
  })

  it('puts the first tab in the Tab order when none is chosen', () => {
    render(<Tabs start={null} />)
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('tabindex', '0')
  })

  it('moves between tabs with the arrow keys, Home and End, choosing as it goes', () => {
    render(<Tabs />)
    const tablist = screen.getByRole('tablist')
    fireEvent.keyDown(tablist, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveFocus()
    fireEvent.keyDown(tablist, { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Gamma' })).toHaveFocus()
    fireEvent.keyDown(tablist, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveFocus()
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'Gamma' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(tablist, { key: 'Home' })
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveFocus()
    // Other keys are ignored.
    fireEvent.keyDown(tablist, { key: 'a' })
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true')
  })
})
