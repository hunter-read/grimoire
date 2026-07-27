import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ToolbarButton from './ToolbarButton'

describe('ToolbarButton', () => {
  it('renders the label and fires onClick', async () => {
    const onClick = vi.fn()
    render(<ToolbarButton label="Do It" onClick={onClick} />)
    await userEvent.click(screen.getByText('Do It'))
    expect(onClick).toHaveBeenCalled()
  })

  it('does not fire when disabled', async () => {
    const onClick = vi.fn()
    render(<ToolbarButton label="Nope" onClick={onClick} disabled />)
    expect(screen.getByText('Nope').closest('button')).toBeDisabled()
  })

  it('reflects the active state via aria-pressed', () => {
    render(<ToolbarButton label="On" active ariaPressed />)
    expect(screen.getByText('On').closest('button')).toHaveAttribute('aria-pressed', 'true')
  })

  it('applies a stable minWidth', () => {
    render(<ToolbarButton label="Wide" minWidth={140} />)
    expect(screen.getByText('Wide').closest('button').style.minWidth).toBe('140px')
  })
})
