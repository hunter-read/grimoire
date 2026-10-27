import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import Toggle from './Toggle'

describe('Toggle', () => {
  it('reports the new state when switched on', () => {
    const onChange = vi.fn()
    render(<Toggle label="Vision" checked={false} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Vision'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('reports the new state when switched off', () => {
    const onChange = vi.fn()
    render(<Toggle label="Vision" checked onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Vision'))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('shows the hint that says what turning it off does', () => {
    render(<Toggle label="Vision" hint="Sees nothing at all." checked onChange={vi.fn()} />)
    expect(screen.getByText('Sees nothing at all.')).toBeInTheDocument()
  })

  it('omits the hint element when there is no hint', () => {
    const { container } = render(<Toggle label="Vision" checked onChange={vi.fn()} />)
    expect(container.querySelectorAll('div')).toHaveLength(1)
  })

  it('reflects the checked state to assistive tech', () => {
    render(<Toggle label="Vision" checked onChange={vi.fn()} />)
    expect(screen.getByLabelText('Vision')).toBeChecked()
  })
})
