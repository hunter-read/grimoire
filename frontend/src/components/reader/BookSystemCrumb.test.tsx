import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BookSystemCrumb from './BookSystemCrumb'
import { useAuth } from '../../context/AuthContext'

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }))

const SYSTEM = {
  id: 'sys-1',
  name: 'Dungeons & Dragons 5e',
  slug: 'dnd-5e',
  is_system_agnostic: false,
  is_one_page: false,
}

function setup(system: Parameters<typeof BookSystemCrumb>[0]['system'], role = 'player') {
  vi.mocked(useAuth).mockReturnValue({ user: { role } } as ReturnType<typeof useAuth>)
  return render(
    <MemoryRouter>
      <BookSystemCrumb system={system} />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BookSystemCrumb', () => {
  it("links to the book's system page", () => {
    setup(SYSTEM)
    const link = screen.getByRole('link', { name: 'Dungeons & Dragons 5e' })
    expect(link).toHaveAttribute('href', '/library/system/sys-1')
    expect(link).toHaveAttribute('title', 'Dungeons & Dragons 5e')
  })

  it('prettifies a special collection’s raw folder name', () => {
    setup({ ...SYSTEM, name: 'one-page-rpgs', is_one_page: true })
    expect(screen.getByRole('link', { name: 'One Page RPGs' })).toBeInTheDocument()
  })

  it('renders nothing for a book in no system', () => {
    const { container } = setup(null)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a guest, who has no system pages', () => {
    const { container } = setup(SYSTEM, 'guest')
    expect(container).toBeEmptyDOMElement()
  })
})
