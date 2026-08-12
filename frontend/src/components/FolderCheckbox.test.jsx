import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FolderCheckbox from './FolderCheckbox'

const box = (container) => container.firstChild

describe('FolderCheckbox', () => {
  it('calls onChange when clicked', async () => {
    const onChange = vi.fn()
    const { container } = render(<FolderCheckbox checked={false} onChange={onChange} />)

    await userEvent.click(box(container))

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('does not let the click reach an enclosing row', async () => {
    const onRowClick = vi.fn()
    const onChange = vi.fn()
    const { container } = render(
      <div onClick={onRowClick} data-testid="row">
        <FolderCheckbox checked={false} onChange={onChange} />
      </div>
    )

    await userEvent.click(container.querySelector('[data-testid="row"]').firstChild)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('fills with the accent colour when checked', () => {
    const { container } = render(<FolderCheckbox checked onChange={() => {}} />)
    expect(box(container)).toHaveStyle({ background: 'var(--gold)' })
  })

  it('fills with the accent colour when indeterminate', () => {
    const { container } = render(<FolderCheckbox indeterminate onChange={() => {}} />)
    expect(box(container)).toHaveStyle({ background: 'var(--gold)' })
  })

  // Unchecked is an empty input surface with a visible border. It previously
  // used a translucent black fill and a white border, both of which vanish
  // against a light theme.
  it('uses themed input colours when unchecked', () => {
    const { container } = render(<FolderCheckbox checked={false} onChange={() => {}} />)
    expect(box(container)).toHaveStyle({ background: 'var(--bg-input)' })
    // Read the inline style directly: jsdom does not expand the `border`
    // shorthand when its value contains a custom property.
    expect(box(container).style.border).toBe('2px solid var(--border-light)')
  })
})
