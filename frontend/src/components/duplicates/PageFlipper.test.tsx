import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PageFlipper from './PageFlipper'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

describe('PageFlipper', () => {
  it('shows the current page against the shared maximum', () => {
    render(<PageFlipper page={3} maxPage={10} onChange={vi.fn()} />)
    expect(screen.getByText(/3/)).toBeInTheDocument()
    expect(screen.getByText(/10/)).toBeInTheDocument()
  })

  it('steps forward and back a page at a time', async () => {
    const onChange = vi.fn()
    render(<PageFlipper page={4} maxPage={10} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /nextPage/ }))
    expect(onChange).toHaveBeenCalledWith(5)
    await userEvent.click(screen.getByRole('button', { name: /prevPage/ }))
    expect(onChange).toHaveBeenCalledWith(3)
  })

  it('cannot step past either end', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<PageFlipper page={1} maxPage={3} onChange={onChange} />)
    expect(screen.getByRole('button', { name: /prevPage/ })).toBeDisabled()

    rerender(<PageFlipper page={3} maxPage={3} onChange={onChange} />)
    expect(screen.getByRole('button', { name: /nextPage/ })).toBeDisabled()
  })

  it('clamps rather than trusting the incoming page', async () => {
    // Guards the bound even if a caller hands it a page outside the range.
    const onChange = vi.fn()
    render(<PageFlipper page={99} maxPage={10} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /prevPage/ }))
    expect(onChange).toHaveBeenCalledWith(10)
  })
})
