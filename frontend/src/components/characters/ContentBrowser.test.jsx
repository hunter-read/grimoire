import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ContentBrowser from './ContentBrowser'

const mockBrowse = vi.fn()
vi.mock('../../api', () => ({
  content: { browse: (...args) => mockBrowse(...args) },
}))

const TYPE = {
  label: 'Spell',
  label_plural: 'Spells',
  identity_field: 'name',
  compact_display: '{name} — {school} {level}',
  fields: {
    name: { type: 'text', label: 'Name' },
    level: { type: 'number', label: 'Level' },
    school: { type: 'text', label: 'School' },
  },
}

const RESULT = {
  entries: [
    {
      entry_id: 'fireball',
      source: 'srd',
      name: 'Fireball',
      content_type: 'spell',
      data: { name: 'Fireball', level: 3, school: 'evocation' },
      display: 'Fireball — evocation 3',
    },
    {
      entry_id: 'shield',
      source: 'srd',
      name: 'Shield',
      content_type: 'spell',
      data: { name: 'Shield', level: 1, school: 'abjuration' },
      display: 'Shield — abjuration 1',
    },
  ],
  total: 2,
  page: 1,
  page_size: 50,
  filters_available: {
    level: [
      { value: '1', count: 1 },
      { value: '3', count: 1 },
    ],
  },
}

const renderBrowser = (props = {}) =>
  render(
    <ContentBrowser
      schemaId="demo"
      contentType="spell"
      typeDefinition={TYPE}
      onChoose={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockBrowse.mockResolvedValue(RESULT)
})

describe('ContentBrowser', () => {
  it('lists entries with their compact display', async () => {
    renderBrowser()
    expect(await screen.findByText('Fireball')).toBeInTheDocument()
    expect(screen.getByText('Fireball — evocation 3')).toBeInTheDocument()
  })

  it('shows how many entries matched', async () => {
    renderBrowser()
    expect(await screen.findByText(/2 entries/i)).toBeInTheDocument()
  })

  it('searches server-side', async () => {
    renderBrowser()
    await screen.findByText('Fireball')
    await userEvent.type(screen.getByLabelText(/Search the catalog/i), 'fire')
    await waitFor(() =>
      expect(mockBrowse).toHaveBeenLastCalledWith(
        'demo',
        'spell',
        expect.objectContaining({ search: 'fire' })
      )
    )
  })

  it('filters through the facet sidebar', async () => {
    renderBrowser()
    await screen.findByText('Fireball')
    await userEvent.selectOptions(screen.getByLabelText('Level'), '3')
    await waitFor(() =>
      expect(mockBrowse).toHaveBeenLastCalledWith(
        'demo',
        'spell',
        expect.objectContaining({ filters: { level: '3' } })
      )
    )
  })

  it('reports a choice as a reference, not a copy', async () => {
    const onChoose = vi.fn()
    renderBrowser({ onChoose })
    await screen.findByText('Fireball')
    await userEvent.click(screen.getAllByLabelText(/Add to sheet/i)[0])
    expect(onChoose).toHaveBeenCalledWith({ _ref: 'fireball', _source: 'srd' })
  })

  it('closes after a single pick but stays open for a multi-pick', async () => {
    const onClose = vi.fn()
    const { unmount } = renderBrowser({ onClose })
    await screen.findByText('Fireball')
    await userEvent.click(screen.getAllByLabelText(/Add to sheet/i)[0])
    expect(onClose).toHaveBeenCalled()
    unmount()

    const stayOpen = vi.fn()
    renderBrowser({ onClose: stayOpen, multiple: true })
    await screen.findByText('Fireball')
    await userEvent.click(screen.getAllByLabelText(/Add to sheet/i)[0])
    expect(stayOpen).not.toHaveBeenCalled()
  })

  it('marks entries already on the sheet', async () => {
    renderBrowser({ multiple: true, chosen: [{ _ref: 'fireball' }] })
    await screen.findByText('Fireball')
    expect(screen.getByLabelText(/Already on the sheet/i)).toBeInTheDocument()
  })

  it('expands an entry into a read-only detail view', async () => {
    renderBrowser()
    await userEvent.click(await screen.findByText('Fireball'))
    // Rendered through FieldRenderer in read-only mode, so the entry's values
    // are text. (The search box is the one input on screen, and is not part of
    // the detail.)
    expect(screen.getByText('evocation')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    renderBrowser({ onClose })
    await screen.findByText('Fireball')
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an empty state when nothing matches', async () => {
    mockBrowse.mockResolvedValue({ ...RESULT, entries: [], total: 0 })
    renderBrowser()
    expect(await screen.findByText(/Nothing matches/i)).toBeInTheDocument()
  })

  it('surfaces a catalog failure', async () => {
    mockBrowse.mockRejectedValue(new Error('catalog down'))
    renderBrowser()
    expect(await screen.findByRole('alert')).toHaveTextContent('catalog down')
  })
})
