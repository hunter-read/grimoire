import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SystemCard from './SystemCard'

vi.mock('../../context/FavoritesContext', () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}))

vi.mock('../../api', () => ({
  mediaUrl: (path) => `http://localhost${path}`,
}))

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

    it('renders clickable tag buttons that toggle a filter', async () => {
      const onTagClick = vi.fn()
      render(
        <SystemCard
          system={makeSystem({ tags: ['osr'] })}
          onClick={vi.fn()}
          onTagClick={onTagClick}
          activeTags={new Set()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /filter by osr/i }))
      expect(onTagClick).toHaveBeenCalledWith('osr')
    })

    it('marks an active tag as pressed', () => {
      render(
        <SystemCard
          system={makeSystem({ tags: ['osr'] })}
          onClick={vi.fn()}
          onTagClick={vi.fn()}
          activeTags={new Set(['osr'])}
        />
      )
      expect(screen.getByRole('button', { name: /filter by osr/i })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
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

    it('tags are not clickable filters while selecting', () => {
      render(
        <SystemCard
          system={makeSystem({ tags: ['osr'] })}
          onClick={vi.fn()}
          selectable
          onTagClick={vi.fn()}
        />
      )
      expect(screen.queryByRole('button', { name: /filter by osr/i })).not.toBeInTheDocument()
      expect(screen.getByText('Osr')).toBeInTheDocument()
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
})
