import { describe, it, expect, vi, beforeEach } from 'vitest'
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

// SystemCard renders CardLink (<Link>) and LinkableTag (<Link>), so every render needs a Router.
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
  describe('full card layout', () => {
    it('renders name, description, publishers, and tags', () => {
      render(
        <SystemCard
          system={makeSystem({
            description: 'The classic fantasy RPG',
            publishers: [{ name: 'WotC' }, { name: 'TSR' }],
            tags: ['fantasy', 'osr'],
          })}
          to="/library/system/sys-1"
        />
      )
      expect(screen.getByText('Dungeons & Dragons')).toBeInTheDocument()
      expect(screen.getByText('The classic fantasy RPG')).toBeInTheDocument()
      expect(screen.getByText('WotC, TSR')).toBeInTheDocument()
      expect(screen.getByText('Fantasy')).toBeInTheDocument()
      expect(screen.getByText('Osr')).toBeInTheDocument()
    })

    it('renders a real link overlay for the card when not selectable', () => {
      // Non-selectable cards render a CardLink (real anchor) with aria-label = displayName.
      // Native browser handles navigation; middle/ctrl-click open in new tab automatically.
      render(<SystemCard system={makeSystem()} to="/library/system/sys-1" />)
      const link = screen.getByRole('link', { name: 'Dungeons & Dragons' })
      expect(link).toHaveAttribute('href', '/library/system/sys-1')
    })

    it('shows the cover image and explicit badge when applicable', () => {
      render(
        <SystemCard
          system={makeSystem({ cover_book_id: 'b1', is_explicit: true })}
          to="/library/system/sys-1"
        />
      )
      const img = document.querySelector('img')
      expect(img).toHaveAttribute('src', 'http://localhost/books/b1/thumbnail')
      expect(screen.getByText('18+')).toBeInTheDocument()
    })

    it('tag chips link to the tags page', () => {
      render(<SystemCard system={makeSystem({ tags: ['osr'] })} to="/library/system/sys-1" />)
      // Tags are real <Link> elements (not buttons) after the native-link rewrite.
      const tagLink = screen.getByRole('link', { name: 'Osr' })
      expect(tagLink).toHaveAttribute('href', '/tags?tag=osr')
    })
  })

  describe('selection mode', () => {
    it('toggles selection instead of navigating when selectable', async () => {
      const onToggleSelect = vi.fn()
      render(
        <SystemCard
          system={makeSystem()}
          to="/library/system/sys-1"
          selectable
          onToggleSelect={onToggleSelect}
        />
      )
      await userEvent.click(screen.getByText('Dungeons & Dragons'))
      expect(onToggleSelect).toHaveBeenCalledWith({ shift: false, meta: false })
    })

    it('passes shift/meta modifiers from the click', async () => {
      const onToggleSelect = vi.fn()
      render(
        <SystemCard
          system={makeSystem()}
          to="/library/system/sys-1"
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
      render(<SystemCard system={makeSystem()} to="/library/system/sys-1" selectable />)
      expect(screen.queryByRole('button', { name: /favorite/i })).not.toBeInTheDocument()
    })

    it('does not render a link overlay in selectable mode', () => {
      // In bulk-select mode the card stays a toggle button — no CardLink rendered.
      render(<SystemCard system={makeSystem()} to="/library/system/sys-1" selectable />)
      expect(screen.queryByRole('link', { name: 'Dungeons & Dragons' })).not.toBeInTheDocument()
    })

    it('tag chips still link to the tags page while selecting', () => {
      render(
        <SystemCard
          system={makeSystem({ tags: ['osr'] })}
          to="/library/system/sys-1"
          selectable
          onToggleSelect={vi.fn()}
        />
      )
      const tagLink = screen.getByRole('link', { name: 'Osr' })
      expect(tagLink).toHaveAttribute('href', '/tags?tag=osr')
    })
  })

  describe('compact layout', () => {
    it('renders the name and toggles selection when selectable', async () => {
      const onToggleSelect = vi.fn()
      render(
        <SystemCard
          system={makeSystem({ is_explicit: true })}
          to="/library/system/sys-1"
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

    it('renders a real link overlay in non-selectable compact mode', () => {
      render(<SystemCard system={makeSystem()} to="/library/system/sys-1" compact />)
      const link = screen.getByRole('link', { name: 'Dungeons & Dragons' })
      expect(link).toHaveAttribute('href', '/library/system/sys-1')
    })
  })

  describe('list layout', () => {
    it('renders book count', () => {
      render(<SystemCard system={makeSystem({ book_count: 5 })} to="/library/system/sys-1" list />)
      expect(screen.getByText(/5 books/i)).toBeInTheDocument()
    })

    it('renders a real link overlay in non-selectable list mode', () => {
      render(<SystemCard system={makeSystem()} to="/library/system/sys-1" list />)
      const link = screen.getByRole('link', { name: 'Dungeons & Dragons' })
      expect(link).toHaveAttribute('href', '/library/system/sys-1')
    })

    it('toggles selection and hides the favorite button when selectable', async () => {
      const onToggleSelect = vi.fn()
      render(
        <SystemCard
          system={makeSystem()}
          to="/library/system/sys-1"
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
          to="/library/system/sys-1"
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
          to="/library/system/sys-1"
        />
      )
      expect(screen.getByText('One Page RPGs')).toBeInTheDocument()
    })

    it('keeps the book count for ordinary systems', () => {
      render(<SystemCard system={makeSystem()} to="/library/system/sys-1" />)
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
          to="/library/system/sys-1"
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
          to="/library/system/sys-1"
        />
      )
      expect(borderOf(container)).toContain('var(--gold)')
    })

    it('leaves one-page collections with the default border', () => {
      const { container } = render(
        <SystemCard
          system={makeSystem({ container_kind: 'one-page', child_count: 9 })}
          to="/library/system/sys-1"
        />
      )
      expect(borderOf(container)).toContain('var(--border)')
      expect(borderOf(container)).not.toContain('var(--gold)')
    })

    it('leaves ordinary systems with the default border', () => {
      const { container } = render(<SystemCard system={makeSystem()} to="/library/system/sys-1" />)
      expect(borderOf(container)).toContain('var(--border)')
    })

    it('applies the gold border in compact and list layouts too', () => {
      const parent = makeSystem({ container_kind: 'parent', child_count: 3 })
      const { container: compactEl } = render(
        <SystemCard system={parent} to="/library/system/sys-1" compact />
      )
      expect(borderOf(compactEl)).toContain('var(--gold)')

      const { container: listEl } = render(
        <SystemCard system={parent} to="/library/system/sys-1" list />
      )
      expect(borderOf(listEl)).toContain('var(--gold)')
    })

    it('selection styling still wins over the container border', () => {
      const { container } = render(
        <SystemCard
          system={makeSystem({ container_kind: 'parent', child_count: 3 })}
          to="/library/system/sys-1"
          selectable
          selected
        />
      )
      expect(borderOf(container)).toContain('var(--gold-dim)')
    })
  })

  // Issue #313: cards are now real <a> anchors (CardLink), so middle click and
  // ctrl/cmd-click open a new tab natively — no JS needed and no test required.
  describe('real-link card (issue #313)', () => {
    it.each([
      ['full', {}],
      ['compact', { compact: true }],
      ['list', { list: true }],
    ])('renders a real link in the %s layout so the browser handles new-tab', (_name, layout) => {
      render(<SystemCard system={makeSystem()} to="/library/system/sys-1" {...layout} />)
      const link = screen.getByRole('link', { name: 'Dungeons & Dragons' })
      expect(link).toHaveAttribute('href', '/library/system/sys-1')
    })

    it('selects rather than linking while in bulk-select mode', async () => {
      const onToggleSelect = vi.fn()
      render(
        <SystemCard
          system={makeSystem()}
          to="/library/system/sys-1"
          selectable
          onToggleSelect={onToggleSelect}
        />
      )
      // No link rendered in selectable mode.
      expect(screen.queryByRole('link', { name: 'Dungeons & Dragons' })).not.toBeInTheDocument()
      await userEvent.click(screen.getByText('Dungeons & Dragons'))
      expect(onToggleSelect).toHaveBeenCalled()
    })
  })
})
