import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NumberNudge from './NumberNudge'

describe('NumberNudge', () => {
  it('increments and decrements by the step', () => {
    const onChange = vi.fn()
    render(<NumberNudge value={4} step={0.5} label="Range" onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Range +0.5'))
    expect(onChange).toHaveBeenCalledWith(4.5)
    fireEvent.click(screen.getByLabelText('Range -0.5'))
    expect(onChange).toHaveBeenCalledWith(3.5)
  })

  it('defaults to whole-number steps', () => {
    const onChange = vi.fn()
    render(<NumberNudge value={10} label="Offset" onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Offset +1'))
    expect(onChange).toHaveBeenCalledWith(11)
  })

  it('rounds away floating-point drift', () => {
    // 0.1 + 0.2 must not become 0.30000000000000004 in a stored coordinate.
    const onChange = vi.fn()
    render(<NumberNudge value={0.1} step={0.2} label="X" onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('X +0.2'))
    expect(onChange).toHaveBeenCalledWith(0.3)
  })

  it('accepts typed input', async () => {
    const onChange = vi.fn()
    render(<NumberNudge value={0} label="Cell" onChange={onChange} />)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Cell' }), { target: { value: '140' } })
    expect(onChange).toHaveBeenCalledWith(140)
  })

  it('treats unparseable input as zero rather than NaN', async () => {
    const onChange = vi.fn()
    render(<NumberNudge value={5} label="Cell" onChange={onChange} />)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Cell' }), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(0)
  })
})
