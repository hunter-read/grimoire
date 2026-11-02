import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import SegmentedControl from './SegmentedControl'

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
] as const

function Harness({ onChange = vi.fn() }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState<'a' | 'b' | 'c'>('a')
  return (
    <>
      <span id="seg-label">Pick one</span>
      <SegmentedControl
        options={OPTIONS}
        value={value}
        labelledBy="seg-label"
        onChange={(v) => {
          setValue(v)
          onChange(v)
        }}
      />
    </>
  )
}

describe('SegmentedControl', () => {
  it('is a named radio group with the current choice checked', () => {
    render(<Harness />)
    expect(screen.getByRole('radiogroup', { name: 'Pick one' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute('aria-checked', 'false')
  })

  it('keeps only the checked radio in the Tab order', () => {
    render(<Harness />)
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: 'Gamma' })).toHaveAttribute('tabindex', '-1')
  })

  it('moves to and picks the next choice with the arrow keys, wrapping', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Alpha' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('b')
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Beta' }), { key: 'ArrowUp' })
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Alpha' }), { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('c')
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Gamma' }), { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith('a')
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Alpha' }), { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('c')
  })

  it('ignores other keys and picks on click', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Alpha' }), { key: 'a' })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: 'Gamma' }))
    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('takes a plain name when nothing visible labels it', () => {
    render(<SegmentedControl options={OPTIONS} value="b" onChange={() => {}} label="Mode" />)
    expect(screen.getByRole('radiogroup', { name: 'Mode' })).toBeInTheDocument()
  })
})
