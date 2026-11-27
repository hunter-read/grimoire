import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ContentBrowser from './ContentBrowser'
import { SheetFormulaContext } from './sheetFormulaContext'

const mockBrowse = vi.fn()
vi.mock('../../api', () => ({
  content: { browse: (...args: unknown[]) => mockBrowse(...args) },
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

  it('shows a newly available facet after choosing another filter', async () => {
    mockBrowse.mockImplementation(async (_schema, _type, { filters }) => ({
      ...RESULT,
      filters_available: filters.level
        ? { ...RESULT.filters_available, school: [{ value: 'evocation', count: 1 }] }
        : RESULT.filters_available,
    }))
    renderBrowser()
    await screen.findByText('Fireball')
    expect(screen.queryByLabelText('School')).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Level'), '3')
    expect(await screen.findByLabelText('School')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Level'), '')
    await waitFor(() => expect(screen.queryByLabelText('School')).not.toBeInTheDocument())
  })

  it('enables a dependent filter only once its parent is chosen', async () => {
    const facets = {
      class: [
        { value: 'Fighter', count: 1 },
        { value: 'Wizard', count: 1 },
      ],
      origin: [{ value: 'Rune Knight', count: 1 }],
    }
    mockBrowse.mockResolvedValue({ ...RESULT, filters_available: facets })
    renderBrowser({
      contentType: 'feature',
      typeDefinition: {
        ...TYPE,
        filter_depends: { origin: 'class' },
        fields: { class: { label: 'Class' }, origin: { label: 'From' } },
      },
    })
    const origin = await screen.findByLabelText('From')
    expect(origin).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText('Class'), 'Fighter')
    expect(origin).toBeEnabled()
    await userEvent.selectOptions(origin, 'Rune Knight')
    await userEvent.selectOptions(screen.getByLabelText('Class'), 'Wizard')
    await waitFor(() =>
      expect(mockBrowse).toHaveBeenLastCalledWith(
        expect.any(String),
        'feature',
        expect.objectContaining({ filters: { class: 'Wizard' } })
      )
    )
    await userEvent.selectOptions(screen.getByLabelText('Class'), '')
    expect(origin).toBeDisabled()
  })

  it('allows a dependent filter without its parent when unparented entries exist', async () => {
    mockBrowse.mockResolvedValue({
      ...RESULT,
      filters_available: {
        class: [{ value: 'Fighter', count: 1 }],
        origin: [{ value: 'Elf', count: 1 }],
      },
      filters_without_parent: { origin: true },
    })
    renderBrowser({
      typeDefinition: {
        ...TYPE,
        filter_depends: { origin: 'class' },
        fields: { class: { label: 'Class' }, origin: { label: 'From' } },
      },
    })
    expect(await screen.findByLabelText('From')).toBeEnabled()
  })

  it('ignores a stale response that arrives after a newer filter response', async () => {
    let resolveOld: (value: unknown) => void = () => {}
    mockBrowse.mockImplementation((_schema, _type, { filters }) => {
      if (filters.level === '1')
        return new Promise((resolve) => {
          resolveOld = resolve
        })
      if (filters.level === '3')
        return Promise.resolve({
          ...RESULT,
          entries: [{ ...RESULT.entries[0], name: 'New result' }],
        })
      return Promise.resolve(RESULT)
    })
    renderBrowser()
    await screen.findByText('Fireball')
    await userEvent.selectOptions(screen.getByLabelText('Level'), '1')
    await userEvent.selectOptions(screen.getByLabelText('Level'), '3')
    expect(await screen.findByText('New result')).toBeInTheDocument()
    await act(async () => {
      resolveOld({ ...RESULT, entries: [{ ...RESULT.entries[0], name: 'Old result' }] })
    })
    expect(screen.queryByText('Old result')).not.toBeInTheDocument()
    expect(screen.getByText('New result')).toBeInTheDocument()
  })

  it('reports a choice as a reference, not a copy', async () => {
    const onChoose = vi.fn()
    renderBrowser({ onChoose })
    await screen.findByText('Fireball')
    await userEvent.click(screen.getAllByLabelText(/Add to sheet/i)[0])
    const [ref, entry] = onChoose.mock.calls[0]
    expect(ref).toEqual({ _ref: 'fireball', _source: 'srd' })
    // The entry's own properties ride alongside, so a pick with on_pick rules
    // can act on it without waiting for the sheet to resolve it.
    expect(entry.name).toBe('Fireball')
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

  it('collapses an expanded entry when it is clicked again', async () => {
    renderBrowser()
    await userEvent.click(await screen.findByText('Fireball'))
    expect(screen.getByText('evocation')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Fireball'))
    expect(screen.queryByText('evocation')).not.toBeInTheDocument()
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

describe('ContentBrowser entry_note', () => {
  const renderNoted = (entryNote: unknown, sheet: Record<string, unknown> | null = { level: 5 }) =>
    render(
      <SheetFormulaContext.Provider value={sheet}>
        <ContentBrowser
          schemaId="demo"
          contentType="spell"
          typeDefinition={TYPE}
          entryNote={entryNote}
          onChoose={vi.fn()}
          onClose={vi.fn()}
        />
      </SheetFormulaContext.Provider>
    )

  it('shows the note beside each entry, read from the entry and the sheet', async () => {
    renderNoted("concat(entry.school, ' ', entry.level <= level)")
    expect(await screen.findByText('evocation true')).toHaveClass('gc-entry-note')
    expect(screen.getByText('abjuration true')).toBeInTheDocument()
  })

  it('reads the entry name and a number result', async () => {
    renderNoted('entry.level * 2')
    expect(await screen.findByText('6')).toHaveClass('gc-entry-note')
    expect(screen.getByText('2')).toHaveClass('gc-entry-note')
  })

  it('shows nothing for an empty result', async () => {
    const { container } = renderNoted("entry.level > 2 ? entry.school : ''")
    expect(await screen.findByText('evocation')).toHaveClass('gc-entry-note')
    expect(container.querySelectorAll('.gc-entry-note')).toHaveLength(1)
  })

  it('shows nothing for a formula that fails or does not parse', async () => {
    const { container } = renderNoted('entry.(')
    expect(await screen.findByText('Fireball')).toBeInTheDocument()
    expect(container.querySelector('.gc-entry-note')).toBeNull()
  })

  it('shows nothing for a result that is not text', async () => {
    const { container } = renderNoted('entry.level > 2', null)
    expect(await screen.findByText('Fireball')).toBeInTheDocument()
    expect(container.querySelector('.gc-entry-note')).toBeNull()
  })
})
