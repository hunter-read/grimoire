import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AllValuesDialog from './AllValuesDialog'

const DOCUMENT = {
  id: 'demo',
  fields: {
    strength: { type: 'number', label: 'Strength', default: 10 },
    secret: { type: 'text', label: 'Secret Name', visible_if: 'strength > 99' },
  },
  computed: {
    str_mod: { formula: 'floor((strength - 10) / 2)', label: 'STR Mod' },
    armor_class: { formula: '10 + str_mod', label: 'Armour Class' },
  },
  // A layout that shows none of this - the case the dialog exists for.
  layout_ast: [{ tag: 'p', children: [{ text: 'A sheet with nothing on it' }] }],
}

const renderDialog = (props = {}) =>
  render(
    <AllValuesDialog
      document={DOCUMENT}
      data={{ strength: 14 }}
      entries={{}}
      onChange={vi.fn()}
      onReset={vi.fn()}
      onOverride={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />
  )

describe('AllValuesDialog', () => {
  it("shows every field whatever the sheet's layout shows", () => {
    renderDialog()
    expect(screen.getByLabelText('Strength')).toHaveValue(14)
    expect(screen.queryByText('A sheet with nothing on it')).not.toBeInTheDocument()
  })

  it('shows a field its condition would hide', () => {
    renderDialog()
    expect(screen.getByLabelText('Secret Name')).toBeInTheDocument()
  })

  it('shows every calculated value, overridable', async () => {
    const onOverride = vi.fn()
    renderDialog({ onOverride })
    expect(screen.getByText('Calculated')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Set Armour Class'))
    const input = screen.getByLabelText('Set Armour Class')
    await userEvent.clear(input)
    await userEvent.type(input, '18{Enter}')
    expect(onOverride).toHaveBeenCalledWith('armor_class', 18)
  })

  it('edits a field through the same handler as the sheet', async () => {
    const onChange = vi.fn()
    renderDialog({ onChange })
    await userEvent.type(screen.getByLabelText('Secret Name'), 'X')
    expect(onChange).toHaveBeenCalledWith('secret', 'X')
  })

  it('narrows by name or label, without breaking what depends on a hidden value', () => {
    renderDialog({ data: { strength: 14, _overrides: { str_mod: 4 } } })
    return userEvent.type(screen.getByLabelText('Search values'), 'armour').then(() => {
      expect(screen.queryByLabelText('Strength')).not.toBeInTheDocument()
      // str_mod is filtered out of view but still overridden, so AC is 14.
      expect(screen.getByText('14')).toBeInTheDocument()
    })
  })

  it('says when nothing matches', async () => {
    renderDialog()
    await userEvent.type(screen.getByLabelText('Search values'), 'zzz')
    expect(screen.getByText('Nothing matches.')).toBeInTheDocument()
  })

  it('offers nothing to edit when read-only', () => {
    renderDialog({ readOnly: true })
    expect(screen.queryByLabelText('Set Armour Class')).not.toBeInTheDocument()
  })

  it('closes on Escape, the close button, and the backdrop', async () => {
    const onClose = vi.fn()
    renderDialog({ onClose })
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByLabelText('Close'))
    await userEvent.click(screen.getByRole('dialog', { name: 'All values' }))
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
