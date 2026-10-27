import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MultiSelectField from './MultiSelectField'

const DEFINITION = {
  type: 'multiselect',
  label: 'Languages',
  options: [
    { value: 'common', label: 'Common' },
    { value: 'elvish', label: 'Elvish' },
    { value: 'dwarvish', label: 'Dwarvish' },
  ],
}

const renderField = (props = {}) =>
  render(<MultiSelectField name="languages" definition={DEFINITION} value={[]} {...props} />)

describe('MultiSelectField', () => {
  it('renders a checkbox per option', () => {
    renderField()
    expect(screen.getByLabelText('Common')).toBeInTheDocument()
    expect(screen.getByLabelText('Elvish')).toBeInTheDocument()
    expect(screen.getByLabelText('Dwarvish')).toBeInTheDocument()
  })

  it('checks the options already chosen', () => {
    renderField({ value: ['elvish'] })
    expect(screen.getByLabelText('Elvish')).toBeChecked()
    expect(screen.getByLabelText('Common')).not.toBeChecked()
  })

  it('adds a choice', async () => {
    const onChange = vi.fn()
    renderField({ onChange })
    await userEvent.click(screen.getByLabelText('Elvish'))
    expect(onChange).toHaveBeenCalledWith(['elvish'])
  })

  it('removes a choice', async () => {
    const onChange = vi.fn()
    renderField({ value: ['common', 'elvish'], onChange })
    await userEvent.click(screen.getByLabelText('Common'))
    expect(onChange).toHaveBeenCalledWith(['elvish'])
  })

  it('stores choices in the schema order, not click order', async () => {
    const onChange = vi.fn()
    renderField({ value: ['dwarvish'], onChange })
    await userEvent.click(screen.getByLabelText('Common'))
    // Clicked second, but 'common' is declared first.
    expect(onChange).toHaveBeenCalledWith(['common', 'dwarvish'])
  })

  it('accepts plain-string options', () => {
    renderField({ definition: { type: 'multiselect', options: ['a', 'b'] } })
    expect(screen.getByLabelText('a')).toBeInTheDocument()
  })

  it('renders read-only as a list of labels', () => {
    renderField({ value: ['common', 'elvish'], readOnly: true })
    expect(screen.getByText('Common, Elvish')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('renders read-only with nothing chosen as a dash', () => {
    renderField({ value: [], readOnly: true })
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('treats a non-list value as nothing chosen', () => {
    expect(() => renderField({ value: 'common' })).not.toThrow()
    expect(screen.getByLabelText('Common')).not.toBeChecked()
  })
})
