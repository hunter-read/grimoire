import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import AgnosticChip from './AgnosticChip'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, o) => {
      if (k === 'library.bookCount') return `${o.count} books`
      if (k === 'systemContainer.count') return `${o.count} systems`
      return k
    },
  }),
}))

const makeSystem = (over = {}) => ({
  id: 's1',
  name: 'one-page-rpgs',
  is_one_page: true,
  book_count: 3,
  ...over,
})

const renderChip = (props) =>
  render(
    <MemoryRouter>
      <AgnosticChip {...props} />
    </MemoryRouter>
  )

describe('AgnosticChip', () => {
  it('renders a prettified collection name for one-page collections', () => {
    renderChip({ system: makeSystem(), to: '/library/one-page' })
    expect(screen.getByText('One Page RPGs')).toBeInTheDocument()
    expect(screen.getByText('3 books')).toBeInTheDocument()
  })

  it('counts books, not subfolders, for the system-agnostic collection', () => {
    // The agnostic collection carries a container kind, but its subfolders are
    // categories rather than systems — so a child count would be meaningless.
    renderChip({
      system: makeSystem({
        name: 'system-agnostic',
        is_one_page: false,
        is_system_agnostic: true,
        container_kind: 'agnostic',
        child_count: 4,
        book_count: 12,
      }),
      to: '/library/agnostic',
    })
    expect(screen.getByText('12 books')).toBeInTheDocument()
    expect(screen.queryByText('4 systems')).not.toBeInTheDocument()
  })

  it('counts child systems for a one-page container', () => {
    // The sibling collection genuinely does hold systems, so it keeps the
    // child count — this pins the boundary of the exception above.
    renderChip({
      system: makeSystem({ container_kind: 'one-page', child_count: 4, book_count: 0 }),
      to: '/library/one-page',
    })
    expect(screen.getByText('4 systems')).toBeInTheDocument()
  })

  it('prettifies system-agnostic names', () => {
    renderChip({
      system: makeSystem({
        name: 'system-agnostic',
        is_one_page: false,
        is_system_agnostic: true,
      }),
      to: '/library/system-agnostic',
    })
    expect(screen.getByText('System Agnostic')).toBeInTheDocument()
  })

  it('shows the explicit badge when flagged', () => {
    renderChip({ system: makeSystem({ is_explicit: true }), to: '/library/one-page' })
    expect(screen.getByText('18+')).toBeInTheDocument()
  })

  // AgnosticChip is now a real <Link> — assert the href instead of an onClick spy.
  it('renders a link to the provided `to` route', () => {
    renderChip({ system: makeSystem(), to: '/library/one-page-rpgs' })
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/library/one-page-rpgs')
  })

  it('highlights the chip on hover and clears it on leave', async () => {
    renderChip({ system: makeSystem(), to: '/library/one-page' })
    const link = screen.getByRole('link')
    const base = link.style.background

    await userEvent.hover(link)
    expect(link.style.background).toBe('var(--bg-card-hover)')

    await userEvent.unhover(link)
    expect(link.style.background).toBe(base)
  })

  it('counts nested systems instead of books for a container', () => {
    renderChip({
      system: makeSystem({ container_kind: 'one-page', book_count: 0, child_count: 9 }),
      to: '/library/one-page',
    })
    expect(screen.getByText('9 systems')).toBeInTheDocument()
    expect(screen.queryByText('0 books')).not.toBeInTheDocument()
  })
})
