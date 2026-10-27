import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SingleSelectCombobox from './SingleSelectCombobox'
import api from '../../api'

vi.mock('../../api', () => ({ default: { post: vi.fn(() => Promise.resolve({ id: 'x' })) } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) => (k === 'common.clear' ? 'Clear' : `Create "${o?.name}"`),
  }),
}))

beforeEach(() => vi.clearAllMocks())

function Harness({ options = ['Dungeons & Dragons', 'Cyberpunk'], initial = '', ...rest }) {
  const [value, setValue] = useState(initial)
  return (
    <div>
      <SingleSelectCombobox
        id="p"
        value={value}
        onChange={setValue}
        options={options}
        placeholder="Parent"
        {...rest}
      />
      <output data-testid="val">{value}</output>
    </div>
  )
}

describe('SingleSelectCombobox', () => {
  it('lists options on focus and selects one by click', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(screen.getByRole('option', { name: 'Cyberpunk' }))
    expect(screen.getByTestId('val').textContent).toBe('Cyberpunk')
  })

  it('filters options as you type', () => {
    render(<Harness />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'cyber' } })
    expect(screen.getByRole('option', { name: 'Cyberpunk' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Dungeons & Dragons' })).not.toBeInTheDocument()
  })

  it('offers a create row for unknown text and commits it', async () => {
    render(<Harness />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Pathfinder' } })
    await userEvent.click(screen.getByRole('option', { name: /Create "Pathfinder"/ }))
    expect(screen.getByTestId('val').textContent).toBe('Pathfinder')
  })

  it('persists a created value to the endpoint and calls onCreate', async () => {
    const onCreate = vi.fn()
    render(<Harness createEndpoint="/parent-systems" onCreate={onCreate} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Pathfinder' } })
    await userEvent.click(screen.getByRole('option', { name: /Create "Pathfinder"/ }))
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/parent-systems', { name: 'Pathfinder' })
    )
    await waitFor(() => expect(onCreate).toHaveBeenCalled())
  })

  it('does not offer create for an exact existing match', () => {
    render(<Harness />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Cyberpunk' } })
    expect(screen.queryByRole('option', { name: /Create/ })).not.toBeInTheDocument()
  })

  it('clears the value via the clear button', async () => {
    render(<Harness initial="Cyberpunk" />)
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByTestId('val').textContent).toBe('')
  })

  it('navigates with arrows and commits on Enter', () => {
    render(<Harness />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    // Two options; ArrowDown moves to the second, Enter commits it.
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('val').textContent).toBe('Dungeons & Dragons')
  })

  it('commits the raw query on Enter when no rows match', () => {
    render(<Harness options={[]} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '   ' } }) // whitespace → no create row
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('val').textContent).toBe('')
  })

  it('closes the dropdown on Escape', async () => {
    render(<Harness />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    expect(screen.getByRole('option', { name: 'Cyberpunk' })).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: 'Cyberpunk' })).not.toBeInTheDocument()
    )
  })

  it('does not persist when creating without a createEndpoint', async () => {
    render(<Harness />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Pathfinder' } })
    await userEvent.click(screen.getByRole('option', { name: /Create "Pathfinder"/ }))
    expect(api.post).not.toHaveBeenCalled()
  })
})
