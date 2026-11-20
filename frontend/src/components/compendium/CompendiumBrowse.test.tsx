import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import CompendiumBrowse from './CompendiumBrowse'
import { SPELL_TYPE, entry } from '../../test/compendiumFixtures'

const mockBrowse = vi.fn()
vi.mock('../../api', () => ({
  compendium: { browse: (...a: unknown[]) => mockBrowse(...a) },
}))

const page = (overrides: Record<string, unknown> = {}) => ({
  content_type: SPELL_TYPE,
  entries: [entry(), entry({ entry_id: 'shield', name: 'Shield', display: 'Abjuration 1' })],
  total: 2,
  page: 1,
  page_size: 50,
  filters_available: {
    school: [
      { value: 'Abjuration', count: 1 },
      { value: 'Evocation', count: 1 },
    ],
    subschool: [{ value: 'Fire', count: 1 }],
  },
  filters_without_parent: { subschool: false },
  ...overrides,
})

const renderIt = () =>
  render(
    <MemoryRouter>
      <CompendiumBrowse systemId="s1" contentType="spell" />
    </MemoryRouter>
  )

const lastQuery = () => mockBrowse.mock.calls[mockBrowse.mock.calls.length - 1][2]

beforeEach(() => {
  mockBrowse.mockReset()
  mockBrowse.mockResolvedValue(page())
  sessionStorage.clear()
})

describe('CompendiumBrowse', () => {
  it('lists the type’s entries with its label and count', async () => {
    renderIt()
    expect(await screen.findByRole('heading', { name: 'Spells' })).toBeInTheDocument()
    expect(screen.getByText('2 entries')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Shield/ })).toHaveAttribute(
      'href',
      '/library/system/s1/compendium/spell/shield?origin=demo-srd'
    )
  })

  it('filters by a facet, and a child waits for its parent', async () => {
    renderIt()
    const school = await screen.findByRole('combobox', { name: 'School' })
    expect(screen.getByRole('combobox', { name: 'Subschool' })).toBeDisabled()
    await userEvent.selectOptions(school, 'Evocation')
    await waitFor(() => expect(lastQuery().filters).toEqual({ school: 'Evocation' }))
    expect(screen.getByRole('combobox', { name: 'Subschool' })).toBeEnabled()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Subschool' }), 'Fire')
    await waitFor(() =>
      expect(lastQuery().filters).toEqual({ school: 'Evocation', subschool: 'Fire' })
    )
    // A new parent clears the child that narrowed within the old one.
    await userEvent.selectOptions(school, 'Abjuration')
    await waitFor(() => expect(lastQuery().filters).toEqual({ school: 'Abjuration' }))
    await userEvent.selectOptions(school, '')
    await waitFor(() => expect(lastQuery().filters).toEqual({}))
  })

  it('searches the type', async () => {
    renderIt()
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search Spells' }), 'fire')
    await waitFor(() => expect(lastQuery().search).toBe('fire'))
    expect(lastQuery().page).toBe(1)
  })

  it('pages through a long type', async () => {
    mockBrowse.mockResolvedValue(page({ total: 120 }))
    renderIt()
    const next = await screen.findByRole('button', { name: 'Next' })
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await userEvent.click(next)
    await waitFor(() => expect(lastQuery().page).toBe(2))
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await waitFor(() => expect(lastQuery().page).toBe(1))
  })

  it('says when nothing matches', async () => {
    mockBrowse.mockResolvedValue(page({ entries: [], total: 0, filters_available: {} }))
    renderIt()
    expect(await screen.findByText('No entries match.')).toBeInTheDocument()
  })

  it('says why it could not load', async () => {
    mockBrowse.mockRejectedValue(new Error('offline'))
    renderIt()
    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
  })
})
