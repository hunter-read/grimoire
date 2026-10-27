import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DiceMaterialsPicker from './DiceMaterialsPicker'
import api from '../../api'
import { groupsFromManaged } from './diceMaterials'

vi.mock('../../api', () => ({ default: { post: vi.fn(() => Promise.resolve({ id: 'x' })) } }))

beforeEach(() => vi.clearAllMocks())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) =>
      ({
        'metadata.noDiceMaterials': 'No dice/materials selected',
        'metadata.addDiceMaterial': 'Add dice/material',
        'metadata.diceMaterialsComboPlaceholder': 'Search or add dice/materials…',
        'metadata.createDiceMaterial': `Create "${o?.name}"`,
        'metadata.diceCustomGroup': 'Custom',
      })[k] || k,
  }),
}))

function Harness({ initial = [], groups, onCreate }) {
  const [selected, setSelected] = useState(initial)
  return (
    <div>
      <DiceMaterialsPicker
        selected={selected}
        onChange={setSelected}
        groups={groups}
        onCreate={onCreate}
      />
      <output data-testid="sel">{JSON.stringify(selected)}</output>
    </div>
  )
}

describe('DiceMaterialsPicker', () => {
  it('shows the empty placeholder', () => {
    render(<Harness />)
    expect(screen.getByText('No dice/materials selected')).toBeInTheDocument()
  })

  it('shows group headers (unselectable) and default items on focus', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('combobox'))
    // Group headers render but are not options (role=presentation, not option).
    expect(screen.getByText('Dice')).toBeInTheDocument()
    expect(screen.getByText('Cards')).toBeInTheDocument()
    // Items are options.
    expect(screen.getByRole('option', { name: 'D20' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Tarot Cards' })).toBeInTheDocument()
  })

  it('adds a default item by clicking it', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(screen.getByRole('option', { name: 'D20' }))
    expect(screen.getByTestId('sel').textContent).toBe('["D20"]')
  })

  it('filters items as you type and adds on Enter', () => {
    render(<Harness />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'tarot' } })
    expect(screen.getByRole('option', { name: 'Tarot Cards' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'D20' })).not.toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('sel').textContent).toBe('["Tarot Cards"]')
  })

  it('offers a create row for a custom value', async () => {
    render(<Harness />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Glass Beads' } })
    await userEvent.click(screen.getByRole('option', { name: /Create "Glass Beads"/ }))
    expect(screen.getByTestId('sel').textContent).toBe('["Glass Beads"]')
  })

  it('removes a selected chip', async () => {
    render(<Harness initial={['D6']} />)
    await userEvent.click(screen.getByLabelText('Remove D6'))
    expect(screen.getByTestId('sel').textContent).toBe('[]')
  })

  it('sources options from a managed group list when provided', async () => {
    const groups = groupsFromManaged([
      { name: 'Fudge Dice', group: 'Dice' },
      { name: 'Runestones', group: 'Custom' },
    ])
    render(<Harness groups={groups} />)
    await userEvent.click(screen.getByRole('combobox'))
    expect(screen.getByRole('option', { name: 'Fudge Dice' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Runestones' })).toBeInTheDocument()
    // Built-in defaults are NOT shown when a managed list is supplied.
    expect(screen.queryByRole('option', { name: 'D20' })).not.toBeInTheDocument()
  })

  it('persists a created custom value and calls onCreate when provided', async () => {
    const onCreate = vi.fn()
    render(<Harness onCreate={onCreate} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Runestones' } })
    await userEvent.click(screen.getByRole('option', { name: /Create "Runestones"/ }))
    expect(screen.getByTestId('sel').textContent).toBe('["Runestones"]')
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/dice-materials', {
        name: 'Runestones',
        group: 'Custom',
      })
    )
    await waitFor(() => expect(onCreate).toHaveBeenCalled())
  })

  it('does not POST when creating without onCreate (free-text only)', async () => {
    render(<Harness />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Glass Beads' } })
    await userEvent.click(screen.getByRole('option', { name: /Create "Glass Beads"/ }))
    expect(screen.getByTestId('sel').textContent).toBe('["Glass Beads"]')
    expect(api.post).not.toHaveBeenCalled()
  })
})
