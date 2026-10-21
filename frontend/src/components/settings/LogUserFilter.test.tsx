import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import LogUserFilter from './LogUserFilter'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

const options = () => screen.getAllByRole('option').map((o) => (o as HTMLOptionElement).value)

describe('LogUserFilter', () => {
  it('offers everyone plus each user in the buffer', () => {
    render(<LogUserFilter value="" users={['alice', 'bob']} onChange={() => {}} />)
    expect(options()).toEqual(['', 'alice', 'bob'])
    expect(screen.getByRole('combobox').style.color).toBe('var(--text-dim)')
  })

  it('keeps a linked-to user selectable when they have no lines yet', () => {
    render(<LogUserFilter value="carol" users={['alice']} onChange={() => {}} />)
    expect(options()).toEqual(['', 'carol', 'alice'])
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('carol')
    expect(select.style.color).toBe('var(--gold)')
  })

  it('reports the picked user', () => {
    const onChange = vi.fn()
    render(<LogUserFilter value="" users={['alice']} onChange={onChange} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'alice' } })
    expect(onChange).toHaveBeenCalledWith('alice')
  })
})
