import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SortFilterBar from './SortFilterBar'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

const sortOptions = [
  { value: 'name', label: 'Name' },
  { value: 'page_count', label: 'Pages' },
]
const selectFilters = [
  {
    key: 'genre',
    label: 'Genre',
    allLabel: 'All',
    options: [{ value: 'Fantasy', label: 'Fantasy' }],
  },
]
const toggleFilters = [{ key: 'explicit', label: 'Explicit' }]
const multiFilters = [
  { key: 'tags', label: 'Tags', emptyLabel: 'No tags', options: [{ value: 'osr', label: 'osr' }] },
]
const booleanToggles = [{ key: 'favorites', label: 'Favorites', boolean: true }]

function Harness({
  initial = { sort: 'name', order: 'asc', filters: {} },
  withMulti = false,
  withBoolean = false,
  saved = [],
  onSavePreset,
  onSetDefault,
  onDeletePreset,
  trailing,
  sticky,
}) {
  const [state, setState] = useState(initial)
  return (
    <div>
      <SortFilterBar
        state={state}
        onChange={setState}
        sortOptions={sortOptions}
        selectFilters={selectFilters}
        multiFilters={withMulti ? multiFilters : []}
        toggleFilters={withBoolean ? booleanToggles : toggleFilters}
        saved={saved}
        onSavePreset={onSavePreset}
        onSetDefault={onSetDefault}
        onDeletePreset={onDeletePreset}
        trailing={trailing}
        sticky={sticky}
      />
      <output data-testid="state">{JSON.stringify(state)}</output>
    </div>
  )
}

// Open the filter modal (all filter controls live there now).
const openFilters = async () =>
  userEvent.click(screen.getByRole('button', { name: 'sortFilter.filters' }))

beforeEach(() => localStorage.clear())

describe('SortFilterBar', () => {
  it('changes the sort key', async () => {
    render(<Harness />)
    await userEvent.selectOptions(screen.getByLabelText('sortFilter.sort'), 'page_count')
    expect(screen.getByTestId('state').textContent).toContain('"sort":"page_count"')
  })

  it('toggles sort order', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('sortFilter.ascending'))
    expect(screen.getByTestId('state').textContent).toContain('"order":"desc"')
  })

  it('applies a select filter from the modal', async () => {
    render(<Harness />)
    await openFilters()
    await userEvent.selectOptions(screen.getByLabelText('Genre'), 'Fantasy')
    expect(screen.getByTestId('state').textContent).toContain('"genre":"Fantasy"')
  })

  it('applies a tri-state toggle filter from the modal', async () => {
    render(<Harness />)
    await openFilters()
    await userEvent.selectOptions(screen.getByLabelText('Explicit'), 'true')
    expect(screen.getByTestId('state').textContent).toContain('"explicit":true')
  })

  it('the tri-state default (any) does not add a filter', async () => {
    render(<Harness initial={{ sort: 'name', order: 'asc', filters: { explicit: true } }} />)
    await openFilters()
    await userEvent.selectOptions(screen.getByLabelText('Explicit'), 'any')
    expect(screen.getByTestId('state').textContent).not.toContain('"explicit"')
  })

  it('toggles a boolean checkbox filter on and off', async () => {
    render(<Harness withBoolean />)
    await openFilters()
    const fav = screen.getByRole('checkbox', { name: /Favorites/ })
    await userEvent.click(fav)
    expect(screen.getByTestId('state').textContent).toContain('"favorites":true')
    await userEvent.click(fav)
    expect(screen.getByTestId('state').textContent).not.toContain('"favorites"')
  })

  it('selects values in a multiselect filter', async () => {
    render(<Harness withMulti />)
    await openFilters()
    await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'osr' }))
    expect(screen.getByTestId('state').textContent).toContain('"tags":["osr"]')
    await userEvent.click(screen.getByRole('checkbox', { name: 'osr' }))
    expect(screen.getByTestId('state').textContent).not.toContain('"tags"')
  })

  it('shows the Filters button with a count', async () => {
    render(<Harness initial={{ sort: 'name', order: 'asc', filters: { genre: 'Fantasy' } }} />)
    const btn = screen.getByRole('button', { name: 'sortFilter.filters' })
    expect(btn.textContent).toContain('1')
  })

  it('clears active filters from the modal', async () => {
    render(<Harness initial={{ sort: 'name', order: 'asc', filters: { genre: 'Fantasy' } }} />)
    await openFilters()
    await userEvent.click(screen.getByText('sortFilter.clear'))
    expect(screen.getByTestId('state').textContent).toContain('"filters":{}')
  })

  it('saves a preset from the modal (with default)', async () => {
    const onSavePreset = vi.fn()
    render(<Harness onSavePreset={onSavePreset} />)
    await openFilters()
    await userEvent.type(screen.getByLabelText('sortFilter.savePrompt'), 'Preset A')
    await userEvent.click(screen.getByText('sortFilter.saveAsDefault'))
    await userEvent.click(screen.getByText('common.save'))
    expect(onSavePreset).toHaveBeenCalledWith('Preset A', { asDefault: true })
  })

  it('applies a saved preset from the menu', async () => {
    const saved = [
      { id: 'p1', name: 'By pages', state: { sort: 'page_count', order: 'desc', filters: {} } },
    ]
    render(<Harness saved={saved} />)
    await userEvent.click(screen.getByRole('button', { name: 'sortFilter.savedFilters' }))
    await userEvent.click(screen.getByText('By pages'))
    expect(screen.getByTestId('state').textContent).toContain('"sort":"page_count"')
  })

  it('sets and deletes a preset via its row actions', async () => {
    const onSetDefault = vi.fn()
    const onDeletePreset = vi.fn()
    const saved = [{ id: 'p1', name: 'Keep', state: {}, is_default: false }]
    render(<Harness saved={saved} onSetDefault={onSetDefault} onDeletePreset={onDeletePreset} />)
    await userEvent.click(screen.getByRole('button', { name: 'sortFilter.savedFilters' }))
    await userEvent.click(screen.getByLabelText('sortFilter.setDefault Keep'))
    expect(onSetDefault).toHaveBeenCalledWith('p1', true)
    await userEvent.click(screen.getByLabelText('sortFilter.delete Keep'))
    expect(onDeletePreset).toHaveBeenCalledWith('p1')
  })

  // #255: gallery pages fold their multi-select / view-mode buttons into this
  // row and pin it to the top of the scroll container.
  it('renders trailing controls inside the row', () => {
    render(<Harness trailing={<button type="button">Select</button>} />)
    const bar = screen.getByTestId('sort-filter-bar')
    expect(bar).toContainElement(screen.getByRole('button', { name: 'Select' }))
  })

  it('is not sticky by default and sticks to the top when sticky is set', () => {
    const { rerender } = render(<Harness />)
    const bar = screen.getByTestId('sort-filter-bar')
    expect(bar).not.toHaveStyle({ position: 'sticky' })
    expect(bar).not.toHaveClass('sort-filter-bar-sticky')
    rerender(<Harness sticky />)
    expect(bar).toHaveStyle({ position: 'sticky', top: '0px' })
    expect(bar).toHaveClass('sort-filter-bar-sticky')
  })

  // The backdrop is a viewport-wide ::before offset back to the viewport edge,
  // so it reaches the page edge even inside a narrower container (system detail
  // caps at 1200px vs the galleries' 1400px) — a plain background stopped short.
  it('draws the sticky backdrop as a full-bleed pseudo-element', () => {
    render(<Harness sticky />)
    const bar = screen.getByTestId('sort-filter-bar')
    // No opaque background on the row itself; the ::before carries it.
    expect(bar.style.background).toBe('')
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('')
    expect(css).toMatch(/\.sort-filter-bar-sticky::before/)
    expect(css).toMatch(/width:\s*100vw/)
    expect(css).toMatch(/--sfb-offset/)
  })

  // Measured from the row's own position, so the backdrop starts at the
  // viewport edge instead of overhanging (which made <main> scroll sideways).
  it('sets the backdrop offset from the row position', () => {
    const spy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ left: 220, top: 0, right: 0, bottom: 0, width: 0, height: 0 })
    render(<Harness sticky />)
    expect(screen.getByTestId('sort-filter-bar').style.getPropertyValue('--sfb-offset')).toBe(
      '220px'
    )
    spy.mockRestore()
  })
})
