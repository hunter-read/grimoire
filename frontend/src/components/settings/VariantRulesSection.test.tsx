import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import VariantRulesSection from './VariantRulesSection'
import { naming } from '../../api'

vi.mock('../../api', () => ({
  naming: { variantRules: vi.fn(), saveVariantRules: vi.fn() },
}))

const RULES = [
  { match: 'prefix', value: 'GL_', kind: 'gridless', label: '', collection: 'map' },
  { match: 'token', value: 'night', kind: null, label: 'Night', collection: null },
] as const

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(naming.variantRules).mockResolvedValue({ rules: RULES.map((r) => ({ ...r })) })
  vi.mocked(naming.saveVariantRules).mockImplementation(async (rules) => ({ rules }))
})

const rule = (n: number) => screen.getByRole('group', { name: `Rule ${n}` })

describe('VariantRulesSection', () => {
  it('shows the saved rules in order', async () => {
    render(<VariantRulesSection />)
    expect(await screen.findByDisplayValue('GL_')).toBeInTheDocument()
    expect(within(rule(1)).getByLabelText('Match')).toHaveValue('prefix')
    expect(within(rule(1)).getByLabelText('Kind')).toHaveValue('gridless')
    expect(within(rule(1)).getByLabelText('Collection')).toHaveValue('map')
    expect(within(rule(2)).getByLabelText('Label')).toHaveValue('Night')
    // Saving is pointless until something changes.
    expect(screen.getByRole('button', { name: 'Save rules' })).toBeDisabled()
  })

  it('says when there are no rules, and reports a failed load', async () => {
    vi.mocked(naming.variantRules).mockRejectedValue(new Error(''))
    render(<VariantRulesSection />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the rules.')
    expect(screen.getByText(/No rules yet/)).toBeInTheDocument()
  })

  it('adds, edits, reorders and removes rules, then saves the list whole', async () => {
    render(<VariantRulesSection />)
    await screen.findByDisplayValue('GL_')

    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    const third = within(rule(3))
    fireEvent.change(third.getByLabelText('Match'), { target: { value: 'suffix' } })
    fireEvent.change(third.getByLabelText('Text to match'), { target: { value: '-pf' } })
    fireEvent.change(third.getByLabelText('Kind'), { target: { value: 'printer-friendly' } })
    fireEvent.change(third.getByLabelText('Label'), { target: { value: 'Print' } })

    fireEvent.click(screen.getByRole('button', { name: 'Move rule 3 up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move rule 1 down' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove rule 3' }))
    // The ends cannot move further.
    expect(screen.getByRole('button', { name: 'Move rule 1 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move rule 2 down' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
    expect(await screen.findByText('Rules saved.')).toBeInTheDocument()
    expect(naming.saveVariantRules).toHaveBeenCalledWith([
      { match: 'suffix', value: '-pf', kind: 'printer-friendly', label: 'Print', collection: null },
      { match: 'prefix', value: 'GL_', kind: 'gridless', label: '', collection: 'map' },
    ])
  })

  it('clears a kind the new collection cannot have, and keeps one it can', async () => {
    render(<VariantRulesSection />)
    await screen.findByDisplayValue('GL_')
    const first = within(rule(1))
    fireEvent.change(first.getByLabelText('Collection'), { target: { value: 'token' } })
    expect(first.getByLabelText('Kind')).toHaveValue('')
    fireEvent.change(first.getByLabelText('Kind'), { target: { value: 'other' } })
    fireEvent.change(first.getByLabelText('Collection'), { target: { value: '' } })
    expect(first.getByLabelText('Kind')).toHaveValue('other')
  })

  it('reports why the rules were refused', async () => {
    vi.mocked(naming.saveVariantRules).mockRejectedValue({
      body: { detail: 'Rule 1 needs a kind, a label, or both.' },
    })
    render(<VariantRulesSection />)
    await screen.findByDisplayValue('GL_')
    fireEvent.change(within(rule(1)).getByLabelText('Kind'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Rule 1 needs a kind')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save rules' })).toBeEnabled())
  })
})
