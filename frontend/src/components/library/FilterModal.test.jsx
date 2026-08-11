import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FilterModal from './FilterModal'
import { FILTER_NONE, FILTER_ANY } from './specialFilters'

// The `t` mock echoes the key, interpolating {{field}} so the presence-filter
// labels ("sortFilter.specialNone:Genre") stay distinguishable per filter.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, opts) => (opts?.field ? `${k}:${opts.field}` : k) }),
}))

const defaultSelectFilters = [
  {
    key: 'genre',
    label: 'Genre',
    allLabel: 'All',
    options: [{ value: 'Fantasy', label: 'Fantasy' }],
  },
]
const multiFilters = [
  { key: 'tags', label: 'Tags', emptyLabel: 'No tags', options: [{ value: 'osr', label: 'osr' }] },
]
const toggleFilters = [
  { key: 'favorites', label: 'Favorites', boolean: true },
  { key: 'explicit', label: 'Explicit' },
]

function Harness({
  initial = { sort: 'name', order: 'asc', filters: {} },
  selectFilters = defaultSelectFilters,
  onSavePreset,
  onClose,
}) {
  const [state, setState] = useState(initial)
  return (
    <div>
      <FilterModal
        state={state}
        onChange={setState}
        selectFilters={selectFilters}
        multiFilters={multiFilters}
        toggleFilters={toggleFilters}
        onSavePreset={onSavePreset || vi.fn()}
        onClose={onClose || vi.fn()}
      />
      <output data-testid="state">{JSON.stringify(state)}</output>
    </div>
  )
}

describe('FilterModal', () => {
  it('renders the Favorites toggle as the first filter (before the search box)', () => {
    render(<Harness />)
    const fav = screen.getByRole('checkbox', { name: /Favorites/ })
    const search = screen.getByLabelText('sortFilter.searchLabel')
    // Favorites appears before the search input in DOM order.
    expect(fav.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('applies a title search filter', async () => {
    render(<Harness />)
    await userEvent.type(screen.getByLabelText('sortFilter.searchLabel'), 'goblin')
    expect(screen.getByTestId('state').textContent).toContain('"search":"goblin"')
  })

  it('applies a select filter', async () => {
    render(<Harness />)
    await userEvent.selectOptions(screen.getByLabelText('Genre'), 'Fantasy')
    expect(screen.getByTestId('state').textContent).toContain('"genre":"Fantasy"')
  })

  it('toggles a value in the multiselect dropdown', async () => {
    render(<Harness />)
    // Open the "Tags" dropdown, then check an option.
    await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'osr' }))
    expect(screen.getByTestId('state').textContent).toContain('"tags":["osr"]')
  })

  it('toggles a boolean checkbox', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('checkbox', { name: /Favorites/ }))
    expect(screen.getByTestId('state').textContent).toContain('"favorites":true')
  })

  it('sets a tri-state select filter', async () => {
    render(<Harness />)
    await userEvent.selectOptions(screen.getByLabelText('Explicit'), 'true')
    expect(screen.getByTestId('state').textContent).toContain('"explicit":true')
  })

  it('clears all filters', async () => {
    render(<Harness initial={{ sort: 'name', order: 'asc', filters: { genre: 'Fantasy' } }} />)
    await userEvent.click(screen.getByText('sortFilter.clear'))
    expect(screen.getByTestId('state').textContent).toContain('"filters":{}')
  })

  it('saves a preset (with default) and closes', async () => {
    const onSavePreset = vi.fn()
    const onClose = vi.fn()
    render(<Harness onSavePreset={onSavePreset} onClose={onClose} />)
    await userEvent.type(screen.getByLabelText('sortFilter.savePrompt'), 'My Preset')
    await userEvent.click(screen.getByText('sortFilter.saveAsDefault'))
    await userEvent.click(screen.getByText('common.save'))
    expect(onSavePreset).toHaveBeenCalledWith('My Preset', { asDefault: true })
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on the Done button', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await userEvent.click(screen.getByText('common.done'))
    expect(onClose).toHaveBeenCalled()
  })

  describe('special presence filters', () => {
    it('offers them above the concrete options in a select filter', () => {
      render(<Harness />)
      const opts = [...screen.getByLabelText('Genre').options].map((o) => o.value)
      expect(opts).toEqual(['', FILTER_NONE, FILTER_ANY, 'Fantasy'])
    })

    it('applies the "no value" sentinel from a select filter', async () => {
      render(<Harness />)
      await userEvent.selectOptions(screen.getByLabelText('Genre'), FILTER_NONE)
      expect(screen.getByTestId('state').textContent).toContain(`"genre":"${FILTER_NONE}"`)
    })

    it('applies the "any value" sentinel from a multiselect filter', async () => {
      render(<Harness />)
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      await userEvent.click(screen.getByRole('checkbox', { name: 'sortFilter.specialAny:Tags' }))
      expect(screen.getByTestId('state').textContent).toContain(`"tags":["${FILTER_ANY}"]`)
    })

    it('omits them for a filter that opts out', () => {
      render(
        <Harness
          selectFilters={[
            { key: 'genre', label: 'Genre', allLabel: 'All', options: [], special: false },
          ]}
        />
      )
      const opts = [...screen.getByLabelText('Genre').options].map((o) => o.value)
      expect(opts).toEqual([''])
    })
  })
})
