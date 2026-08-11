import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MultiSelectDropdown from './MultiSelectDropdown'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) =>
      ({
        'sortFilter.multiAny': 'Any',
        'sortFilter.multiSelected': `${o?.count} selected`,
        'sortFilter.clear': 'Clear',
        'common.search': 'Search',
        'common.noResults': 'No results',
      })[k] || k,
  }),
}))

const options = [
  { value: 'osr', label: 'osr' },
  { value: 'fantasy', label: 'fantasy' },
  { value: 'grim', label: 'grim' },
]

const specialOptions = [
  { value: '__none__', label: 'No tags' },
  { value: '__any__', label: 'Any tags' },
]

function Harness({ initial = [], ...rest }) {
  const [selected, setSelected] = useState(initial)
  return (
    <div>
      <MultiSelectDropdown
        label="Tags"
        options={options}
        selected={selected}
        onChange={setSelected}
        {...rest}
      />
      <output data-testid="sel">{JSON.stringify(selected)}</output>
    </div>
  )
}

describe('MultiSelectDropdown', () => {
  it('shows "Any" when nothing is selected', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Tags' })).toHaveTextContent('Any')
  })

  it('opens and toggles a value', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'osr' }))
    expect(screen.getByTestId('sel').textContent).toBe('["osr"]')
  })

  it('filters options by the search box', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
    await userEvent.type(screen.getByLabelText('Search'), 'gr')
    expect(screen.getByRole('checkbox', { name: 'grim' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'osr' })).not.toBeInTheDocument()
  })

  it('shows a selected count and clears all', async () => {
    render(<Harness initial={['osr', 'grim']} />)
    const trigger = screen.getByRole('button', { name: 'Tags' })
    expect(trigger).toHaveTextContent('2 selected')
    // The clear (X) affordance inside the trigger resets the selection.
    await userEvent.click(screen.getByLabelText('Clear'))
    expect(screen.getByTestId('sel').textContent).toBe('[]')
  })

  it('renders an empty label when there are no options', () => {
    render(
      <MultiSelectDropdown
        label="Tags"
        options={[]}
        selected={[]}
        onChange={() => {}}
        emptyLabel="No tags"
      />
    )
    expect(screen.getByText('No tags')).toBeInTheDocument()
  })

  describe('specialOptions', () => {
    it('pins them above the regular options', async () => {
      render(<Harness specialOptions={specialOptions} />)
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      const none = screen.getByRole('checkbox', { name: 'No tags' })
      const osr = screen.getByRole('checkbox', { name: 'osr' })
      expect(none.compareDocumentPosition(osr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('keeps them visible while the search box filters the rest', async () => {
      render(<Harness specialOptions={specialOptions} />)
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      await userEvent.type(screen.getByLabelText('Search'), 'zzz')
      expect(screen.getByRole('checkbox', { name: 'No tags' })).toBeInTheDocument()
      expect(screen.queryByRole('checkbox', { name: 'osr' })).not.toBeInTheDocument()
    })

    it('toggles a special value into the selection', async () => {
      render(<Harness specialOptions={specialOptions} />)
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      await userEvent.click(screen.getByRole('checkbox', { name: 'Any tags' }))
      expect(screen.getByTestId('sel').textContent).toBe('["__any__"]')
    })

    it('still renders the dropdown when only special options exist', async () => {
      render(<Harness options={[]} specialOptions={specialOptions} emptyLabel="No tags at all" />)
      expect(screen.queryByText('No tags at all')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      expect(screen.getByRole('checkbox', { name: 'No tags' })).toBeInTheDocument()
    })

    it('replaces an existing selection when a special value is picked', async () => {
      render(<Harness initial={['osr', 'grim']} specialOptions={specialOptions} />)
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      await userEvent.click(screen.getByRole('checkbox', { name: 'No tags' }))
      expect(screen.getByTestId('sel').textContent).toBe('["__none__"]')
    })

    it('replaces the other special value rather than combining the two', async () => {
      render(<Harness initial={['__none__']} specialOptions={specialOptions} />)
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      await userEvent.click(screen.getByRole('checkbox', { name: 'Any tags' }))
      expect(screen.getByTestId('sel').textContent).toBe('["__any__"]')
    })

    it('disables the regular options while a special value is active', async () => {
      render(<Harness initial={['__none__']} specialOptions={specialOptions} />)
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      expect(screen.getByRole('checkbox', { name: 'osr' })).toBeDisabled()
      // The active sentinel stays clickable so it can be turned back off.
      expect(screen.getByRole('checkbox', { name: 'No tags' })).not.toBeDisabled()
    })

    it('frees the regular options again once the special value is cleared', async () => {
      render(<Harness initial={['__none__']} specialOptions={specialOptions} />)
      await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
      await userEvent.click(screen.getByRole('checkbox', { name: 'No tags' }))
      expect(screen.getByTestId('sel').textContent).toBe('[]')
      await userEvent.click(screen.getByRole('checkbox', { name: 'osr' }))
      expect(screen.getByTestId('sel').textContent).toBe('["osr"]')
    })

    it('names the active special filter on the trigger', () => {
      render(<Harness initial={['__none__']} specialOptions={specialOptions} />)
      expect(screen.getByRole('button', { name: 'Tags' })).toHaveTextContent('No tags')
    })
  })

  it('closes when clicking outside', async () => {
    render(
      <div>
        <Harness />
        <button>outside</button>
      </div>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
    expect(screen.getByRole('checkbox', { name: 'osr' })).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByRole('checkbox', { name: 'osr' })).not.toBeInTheDocument()
  })
})
