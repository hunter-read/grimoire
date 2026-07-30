import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AgnosticChip from './AgnosticChip'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) => (k === 'library.bookCount' ? `${o.count} books` : k),
  }),
}))

const makeSystem = (over = {}) => ({
  id: 's1',
  name: 'one-page-rpgs',
  is_one_page: true,
  book_count: 3,
  ...over,
})

describe('AgnosticChip', () => {
  it('renders a prettified collection name for one-page collections', () => {
    render(<AgnosticChip system={makeSystem()} onClick={vi.fn()} />)
    expect(screen.getByText('One Page RPGs')).toBeInTheDocument()
    expect(screen.getByText('3 books')).toBeInTheDocument()
  })

  it('prettifies system-agnostic names', () => {
    render(
      <AgnosticChip
        system={makeSystem({
          name: 'system-agnostic',
          is_one_page: false,
          is_system_agnostic: true,
        })}
        onClick={vi.fn()}
      />
    )
    expect(screen.getByText('System Agnostic')).toBeInTheDocument()
  })

  it('shows the explicit badge when flagged', () => {
    render(<AgnosticChip system={makeSystem({ is_explicit: true })} onClick={vi.fn()} />)
    expect(screen.getByText('18+')).toBeInTheDocument()
  })

  it('fires onClick when clicked', async () => {
    const onClick = vi.fn()
    render(<AgnosticChip system={makeSystem()} onClick={onClick} />)
    await userEvent.click(screen.getByText('One Page RPGs'))
    expect(onClick).toHaveBeenCalled()
  })
})
