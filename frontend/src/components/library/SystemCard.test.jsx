import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import SystemCard from './SystemCard'

vi.mock('../../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}))

vi.mock('../../api', () => ({
  mediaUrl: (path) => `http://localhost${path}`,
}))

// Tag chips navigate via react-router's useNavigate — capture it.
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mockNavigate }
})

// SystemCard renders LinkableTag (uses useNavigate), so every render needs a Router.
const render = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>)

function makeSystem(overrides = {}) {
  return {
    id: 'sys-1',
    name: 'Dungeons & Dragons',
    book_count: 5,
    is_explicit: false,
    cover_book_id: null,
    description: '',
    publishers: [],
    tags: [],
    ...overrides,
  }
}

describe('SystemCard', () => {
  beforeEach(() => mockNavigate.mockClear())

  describe('full card layout', () => {
    it('renders name, description, publishers, and tags', () => {
      render(
        <SystemCard
          system={makeSystem({
            description: 'The classic fantasy RPG',
            publishers: [{ name: 'WotC' }, { name: 'TSR' }],
            tags: ['fantasy', 'osr'],
          })}
          onClick={vi.fn()}
        />
      )
      expect(screen.getByText('Dungeons & Dragons')).toBeInTheDocument()
      expect(screen.getByText('The classic fantasy RPG')).toBeInTheDocument()
      expect(screen.getByText('WotC, TSR')).toBeInTheDocument()
      expect(screen.getByText('Fantasy')).toBeInTheDocument()
      expect(screen.getByText('Osr')).toBeInTheDocument()
    })

    it('navigates on click when not selectable', async () => {
      const onClick = vi.fn()
      render(<SystemCard system={makeSystem()} onClick={onClick} />)
      await userEvent.click(screen.getByText('Dungeons & Dragons'))
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('shows the cover image and explicit badge when applicable', () => {
      render(
        <SystemCard
          system={makeSystem({ cover_book_id: 'b1', is_explicit: true })}
          onClick={vi.fn()}
        />
      )
      const img = document.querySelector('img')
      expect(img).toHaveAttribute('src', 'http://localhost/books/b1/thumbnail')
      expect(screen.getByText('18+')).toBeInTheDocument()
    })

    it('navigates to the tags page (by internal key) when a tag chip is clicked', async () => {
      const onClick = vi.fn()
      render(<SystemCard system={makeSystem({ tags: ['osr'] })} onClick={onClick} />)
      await userEvent.click(screen.getByRole('button', { name: 'Osr' }))
      expect(mockNavigate).toHaveBeenCalledWith('/tags?tag=osr')
      // Clicking a chip must not also trigger the card's own navigation.
      expect(onClick).not.toHaveBeenCalled()
    })
  })

  describe('selection mode', () => {
    it('toggles selection instead of navigating when selectable', async () => {
      const onClick = vi.fn()
      const onToggleSelect = vi.fn()
      render(
        <SystemCard
          system={makeSystem()}
          onClick={onClick}
          selectable
          onToggleSelect={onToggleSelect}
        />
      )
      await userEvent.click(screen.getByText('Dungeons & Dragons'))
      expect(onClick).not.toHaveBeenCalled()
      expect(onToggleSelect).toHaveBeenCalledWith({ shift: false, meta: false })
    })

    it('passes shift/meta modifiers from the click', async () => {
      const onToggleSelect = vi.fn()
      render(
        <SystemCard
          system={makeSystem()}
          onClick={vi.fn()}
          selectable
          onToggleSelect={onToggleSelect}
        />
      )
      const user = userEvent.setup()
      await user.keyboard('{Shift>}')
      await user.click(screen.getByText('Dungeons & Dragons'))
      await user.keyboard('{/Shift}')
      expect(onToggleSelect).toHaveBeenCalledWith({ shift: true, meta: false })
    })

    it('does not render the favorite button while selectable', () => {
      render(<SystemCard system={makeSystem()} onClick={vi.fn()} selectable />)
      expect(screen.queryByRole('button', { name: /favorite/i })).not.toBeInTheDocument()
    })

    it('tag chips still navigate to the tags page while selecting', async () => {
      const onToggleSelect = vi.fn()
      render(
        <SystemCard
          system={makeSystem({ tags: ['osr'] })}
          onClick={vi.fn()}
          selectable
          onToggleSelect={onToggleSelect}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: 'Osr' }))
      expect(mockNavigate).toHaveBeenCalledWith('/tags?tag=osr')
      // Clicking the chip does not toggle the card's selection.
      expect(onToggleSelect).not.toHaveBeenCalled()
    })
  })

  describe('compact layout', () => {
    it('renders the name and toggles selection when selectable', async () => {
      const onToggleSelect = vi.fn()
      render(
        <SystemCard
          system={makeSystem({ is_explicit: true })}
          onClick={vi.fn()}
          compact
          selectable
          onToggleSelect={onToggleSelect}
        />
      )
      expect(screen.getByText('Dungeons & Dragons')).toBeInTheDocument()
      expect(screen.getByText('18+')).toBeInTheDocument()
      await userEvent.click(screen.getByText('Dungeons & Dragons'))
      expect(onToggleSelect).toHaveBeenCalled()
    })
  })

  describe('list layout', () => {
    it('renders book count and navigates on click', async () => {
      const onClick = vi.fn()
      render(<SystemCard system={makeSystem({ book_count: 5 })} onClick={onClick} list />)
      expect(screen.getByText(/5 books/i)).toBeInTheDocument()
      await userEvent.click(screen.getByText('Dungeons & Dragons'))
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('toggles selection and hides the favorite button when selectable', async () => {
      const onToggleSelect = vi.fn()
      render(
        <SystemCard
          system={makeSystem()}
          onClick={vi.fn()}
          list
          selectable
          onToggleSelect={onToggleSelect}
        />
      )
      await userEvent.click(screen.getByText('Dungeons & Dragons'))
      expect(onToggleSelect).toHaveBeenCalled()
    })
  })
  describe('system containers (issues #261, #262)', () => {
    it('counts nested systems instead of books for a container', () => {
      render(
        <SystemCard
          system={makeSystem({
            name: 'one-page-rpgs',
            container_kind: 'one-page',
            book_count: 0,
            child_count: 12,
          })}
          onClick={vi.fn()}
        />
      )
      expect(screen.getByText(/12 systems/i)).toBeInTheDocument()
    })

    it('prettifies a slug-like container name', () => {
      render(
        <SystemCard
          system={makeSystem({
            name: 'one-page-rpgs',
            is_one_page: true,
            container_kind: 'one-page',
            child_count: 3,
          })}
          onClick={vi.fn()}
        />
      )
      expect(screen.getByText('One Page RPGs')).toBeInTheDocument()
    })

    it('keeps the book count for ordinary systems', () => {
      render(<SystemCard system={makeSystem()} onClick={vi.fn()} />)
      expect(screen.getByText(/5 books/i)).toBeInTheDocument()
    })

    it('shows the nested-system count in list mode too', () => {
      render(
        <SystemCard
          system={makeSystem({
            name: 'Dungeons & Dragons',
            container_kind: 'parent',
            book_count: 0,
            child_count: 4,
          })}
          onClick={vi.fn()}
          list
        />
      )
      expect(screen.getByText(/4 systems/i)).toBeInTheDocument()
    })
  })
  describe('parent-system border', () => {
    const borderOf = (container) => container.firstChild.style.border

    it('gives a parent-system container a gold border', () => {
      const { container } = render(
        <SystemCard
          system={makeSystem({ container_kind: 'parent', child_count: 3 })}
          onClick={vi.fn()}
        />
      )
      expect(borderOf(container)).toContain('var(--gold)')
    })

    it('leaves one-page collections with the default border', () => {
      const { container } = render(
        <SystemCard
          system={makeSystem({ container_kind: 'one-page', child_count: 9 })}
          onClick={vi.fn()}
        />
      )
      expect(borderOf(container)).toContain('var(--border)')
      expect(borderOf(container)).not.toContain('var(--gold)')
    })

    it('leaves ordinary systems with the default border', () => {
      const { container } = render(<SystemCard system={makeSystem()} onClick={vi.fn()} />)
      expect(borderOf(container)).toContain('var(--border)')
    })

    it('applies the gold border in compact and list layouts too', () => {
      const parent = makeSystem({ container_kind: 'parent', child_count: 3 })
      const { container: compactEl } = render(
        <SystemCard system={parent} onClick={vi.fn()} compact />
      )
      expect(borderOf(compactEl)).toContain('var(--gold)')

      const { container: listEl } = render(<SystemCard system={parent} onClick={vi.fn()} list />)
      expect(borderOf(listEl)).toContain('var(--gold)')
    })

    it('selection styling still wins over the container border', () => {
      const { container } = render(
        <SystemCard
          system={makeSystem({ container_kind: 'parent', child_count: 3 })}
          onClick={vi.fn()}
          selectable
          selected
        />
      )
      expect(borderOf(container)).toContain('var(--gold-dim)')
    })
  })

  // Issue #313: the card is a <div>, not an <a>, so new-tab behaviour is wired
  // by hand and needs covering in each layout.
  describe('opening in a new tab', () => {
    let open

    beforeEach(() => {
      open = vi.spyOn(window, 'open').mockImplementation(() => null)
    })

    afterEach(() => open.mockRestore())

    it.each([
      ['full', {}],
      ['compact', { compact: true }],
      ['list', { list: true }],
    ])('middle click opens the system in a new tab from the %s layout', async (_name, layout) => {
      const onClick = vi.fn()
      const { container } = render(
        <SystemCard
          system={makeSystem()}
          to="/library/system/sys-1"
          onClick={onClick}
          {...layout}
        />
      )

      await userEvent.pointer({ target: container.firstChild, keys: '[MouseMiddle]' })

      expect(open).toHaveBeenCalledWith('/library/system/sys-1', '_blank', 'noopener,noreferrer')
      expect(onClick).not.toHaveBeenCalled()
    })

    it('still navigates in place on a plain click', async () => {
      const onClick = vi.fn()
      const { container } = render(
        <SystemCard system={makeSystem()} to="/library/system/sys-1" onClick={onClick} />
      )

      await userEvent.click(container.firstChild)

      expect(onClick).toHaveBeenCalledTimes(1)
      expect(open).not.toHaveBeenCalled()
    })

    it('selects rather than opening a tab while in bulk-select mode', async () => {
      const onToggleSelect = vi.fn()
      const { container } = render(
        <SystemCard
          system={makeSystem()}
          to="/library/system/sys-1"
          onClick={vi.fn()}
          selectable
          onToggleSelect={onToggleSelect}
        />
      )

      await userEvent.pointer({ target: container.firstChild, keys: '[MouseMiddle]' })
      expect(open).not.toHaveBeenCalled()

      await userEvent.click(container.firstChild)
      expect(onToggleSelect).toHaveBeenCalled()
    })
  })
})
