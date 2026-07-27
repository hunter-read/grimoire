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

function Harness({ initial = [] }) {
  const [selected, setSelected] = useState(initial)
  return (
    <div>
      <MultiSelectDropdown
        label="Tags"
        options={options}
        selected={selected}
        onChange={setSelected}
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
