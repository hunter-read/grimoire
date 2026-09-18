import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FieldRenderer from './FieldRenderer'

describe('FieldRenderer', () => {
  describe('editable mode', () => {
    it('renders a text field and reports changes', async () => {
      const onChange = vi.fn()
      render(
        <FieldRenderer
          name="hero"
          definition={{ type: 'text', label: 'Hero' }}
          value=""
          onChange={onChange}
        />
      )
      await userEvent.type(screen.getByLabelText('Hero'), 'A')
      expect(onChange).toHaveBeenCalledWith('A')
    })

    it('renders a number field that reports numbers, not strings', async () => {
      const onChange = vi.fn()
      render(
        <FieldRenderer
          name="str"
          definition={{ type: 'number', label: 'Strength' }}
          value={null}
          onChange={onChange}
        />
      )
      await userEvent.type(screen.getByLabelText('Strength'), '7')
      expect(onChange).toHaveBeenCalledWith(7)
    })

    it('reports an emptied number as null rather than 0', async () => {
      const onChange = vi.fn()
      render(
        <FieldRenderer
          name="str"
          definition={{ type: 'number', label: 'Strength' }}
          value={5}
          onChange={onChange}
        />
      )
      await userEvent.clear(screen.getByLabelText('Strength'))
      expect(onChange).toHaveBeenCalledWith(null)
    })

    it('renders a checkbox', async () => {
      const onChange = vi.fn()
      render(
        <FieldRenderer
          name="inspired"
          definition={{ type: 'checkbox', label: 'Inspired' }}
          value={false}
          onChange={onChange}
        />
      )
      await userEvent.click(screen.getByLabelText('Inspired'))
      expect(onChange).toHaveBeenCalledWith(true)
    })

    it('renders a textarea', async () => {
      const onChange = vi.fn()
      render(
        <FieldRenderer
          name="notes"
          definition={{ type: 'textarea', label: 'Notes' }}
          value=""
          onChange={onChange}
        />
      )
      await userEvent.type(screen.getByLabelText('Notes'), 'x')
      expect(onChange).toHaveBeenCalledWith('x')
    })

    it('renders a select with its options', async () => {
      const onChange = vi.fn()
      render(
        <FieldRenderer
          name="class_name"
          definition={{
            type: 'select',
            label: 'Class',
            options: [
              { value: 'fighter', label: 'Fighter' },
              { value: 'wizard', label: 'Wizard' },
            ],
          }}
          value=""
          onChange={onChange}
        />
      )
      await userEvent.selectOptions(screen.getByLabelText('Class'), 'wizard')
      expect(onChange).toHaveBeenCalledWith('wizard')
    })

    it('accepts plain-string select options', () => {
      render(
        <FieldRenderer
          name="size"
          definition={{ type: 'select', label: 'Size', options: ['small', 'large'] }}
          value="large"
        />
      )
      expect(screen.getByLabelText('Size')).toHaveValue('large')
    })

    it('falls back to the field name when no label is given', () => {
      render(<FieldRenderer name="hit_points" definition={{ type: 'text' }} value="" />)
      expect(screen.getByLabelText('hit_points')).toBeInTheDocument()
    })
  })

  describe('read-only mode', () => {
    it('renders text rather than an input', () => {
      render(
        <FieldRenderer
          name="str"
          definition={{ type: 'number', label: 'Strength' }}
          value={16}
          readOnly
        />
      )
      expect(screen.getByText('16')).toBeInTheDocument()
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    })

    it('shows a tick for a checked checkbox and a dash for an empty value', () => {
      const { unmount } = render(
        <FieldRenderer name="a" definition={{ type: 'checkbox' }} value readOnly />
      )
      expect(screen.getByText('✓')).toBeInTheDocument()
      unmount()

      render(<FieldRenderer name="b" definition={{ type: 'text' }} value="" readOnly />)
      expect(screen.getByText('—')).toBeInTheDocument()
    })

    it("shows a select option's label rather than its stored value", () => {
      render(
        <FieldRenderer
          name="class_name"
          definition={{
            type: 'select',
            options: [{ value: 'fighter', label: 'Fighter' }],
          }}
          value="fighter"
          readOnly
        />
      )
      expect(screen.getByText('Fighter')).toBeInTheDocument()
      expect(screen.queryByText('fighter')).not.toBeInTheDocument()
    })
  })
})
