import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import RecentlyAddedBadge from './RecentlyAddedBadge'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }))

const DAY = 24 * 60 * 60 * 1000

describe('RecentlyAddedBadge', () => {
  it('marks a recent item, reading "New" on hover', () => {
    render(<RecentlyAddedBadge addedAt={new Date(Date.now() - DAY).toISOString()} />)
    const badge = screen.getByTestId('recently-added-badge')
    expect(badge).toHaveAttribute('title', 'common.newBadge')
    expect(screen.getByRole('img', { name: 'common.newBadge' })).toBe(badge)
  })

  it('renders nothing for an older item', () => {
    const { container } = render(
      <RecentlyAddedBadge addedAt={new Date(Date.now() - 30 * DAY).toISOString()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for an item with no recorded date', () => {
    const { container } = render(<RecentlyAddedBadge addedAt={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
