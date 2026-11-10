import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import LinkedBookBadge from './LinkedBookBadge'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { name?: string }) => (o?.name ? `${k}:${o.name}` : k),
  }),
}))

describe('LinkedBookBadge', () => {
  it('renders nothing for a shelf’s own book', () => {
    const { container } = render(<LinkedBookBadge book={{ is_linked: false }} />)
    expect(container.innerHTML).toBe('')
  })

  it('names the system a linked book lives in', () => {
    render(
      <LinkedBookBadge
        book={{
          is_linked: true,
          linked_from: { id: 's1', name: 'Pathfinder 2e', game_type: 'ttrpg', is_one_page: false },
        }}
      />
    )
    const badge = screen.getByTitle('bookLinks.linkedFrom:Pathfinder 2e')
    expect(badge.textContent).toContain('bookLinks.badge')
    expect(badge.textContent).toContain('bookLinks.linkedFrom:Pathfinder 2e')
  })

  it('does not name a home the reader may not see', () => {
    render(<LinkedBookBadge book={{ is_linked: true, linked_from: null }} small />)
    const badge = screen.getByTitle('bookLinks.linkedHidden')
    expect(badge.style.fontSize).toBe('10px')
  })
})
