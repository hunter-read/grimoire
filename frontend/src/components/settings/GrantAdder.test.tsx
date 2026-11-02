import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GrantAdder from './GrantAdder'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const OPTIONS = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
]

beforeEach(() => vi.clearAllMocks())

describe('GrantAdder', () => {
  it('renders nothing when there is nothing to grant', () => {
    const { container } = render(<GrantAdder label="l" options={[]} onAdd={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('defaults to the least permissive level', () => {
    render(<GrantAdder label="pick" options={OPTIONS} onAdd={() => {}} />)
    expect(screen.getByLabelText('access.grants.levelLabel')).toHaveValue('gm')
  })

  it('passes the selected target and level up', () => {
    const onAdd = vi.fn()
    render(<GrantAdder label="pick" options={OPTIONS} onAdd={onAdd} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'pick' }), { target: { value: 'b' } })
    fireEvent.change(screen.getByLabelText('access.grants.levelLabel'), {
      target: { value: 'admin' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'a11y.settingsAccess.addGrant' }))
    expect(onAdd).toHaveBeenCalledWith('b', 'admin')
  })

  it('cannot submit without a target', () => {
    render(<GrantAdder label="pick" options={OPTIONS} onAdd={() => {}} />)
    expect(screen.getByRole('button', { name: 'a11y.settingsAccess.addGrant' })).toBeDisabled()
  })

  it('clears the target after adding, so the next grant starts fresh', () => {
    render(<GrantAdder label="pick" options={OPTIONS} onAdd={() => {}} />)
    const picker = screen.getByRole('combobox', { name: 'pick' })
    fireEvent.change(picker, { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: 'a11y.settingsAccess.addGrant' }))
    expect(picker).toHaveValue('')
  })

  it('is disabled while a request is in flight', () => {
    render(<GrantAdder label="pick" options={OPTIONS} onAdd={() => {}} disabled />)
    fireEvent.change(screen.getByRole('combobox', { name: 'pick' }), { target: { value: 'a' } })
    expect(screen.getByRole('button', { name: 'a11y.settingsAccess.addGrant' })).toBeDisabled()
  })
})
