import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ApplyToAllDialog from './ApplyToAllDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => (opts?.count == null ? key : `${key}:${opts.count}`),
  }),
}))

const fields = [
  { field: 'category', label: 'Category' },
  { field: 'publisher', label: 'Publisher' },
  { field: 'tags', label: 'Tags' },
]
const values = { category: 'adventure', publisher: 'Acme', tags: '' }

function renderDialog(props = {}) {
  return render(
    <ApplyToAllDialog
      fields={fields}
      count={3}
      values={values}
      onApply={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />
  )
}

describe('ApplyToAllDialog', () => {
  it('lists every field unchecked, with its value preview', () => {
    renderDialog()
    for (const { label } of fields) {
      expect(screen.getByRole('checkbox', { name: label })).not.toBeChecked()
    }
    expect(screen.getByText('adventure')).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
    // An empty value is called out rather than rendered blank.
    expect(screen.getByText('bulkEdit.emptyValue')).toBeInTheDocument()
  })

  it('applies only the ticked fields, then closes', () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    renderDialog({ onApply, onClose })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Category' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tags' }))
    fireEvent.click(screen.getByRole('button', { name: 'bulkEdit.applySelected:2' }))

    expect(onApply).toHaveBeenCalledWith(['category', 'tags'])
    expect(onClose).toHaveBeenCalled()
  })

  it('unticks a field that was ticked', () => {
    const onApply = vi.fn()
    renderDialog({ onApply })

    const box = screen.getByRole('checkbox', { name: 'Publisher' })
    fireEvent.click(box)
    expect(box).toBeChecked()
    fireEvent.click(box)
    expect(box).not.toBeChecked()

    expect(screen.getByRole('button', { name: 'bulkEdit.applySelected:0' })).toBeDisabled()
  })

  it('cannot apply with nothing ticked', () => {
    const onApply = vi.fn()
    renderDialog({ onApply })
    fireEvent.click(screen.getByRole('button', { name: 'bulkEdit.applySelected:0' }))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('toggles the whole list from the select-all shortcut', () => {
    renderDialog()
    fireEvent.click(screen.getByText('bulkEdit.selectAll'))
    for (const { label } of fields) {
      expect(screen.getByRole('checkbox', { name: label })).toBeChecked()
    }

    fireEvent.click(screen.getByText('bulkEdit.selectNone'))
    for (const { label } of fields) {
      expect(screen.getByRole('checkbox', { name: label })).not.toBeChecked()
    }
  })

  it('closes from the close button and the backdrop', () => {
    const onClose = vi.fn()
    const { container } = renderDialog({ onClose })

    fireEvent.click(screen.getByLabelText('common.close'))
    expect(onClose).toHaveBeenCalledTimes(1)

    // Clicking the panel itself must not close; only the backdrop does.
    fireEvent.click(screen.getByRole('dialog').firstChild)
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(container.querySelector('[role="dialog"]'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('cancels without applying', () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    renderDialog({ onApply, onClose })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Category' }))
    fireEvent.click(screen.getByText('common.cancel'))

    expect(onApply).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
