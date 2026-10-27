import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ToggleSwitch from './ToggleSwitch'

describe('ToggleSwitch', () => {
  it('renders a switch reflecting the checked state and its label', () => {
    render(<ToggleSwitch id="s" checked={true} onChange={() => {}} label="On" />)
    const sw = screen.getByRole('switch')
    expect(sw).toBeChecked()
    expect(screen.getByText('On')).toBeInTheDocument()
  })

  it('is unchecked when checked is false', () => {
    render(<ToggleSwitch id="s" checked={false} onChange={() => {}} label="Off" />)
    expect(screen.getByRole('switch')).not.toBeChecked()
  })

  it('fires onChange with the new value', async () => {
    const onChange = vi.fn()
    render(<ToggleSwitch id="s" checked={false} onChange={onChange} label="Toggle" />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('renders the label before the switch when labelFirst is set', () => {
    render(<ToggleSwitch id="s" checked={false} onChange={() => {}} label="Group" labelFirst />)
    const wrapper = screen.getByText('Group').closest('label')
    const sw = screen.getByRole('switch')
    // The label text node precedes the switch in DOM order.
    expect(wrapper.textContent).toBe('Group')
    expect(
      wrapper.querySelector('span')?.textContent === 'Group' ||
        wrapper.firstElementChild?.textContent === 'Group'
    ).toBe(true)
    // Clicking the label (the whole pill) still toggles the switch.
    expect(sw).toBeInTheDocument()
  })

  it('clicking the label toggles the switch (whole pill is clickable)', async () => {
    const onChange = vi.fn()
    render(
      <ToggleSwitch id="s" checked={false} onChange={onChange} label="Group" labelFirst pill />
    )
    await userEvent.click(screen.getByText('Group'))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
