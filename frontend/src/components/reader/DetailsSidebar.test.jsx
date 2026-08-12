import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import DetailsSidebar from './DetailsSidebar'

const mockUser = { role: 'player' }
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}))

// The editor is exercised in its own test; here it only needs to be
// identifiable so the Edit toggle can be asserted on.
vi.mock('./DetailsSidebarEditor', () => ({
  default: ({ onCancel }) => (
    <div>
      <span>editor</span>
      <button onClick={onCancel}>cancel-editor</button>
    </div>
  ),
}))

function makeBook(overrides = {}) {
  return {
    id: 'book-1',
    title: "Player's Handbook",
    category: 'core',
    authors: ['Jeremy Crawford'],
    publisher: 'Wizards',
    year: 2014,
    page_count: 320,
    file_size: 1024,
    mime_type: 'application/pdf',
    relative_path: 'D&D/Core/PHB.pdf',
    tags: [],
    ...overrides,
  }
}

function renderSidebar(overrides = {}) {
  const props = {
    book: makeBook(overrides.book),
    onClose: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  }
  return {
    ...render(
      <MemoryRouter>
        <DetailsSidebar {...props} />
      </MemoryRouter>
    ),
    props,
  }
}

describe('DetailsSidebar', () => {
  beforeEach(() => {
    mockUser.role = 'player'
  })

  it('shows the book title and its metadata', () => {
    renderSidebar()
    expect(screen.getByText("Player's Handbook")).toBeInTheDocument()
    expect(screen.getByText('Jeremy Crawford')).toBeInTheDocument()
    expect(screen.getByText('Wizards')).toBeInTheDocument()
    expect(screen.getByText('320')).toBeInTheDocument()
  })

  it('omits fields the book has no value for', () => {
    renderSidebar({ book: { publisher: '', isbn: '' } })
    expect(screen.queryByText('Publisher')).not.toBeInTheDocument()
    expect(screen.queryByText('ISBN')).not.toBeInTheDocument()
  })

  it('renders the description when set', () => {
    renderSidebar({ book: { description: 'The core rulebook.' } })
    expect(screen.getByText('The core rulebook.')).toBeInTheDocument()
  })

  it('renders tags when the book has them', () => {
    renderSidebar({ book: { tags: ['5e', 'core'] } })
    expect(screen.getByText('5e')).toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', async () => {
    const { props } = renderSidebar()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('hides the edit button from players', () => {
    renderSidebar()
    expect(screen.queryByRole('button', { name: 'Edit metadata' })).not.toBeInTheDocument()
  })

  it.each(['admin', 'gm'])('offers the edit button to %s', (role) => {
    mockUser.role = role
    renderSidebar()
    expect(screen.getByRole('button', { name: 'Edit metadata' })).toBeInTheDocument()
  })

  it('swaps in the editor when Edit is clicked, and back out on cancel', async () => {
    mockUser.role = 'gm'
    renderSidebar()
    await userEvent.click(screen.getByRole('button', { name: 'Edit metadata' }))

    expect(screen.getByText('editor')).toBeInTheDocument()
    // The edit button is gone while editing, so it can't be re-entered.
    expect(screen.queryByRole('button', { name: 'Edit metadata' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('cancel-editor'))
    expect(screen.queryByText('editor')).not.toBeInTheDocument()
    expect(screen.getByText("Player's Handbook")).toBeInTheDocument()
  })
})
