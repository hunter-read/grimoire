import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CampaignCard from './CampaignCard'

// Mirror the real bannerUrl: media URLs carry no ?token= (auth is via the
// HttpOnly cookie), so `v` must be attached as a real query param — a plain
// string concat of "&v=" would produce a malformed, unroutable URL.
vi.mock('../../api', () => ({
  campaigns: {
    bannerUrl: (id, v) => `/api/campaigns/${id}/banner${v ? `?v=${encodeURIComponent(v)}` : ''}`,
  },
}))
vi.mock('./WikiMarkdown', () => ({
  default: ({ body }) => <div data-testid="wiki">{body}</div>,
}))
vi.mock('./CampaignRoleBadge', () => ({ default: ({ label }) => <span>{label}</span> }))

beforeEach(() => vi.clearAllMocks())

const campaign = (over = {}) => ({
  id: 'c1',
  name: 'Curse of Strahd',
  owner_id: 'u1',
  members: [],
  has_banner: false,
  updated_at: '2026-01-01T00:00:00',
  ...over,
})

describe('CampaignCard', () => {
  it('renders the name and calls onClick when activated', async () => {
    const onClick = vi.fn()
    render(<CampaignCard campaign={campaign()} onClick={onClick} onOpenNotes={vi.fn()} />)
    expect(screen.getByText('Curse of Strahd')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Curse of Strahd'))
    expect(onClick).toHaveBeenCalled()
  })

  it('opens notes without bubbling to the card onClick', async () => {
    const onClick = vi.fn()
    const onOpenNotes = vi.fn()
    render(<CampaignCard campaign={campaign()} onClick={onClick} onOpenNotes={onOpenNotes} />)
    await userEvent.click(screen.getByRole('button', { name: /notes/i }))
    expect(onOpenNotes).toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders a cache-busted banner (lazy) when has_banner', () => {
    const { container } = render(
      <CampaignCard
        campaign={campaign({ has_banner: true })}
        onClick={vi.fn()}
        onOpenNotes={vi.fn()}
      />
    )
    const img = container.querySelector('img')
    // The cache-buster must be a real query param (leading '?'), not a bare
    // '&v=' appended to the path, or the URL doesn't route on the backend.
    expect(img.getAttribute('src')).toBe('/api/campaigns/c1/banner?v=2026-01-01T00%3A00%3A00')
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('renders the description via WikiMarkdown and the badge label', () => {
    render(
      <CampaignCard
        campaign={campaign({ description: 'Gothic horror' })}
        onClick={vi.fn()}
        onOpenNotes={vi.fn()}
        badgeLabel="GM"
      />
    )
    expect(screen.getByTestId('wiki')).toHaveTextContent('Gothic horror')
    expect(screen.getByText('GM')).toBeInTheDocument()
  })

  it('activates via the keyboard (Enter)', async () => {
    const onClick = vi.fn()
    render(<CampaignCard campaign={campaign()} onClick={onClick} onOpenNotes={vi.fn()} />)
    const card = screen.getByRole('button', { name: /open campaign/i })
    card.focus()
    await userEvent.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalled()
  })

  it('formats an upcoming session date and keeps description clicks from opening the card', async () => {
    const onClick = vi.fn()
    render(
      <CampaignCard
        campaign={campaign({ next_session: '2026-08-15', description: 'read me' })}
        onClick={onClick}
        onOpenNotes={vi.fn()}
      />
    )
    // The formatted date renders (exercises formatSessionDate's non-empty path).
    expect(screen.getByText(/Aug/)).toBeInTheDocument()
    // Clicking inside the description must not bubble to the card's onClick.
    await userEvent.click(screen.getByTestId('wiki'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('shows the player count for a GM campaign owned by the viewer', () => {
    render(
      <CampaignCard
        campaign={campaign({
          is_gm_campaign: true,
          members: [
            { status: 'accepted', is_owner: false },
            { status: 'accepted', is_owner: false },
            { status: 'pending', is_owner: false },
          ],
        })}
        userId="u1"
        onClick={vi.fn()}
        onOpenNotes={vi.fn()}
      />
    )
    expect(screen.getByText(/2/)).toBeInTheDocument()
  })
})
