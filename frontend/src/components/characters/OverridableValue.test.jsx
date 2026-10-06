import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OverridableValue from './OverridableValue'

const renderValue = (props = {}) =>
  render(
    <OverridableValue label="Armour Class" display="12" raw={12} onOverride={vi.fn()} {...props} />
  )

describe('OverridableValue', () => {
  it('is a plain value when it cannot be changed', () => {
    render(<OverridableValue label="AC" display="12" raw={12} />)
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('keeps a typed number as a number', async () => {
    // So formulas depending on it keep doing arithmetic.
    const onOverride = vi.fn()
    renderValue({ onOverride })
    await userEvent.click(screen.getByLabelText('Set Armour Class'))
    const input = screen.getByLabelText('Set Armour Class')
    await userEvent.clear(input)
    await userEvent.type(input, '19{Enter}')
    expect(onOverride).toHaveBeenCalledWith(19)
  })

  it('keeps text as text', async () => {
    const onOverride = vi.fn()
    renderValue({ onOverride })
    await userEvent.click(screen.getByLabelText('Set Armour Class'))
    const input = screen.getByLabelText('Set Armour Class')
    await userEvent.clear(input)
    await userEvent.type(input, '19 with shield{Enter}')
    expect(onOverride).toHaveBeenCalledWith('19 with shield')
  })

  it('clearing the box returns it to the formula', async () => {
    const onOverride = vi.fn()
    renderValue({ onOverride, overridden: true, raw: 19, display: '19' })
    await userEvent.click(screen.getByLabelText(/Armour Class: 19, set by you/))
    await userEvent.clear(screen.getByLabelText('Set Armour Class'))
    await userEvent.keyboard('{Enter}')
    expect(onOverride).toHaveBeenCalledWith(undefined)
  })

  it('Escape abandons the edit', async () => {
    const onOverride = vi.fn()
    renderValue({ onOverride })
    await userEvent.click(screen.getByLabelText('Set Armour Class'))
    await userEvent.type(screen.getByLabelText('Set Armour Class'), '5{Escape}')
    expect(onOverride).not.toHaveBeenCalled()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('leaving the box keeps the new value', async () => {
    const onOverride = vi.fn()
    renderValue({ onOverride })
    await userEvent.click(screen.getByLabelText('Set Armour Class'))
    const input = screen.getByLabelText('Set Armour Class')
    await userEvent.clear(input)
    await userEvent.type(input, '14')
    await userEvent.tab()
    expect(onOverride).toHaveBeenCalledWith(14)
  })

  it('marks an overridden value and offers a reset', async () => {
    const onOverride = vi.fn()
    renderValue({ onOverride, overridden: true, raw: 19, display: '19' })
    await userEvent.click(screen.getByLabelText('Return Armour Class to its calculated value'))
    expect(onOverride).toHaveBeenCalledWith(undefined)
  })

  it('offers no reset for a calculated value', () => {
    renderValue()
    expect(screen.queryByLabelText(/Return Armour Class/)).not.toBeInTheDocument()
  })
})
