import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChoiceDialog from './ChoiceDialog'

const CHOICE = {
  source: 'klass',
  target: 'skills',
  count: 2,
  options: ['Arcana', 'History', 'Insight'],
  label: '',
}

const renderDialog = (props = {}) =>
  render(<ChoiceDialog choice={CHOICE} onConfirm={vi.fn()} onSkip={vi.fn()} {...props} />)

describe('ChoiceDialog', () => {
  it('asks for the number the rule gives', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Choose 2' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('2 left to choose')
  })

  it("uses the rule's own label when it has one", () => {
    renderDialog({ choice: { ...CHOICE, label: 'Choose class skills' } })
    expect(screen.getByRole('dialog', { name: 'Choose class skills' })).toBeInTheDocument()
  })

  it('says where the choice came from', () => {
    renderDialog({ sourceLabel: 'Class' })
    expect(screen.getByText('From Class')).toBeInTheDocument()
  })

  it('stops at the count', async () => {
    renderDialog()
    await userEvent.click(screen.getByLabelText('Arcana'))
    await userEvent.click(screen.getByLabelText('History'))
    expect(screen.getByLabelText('Insight')).toBeDisabled()
    // Unticking one frees a slot again.
    await userEvent.click(screen.getByLabelText('History'))
    expect(screen.getByLabelText('Insight')).not.toBeDisabled()
  })

  it('shows what the character already has but will not pick it again', () => {
    renderDialog({ have: ['Insight'] })
    const insight = screen.getByLabelText(/Insight/)
    expect(insight).toBeChecked()
    expect(insight).toBeDisabled()
    expect(screen.getByText('already have')).toBeInTheDocument()
  })

  it('hands back what was picked', async () => {
    const onConfirm = vi.fn()
    renderDialog({ onConfirm })
    await userEvent.click(screen.getByLabelText('Arcana'))
    await userEvent.click(screen.getByText('Add'))
    expect(onConfirm).toHaveBeenCalledWith(['Arcana'])
  })

  it('will not confirm nothing', () => {
    renderDialog()
    expect(screen.getByText('Add').closest('button')).toBeDisabled()
  })

  it('can always be put off', async () => {
    // The sheet stays editable, so choosing by hand later is just as good.
    const onSkip = vi.fn()
    renderDialog({ onSkip })
    await userEvent.click(screen.getByText('Choose later'))
    expect(onSkip).toHaveBeenCalled()
  })

  it('is put off by Escape', async () => {
    const onSkip = vi.fn()
    renderDialog({ onSkip })
    await userEvent.keyboard('{Escape}')
    expect(onSkip).toHaveBeenCalled()
  })
})
