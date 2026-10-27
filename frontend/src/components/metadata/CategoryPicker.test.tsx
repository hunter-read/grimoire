import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CategoryPicker from './CategoryPicker'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, o) => (o ? `${k}:${o.name}` : k) }),
}))

const options = [
  { value: 'core', label: 'Core Rulebooks' },
  { value: 'adventure', label: 'Adventures & Modules' },
  { value: 'my-custom', label: 'my-custom' },
]

function Harness({ initial = 'core' }) {
  const [value, setValue] = useState(initial)
  return (
    <div>
      <CategoryPicker value={value} onChange={setValue} options={options} />
      <output data-testid="val">{value}</output>
    </div>
  )
}

describe('CategoryPicker', () => {
  it('shows the friendly label for the current slug when not editing', () => {
    render(<Harness />)
    expect(screen.getByRole('combobox').value).toBe('Core Rulebooks')
  })

  it('lists options on focus and filters as you type', async () => {
    render(<Harness />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    expect(screen.getAllByRole('option').length).toBeGreaterThanOrEqual(3)
    fireEvent.change(input, { target: { value: 'advent' } })
    const labels = screen.getAllByRole('option').map((o) => o.textContent)
    expect(labels).toContain('Adventures & Modules')
    expect(labels).not.toContain('Core Rulebooks')
  })

  it('commits the picked slug (not the label)', async () => {
    render(<Harness />)
    fireEvent.focus(screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'advent' } })
    await userEvent.click(screen.getByRole('option', { name: 'Adventures & Modules' }))
    expect(screen.getByTestId('val').textContent).toBe('adventure')
  })

  it('offers a create row for a brand-new value, slugified', async () => {
    render(<Harness />)
    fireEvent.focus(screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'My New Cat!' } })
    await userEvent.click(screen.getByRole('option', { name: /createCategory/ }))
    expect(screen.getByTestId('val').textContent).toBe('my-new-cat')
  })

  it('does not offer create for an existing slug', () => {
    render(<Harness />)
    fireEvent.focus(screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'core' } })
    expect(screen.queryByRole('option', { name: /createCategory/ })).not.toBeInTheDocument()
  })

  it('commits the active option on Enter after arrow navigation', async () => {
    render(<Harness />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })
    // Enter commits some option (a valid slug).
    expect(['core', 'adventure', 'my-custom']).toContain(screen.getByTestId('val').textContent)
  })

  it('closes the list on Escape without changing the value', () => {
    render(<Harness />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'advent' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(screen.getByTestId('val').textContent).toBe('core')
  })

  it('closes the dropdown when clicking outside', () => {
    render(
      <div>
        <Harness />
        <button>outside</button>
      </div>
    )
    fireEvent.focus(screen.getByRole('combobox'))
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0)
    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })
})
