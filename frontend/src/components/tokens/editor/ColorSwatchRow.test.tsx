import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ColorSwatchRow from './ColorSwatchRow'

describe('ColorSwatchRow', () => {
  it('offers plain white and black alongside the tinted presets', () => {
    render(<ColorSwatchRow label="Frame colour" value="gold" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'White' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Black' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Red' })).toBeInTheDocument()
  })

  it('reports monochrome as a plain hex literal', async () => {
    // Stored as hex rather than a new token, so it travels through the same
    // validated "#rrggbb" path every custom colour already uses.
    const onChange = vi.fn()
    render(<ColorSwatchRow label="Frame colour" value="gold" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'White' }))
    expect(onChange).toHaveBeenCalledWith('#ffffff')

    await userEvent.click(screen.getByRole('button', { name: 'Black' }))
    expect(onChange).toHaveBeenCalledWith('#000000')
  })

  it('marks the monochrome swatch as selected when it is the value', () => {
    render(<ColorSwatchRow label="Frame colour" value="#ffffff" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'White' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Black' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('reports a preset token by name, not by hex', async () => {
    const onChange = vi.fn()
    render(<ColorSwatchRow label="Frame colour" value="" onChange={onChange} allowNone />)
    await userEvent.click(screen.getByRole('button', { name: 'Red' }))
    expect(onChange).toHaveBeenCalledWith('red')
  })

  it('offers a "none" swatch only when asked, and clears through it', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ColorSwatchRow label="Frame colour" value="gold" onChange={onChange} />
    )
    expect(screen.queryByRole('button', { name: 'None' })).not.toBeInTheDocument()

    rerender(
      <ColorSwatchRow
        label="Frame colour"
        value="gold"
        onChange={onChange}
        allowNone
        noneLabel="None"
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'None' }))
    expect(onChange).toHaveBeenCalledWith('')
  })
})
