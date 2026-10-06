import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CompactNumber from './CompactNumber'
import FieldRenderer from './FieldRenderer'

const renderBox = (props = {}) =>
  render(<CompactNumber id="n" value={5} onChange={vi.fn()} {...props} />)

describe('CompactNumber', () => {
  it('is a text box with a numeric keyboard, not a spinner', () => {
    renderBox()
    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveValue('5')
  })

  it('stores whole numbers as numbers', async () => {
    const onChange = vi.fn()
    renderBox({ value: null, onChange })
    await userEvent.type(screen.getByRole('textbox'), '21')
    expect(onChange).toHaveBeenLastCalledWith(21)
  })

  it('keeps a half-typed minus until the digit arrives', async () => {
    const onChange = vi.fn()
    renderBox({ value: null, onChange })
    await userEvent.type(screen.getByRole('textbox'), '-')
    expect(screen.getByRole('textbox')).toHaveValue('-')
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.type(screen.getByRole('textbox'), '3')
    expect(onChange).toHaveBeenLastCalledWith(-3)
  })

  it('ignores anything that is not a digit', async () => {
    const onChange = vi.fn()
    renderBox({ value: null, onChange })
    await userEvent.type(screen.getByRole('textbox'), 'x')
    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clears to nothing', async () => {
    const onChange = vi.fn()
    renderBox({ onChange })
    await userEvent.clear(screen.getByRole('textbox'))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('holds to the field bounds', async () => {
    const onChange = vi.fn()
    renderBox({ value: null, min: 0, max: 3, onChange })
    await userEvent.type(screen.getByRole('textbox'), '9')
    expect(onChange).toHaveBeenLastCalledWith(3)
  })

  it('drops a lone sign when the box is left', async () => {
    renderBox({ value: 4 })
    const input = screen.getByRole('textbox')
    await userEvent.clear(input)
    await userEvent.type(input, '-')
    await userEvent.tab()
    expect(input).toHaveValue('4')
  })

  it('follows a value changed from outside', () => {
    const { rerender } = renderBox({ value: 1 })
    rerender(<CompactNumber id="n" value={8} onChange={vi.fn()} />)
    expect(screen.getByRole('textbox')).toHaveValue('8')
  })

  it('is what FieldRenderer draws for a compact number', () => {
    render(
      <FieldRenderer
        name="hp"
        definition={{ type: 'number', label: 'HP' }}
        value={7}
        variant="compact"
        onChange={vi.fn()}
      />
    )
    expect(screen.getByLabelText('HP')).toHaveAttribute('inputmode', 'numeric')
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })
})
