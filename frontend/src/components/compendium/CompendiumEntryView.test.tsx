import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CompendiumEntryView from './CompendiumEntryView'
import { SPELL_TYPE, entry } from '../../test/compendiumFixtures'

const mockEntry = vi.fn()
vi.mock('../../api', () => ({
  compendium: { entry: (...a: unknown[]) => mockEntry(...a) },
}))

const renderIt = () =>
  render(
    <MemoryRouter>
      <CompendiumEntryView systemId="s1" contentType="spell" entryId="fireball" />
    </MemoryRouter>
  )

beforeEach(() => {
  mockEntry.mockReset()
})

describe('CompendiumEntryView', () => {
  it('shows the entry’s values, keeping paragraphs and leaving out empty ones', async () => {
    mockEntry.mockResolvedValue({ ...entry(), type_definition: SPELL_TYPE })
    renderIt()
    expect(await screen.findByRole('heading', { name: 'Fireball' })).toBeInTheDocument()
    expect(screen.getByText('Spell · Evocation 3')).toBeInTheDocument()
    expect(screen.getByText('Evocation')).toBeInTheDocument()
    expect(screen.getByText(/Big boom/)).toBeInTheDocument()
    // No subschool, so no empty cell for it.
    expect(screen.queryByText('Subschool')).toBeNull()
    expect(screen.getByRole('link', { name: /Back to Spells/ })).toHaveAttribute(
      'href',
      '/library/system/s1/compendium/spell'
    )
  })

  it('names the ruleset a house entry comes from', async () => {
    mockEntry.mockResolvedValue({
      ...entry({ ruleset: true, ruleset_name: 'House rules' }),
      type_definition: SPELL_TYPE,
    })
    renderIt()
    expect(await screen.findByText(/from House rules/)).toBeInTheDocument()
  })

  it('says why an entry could not load', async () => {
    mockEntry.mockRejectedValue(new Error('Entry not found'))
    renderIt()
    expect(await screen.findByRole('alert')).toHaveTextContent('Entry not found')
  })
})
