import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ToggleSwitch from './ToggleSwitch'

describe('ToggleSwitch', () => {
  it('renders its label and reflects the checked state', () => {
    render(<ToggleSwitch id="t1" checked onChange={() => {}} label="Show maps" />)

    const input = screen.getByRole('switch')
    expect(input).toBeChecked()
    expect(screen.getByText('Show maps')).toBeInTheDocument()
  })

  it('reports the new state when toggled on', async () => {
    const onChange = vi.fn()
    render(<ToggleSwitch id="t2" checked={false} onChange={onChange} label="Show maps" />)

    await userEvent.click(screen.getByRole('switch'))

    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('reports the new state when toggled off', async () => {
    const onChange = vi.fn()
    render(<ToggleSwitch id="t3" checked onChange={onChange} label="Show maps" />)

    await userEvent.click(screen.getByRole('switch'))

    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('is reachable by clicking the label', async () => {
    const onChange = vi.fn()
    render(<ToggleSwitch id="t4" checked={false} onChange={onChange} label="Show maps" />)

    await userEvent.click(screen.getByText('Show maps'))

    expect(onChange).toHaveBeenCalledWith(true)
  })

  // The knob sits on the gold track when on, so it uses the on-accent role
  // rather than a hardcoded near-black that would not follow a theme.
  it('draws the knob with themed colours in both states', () => {
    const { container, rerender } = render(
      <ToggleSwitch id="t5" checked onChange={() => {}} label="x" />
    )
    const knob = () => container.querySelectorAll('span > span')[1]
    expect(knob()).toHaveStyle({ background: 'var(--on-accent)' })

    rerender(<ToggleSwitch id="t5" checked={false} onChange={() => {}} label="x" />)
    expect(knob()).toHaveStyle({ background: 'var(--text-muted)' })
  })
})
